/**
 * DaisySP Module Registry
 * Defines every module's type ID, inlets, outlets, and parameters.
 *
 * Inlet mapping to dsp_tick() args:
 *   UI inlet index 0 → audio_in
 *   UI inlet index 1 → audio_in2
 *   UI inlet index 2 → trigger
 *
 * Outlet 0 = primary (dsp_tick return value)
 * Outlet 1-7 = dsp_get_outlet(handle, k)
 */

// ── Type ID constants (must match daisysp_wrapper.cpp enum) ──────────────────
export const T = {
  OSCILLATOR:          0,
  ADSR:                1,
  AD_ENV:              2,
  PHASOR:              3,
  SVF:                 4,
  LADDER:              5,
  ONE_POLE:            6,
  OVERDRIVE:           7,
  CHORUS:              8,
  PHASER:              9,
  TREMOLO:             10,
  WAVEFOLDER:          11,
  DECIMATOR:           12,
  WHITE_NOISE:         13,
  ANALOG_BASS_DRUM:    14,
  ANALOG_SNARE_DRUM:   15,
  SYNTH_BASS_DRUM:     16,
  SYNTH_SNARE_DRUM:    17,
  HIHAT:               18,
  KARPLUS_STRING:      19,
  FM2:                 20,
  DC_BLOCK:            21,
  AUTO_WAH:            22,
  FLANGER:             23,
  VARIABLE_SHAPE_OSC:  24,
  SAMPLE_RATE_REDUCER: 25,
  Z_OSCILLATOR:        26,
  FORMANT_OSC:         27,
  CROSSFADE:           28,
  // Special (not in WASM)
  INPUT:               -1,
  OUTPUT:              -2,
};

// ── Category colour palette ───────────────────────────────────────────────────
export const CATEGORY_COLORS = {
  Synthesis:       '#e94560',
  Filters:         '#7b2d8b',
  Effects:         '#0e7c7b',
  Drums:           '#c84b31',
  Noise:           '#2d7a4f',
  Control:         '#c8961a',
  Utility:         '#2a6a9e',
  PhysicalModeling:'#6a3d9a',
  IO:              '#2e4057',
};

// ── Helpers for param specs ───────────────────────────────────────────────────
const p = (id, name, min, max, def, extra = {}) =>
  ({ id, name, min, max, default: def, ...extra });
const pLog = (id, name, min, max, def, extra = {}) =>
  p(id, name, min, max, def, { log: true, ...extra });
const pEnum = (id, name, labels, def = 0) =>
  p(id, name, 0, labels.length - 1, def, { step: 1, labels });

// ── Inlet / Outlet helpers ────────────────────────────────────────────────────
const inlet  = (name, label) => ({ name, label });
const outlet = (name, label) => ({ name, label });

// ── Module definitions ────────────────────────────────────────────────────────
export const MODULES = [
  // ── Synthesis ───────────────────────────────────────────────────────────────
  {
    typeId: T.OSCILLATOR,
    id: 'oscillator',
    label: 'Oscillator',
    category: 'Synthesis',
    inlets: [],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      pLog(0, 'Freq',  1, 20000, 440, { unit: 'Hz' }),
      p(1, 'Amp',   0, 1,     0.5),
      pEnum(2, 'Wave', ['Sin','Tri','Saw','Ramp','Square','pBTri','pBSaw','pBSqr']),
      p(3, 'PW',    0, 1, 0.5),
    ],
  },
  {
    typeId: T.FM2,
    id: 'fm2',
    label: 'FM2',
    category: 'Synthesis',
    inlets: [],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      pLog(0, 'Freq',  20, 8000, 220, { unit: 'Hz' }),
      p(1, 'Ratio', 0.1, 10,  2),
      p(2, 'Index', 0,   10,  1),
    ],
  },
  {
    typeId: T.VARIABLE_SHAPE_OSC,
    id: 'varshapeosc',
    label: 'VarShape Osc',
    category: 'Synthesis',
    inlets: [],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      pLog(0, 'Freq',     20, 8000, 440, { unit: 'Hz' }),
      p(1, 'Shape',    0, 1,    0.5),
      p(2, 'PW',       0, 1,    0.5),
      pLog(3, 'Sync Freq', 20, 8000, 880, { unit: 'Hz' }),
    ],
  },
  {
    typeId: T.Z_OSCILLATOR,
    id: 'zoscillator',
    label: 'Z-Oscillator',
    category: 'Synthesis',
    inlets: [],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      pLog(0, 'Freq',        20, 8000, 220, { unit: 'Hz' }),
      pLog(1, 'Formant Freq',20, 8000, 880, { unit: 'Hz' }),
      p(2, 'Shape',       0, 1,    0.5),
      p(3, 'Mode',        0, 1,    0.5),
    ],
  },
  {
    typeId: T.FORMANT_OSC,
    id: 'formantosc',
    label: 'Formant Osc',
    category: 'Synthesis',
    inlets: [],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      pLog(0, 'Carrier',  20, 8000, 220, { unit: 'Hz' }),
      pLog(1, 'Formant',  20, 8000, 880, { unit: 'Hz' }),
      p(2, 'PhaseShift', 0, 1, 0),
    ],
  },
  {
    typeId: T.PHASOR,
    id: 'phasor',
    label: 'Phasor',
    category: 'Synthesis',
    inlets: [],
    outlets: [ outlet('out', 'Out (0-1)') ],
    numOutlets: 1,
    params: [
      pLog(0, 'Freq', 0.01, 1000, 1, { unit: 'Hz' }),
    ],
  },

  // ── Filters ─────────────────────────────────────────────────────────────────
  {
    typeId: T.SVF,
    id: 'svf',
    label: 'SVF Filter',
    category: 'Filters',
    inlets: [ inlet('in', 'In') ],
    outlets: [
      outlet('lp', 'LP'),
      outlet('hp', 'HP'),
      outlet('bp', 'BP'),
      outlet('notch', 'Notch'),
      outlet('peak', 'Peak'),
    ],
    numOutlets: 5,
    params: [
      pLog(0, 'Freq',  20, 20000, 1000, { unit: 'Hz' }),
      p(1, 'Res',   0, 1,     0.3),
      p(2, 'Drive', 0, 1,     0.5),
    ],
  },
  {
    typeId: T.LADDER,
    id: 'ladder',
    label: 'Ladder Filter',
    category: 'Filters',
    inlets: [ inlet('in', 'In') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      pLog(0, 'Freq', 20, 20000, 1000, { unit: 'Hz' }),
      p(1, 'Res',  0, 1, 0.3),
    ],
  },
  {
    typeId: T.ONE_POLE,
    id: 'onepole',
    label: 'OnePole',
    category: 'Filters',
    inlets: [ inlet('in', 'In') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      p(0, 'Freq', 0.001, 0.497, 0.1),
      pEnum(1, 'Mode', ['LP', 'HP']),
    ],
  },

  // ── Effects ──────────────────────────────────────────────────────────────────
  {
    typeId: T.OVERDRIVE,
    id: 'overdrive',
    label: 'Overdrive',
    category: 'Effects',
    inlets: [ inlet('in', 'In') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [ p(0, 'Drive', 0, 1, 0.5) ],
  },
  {
    typeId: T.CHORUS,
    id: 'chorus',
    label: 'Chorus',
    category: 'Effects',
    inlets: [ inlet('in', 'In') ],
    outlets: [ outlet('L', 'L'), outlet('R', 'R') ],
    numOutlets: 2,
    params: [
      p(0, 'LFO Freq',  0.1, 10,  0.3, { unit: 'Hz' }),
      p(1, 'LFO Depth', 0,   1,   0.9),
      p(2, 'Delay',     0,   1,   0.75),
      p(3, 'Feedback',  0,   1,   0.2),
    ],
  },
  {
    typeId: T.PHASER,
    id: 'phaser',
    label: 'Phaser',
    category: 'Effects',
    inlets: [ inlet('in', 'In') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      p(0, 'LFO Freq',  0.01, 10,  0.5, { unit: 'Hz' }),
      p(1, 'LFO Depth', 0,    1,   0.7),
      p(2, 'Feedback',  0,    1,   0.3),
      pLog(3, 'Freq',   20, 8000, 800, { unit: 'Hz' }),
    ],
  },
  {
    typeId: T.FLANGER,
    id: 'flanger',
    label: 'Flanger',
    category: 'Effects',
    inlets: [ inlet('in', 'In') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      p(0, 'LFO Freq',  0.01, 10,  0.3, { unit: 'Hz' }),
      p(1, 'LFO Depth', 0,    1,   0.9),
      p(2, 'Delay',     0,    1,   0.75),
      p(3, 'Feedback',  0,    1,   0.5),
    ],
  },
  {
    typeId: T.TREMOLO,
    id: 'tremolo',
    label: 'Tremolo',
    category: 'Effects',
    inlets: [ inlet('in', 'In') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      p(0, 'Rate',  0.1, 20,  5, { unit: 'Hz' }),
      p(1, 'Depth', 0,   1,   0.5),
      pEnum(2, 'Wave', ['Sin','Tri','Saw','Ramp','Square']),
    ],
  },
  {
    typeId: T.WAVEFOLDER,
    id: 'wavefolder',
    label: 'Wavefolder',
    category: 'Effects',
    inlets: [ inlet('in', 'In') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      p(0, 'Gain',   0.1, 8,   1.8),
      p(1, 'Offset', -1,  1,   0),
    ],
  },
  {
    typeId: T.DECIMATOR,
    id: 'decimator',
    label: 'Decimator',
    category: 'Effects',
    inlets: [ inlet('in', 'In') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      p(0, 'Downsample', 0, 1, 0),
      p(1, 'Bit Crush',  0, 1, 0),
    ],
  },
  {
    typeId: T.AUTO_WAH,
    id: 'autowah',
    label: 'AutoWah',
    category: 'Effects',
    inlets:  [ inlet('in', 'In') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      p(0, 'Wah',    0, 1, 0.5),
      p(1, 'Dry/Wet', 0, 1, 0.8),
      p(2, 'Level',  0, 1, 1.0),
    ],
  },
  {
    typeId: T.SAMPLE_RATE_REDUCER,
    id: 'sampleratereducer',
    label: 'SRR',
    category: 'Effects',
    inlets:  [ inlet('in', 'In') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [ pLog(0, 'Freq', 100, 48000, 48000, { unit: 'Hz' }) ],
  },

  // ── Control ──────────────────────────────────────────────────────────────────
  {
    typeId: T.ADSR,
    id: 'adsr',
    label: 'ADSR',
    category: 'Control',
    inlets:  [ inlet('gate', 'Gate') ],
    outlets: [ outlet('env', 'Env') ],
    numOutlets: 1,
    params: [
      p(0, 'Attack',  0.001, 4, 0.01, { unit: 's' }),
      p(1, 'Decay',   0.001, 4, 0.1,  { unit: 's' }),
      p(2, 'Sustain', 0,     1, 0.7),
      p(3, 'Release', 0.001, 8, 0.3,  { unit: 's' }),
    ],
  },
  {
    typeId: T.AD_ENV,
    id: 'adenv',
    label: 'AD Env',
    category: 'Control',
    inlets:  [ inlet('trig', 'Trigger') ],
    outlets: [ outlet('env', 'Env') ],
    numOutlets: 1,
    params: [
      p(0, 'Attack',  0.001, 4,  0.01, { unit: 's' }),
      p(1, 'Decay',   0.001, 4,  0.1,  { unit: 's' }),
      p(2, 'Min',    -1,     1, -1),
      p(3, 'Max',    -1,     1,  1),
      p(4, 'Curve',  -10,   10,  0),
    ],
  },

  // ── Noise ────────────────────────────────────────────────────────────────────
  {
    typeId: T.WHITE_NOISE,
    id: 'whitenoise',
    label: 'White Noise',
    category: 'Noise',
    inlets:  [],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [ p(0, 'Amp', 0, 1, 1) ],
  },

  // ── Drums ────────────────────────────────────────────────────────────────────
  {
    typeId: T.ANALOG_BASS_DRUM,
    id: 'analogbassdrum',
    label: 'Analog BD',
    category: 'Drums',
    inlets:  [ inlet('trig', 'Trigger') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      pLog(0, 'Freq',   20, 500, 60, { unit: 'Hz' }),
      p(1, 'Tone',   0, 1, 0.5),
      p(2, 'Decay',  0, 1, 0.5),
      p(3, 'Accent', 0, 1, 0.5),
      p(4, 'Att FM', 0, 1, 0.5),
      p(5, 'Self FM',0, 1, 0),
    ],
  },
  {
    typeId: T.ANALOG_SNARE_DRUM,
    id: 'analogsnaredrum',
    label: 'Analog SD',
    category: 'Drums',
    inlets:  [ inlet('trig', 'Trigger') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      pLog(0, 'Freq',   40, 500, 180, { unit: 'Hz' }),
      p(1, 'Tone',   0, 1, 0.5),
      p(2, 'Decay',  0, 1, 0.6),
      p(3, 'Accent', 0, 1, 0.5),
      p(4, 'Snappy', 0, 1, 0.5),
    ],
  },
  {
    typeId: T.SYNTH_BASS_DRUM,
    id: 'synthbassdrum',
    label: 'Synth BD',
    category: 'Drums',
    inlets:  [ inlet('trig', 'Trigger') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      pLog(0, 'Freq',    20, 500, 80, { unit: 'Hz' }),
      p(1, 'Tone',    0, 1, 0.5),
      p(2, 'Decay',   0, 1, 0.5),
      p(3, 'Accent',  0, 1, 0.5),
      p(4, 'Dirty',   0, 1, 0),
      p(5, 'FM Amt',  0, 1, 0.5),
    ],
  },
  {
    typeId: T.SYNTH_SNARE_DRUM,
    id: 'synthsnaredrum',
    label: 'Synth SD',
    category: 'Drums',
    inlets:  [ inlet('trig', 'Trigger') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      pLog(0, 'Freq',    40, 500, 200, { unit: 'Hz' }),
      p(1, 'FM Amt',  0, 1, 0.5),
      p(2, 'Decay',   0, 1, 0.6),
      p(3, 'Accent',  0, 1, 0.5),
      p(4, 'Snappy',  0, 1, 0.5),
    ],
  },
  {
    typeId: T.HIHAT,
    id: 'hihat',
    label: 'Hi-Hat',
    category: 'Drums',
    inlets:  [ inlet('trig', 'Trigger') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      pLog(0, 'Freq',     1000, 12000, 8000, { unit: 'Hz' }),
      p(1, 'Tone',     0, 1, 0.5),
      p(2, 'Decay',    0, 1, 0.5),
      p(3, 'Noisiness',0, 1, 1),
      p(4, 'Accent',   0, 1, 0.5),
    ],
  },

  // ── Physical Modeling ─────────────────────────────────────────────────────────
  {
    typeId: T.KARPLUS_STRING,
    id: 'karplusstring',
    label: 'Karplus String',
    category: 'PhysicalModeling',
    inlets:  [ inlet('in', 'Excitation') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [
      pLog(0, 'Freq',         20, 4000, 220, { unit: 'Hz' }),
      p(1, 'Brightness',   0, 1,    0.5),
      p(2, 'Damping',      0, 1,    0.5),
      p(3, 'Non-Linearity',0, 1,    0),
    ],
  },

  // ── Utility ────────────────────────────────────────────────────────────────
  {
    typeId: T.DC_BLOCK,
    id: 'dcblock',
    label: 'DC Block',
    category: 'Utility',
    inlets:  [ inlet('in', 'In') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [],
  },
  {
    typeId: T.CROSSFADE,
    id: 'crossfade',
    label: 'CrossFade',
    category: 'Utility',
    inlets:  [ inlet('A', 'A'), inlet('B', 'B') ],
    outlets: [ outlet('out', 'Out') ],
    numOutlets: 1,
    params: [ p(0, 'Pos', 0, 1, 0.5) ],
  },

  // ── IO (special, no typeId in WASM) ──────────────────────────────────────
  {
    typeId: T.INPUT,
    id: 'input',
    label: 'Audio In',
    category: 'IO',
    inlets:  [],
    outlets: [ outlet('L', 'L'), outlet('R', 'R') ],
    numOutlets: 2,
    params: [],
  },
  {
    typeId: T.OUTPUT,
    id: 'output',
    label: 'Audio Out',
    category: 'IO',
    inlets:  [ inlet('L', 'L'), inlet('R', 'R') ],
    outlets: [],
    numOutlets: 0,
    params: [],
  },
];

// ── Lookups ───────────────────────────────────────────────────────────────────
export const MODULE_BY_TYPEID = new Map(MODULES.map(m => [m.typeId, m]));
export const MODULE_BY_ID     = new Map(MODULES.map(m => [m.id, m]));

export const CATEGORIES = [...new Set(MODULES.map(m => m.category))];

export function getModuleSpec(typeId) {
  return MODULE_BY_TYPEID.get(typeId) ?? null;
}
