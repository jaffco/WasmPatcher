/**
 * DaisySP WebAssembly Wrapper
 * Exposes all DaisySP modules through a unified C API.
 *
 * API surface (exported to JS):
 *   int  dsp_create(int type_id, float sample_rate)
 *   void dsp_destroy(int handle)
 *   float dsp_tick(int handle, float audio_in, float trigger)
 *   float dsp_get_outlet(int handle, int outlet_idx)
 *   void dsp_set_param(int handle, int param_id, float value)
 *   void dsp_process_block(int handle, float* in_buf, float* trig_buf,
 *                          float* out_buf, int size)
 *   int  dsp_num_types()
 */

// ---- Suppress ARM-specific code ----
#ifdef __arm__
#undef __arm__
#endif

#include <cstdlib>
#include <cstring>
#include <cmath>
#include <array>
#include <stdint.h>

// Include DaisySP – compiler is invoked with -I pointing at Source/
#include "daisysp.h"

using namespace daisysp;

// ─────────────────────────────────────────────────────────────────────────────
// Module type IDs (must match module-registry.js)
// ─────────────────────────────────────────────────────────────────────────────
enum ModuleType
{
    DSP_OSCILLATOR          = 0,
    DSP_ADSR                = 1,
    DSP_AD_ENV              = 2,
    DSP_PHASOR              = 3,
    DSP_SVF                 = 4,
    DSP_LADDER              = 5,
    DSP_ONE_POLE            = 6,
    DSP_OVERDRIVE           = 7,
    DSP_CHORUS              = 8,
    DSP_PHASER              = 9,
    DSP_TREMOLO             = 10,
    DSP_WAVEFOLDER          = 11,
    DSP_DECIMATOR           = 12,
    DSP_WHITE_NOISE         = 13,
    DSP_ANALOG_BASS_DRUM    = 14,
    DSP_ANALOG_SNARE_DRUM   = 15,
    DSP_SYNTH_BASS_DRUM     = 16,
    DSP_SYNTH_SNARE_DRUM    = 17,
    DSP_HIHAT               = 18,
    DSP_KARPLUS_STRING      = 19,
    DSP_FM2                 = 20,
    DSP_DC_BLOCK            = 21,
    DSP_AUTO_WAH            = 22,
    DSP_FLANGER             = 23,
    DSP_VARIABLE_SHAPE_OSC  = 24,
    DSP_SAMPLE_RATE_REDUCER = 25,
    DSP_Z_OSCILLATOR        = 26,
    DSP_FORMANT_OSC         = 27,
    DSP_CROSSFADE           = 28,
    NUM_MODULE_TYPES        = 29
};

// ─────────────────────────────────────────────────────────────────────────────
// Abstract node base
// ─────────────────────────────────────────────────────────────────────────────
struct NodeBase
{
    float outlets_[8] = {};
    // audio_in : primary audio inlet
    // audio_in2: secondary audio inlet (e.g. crossfade second input)
    // trigger  : gate/trigger signal (>0.5 = on)
    virtual float tick(float audio_in, float audio_in2, float trigger) = 0;
    virtual void  set_param(int param_id, float value)                 = 0;
    float         get_outlet(int idx) { return outlets_[idx < 8 ? idx : 0]; }
    virtual ~NodeBase() {}
};

// ─────────────────────────────────────────────────────────────────────────────
// Concrete node implementations
// ─────────────────────────────────────────────────────────────────────────────

// ---- Oscillator (gen, no audio in) ----
struct OscNode : NodeBase
{
    Oscillator osc;
    OscNode(float sr) { osc.Init(sr); osc.SetFreq(440.f); osc.SetAmp(0.5f); }
    float tick(float, float, float) override
    {
        float v    = osc.Process();
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: osc.SetFreq(v); break;
            case 1: osc.SetAmp(v); break;
            case 2: osc.SetWaveform((uint8_t)v); break;
            case 3: osc.SetPw(v); break;
        }
    }
};

// ---- ADSR (triggered gate) ----
struct AdsrNode : NodeBase
{
    Adsr  adsr;
    bool  prev_trig = false;
    AdsrNode(float sr)
    {
        adsr.Init(sr);
        adsr.SetAttackTime(0.01f);
        adsr.SetDecayTime(0.1f);
        adsr.SetSustainLevel(0.7f);
        adsr.SetReleaseTime(0.3f);
    }
    float tick(float, float, float trig) override
    {
        bool gate       = trig > 0.5f;
        float v         = adsr.Process(gate);
        outlets_[0]     = v;
        prev_trig       = gate;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: adsr.SetAttackTime(v); break;
            case 1: adsr.SetDecayTime(v); break;
            case 2: adsr.SetSustainLevel(v); break;
            case 3: adsr.SetReleaseTime(v); break;
        }
    }
};

// ---- AD Envelope ----
struct AdEnvNode : NodeBase
{
    AdEnv env;
    bool  prev_trig = false;
    AdEnvNode(float sr) { env.Init(sr); }
    float tick(float, float, float trig) override
    {
        bool trigger_now = (trig > 0.5f) && !prev_trig;
        prev_trig        = (trig > 0.5f);
        if(trigger_now) env.Trigger();
        float v    = env.Process();
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: env.SetTime(ADENV_SEG_ATTACK, v); break;
            case 1: env.SetTime(ADENV_SEG_DECAY, v); break;
            case 2: env.SetMin(v); break;
            case 3: env.SetMax(v); break;
            case 4: env.SetCurve(v); break;
        }
    }
};

// ---- Phasor (gen) ----
struct PhasorNode : NodeBase
{
    Phasor phasor;
    PhasorNode(float sr) { phasor.Init(sr, 1.0f); }
    float tick(float, float, float) override
    {
        float v    = phasor.Process();
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        if(p == 0) phasor.SetFreq(v);
    }
};

// ---- SVF Filter (multi-outlet: LP, HP, BP, Notch, Peak) ----
struct SvfNode : NodeBase
{
    Svf filter;
    SvfNode(float sr) { filter.Init(sr); filter.SetFreq(1000.f); filter.SetRes(0.3f); }
    float tick(float in, float, float) override
    {
        filter.Process(in);
        outlets_[0] = filter.Low();
        outlets_[1] = filter.High();
        outlets_[2] = filter.Band();
        outlets_[3] = filter.Notch();
        outlets_[4] = filter.Peak();
        return outlets_[0];
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: filter.SetFreq(v); break;
            case 1: filter.SetRes(v); break;
            case 2: filter.SetDrive(v); break;
        }
    }
};

// ---- Ladder Filter ----
struct LadderNode : NodeBase
{
    LadderFilter filter;
    LadderNode(float sr) { filter.Init(sr); filter.SetFreq(1000.f); filter.SetRes(0.3f); }
    float tick(float in, float, float) override
    {
        float v    = filter.Process(in);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: filter.SetFreq(v); break;
            case 1: filter.SetRes(v); break;
        }
    }
};

// ---- OnePole ----
struct OnePoleNode : NodeBase
{
    OnePole filter;
    OnePoleNode(float) { filter.Init(); filter.SetFrequency(0.1f); }
    float tick(float in, float, float) override
    {
        float v    = filter.Process(in);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: filter.SetFrequency(v); break;
            case 1: filter.SetFilterMode((OnePole::FilterMode)(int)v); break;
        }
    }
};

// ---- Overdrive ----
struct OverdriveNode : NodeBase
{
    Overdrive od;
    OverdriveNode(float) { od.Init(); od.SetDrive(0.5f); }
    float tick(float in, float, float) override
    {
        float v    = od.Process(in);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        if(p == 0) od.SetDrive(v);
    }
};

// ---- Chorus ----
struct ChorusNode : NodeBase
{
    Chorus chorus;
    ChorusNode(float sr) { chorus.Init(sr); }
    float tick(float in, float, float) override
    {
        float v     = chorus.Process(in);
        outlets_[0] = chorus.GetLeft();
        outlets_[1] = chorus.GetRight();
        return outlets_[0];
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: chorus.SetLfoFreq(v); break;
            case 1: chorus.SetLfoDepth(v); break;
            case 2: chorus.SetDelay(v); break;
            case 3: chorus.SetFeedback(v); break;
            case 4: chorus.SetPan(v); break;
        }
    }
};

// ---- Phaser ----
struct PhaserNode : NodeBase
{
    Phaser phaser;
    PhaserNode(float sr) { phaser.Init(sr); }
    float tick(float in, float, float) override
    {
        float v    = phaser.Process(in);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: phaser.SetLfoFreq(v); break;
            case 1: phaser.SetLfoDepth(v); break;
            case 2: phaser.SetFeedback(v); break;
            case 3: phaser.SetFreq(v); break;
            case 4:
                phaser.SetPoles((int)v);
                break;
        }
    }
};

// ---- Tremolo ----
struct TremoloNode : NodeBase
{
    Tremolo trem;
    TremoloNode(float sr) { trem.Init(sr); trem.SetFreq(5.f); trem.SetDepth(0.5f); }
    float tick(float in, float, float) override
    {
        float v    = trem.Process(in);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: trem.SetFreq(v); break;
            case 1: trem.SetDepth(v); break;
            case 2: trem.SetWaveform((int)v); break;
        }
    }
};

// ---- Wavefolder ----
struct WavefolderNode : NodeBase
{
    Wavefolder wf;
    WavefolderNode(float) { wf.Init(); wf.SetGain(1.8f); }
    float tick(float in, float, float) override
    {
        float v    = wf.Process(in);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: wf.SetGain(v); break;
            case 1: wf.SetOffset(v); break;
        }
    }
};

// ---- Decimator ----
struct DecimatorNode : NodeBase
{
    Decimator dec;
    DecimatorNode(float) { dec.Init(); }
    float tick(float in, float, float) override
    {
        float v    = dec.Process(in);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: dec.SetDownsampleFactor(v); break;
            case 1: dec.SetBitcrushFactor(v); break;
        }
    }
};

// ---- WhiteNoise ----
struct WhiteNoiseNode : NodeBase
{
    WhiteNoise noise;
    WhiteNoiseNode(float) { noise.Init(); noise.SetAmp(1.0f); }
    float tick(float, float, float) override
    {
        float v    = noise.Process();
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        if(p == 0) noise.SetAmp(v);
    }
};

// ---- Analog Bass Drum ----
struct AnalogBassDrumNode : NodeBase
{
    AnalogBassDrum drum;
    bool prev_trig = false;
    AnalogBassDrumNode(float sr) { drum.Init(sr); }
    float tick(float, float, float trig) override
    {
        bool t_now = (trig > 0.5f) && !prev_trig;
        prev_trig  = (trig > 0.5f);
        float v    = drum.Process(t_now);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: drum.SetFreq(v); break;
            case 1: drum.SetTone(v); break;
            case 2: drum.SetDecay(v); break;
            case 3: drum.SetAccent(v); break;
            case 4: drum.SetAttackFmAmount(v); break;
            case 5: drum.SetSelfFmAmount(v); break;
        }
    }
};

// ---- Analog Snare Drum ----
struct AnalogSnareDrumNode : NodeBase
{
    AnalogSnareDrum drum;
    bool prev_trig = false;
    AnalogSnareDrumNode(float sr) { drum.Init(sr); }
    float tick(float, float, float trig) override
    {
        bool t_now = (trig > 0.5f) && !prev_trig;
        prev_trig  = (trig > 0.5f);
        float v    = drum.Process(t_now);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: drum.SetFreq(v); break;
            case 1: drum.SetTone(v); break;
            case 2: drum.SetDecay(v); break;
            case 3: drum.SetAccent(v); break;
            case 4: drum.SetSnappy(v); break;
        }
    }
};

// ---- Synth Bass Drum ----
struct SynthBassDrumNode : NodeBase
{
    SyntheticBassDrum drum;
    bool prev_trig = false;
    SynthBassDrumNode(float sr) { drum.Init(sr); }
    float tick(float, float, float trig) override
    {
        bool t_now = (trig > 0.5f) && !prev_trig;
        prev_trig  = (trig > 0.5f);
        float v    = drum.Process(t_now);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: drum.SetFreq(v); break;
            case 1: drum.SetTone(v); break;
            case 2: drum.SetDecay(v); break;
            case 3: drum.SetAccent(v); break;
            case 4: drum.SetDirtiness(v); break;
            case 5: drum.SetFmEnvelopeAmount(v); break;
        }
    }
};

// ---- Synth Snare Drum ----
struct SynthSnareDrumNode : NodeBase
{
    SyntheticSnareDrum drum;
    bool prev_trig = false;
    SynthSnareDrumNode(float sr) { drum.Init(sr); }
    float tick(float, float, float trig) override
    {
        bool t_now = (trig > 0.5f) && !prev_trig;
        prev_trig  = (trig > 0.5f);
        float v    = drum.Process(t_now);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: drum.SetFreq(v); break;
            case 1: drum.SetFmAmount(v); break;
            case 2: drum.SetDecay(v); break;
            case 3: drum.SetAccent(v); break;
            case 4: drum.SetSnappy(v); break;
        }
    }
};

// ---- HiHat ----
struct HiHatNode : NodeBase
{
    HiHat<> hat;
    bool prev_trig = false;
    HiHatNode(float sr) { hat.Init(sr); }
    float tick(float, float, float trig) override
    {
        bool t_now = (trig > 0.5f) && !prev_trig;
        prev_trig  = (trig > 0.5f);
        float v    = hat.Process(t_now);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: hat.SetFreq(v); break;
            case 1: hat.SetTone(v); break;
            case 2: hat.SetDecay(v); break;
            case 3: hat.SetNoisiness(v); break;
            case 4: hat.SetAccent(v); break;
        }
    }
};

// ---- Karplus-Strong String ----
struct KarplusStringNode : NodeBase
{
    String string;
    KarplusStringNode(float sr) { string.Init(sr); string.SetFreq(220.f); string.SetBrightness(0.5f); string.SetDamping(0.5f); string.SetNonLinearity(0.f); }
    float tick(float in, float, float) override
    {
        float v    = string.Process(in);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: string.SetFreq(v); break;
            case 1: string.SetBrightness(v); break;
            case 2: string.SetDamping(v); break;
            case 3: string.SetNonLinearity(v); break;
        }
    }
};

// ---- FM2 ----
struct Fm2Node : NodeBase
{
    Fm2 fm;
    Fm2Node(float sr) { fm.Init(sr); fm.SetFrequency(220.f); fm.SetRatio(2.f); fm.SetIndex(1.f); }
    float tick(float, float, float) override
    {
        float v    = fm.Process();
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: fm.SetFrequency(v); break;
            case 1: fm.SetRatio(v); break;
            case 2: fm.SetIndex(v); break;
        }
    }
};

// ---- DCBlock ----
struct DcBlockNode : NodeBase
{
    DcBlock dc;
    DcBlockNode(float sr) { dc.Init(sr); }
    float tick(float in, float, float) override
    {
        float v    = dc.Process(in);
        outlets_[0] = v;
        return v;
    }
    void set_param(int, float) override {}
};

// ---- AutoWah ----
struct AutoWahNode : NodeBase
{
    Autowah wah;
    AutoWahNode(float sr) { wah.Init(sr); wah.SetWah(0.5f); wah.SetDryWet(0.8f); wah.SetLevel(1.f); }
    float tick(float in, float, float) override
    {
        float v    = wah.Process(in);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: wah.SetWah(v); break;
            case 1: wah.SetDryWet(v); break;
            case 2: wah.SetLevel(v); break;
        }
    }
};

// ---- Flanger ----
struct FlangerNode : NodeBase
{
    Flanger flanger;
    FlangerNode(float sr) { flanger.Init(sr); }
    float tick(float in, float, float) override
    {
        float v    = flanger.Process(in);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: flanger.SetLfoFreq(v); break;
            case 1: flanger.SetLfoDepth(v); break;
            case 2: flanger.SetDelay(v); break;
            case 3: flanger.SetFeedback(v); break;
        }
    }
};

// ---- VariableShape Oscillator ----
struct VariableShapeOscNode : NodeBase
{
    VariableShapeOscillator osc;
    VariableShapeOscNode(float sr) { osc.Init(sr); osc.SetFreq(440.f); osc.SetWaveshape(0.f); }
    float tick(float, float, float) override
    {
        float v    = osc.Process();
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: osc.SetFreq(v); break;
            case 1: osc.SetWaveshape(v); break;
            case 2: osc.SetPW(v); break;
            case 3: osc.SetSyncFreq(v); break;
        }
    }
};

// ---- SampleRateReducer ----
struct SampleRateReducerNode : NodeBase
{
    SampleRateReducer srr;
    SampleRateReducerNode(float) { srr.Init(); }
    float tick(float in, float, float) override
    {
        float v    = srr.Process(in);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        if(p == 0) srr.SetFreq(v);
    }
};

// ---- Z Oscillator ----
struct ZOscillatorNode : NodeBase
{
    ZOscillator osc;
    ZOscillatorNode(float sr) { osc.Init(sr); osc.SetFreq(220.f); }
    float tick(float, float, float) override
    {
        float v    = osc.Process();
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: osc.SetFreq(v); break;
            case 1: osc.SetFormantFreq(v); break;
            case 2: osc.SetShape(v); break;
            case 3: osc.SetMode(v); break;
        }
    }
};

// ---- Formant Oscillator ----
struct FormantOscNode : NodeBase
{
    FormantOscillator osc;
    FormantOscNode(float sr) { osc.Init(sr); osc.SetCarrierFreq(220.f); osc.SetFormantFreq(880.f); }
    float tick(float, float, float) override
    {
        float v    = osc.Process();
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        switch(p)
        {
            case 0: osc.SetCarrierFreq(v); break;
            case 1: osc.SetFormantFreq(v); break;
            case 2: osc.SetPhaseShift(v); break;
        }
    }
};

// ---- CrossFade ----
struct CrossFadeNode : NodeBase
{
    CrossFade cf;
    CrossFadeNode(float) { cf.Init(CROSSFADE_CPOW); cf.SetPos(0.5f); }
    float tick(float in1, float in2, float) override
    {
        float v    = cf.Process(in1, in2);
        outlets_[0] = v;
        return v;
    }
    void set_param(int p, float v) override
    {
        if(p == 0) cf.SetPos(v);
    }
};

// ─────────────────────────────────────────────────────────────────────────────
// Handle table
// ─────────────────────────────────────────────────────────────────────────────
static constexpr int MAX_NODES = 256;
static NodeBase*     g_nodes[MAX_NODES] = {};

static int alloc_handle(NodeBase* n)
{
    for(int i = 1; i < MAX_NODES; ++i)
    {
        if(!g_nodes[i])
        {
            g_nodes[i] = n;
            return i;
        }
    }
    delete n;
    return 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// Public C API
// ─────────────────────────────────────────────────────────────────────────────
extern "C"
{
    int dsp_create(int type_id, float sample_rate)
    {
        NodeBase* n = nullptr;
        switch(type_id)
        {
            case DSP_OSCILLATOR:          n = new OscNode(sample_rate); break;
            case DSP_ADSR:                n = new AdsrNode(sample_rate); break;
            case DSP_AD_ENV:              n = new AdEnvNode(sample_rate); break;
            case DSP_PHASOR:              n = new PhasorNode(sample_rate); break;
            case DSP_SVF:                 n = new SvfNode(sample_rate); break;
            case DSP_LADDER:              n = new LadderNode(sample_rate); break;
            case DSP_ONE_POLE:            n = new OnePoleNode(sample_rate); break;
            case DSP_OVERDRIVE:           n = new OverdriveNode(sample_rate); break;
            case DSP_CHORUS:              n = new ChorusNode(sample_rate); break;
            case DSP_PHASER:              n = new PhaserNode(sample_rate); break;
            case DSP_TREMOLO:             n = new TremoloNode(sample_rate); break;
            case DSP_WAVEFOLDER:          n = new WavefolderNode(sample_rate); break;
            case DSP_DECIMATOR:           n = new DecimatorNode(sample_rate); break;
            case DSP_WHITE_NOISE:         n = new WhiteNoiseNode(sample_rate); break;
            case DSP_ANALOG_BASS_DRUM:    n = new AnalogBassDrumNode(sample_rate); break;
            case DSP_ANALOG_SNARE_DRUM:   n = new AnalogSnareDrumNode(sample_rate); break;
            case DSP_SYNTH_BASS_DRUM:     n = new SynthBassDrumNode(sample_rate); break;
            case DSP_SYNTH_SNARE_DRUM:    n = new SynthSnareDrumNode(sample_rate); break;
            case DSP_HIHAT:               n = new HiHatNode(sample_rate); break;
            case DSP_KARPLUS_STRING:      n = new KarplusStringNode(sample_rate); break;
            case DSP_FM2:                 n = new Fm2Node(sample_rate); break;
            case DSP_DC_BLOCK:            n = new DcBlockNode(sample_rate); break;
            case DSP_AUTO_WAH:            n = new AutoWahNode(sample_rate); break;
            case DSP_FLANGER:             n = new FlangerNode(sample_rate); break;
            case DSP_VARIABLE_SHAPE_OSC:  n = new VariableShapeOscNode(sample_rate); break;
            case DSP_SAMPLE_RATE_REDUCER: n = new SampleRateReducerNode(sample_rate); break;
            case DSP_Z_OSCILLATOR:        n = new ZOscillatorNode(sample_rate); break;
            case DSP_FORMANT_OSC:         n = new FormantOscNode(sample_rate); break;
            case DSP_CROSSFADE:           n = new CrossFadeNode(sample_rate); break;
            default: return 0;
        }
        return alloc_handle(n);
    }

    void dsp_destroy(int handle)
    {
        if(handle > 0 && handle < MAX_NODES && g_nodes[handle])
        {
            delete g_nodes[handle];
            g_nodes[handle] = nullptr;
        }
    }

    /** Process one sample.
     *  audio_in  : primary audio inlet value
     *  audio_in2 : secondary audio inlet value (CrossFade in2, etc.)
     *  trigger   : gate/trigger signal
     *  returns primary outlet value (outlet 0)
     */
    float dsp_tick(int handle, float audio_in, float audio_in2, float trigger)
    {
        if(handle <= 0 || handle >= MAX_NODES || !g_nodes[handle]) return 0.f;
        return g_nodes[handle]->tick(audio_in, audio_in2, trigger);
    }

    /** Read any outlet by index (0 = primary, same as dsp_tick return). */
    float dsp_get_outlet(int handle, int outlet_idx)
    {
        if(handle <= 0 || handle >= MAX_NODES || !g_nodes[handle]) return 0.f;
        return g_nodes[handle]->get_outlet(outlet_idx);
    }

    void dsp_set_param(int handle, int param_id, float value)
    {
        if(handle > 0 && handle < MAX_NODES && g_nodes[handle])
            g_nodes[handle]->set_param(param_id, value);
    }

    /** Process an entire block (for efficiency). out_buf must be size floats. */
    void dsp_process_block(int    handle,
                           float* in_buf,
                           float* in2_buf,
                           float* trig_buf,
                           float* out_buf,
                           int    size)
    {
        if(handle <= 0 || handle >= MAX_NODES || !g_nodes[handle]) return;
        NodeBase* n = g_nodes[handle];
        for(int i = 0; i < size; ++i)
        {
            out_buf[i] = n->tick(
                in_buf   ? in_buf[i]   : 0.f,
                in2_buf  ? in2_buf[i]  : 0.f,
                trig_buf ? trig_buf[i] : 0.f
            );
        }
    }

    int dsp_num_types() { return NUM_MODULE_TYPES; }
}
