/**
 * DaisySP AudioWorklet Processor
 * Runs DaisySP nodes in the audio thread via WebAssembly.
 *
 * Communication with the main thread (via port):
 *   Main → Worklet:
 *     { type: 'addNode',    id, typeId, params }
 *     { type: 'removeNode', id }
 *     { type: 'connect',    srcId, srcOutlet, dstId, dstInlet }
 *     { type: 'disconnect', srcId, srcOutlet, dstId, dstInlet }
 *     { type: 'setParam',   nodeId, paramId, value }
 *     { type: 'masterGain', value }
 *   Worklet → Main:
 *     { type: 'ready' }
 *     { type: 'error', message }
 */

import createDaisySP from '../wasm/daisysp.js';

// ── Module state ──────────────────────────────────────────────────────────────
let dsp       = null;
let dspReady  = false;

// Create the WASM instance immediately (top-level async)
const wasmInit = createDaisySP().then(m => {
  dsp      = m;
  dspReady = true;
}).catch(err => {
  console.error('[DspProcessor] WASM init failed:', err);
});

// ── Processor implementation ─────────────────────────────────────────────────
class DspProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super(options);

    this.nodes         = new Map();   // id → {handle, numOutlets, outValues}
    this.connections   = [];          // [{srcId, srcOutlet, dstId, dstInlet}]
    this.topoOrder     = [];
    this.inletSources  = new Map();   // `${nodeId}:${inlet}` → {srcId, srcOutlet}
    this.masterGain    = 0.7;
    this.pendingMsgs   = [];          // queued until dsp is ready

    // Add permanent output node (has no WASM handle)
    this._addSpecialNode('output');

    this.port.onmessage = (e) => this._handleMessage(e.data);

    // Signal main thread when WASM is ready
    wasmInit.then(() => {
      // Drain any messages that arrived before WASM was ready
      for (const msg of this.pendingMsgs) this._dispatch(msg);
      this.pendingMsgs = [];
      this.port.postMessage({ type: 'ready' });
    }).catch(err => {
      this.port.postMessage({ type: 'error', message: String(err) });
    });
  }

  // ── Message dispatch ────────────────────────────────────────────────────────
  _handleMessage(msg) {
    if (!dspReady) { this.pendingMsgs.push(msg); return; }
    this._dispatch(msg);
  }

  _dispatch(msg) {
    switch (msg.type) {
      case 'addNode':      this._addNode(msg);                break;
      case 'removeNode':   this._removeNode(msg.id);          break;
      case 'connect':      this._connect(msg);                break;
      case 'disconnect':   this._disconnect(msg);             break;
      case 'setParam':     this._setParam(msg);               break;
      case 'masterGain':   this.masterGain = msg.value;       break;
      case 'clearAll':     this._clearAll();                  break;
    }
  }

  // ── Node management ─────────────────────────────────────────────────────────
  _addSpecialNode(id) {
    this.nodes.set(id, {
      id, handle: -1, numOutlets: 2, outValues: new Float32Array(2)
    });
    this._updateTopoOrder();
  }

  _addNode({ id, typeId, params, numOutlets }) {
    if (id === 'output' || id === 'input') {
      this._addSpecialNode(id);
      return;
    }
    if (!dsp) return;

    const handle = dsp._dsp_create(typeId, sampleRate);
    if (handle <= 0) {
      console.warn('[DspProcessor] dsp_create returned 0 for typeId', typeId);
      return;
    }

    // Apply initial parameter values
    if (params) {
      for (const { id: paramId, value } of params) {
        dsp._dsp_set_param(handle, paramId, value);
      }
    }

    this.nodes.set(id, {
      id, handle,
      numOutlets: numOutlets ?? 1,
      outValues: new Float32Array(8),
    });
    this._updateTopoOrder();
  }

  _removeNode(id) {
    const node = this.nodes.get(id);
    if (node?.handle > 0 && dsp) {
      dsp._dsp_destroy(node.handle);
    }
    this.nodes.delete(id);
    this.connections = this.connections.filter(
      c => c.srcId !== id && c.dstId !== id
    );
    this._updateTopoOrder();
  }

  _clearAll() {
    for (const [id, node] of this.nodes) {
      if (node.handle > 0 && dsp) dsp._dsp_destroy(node.handle);
    }
    this.nodes.clear();
    this.connections = [];
    this._addSpecialNode('output');
  }

  // ── Connection management ───────────────────────────────────────────────────
  _connect({ srcId, srcOutlet, dstId, dstInlet }) {
    // Each inlet accepts only one source; remove stale connections
    this.connections = this.connections.filter(
      c => !(c.dstId === dstId && c.dstInlet === dstInlet)
    );
    this.connections.push({ srcId, srcOutlet, dstId, dstInlet });
    this._updateTopoOrder();
  }

  _disconnect({ srcId, srcOutlet, dstId, dstInlet }) {
    this.connections = this.connections.filter(
      c => !(c.srcId === srcId && c.srcOutlet === srcOutlet &&
             c.dstId === dstId   && c.dstInlet === dstInlet)
    );
    this._updateTopoOrder();
  }

  _setParam({ nodeId, paramId, value }) {
    const node = this.nodes.get(nodeId);
    if (node?.handle > 0 && dsp) {
      dsp._dsp_set_param(node.handle, paramId, value);
    }
  }

  // ── Topological sort ─────────────────────────────────────────────────────────
  _updateTopoOrder() {
    const inDegree = new Map();
    const adj      = new Map();

    for (const id of this.nodes.keys()) {
      inDegree.set(id, 0);
      adj.set(id, []);
    }

    for (const c of this.connections) {
      if (!this.nodes.has(c.srcId) || !this.nodes.has(c.dstId)) continue;
      adj.get(c.srcId).push(c.dstId);
      inDegree.set(c.dstId, inDegree.get(c.dstId) + 1);
    }

    const queue = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const order = [];
    while (queue.length > 0) {
      const id = queue.shift();
      order.push(id);
      for (const next of adj.get(id) ?? []) {
        const d = inDegree.get(next) - 1;
        inDegree.set(next, d);
        if (d === 0) queue.push(next);
      }
    }

    // Ensure 'output' is last
    const withoutOut = order.filter(id => id !== 'output');
    this.topoOrder   = [...withoutOut, 'output'];

    // Pre-compute inlet source map for O(1) lookup during process
    this.inletSources = new Map();
    for (const c of this.connections) {
      this.inletSources.set(`${c.dstId}:${c.dstInlet}`, {
        srcId: c.srcId, srcOutlet: c.srcOutlet
      });
    }
  }

  _getInletVal(nodeId, inletIdx) {
    const src = this.inletSources.get(`${nodeId}:${inletIdx}`);
    if (!src) return 0;
    const srcNode = this.nodes.get(src.srcId);
    return srcNode ? (srcNode.outValues[src.srcOutlet] ?? 0) : 0;
  }

  // ── Audio processing ─────────────────────────────────────────────────────────
  process(inputs, outputs /*, parameters */) {
    const output     = outputs[0];
    const outL       = output[0];
    const outR       = output[1] ?? outL;
    const numSamples = outL?.length ?? 128;
    const hwL        = inputs[0]?.[0];
    const hwR        = inputs[0]?.[1] ?? hwL;

    if (!dspReady || !dsp || !outL) {
      // Output silence while loading
      if (outL) outL.fill(0);
      if (outR) outR.fill(0);
      return true;
    }

    for (let i = 0; i < numSamples; i++) {
      for (const nodeId of this.topoOrder) {
        const node = this.nodes.get(nodeId);
        if (!node) continue;

        // ── Special: input node reads from hardware ──
        if (nodeId === 'input') {
          node.outValues[0] = hwL?.[i] ?? 0;
          node.outValues[1] = hwR?.[i] ?? node.outValues[0];
          continue;
        }

        // ── Special: output node – gathered after loop ──
        if (nodeId === 'output') continue;

        // ── Standard WASM node ──
        const in0  = this._getInletVal(nodeId, 0); // primary audio
        const in1  = this._getInletVal(nodeId, 1); // secondary audio
        const trig = this._getInletVal(nodeId, 2); // trigger / gate

        node.outValues[0] = dsp._dsp_tick(node.handle, in0, in1, trig);

        // Read extra outlets only for modules that have them
        if (node.numOutlets > 1) {
          for (let k = 1; k < node.numOutlets; k++) {
            node.outValues[k] = dsp._dsp_get_outlet(node.handle, k);
          }
        }
      }

      // Write to hardware output
      const left  = this._getInletVal('output', 0);
      const right = this._getInletVal('output', 1);
      outL[i] = left * this.masterGain;
      outR[i] = (this.inletSources.has('output:1') ? right : 0) * this.masterGain;
    }

    return true;
  }
}

registerProcessor('dsp-processor', DspProcessor);
