/**
 * WasmPatcher – Main Application
 * MaxMSP-inspired canvas patcher with real-time DSP via AudioWorklet + WASM
 */
import {
  MODULES, MODULE_BY_TYPEID, CATEGORIES, CATEGORY_COLORS, T, MODULE_BY_ID
} from './module-registry.js';

// ── Visual constants ──────────────────────────────────────────────────────────
const NODE_W     = 190;
const TITLE_H    = 28;
const PORT_H     = 16;   // height of port strip
const PARAM_H    = 26;   // height per param row
const PORT_R     = 6;    // port circle radius
const GRID       = 24;

const C = {
  BG:         '#0e0e1a',
  GRID:       '#17172a',
  NODE:       '#181828',
  NODE_EDGE:  '#2a2a40',
  TEXT:       '#dce8f3',
  TEXT_DIM:   '#6080a0',
  SEL:        '#00d4ff',
  PORT_IN:    '#38ffd0',
  PORT_OUT:   '#ffc553',
  CABLE_DEF:  '#3a5a8a',
  SLIDER_TR:  '#1e2840',
  SLIDER_FG:  '#2a4a7a',
  WARN:       '#ff6b6b',
};

// ── Node geometry helpers ─────────────────────────────────────────────────────
function nodeHeight(spec) {
  return TITLE_H + PORT_H + spec.params.length * PARAM_H + PORT_H + 4;
}

function inletPos(spec, node, i) {
  const n = spec.inlets.length;
  return { x: node.x + NODE_W * (i + 1) / (n + 1), y: node.y };
}

function outletPos(spec, node, i) {
  const n = spec.outlets.length;
  return { x: node.x + NODE_W * (i + 1) / (n + 1), y: node.y + nodeHeight(spec) };
}

// ── Utility ────────────────────────────────────────────────────────────────────
let _uid = 1;
const uid = () => `n${_uid++}`;

function lerp(a, b, t) { return a + (b - a) * t; }

function fmtValue(p, v) {
  if (p.labels) return p.labels[Math.round(v)] ?? v;
  if (p.unit === 'Hz') {
    if (v >= 1000) return (v / 1000).toFixed(2) + 'kHz';
    return v.toFixed(1) + 'Hz';
  }
  if (p.unit === 's')  return v.toFixed(3) + 's';
  return v.toFixed(2) + (p.unit ? ' ' + p.unit : '');
}

// Normalize value to 0-1 range (log or linear)
function norm(p, v) {
  if (p.log) return Math.log(v / p.min) / Math.log(p.max / p.min);
  return (v - p.min) / (p.max - p.min);
}

// Denormalize 0-1 back to param range
function denorm(p, t) {
  t = Math.max(0, Math.min(1, t));
  let v = p.log
    ? p.min * Math.pow(p.max / p.min, t)
    : p.min + t * (p.max - p.min);
  if (p.step !== undefined) v = Math.round(v / p.step) * p.step;
  return Math.max(p.min, Math.min(p.max, v));
}

// ── Patcher state ─────────────────────────────────────────────────────────────
class Patcher {
  constructor(canvas, port) {
    this.canvas = canvas;
    this.ctx    = canvas.getContext('2d');
    this.port   = port;           // AudioWorkletNode port (or null)
    this.nodes  = new Map();      // id → patcher node object
    this.conns  = [];             // [{srcId, srcOutlet, dstId, dstInlet}]
    this.offset = { x: 0, y: 0 };
    this.drag   = null;
    this.hover  = null;           // {nodeId, part, idx}
    this.menu   = null;           // context menu state

    this._resizeObs = new ResizeObserver(() => this._resize());
    this._resizeObs.observe(canvas.parentElement);
    this._resize();

    canvas.addEventListener('mousedown',   e => this._onMouseDown(e));
    canvas.addEventListener('mousemove',   e => this._onMouseMove(e));
    canvas.addEventListener('mouseup',     e => this._onMouseUp(e));
    canvas.addEventListener('contextmenu', e => this._onContextMenu(e));
    canvas.addEventListener('dblclick',    e => this._onDblClick(e));
    window.addEventListener('keydown',     e => this._onKeyDown(e));
    window.addEventListener('mouseup',     () => { if (this.drag) { this.drag = null; this.hover = null; this.render(); }});
    canvas.addEventListener('wheel',       e => this._onWheel(e), { passive: true });

    // Add the permanent output node
    this.addNode(T.OUTPUT, 'output', canvas.width / 2 - NODE_W / 2, canvas.height / 2 - 40);
    this.render();
  }

  // ── Resize ──────────────────────────────────────────────────────────────────
  _resize() {
    const p = this.canvas.parentElement;
    this.canvas.width  = p.clientWidth;
    this.canvas.height = p.clientHeight;
    this.render();
  }

  // ── Coordinate conversion ────────────────────────────────────────────────────
  _toWorld(ex, ey) {
    const r = this.canvas.getBoundingClientRect();
    return { x: ex - r.left - this.offset.x, y: ey - r.top - this.offset.y };
  }

  // ── Node management ──────────────────────────────────────────────────────────
  addNode(typeId, forcedId, x, y) {
    const spec = MODULE_BY_TYPEID.get(typeId);
    if (!spec) { console.warn('Unknown typeId', typeId); return null; }

    const id     = forcedId ?? uid();
    const params = spec.params.map(p => ({ id: p.id, value: p.default, spec: p }));
    const node   = { id, typeId, spec, x, y, params, selected: false };
    this.nodes.set(id, node);

    if (this.port) {
      this.port.postMessage({
        type: 'addNode', id, typeId,
        numOutlets: spec.numOutlets,
        params: params.map(p => ({ id: p.id, value: p.value })),
      });
    }
    this.render();
    return node;
  }

  removeNode(id) {
    if (id === 'output') return; // never remove output
    this.conns = this.conns.filter(c => c.srcId !== id && c.dstId !== id);
    this.nodes.delete(id);
    if (this.port) this.port.postMessage({ type: 'removeNode', id });
    this.render();
  }

  connect(srcId, srcOutlet, dstId, dstInlet) {
    // Remove any existing connection to this inlet
    this.conns = this.conns.filter(
      c => !(c.dstId === dstId && c.dstInlet === dstInlet)
    );
    this.conns.push({ srcId, srcOutlet, dstId, dstInlet });
    if (this.port) this.port.postMessage({ type: 'connect', srcId, srcOutlet, dstId, dstInlet });
    this.render();
  }

  disconnect(srcId, srcOutlet, dstId, dstInlet) {
    this.conns = this.conns.filter(
      c => !(c.srcId === srcId && c.srcOutlet === srcOutlet &&
             c.dstId === dstId   && c.dstInlet === dstInlet)
    );
    if (this.port) this.port.postMessage({ type: 'disconnect', srcId, srcOutlet, dstId, dstInlet });
    this.render();
  }

  setParam(nodeId, paramId, value) {
    const node = this.nodes.get(nodeId);
    if (!node) return;
    const pmeta = node.params.find(p => p.id === paramId);
    if (pmeta) pmeta.value = value;
    if (this.port) this.port.postMessage({ type: 'setParam', nodeId, paramId, value });
    this.render();
  }

  // Sync full graph to worklet (called when worklet becomes ready)
  syncToWorklet(port) {
    this.port = port;
    for (const [id, node] of this.nodes) {
      port.postMessage({
        type: 'addNode', id, typeId: node.typeId,
        numOutlets: node.spec.numOutlets,
        params: node.params.map(p => ({ id: p.id, value: p.value })),
      });
    }
    for (const c of this.conns) {
      port.postMessage({ type: 'connect', ...c });
    }
  }

  // ── Hit testing ────────────────────────────────────────────────────────────
  _hitPort(wx, wy) {
    for (const [id, node] of this.nodes) {
      const spec = node.spec;
      // Inlets
      for (let i = 0; i < spec.inlets.length; i++) {
        const p = inletPos(spec, node, i);
        if (Math.hypot(wx - p.x, wy - p.y) <= PORT_R + 3)
          return { nodeId: id, type: 'inlet', idx: i };
      }
      // Outlets
      for (let i = 0; i < spec.outlets.length; i++) {
        const p = outletPos(spec, node, i);
        if (Math.hypot(wx - p.x, wy - p.y) <= PORT_R + 3)
          return { nodeId: id, type: 'outlet', idx: i };
      }
    }
    return null;
  }

  _hitNode(wx, wy) {
    // Iterate in reverse so top-painted node is hit first
    const ids = [...this.nodes.keys()].reverse();
    for (const id of ids) {
      const n = this.nodes.get(id);
      const h = nodeHeight(n.spec);
      if (wx >= n.x && wx <= n.x + NODE_W && wy >= n.y && wy <= n.y + h)
        return n;
    }
    return null;
  }

  _hitParam(node, wx, wy) {
    const top = node.y + TITLE_H + PORT_H;
    for (let i = 0; i < node.params.length; i++) {
      const py = top + i * PARAM_H;
      const sliderX = node.x + 70;
      const sliderW = NODE_W - 80;
      if (wx >= sliderX && wx <= sliderX + sliderW &&
          wy >= py + 4   && wy <= py + PARAM_H - 4) {
        return i;
      }
    }
    return -1;
  }

  _hitConn(wx, wy) {
    for (let ci = 0; ci < this.conns.length; ci++) {
      const c   = this.conns[ci];
      const src = this.nodes.get(c.srcId);
      const dst = this.nodes.get(c.dstId);
      if (!src || !dst) continue;
      const sp = outletPos(src.spec, src, c.srcOutlet);
      const dp = inletPos(dst.spec, dst, c.dstInlet);
      // Sample bezier points
      const cy1 = sp.y + Math.abs(dp.y - sp.y) * 0.5;
      const cy2 = dp.y - Math.abs(dp.y - sp.y) * 0.5;
      for (let t = 0; t <= 1; t += 0.05) {
        const bx = Math.pow(1-t,3)*sp.x + 3*Math.pow(1-t,2)*t*sp.x +
                   3*(1-t)*t*t*dp.x     + t*t*t*dp.x;
        const by = Math.pow(1-t,3)*sp.y + 3*Math.pow(1-t,2)*t*cy1 +
                   3*(1-t)*t*t*cy2      + t*t*t*dp.y;
        if (Math.hypot(wx - bx, wy - by) < 6) return ci;
      }
    }
    return -1;
  }

  // ── Mouse events ────────────────────────────────────────────────────────────
  _onMouseDown(e) {
    if (e.button !== 0) {
      // Non-left click: let contextmenu event handle it; just close any open menu
      this.menu = null;
      this.render();
      return;
    }

    // If a context menu is open, handle the click on it instead of the canvas
    if (this.menu) {
      if (this._menuHoverId != null) {
        this.handleMenuClick(this._menuHoverId, this.menu.worldX, this.menu.worldY);
      } else {
        this.menu = null;
        this.render();
      }
      this._menuHoverId = undefined;
      return;
    }

    const { x: wx, y: wy } = this._toWorld(e.clientX, e.clientY);

    // Check ports first
    const port = this._hitPort(wx, wy);
    if (port) {
      if (port.type === 'outlet') {
        this.drag = { type: 'cable', srcId: port.nodeId, srcOutlet: port.idx, mx: wx, my: wy };
      } else {
        // Start cable drag from inlet (pulling existing connection)
        const existing = this.conns.findIndex(
          c => c.dstId === port.nodeId && c.dstInlet === port.idx
        );
        if (existing >= 0) {
          const c = this.conns[existing];
          this.disconnect(c.srcId, c.srcOutlet, c.dstId, c.dstInlet);
          this.drag = { type: 'cable', srcId: c.srcId, srcOutlet: c.srcOutlet, mx: wx, my: wy };
        }
      }
      this.render();
      return;
    }

    // Check nodes
    const node = this._hitNode(wx, wy);
    if (node) {
      // Check param slider
      const pi = this._hitParam(node, wx, wy);
      if (pi >= 0) {
        const pm    = node.params[pi];
        const slx   = node.x + 70;
        const slw   = NODE_W - 80;
        const normX = Math.max(0, Math.min(1, (wx - slx) / slw));
        const val   = denorm(pm.spec, normX);
        this.drag   = { type: 'param', nodeId: node.id, paramIdx: pi, startX: wx, startVal: pm.value };
        this.setParam(node.id, pm.id, val);
      } else {
        // Drag node
        if (!e.shiftKey) {
          for (const n of this.nodes.values()) n.selected = false;
        }
        node.selected = true;
        this.drag = { type: 'node', nodeId: node.id, dx: wx - node.x, dy: wy - node.y };
      }
      this.render();
      return;
    }

    // Click on background – deselect + start pan
    for (const n of this.nodes.values()) n.selected = false;
    this.drag = { type: 'pan', startX: e.clientX, startY: e.clientY,
                  ox: this.offset.x, oy: this.offset.y };
    this.render();
  }

  _onMouseMove(e) {
    // Always keep current screen coords up-to-date (needed for menu hover)
    const r = this.canvas.getBoundingClientRect();
    this._curScreenX = e.clientX - r.left;
    this._curScreenY = e.clientY - r.top;

    if (!this.drag) {
      // Update hover
      const { x: wx, y: wy } = this._toWorld(e.clientX, e.clientY);
      this.hover = this._hitPort(wx, wy);
      this.render();
      return;
    }

    const { x: wx, y: wy } = this._toWorld(e.clientX, e.clientY);

    if (this.drag.type === 'node') {
      const node = this.nodes.get(this.drag.nodeId);
      if (node) {
        node.x = wx - this.drag.dx;
        node.y = wy - this.drag.dy;
      }
    } else if (this.drag.type === 'cable') {
      this.drag.mx = wx;
      this.drag.my = wy;
      this.hover = this._hitPort(wx, wy);
    } else if (this.drag.type === 'param') {
      const node = this.nodes.get(this.drag.nodeId);
      if (node) {
        const pm   = node.params[this.drag.paramIdx];
        const slx  = node.x + 70;
        const slw  = NODE_W - 80;
        const normX = Math.max(0, Math.min(1, (wx - slx) / slw));
        const val   = denorm(pm.spec, normX);
        this.setParam(node.id, pm.id, val);
      }
    } else if (this.drag.type === 'pan') {
      this.offset.x = this.drag.ox + (e.clientX - this.drag.startX);
      this.offset.y = this.drag.oy + (e.clientY - this.drag.startY);
    }

    this.render();
  }

  _onMouseUp(e) {
    if (!this.drag) return;
    const { x: wx, y: wy } = this._toWorld(e.clientX, e.clientY);

    if (this.drag.type === 'cable') {
      const port = this._hitPort(wx, wy);
      if (port && port.type === 'inlet') {
        const { srcId, srcOutlet } = this.drag;
        // Prevent connecting to itself
        if (srcId !== port.nodeId) {
          this.connect(srcId, srcOutlet, port.nodeId, port.idx);
        }
      }
    }

    this.drag = null;
    this.render();
  }

  _onContextMenu(e) {
    e.preventDefault();
    const { x: wx, y: wy } = this._toWorld(e.clientX, e.clientY);
    const r = this.canvas.getBoundingClientRect();
    this.menu = {
      screenX: e.clientX - r.left,
      screenY: e.clientY - r.top,
      worldX:  wx,
      worldY:  wy,
    };
    this.render();
  }

  _onDblClick(e) {
    const { x: wx, y: wy } = this._toWorld(e.clientX, e.clientY);
    const ci = this._hitConn(wx, wy);
    if (ci >= 0) {
      const c = this.conns[ci];
      this.disconnect(c.srcId, c.srcOutlet, c.dstId, c.dstInlet);
    }
  }

  _onKeyDown(e) {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      if (document.activeElement !== document.body) return;
      for (const [id, node] of this.nodes) {
        if (node.selected) this.removeNode(id);
      }
    }
    if (e.key === 'Escape') {
      this.drag = null;
      this.menu = null;
      this.render();
    }
  }

  _onWheel(e) {
    this.offset.x -= e.deltaX;
    this.offset.y -= e.deltaY;
    this.render();
  }

  // ── Context menu click handling (called from outside) ─────────────────────
  handleMenuClick(typeId, worldX, worldY) {
    this.menu = null;
    const snap = v => Math.round(v / GRID) * GRID;
    this.addNode(typeId, null, snap(worldX), snap(worldY));
    this.render();
  }

  closeMenu() { this.menu = null; this.render(); }

  // ── Rendering ────────────────────────────────────────────────────────────────
  render() {
    const { canvas, ctx } = this;
    const W = canvas.width, H = canvas.height;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = C.BG;
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.fillStyle = C.GRID;
    const ox = ((this.offset.x % GRID) + GRID) % GRID;
    const oy = ((this.offset.y % GRID) + GRID) % GRID;
    for (let x = ox; x < W; x += GRID) {
      for (let y = oy; y < H; y += GRID) {
        ctx.fillRect(x - 1, y - 1, 2, 2);
      }
    }

    ctx.translate(this.offset.x, this.offset.y);

    // Connections
    for (const c of this.conns) {
      const src = this.nodes.get(c.srcId);
      const dst = this.nodes.get(c.dstId);
      if (!src || !dst) continue;
      const sp = outletPos(src.spec, src, c.srcOutlet);
      const dp = inletPos(dst.spec, dst, c.dstInlet);
      this._drawCable(sp.x, sp.y, dp.x, dp.y,
        CATEGORY_COLORS[src.spec.category] ?? C.CABLE_DEF, false);
    }

    // In-progress cable
    if (this.drag?.type === 'cable') {
      const src = this.nodes.get(this.drag.srcId);
      if (src) {
        const sp = outletPos(src.spec, src, this.drag.srcOutlet);
        this._drawCable(sp.x, sp.y, this.drag.mx, this.drag.my,
          CATEGORY_COLORS[src.spec.category] ?? C.SEL, true);
      }
    }

    // Nodes
    for (const node of this.nodes.values()) {
      this._drawNode(node);
    }

    // Empty-state hint
    if (this.nodes.size <= 1) {
      ctx.resetTransform();
      ctx.fillStyle = 'rgba(100,130,180,0.18)';
      ctx.font = '16px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('Right-click to add nodes', W / 2, H / 2 + 70);
      ctx.textAlign = 'left';
    }

    ctx.resetTransform();

    // Context menu (drawn in screen space)
    if (this.menu) this._drawMenu(this.menu);
  }

  _drawCable(x1, y1, x2, y2, color, dashed) {
    const { ctx } = this;
    const dy  = Math.abs(y2 - y1);
    const cy1 = y1 + dy * 0.5;
    const cy2 = y2 - dy * 0.5;
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.bezierCurveTo(x1, cy1, x2, cy2, x2, y2);
    ctx.strokeStyle = color;
    ctx.lineWidth   = 2.5;
    ctx.globalAlpha = dashed ? 0.6 : 0.85;
    if (dashed) ctx.setLineDash([6, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.globalAlpha = 1;
  }

  _drawNode(node) {
    const { ctx }  = this;
    const { x, y } = node;
    const h        = nodeHeight(node.spec);
    const catColor = CATEGORY_COLORS[node.spec.category] ?? '#3a5a8a';
    const isIO     = node.spec.category === 'IO';

    // Drop shadow
    ctx.shadowColor  = node.selected ? C.SEL : 'rgba(0,0,0,0.5)';
    ctx.shadowBlur   = node.selected ? 14 : 8;
    ctx.shadowOffsetY = 3;

    // Node body
    const r = 6;
    ctx.beginPath();
    ctx.roundRect(x, y, NODE_W, h, r);
    ctx.fillStyle = C.NODE;
    ctx.fill();
    ctx.strokeStyle = node.selected ? C.SEL : C.NODE_EDGE;
    ctx.lineWidth   = node.selected ? 1.5 : 1;
    ctx.stroke();
    ctx.shadowBlur  = 0;
    ctx.shadowOffsetY = 0;

    // Title bar
    ctx.beginPath();
    ctx.roundRect(x, y, NODE_W, TITLE_H, [r, r, 0, 0]);
    ctx.fillStyle = catColor + (isIO ? 'dd' : 'bb');
    ctx.fill();

    // Title text
    ctx.fillStyle = isIO ? '#e8f0ff' : C.TEXT;
    ctx.font      = 'bold 12px "SF Mono", "Fira Code", monospace';
    ctx.textAlign = 'center';
    ctx.fillText(node.spec.label, x + NODE_W / 2, y + TITLE_H / 2 + 5, NODE_W - 12);
    ctx.textAlign = 'left';

    // Params
    const paramTop = y + TITLE_H + PORT_H;
    for (let i = 0; i < node.params.length; i++) {
      const pm  = node.params[i];
      const py  = paramTop + i * PARAM_H + 3;
      const slx = x + 68;
      const slw = NODE_W - 76;

      // Label
      ctx.fillStyle = C.TEXT_DIM;
      ctx.font      = '10px "SF Mono", monospace';
      ctx.fillText(pm.spec.name, x + 6, py + 14, 60);

      // Slider track
      ctx.fillStyle = C.SLIDER_TR;
      ctx.beginPath();
      ctx.roundRect(slx, py + 6, slw, 8, 3);
      ctx.fill();

      // Slider fill
      const n = norm(pm.spec, pm.value);
      ctx.fillStyle = catColor + 'cc';
      ctx.beginPath();
      ctx.roundRect(slx, py + 6, slw * n, 8, 3);
      ctx.fill();

      // Value
      ctx.fillStyle   = C.TEXT;
      ctx.font        = '10px "SF Mono", monospace';
      ctx.textAlign   = 'right';
      ctx.fillText(fmtValue(pm.spec, pm.value), x + NODE_W - 3, py + 14, 50);
      ctx.textAlign   = 'left';
    }

    // Ports
    this._drawPorts(node, catColor);
  }

  _drawPorts(node, catColor) {
    const { ctx } = this;
    const spec = node.spec;

    // Inlets
    for (let i = 0; i < spec.inlets.length; i++) {
      const p    = inletPos(spec, node, i);
      const hot  = this.hover?.nodeId === node.id &&
                   this.hover?.type   === 'inlet'  &&
                   this.hover?.idx    === i;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PORT_R + (hot ? 2 : 0), 0, Math.PI * 2);
      ctx.fillStyle   = hot ? C.SEL : C.PORT_IN;
      ctx.fill();
      ctx.strokeStyle = C.NODE;
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      // Tooltip label
      if (hot || spec.inlets.length <= 3) {
        ctx.fillStyle = C.TEXT_DIM;
        ctx.font      = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(spec.inlets[i].label, p.x, p.y - PORT_R - 3);
        ctx.textAlign = 'left';
      }
    }

    // Outlets
    for (let i = 0; i < spec.outlets.length; i++) {
      const p    = outletPos(spec, node, i);
      const hot  = this.hover?.nodeId === node.id &&
                   this.hover?.type   === 'outlet' &&
                   this.hover?.idx    === i;
      ctx.beginPath();
      ctx.arc(p.x, p.y, PORT_R + (hot ? 2 : 0), 0, Math.PI * 2);
      ctx.fillStyle   = hot ? C.SEL : C.PORT_OUT;
      ctx.fill();
      ctx.strokeStyle = C.NODE;
      ctx.lineWidth   = 1.5;
      ctx.stroke();

      if (hot || spec.outlets.length <= 5) {
        ctx.fillStyle = C.TEXT_DIM;
        ctx.font      = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(spec.outlets[i].label, p.x, p.y + PORT_R + 11);
        ctx.textAlign = 'left';
      }
    }
  }

  _drawMenu({ screenX, screenY, worldX, worldY }) {
    const { ctx, canvas } = this;
    const itemH  = 24;
    const itemW  = 200;
    const catPad = 8;

    // Reset hover id so stale value isn't used when mouse is between items
    this._menuHoverId = undefined;

    // Group modules by category
    const cats = new Map();
    for (const mod of MODULES) {
      if (mod.typeId === T.OUTPUT) continue; // output already exists
      if (!cats.has(mod.category)) cats.set(mod.category, []);
      cats.get(mod.category).push(mod);
    }

    // Measure
    let totalH = catPad;
    for (const [cat, mods] of cats) {
      totalH += itemH + mods.length * itemH + catPad;
    }
    const mX = Math.min(screenX, canvas.width  - itemW  - 4);
    const mY = Math.min(screenY, canvas.height - totalH - 4);

    // Background
    ctx.fillStyle = '#131828ee';
    ctx.strokeStyle = '#2a3a5a';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(mX, mY, itemW, totalH, 6);
    ctx.fill();
    ctx.stroke();

    let curY = mY + catPad;

    for (const [cat, mods] of cats) {
      const catColor = CATEGORY_COLORS[cat] ?? '#4a6080';

      // Category header
      ctx.fillStyle = catColor + '44';
      ctx.fillRect(mX + 2, curY, itemW - 4, itemH);
      ctx.fillStyle = catColor;
      ctx.font      = 'bold 11px "SF Mono", monospace';
      ctx.textAlign = 'left';
      ctx.fillText(cat.toUpperCase(), mX + 10, curY + 16);
      curY += itemH;

      for (const mod of mods) {
        const isHovered = this._menuHover(
          this._curScreenX ?? -1, this._curScreenY ?? -1,
          mX, curY, itemW, itemH);
        if (isHovered) {
          ctx.fillStyle = '#2a3d5a';
          ctx.fillRect(mX + 2, curY, itemW - 4, itemH);
          // Store hovered action for click handler
          this._menuHoverId = mod.typeId;
          this._menuHoverY  = curY;
        }
        ctx.fillStyle = isHovered ? C.TEXT : C.TEXT_DIM;
        ctx.font      = '11px "SF Mono", monospace';
        ctx.fillText('  ' + mod.label, mX + 10, curY + 16);
        curY += itemH;
      }
      curY += catPad;
    }
    ctx.textAlign = 'left';
  }

  _menuHover(mx, my, itemX, itemY, itemW, itemH) {
    return mx >= itemX && mx <= itemX + itemW &&
           my >= itemY && my <= itemY + itemH;
  }
}

// ── App bootstrap ─────────────────────────────────────────────────────────────
class App {
  constructor() {
    this.patcher    = null;
    this.audioCtx   = null;
    this.workletNode = null;
    this.masterGain = 0.7;

    this._buildUI();
  }

  _buildUI() {
    const canvas = document.getElementById('patcher-canvas');
    this.patcher = new Patcher(canvas, null);

    // Canvas click handler for context menu item selection
    canvas.addEventListener('click', e => this._onCanvasClick(e));

    // toolbar
    document.getElementById('btn-start').addEventListener('click', () => this._startAudio());
    document.getElementById('gain-slider').addEventListener('input', e => {
      this.masterGain = +e.target.value;
      document.getElementById('gain-display').textContent =
        Math.round(this.masterGain * 100) + '%';
      if (this.workletNode)
        this.workletNode.port.postMessage({ type: 'masterGain', value: this.masterGain });
    });

    document.getElementById('btn-clear').addEventListener('click', () => this._clearPatch());
  }

  _onCanvasClick(e) {
    if (!this.patcher.menu) return;
    e.preventDefault();

    const r = e.target.getBoundingClientRect();
    const sx = e.clientX - r.left;
    const sy = e.clientY - r.top;
    const typeId = this.patcher._menuHoverId;

    if (typeId !== undefined) {
      this.patcher.handleMenuClick(
        typeId, this.patcher.menu.worldX, this.patcher.menu.worldY
      );
    } else {
      this.patcher.closeMenu();
    }
    this.patcher._menuHoverId = undefined;
  }

  async _startAudio() {
    if (this.audioCtx) {
      const btn    = document.getElementById('btn-start');
      const status = document.getElementById('status');
      if (this.audioCtx.state === 'running') {
        await this.audioCtx.suspend();
        btn.textContent = '▶ Start Audio';
        status.textContent = '● Audio Stopped';
        status.className = '';
      } else if (this.audioCtx.state === 'suspended') {
        await this.audioCtx.resume();
        btn.textContent = '⏸ Stop Audio';
        status.textContent = '● Audio Running';
        status.className = 'status-ok';
      }
      return;
    }

    const btn = document.getElementById('btn-start');
    btn.textContent = 'Loading…';
    btn.disabled = true;

    try {
      this.audioCtx = new AudioContext({ sampleRate: 48000 });

      await this.audioCtx.audioWorklet.addModule('./js/dsp-processor.js', { type: 'module' });
      this.workletNode = new AudioWorkletNode(this.audioCtx, 'dsp-processor', {
        numberOfInputs:  1,
        numberOfOutputs: 1,
        outputChannelCount: [2],
      });
      this.workletNode.connect(this.audioCtx.destination);

      this.workletNode.port.onmessage = (e) => {
        if (e.data.type === 'ready') {
          this.patcher.syncToWorklet(this.workletNode.port);
          btn.textContent = '⏸ Stop Audio';
          btn.disabled = false;
          document.getElementById('status').textContent = '● Audio Running';
          document.getElementById('status').className = 'status-ok';
        } else if (e.data.type === 'error') {
          console.error('[Worklet]', e.data.message);
          btn.textContent = '▶ Start Audio';
          btn.disabled = false;
          document.getElementById('status').textContent = '✖ Error: ' + e.data.message;
        }
      };
    } catch (err) {
      console.error('Audio init failed:', err);
      btn.textContent = '▶ Start Audio';
      btn.disabled = false;
    }
  }

  _clearPatch() {
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'clearAll' });
    }
    // Rebuild patcher with just output node
    const canvas = document.getElementById('patcher-canvas');
    this.patcher = new Patcher(canvas, this.workletNode?.port ?? null);
    if (this.workletNode) {
      this.patcher.syncToWorklet(this.workletNode.port);
    }
  }
}

// ── Start ──────────────────────────────────────────────────────────────────────
const app = new App();
