# WasmPatcher: Browser-based DSP Patching with DaisySP + WebAssembly

A MaxMSP-inspired node patcher that runs [DaisySP](https://github.com/electro-smith/DaisySP) DSP modules live in the browser via [WebAssembly](https://webassembly.org/) and the [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API). Build and connect synthesizers, filters, effects, and drum modules in real time — no plugins, no installs, just a browser.

## Quick Start

1. Install [Emscripten](https://emscripten.org/docs/getting_started/downloads.html) and make sure `emcc` is on your PATH.

2. Clone this repository with submodules:
   ```bash
   git clone --recurse-submodules https://github.com/jaffco/WasmPatcher
   cd wasm-patcher
   ```
   
3. Compile DaisySP to WebAssembly:
   ```bash
   ./build.sh
   ```

4. Serve the site locally:
   ```bash
   ./serve.sh
   ```

5. Open [http://localhost:8080](http://localhost:8080) in your browser.

> [!NOTE]
> The Web Audio API requires a user gesture before audio can start. Click **▶ Start Audio** in the toolbar before interacting with the patcher.

## Using the Patcher

| Action | How |
|---|---|
| Add a node | Right-click the canvas → select a module |
| Connect nodes | Drag from an outlet (bottom, amber) to an inlet (top, teal) |
| Delete a cable | Double-click it |
| Remove a node | Select it and press **Delete** |
| Pan the canvas | Scroll or drag the background |

Every patch needs at least one **Input** and one **Output** node — these appear in the *IO* category and bridge the patcher graph to the Web Audio API.

## Project Structure

```
wasm-patcher/
├── build.sh                  # Compiles DaisySP → site/wasm/daisysp.js
├── serve.sh                  # Serves site/ on localhost:8080
├── daisySP/                  # DaisySP submodule (electro-smith/DaisySP)
├── wasm/
│   └── src/
│       └── daisysp_wrapper.cpp   # Unified C API exported to JS
└── site/                     # Static web application
    ├── index.html
    ├── css/style.css
    ├── js/
    │   ├── app.js            # Canvas patcher UI and state
    │   ├── dsp-processor.js  # AudioWorklet — runs WASM in the audio thread
    │   └── module-registry.js  # Module definitions (type IDs, params, I/O)
    └── wasm/
        └── daisysp.js        # Built output — WASM binary inlined (SINGLE_FILE)
```

## How It Works

The build step uses `emcc` to compile the entire DaisySP source tree together with `daisysp_wrapper.cpp` into a single self-contained ES6 module (`daisysp.js`) with the WASM binary inlined. No separate `.wasm` fetch is needed.

At runtime, the site loads `daisysp.js` inside an [AudioWorklet](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorklet), keeping all DSP off the main thread. The patcher UI communicates with the worklet via `MessagePort`, sending graph topology changes and parameter updates as plain JSON messages. The worklet topologically sorts the node graph each time the connection graph changes and processes each node in order every audio block.

The C API (`dsp_create`, `dsp_tick`, `dsp_set_param`, …) is a thin wrapper over DaisySP's object model that assigns integer handles to heap-allocated module instances, making it straightforward to call from JS via Emscripten's `cwrap`.

## Available Modules

| Category | Modules |
|---|---|
| **Synthesis** | Oscillator, FM2, VariableShapeOsc, ZOscillator, FormantOsc |
| **Filters** | SVF, Ladder, OnePole |
| **Effects** | Overdrive, Chorus, Phaser, Flanger, Tremolo, Wavefolder, Decimator, SampleRateReducer, AutoWah |
| **Drums** | AnalogBassDrum, AnalogSnareDrum, SynthBassDrum, SynthSnareDrum, HiHat |
| **Physical Modeling** | KarplusString |
| **Control** | ADSR, AD Envelope, Phasor |
| **Noise** | WhiteNoise |
| **Utility** | DC Block, Crossfade |
| **IO** | Input, Output |

## Dependencies

- **[Emscripten](https://emscripten.org/)** — WASM compilation toolchain
- **[DaisySP](https://github.com/electro-smith/DaisySP)** — DSP module library (included as a submodule)
- **Python 3** — only needed if serving the site locally with `serve.sh`

A modern browser with Web Audio API + AudioWorklet support is required (Chrome, Edge, or Firefox 76+).

## Troubleshooting

**`emcc: command not found`**
- Source the Emscripten environment: `source /path/to/emsdk/emsdk_env.sh`

**No audio / "AudioContext suspended"**
- Click **▶ Start Audio** in the toolbar. Browsers block audio until a user gesture.

**Build errors about missing headers**
- Make sure the `daisySP` submodule is initialized: `git submodule update --init --recursive`

**`daisysp.js` is stale after editing `daisysp_wrapper.cpp`**
- Re-run `./build.sh`. The output file is not tracked by git.
