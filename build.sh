#!/usr/bin/env bash
# Build DaisySP modules to WebAssembly
# Tested with Emscripten 4.0.14 — output is committed to site/wasm/ so
# end-users only need ./serve.sh. Re-run this script after modifying
# daisysp_wrapper.cpp or pulling DaisySP submodule updates.
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DAISY_SRC="$SCRIPT_DIR/daisySP/Source"
WRAPPER_SRC="$SCRIPT_DIR/wasm/src/daisysp_wrapper.cpp"
OUT_DIR="$SCRIPT_DIR/site/wasm"

mkdir -p "$OUT_DIR"

echo "▶ Building DaisySP → WebAssembly..."
echo "  Source:  $DAISY_SRC"
echo "  Output:  $OUT_DIR"

# All DaisySP .cpp files (matches CMakeLists.txt)
DAISY_CPPS=(
  "$DAISY_SRC/Control/adenv.cpp"
  "$DAISY_SRC/Control/adsr.cpp"
  "$DAISY_SRC/Control/phasor.cpp"
  "$DAISY_SRC/Drums/analogbassdrum.cpp"
  "$DAISY_SRC/Drums/analogsnaredrum.cpp"
  "$DAISY_SRC/Drums/hihat.cpp"
  "$DAISY_SRC/Drums/synthbassdrum.cpp"
  "$DAISY_SRC/Drums/synthsnaredrum.cpp"
  "$DAISY_SRC/Dynamics/crossfade.cpp"
  "$DAISY_SRC/Dynamics/limiter.cpp"
  "$DAISY_SRC/Effects/autowah.cpp"
  "$DAISY_SRC/Effects/chorus.cpp"
  "$DAISY_SRC/Effects/decimator.cpp"
  "$DAISY_SRC/Effects/flanger.cpp"
  "$DAISY_SRC/Effects/overdrive.cpp"
  "$DAISY_SRC/Effects/phaser.cpp"
  "$DAISY_SRC/Effects/sampleratereducer.cpp"
  "$DAISY_SRC/Effects/tremolo.cpp"
  "$DAISY_SRC/Effects/wavefolder.cpp"
  "$DAISY_SRC/Filters/ladder.cpp"
  "$DAISY_SRC/Filters/svf.cpp"
  "$DAISY_SRC/Filters/soap.cpp"
  "$DAISY_SRC/Noise/clockednoise.cpp"
  "$DAISY_SRC/Noise/grainlet.cpp"
  "$DAISY_SRC/Noise/particle.cpp"
  "$DAISY_SRC/PhysicalModeling/drip.cpp"
  "$DAISY_SRC/PhysicalModeling/modalvoice.cpp"
  "$DAISY_SRC/PhysicalModeling/resonator.cpp"
  "$DAISY_SRC/PhysicalModeling/KarplusString.cpp"
  "$DAISY_SRC/PhysicalModeling/stringvoice.cpp"
  "$DAISY_SRC/Sampling/granularplayer.cpp"
  "$DAISY_SRC/Synthesis/fm2.cpp"
  "$DAISY_SRC/Synthesis/formantosc.cpp"
  "$DAISY_SRC/Synthesis/oscillator.cpp"
  "$DAISY_SRC/Synthesis/oscillatorbank.cpp"
  "$DAISY_SRC/Synthesis/variablesawosc.cpp"
  "$DAISY_SRC/Synthesis/variableshapeosc.cpp"
  "$DAISY_SRC/Synthesis/vosim.cpp"
  "$DAISY_SRC/Synthesis/zoscillator.cpp"
  "$DAISY_SRC/Utility/dcblock.cpp"
  "$DAISY_SRC/Utility/metro.cpp"
)

EXPORTED_FUNS=(
  "_dsp_create"
  "_dsp_destroy"
  "_dsp_tick"
  "_dsp_get_outlet"
  "_dsp_set_param"
  "_dsp_process_block"
  "_dsp_num_types"
  "_malloc"
  "_free"
)

# Convert array to JSON list
EXPORT_JSON=$(printf '"%s",' "${EXPORTED_FUNS[@]}" | sed 's/,$//')
EXPORT_JSON="[$EXPORT_JSON]"

emcc \
  -O2 \
  -std=c++14 \
  -I "$DAISY_SRC" \
  -I "$DAISY_SRC/Control" \
  -I "$DAISY_SRC/Drums" \
  -I "$DAISY_SRC/Dynamics" \
  -I "$DAISY_SRC/Effects" \
  -I "$DAISY_SRC/Filters" \
  -I "$DAISY_SRC/Noise" \
  -I "$DAISY_SRC/PhysicalModeling" \
  -I "$DAISY_SRC/Sampling" \
  -I "$DAISY_SRC/Synthesis" \
  -I "$DAISY_SRC/Utility" \
  -fno-exceptions \
  "$WRAPPER_SRC" \
  "${DAISY_CPPS[@]}" \
  -s WASM=1 \
  -s MODULARIZE=1 \
  -s EXPORT_NAME='DaisySP' \
  -s EXPORT_ES6=1 \
  -s SINGLE_FILE=1 \
  -s "EXPORTED_FUNCTIONS=$EXPORT_JSON" \
  -s EXPORTED_RUNTIME_METHODS='["cwrap","getValue","setValue","HEAPF32","HEAP32"]' \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=33554432 \
  -s NO_EXIT_RUNTIME=1 \
  -s ASSERTIONS=0 \
  -s ENVIRONMENT='web,worker' \
  -o "$OUT_DIR/daisysp.js"

echo "✓ Build successful! (WASM inlined via SINGLE_FILE=1)"
echo "  $OUT_DIR/daisysp.js"