// -------- AUDIO (pleasant tone, click-free) --------
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const ctx = new AudioCtx();
const MAX_POLYPHONY = 16;

// Master audio chain
const mixBus = ctx.createGain();
const masterHP = ctx.createBiquadFilter();
const masterLP = ctx.createBiquadFilter();
const compressor = ctx.createDynamicsCompressor();
const masterGain = ctx.createGain();

// Configure master chain
mixBus.gain.value = 0.8; // Headroom for mixing

masterHP.type = 'highpass';
masterHP.frequency.value = 100; // Remove rumble

masterLP.type = 'lowpass';
masterLP.frequency.value = 10000; // Tame harsh highs

// Polite compressor settings from spec
compressor.threshold.value = -24;
compressor.knee.value = 30;
compressor.ratio.value = 4;
compressor.attack.value = 0.01;
compressor.release.value = 0.25;

masterGain.gain.value = 0.9; // Final master volume

// Connect the chain
mixBus.connect(masterHP);
masterHP.connect(masterLP);
masterLP.connect(compressor);
compressor.connect(masterGain);
masterGain.connect(ctx.destination);

const active = new Map(); // note -> {osc, gain, filter}
let currentSound = "triangle"; // Default sound

// Sound profiles
const soundProfiles = {
  sine: {
    oscillator: "sine",
    attack: 0.02,
    decay: 0.1,
    sustain: 0.7,
    release: 0.3,
    filterType: "lowpass",
    filterFreq: 8000,
    filterQ: 0.7,
  },
  triangle: {
    oscillator: "triangle",
    attack: 0.02,
    decay: 0.1,
    sustain: 0.7,
    release: 0.3,
    filterType: "lowpass",
    filterFreq: 8000,
    filterQ: 0.7,
  },
  square: {
    oscillator: "square",
    attack: 0.02,
    decay: 0.1,
    sustain: 0.7,
    release: 0.3,
    filterType: "lowpass",
    filterFreq: 6000,
    filterQ: 0.7,
  },
  sawtooth: {
    oscillator: "sawtooth",
    attack: 0.02,
    decay: 0.1,
    sustain: 0.7,
    release: 0.3,
    filterType: "lowpass",
    filterFreq: 6000,
    filterQ: 0.7,
  },
  organ: {
    oscillator: "sine", // Base type, will be overridden by periodic wave
    attack: 0.02,
    decay: 0.1,
    sustain: 0.7,
    release: 0.3,
    filterType: "lowpass",
    filterFreq: 8000,
    filterQ: 0.7,
  }
};

const pitchIndex = {
  'C':0, 'C#':1, 'Db':1, 'D':2, 'D#':3, 'Eb':3, 'E':4, 'F':5, 'F#':6, 'Gb':6,
  'G':7, 'G#':8, 'Ab':8, 'A':9, 'A#':10, 'Bb':10, 'B':11
};

function freqOf(note) {
  const octave = parseInt(note.at(-1), 10);
  const pc = note.slice(0, -1);
  const idx = pitchIndex[pc];
  if (idx === undefined) {
    console.error(`Invalid note: ${note}`);
    return 0;
  }
  const noteNum = octave * 12 + idx;
  const A4num = 4 * 12 + 9;
  return 440 * Math.pow(2, (noteNum - A4num) / 12);
}

let organWave = null;

function buildPeriodicVoiceWave(ctx) {
  const N = 20;
  const real = new Float32Array(N);
  const imag = new Float32Array(N);
  real[1] = 1.0;
  real[2] = 0.15;
  real[3] = 0.10;
  real[4] = 0.05;
  return ctx.createPeriodicWave(real, imag);
}

function startNote(finalNote, velocity = 0.2) {
  if (active.has(finalNote)) {
    stopNote(finalNote, true); // Immediate stop on retrigger
  }

  if (active.size >= MAX_POLYPHONY) {
    // Find the first key in insertion order, which is the oldest
    const oldestNote = active.keys().next().value;
    stopNote(oldestNote, true); // Forcibly stop oldest note
  }

  const profile = soundProfiles[currentSound];
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();
  
  let lfo = null;

  // Set common properties
  osc.type = profile.oscillator;
  osc.frequency.value = freqOf(finalNote);
  filter.type = profile.filterType;
  filter.frequency.value = profile.filterFreq;
  filter.Q.value = profile.filterQ;

  // Handle special case for organ
  if (currentSound === 'organ') {
    if (!organWave) organWave = buildPeriodicVoiceWave(ctx);
    osc.setPeriodicWave(organWave);

    lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const now = ctx.currentTime;
    lfo.frequency.setValueAtTime(4, now);
    lfo.frequency.linearRampToValueAtTime(6, now + 1.5);
    lfoGain.gain.value = 2.5; // Vibrato depth in Hz
    lfo.connect(lfoGain).connect(osc.frequency);
    lfo.start(now);
  }

  const peakGain = 0.2;
  const now = ctx.currentTime;
  const A = profile.attack, D = profile.decay, S = profile.sustain;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(0.0, now);
  gain.gain.linearRampToValueAtTime(peakGain, now + A);
  gain.gain.linearRampToValueAtTime(S * peakGain, now + A + D);

  osc.connect(filter).connect(gain).connect(mixBus);
  osc.start(now);

  active.set(finalNote, { osc, gain, filter, lfo });
}

function stopNote(finalNote, immediate = false) {
  const node = active.get(finalNote);
  if (!node) return;

  const { osc, gain, lfo } = node;
  const profile = soundProfiles[currentSound];
  const now = ctx.currentTime;
  const R = profile.release;

  if (immediate) {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0, now);
    osc.stop(now);
    if (lfo) lfo.stop(now);
  } else {
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(gain.gain.value, now);
    gain.gain.linearRampToValueAtTime(0.0001, now + R);
    osc.stop(now + R + 0.01);
    if (lfo) lfo.stop(now + R + 0.01);
  }

  active.delete(finalNote);
}

const noteColors = {
  'C': '#FF3B30',
  'D': '#FF9500',
  'E': '#FFCC00',
  'F': '#34C759',
  'G': '#30c0c6',
  'A': '#007AFF',
  'B': '#AF52DE'
};

const noteLightColors = {
  'C': '#ff8780',
  'D': '#ffc266',
  'E': '#ffdd66',
  'F': '#85d99b',
  'G': '#80d8dd',
  'A': '#66b3ff',
  'B': '#d099ea'
};

const blackNoteColors = {
  'C#': '#ff6818', 'Db': '#ff6818',
  'D#': '#ffb000', 'Eb': '#ffb000',
  'F#': '#32c490', 'Gb': '#32c490',
  'G#': '#189de2', 'Ab': '#189de2',
  'A#': '#5866ee', 'Bb': '#5866ee'
};

const blackKeyDisplayMap = {
  'C#': 'C♯<br>D♭', 'Db': 'C♯<br>D♭',
  'D#': 'D♯<br>E♭', 'Eb': 'D♯<br>E♭',
  'F#': 'F♯<br>G♭', 'Gb': 'F♯<br>G♭',
  'G#': 'G♯<br>A♭', 'Ab': 'G♯<br>A♭',
  'A#': 'A♯<br>B♭', 'Bb': 'A♯<br>B♭'
};

// -------- LAYOUT --------

const sharpToFlatMap = {
  'C#': 'Db',
  'D#': 'Eb',
  'F#': 'Gb',
  'G#': 'Ab',
  'A#': 'Bb'
};

const flatToSharpMap = {
  'Db': 'C#',
  'Eb': 'D#',
  'Gb': 'F#',
  'Ab': 'G#',
  'Bb': 'A#'
};

const keyDisplayRanges = {
  'C': { startNote: 'C3', endNoteBase: 'E' },
  'Db': { startNote: 'C3', endNoteBase: 'F' },
  'D': { startNote: 'D3', endNoteBase: 'F#' },
  'Eb': { startNote: 'D3', endNoteBase: 'G' },
  'E': { startNote: 'E3', endNoteBase: 'G#' },
  'F': { startNote: 'F3', endNoteBase: 'A' },
  'Gb': { startNote: 'F3', endNoteBase: 'B' },
  'G': { startNote: 'G2', endNoteBase: 'B' },
  'Ab': { startNote: 'G2', endNoteBase: 'C' },
  'A': { startNote: 'A2', endNoteBase: 'C#' },
  'Bb': { startNote: 'A2', endNoteBase: 'D' },
  'B': { startNote: 'B2', endNoteBase: 'D#' },
}

const flexKeymaps = {
  'C': {
    'Major': {
      'z':{note:'C',octave:3},'x':{note:'D',octave:3},'c':{note:'E',octave:3},'v':{note:'F',octave:3},'b':{note:'G',octave:3},'n':{note:'A',octave:3},'m':{note:'B',octave:3},',':{note:'C',octave:4},'.':{note:'D',octave:4},'/':{note:'E',octave:4},
      'a':{note:'C',octave:4},'s':{note:'D',octave:4},'d':{note:'E',octave:4},'f':{note:'F',octave:4},'g':{note:'G',octave:4},'h':{note:'A',octave:4},'j':{note:'B',octave:4},'k':{note:'C',octave:5},'l':{note:'D',octave:5},';':{note:'E',octave:5},
      'q':{note:'C',octave:5},'w':{note:'D',octave:5},'e':{note:'E',octave:5},'r':{note:'F',octave:5},'t':{note:'G',octave:5},'y':{note:'A',octave:5},'u':{note:'B',octave:5},'i':{note:'C',octave:6},'o':{note:'D',octave:6},'p':{note:'E',octave:6},
      '1':{note:'C',octave:6},'2':{note:'D',octave:6},'3':{note:'E',octave:6},'4':{note:'F',octave:6},'5':{note:'G',octave:6},'6':{note:'A',octave:6},'7':{note:'B',octave:6},'8':{note:'C',octave:7},'9':{note:'D',octave:7},'0':{note:'E',octave:7}
    },
    'Natural Minor': {
      'z':{note:'C',octave:3},'x':{note:'D',octave:3},'c':{note:'Eb',octave:3},'v':{note:'F',octave:3},'b':{note:'G',octave:3},'n':{note:'Ab',octave:3},'m':{note:'Bb',octave:3},',':{note:'C',octave:4},'.':{note:'D',octave:4},'/':{note:'Eb',octave:4},
      'a':{note:'C',octave:4},'s':{note:'D',octave:4},'d':{note:'Eb',octave:4},'f':{note:'F',octave:4},'g':{note:'G',octave:4},'h':{note:'Ab',octave:4},'j':{note:'Bb',octave:4},'k':{note:'C',octave:5},'l':{note:'D',octave:5},';':{note:'Eb',octave:5},
      'q':{note:'C',octave:5},'w':{note:'D',octave:5},'e':{note:'Eb',octave:5},'r':{note:'F',octave:5},'t':{note:'G',octave:5},'y':{note:'Ab',octave:5},'u':{note:'Bb',octave:5},'i':{note:'C',octave:6},'o':{note:'D',octave:6},'p':{note:'Eb',octave:6},
      '1':{note:'C',octave:6},'2':{note:'D',octave:6},'3':{note:'Eb',octave:6},'4':{note:'F',octave:6},'5':{note:'G',octave:6},'6':{note:'Ab',octave:6},'7':{note:'Bb',octave:6},'8':{note:'C',octave:7},'9':{note:'D',octave:7},'0':{note:'Eb',octave:7}
    },
    'Harmonic Minor': {
      'z':{note:'C',octave:3},'x':{note:'D',octave:3},'c':{note:'Eb',octave:3},'v':{note:'F',octave:3},'b':{note:'G',octave:3},'n':{note:'Ab',octave:3},'m':{note:'B',octave:3},',':{note:'C',octave:4},'.':{note:'D',octave:4},'/':{note:'Eb',octave:4},
      'a':{note:'C',octave:4},'s':{note:'D',octave:4},'d':{note:'Eb',octave:4},'f':{note:'F',octave:4},'g':{note:'G',octave:4},'h':{note:'Ab',octave:4},'j':{note:'B',octave:4},'k':{note:'C',octave:5},'l':{note:'D',octave:5},';':{note:'Eb',octave:5},
      'q':{note:'C',octave:5},'w':{note:'D',octave:5},'e':{note:'Eb',octave:5},'r':{note:'F',octave:5},'t':{note:'G',octave:5},'y':{note:'Ab',octave:5},'u':{note:'B',octave:5},'i':{note:'C',octave:6},'o':{note:'D',octave:6},'p':{note:'Eb',octave:6},
      '1':{note:'C',octave:6},'2':{note:'D',octave:6},'3':{note:'Eb',octave:6},'4':{note:'F',octave:6},'5':{note:'G',octave:6},'6':{note:'Ab',octave:6},'7':{note:'B',octave:6},'8':{note:'C',octave:7},'9':{note:'D',octave:7},'0':{note:'Eb',octave:7}
    },
    'Melodic Minor': {
      'z':{note:'C',octave:3},'x':{note:'D',octave:3},'c':{note:'Eb',octave:3},'v':{note:'F',octave:3},'b':{note:'G',octave:3},'n':{note:'A',octave:3},'m':{note:'B',octave:3},',':{note:'C',octave:4},'.':{note:'D',octave:4},'/':{note:'Eb',octave:4},
      'a':{note:'C',octave:4},'s':{note:'D',octave:4},'d':{note:'Eb',octave:4},'f':{note:'F',octave:4},'g':{note:'G',octave:4},'h':{note:'A',octave:4},'j':{note:'B',octave:4},'k':{note:'C',octave:5},'l':{note:'D',octave:5},';':{note:'Eb',octave:5},
      'q':{note:'C',octave:5},'w':{note:'D',octave:5},'e':{note:'Eb',octave:5},'r':{note:'F',octave:5},'t':{note:'G',octave:5},'y':{note:'A',octave:5},'u':{note:'B',octave:5},'i':{note:'C',octave:6},'o':{note:'D',octave:6},'p':{note:'Eb',octave:6},
      '1':{note:'C',octave:6},'2':{note:'D',octave:6},'3':{note:'Eb',octave:6},'4':{note:'F',octave:6},'5':{note:'G',octave:6},'6':{note:'A',octave:6},'7':{note:'B',octave:6},'8':{note:'C',octave:7},'9':{note:'D',octave:7},'0':{note:'Eb',octave:7}
    },
    'Dorian': {
      'z':{note:'C',octave:3},'x':{note:'D',octave:3},'c':{note:'Eb',octave:3},'v':{note:'F',octave:3},'b':{note:'G',octave:3},'n':{note:'A',octave:3},'m':{note:'Bb',octave:3},',':{note:'C',octave:4},'.':{note:'D',octave:4},'/':{note:'Eb',octave:4},
      'a':{note:'C',octave:4},'s':{note:'D',octave:4},'d':{note:'Eb',octave:4},'f':{note:'F',octave:4},'g':{note:'G',octave:4},'h':{note:'A',octave:4},'j':{note:'Bb',octave:4},'k':{note:'C',octave:5},'l':{note:'D',octave:5},';':{note:'Eb',octave:5},
      'q':{note:'C',octave:5},'w':{note:'D',octave:5},'e':{note:'Eb',octave:5},'r':{note:'F',octave:5},'t':{note:'G',octave:5},'y':{note:'A',octave:5},'u':{note:'Bb',octave:5},'i':{note:'C',octave:6},'o':{note:'D',octave:6},'p':{note:'Eb',octave:6},
      '1':{note:'C',octave:6},'2':{note:'D',octave:6},'3':{note:'Eb',octave:6},'4':{note:'F',octave:6},'5':{note:'G',octave:6},'6':{note:'A',octave:6},'7':{note:'Bb',octave:6},'8':{note:'C',octave:7},'9':{note:'D',octave:7},'0':{note:'Eb',octave:7}
    },
    'Phrygian': {
      'z':{note:'C',octave:3},'x':{note:'Db',octave:3},'c':{note:'Eb',octave:3},'v':{note:'F',octave:3},'b':{note:'G',octave:3},'n':{note:'Ab',octave:3},'m':{note:'Bb',octave:3},',':{note:'C',octave:4},'.':{note:'Db',octave:4},'/':{note:'Eb',octave:4},
      'a':{note:'C',octave:4},'s':{note:'Db',octave:4},'d':{note:'Eb',octave:4},'f':{note:'F',octave:4},'g':{note:'G',octave:4},'h':{note:'Ab',octave:4},'j':{note:'Bb',octave:4},'k':{note:'C',octave:5},'l':{note:'Db',octave:5},';':{note:'Eb',octave:5},
      'q':{note:'C',octave:5},'w':{note:'Db',octave:5},'e':{note:'Eb',octave:5},'r':{note:'F',octave:5},'t':{note:'G',octave:5},'y':{note:'Ab',octave:5},'u':{note:'Bb',octave:5},'i':{note:'C',octave:6},'o':{note:'Db',octave:6},'p':{note:'Eb',octave:6},
      '1':{note:'C',octave:6},'2':{note:'Db',octave:6},'3':{note:'Eb',octave:6},'4':{note:'F',octave:6},'5':{note:'G',octave:6},'6':{note:'Ab',octave:6},'7':{note:'Bb',octave:6},'8':{note:'C',octave:7},'9':{note:'Db',octave:7},'0':{note:'Eb',octave:7}
    },
    'Lydian': {
      'z':{note:'C',octave:3},'x':{note:'D',octave:3},'c':{note:'E',octave:3},'v':{note:'F#',octave:3},'b':{note:'G',octave:3},'n':{note:'A',octave:3},'m':{note:'B',octave:3},',':{note:'C',octave:4},'.':{note:'D',octave:4},'/':{note:'E',octave:4},
      'a':{note:'C',octave:4},'s':{note:'D',octave:4},'d':{note:'E',octave:4},'f':{note:'F#',octave:4},'g':{note:'G',octave:4},'h':{note:'A',octave:4},'j':{note:'B',octave:4},'k':{note:'C',octave:5},'l':{note:'D',octave:5},';':{note:'E',octave:5},
      'q':{note:'C',octave:5},'w':{note:'D',octave:5},'e':{note:'E',octave:5},'r':{note:'F#',octave:5},'t':{note:'G',octave:5},'y':{note:'A',octave:5},'u':{note:'B',octave:5},'i':{note:'C',octave:6},'o':{note:'D',octave:6},'p':{note:'E',octave:6},
      '1':{note:'C',octave:6},'2':{note:'D',octave:6},'3':{note:'E',octave:6},'4':{note:'F#',octave:6},'5':{note:'G',octave:6},'6':{note:'A',octave:6},'7':{note:'B',octave:6},'8':{note:'C',octave:7},'9':{note:'D',octave:7},'0':{note:'E',octave:7}
    },
    'Mixolydian': {
      'z':{note:'C',octave:3},'x':{note:'D',octave:3},'c':{note:'E',octave:3},'v':{note:'F',octave:3},'b':{note:'G',octave:3},'n':{note:'A',octave:3},'m':{note:'Bb',octave:3},',':{note:'C',octave:4},'.':{note:'D',octave:4},'/':{note:'E',octave:4},
      'a':{note:'C',octave:4},'s':{note:'D',octave:4},'d':{note:'E',octave:4},'f':{note:'F',octave:4},'g':{note:'G',octave:4},'h':{note:'A',octave:4},'j':{note:'Bb',octave:4},'k':{note:'C',octave:5},'l':{note:'D',octave:5},';':{note:'E',octave:5},
      'q':{note:'C',octave:5},'w':{note:'D',octave:5},'e':{note:'E',octave:5},'r':{note:'F',octave:5},'t':{note:'G',octave:5},'y':{note:'A',octave:5},'u':{note:'Bb',octave:5},'i':{note:'C',octave:6},'o':{note:'D',octave:6},'p':{note:'E',octave:6},
      '1':{note:'C',octave:6},'2':{note:'D',octave:6},'3':{note:'E',octave:6},'4':{note:'F',octave:6},'5':{note:'G',octave:6},'6':{note:'A',octave:6},'7':{note:'Bb',octave:6},'8':{note:'C',octave:7},'9':{note:'D',octave:7},'0':{note:'E',octave:7}
    },
    'Locrian': {
      'z':{note:'C',octave:3},'x':{note:'Db',octave:3},'c':{note:'Eb',octave:3},'v':{note:'F',octave:3},'b':{note:'Gb',octave:3},'n':{note:'Ab',octave:3},'m':{note:'Bb',octave:3},',':{note:'C',octave:4},'.':{note:'Db',octave:4},'/':{note:'Eb',octave:4},
      'a':{note:'C',octave:4},'s':{note:'Db',octave:4},'d':{note:'Eb',octave:4},'f':{note:'F',octave:4},'g':{note:'Gb',octave:4},'h':{note:'Ab',octave:4},'j':{note:'Bb',octave:4},'k':{note:'C',octave:5},'l':{note:'Db',octave:5},';':{note:'Eb',octave:5},
      'q':{note:'C',octave:5},'w':{note:'Db',octave:5},'e':{note:'Eb',octave:5},'r':{note:'F',octave:5},'t':{note:'Gb',octave:5},'y':{note:'Ab',octave:5},'u':{note:'Bb',octave:5},'i':{note:'C',octave:6},'o':{note:'Db',octave:6},'p':{note:'Eb',octave:6},
      '1':{note:'C',octave:6},'2':{note:'Db',octave:6},'3':{note:'Eb',octave:6},'4':{note:'F',octave:6},'5':{note:'Gb',octave:6},'6':{note:'Ab',octave:6},'7':{note:'Bb',octave:6},'8':{note:'C',octave:7},'9':{note:'Db',octave:7},'0':{note:'Eb',octave:7}
    }
  },
  'Db': {
  'Major': { // Db Eb F Gb Ab Bb C
    'z':{note:'Db',octave:3},'x':{note:'Eb',octave:3},'c':{note:'F',octave:3},'v':{note:'Gb',octave:3},'b':{note:'Ab',octave:3},'n':{note:'Bb',octave:3},'m':{note:'C',octave:4},',':{note:'Db',octave:4},'.':{note:'Eb',octave:4},'/':{note:'F',octave:4},
    'a':{note:'Db',octave:4},'s':{note:'Eb',octave:4},'d':{note:'F',octave:4},'f':{note:'Gb',octave:4},'g':{note:'Ab',octave:4},'h':{note:'Bb',octave:4},'j':{note:'C',octave:5},'k':{note:'Db',octave:5},'l':{note:'Eb',octave:5},';':{note:'F',octave:5},
    'q':{note:'Db',octave:5},'w':{note:'Eb',octave:5},'e':{note:'F',octave:5},'r':{note:'Gb',octave:5},'t':{note:'Ab',octave:5},'y':{note:'Bb',octave:5},'u':{note:'C',octave:6},'i':{note:'Db',octave:6},'o':{note:'Eb',octave:6},'p':{note:'F',octave:6},
    '1':{note:'Db',octave:6},'2':{note:'Eb',octave:6},'3':{note:'F',octave:6},'4':{note:'Gb',octave:6},'5':{note:'Ab',octave:6},'6':{note:'Bb',octave:6},'7':{note:'C',octave:7},'8':{note:'Db',octave:7},'9':{note:'Eb',octave:7},'0':{note:'F',octave:7}
  },
  'Natural Minor': { // Db Eb E Gb Ab A Cb
    'z':{note:'Db',octave:3},'x':{note:'Eb',octave:3},'c':{note:'E',octave:3},'v':{note:'Gb',octave:3},'b':{note:'Ab',octave:3},'n':{note:'A',octave:3},'m':{note:'Cb',octave:4},',':{note:'Db',octave:4},'.':{note:'Eb',octave:4},'/':{note:'E',octave:4},
    'a':{note:'Db',octave:4},'s':{note:'Eb',octave:4},'d':{note:'E',octave:4},'f':{note:'Gb',octave:4},'g':{note:'Ab',octave:4},'h':{note:'A',octave:4},'j':{note:'Cb',octave:5},'k':{note:'Db',octave:5},'l':{note:'Eb',octave:5},';':{note:'E',octave:5},
    'q':{note:'Db',octave:5},'w':{note:'Eb',octave:5},'e':{note:'E',octave:5},'r':{note:'Gb',octave:5},'t':{note:'Ab',octave:5},'y':{note:'A',octave:5},'u':{note:'Cb',octave:6},'i':{note:'Db',octave:6},'o':{note:'Eb',octave:6},'p':{note:'E',octave:6},
    '1':{note:'Db',octave:6},'2':{note:'Eb',octave:6},'3':{note:'E',octave:6},'4':{note:'Gb',octave:6},'5':{note:'Ab',octave:6},'6':{note:'A',octave:6},'7':{note:'Cb',octave:7},'8':{note:'Db',octave:7},'9':{note:'Eb',octave:7},'0':{note:'E',octave:7}
  },
  'Harmonic Minor': { // Db Eb E Gb Ab A C
    'z':{note:'Db',octave:3},'x':{note:'Eb',octave:3},'c':{note:'E',octave:3},'v':{note:'Gb',octave:3},'b':{note:'Ab',octave:3},'n':{note:'A',octave:3},'m':{note:'C',octave:4},',':{note:'Db',octave:4},'.':{note:'Eb',octave:4},'/':{note:'E',octave:4},
    'a':{note:'Db',octave:4},'s':{note:'Eb',octave:4},'d':{note:'E',octave:4},'f':{note:'Gb',octave:4},'g':{note:'Ab',octave:4},'h':{note:'A',octave:4},'j':{note:'C',octave:5},'k':{note:'Db',octave:5},'l':{note:'Eb',octave:5},';':{note:'E',octave:5},
    'q':{note:'Db',octave:5},'w':{note:'Eb',octave:5},'e':{note:'E',octave:5},'r':{note:'Gb',octave:5},'t':{note:'Ab',octave:5},'y':{note:'A',octave:5},'u':{note:'C',octave:6},'i':{note:'Db',octave:6},'o':{note:'Eb',octave:6},'p':{note:'E',octave:6},
    '1':{note:'Db',octave:6},'2':{note:'Eb',octave:6},'3':{note:'E',octave:6},'4':{note:'Gb',octave:6},'5':{note:'Ab',octave:6},'6':{note:'A',octave:6},'7':{note:'C',octave:7},'8':{note:'Db',octave:7},'9':{note:'Eb',octave:7},'0':{note:'E',octave:7}
  },
  'Melodic Minor': { // ascending: Db Eb E Gb Ab Bb C
    'z':{note:'Db',octave:3},'x':{note:'Eb',octave:3},'c':{note:'E',octave:3},'v':{note:'Gb',octave:3},'b':{note:'Ab',octave:3},'n':{note:'Bb',octave:3},'m':{note:'C',octave:4},',':{note:'Db',octave:4},'.':{note:'Eb',octave:4},'/':{note:'E',octave:4},
    'a':{note:'Db',octave:4},'s':{note:'Eb',octave:4},'d':{note:'E',octave:4},'f':{note:'Gb',octave:4},'g':{note:'Ab',octave:4},'h':{note:'Bb',octave:4},'j':{note:'C',octave:5},'k':{note:'Db',octave:5},'l':{note:'Eb',octave:5},';':{note:'E',octave:5},
    'q':{note:'Db',octave:5},'w':{note:'Eb',octave:5},'e':{note:'E',octave:5},'r':{note:'Gb',octave:5},'t':{note:'Ab',octave:5},'y':{note:'Bb',octave:5},'u':{note:'C',octave:6},'i':{note:'Db',octave:6},'o':{note:'Eb',octave:6},'p':{note:'E',octave:6},
    '1':{note:'Db',octave:6},'2':{note:'Eb',octave:6},'3':{note:'E',octave:6},'4':{note:'Gb',octave:6},'5':{note:'Ab',octave:6},'6':{note:'Bb',octave:6},'7':{note:'C',octave:7},'8':{note:'Db',octave:7},'9':{note:'Eb',octave:7},'0':{note:'E',octave:7}
  },
  'Dorian': { // Db Eb E Gb Ab Bb Cb
    'z':{note:'Db',octave:3},'x':{note:'Eb',octave:3},'c':{note:'E',octave:3},'v':{note:'Gb',octave:3},'b':{note:'Ab',octave:3},'n':{note:'Bb',octave:3},'m':{note:'Cb',octave:4},',':{note:'Db',octave:4},'.':{note:'Eb',octave:4},'/':{note:'E',octave:4},
    'a':{note:'Db',octave:4},'s':{note:'Eb',octave:4},'d':{note:'E',octave:4},'f':{note:'Gb',octave:4},'g':{note:'Ab',octave:4},'h':{note:'Bb',octave:4},'j':{note:'Cb',octave:5},'k':{note:'Db',octave:5},'l':{note:'Eb',octave:5},';':{note:'E',octave:5},
    'q':{note:'Db',octave:5},'w':{note:'Eb',octave:5},'e':{note:'E',octave:5},'r':{note:'Gb',octave:5},'t':{note:'Ab',octave:5},'y':{note:'Bb',octave:5},'u':{note:'Cb',octave:6},'i':{note:'Db',octave:6},'o':{note:'Eb',octave:6},'p':{note:'E',octave:6},
    '1':{note:'Db',octave:6},'2':{note:'Eb',octave:6},'3':{note:'E',octave:6},'4':{note:'Gb',octave:6},'5':{note:'Ab',octave:6},'6':{note:'Bb',octave:6},'7':{note:'Cb',octave:7},'8':{note:'Db',octave:7},'9':{note:'Eb',octave:7},'0':{note:'E',octave:7}
  },
  'Phrygian': { // Db D E Gb Ab A Cb
    'z':{note:'Db',octave:3},'x':{note:'D',octave:3},'c':{note:'E',octave:3},'v':{note:'Gb',octave:3},'b':{note:'Ab',octave:3},'n':{note:'A',octave:3},'m':{note:'Cb',octave:4},',':{note:'Db',octave:4},'.':{note:'D',octave:4},'/':{note:'E',octave:4},
    'a':{note:'Db',octave:4},'s':{note:'D',octave:4},'d':{note:'E',octave:4},'f':{note:'Gb',octave:4},'g':{note:'Ab',octave:4},'h':{note:'A',octave:4},'j':{note:'Cb',octave:5},'k':{note:'Db',octave:5},'l':{note:'D',octave:5},';':{note:'E',octave:5},
    'q':{note:'Db',octave:5},'w':{note:'D',octave:5},'e':{note:'E',octave:5},'r':{note:'Gb',octave:5},'t':{note:'Ab',octave:5},'y':{note:'A',octave:5},'u':{note:'Cb',octave:6},'i':{note:'Db',octave:6},'o':{note:'D',octave:6},'p':{note:'E',octave:6},
    '1':{note:'Db',octave:6},'2':{note:'D',octave:6},'3':{note:'E',octave:6},'4':{note:'Gb',octave:6},'5':{note:'Ab',octave:6},'6':{note:'A',octave:6},'7':{note:'Cb',octave:7},'8':{note:'Db',octave:7},'9':{note:'D',octave:7},'0':{note:'E',octave:7}
  },
  'Lydian': { // Db Eb F G Ab Bb C
    'z':{note:'Db',octave:3},'x':{note:'Eb',octave:3},'c':{note:'F',octave:3},'v':{note:'G',octave:3},'b':{note:'Ab',octave:3},'n':{note:'Bb',octave:3},'m':{note:'C',octave:4},',':{note:'Db',octave:4},'.':{note:'Eb',octave:4},'/':{note:'F',octave:4},
    'a':{note:'Db',octave:4},'s':{note:'Eb',octave:4},'d':{note:'F',octave:4},'f':{note:'G',octave:4},'g':{note:'Ab',octave:4},'h':{note:'Bb',octave:4},'j':{note:'C',octave:5},'k':{note:'Db',octave:5},'l':{note:'Eb',octave:5},';':{note:'F',octave:5},
    'q':{note:'Db',octave:5},'w':{note:'Eb',octave:5},'e':{note:'F',octave:5},'r':{note:'G',octave:5},'t':{note:'Ab',octave:5},'y':{note:'Bb',octave:5},'u':{note:'C',octave:6},'i':{note:'Db',octave:6},'o':{note:'Eb',octave:6},'p':{note:'F',octave:6},
    '1':{note:'Db',octave:6},'2':{note:'Eb',octave:6},'3':{note:'F',octave:6},'4':{note:'G',octave:6},'5':{note:'Ab',octave:6},'6':{note:'Bb',octave:6},'7':{note:'C',octave:7},'8':{note:'Db',octave:7},'9':{note:'Eb',octave:7},'0':{note:'F',octave:7}
  },
  'Mixolydian': { // Db Eb F Gb Ab Bb Cb
    'z':{note:'Db',octave:3},'x':{note:'Eb',octave:3},'c':{note:'F',octave:3},'v':{note:'Gb',octave:3},'b':{note:'Ab',octave:3},'n':{note:'Bb',octave:3},'m':{note:'Cb',octave:4},',':{note:'Db',octave:4},'.':{note:'Eb',octave:4},'/':{note:'F',octave:4},
    'a':{note:'Db',octave:4},'s':{note:'Eb',octave:4},'d':{note:'F',octave:4},'f':{note:'Gb',octave:4},'g':{note:'Ab',octave:4},'h':{note:'Bb',octave:4},'j':{note:'Cb',octave:5},'k':{note:'Db',octave:5},'l':{note:'Eb',octave:5},';':{note:'F',octave:5},
    'q':{note:'Db',octave:5},'w':{note:'Eb',octave:5},'e':{note:'F',octave:5},'r':{note:'Gb',octave:5},'t':{note:'Ab',octave:5},'y':{note:'Bb',octave:5},'u':{note:'Cb',octave:6},'i':{note:'Db',octave:6},'o':{note:'Eb',octave:6},'p':{note:'F',octave:6},
    '1':{note:'Db',octave:6},'2':{note:'Eb',octave:6},'3':{note:'F',octave:6},'4':{note:'Gb',octave:6},'5':{note:'Ab',octave:6},'6':{note:'Bb',octave:6},'7':{note:'Cb',octave:7},'8':{note:'Db',octave:7},'9':{note:'Eb',octave:7},'0':{note:'F',octave:7}
  },
  'Locrian': { // Db D E Gb G A Cb
    'z':{note:'Db',octave:3},'x':{note:'D',octave:3},'c':{note:'E',octave:3},'v':{note:'Gb',octave:3},'b':{note:'G',octave:3},'n':{note:'A',octave:3},'m':{note:'Cb',octave:4},',':{note:'Db',octave:4},'.':{note:'D',octave:4},'/':{note:'E',octave:4},
    'a':{note:'Db',octave:4},'s':{note:'D',octave:4},'d':{note:'E',octave:4},'f':{note:'Gb',octave:4},'g':{note:'G',octave:4},'h':{note:'A',octave:4},'j':{note:'Cb',octave:5},'k':{note:'Db',octave:5},'l':{note:'D',octave:5},';':{note:'E',octave:5},
    'q':{note:'Db',octave:5},'w':{note:'D',octave:5},'e':{note:'E',octave:5},'r':{note:'Gb',octave:5},'t':{note:'G',octave:5},'y':{note:'A',octave:5},'u':{note:'Cb',octave:6},'i':{note:'Db',octave:6},'o':{note:'D',octave:6},'p':{note:'E',octave:6},
    '1':{note:'Db',octave:6},'2':{note:'D',octave:6},'3':{note:'E',octave:6},'4':{note:'Gb',octave:6},'5':{note:'G',octave:6},'6':{note:'A',octave:6},'7':{note:'Cb',octave:7},'8':{note:'Db',octave:7},'9':{note:'D',octave:7},'0':{note:'E',octave:7}
  }
},
  'D': {
    'Major': {"z":{"note":"D","octave":3},"x":{"note":"E","octave":3},"c":{"note":"F#","octave":3},"v":{"note":"G","octave":3},"b":{"note":"A","octave":3},"n":{"note":"B","octave":3},"m":{"note":"C#","octave":4},",":{"note":"D","octave":4},".":{"note":"E","octave":4},"/":{"note":"F#","octave":4},"a":{"note":"D","octave":4},"s":{"note":"E","octave":4},"d":{"note":"F#","octave":4},"f":{"note":"G","octave":4},"g":{"note":"A","octave":4},"h":{"note":"B","octave":4},"j":{"note":"C#","octave":5},"k":{"note":"D","octave":5},"l":{"note":"E","octave":5},";":{"note":"F#","octave":5},"q":{"note":"D","octave":5},"w":{"note":"E","octave":5},"e":{"note":"F#","octave":5},"r":{"note":"G","octave":5},"t":{"note":"A","octave":5},"y":{"note":"B","octave":5},"u":{"note":"C#","octave":6},"i":{"note":"D","octave":6},"o":{"note":"E","octave":6},"p":{"note":"F#","octave":6},"1":{"note":"D","octave":6},"2":{"note":"E","octave":6},"3":{"note":"F#","octave":6},"4":{"note":"G","octave":6},"5":{"note":"A","octave":6},"6":{"note":"B","octave":6},"7":{"note":"C#","octave":7},"8":{"note":"D","octave":7},"9":{"note":"E","octave":7},"0":{"note":"F#","octave":7}},
    'Natural Minor': {"z":{"note":"D","octave":3},"x":{"note":"E","octave":3},"c":{"note":"F","octave":3},"v":{"note":"G","octave":3},"b":{"note":"A","octave":3},"n":{"note":"Bb","octave":3},"m":{"note":"C","octave":4},",":{"note":"D","octave":4},".":{"note":"E","octave":4},"/":{"note":"F","octave":4},"a":{"note":"D","octave":4},"s":{"note":"E","octave":4},"d":{"note":"F","octave":4},"f":{"note":"G","octave":4},"g":{"note":"A","octave":4},"h":{"note":"Bb","octave":4},"j":{"note":"C","octave":5},"k":{"note":"D","octave":5},"l":{"note":"E","octave":5},";":{"note":"F","octave":5},"q":{"note":"D","octave":5},"w":{"note":"E","octave":5},"e":{"note":"F","octave":5},"r":{"note":"G","octave":5},"t":{"note":"A","octave":5},"y":{"note":"Bb","octave":5},"u":{"note":"C","octave":6},"i":{"note":"D","octave":6},"o":{"note":"E","octave":6},"p":{"note":"F","octave":6},"1":{"note":"D","octave":6},"2":{"note":"E","octave":6},"3":{"note":"F","octave":6},"4":{"note":"G","octave":6},"5":{"note":"A","octave":6},"6":{"note":"Bb","octave":6},"7":{"note":"C","octave":7},"8":{"note":"D","octave":7},"9":{"note":"E","octave":7},"0":{"note":"F","octave":7}},
    'Harmonic Minor': {"z":{"note":"D","octave":3},"x":{"note":"E","octave":3},"c":{"note":"F","octave":3},"v":{"note":"G","octave":3},"b":{"note":"A","octave":3},"n":{"note":"Bb","octave":3},"m":{"note":"C#","octave":4},",":{"note":"D","octave":4},".":{"note":"E","octave":4},"/":{"note":"F","octave":4},"a":{"note":"D","octave":4},"s":{"note":"E","octave":4},"d":{"note":"F","octave":4},"f":{"note":"G","octave":4},"g":{"note":"A","octave":4},"h":{"note":"Bb","octave":4},"j":{"note":"C#","octave":5},"k":{"note":"D","octave":5},"l":{"note":"E","octave":5},";":{"note":"F","octave":5},"q":{"note":"D","octave":5},"w":{"note":"E","octave":5},"e":{"note":"F","octave":5},"r":{"note":"G","octave":5},"t":{"note":"A","octave":5},"y":{"note":"Bb","octave":5},"u":{"note":"C#","octave":6},"i":{"note":"D","octave":6},"o":{"note":"E","octave":6},"p":{"note":"F","octave":6},"1":{"note":"D","octave":6},"2":{"note":"E","octave":6},"3":{"note":"F","octave":6},"4":{"note":"G","octave":6},"5":{"note":"A","octave":6},"6":{"note":"Bb","octave":6},"7":{"note":"C#","octave":7},"8":{"note":"D","octave":7},"9":{"note":"E","octave":7},"0":{"note":"F","octave":7}},
    'Melodic Minor': {"z":{"note":"D","octave":3},"x":{"note":"E","octave":3},"c":{"note":"F","octave":3},"v":{"note":"G","octave":3},"b":{"note":"A","octave":3},"n":{"note":"B","octave":3},"m":{"note":"C#","octave":4},",":{"note":"D","octave":4},".":{"note":"E","octave":4},"/":{"note":"F","octave":4},"a":{"note":"D","octave":4},"s":{"note":"E","octave":4},"d":{"note":"F","octave":4},"f":{"note":"G","octave":4},"g":{"note":"A","octave":4},"h":{"note":"B","octave":4},"j":{"note":"C#","octave":5},"k":{"note":"D","octave":5},"l":{"note":"E","octave":5},";":{"note":"F","octave":5},"q":{"note":"D","octave":5},"w":{"note":"E","octave":5},"e":{"note":"F","octave":5},"r":{"note":"G","octave":5},"t":{"note":"A","octave":5},"y":{"note":"B","octave":5},"u":{"note":"C#","octave":6},"i":{"note":"D","octave":6},"o":{"note":"E","octave":6},"p":{"note":"F","octave":6},"1":{"note":"D","octave":6},"2":{"note":"E","octave":6},"3":{"note":"F","octave":6},"4":{"note":"G","octave":6},"5":{"note":"A","octave":6},"6":{"note":"B","octave":6},"7":{"note":"C#","octave":7},"8":{"note":"D","octave":7},"9":{"note":"E","octave":7},"0":{"note":"F","octave":7}},
    'Dorian': {"z":{"note":"D","octave":3},"x":{"note":"E","octave":3},"c":{"note":"F","octave":3},"v":{"note":"G","octave":3},"b":{"note":"A","octave":3},"n":{"note":"B","octave":3},"m":{"note":"C","octave":4},",":{"note":"D","octave":4},".":{"note":"E","octave":4},"/":{"note":"F","octave":4},"a":{"note":"D","octave":4},"s":{"note":"E","octave":4},"d":{"note":"F","octave":4},"f":{"note":"G","octave":4},"g":{"note":"A","octave":4},"h":{"note":"B","octave":4},"j":{"note":"C","octave":5},"k":{"note":"D","octave":5},"l":{"note":"E","octave":5},";":{"note":"F","octave":5},"q":{"note":"D","octave":5},"w":{"note":"E","octave":5},"e":{"note":"F","octave":5},"r":{"note":"G","octave":5},"t":{"note":"A","octave":5},"y":{"note":"B","octave":5},"u":{"note":"C","octave":6},"i":{"note":"D","octave":6},"o":{"note":"E","octave":6},"p":{"note":"F","octave":6},"1":{"note":"D","octave":6},"2":{"note":"E","octave":6},"3":{"note":"F","octave":6},"4":{"note":"G","octave":6},"5":{"note":"A","octave":6},"6":{"note":"B","octave":6},"7":{"note":"C","octave":7},"8":{"note":"D","octave":7},"9":{"note":"E","octave":7},"0":{"note":"F","octave":7}},
    'Phrygian': {"z":{"note":"D","octave":3},"x":{"note":"Eb","octave":3},"c":{"note":"F","octave":3},"v":{"note":"G","octave":3},"b":{"note":"A","octave":3},"n":{"note":"Bb","octave":3},"m":{"note":"C","octave":4},",":{"note":"D","octave":4},".":{"note":"Eb","octave":4},"/":{"note":"F","octave":4},"a":{"note":"D","octave":4},"s":{"note":"Eb","octave":4},"d":{"note":"F","octave":4},"f":{"note":"G","octave":4},"g":{"note":"A","octave":4},"h":{"note":"Bb","octave":4},"j":{"note":"C","octave":5},"k":{"note":"D","octave":5},"l":{"note":"Eb","octave":5},";":{"note":"F","octave":5},"q":{"note":"D","octave":5},"w":{"note":"Eb","octave":5},"e":{"note":"F","octave":5},"r":{"note":"G","octave":5},"t":{"note":"A","octave":5},"y":{"note":"Bb","octave":5},"u":{"note":"C","octave":6},"i":{"note":"D","octave":6},"o":{"note":"Eb","octave":6},"p":{"note":"F","octave":6},"1":{"note":"D","octave":6},"2":{"note":"Eb","octave":6},"3":{"note":"F","octave":6},"4":{"note":"G","octave":6},"5":{"note":"A","octave":6},"6":{"note":"Bb","octave":6},"7":{"note":"C","octave":7},"8":{"note":"D","octave":7},"9":{"note":"Eb","octave":7},"0":{"note":"F","octave":7}},
    'Lydian': {"z":{"note":"D","octave":3},"x":{"note":"E","octave":3},"c":{"note":"F#","octave":3},"v":{"note":"G#","octave":3},"b":{"note":"A","octave":3},"n":{"note":"B","octave":3},"m":{"note":"C#","octave":4},",":{"note":"D","octave":4},".":{"note":"E","octave":4},"/":{"note":"F#","octave":4},"a":{"note":"D","octave":4},"s":{"note":"E","octave":4},"d":{"note":"F#","octave":4},"f":{"note":"G#","octave":4},"g":{"note":"A","octave":4},"h":{"note":"B","octave":4},"j":{"note":"C#","octave":5},"k":{"note":"D","octave":5},"l":{"note":"E","octave":5},";":{"note":"F#","octave":5},"q":{"note":"D","octave":5},"w":{"note":"E","octave":5},"e":{"note":"F#","octave":5},"r":{"note":"G#","octave":5},"t":{"note":"A","octave":5},"y":{"note":"B","octave":5},"u":{"note":"C#","octave":6},"i":{"note":"D","octave":6},"o":{"note":"E","octave":6},"p":{"note":"F#","octave":6},"1":{"note":"D","octave":6},"2":{"note":"E","octave":6},"3":{"note":"F#","octave":6},"4":{"note":"G#","octave":6},"5":{"note":"A","octave":6},"6":{"note":"B","octave":6},"7":{"note":"C#","octave":7},"8":{"note":"D","octave":7},"9":{"note":"E","octave":7},"0":{"note":"F#","octave":7}},
    'Mixolydian': {"z":{"note":"D","octave":3},"x":{"note":"E","octave":3},"c":{"note":"F#","octave":3},"v":{"note":"G","octave":3},"b":{"note":"A","octave":3},"n":{"note":"B","octave":3},"m":{"note":"C","octave":4},",":{"note":"D","octave":4},".":{"note":"E","octave":4},"/":{"note":"F#","octave":4},"a":{"note":"D","octave":4},"s":{"note":"E","octave":4},"d":{"note":"F#","octave":4},"f":{"note":"G","octave":4},"g":{"note":"A","octave":4},"h":{"note":"B","octave":4},"j":{"note":"C","octave":5},"k":{"note":"D","octave":5},"l":{"note":"E","octave":5},";":{"note":"F#","octave":5},"q":{"note":"D","octave":5},"w":{"note":"E","octave":5},"e":{"note":"F#","octave":5},"r":{"note":"G","octave":5},"t":{"note":"A","octave":5},"y":{"note":"B","octave":5},"u":{"note":"C","octave":6},"i":{"note":"D","octave":6},"o":{"note":"E","octave":6},"p":{"note":"F#","octave":6},"1":{"note":"D","octave":6},"2":{"note":"E","octave":6},"3":{"note":"F#","octave":6},"4":{"note":"G","octave":6},"5":{"note":"A","octave":6},"6":{"note":"B","octave":6},"7":{"note":"C","octave":7},"8":{"note":"D","octave":7},"9":{"note":"E","octave":7},"0":{"note":"F#","octave":7}},
    'Locrian': {"z":{"note":"D","octave":3},"x":{"note":"Eb","octave":3},"c":{"note":"F","octave":3},"v":{"note":"G","octave":3},"b":{"note":"Ab","octave":3},"n":{"note":"Bb","octave":3},"m":{"note":"C","octave":4},",":{"note":"D","octave":4},".":{"note":"Eb","octave":4},"/":{"note":"F","octave":4},"a":{"note":"D","octave":4},"s":{"note":"Eb","octave":4},"d":{"note":"F","octave":4},"f":{"note":"G","octave":4},"g":{"note":"Ab","octave":4},"h":{"note":"Bb","octave":4},"j":{"note":"C","octave":5},"k":{"note":"D","octave":5},"l":{"note":"Eb","octave":5},";":{"note":"F","octave":5},"q":{"note":"D","octave":5},"w":{"note":"Eb","octave":5},"e":{"note":"F","octave":5},"r":{"note":"G","octave":5},"t":{"note":"Ab","octave":5},"y":{"note":"Bb","octave":5},"u":{"note":"C","octave":6},"i":{"note":"D","octave":6},"o":{"note":"Eb","octave":6},"p":{"note":"F","octave":6},"1":{"note":"D","octave":6},"2":{"note":"Eb","octave":6},"3":{"note":"F","octave":6},"4":{"note":"G","octave":6},"5":{"note":"Ab","octave":6},"6":{"note":"Bb","octave":6},"7":{"note":"C","octave":7},"8":{"note":"D","octave":7},"9":{"note":"Eb","octave":7},"0":{"note":"F","octave":7}}
  },
  'Eb': {
  'Major': { // Eb F G Ab Bb C D
    'z':{note:'Eb',octave:3},'x':{note:'F',octave:3},'c':{note:'G',octave:3},'v':{note:'Ab',octave:3},'b':{note:'Bb',octave:3},'n':{note:'C',octave:4},'m':{note:'D',octave:4},',':{note:'Eb',octave:4},'.':{note:'F',octave:4},'/':{note:'G',octave:4},
    'a':{note:'Eb',octave:4},'s':{note:'F',octave:4},'d':{note:'G',octave:4},'f':{note:'Ab',octave:4},'g':{note:'Bb',octave:4},'h':{note:'C',octave:5},'j':{note:'D',octave:5},'k':{note:'Eb',octave:5},'l':{note:'F',octave:5},';':{note:'G',octave:5},
    'q':{note:'Eb',octave:5},'w':{note:'F',octave:5},'e':{note:'G',octave:5},'r':{note:'Ab',octave:5},'t':{note:'Bb',octave:5},'y':{note:'C',octave:6},'u':{note:'D',octave:6},'i':{note:'Eb',octave:6},'o':{note:'F',octave:6},'p':{note:'G',octave:6},
    '1':{note:'Eb',octave:6},'2':{note:'F',octave:6},'3':{note:'G',octave:6},'4':{note:'Ab',octave:6},'5':{note:'Bb',octave:6},'6':{note:'C',octave:7},'7':{note:'D',octave:7},'8':{note:'Eb',octave:7},'9':{note:'F',octave:7},'0':{note:'G',octave:7}
  },
  'Natural Minor': { // Eb F Gb Ab Bb B Db
    'z':{note:'Eb',octave:3},'x':{note:'F',octave:3},'c':{note:'Gb',octave:3},'v':{note:'Ab',octave:3},'b':{note:'Bb',octave:3},'n':{note:'B',octave:4},'m':{note:'Db',octave:4},',':{note:'Eb',octave:4},'.':{note:'F',octave:4},'/':{note:'Gb',octave:4},
    'a':{note:'Eb',octave:4},'s':{note:'F',octave:4},'d':{note:'Gb',octave:4},'f':{note:'Ab',octave:4},'g':{note:'Bb',octave:4},'h':{note:'B',octave:5},'j':{note:'Db',octave:5},'k':{note:'Eb',octave:5},'l':{note:'F',octave:5},';':{note:'Gb',octave:5},
    'q':{note:'Eb',octave:5},'w':{note:'F',octave:5},'e':{note:'Gb',octave:5},'r':{note:'Ab',octave:5},'t':{note:'Bb',octave:5},'y':{note:'B',octave:6},'u':{note:'Db',octave:6},'i':{note:'Eb',octave:6},'o':{note:'F',octave:6},'p':{note:'Gb',octave:6},
    '1':{note:'Eb',octave:6},'2':{note:'F',octave:6},'3':{note:'Gb',octave:6},'4':{note:'Ab',octave:6},'5':{note:'Bb',octave:6},'6':{note:'B',octave:7},'7':{note:'Db',octave:7},'8':{note:'Eb',octave:7},'9':{note:'F',octave:7},'0':{note:'Gb',octave:7}
  },
  'Harmonic Minor': { // Eb F Gb Ab Bb B D
    'z':{note:'Eb',octave:3},'x':{note:'F',octave:3},'c':{note:'Gb',octave:3},'v':{note:'Ab',octave:3},'b':{note:'Bb',octave:3},'n':{note:'B',octave:4},'m':{note:'D',octave:4},',':{note:'Eb',octave:4},'.':{note:'F',octave:4},'/':{note:'Gb',octave:4},
    'a':{note:'Eb',octave:4},'s':{note:'F',octave:4},'d':{note:'Gb',octave:4},'f':{note:'Ab',octave:4},'g':{note:'Bb',octave:4},'h':{note:'B',octave:5},'j':{note:'D',octave:5},'k':{note:'Eb',octave:5},'l':{note:'F',octave:5},';':{note:'Gb',octave:5},
    'q':{note:'Eb',octave:5},'w':{note:'F',octave:5},'e':{note:'Gb',octave:5},'r':{note:'Ab',octave:5},'t':{note:'Bb',octave:5},'y':{note:'B',octave:6},'u':{note:'D',octave:6},'i':{note:'Eb',octave:6},'o':{note:'F',octave:6},'p':{note:'Gb',octave:6},
    '1':{note:'Eb',octave:6},'2':{note:'F',octave:6},'3':{note:'Gb',octave:6},'4':{note:'Ab',octave:6},'5':{note:'Bb',octave:6},'6':{note:'B',octave:7},'7':{note:'D',octave:7},'8':{note:'Eb',octave:7},'9':{note:'F',octave:7},'0':{note:'Gb',octave:7}
  },
  'Melodic Minor': { // ascending: Eb F Gb Ab Bb C D
    'z':{note:'Eb',octave:3},'x':{note:'F',octave:3},'c':{note:'Gb',octave:3},'v':{note:'Ab',octave:3},'b':{note:'Bb',octave:3},'n':{note:'C',octave:4},'m':{note:'D',octave:4},',':{note:'Eb',octave:4},'.':{note:'F',octave:4},'/':{note:'Gb',octave:4},
    'a':{note:'Eb',octave:4},'s':{note:'F',octave:4},'d':{note:'Gb',octave:4},'f':{note:'Ab',octave:4},'g':{note:'Bb',octave:4},'h':{note:'C',octave:5},'j':{note:'D',octave:5},'k':{note:'Eb',octave:5},'l':{note:'F',octave:5},';':{note:'Gb',octave:5},
    'q':{note:'Eb',octave:5},'w':{note:'F',octave:5},'e':{note:'Gb',octave:5},'r':{note:'Ab',octave:5},'t':{note:'Bb',octave:5},'y':{note:'C',octave:6},'u':{note:'D',octave:6},'i':{note:'Eb',octave:6},'o':{note:'F',octave:6},'p':{note:'Gb',octave:6},
    '1':{note:'Eb',octave:6},'2':{note:'F',octave:6},'3':{note:'Gb',octave:6},'4':{note:'Ab',octave:6},'5':{note:'Bb',octave:6},'6':{note:'C',octave:7},'7':{note:'D',octave:7},'8':{note:'Eb',octave:7},'9':{note:'F',octave:7},'0':{note:'Gb',octave:7}
  },
  'Dorian': { // Eb F Gb Ab Bb C Db
    'z':{note:'Eb',octave:3},'x':{note:'F',octave:3},'c':{note:'Gb',octave:3},'v':{note:'Ab',octave:3},'b':{note:'Bb',octave:3},'n':{note:'C',octave:4},'m':{note:'Db',octave:4},',':{note:'Eb',octave:4},'.':{note:'F',octave:4},'/':{note:'Gb',octave:4},
    'a':{note:'Eb',octave:4},'s':{note:'F',octave:4},'d':{note:'Gb',octave:4},'f':{note:'Ab',octave:4},'g':{note:'Bb',octave:4},'h':{note:'C',octave:5},'j':{note:'Db',octave:5},'k':{note:'Eb',octave:5},'l':{note:'F',octave:5},';':{note:'Gb',octave:5},
    'q':{note:'Eb',octave:5},'w':{note:'F',octave:5},'e':{note:'Gb',octave:5},'r':{note:'Ab',octave:5},'t':{note:'Bb',octave:5},'y':{note:'C',octave:6},'u':{note:'Db',octave:6},'i':{note:'Eb',octave:6},'o':{note:'F',octave:6},'p':{note:'Gb',octave:6},
    '1':{note:'Eb',octave:6},'2':{note:'F',octave:6},'3':{note:'Gb',octave:6},'4':{note:'Ab',octave:6},'5':{note:'Bb',octave:6},'6':{note:'C',octave:7},'7':{note:'Db',octave:7},'8':{note:'Eb',octave:7},'9':{note:'F',octave:7},'0':{note:'Gb',octave:7}
  },
  'Phrygian': { // Eb E Gb Ab Bb B Db
    'z':{note:'Eb',octave:3},'x':{note:'E',octave:3},'c':{note:'Gb',octave:3},'v':{note:'Ab',octave:3},'b':{note:'Bb',octave:3},'n':{note:'B',octave:4},'m':{note:'Db',octave:4},',':{note:'Eb',octave:4},'.':{note:'E',octave:4},'/':{note:'Gb',octave:4},
    'a':{note:'Eb',octave:4},'s':{note:'E',octave:4},'d':{note:'Gb',octave:4},'f':{note:'Ab',octave:4},'g':{note:'Bb',octave:4},'h':{note:'B',octave:5},'j':{note:'Db',octave:5},'k':{note:'Eb',octave:5},'l':{note:'E',octave:5},';':{note:'Gb',octave:5},
    'q':{note:'Eb',octave:5},'w':{note:'E',octave:5},'e':{note:'Gb',octave:5},'r':{note:'Ab',octave:5},'t':{note:'Bb',octave:5},'y':{note:'B',octave:6},'u':{note:'Db',octave:6},'i':{note:'Eb',octave:6},'o':{note:'E',octave:6},'p':{note:'Gb',octave:6},
    '1':{note:'Eb',octave:6},'2':{note:'E',octave:6},'3':{note:'Gb',octave:6},'4':{note:'Ab',octave:6},'5':{note:'Bb',octave:6},'6':{note:'B',octave:6},'7':{note:'Db',octave:7},'8':{note:'Eb',octave:7},'9':{note:'E',octave:7},'0':{note:'Gb',octave:7}
  },
  'Lydian': { // Eb F G A Bb C D
    'z':{note:'Eb',octave:3},'x':{note:'F',octave:3},'c':{note:'G',octave:3},'v':{note:'A',octave:3},'b':{note:'Bb',octave:3},'n':{note:'C',octave:4},'m':{note:'D',octave:4},',':{note:'Eb',octave:4},'.':{note:'F',octave:4},'/':{note:'G',octave:4},
    'a':{note:'Eb',octave:4},'s':{note:'F',octave:4},'d':{note:'G',octave:4},'f':{note:'A',octave:4},'g':{note:'Bb',octave:4},'h':{note:'C',octave:5},'j':{note:'D',octave:5},'k':{note:'Eb',octave:5},'l':{note:'F',octave:5},';':{note:'G',octave:5},
    'q':{note:'Eb',octave:5},'w':{note:'F',octave:5},'e':{note:'G',octave:5},'r':{note:'A',octave:5},'t':{note:'Bb',octave:5},'y':{note:'C',octave:6},'u':{note:'D',octave:6},'i':{note:'Eb',octave:6},'o':{note:'F',octave:6},'p':{note:'G',octave:6},
    '1':{note:'Eb',octave:6},'2':{note:'F',octave:6},'3':{note:'G',octave:6},'4':{note:'A',octave:6},'5':{note:'Bb',octave:6},'6':{note:'C',octave:7},'7':{note:'D',octave:7},'8':{note:'Eb',octave:7},'9':{note:'F',octave:7},'0':{note:'G',octave:7}
  },
  'Mixolydian': { // Eb F G Ab Bb C Db
    'z':{note:'Eb',octave:3},'x':{note:'F',octave:3},'c':{note:'G',octave:3},'v':{note:'Ab',octave:3},'b':{note:'Bb',octave:3},'n':{note:'C',octave:4},'m':{note:'Db',octave:4},',':{note:'Eb',octave:4},'.':{note:'F',octave:4},'/':{note:'G',octave:4},
    'a':{note:'Eb',octave:4},'s':{note:'F',octave:4},'d':{note:'G',octave:4},'f':{note:'Ab',octave:4},'g':{note:'Bb',octave:4},'h':{note:'C',octave:5},'j':{note:'Db',octave:5},'k':{note:'Eb',octave:5},'l':{note:'F',octave:5},';':{note:'G',octave:5},
    'q':{note:'Eb',octave:5},'w':{note:'F',octave:5},'e':{note:'G',octave:5},'r':{note:'Ab',octave:5},'t':{note:'Bb',octave:5},'y':{note:'C',octave:6},'u':{note:'Db',octave:6},'i':{note:'Eb',octave:6},'o':{note:'F',octave:6},'p':{note:'G',octave:6},
    '1':{note:'Eb',octave:6},'2':{note:'F',octave:6},'3':{note:'G',octave:6},'4':{note:'Ab',octave:6},'5':{note:'Bb',octave:6},'6':{note:'C',octave:7},'7':{note:'Db',octave:7},'8':{note:'Eb',octave:7},'9':{note:'F',octave:7},'0':{note:'G',octave:7}
  },
  'Locrian': { // Eb E Gb Ab A B Db
    'z':{note:'Eb',octave:3},'x':{note:'E',octave:3},'c':{note:'Gb',octave:3},'v':{note:'Ab',octave:3},'b':{note:'A',octave:3},'n':{note:'B',octave:3},'m':{note:'Db',octave:4},',':{note:'Eb',octave:4},'.':{note:'E',octave:4},'/':{note:'Gb',octave:4},
    'a':{note:'Eb',octave:4},'s':{note:'E',octave:4},'d':{note:'Gb',octave:4},'f':{note:'Ab',octave:4},'g':{note:'A',octave:4},'h':{note:'B',octave:4},'j':{note:'Db',octave:5},'k':{note:'Eb',octave:5},'l':{note:'E',octave:5},';':{note:'Gb',octave:5},
    'q':{note:'Eb',octave:5},'w':{note:'E',octave:5},'e':{note:'Gb',octave:5},'r':{note:'Ab',octave:5},'t':{note:'A',octave:5},'y':{note:'B',octave:5},'u':{note:'Db',octave:6},'i':{note:'Eb',octave:6},'o':{note:'E',octave:6},'p':{note:'Gb',octave:6},
    '1':{note:'Eb',octave:6},'2':{note:'E',octave:6},'3':{note:'Gb',octave:6},'4':{note:'Ab',octave:6},'5':{note:'A',octave:6},'6':{note:'B',octave:6},'7':{note:'Db',octave:7},'8':{note:'Eb',octave:7},'9':{note:'E',octave:7},'0':{note:'Gb',octave:7}
  }
},
  'E': {
    'Major': {
      "z":{note:'E',octave:3},"x":{note:'F#',octave:3},"c":{note:'G#',octave:3},"v":{note:'A',octave:3},"b":{note:'B',octave:3},"n":{note:'C#',octave:4},"m":{note:'D#',octave:4},",":{note:'E',octave:4},".":{note:'F#',octave:4},"/":{note:'G#',octave:4},
      "a":{note:'E',octave:4},"s":{note:'F#',octave:4},"d":{note:'G#',octave:4},"f":{note:'A',octave:4},"g":{note:'B',octave:4},"h":{note:'C#',octave:4},"j":{note:'D#',octave:5},"k":{note:'E',octave:5},"l":{note:'F#',octave:5},";":{note:'G#',octave:5},
      "q":{note:'E',octave:5},"w":{note:'F#',octave:5},"e":{note:'G#',octave:5},"r":{note:'A',octave:5},"t":{note:'B',octave:5},"y":{note:'C#',octave:6},"u":{note:'D#',octave:6},"i":{note:'E',octave:6},"o":{note:'F#',octave:6},"p":{note:'G#',octave:6},
      "1":{note:'E',octave:6},"2":{note:'F#',octave:6},"3":{note:'G#',octave:6},"4":{note:'A',octave:6},"5":{note:'B',octave:6},"6":{note:'C#',octave:7},"7":{note:'D#',octave:7},"8":{note:'E',octave:7},"9":{note:'F#',octave:7},"0":{note:'G#',octave:7}
    },
    'Natural Minor': {
      "z":{note:'E',octave:3},"x":{note:'F#',octave:3},"c":{note:'G',octave:3},"v":{note:'A',octave:3},"b":{note:'B',octave:3},"n":{note:'C',octave:4},"m":{note:'D',octave:4},",":{note:'E',octave:4},".":{note:'F#',octave:4},"/":{note:'G',octave:4},
      "a":{note:'E',octave:4},"s":{note:'F#',octave:4},"d":{note:'G',octave:4},"f":{note:'A',octave:4},"g":{note:'B',octave:4},"h":{note:'C',octave:4},"j":{note:'D',octave:5},"k":{note:'E',octave:5},"l":{note:'F#',octave:5},";":{note:'G',octave:5},
      "q":{note:'E',octave:5},"w":{note:'F#',octave:5},"e":{note:'G',octave:5},"r":{note:'A',octave:5},"t":{note:'B',octave:5},"y":{note:'C',octave:6},"u":{note:'D',octave:6},"i":{note:'E',octave:6},"o":{note:'F#',octave:6},"p":{note:'G',octave:6},
      "1":{note:'E',octave:6},"2":{note:'F#',octave:6},"3":{note:'G',octave:6},"4":{note:'A',octave:6},"5":{note:'B',octave:6},"6":{note:'C',octave:7},"7":{note:'D',octave:7},"8":{note:'E',octave:7},"9":{note:'F#',octave:7},"0":{note:'G',octave:7}
    },
    'Harmonic Minor': {
      "z":{note:'E',octave:3},"x":{note:'F#',octave:3},"c":{note:'G',octave:3},"v":{note:'A',octave:3},"b":{note:'B',octave:3},"n":{note:'C',octave:4},"m":{note:'D#',octave:4},",":{note:'E',octave:4},".":{note:'F#',octave:4},"/":{note:'G',octave:4},
      "a":{note:'E',octave:4},"s":{note:'F#',octave:4},"d":{note:'G',octave:4},"f":{note:'A',octave:4},"g":{note:'B',octave:4},"h":{note:'C',octave:4},"j":{note:'D#',octave:5},"k":{note:'E',octave:5},"l":{note:'F#',octave:5},";":{note:'G',octave:5},
      "q":{note:'E',octave:5},"w":{note:'F#',octave:5},"e":{note:'G',octave:5},"r":{note:'A',octave:5},"t":{note:'B',octave:5},"y":{note:'C',octave:6},"u":{note:'D#',octave:6},"i":{note:'E',octave:6},"o":{note:'F#',octave:6},"p":{note:'G',octave:6},
      "1":{note:'E',octave:6},"2":{note:'F#',octave:6},"3":{note:'G',octave:6},"4":{note:'A',octave:6},"5":{note:'B',octave:6},"6":{note:'C',octave:7},"7":{note:'D#',octave:7},"8":{note:'E',octave:7},"9":{note:'F#',octave:7},"0":{note:'G',octave:7}
    },
    'Melodic Minor': {
      "z":{note:'E',octave:3},"x":{note:'F#',octave:3},"c":{note:'G',octave:3},"v":{note:'A',octave:3},"b":{note:'B',octave:3},"n":{note:'C#',octave:4},"m":{note:'D#',octave:4},",":{note:'E',octave:4},".":{note:'F#',octave:4},"/":{note:'G',octave:4},
      "a":{note:'E',octave:4},"s":{note:'F#',octave:4},"d":{note:'G',octave:4},"f":{note:'A',octave:4},"g":{note:'B',octave:4},"h":{note:'C#',octave:4},"j":{note:'D#',octave:5},"k":{note:'E',octave:5},"l":{note:'F#',octave:5},";":{note:'G',octave:5},
      "q":{note:'E',octave:5},"w":{note:'F#',octave:5},"e":{note:'G',octave:5},"r":{note:'A',octave:5},"t":{note:'B',octave:5},"y":{note:'C#',octave:6},"u":{note:'D#',octave:6},"i":{note:'E',octave:6},"o":{note:'F#',octave:6},"p":{note:'G',octave:6},
      "1":{note:'E',octave:6},"2":{note:'F#',octave:6},"3":{note:'G',octave:6},"4":{note:'A',octave:6},"5":{note:'B',octave:6},"6":{note:'C#',octave:7},"7":{note:'D#',octave:7},"8":{note:'E',octave:7},"9":{note:'F#',octave:7},"0":{note:'G',octave:7}
    },
    'Dorian': {
      "z":{note:'E',octave:3},"x":{note:'F#',octave:3},"c":{note:'G',octave:3},"v":{note:'A',octave:3},"b":{note:'B',octave:3},"n":{note:'C#',octave:4},"m":{note:'D',octave:4},",":{note:'E',octave:4},".":{note:'F#',octave:4},"/":{note:'G',octave:4},
      "a":{note:'E',octave:4},"s":{note:'F#',octave:4},"d":{note:'G',octave:4},"f":{note:'A',octave:4},"g":{note:'B',octave:4},"h":{note:'C#',octave:4},"j":{note:'D',octave:5},"k":{note:'E',octave:5},"l":{note:'F#',octave:5},";":{note:'G',octave:5},
      "q":{note:'E',octave:5},"w":{note:'F#',octave:5},"e":{note:'G',octave:5},"r":{note:'A',octave:5},"t":{note:'B',octave:5},"y":{note:'C#',octave:6},"u":{note:'D',octave:6},"i":{note:'E',octave:6},"o":{note:'F#',octave:6},"p":{note:'G',octave:6},
      "1":{note:'E',octave:6},"2":{note:'F#',octave:6},"3":{note:'G',octave:6},"4":{note:'A',octave:6},"5":{note:'B',octave:6},"6":{note:'C#',octave:7},"7":{note:'D',octave:7},"8":{note:'E',octave:7},"9":{note:'F#',octave:7},"0":{note:'G',octave:7}
    },
    'Phrygian': {
      "z":{note:'E',octave:3},"x":{note:'F',octave:3},"c":{note:'G',octave:3},"v":{note:'A',octave:3},"b":{note:'B',octave:3},"n":{note:'C',octave:4},"m":{note:'D',octave:4},",":{note:'E',octave:4},".":{note:'F',octave:4},"/":{note:'G',octave:4},
      "a":{note:'E',octave:4},"s":{note:'F',octave:4},"d":{note:'G',octave:4},"f":{note:'A',octave:4},"g":{note:'B',octave:4},"h":{note:'C',octave:4},"j":{note:'D',octave:5},"k":{note:'E',octave:5},"l":{note:'F',octave:5},";":{note:'G',octave:5},
      "q":{note:'E',octave:5},"w":{note:'F',octave:5},"e":{note:'G',octave:5},"r":{note:'A',octave:5},"t":{note:'B',octave:5},"y":{note:'C',octave:6},"u":{note:'D',octave:6},"i":{note:'E',octave:6},"o":{note:'F',octave:6},"p":{note:'G',octave:6},
      "1":{note:'E',octave:6},"2":{note:'F',octave:6},"3":{note:'G',octave:6},"4":{note:'A',octave:6},"5":{note:'B',octave:6},"6":{note:'C',octave:7},"7":{note:'D',octave:7},"8":{note:'E',octave:7},"9":{note:'F',octave:7},"0":{note:'G',octave:7}
    },
    'Lydian': {
      "z":{note:'E',octave:3},"x":{note:'F#',octave:3},"c":{note:'G#',octave:3},"v":{note:'A#',octave:3},"b":{note:'B',octave:3},"n":{note:'C#',octave:4},"m":{note:'D#',octave:4},",":{note:'E',octave:4},".":{note:'F#',octave:4},"/":{note:'G#',octave:4},
      "a":{note:'E',octave:4},"s":{note:'F#',octave:4},"d":{note:'G#',octave:4},"f":{note:'A#',octave:4},"g":{note:'B',octave:4},"h":{note:'C#',octave:4},"j":{note:'D#',octave:5},"k":{note:'E',octave:5},"l":{note:'F#',octave:5},";":{note:'G#',octave:5},
      "q":{note:'E',octave:5},"w":{note:'F#',octave:5},"e":{note:'G#',octave:5},"r":{note:'A#',octave:5},"t":{note:'B',octave:5},"y":{note:'C#',octave:6},"u":{note:'D#',octave:6},"i":{note:'E',octave:6},"o":{note:'F#',octave:6},"p":{note:'G#',octave:6},
      "1":{note:'E',octave:6},"2":{note:'F#',octave:6},"3":{note:'G#',octave:6},"4":{note:'A#',octave:6},"5":{note:'B',octave:6},"6":{note:'C#',octave:7},"7":{note:'D#',octave:7},"8":{note:'E',octave:7},"9":{note:'F#',octave:7},"0":{note:'G#',octave:7}
    },
    'Mixolydian': {
      "z":{note:'E',octave:3},"x":{note:'F#',octave:3},"c":{note:'G#',octave:3},"v":{note:'A',octave:3},"b":{note:'B',octave:3},"n":{note:'C#',octave:4},"m":{note:'D',octave:4},",":{note:'E',octave:4},".":{note:'F#',octave:4},"/":{note:'G#',octave:4},
      "a":{note:'E',octave:4},"s":{note:'F#',octave:4},"d":{note:'G#',octave:4},"f":{note:'A',octave:4},"g":{note:'B',octave:4},"h":{note:'C#',octave:4},"j":{note:'D',octave:5},"k":{note:'E',octave:5},"l":{note:'F#',octave:5},";":{note:'G#',octave:5},
      "q":{note:'E',octave:5},"w":{note:'F#',octave:5},"e":{note:'G#',octave:5},"r":{note:'A',octave:5},"t":{note:'B',octave:5},"y":{note:'C#',octave:6},"u":{note:'D',octave:6},"i":{note:'E',octave:6},"o":{note:'F#',octave:6},"p":{note:'G#',octave:6},
      "1":{note:'E',octave:6},"2":{note:'F#',octave:6},"3":{note:'G#',octave:6},"4":{note:'A',octave:6},"5":{note:'B',octave:6},"6":{note:'C#',octave:7},"7":{note:'D',octave:7},"8":{note:'E',octave:7},"9":{note:'F#',octave:7},"0":{note:'G#',octave:7}
    },
    'Locrian': {
      "z":{note:'E',octave:3},"x":{note:'F',octave:3},"c":{note:'G',octave:3},"v":{note:'A',octave:3},"b":{note:'Bb',octave:3},"n":{note:'C',octave:4},"m":{note:'D',octave:4},",":{note:'E',octave:4},".":{note:'F',octave:4},"/":{note:'G',octave:4},
      "a":{note:'E',octave:4},"s":{note:'F',octave:4},"d":{note:'G',octave:4},"f":{note:'A',octave:4},"g":{note:'Bb',octave:4},"h":{note:'C',octave:4},"j":{note:'D',octave:5},"k":{note:'E',octave:5},"l":{note:'F',octave:5},";":{note:'G',octave:5},
      "q":{note:'E',octave:5},"w":{note:'F',octave:5},"e":{note:'G',octave:5},"r":{note:'A',octave:5},"t":{note:'Bb',octave:5},"y":{note:'C',octave:6},"u":{note:'D',octave:6},"i":{note:'E',octave:6},"o":{note:'F',octave:6},"p":{note:'G',octave:6},
      "1":{note:'E',octave:6},"2":{note:'F',octave:6},"3":{note:'G',octave:6},"4":{note:'A',octave:6},"5":{note:'Bb',octave:6},"6":{note:'C',octave:7},"7":{note:'D',octave:7},"8":{note:'E',octave:7},"9":{note:'F',octave:7},"0":{note:'G',octave:7}
    }
  },
  'F': {
    'Major': {
      'z':{note:'F',octave:3},'x':{note:'G',octave:3},'c':{note:'A',octave:3},'v':{note:'Bb',octave:3},'b':{note:'C',octave:4},'n':{note:'D',octave:4},'m':{note:'E',octave:4},',':{note:'F',octave:4},'.':{note:'G',octave:4},'/':{note:'A',octave:4},
      'a':{note:'F',octave:4},'s':{note:'G',octave:4},'d':{note:'A',octave:4},'f':{note:'Bb',octave:4},'g':{note:'C',octave:5},'h':{note:'D',octave:5},'j':{note:'E',octave:5},'k':{note:'F',octave:5},'l':{note:'G',octave:5},';':{note:'A',octave:5},
      'q':{note:'F',octave:5},'w':{note:'G',octave:5},'e':{note:'A',octave:5},'r':{note:'Bb',octave:5},'t':{note:'C',octave:6},'y':{note:'D',octave:6},'u':{note:'E',octave:6},'i':{note:'F',octave:6},'o':{note:'G',octave:6},'p':{note:'A',octave:6},
      '1':{note:'F',octave:6},'2':{note:'G',octave:6},'3':{note:'A',octave:6},'4':{note:'Bb',octave:6},'5':{note:'C',octave:7},'6':{note:'D',octave:7},'7':{note:'E',octave:7},'8':{note:'F',octave:7},'9':{note:'G',octave:7},'0':{note:'A',octave:7}
    },
    'Natural Minor': {
      'z':{note:'F',octave:3},'x':{note:'G',octave:3},'c':{note:'Ab',octave:3},'v':{note:'Bb',octave:3},'b':{note:'C',octave:4},'n':{note:'Db',octave:4},'m':{note:'Eb',octave:4},',':{note:'F',octave:4},'.':{note:'G',octave:4},'/':{note:'Ab',octave:4},
      'a':{note:'F',octave:4},'s':{note:'G',octave:4},'d':{note:'Ab',octave:4},'f':{note:'Bb',octave:4},'g':{note:'C',octave:5},'h':{note:'Db',octave:5},'j':{note:'Eb',octave:5},'k':{note:'F',octave:5},'l':{note:'G',octave:5},';':{note:'Ab',octave:5},
      'q':{note:'F',octave:5},'w':{note:'G',octave:5},'e':{note:'Ab',octave:5},'r':{note:'Bb',octave:5},'t':{note:'C',octave:6},'y':{note:'Db',octave:6},'u':{note:'Eb',octave:6},'i':{note:'F',octave:6},'o':{note:'G',octave:6},'p':{note:'Ab',octave:6},
      '1':{note:'F',octave:6},'2':{note:'G',octave:6},'3':{note:'Ab',octave:6},'4':{note:'Bb',octave:6},'5':{note:'C',octave:7},'6':{note:'Db',octave:7},'7':{note:'Eb',octave:7},'8':{note:'F',octave:7},'9':{note:'G',octave:7},'0':{note:'Ab',octave:7}
    },
    'Harmonic Minor': {
      'z':{note:'F',octave:3},'x':{note:'G',octave:3},'c':{note:'Ab',octave:3},'v':{note:'Bb',octave:3},'b':{note:'C',octave:4},'n':{note:'Db',octave:4},'m':{note:'E',octave:4},',':{note:'F',octave:4},'.':{note:'G',octave:4},'/':{note:'Ab',octave:4},
      'a':{note:'F',octave:4},'s':{note:'G',octave:4},'d':{note:'Ab',octave:4},'f':{note:'Bb',octave:4},'g':{note:'C',octave:5},'h':{note:'Db',octave:5},'j':{note:'E',octave:5},'k':{note:'F',octave:5},'l':{note:'G',octave:5},';':{note:'Ab',octave:5},
      'q':{note:'F',octave:5},'w':{note:'G',octave:5},'e':{note:'Ab',octave:5},'r':{note:'Bb',octave:5},'t':{note:'C',octave:6},'y':{note:'Db',octave:6},'u':{note:'E',octave:6},'i':{note:'F',octave:6},'o':{note:'G',octave:6},'p':{note:'Ab',octave:6},
      '1':{note:'F',octave:6},'2':{note:'G',octave:6},'3':{note:'Ab',octave:6},'4':{note:'Bb',octave:6},'5':{note:'C',octave:7},'6':{note:'Db',octave:7},'7':{note:'E',octave:7},'8':{note:'F',octave:7},'9':{note:'G',octave:7},'0':{note:'Ab',octave:7}
    },
    'Melodic Minor': {
      'z':{note:'F',octave:3},'x':{note:'G',octave:3},'c':{note:'Ab',octave:3},'v':{note:'Bb',octave:3},'b':{note:'C',octave:4},'n':{note:'D',octave:4},'m':{note:'E',octave:4},',':{note:'F',octave:4},'.':{note:'G',octave:4},'/':{note:'Ab',octave:4},
      'a':{note:'F',octave:4},'s':{note:'G',octave:4},'d':{note:'Ab',octave:4},'f':{note:'Bb',octave:4},'g':{note:'C',octave:5},'h':{note:'D',octave:5},'j':{note:'E',octave:5},'k':{note:'F',octave:5},'l':{note:'G',octave:5},';':{note:'Ab',octave:5},
      'q':{note:'F',octave:5},'w':{note:'G',octave:5},'e':{note:'Ab',octave:5},'r':{note:'Bb',octave:5},'t':{note:'C',octave:6},'y':{note:'D',octave:6},'u':{note:'E',octave:6},'i':{note:'F',octave:6},'o':{note:'G',octave:6},'p':{note:'Ab',octave:6},
      '1':{note:'F',octave:6},'2':{note:'G',octave:6},'3':{note:'Ab',octave:6},'4':{note:'Bb',octave:6},'5':{note:'C',octave:7},'6':{note:'D',octave:7},'7':{note:'E',octave:7},'8':{note:'F',octave:7},'9':{note:'G',octave:7},'0':{note:'Ab',octave:7}
    },
    'Dorian': {
      'z':{note:'F',octave:3},'x':{note:'G',octave:3},'c':{note:'Ab',octave:3},'v':{note:'Bb',octave:3},'b':{note:'C',octave:4},'n':{note:'D',octave:4},'m':{note:'Eb',octave:4},',':{note:'F',octave:4},'.':{note:'G',octave:4},'/':{note:'Ab',octave:4},
      'a':{note:'F',octave:4},'s':{note:'G',octave:4},'d':{note:'Ab',octave:4},'f':{note:'Bb',octave:4},'g':{note:'C',octave:5},'h':{note:'D',octave:5},'j':{note:'Eb',octave:5},'k':{note:'F',octave:5},'l':{note:'G',octave:5},';':{note:'Ab',octave:5},
      'q':{note:'F',octave:5},'w':{note:'G',octave:5},'e':{note:'Ab',octave:5},'r':{note:'Bb',octave:5},'t':{note:'C',octave:6},'y':{note:'D',octave:6},'u':{note:'Eb',octave:6},'i':{note:'F',octave:6},'o':{note:'G',octave:6},'p':{note:'Ab',octave:6},
      '1':{note:'F',octave:6},'2':{note:'G',octave:6},'3':{note:'Ab',octave:6},'4':{note:'Bb',octave:6},'5':{note:'C',octave:7},'6':{note:'D',octave:7},'7':{note:'Eb',octave:7},'8':{note:'F',octave:7},'9':{note:'G',octave:7},'0':{note:'Ab',octave:7}
    },
    'Phrygian': {
      'z':{note:'F',octave:3},'x':{note:'Gb',octave:3},'c':{note:'Ab',octave:3},'v':{note:'Bb',octave:3},'b':{note:'C',octave:4},'n':{note:'Db',octave:4},'m':{note:'Eb',octave:4},',':{note:'F',octave:4},'.':{note:'Gb',octave:4},'/':{note:'Ab',octave:4},
      'a':{note:'F',octave:4},'s':{note:'Gb',octave:4},'d':{note:'Ab',octave:4},'f':{note:'Bb',octave:4},'g':{note:'C',octave:5},'h':{note:'Db',octave:5},'j':{note:'Eb',octave:5},'k':{note:'F',octave:5},'l':{note:'Gb',octave:5},';':{note:'Ab',octave:5},
      'q':{note:'F',octave:5},'w':{note:'Gb',octave:5},'e':{note:'Ab',octave:5},'r':{note:'Bb',octave:5},'t':{note:'C',octave:6},'y':{note:'Db',octave:6},'u':{note:'Eb',octave:6},'i':{note:'F',octave:6},'o':{note:'Gb',octave:6},'p':{note:'Ab',octave:6},
      '1':{note:'F',octave:6},'2':{note:'Gb',octave:6},'3':{note:'Ab',octave:6},'4':{note:'Bb',octave:6},'5':{note:'C',octave:7},'6':{note:'Db',octave:7},'7':{note:'Eb',octave:7},'8':{note:'F',octave:7},'9':{note:'Gb',octave:7},'0':{note:'Ab',octave:7}
    },
    'Lydian': {
      'z':{note:'F',octave:3},'x':{note:'G',octave:3},'c':{note:'A',octave:3},'v':{note:'B',octave:3},'b':{note:'C',octave:4},'n':{note:'D',octave:4},'m':{note:'E',octave:4},',':{note:'F',octave:4},'.':{note:'G',octave:4},'/':{note:'A',octave:4},
      'a':{note:'F',octave:4},'s':{note:'G',octave:4},'d':{note:'A',octave:4},'f':{note:'B',octave:4},'g':{note:'C',octave:5},'h':{note:'D',octave:5},'j':{note:'E',octave:5},'k':{note:'F',octave:5},'l':{note:'G',octave:5},';':{note:'A',octave:5},
      'q':{note:'F',octave:5},'w':{note:'G',octave:5},'e':{note:'A',octave:5},'r':{note:'B',octave:5},'t':{note:'C',octave:6},'y':{note:'D',octave:6},'u':{note:'E',octave:6},'i':{note:'F',octave:6},'o':{note:'G',octave:6},'p':{note:'A',octave:6},
      '1':{note:'F',octave:6},'2':{note:'G',octave:6},'3':{note:'A',octave:6},'4':{note:'B',octave:6},'5':{note:'C',octave:7},'6':{note:'D',octave:7},'7':{note:'E',octave:7},'8':{note:'F',octave:7},'9':{note:'G',octave:7},'0':{note:'A',octave:7}
    },
    'Mixolydian': {
      'z':{note:'F',octave:3},'x':{note:'G',octave:3},'c':{note:'A',octave:3},'v':{note:'Bb',octave:3},'b':{note:'C',octave:4},'n':{note:'D',octave:4},'m':{note:'Eb',octave:4},',':{note:'F',octave:4},'.':{note:'G',octave:4},'/':{note:'A',octave:4},
      'a':{note:'F',octave:4},'s':{note:'G',octave:4},'d':{note:'A',octave:4},'f':{note:'Bb',octave:4},'g':{note:'C',octave:5},'h':{note:'D',octave:5},'j':{note:'Eb',octave:5},'k':{note:'F',octave:5},'l':{note:'G',octave:5},';':{note:'A',octave:5},
      'q':{note:'F',octave:5},'w':{note:'G',octave:5},'e':{note:'A',octave:5},'r':{note:'Bb',octave:5},'t':{note:'C',octave:6},'y':{note:'D',octave:6},'u':{note:'Eb',octave:6},'i':{note:'F',octave:6},'o':{note:'G',octave:6},'p':{note:'A',octave:6},
      '1':{note:'F',octave:6},'2':{note:'G',octave:6},'3':{note:'A',octave:6},'4':{note:'Bb',octave:6},'5':{note:'C',octave:7},'6':{note:'D',octave:7},'7':{note:'Eb',octave:7},'8':{note:'F',octave:7},'9':{note:'G',octave:7},'0':{note:'A',octave:7}
    },
    'Locrian': {
      'z':{note:'F',octave:3},'x':{note:'Gb',octave:3},'c':{note:'Ab',octave:3},'v':{note:'Bb',octave:3},'b':{note:'B',octave:3},'n':{note:'Db',octave:4},'m':{note:'Eb',octave:4},',':{note:'F',octave:4},'.':{note:'Gb',octave:4},'/':{note:'Ab',octave:4},
      'a':{note:'F',octave:4},'s':{note:'Gb',octave:4},'d':{note:'Ab',octave:4},'f':{note:'Bb',octave:4},'g':{note:'B',octave:4},'h':{note:'Db',octave:5},'j':{note:'Eb',octave:5},'k':{note:'F',octave:5},'l':{note:'Gb',octave:5},';':{note:'Ab',octave:5},
      'q':{note:'F',octave:5},'w':{note:'Gb',octave:5},'e':{note:'Ab',octave:5},'r':{note:'Bb',octave:5},'t':{note:'B',octave:5},'y':{note:'Db',octave:6},'u':{note:'Eb',octave:6},'i':{note:'F',octave:6},'o':{note:'Gb',octave:6},'p':{note:'Ab',octave:6},
      '1':{note:'F',octave:6},'2':{note:'Gb',octave:6},'3':{note:'Ab',octave:6},'4':{note:'Bb',octave:6},'5':{note:'B',octave:6},'6':{note:'Db',octave:7},'7':{note:'Eb',octave:7},'8':{note:'F',octave:7},'9':{note:'Gb',octave:7},'0':{note:'Ab',octave:7}
    }
  },
  'Gb': {
  'Major': { // Gb Ab Bb B Db Eb F
    'z':{note:'Gb',octave:3},'x':{note:'Ab',octave:3},'c':{note:'Bb',octave:3},'v':{note:'B',octave:3},'b':{note:'Db',octave:4},'n':{note:'Eb',octave:4},'m':{note:'F',octave:4},',':{note:'Gb',octave:4},'.':{note:'Ab',octave:4},'/':{note:'Bb',octave:4},
    'a':{note:'Gb',octave:4},'s':{note:'Ab',octave:4},'d':{note:'Bb',octave:4},'f':{note:'B',octave:4},'g':{note:'Db',octave:5},'h':{note:'Eb',octave:5},'j':{note:'F',octave:5},'k':{note:'Gb',octave:5},'l':{note:'Ab',octave:5},';':{note:'Bb',octave:5},
    'q':{note:'Gb',octave:5},'w':{note:'Ab',octave:5},'e':{note:'Bb',octave:5},'r':{note:'B',octave:5},'t':{note:'Db',octave:6},'y':{note:'Eb',octave:6},'u':{note:'F',octave:6},'i':{note:'Gb',octave:6},'o':{note:'Ab',octave:6},'p':{note:'Bb',octave:6},
    '1':{note:'Gb',octave:6},'2':{note:'Ab',octave:6},'3':{note:'Bb',octave:6},'4':{note:'B',octave:6},'5':{note:'Db',octave:7},'6':{note:'Eb',octave:7},'7':{note:'F',octave:7},'8':{note:'Gb',octave:7},'9':{note:'Ab',octave:7},'0':{note:'Bb',octave:7}
  },

  'Natural Minor': { // Gb Ab A B Db D E
    'z':{note:'Gb',octave:3},'x':{note:'Ab',octave:3},'c':{note:'A',octave:3},'v':{note:'B',octave:3},'b':{note:'Db',octave:4},'n':{note:'D',octave:4},'m':{note:'E',octave:4},',':{note:'Gb',octave:4},'.':{note:'Ab',octave:4},'/':{note:'A',octave:4},
    'a':{note:'Gb',octave:4},'s':{note:'Ab',octave:4},'d':{note:'A',octave:4},'f':{note:'B',octave:4},'g':{note:'Db',octave:5},'h':{note:'D',octave:5},'j':{note:'E',octave:5},'k':{note:'Gb',octave:5},'l':{note:'Ab',octave:5},';':{note:'A',octave:5},
    'q':{note:'Gb',octave:5},'w':{note:'Ab',octave:5},'e':{note:'A',octave:5},'r':{note:'B',octave:5},'t':{note:'Db',octave:6},'y':{note:'D',octave:6},'u':{note:'E',octave:6},'i':{note:'Gb',octave:6},'o':{note:'Ab',octave:6},'p':{note:'A',octave:6},
    '1':{note:'Gb',octave:6},'2':{note:'Ab',octave:6},'3':{note:'A',octave:6},'4':{note:'B',octave:6},'5':{note:'Db',octave:7},'6':{note:'D',octave:7},'7':{note:'E',octave:7},'8':{note:'Gb',octave:7},'9':{note:'Ab',octave:7},'0':{note:'A',octave:7}
  },

  'Harmonic Minor': { // Gb Ab A B Db D F
    'z':{note:'Gb',octave:3},'x':{note:'Ab',octave:3},'c':{note:'A',octave:3},'v':{note:'B',octave:3},'b':{note:'Db',octave:4},'n':{note:'D',octave:4},'m':{note:'F',octave:4},',':{note:'Gb',octave:4},'.':{note:'Ab',octave:4},'/':{note:'A',octave:4},
    'a':{note:'Gb',octave:4},'s':{note:'Ab',octave:4},'d':{note:'A',octave:4},'f':{note:'B',octave:4},'g':{note:'Db',octave:5},'h':{note:'D',octave:5},'j':{note:'F',octave:5},'k':{note:'Gb',octave:5},'l':{note:'Ab',octave:5},';':{note:'A',octave:5},
    'q':{note:'Gb',octave:5},'w':{note:'Ab',octave:5},'e':{note:'A',octave:5},'r':{note:'B',octave:5},'t':{note:'Db',octave:6},'y':{note:'D',octave:6},'u':{note:'F',octave:6},'i':{note:'Gb',octave:6},'o':{note:'Ab',octave:6},'p':{note:'A',octave:6},
    '1':{note:'Gb',octave:6},'2':{note:'Ab',octave:6},'3':{note:'A',octave:6},'4':{note:'B',octave:6},'5':{note:'Db',octave:7},'6':{note:'D',octave:7},'7':{note:'F',octave:7},'8':{note:'Gb',octave:7},'9':{note:'Ab',octave:7},'0':{note:'A',octave:7}
  },

  'Melodic Minor': { // ascending: Gb Ab A B Db Eb F
    'z':{note:'Gb',octave:3},'x':{note:'Ab',octave:3},'c':{note:'A',octave:3},'v':{note:'B',octave:3},'b':{note:'Db',octave:4},'n':{note:'Eb',octave:4},'m':{note:'F',octave:4},',':{note:'Gb',octave:4},'.':{note:'Ab',octave:4},'/':{note:'A',octave:4},
    'a':{note:'Gb',octave:4},'s':{note:'Ab',octave:4},'d':{note:'A',octave:4},'f':{note:'B',octave:4},'g':{note:'Db',octave:5},'h':{note:'Eb',octave:5},'j':{note:'F',octave:5},'k':{note:'Gb',octave:5},'l':{note:'Ab',octave:5},';':{note:'A',octave:5},
    'q':{note:'Gb',octave:5},'w':{note:'Ab',octave:5},'e':{note:'A',octave:5},'r':{note:'B',octave:5},'t':{note:'Db',octave:6},'y':{note:'Eb',octave:6},'u':{note:'F',octave:6},'i':{note:'Gb',octave:6},'o':{note:'Ab',octave:6},'p':{note:'A',octave:6},
    '1':{note:'Gb',octave:6},'2':{note:'Ab',octave:6},'3':{note:'A',octave:6},'4':{note:'B',octave:6},'5':{note:'Db',octave:7},'6':{note:'Eb',octave:7},'7':{note:'F',octave:7},'8':{note:'Gb',octave:7},'9':{note:'Ab',octave:7},'0':{note:'A',octave:7}
  },

  'Dorian': { // Gb Ab A B Db Eb E
    'z':{note:'Gb',octave:3},'x':{note:'Ab',octave:3},'c':{note:'A',octave:3},'v':{note:'B',octave:3},'b':{note:'Db',octave:4},'n':{note:'Eb',octave:4},'m':{note:'E',octave:4},',':{note:'Gb',octave:4},'.':{note:'Ab',octave:4},'/':{note:'A',octave:4},
    'a':{note:'Gb',octave:4},'s':{note:'Ab',octave:4},'d':{note:'A',octave:4},'f':{note:'B',octave:4},'g':{note:'Db',octave:5},'h':{note:'Eb',octave:5},'j':{note:'E',octave:5},'k':{note:'Gb',octave:5},'l':{note:'Ab',octave:5},';':{note:'A',octave:5},
    'q':{note:'Gb',octave:5},'w':{note:'Ab',octave:5},'e':{note:'A',octave:5},'r':{note:'B',octave:5},'t':{note:'Db',octave:6},'y':{note:'Eb',octave:6},'u':{note:'E',octave:6},'i':{note:'Gb',octave:6},'o':{note:'Ab',octave:6},'p':{note:'A',octave:6},
    '1':{note:'Gb',octave:6},'2':{note:'Ab',octave:6},'3':{note:'A',octave:6},'4':{note:'B',octave:6},'5':{note:'Db',octave:7},'6':{note:'Eb',octave:7},'7':{note:'E',octave:7},'8':{note:'Gb',octave:7},'9':{note:'Ab',octave:7},'0':{note:'A',octave:7}
  },

  'Phrygian': { // Gb G A B Db D E
    'z':{note:'Gb',octave:3},'x':{note:'G',octave:3},'c':{note:'A',octave:3},'v':{note:'B',octave:3},'b':{note:'Db',octave:4},'n':{note:'D',octave:4},'m':{note:'E',octave:4},',':{note:'Gb',octave:4},'.':{note:'G',octave:4},'/':{note:'A',octave:4},
    'a':{note:'Gb',octave:4},'s':{note:'G',octave:4},'d':{note:'A',octave:4},'f':{note:'B',octave:4},'g':{note:'Db',octave:5},'h':{note:'D',octave:5},'j':{note:'E',octave:5},'k':{note:'Gb',octave:5},'l':{note:'G',octave:5},';':{note:'A',octave:5},
    'q':{note:'Gb',octave:5},'w':{note:'G',octave:5},'e':{note:'A',octave:5},'r':{note:'B',octave:5},'t':{note:'Db',octave:6},'y':{note:'D',octave:6},'u':{note:'E',octave:6},'i':{note:'Gb',octave:6},'o':{note:'G',octave:6},'p':{note:'A',octave:6},
    '1':{note:'Gb',octave:6},'2':{note:'G',octave:6},'3':{note:'A',octave:6},'4':{note:'B',octave:6},'5':{note:'Db',octave:7},'6':{note:'D',octave:7},'7':{note:'E',octave:7},'8':{note:'Gb',octave:7},'9':{note:'G',octave:7},'0':{note:'A',octave:7}
  },

  'Lydian': { // Gb Ab Bb C Db Eb F
    'z':{note:'Gb',octave:3},'x':{note:'Ab',octave:3},'c':{note:'Bb',octave:3},'v':{note:'C',octave:3},'b':{note:'Db',octave:4},'n':{note:'Eb',octave:4},'m':{note:'F',octave:4},',':{note:'Gb',octave:4},'.':{note:'Ab',octave:4},'/':{note:'Bb',octave:4},
    'a':{note:'Gb',octave:4},'s':{note:'Ab',octave:4},'d':{note:'Bb',octave:4},'f':{note:'C',octave:4},'g':{note:'Db',octave:5},'h':{note:'Eb',octave:5},'j':{note:'F',octave:5},'k':{note:'Gb',octave:5},'l':{note:'Ab',octave:5},';':{note:'Bb',octave:5},
    'q':{note:'Gb',octave:5},'w':{note:'Ab',octave:5},'e':{note:'Bb',octave:5},'r':{note:'C',octave:5},'t':{note:'Db',octave:6},'y':{note:'Eb',octave:6},'u':{note:'F',octave:6},'i':{note:'Gb',octave:6},'o':{note:'Ab',octave:6},'p':{note:'Bb',octave:6},
    '1':{note:'Gb',octave:6},'2':{note:'Ab',octave:6},'3':{note:'Bb',octave:6},'4':{note:'C',octave:6},'5':{note:'Db',octave:7},'6':{note:'Eb',octave:7},'7':{note:'F',octave:7},'8':{note:'Gb',octave:7},'9':{note:'Ab',octave:7},'0':{note:'Bb',octave:7}
  },

  'Mixolydian': { // Gb Ab Bb B Db Eb E
    'z':{note:'Gb',octave:3},'x':{note:'Ab',octave:3},'c':{note:'Bb',octave:3},'v':{note:'B',octave:3},'b':{note:'Db',octave:4},'n':{note:'Eb',octave:4},'m':{note:'E',octave:4},',':{note:'Gb',octave:4},'.':{note:'Ab',octave:4},'/':{note:'Bb',octave:4},
    'a':{note:'Gb',octave:4},'s':{note:'Ab',octave:4},'d':{note:'Bb',octave:4},'f':{note:'B',octave:4},'g':{note:'Db',octave:5},'h':{note:'Eb',octave:5},'j':{note:'E',octave:5},'k':{note:'Gb',octave:5},'l':{note:'Ab',octave:5},';':{note:'Bb',octave:5},
    'q':{note:'Gb',octave:5},'w':{note:'Ab',octave:5},'e':{note:'Bb',octave:5},'r':{note:'B',octave:5},'t':{note:'Db',octave:6},'y':{note:'Eb',octave:6},'u':{note:'E',octave:6},'i':{note:'Gb',octave:6},'o':{note:'Ab',octave:6},'p':{note:'Bb',octave:6},
    '1':{note:'Gb',octave:6},'2':{note:'Ab',octave:6},'3':{note:'Bb',octave:6},'4':{note:'B',octave:6},'5':{note:'Db',octave:7},'6':{note:'Eb',octave:7},'7':{note:'E',octave:7},'8':{note:'Gb',octave:7},'9':{note:'Ab',octave:7},'0':{note:'Bb',octave:7}
  },

  'Locrian': { // Gb G A B C D E
    'z':{note:'Gb',octave:3},'x':{note:'G',octave:3},'c':{note:'A',octave:3},'v':{note:'B',octave:3},'b':{note:'C',octave:4},'n':{note:'D',octave:4},'m':{note:'E',octave:4},',':{note:'Gb',octave:4},'.':{note:'G',octave:4},'/':{note:'A',octave:4},
    'a':{note:'Gb',octave:4},'s':{note:'G',octave:4},'d':{note:'A',octave:4},'f':{note:'B',octave:4},'g':{note:'C',octave:5},'h':{note:'D',octave:5},'j':{note:'E',octave:5},'k':{note:'Gb',octave:5},'l':{note:'G',octave:5},';':{note:'A',octave:5},
    'q':{note:'Gb',octave:5},'w':{note:'G',octave:5},'e':{note:'A',octave:5},'r':{note:'B',octave:5},'t':{note:'C',octave:6},'y':{note:'D',octave:6},'u':{note:'E',octave:6},'i':{note:'Gb',octave:6},'o':{note:'G',octave:6},'p':{note:'A',octave:6},
    '1':{note:'Gb',octave:6},'2':{note:'G',octave:6},'3':{note:'A',octave:6},'4':{note:'B',octave:6},'5':{note:'C',octave:6},'6':{note:'D',octave:6},'7':{note:'E',octave:6},'8':{note:'Gb',octave:7},'9':{note:'G',octave:7},'0':{note:'A',octave:7}
  }
},
  'G': {
  'Major': {
    'z':{note:'G',octave:2},'x':{note:'A',octave:2},'c':{note:'B',octave:2},'v':{note:'C',octave:3},'b':{note:'D',octave:3},'n':{note:'E',octave:3},'m':{note:'F#',octave:3},',':{note:'G',octave:3},'.':{note:'A',octave:3},'/':{note:'B',octave:3},
    'a':{note:'G',octave:3},'s':{note:'A',octave:3},'d':{note:'B',octave:3},'f':{note:'C',octave:4},'g':{note:'D',octave:4},'h':{note:'E',octave:4},'j':{note:'F#',octave:4},'k':{note:'G',octave:4},'l':{note:'A',octave:4},';':{note:'B',octave:4},
    'q':{note:'G',octave:4},'w':{note:'A',octave:4},'e':{note:'B',octave:4},'r':{note:'C',octave:5},'t':{note:'D',octave:5},'y':{note:'E',octave:5},'u':{note:'F#',octave:5},'i':{note:'G',octave:5},'o':{note:'A',octave:5},'p':{note:'B',octave:5},
    '1':{note:'G',octave:5},'2':{note:'A',octave:5},'3':{note:'B',octave:5},'4':{note:'C',octave:6},'5':{note:'D',octave:6},'6':{note:'E',octave:6},'7':{note:'F#',octave:6},'8':{note:'G',octave:6},'9':{note:'A',octave:6},'0':{note:'B',octave:6}
  },
  'Natural Minor': { // G A Bb C D Eb F
    'z':{note:'G',octave:2},'x':{note:'A',octave:2},'c':{note:'Bb',octave:2},'v':{note:'C',octave:3},'b':{note:'D',octave:3},'n':{note:'Eb',octave:3},'m':{note:'F',octave:3},',':{note:'G',octave:3},'.':{note:'A',octave:3},'/':{note:'Bb',octave:3},
    'a':{note:'G',octave:3},'s':{note:'A',octave:3},'d':{note:'Bb',octave:3},'f':{note:'C',octave:4},'g':{note:'D',octave:4},'h':{note:'Eb',octave:4},'j':{note:'F',octave:4},'k':{note:'G',octave:4},'l':{note:'A',octave:4},';':{note:'Bb',octave:4},
    'q':{note:'G',octave:4},'w':{note:'A',octave:4},'e':{note:'Bb',octave:4},'r':{note:'C',octave:5},'t':{note:'D',octave:5},'y':{note:'Eb',octave:5},'u':{note:'F',octave:5},'i':{note:'G',octave:5},'o':{note:'A',octave:5},'p':{note:'Bb',octave:5},
    '1':{note:'G',octave:5},'2':{note:'A',octave:5},'3':{note:'Bb',octave:5},'4':{note:'C',octave:6},'5':{note:'D',octave:6},'6':{note:'Eb',octave:6},'7':{note:'F',octave:6},'8':{note:'G',octave:6},'9':{note:'A',octave:6},'0':{note:'Bb',octave:6}
  },
  'Harmonic Minor': { // G A Bb C D Eb F#
    'z':{note:'G',octave:2},'x':{note:'A',octave:2},'c':{note:'Bb',octave:2},'v':{note:'C',octave:3},'b':{note:'D',octave:3},'n':{note:'Eb',octave:3},'m':{note:'F#',octave:3},',':{note:'G',octave:3},'.':{note:'A',octave:3},'/':{note:'Bb',octave:3},
    'a':{note:'G',octave:3},'s':{note:'A',octave:3},'d':{note:'Bb',octave:3},'f':{note:'C',octave:4},'g':{note:'D',octave:4},'h':{note:'Eb',octave:4},'j':{note:'F#',octave:4},'k':{note:'G',octave:4},'l':{note:'A',octave:4},';':{note:'Bb',octave:4},
    'q':{note:'G',octave:4},'w':{note:'A',octave:4},'e':{note:'Bb',octave:4},'r':{note:'C',octave:5},'t':{note:'D',octave:5},'y':{note:'Eb',octave:5},'u':{note:'F#',octave:5},'i':{note:'G',octave:5},'o':{note:'A',octave:5},'p':{note:'Bb',octave:5},
    '1':{note:'G',octave:5},'2':{note:'A',octave:5},'3':{note:'Bb',octave:5},'4':{note:'C',octave:6},'5':{note:'D',octave:6},'6':{note:'Eb',octave:6},'7':{note:'F#',octave:6},'8':{note:'G',octave:6},'9':{note:'A',octave:6},'0':{note:'Bb',octave:6}
  },
  'Melodic Minor': { // ascending: G A Bb C D E F#
    'z':{note:'G',octave:2},'x':{note:'A',octave:2},'c':{note:'Bb',octave:2},'v':{note:'C',octave:3},'b':{note:'D',octave:3},'n':{note:'E',octave:3},'m':{note:'F#',octave:3},',':{note:'G',octave:3},'.':{note:'A',octave:3},'/':{note:'Bb',octave:3},
    'a':{note:'G',octave:3},'s':{note:'A',octave:3},'d':{note:'Bb',octave:3},'f':{note:'C',octave:4},'g':{note:'D',octave:4},'h':{note:'E',octave:4},'j':{note:'F#',octave:4},'k':{note:'G',octave:4},'l':{note:'A',octave:4},';':{note:'Bb',octave:4},
    'q':{note:'G',octave:4},'w':{note:'A',octave:4},'e':{note:'Bb',octave:4},'r':{note:'C',octave:5},'t':{note:'D',octave:5},'y':{note:'E',octave:5},'u':{note:'F#',octave:5},'i':{note:'G',octave:5},'o':{note:'A',octave:5},'p':{note:'Bb',octave:5},
    '1':{note:'G',octave:5},'2':{note:'A',octave:5},'3':{note:'Bb',octave:5},'4':{note:'C',octave:6},'5':{note:'D',octave:6},'6':{note:'E',octave:6},'7':{note:'F#',octave:6},'8':{note:'G',octave:6},'9':{note:'A',octave:6},'0':{note:'Bb',octave:6}
  },
  'Dorian': { // G A Bb C D E F
    'z':{note:'G',octave:2},'x':{note:'A',octave:2},'c':{note:'Bb',octave:2},'v':{note:'C',octave:3},'b':{note:'D',octave:3},'n':{note:'E',octave:3},'m':{note:'F',octave:3},',':{note:'G',octave:3},'.':{note:'A',octave:3},'/':{note:'Bb',octave:3},
    'a':{note:'G',octave:3},'s':{note:'A',octave:3},'d':{note:'Bb',octave:3},'f':{note:'C',octave:4},'g':{note:'D',octave:4},'h':{note:'E',octave:4},'j':{note:'F',octave:4},'k':{note:'G',octave:4},'l':{note:'A',octave:4},';':{note:'Bb',octave:4},
    'q':{note:'G',octave:4},'w':{note:'A',octave:4},'e':{note:'Bb',octave:4},'r':{note:'C',octave:5},'t':{note:'D',octave:5},'y':{note:'E',octave:5},'u':{note:'F',octave:5},'i':{note:'G',octave:5},'o':{note:'A',octave:5},'p':{note:'Bb',octave:5},
    '1':{note:'G',octave:5},'2':{note:'A',octave:5},'3':{note:'Bb',octave:5},'4':{note:'C',octave:6},'5':{note:'D',octave:6},'6':{note:'E',octave:6},'7':{note:'F',octave:6},'8':{note:'G',octave:6},'9':{note:'A',octave:6},'0':{note:'Bb',octave:6}
  },
  'Phrygian': { // G Ab Bb C D Eb F
    'z':{note:'G',octave:2},'x':{note:'Ab',octave:2},'c':{note:'Bb',octave:2},'v':{note:'C',octave:3},'b':{note:'D',octave:3},'n':{note:'Eb',octave:3},'m':{note:'F',octave:3},',':{note:'G',octave:3},'.':{note:'Ab',octave:3},'/':{note:'Bb',octave:3},
    'a':{note:'G',octave:3},'s':{note:'Ab',octave:3},'d':{note:'Bb',octave:3},'f':{note:'C',octave:4},'g':{note:'D',octave:4},'h':{note:'Eb',octave:4},'j':{note:'F',octave:4},'k':{note:'G',octave:4},'l':{note:'Ab',octave:4},';':{note:'Bb',octave:4},
    'q':{note:'G',octave:4},'w':{note:'Ab',octave:4},'e':{note:'Bb',octave:4},'r':{note:'C',octave:5},'t':{note:'D',octave:5},'y':{note:'Eb',octave:5},'u':{note:'F',octave:5},'i':{note:'G',octave:5},'o':{note:'Ab',octave:5},'p':{note:'Bb',octave:5},
    '1':{note:'G',octave:5},'2':{note:'Ab',octave:5},'3':{note:'Bb',octave:5},'4':{note:'C',octave:6},'5':{note:'D',octave:6},'6':{note:'Eb',octave:6},'7':{note:'F',octave:6},'8':{note:'G',octave:6},'9':{note:'Ab',octave:6},'0':{note:'Bb',octave:6}
  },
  'Lydian': { // G A B C# D E F#
    'z':{note:'G',octave:2},'x':{note:'A',octave:2},'c':{note:'B',octave:2},'v':{note:'C#',octave:3},'b':{note:'D',octave:3},'n':{note:'E',octave:3},'m':{note:'F#',octave:3},',':{note:'G',octave:3},'.':{note:'A',octave:3},'/':{note:'B',octave:3},
    'a':{note:'G',octave:3},'s':{note:'A',octave:3},'d':{note:'B',octave:3},'f':{note:'C#',octave:4},'g':{note:'D',octave:4},'h':{note:'E',octave:4},'j':{note:'F#',octave:4},'k':{note:'G',octave:4},'l':{note:'A',octave:4},';':{note:'B',octave:4},
    'q':{note:'G',octave:4},'w':{note:'A',octave:4},'e':{note:'B',octave:4},'r':{note:'C#',octave:5},'t':{note:'D',octave:5},'y':{note:'E',octave:5},'u':{note:'F#',octave:5},'i':{note:'G',octave:5},'o':{note:'A',octave:5},'p':{note:'B',octave:5},
    '1':{note:'G',octave:5},'2':{note:'A',octave:5},'3':{note:'B',octave:5},'4':{note:'C#',octave:6},'5':{note:'D',octave:6},'6':{note:'E',octave:6},'7':{note:'F#',octave:6},'8':{note:'G',octave:6},'9':{note:'A',octave:6},'0':{note:'B',octave:6}
  },
  'Mixolydian': { // G A B C D E F
    'z':{note:'G',octave:2},'x':{note:'A',octave:2},'c':{note:'B',octave:2},'v':{note:'C',octave:3},'b':{note:'D',octave:3},'n':{note:'E',octave:3},'m':{note:'F',octave:3},',':{note:'G',octave:3},'.':{note:'A',octave:3},'/':{note:'B',octave:3},
    'a':{note:'G',octave:3},'s':{note:'A',octave:3},'d':{note:'B',octave:3},'f':{note:'C',octave:4},'g':{note:'D',octave:4},'h':{note:'E',octave:4},'j':{note:'F',octave:4},'k':{note:'G',octave:4},'l':{note:'A',octave:4},';':{note:'B',octave:4},
    'q':{note:'G',octave:4},'w':{note:'A',octave:4},'e':{note:'B',octave:4},'r':{note:'C',octave:5},'t':{note:'D',octave:5},'y':{note:'E',octave:5},'u':{note:'F',octave:5},'i':{note:'G',octave:5},'o':{note:'A',octave:5},'p':{note:'B',octave:5},
    '1':{note:'G',octave:5},'2':{note:'A',octave:5},'3':{note:'B',octave:5},'4':{note:'C',octave:6},'5':{note:'D',octave:6},'6':{note:'E',octave:6},'7':{note:'F',octave:6},'8':{note:'G',octave:6},'9':{note:'A',octave:6},'0':{note:'B',octave:6}
  },
  'Locrian': { // G Ab Bb C Db Eb F
    'z':{note:'G',octave:2},'x':{note:'Ab',octave:2},'c':{note:'Bb',octave:2},'v':{note:'C',octave:3},'b':{note:'Db',octave:3},'n':{note:'Eb',octave:3},'m':{note:'F',octave:3},',':{note:'G',octave:3},'.':{note:'Ab',octave:3},'/':{note:'Bb',octave:3},
    'a':{note:'G',octave:3},'s':{note:'Ab',octave:3},'d':{note:'Bb',octave:3},'f':{note:'C',octave:4},'g':{note:'Db',octave:4},'h':{note:'Eb',octave:4},'j':{note:'F',octave:4},'k':{note:'G',octave:4},'l':{note:'Ab',octave:4},';':{note:'Bb',octave:4},
    'q':{note:'G',octave:4},'w':{note:'Ab',octave:4},'e':{note:'Bb',octave:4},'r':{note:'C',octave:5},'t':{note:'Db',octave:5},'y':{note:'Eb',octave:5},'u':{note:'F',octave:5},'i':{note:'G',octave:5},'o':{note:'Ab',octave:5},'p':{note:'Bb',octave:5},
    '1':{note:'G',octave:5},'2':{note:'Ab',octave:5},'3':{note:'Bb',octave:5},'4':{note:'C',octave:6},'5':{note:'Db',octave:6},'6':{note:'Eb',octave:6},'7':{note:'F',octave:6},'8':{note:'G',octave:6},'9':{note:'Ab',octave:6},'0':{note:'Bb',octave:6}
  }
}, 
'Ab': {
  'Major': { // Ab Bb C Db Eb F G
    'z':{note:'Ab',octave:2},'x':{note:'Bb',octave:2},'c':{note:'C',octave:3},'v':{note:'Db',octave:3},'b':{note:'Eb',octave:3},'n':{note:'F',octave:3},'m':{note:'G',octave:3},',':{note:'Ab',octave:3},'.':{note:'Bb',octave:3},'/':{note:'C',octave:4},
    'a':{note:'Ab',octave:3},'s':{note:'Bb',octave:3},'d':{note:'C',octave:4},'f':{note:'Db',octave:4},'g':{note:'Eb',octave:4},'h':{note:'F',octave:4},'j':{note:'G',octave:4},'k':{note:'Ab',octave:4},'l':{note:'Bb',octave:4},';':{note:'C',octave:5},
    'q':{note:'Ab',octave:4},'w':{note:'Bb',octave:4},'e':{note:'C',octave:5},'r':{note:'Db',octave:5},'t':{note:'Eb',octave:5},'y':{note:'F',octave:5},'u':{note:'G',octave:5},'i':{note:'Ab',octave:5},'o':{note:'Bb',octave:5},'p':{note:'C',octave:6},
    '1':{note:'Ab',octave:5},'2':{note:'Bb',octave:5},'3':{note:'C',octave:6},'4':{note:'Db',octave:6},'5':{note:'Eb',octave:6},'6':{note:'F',octave:6},'7':{note:'G',octave:6},'8':{note:'Ab',octave:6},'9':{note:'Bb',octave:6},'0':{note:'C',octave:7}
  },

  'Natural Minor': { // Ab Bb B Db Eb E Gb
    'z':{note:'Ab',octave:2},'x':{note:'Bb',octave:2},'c':{note:'B',octave:2},'v':{note:'Db',octave:3},'b':{note:'Eb',octave:3},'n':{note:'E',octave:3},'m':{note:'Gb',octave:3},',':{note:'Ab',octave:3},'.':{note:'Bb',octave:3},'/':{note:'B',octave:3},
    'a':{note:'Ab',octave:3},'s':{note:'Bb',octave:3},'d':{note:'B',octave:3},'f':{note:'Db',octave:4},'g':{note:'Eb',octave:4},'h':{note:'E',octave:4},'j':{note:'Gb',octave:4},'k':{note:'Ab',octave:4},'l':{note:'Bb',octave:4},';':{note:'B',octave:4},
    'q':{note:'Ab',octave:4},'w':{note:'Bb',octave:4},'e':{note:'B',octave:4},'r':{note:'Db',octave:5},'t':{note:'Eb',octave:5},'y':{note:'E',octave:5},'u':{note:'Gb',octave:5},'i':{note:'Ab',octave:5},'o':{note:'Bb',octave:5},'p':{note:'B',octave:5},
    '1':{note:'Ab',octave:5},'2':{note:'Bb',octave:5},'3':{note:'B',octave:5},'4':{note:'Db',octave:6},'5':{note:'Eb',octave:6},'6':{note:'E',octave:6},'7':{note:'Gb',octave:6},'8':{note:'Ab',octave:6},'9':{note:'Bb',octave:6},'0':{note:'B',octave:6}
  },

  'Harmonic Minor': { // Ab Bb B Db Eb E G
    'z':{note:'Ab',octave:2},'x':{note:'Bb',octave:2},'c':{note:'B',octave:2},'v':{note:'Db',octave:3},'b':{note:'Eb',octave:3},'n':{note:'E',octave:3},'m':{note:'G',octave:3},',':{note:'Ab',octave:3},'.':{note:'Bb',octave:3},'/':{note:'B',octave:3},
    'a':{note:'Ab',octave:3},'s':{note:'Bb',octave:3},'d':{note:'B',octave:3},'f':{note:'Db',octave:4},'g':{note:'Eb',octave:4},'h':{note:'E',octave:4},'j':{note:'G',octave:4},'k':{note:'Ab',octave:4},'l':{note:'Bb',octave:4},';':{note:'B',octave:4},
    'q':{note:'Ab',octave:4},'w':{note:'Bb',octave:4},'e':{note:'B',octave:4},'r':{note:'Db',octave:5},'t':{note:'Eb',octave:5},'y':{note:'E',octave:5},'u':{note:'G',octave:5},'i':{note:'Ab',octave:5},'o':{note:'Bb',octave:5},'p':{note:'B',octave:5},
    '1':{note:'Ab',octave:5},'2':{note:'Bb',octave:5},'3':{note:'B',octave:5},'4':{note:'Db',octave:6},'5':{note:'Eb',octave:6},'6':{note:'E',octave:6},'7':{note:'G',octave:6},'8':{note:'Ab',octave:6},'9':{note:'Bb',octave:6},'0':{note:'B',octave:6}
  },

  'Melodic Minor': { // ascending: Ab Bb B Db Eb F G
    'z':{note:'Ab',octave:2},'x':{note:'Bb',octave:2},'c':{note:'B',octave:2},'v':{note:'Db',octave:3},'b':{note:'Eb',octave:3},'n':{note:'F',octave:3},'m':{note:'G',octave:3},',':{note:'Ab',octave:3},'.':{note:'Bb',octave:3},'/':{note:'B',octave:3},
    'a':{note:'Ab',octave:3},'s':{note:'Bb',octave:3},'d':{note:'B',octave:3},'f':{note:'Db',octave:4},'g':{note:'Eb',octave:4},'h':{note:'F',octave:4},'j':{note:'G',octave:4},'k':{note:'Ab',octave:4},'l':{note:'Bb',octave:4},';':{note:'B',octave:4},
    'q':{note:'Ab',octave:4},'w':{note:'Bb',octave:4},'e':{note:'B',octave:4},'r':{note:'Db',octave:5},'t':{note:'Eb',octave:5},'y':{note:'F',octave:5},'u':{note:'G',octave:5},'i':{note:'Ab',octave:5},'o':{note:'Bb',octave:5},'p':{note:'B',octave:5},
    '1':{note:'Ab',octave:5},'2':{note:'Bb',octave:5},'3':{note:'B',octave:5},'4':{note:'Db',octave:6},'5':{note:'Eb',octave:6},'6':{note:'F',octave:6},'7':{note:'G',octave:6},'8':{note:'Ab',octave:6},'9':{note:'Bb',octave:6},'0':{note:'B',octave:6}
  },

  'Dorian': { // Ab Bb B Db Eb F Gb
    'z':{note:'Ab',octave:2},'x':{note:'Bb',octave:2},'c':{note:'B',octave:2},'v':{note:'Db',octave:3},'b':{note:'Eb',octave:3},'n':{note:'F',octave:3},'m':{note:'Gb',octave:3},',':{note:'Ab',octave:3},'.':{note:'Bb',octave:3},'/':{note:'B',octave:3},
    'a':{note:'Ab',octave:3},'s':{note:'Bb',octave:3},'d':{note:'B',octave:3},'f':{note:'Db',octave:4},'g':{note:'Eb',octave:4},'h':{note:'F',octave:4},'j':{note:'Gb',octave:4},'k':{note:'Ab',octave:4},'l':{note:'Bb',octave:4},';':{note:'B',octave:4},
    'q':{note:'Ab',octave:4},'w':{note:'Bb',octave:4},'e':{note:'B',octave:4},'r':{note:'Db',octave:5},'t':{note:'Eb',octave:5},'y':{note:'F',octave:5},'u':{note:'Gb',octave:5},'i':{note:'Ab',octave:5},'o':{note:'Bb',octave:5},'p':{note:'B',octave:5},
    '1':{note:'Ab',octave:5},'2':{note:'Bb',octave:5},'3':{note:'B',octave:5},'4':{note:'Db',octave:6},'5':{note:'Eb',octave:6},'6':{note:'F',octave:6},'7':{note:'Gb',octave:6},'8':{note:'Ab',octave:6},'9':{note:'Bb',octave:6},'0':{note:'B',octave:6}
  },

  'Phrygian': { // Ab A B Db Eb E Gb
    'z':{note:'Ab',octave:2},'x':{note:'A',octave:2},'c':{note:'B',octave:2},'v':{note:'Db',octave:3},'b':{note:'Eb',octave:3},'n':{note:'E',octave:3},'m':{note:'Gb',octave:3},',':{note:'Ab',octave:3},'.':{note:'A',octave:3},'/':{note:'B',octave:3},
    'a':{note:'Ab',octave:3},'s':{note:'A',octave:3},'d':{note:'B',octave:3},'f':{note:'Db',octave:4},'g':{note:'Eb',octave:4},'h':{note:'E',octave:4},'j':{note:'Gb',octave:4},'k':{note:'Ab',octave:4},'l':{note:'A',octave:4},';':{note:'B',octave:4},
    'q':{note:'Ab',octave:4},'w':{note:'A',octave:4},'e':{note:'B',octave:4},'r':{note:'Db',octave:5},'t':{note:'Eb',octave:5},'y':{note:'E',octave:5},'u':{note:'Gb',octave:5},'i':{note:'Ab',octave:5},'o':{note:'A',octave:5},'p':{note:'B',octave:5},
    '1':{note:'Ab',octave:5},'2':{note:'A',octave:5},'3':{note:'B',octave:5},'4':{note:'Db',octave:6},'5':{note:'Eb',octave:6},'6':{note:'E',octave:6},'7':{note:'Gb',octave:6},'8':{note:'Ab',octave:6},'9':{note:'A',octave:6},'0':{note:'B',octave:6}
  },

  'Lydian': { // Ab Bb C D Eb F G
    'z':{note:'Ab',octave:2},'x':{note:'Bb',octave:2},'c':{note:'C',octave:3},'v':{note:'D',octave:3},'b':{note:'Eb',octave:3},'n':{note:'F',octave:3},'m':{note:'G',octave:3},',':{note:'Ab',octave:3},'.':{note:'Bb',octave:3},'/':{note:'C',octave:4},
    'a':{note:'Ab',octave:3},'s':{note:'Bb',octave:3},'d':{note:'C',octave:4},'f':{note:'D',octave:4},'g':{note:'Eb',octave:4},'h':{note:'F',octave:4},'j':{note:'G',octave:4},'k':{note:'Ab',octave:4},'l':{note:'Bb',octave:4},';':{note:'C',octave:5},
    'q':{note:'Ab',octave:4},'w':{note:'Bb',octave:4},'e':{note:'C',octave:5},'r':{note:'D',octave:5},'t':{note:'Eb',octave:5},'y':{note:'F',octave:5},'u':{note:'G',octave:5},'i':{note:'Ab',octave:5},'o':{note:'Bb',octave:5},'p':{note:'C',octave:6},
    '1':{note:'Ab',octave:5},'2':{note:'Bb',octave:5},'3':{note:'C',octave:6},'4':{note:'D',octave:6},'5':{note:'Eb',octave:6},'6':{note:'F',octave:6},'7':{note:'G',octave:6},'8':{note:'Ab',octave:6},'9':{note:'Bb',octave:6},'0':{note:'C',octave:7}
  },

  'Mixolydian': { // Ab Bb C Db Eb F Gb
    'z':{note:'Ab',octave:2},'x':{note:'Bb',octave:2},'c':{note:'C',octave:3},'v':{note:'Db',octave:3},'b':{note:'Eb',octave:3},'n':{note:'F',octave:3},'m':{note:'Gb',octave:3},',':{note:'Ab',octave:3},'.':{note:'Bb',octave:3},'/':{note:'C',octave:4},
    'a':{note:'Ab',octave:3},'s':{note:'Bb',octave:3},'d':{note:'C',octave:4},'f':{note:'Db',octave:4},'g':{note:'Eb',octave:4},'h':{note:'F',octave:4},'j':{note:'Gb',octave:4},'k':{note:'Ab',octave:4},'l':{note:'Bb',octave:4},';':{note:'C',octave:5},
    'q':{note:'Ab',octave:4},'w':{note:'Bb',octave:4},'e':{note:'C',octave:5},'r':{note:'Db',octave:5},'t':{note:'Eb',octave:5},'y':{note:'F',octave:5},'u':{note:'Gb',octave:5},'i':{note:'Ab',octave:5},'o':{note:'Bb',octave:5},'p':{note:'C',octave:6},
    '1':{note:'Ab',octave:5},'2':{note:'Bb',octave:5},'3':{note:'C',octave:6},'4':{note:'Db',octave:6},'5':{note:'Eb',octave:6},'6':{note:'F',octave:6},'7':{note:'Gb',octave:6},'8':{note:'Ab',octave:6},'9':{note:'Bb',octave:6},'0':{note:'C',octave:7}
  },

  'Locrian': { // Ab A B Db D E Gb
    'z':{note:'Ab',octave:2},'x':{note:'A',octave:2},'c':{note:'B',octave:2},'v':{note:'Db',octave:3},'b':{note:'D',octave:3},'n':{note:'E',octave:3},'m':{note:'Gb',octave:3},',':{note:'Ab',octave:3},'.':{note:'A',octave:3},'/':{note:'B',octave:3},
    'a':{note:'Ab',octave:3},'s':{note:'A',octave:3},'d':{note:'B',octave:3},'f':{note:'Db',octave:4},'g':{note:'D',octave:4},'h':{note:'E',octave:4},'j':{note:'Gb',octave:4},'k':{note:'Ab',octave:4},'l':{note:'A',octave:4},';':{note:'B',octave:4},
    'q':{note:'Ab',octave:4},'w':{note:'A',octave:4},'e':{note:'B',octave:4},'r':{note:'Db',octave:5},'t':{note:'D',octave:5},'y':{note:'E',octave:5},'u':{note:'Gb',octave:5},'i':{note:'Ab',octave:5},'o':{note:'A',octave:5},'p':{note:'B',octave:5},
    '1':{note:'Ab',octave:5},'2':{note:'A',octave:5},'3':{note:'B',octave:5},'4':{note:'Db',octave:6},'5':{note:'D',octave:6},'6':{note:'E',octave:6},'7':{note:'Gb',octave:6},'8':{note:'Ab',octave:6},'9':{note:'A',octave:6},'0':{note:'B',octave:6}
  }
},
  'A': {
  'Major': { // A B C# D E F# G#
    'z':{note:'A',octave:2},'x':{note:'B',octave:2},'c':{note:'C#',octave:3},'v':{note:'D',octave:3},'b':{note:'E',octave:3},'n':{note:'F#',octave:3},'m':{note:'G#',octave:3},',':{note:'A',octave:3},'.':{note:'B',octave:3},'/':{note:'C#',octave:4},
    'a':{note:'A',octave:3},'s':{note:'B',octave:3},'d':{note:'C#',octave:4},'f':{note:'D',octave:4},'g':{note:'E',octave:4},'h':{note:'F#',octave:4},'j':{note:'G#',octave:4},'k':{note:'A',octave:4},'l':{note:'B',octave:4},';':{note:'C#',octave:5},
    'q':{note:'A',octave:4},'w':{note:'B',octave:4},'e':{note:'C#',octave:5},'r':{note:'D',octave:5},'t':{note:'E',octave:5},'y':{note:'F#',octave:5},'u':{note:'G#',octave:5},'i':{note:'A',octave:5},'o':{note:'B',octave:5},'p':{note:'C#',octave:6},
    '1':{note:'A',octave:5},'2':{note:'B',octave:5},'3':{note:'C#',octave:6},'4':{note:'D',octave:6},'5':{note:'E',octave:6},'6':{note:'F#',octave:6},'7':{note:'G#',octave:6},'8':{note:'A',octave:6},'9':{note:'B',octave:6},'0':{note:'C#',octave:7}
  },
  'Natural Minor': { // A B C D E F G
    'z':{note:'A',octave:2},'x':{note:'B',octave:2},'c':{note:'C',octave:3},'v':{note:'D',octave:3},'b':{note:'E',octave:3},'n':{note:'F',octave:3},'m':{note:'G',octave:3},',':{note:'A',octave:3},'.':{note:'B',octave:3},'/':{note:'C',octave:4},
    'a':{note:'A',octave:3},'s':{note:'B',octave:3},'d':{note:'C',octave:4},'f':{note:'D',octave:4},'g':{note:'E',octave:4},'h':{note:'F',octave:4},'j':{note:'G',octave:4},'k':{note:'A',octave:4},'l':{note:'B',octave:4},';':{note:'C',octave:5},
    'q':{note:'A',octave:4},'w':{note:'B',octave:4},'e':{note:'C',octave:5},'r':{note:'D',octave:5},'t':{note:'E',octave:5},'y':{note:'F',octave:5},'u':{note:'G',octave:5},'i':{note:'A',octave:5},'o':{note:'B',octave:5},'p':{note:'C',octave:6},
    '1':{note:'A',octave:5},'2':{note:'B',octave:5},'3':{note:'C',octave:6},'4':{note:'D',octave:6},'5':{note:'E',octave:6},'6':{note:'F',octave:6},'7':{note:'G',octave:6},'8':{note:'A',octave:6},'9':{note:'B',octave:6},'0':{note:'C',octave:7}
  },
  'Harmonic Minor': { // A B C D E F G#
    'z':{note:'A',octave:2},'x':{note:'B',octave:2},'c':{note:'C',octave:3},'v':{note:'D',octave:3},'b':{note:'E',octave:3},'n':{note:'F',octave:3},'m':{note:'G#',octave:3},',':{note:'A',octave:3},'.':{note:'B',octave:3},'/':{note:'C',octave:4},
    'a':{note:'A',octave:3},'s':{note:'B',octave:3},'d':{note:'C',octave:4},'f':{note:'D',octave:4},'g':{note:'E',octave:4},'h':{note:'F',octave:4},'j':{note:'G#',octave:4},'k':{note:'A',octave:4},'l':{note:'B',octave:4},';':{note:'C',octave:5},
    'q':{note:'A',octave:4},'w':{note:'B',octave:4},'e':{note:'C',octave:5},'r':{note:'D',octave:5},'t':{note:'E',octave:5},'y':{note:'F',octave:5},'u':{note:'G#',octave:5},'i':{note:'A',octave:5},'o':{note:'B',octave:5},'p':{note:'C',octave:6},
    '1':{note:'A',octave:5},'2':{note:'B',octave:5},'3':{note:'C',octave:6},'4':{note:'D',octave:6},'5':{note:'E',octave:6},'6':{note:'F',octave:6},'7':{note:'G#',octave:6},'8':{note:'A',octave:6},'9':{note:'B',octave:6},'0':{note:'C',octave:7}
  },
  'Melodic Minor': { // ascending: A B C D E F# G#
    'z':{note:'A',octave:2},'x':{note:'B',octave:2},'c':{note:'C',octave:3},'v':{note:'D',octave:3},'b':{note:'E',octave:3},'n':{note:'F#',octave:3},'m':{note:'G#',octave:3},',':{note:'A',octave:3},'.':{note:'B',octave:3},'/':{note:'C',octave:4},
    'a':{note:'A',octave:3},'s':{note:'B',octave:3},'d':{note:'C',octave:4},'f':{note:'D',octave:4},'g':{note:'E',octave:4},'h':{note:'F#',octave:4},'j':{note:'G#',octave:4},'k':{note:'A',octave:4},'l':{note:'B',octave:4},';':{note:'C',octave:5},
    'q':{note:'A',octave:4},'w':{note:'B',octave:4},'e':{note:'C',octave:5},'r':{note:'D',octave:5},'t':{note:'E',octave:5},'y':{note:'F#',octave:5},'u':{note:'G#',octave:5},'i':{note:'A',octave:5},'o':{note:'B',octave:5},'p':{note:'C',octave:6},
    '1':{note:'A',octave:5},'2':{note:'B',octave:5},'3':{note:'C',octave:6},'4':{note:'D',octave:6},'5':{note:'E',octave:6},'6':{note:'F#',octave:6},'7':{note:'G#',octave:6},'8':{note:'A',octave:6},'9':{note:'B',octave:6},'0':{note:'C',octave:7}
  },
  'Dorian': { // A B C D E F# G
    'z':{note:'A',octave:2},'x':{note:'B',octave:2},'c':{note:'C',octave:3},'v':{note:'D',octave:3},'b':{note:'E',octave:3},'n':{note:'F#',octave:3},'m':{note:'G',octave:3},',':{note:'A',octave:3},'.':{note:'B',octave:3},'/':{note:'C',octave:4},
    'a':{note:'A',octave:3},'s':{note:'B',octave:3},'d':{note:'C',octave:4},'f':{note:'D',octave:4},'g':{note:'E',octave:4},'h':{note:'F#',octave:4},'j':{note:'G',octave:4},'k':{note:'A',octave:4},'l':{note:'B',octave:4},';':{note:'C',octave:5},
    'q':{note:'A',octave:4},'w':{note:'B',octave:4},'e':{note:'C',octave:5},'r':{note:'D',octave:5},'t':{note:'E',octave:5},'y':{note:'F#',octave:5},'u':{note:'G',octave:5},'i':{note:'A',octave:5},'o':{note:'B',octave:5},'p':{note:'C',octave:6},
    '1':{note:'A',octave:5},'2':{note:'B',octave:5},'3':{note:'C',octave:6},'4':{note:'D',octave:6},'5':{note:'E',octave:6},'6':{note:'F#',octave:6},'7':{note:'G',octave:6},'8':{note:'A',octave:6},'9':{note:'B',octave:6},'0':{note:'C',octave:7}
  },
  'Phrygian': { // A Bb C D E F G
    'z':{note:'A',octave:2},'x':{note:'Bb',octave:2},'c':{note:'C',octave:3},'v':{note:'D',octave:3},'b':{note:'E',octave:3},'n':{note:'F',octave:3},'m':{note:'G',octave:3},',':{note:'A',octave:3},'.':{note:'Bb',octave:3},'/':{note:'C',octave:4},
    'a':{note:'A',octave:3},'s':{note:'Bb',octave:3},'d':{note:'C',octave:4},'f':{note:'D',octave:4},'g':{note:'E',octave:4},'h':{note:'F',octave:4},'j':{note:'G',octave:4},'k':{note:'A',octave:4},'l':{note:'Bb',octave:4},';':{note:'C',octave:5},
    'q':{note:'A',octave:4},'w':{note:'Bb',octave:4},'e':{note:'C',octave:5},'r':{note:'D',octave:5},'t':{note:'E',octave:5},'y':{note:'F',octave:5},'u':{note:'G',octave:5},'i':{note:'A',octave:5},'o':{note:'Bb',octave:5},'p':{note:'C',octave:6},
    '1':{note:'A',octave:5},'2':{note:'Bb',octave:5},'3':{note:'C',octave:6},'4':{note:'D',octave:6},'5':{note:'E',octave:6},'6':{note:'F',octave:6},'7':{note:'G',octave:6},'8':{note:'A',octave:6},'9':{note:'Bb',octave:6},'0':{note:'C',octave:7}
  },
  'Lydian': { // A B C# D# E F# G#
    'z':{note:'A',octave:2},'x':{note:'B',octave:2},'c':{note:'C#',octave:3},'v':{note:'D#',octave:3},'b':{note:'E',octave:3},'n':{note:'F#',octave:3},'m':{note:'G#',octave:3},',':{note:'A',octave:3},'.':{note:'B',octave:3},'/':{note:'C#',octave:4},
    'a':{note:'A',octave:3},'s':{note:'B',octave:3},'d':{note:'C#',octave:4},'f':{note:'D#',octave:4},'g':{note:'E',octave:4},'h':{note:'F#',octave:4},'j':{note:'G#',octave:4},'k':{note:'A',octave:4},'l':{note:'B',octave:4},';':{note:'C#',octave:5},
    'q':{note:'A',octave:4},'w':{note:'B',octave:4},'e':{note:'C#',octave:5},'r':{note:'D#',octave:5},'t':{note:'E',octave:5},'y':{note:'F#',octave:5},'u':{note:'G#',octave:5},'i':{note:'A',octave:5},'o':{note:'B',octave:5},'p':{note:'C#',octave:6},
    '1':{note:'A',octave:5},'2':{note:'B',octave:5},'3':{note:'C#',octave:6},'4':{note:'D#',octave:6},'5':{note:'E',octave:6},'6':{note:'F#',octave:6},'7':{note:'G#',octave:6},'8':{note:'A',octave:6},'9':{note:'B',octave:6},'0':{note:'C#',octave:7}
  },
  'Mixolydian': { // A B C# D E F# G
    'z':{note:'A',octave:2},'x':{note:'B',octave:2},'c':{note:'C#',octave:3},'v':{note:'D',octave:3},'b':{note:'E',octave:3},'n':{note:'F#',octave:3},'m':{note:'G',octave:3},',':{note:'A',octave:3},'.':{note:'B',octave:3},'/':{note:'C#',octave:4},
    'a':{note:'A',octave:3},'s':{note:'B',octave:3},'d':{note:'C#',octave:4},'f':{note:'D',octave:4},'g':{note:'E',octave:4},'h':{note:'F#',octave:4},'j':{note:'G',octave:4},'k':{note:'A',octave:4},'l':{note:'B',octave:4},';':{note:'C#',octave:5},
    'q':{note:'A',octave:4},'w':{note:'B',octave:4},'e':{note:'C#',octave:5},'r':{note:'D',octave:5},'t':{note:'E',octave:5},'y':{note:'F#',octave:5},'u':{note:'G',octave:5},'i':{note:'A',octave:5},'o':{note:'B',octave:5},'p':{note:'C#',octave:6},
    '1':{note:'A',octave:5},'2':{note:'B',octave:5},'3':{note:'C#',octave:6},'4':{note:'D',octave:6},'5':{note:'E',octave:6},'6':{note:'F#',octave:6},'7':{note:'G',octave:6},'8':{note:'A',octave:6},'9':{note:'B',octave:6},'0':{note:'C#',octave:7}
  },
  'Locrian': { // A Bb C D Eb F G
    'z':{note:'A',octave:2},'x':{note:'Bb',octave:2},'c':{note:'C',octave:3},'v':{note:'D',octave:3},'b':{note:'Eb',octave:3},'n':{note:'F',octave:3},'m':{note:'G',octave:3},',':{note:'A',octave:3},'.':{note:'Bb',octave:3},'/':{note:'C',octave:4},
    'a':{note:'A',octave:3},'s':{note:'Bb',octave:3},'d':{note:'C',octave:4},'f':{note:'D',octave:4},'g':{note:'Eb',octave:4},'h':{note:'F',octave:4},'j':{note:'G',octave:4},'k':{note:'A',octave:4},'l':{note:'Bb',octave:4},';':{note:'C',octave:5},
    'q':{note:'A',octave:4},'w':{note:'Bb',octave:4},'e':{note:'C',octave:5},'r':{note:'D',octave:5},'t':{note:'Eb',octave:5},'y':{note:'F',octave:5},'u':{note:'G',octave:5},'i':{note:'A',octave:5},'o':{note:'Bb',octave:5},'p':{note:'C',octave:6},
    '1':{note:'A',octave:5},'2':{note:'Bb',octave:5},'3':{note:'C',octave:6},'4':{note:'D',octave:6},'5':{note:'Eb',octave:6},'6':{note:'F',octave:6},'7':{note:'G',octave:6},'8':{note:'A',octave:6},'9':{note:'Bb',octave:6},'0':{note:'C',octave:7}
  }
},
  'Bb': {
  'Major': { // Bb C D Eb F G A
    'z':{note:'Bb',octave:2},'x':{note:'C',octave:3},'c':{note:'D',octave:3},'v':{note:'Eb',octave:3},'b':{note:'F',octave:3},'n':{note:'G',octave:3},'m':{note:'A',octave:3},',':{note:'Bb',octave:3},'.':{note:'C',octave:4},'/':{note:'D',octave:4},
    'a':{note:'Bb',octave:3},'s':{note:'C',octave:4},'d':{note:'D',octave:4},'f':{note:'Eb',octave:4},'g':{note:'F',octave:4},'h':{note:'G',octave:4},'j':{note:'A',octave:4},'k':{note:'Bb',octave:4},'l':{note:'C',octave:5},';':{note:'D',octave:5},
    'q':{note:'Bb',octave:4},'w':{note:'C',octave:5},'e':{note:'D',octave:5},'r':{note:'Eb',octave:5},'t':{note:'F',octave:5},'y':{note:'G',octave:5},'u':{note:'A',octave:5},'i':{note:'Bb',octave:5},'o':{note:'C',octave:6},'p':{note:'D',octave:6},
    '1':{note:'Bb',octave:5},'2':{note:'C',octave:6},'3':{note:'D',octave:6},'4':{note:'Eb',octave:6},'5':{note:'F',octave:6},'6':{note:'G',octave:6},'7':{note:'A',octave:6},'8':{note:'Bb',octave:6},'9':{note:'C',octave:7},'0':{note:'D',octave:7}
  },

  'Natural Minor': { // Bb C Db Eb F Gb Ab
    'z':{note:'Bb',octave:2},'x':{note:'C',octave:3},'c':{note:'Db',octave:3},'v':{note:'Eb',octave:3},'b':{note:'F',octave:3},'n':{note:'Gb',octave:3},'m':{note:'Ab',octave:3},',':{note:'Bb',octave:3},'.':{note:'C',octave:4},'/':{note:'Db',octave:4},
    'a':{note:'Bb',octave:3},'s':{note:'C',octave:4},'d':{note:'Db',octave:4},'f':{note:'Eb',octave:4},'g':{note:'F',octave:4},'h':{note:'Gb',octave:4},'j':{note:'Ab',octave:4},'k':{note:'Bb',octave:4},'l':{note:'C',octave:5},';':{note:'Db',octave:5},
    'q':{note:'Bb',octave:4},'w':{note:'C',octave:5},'e':{note:'Db',octave:5},'r':{note:'Eb',octave:5},'t':{note:'F',octave:5},'y':{note:'Gb',octave:5},'u':{note:'Ab',octave:5},'i':{note:'Bb',octave:5},'o':{note:'C',octave:6},'p':{note:'Db',octave:6},
    '1':{note:'Bb',octave:5},'2':{note:'C',octave:6},'3':{note:'Db',octave:6},'4':{note:'Eb',octave:6},'5':{note:'F',octave:6},'6':{note:'Gb',octave:6},'7':{note:'Ab',octave:6},'8':{note:'Bb',octave:6},'9':{note:'C',octave:7},'0':{note:'Db',octave:7}
  },

  'Harmonic Minor': { // Bb C Db Eb F Gb A
    'z':{note:'Bb',octave:2},'x':{note:'C',octave:3},'c':{note:'Db',octave:3},'v':{note:'Eb',octave:3},'b':{note:'F',octave:3},'n':{note:'Gb',octave:3},'m':{note:'A',octave:3},',':{note:'Bb',octave:3},'.':{note:'C',octave:4},'/':{note:'Db',octave:4},
    'a':{note:'Bb',octave:3},'s':{note:'C',octave:4},'d':{note:'Db',octave:4},'f':{note:'Eb',octave:4},'g':{note:'F',octave:4},'h':{note:'Gb',octave:4},'j':{note:'A',octave:4},'k':{note:'Bb',octave:4},'l':{note:'C',octave:5},';':{note:'Db',octave:5},
    'q':{note:'Bb',octave:4},'w':{note:'C',octave:5},'e':{note:'Db',octave:5},'r':{note:'Eb',octave:5},'t':{note:'F',octave:5},'y':{note:'Gb',octave:5},'u':{note:'A',octave:5},'i':{note:'Bb',octave:5},'o':{note:'C',octave:6},'p':{note:'Db',octave:6},
    '1':{note:'Bb',octave:5},'2':{note:'C',octave:6},'3':{note:'Db',octave:6},'4':{note:'Eb',octave:6},'5':{note:'F',octave:6},'6':{note:'Gb',octave:6},'7':{note:'A',octave:6},'8':{note:'Bb',octave:6},'9':{note:'C',octave:7},'0':{note:'Db',octave:7}
  },

  'Melodic Minor': { // ascending: Bb C Db Eb F G A
    'z':{note:'Bb',octave:2},'x':{note:'C',octave:3},'c':{note:'Db',octave:3},'v':{note:'Eb',octave:3},'b':{note:'F',octave:3},'n':{note:'G',octave:3},'m':{note:'A',octave:3},',':{note:'Bb',octave:3},'.':{note:'C',octave:4},'/':{note:'Db',octave:4},
    'a':{note:'Bb',octave:3},'s':{note:'C',octave:4},'d':{note:'Db',octave:4},'f':{note:'Eb',octave:4},'g':{note:'F',octave:4},'h':{note:'G',octave:4},'j':{note:'A',octave:4},'k':{note:'Bb',octave:4},'l':{note:'C',octave:5},';':{note:'Db',octave:5},
    'q':{note:'Bb',octave:4},'w':{note:'C',octave:5},'e':{note:'Db',octave:5},'r':{note:'Eb',octave:5},'t':{note:'F',octave:5},'y':{note:'G',octave:5},'u':{note:'A',octave:5},'i':{note:'Bb',octave:5},'o':{note:'C',octave:6},'p':{note:'Db',octave:6},
    '1':{note:'Bb',octave:5},'2':{note:'C',octave:6},'3':{note:'Db',octave:6},'4':{note:'Eb',octave:6},'5':{note:'F',octave:6},'6':{note:'G',octave:6},'7':{note:'A',octave:6},'8':{note:'Bb',octave:6},'9':{note:'C',octave:7},'0':{note:'Db',octave:7}
  },

  'Dorian': { // Bb C Db Eb F G Ab
    'z':{note:'Bb',octave:2},'x':{note:'C',octave:3},'c':{note:'Db',octave:3},'v':{note:'Eb',octave:3},'b':{note:'F',octave:3},'n':{note:'G',octave:3},'m':{note:'Ab',octave:3},',':{note:'Bb',octave:3},'.':{note:'C',octave:4},'/':{note:'Db',octave:4},
    'a':{note:'Bb',octave:3},'s':{note:'C',octave:4},'d':{note:'Db',octave:4},'f':{note:'Eb',octave:4},'g':{note:'F',octave:4},'h':{note:'G',octave:4},'j':{note:'Ab',octave:4},'k':{note:'Bb',octave:4},'l':{note:'C',octave:5},';':{note:'Db',octave:5},
    'q':{note:'Bb',octave:4},'w':{note:'C',octave:5},'e':{note:'Db',octave:5},'r':{note:'Eb',octave:5},'t':{note:'F',octave:5},'y':{note:'G',octave:5},'u':{note:'Ab',octave:5},'i':{note:'Bb',octave:5},'o':{note:'C',octave:6},'p':{note:'Db',octave:6},
    '1':{note:'Bb',octave:5},'2':{note:'C',octave:6},'3':{note:'Db',octave:6},'4':{note:'Eb',octave:6},'5':{note:'F',octave:6},'6':{note:'G',octave:6},'7':{note:'Ab',octave:6},'8':{note:'Bb',octave:6},'9':{note:'C',octave:7},'0':{note:'Db',octave:7}
  },

  'Phrygian': { // Bb B Db Eb F Gb Ab
    'z':{note:'Bb',octave:2},'x':{note:'B',octave:2},'c':{note:'Db',octave:3},'v':{note:'Eb',octave:3},'b':{note:'F',octave:3},'n':{note:'Gb',octave:3},'m':{note:'Ab',octave:3},',':{note:'Bb',octave:3},'.':{note:'B',octave:3},'/':{note:'Db',octave:4},
    'a':{note:'Bb',octave:3},'s':{note:'B',octave:3},'d':{note:'Db',octave:4},'f':{note:'Eb',octave:4},'g':{note:'F',octave:4},'h':{note:'Gb',octave:4},'j':{note:'Ab',octave:4},'k':{note:'Bb',octave:4},'l':{note:'B',octave:4},';':{note:'Db',octave:5},
    'q':{note:'Bb',octave:4},'w':{note:'B',octave:4},'e':{note:'Db',octave:5},'r':{note:'Eb',octave:5},'t':{note:'F',octave:5},'y':{note:'Gb',octave:5},'u':{note:'Ab',octave:5},'i':{note:'Bb',octave:5},'o':{note:'B',octave:5},'p':{note:'Db',octave:6},
    '1':{note:'Bb',octave:5},'2':{note:'B',octave:5},'3':{note:'Db',octave:6},'4':{note:'Eb',octave:6},'5':{note:'F',octave:6},'6':{note:'Gb',octave:6},'7':{note:'Ab',octave:6},'8':{note:'Bb',octave:6},'9':{note:'B',octave:6},'0':{note:'Db',octave:7}
  },

  'Lydian': { // Bb C D E F G A
    'z':{note:'Bb',octave:2},'x':{note:'C',octave:3},'c':{note:'D',octave:3},'v':{note:'E',octave:3},'b':{note:'F',octave:3},'n':{note:'G',octave:3},'m':{note:'A',octave:3},',':{note:'Bb',octave:3},'.':{note:'C',octave:4},'/':{note:'D',octave:4},
    'a':{note:'Bb',octave:3},'s':{note:'C',octave:4},'d':{note:'D',octave:4},'f':{note:'E',octave:4},'g':{note:'F',octave:4},'h':{note:'G',octave:4},'j':{note:'A',octave:4},'k':{note:'Bb',octave:4},'l':{note:'C',octave:5},';':{note:'D',octave:5},
    'q':{note:'Bb',octave:4},'w':{note:'C',octave:5},'e':{note:'D',octave:5},'r':{note:'E',octave:5},'t':{note:'F',octave:5},'y':{note:'G',octave:5},'u':{note:'A',octave:5},'i':{note:'Bb',octave:5},'o':{note:'C',octave:6},'p':{note:'D',octave:6},
    '1':{note:'Bb',octave:5},'2':{note:'C',octave:6},'3':{note:'D',octave:6},'4':{note:'E',octave:6},'5':{note:'F',octave:6},'6':{note:'G',octave:6},'7':{note:'A',octave:6},'8':{note:'Bb',octave:6},'9':{note:'C',octave:7},'0':{note:'D',octave:7}
  },

  'Mixolydian': { // Bb C D Eb F G Ab
    'z':{note:'Bb',octave:2},'x':{note:'C',octave:3},'c':{note:'D',octave:3},'v':{note:'Eb',octave:3},'b':{note:'F',octave:3},'n':{note:'G',octave:3},'m':{note:'Ab',octave:3},',':{note:'Bb',octave:3},'.':{note:'C',octave:4},'/':{note:'D',octave:4},
    'a':{note:'Bb',octave:3},'s':{note:'C',octave:4},'d':{note:'D',octave:4},'f':{note:'Eb',octave:4},'g':{note:'F',octave:4},'h':{note:'G',octave:4},'j':{note:'Ab',octave:4},'k':{note:'Bb',octave:4},'l':{note:'C',octave:5},';':{note:'D',octave:5},
    'q':{note:'Bb',octave:4},'w':{note:'C',octave:5},'e':{note:'D',octave:5},'r':{note:'Eb',octave:5},'t':{note:'F',octave:5},'y':{note:'G',octave:5},'u':{note:'Ab',octave:5},'i':{note:'Bb',octave:5},'o':{note:'C',octave:6},'p':{note:'D',octave:6},
    '1':{note:'Bb',octave:5},'2':{note:'C',octave:6},'3':{note:'D',octave:6},'4':{note:'Eb',octave:6},'5':{note:'F',octave:6},'6':{note:'G',octave:6},'7':{note:'Ab',octave:6},'8':{note:'Bb',octave:6},'9':{note:'C',octave:7},'0':{note:'D',octave:7}
  },

  'Locrian': { // Bb B Db Eb E Gb Ab
    'z':{note:'Bb',octave:2},'x':{note:'B',octave:2},'c':{note:'Db',octave:3},'v':{note:'Eb',octave:3},'b':{note:'E',octave:3},'n':{note:'Gb',octave:3},'m':{note:'Ab',octave:3},',':{note:'Bb',octave:3},'.':{note:'B',octave:3},'/':{note:'Db',octave:4},
    'a':{note:'Bb',octave:3},'s':{note:'B',octave:3},'d':{note:'Db',octave:4},'f':{note:'Eb',octave:4},'g':{note:'E',octave:4},'h':{note:'Gb',octave:4},'j':{note:'Ab',octave:4},'k':{note:'Bb',octave:4},'l':{note:'B',octave:4},';':{note:'Db',octave:5},
    'q':{note:'Bb',octave:4},'w':{note:'B',octave:4},'e':{note:'Db',octave:5},'r':{note:'Eb',octave:5},'t':{note:'E',octave:5},'y':{note:'Gb',octave:5},'u':{note:'Ab',octave:5},'i':{note:'Bb',octave:5},'o':{note:'B',octave:5},'p':{note:'Db',octave:6},
    '1':{note:'Bb',octave:5},'2':{note:'B',octave:5},'3':{note:'Db',octave:6},'4':{note:'Eb',octave:6},'5':{note:'E',octave:6},'6':{note:'Gb',octave:6},'7':{note:'Ab',octave:6},'8':{note:'Bb',octave:6},'9':{note:'B',octave:6},'0':{note:'Db',octave:7}
  }
},
  'B': {
  'Major': { // B C# D# E F# G# A#
    'z':{note:'B',octave:2},'x':{note:'C#',octave:3},'c':{note:'D#',octave:3},'v':{note:'E',octave:3},'b':{note:'F#',octave:3},'n':{note:'G#',octave:3},'m':{note:'A#',octave:3},',':{note:'B',octave:3},'.':{note:'C#',octave:4},'/':{note:'D#',octave:4},
    'a':{note:'B',octave:3},'s':{note:'C#',octave:4},'d':{note:'D#',octave:4},'f':{note:'E',octave:4},'g':{note:'F#',octave:4},'h':{note:'G#',octave:4},'j':{note:'A#',octave:4},'k':{note:'B',octave:4},'l':{note:'C#',octave:5},';':{note:'D#',octave:5},
    'q':{note:'B',octave:4},'w':{note:'C#',octave:5},'e':{note:'D#',octave:5},'r':{note:'E',octave:5},'t':{note:'F#',octave:5},'y':{note:'G#',octave:5},'u':{note:'A#',octave:5},'i':{note:'B',octave:5},'o':{note:'C#',octave:6},'p':{note:'D#',octave:6},
    '1':{note:'B',octave:5},'2':{note:'C#',octave:6},'3':{note:'D#',octave:6},'4':{note:'E',octave:6},'5':{note:'F#',octave:6},'6':{note:'G#',octave:6},'7':{note:'A#',octave:6},'8':{note:'B',octave:6},'9':{note:'C#',octave:7},'0':{note:'D#',octave:7}
  },
  'Natural Minor': { // B C# D E F# G A
    'z':{note:'B',octave:2},'x':{note:'C#',octave:3},'c':{note:'D',octave:3},'v':{note:'E',octave:3},'b':{note:'F#',octave:3},'n':{note:'G',octave:3},'m':{note:'A',octave:3},',':{note:'B',octave:3},'.':{note:'C#',octave:4},'/':{note:'D',octave:4},
    'a':{note:'B',octave:3},'s':{note:'C#',octave:4},'d':{note:'D',octave:4},'f':{note:'E',octave:4},'g':{note:'F#',octave:4},'h':{note:'G',octave:4},'j':{note:'A',octave:4},'k':{note:'B',octave:4},'l':{note:'C#',octave:5},';':{note:'D',octave:5},
    'q':{note:'B',octave:4},'w':{note:'C#',octave:5},'e':{note:'D',octave:5},'r':{note:'E',octave:5},'t':{note:'F#',octave:5},'y':{note:'G',octave:5},'u':{note:'A',octave:5},'i':{note:'B',octave:5},'o':{note:'C#',octave:6},'p':{note:'D',octave:6},
    '1':{note:'B',octave:5},'2':{note:'C#',octave:6},'3':{note:'D',octave:6},'4':{note:'E',octave:6},'5':{note:'F#',octave:6},'6':{note:'G',octave:6},'7':{note:'A',octave:6},'8':{note:'B',octave:6},'9':{note:'C#',octave:7},'0':{note:'D',octave:7}
  },
  'Harmonic Minor': { // B C# D E F# G A#
    'z':{note:'B',octave:2},'x':{note:'C#',octave:3},'c':{note:'D',octave:3},'v':{note:'E',octave:3},'b':{note:'F#',octave:3},'n':{note:'G',octave:3},'m':{note:'A#',octave:3},',':{note:'B',octave:3},'.':{note:'C#',octave:4},'/':{note:'D',octave:4},
    'a':{note:'B',octave:3},'s':{note:'C#',octave:4},'d':{note:'D',octave:4},'f':{note:'E',octave:4},'g':{note:'F#',octave:4},'h':{note:'G',octave:4},'j':{note:'A#',octave:4},'k':{note:'B',octave:4},'l':{note:'C#',octave:5},';':{note:'D',octave:5},
    'q':{note:'B',octave:4},'w':{note:'C#',octave:5},'e':{note:'D',octave:5},'r':{note:'E',octave:5},'t':{note:'F#',octave:5},'y':{note:'G',octave:5},'u':{note:'A#',octave:5},'i':{note:'B',octave:5},'o':{note:'C#',octave:6},'p':{note:'D',octave:6},
    '1':{note:'B',octave:5},'2':{note:'C#',octave:6},'3':{note:'D',octave:6},'4':{note:'E',octave:6},'5':{note:'F#',octave:6},'6':{note:'G',octave:6},'7':{note:'A#',octave:6},'8':{note:'B',octave:6},'9':{note:'C#',octave:7},'0':{note:'D',octave:7}
  },
  'Melodic Minor': { // ascending: B C# D E F# G# A#
    'z':{note:'B',octave:2},'x':{note:'C#',octave:3},'c':{note:'D',octave:3},'v':{note:'E',octave:3},'b':{note:'F#',octave:3},'n':{note:'G#',octave:3},'m':{note:'A#',octave:3},',':{note:'B',octave:3},'.':{note:'C#',octave:4},'/':{note:'D',octave:4},
    'a':{note:'B',octave:3},'s':{note:'C#',octave:4},'d':{note:'D',octave:4},'f':{note:'E',octave:4},'g':{note:'F#',octave:4},'h':{note:'G#',octave:4},'j':{note:'A#',octave:4},'k':{note:'B',octave:4},'l':{note:'C#',octave:5},';':{note:'D',octave:5},
    'q':{note:'B',octave:4},'w':{note:'C#',octave:5},'e':{note:'D',octave:5},'r':{note:'E',octave:5},'t':{note:'F#',octave:5},'y':{note:'G#',octave:5},'u':{note:'A#',octave:5},'i':{note:'B',octave:5},'o':{note:'C#',octave:6},'p':{note:'D',octave:6},
    '1':{note:'B',octave:5},'2':{note:'C#',octave:6},'3':{note:'D',octave:6},'4':{note:'E',octave:6},'5':{note:'F#',octave:6},'6':{note:'G#',octave:6},'7':{note:'A#',octave:6},'8':{note:'B',octave:6},'9':{note:'C#',octave:7},'0':{note:'D',octave:7}
  },
  'Dorian': { // B C# D E F# G# A
    'z':{note:'B',octave:2},'x':{note:'C#',octave:3},'c':{note:'D',octave:3},'v':{note:'E',octave:3},'b':{note:'F#',octave:3},'n':{note:'G#',octave:3},'m':{note:'A',octave:3},',':{note:'B',octave:3},'.':{note:'C#',octave:4},'/':{note:'D',octave:4},
    'a':{note:'B',octave:3},'s':{note:'C#',octave:4},'d':{note:'D',octave:4},'f':{note:'E',octave:4},'g':{note:'F#',octave:4},'h':{note:'G#',octave:4},'j':{note:'A',octave:4},'k':{note:'B',octave:4},'l':{note:'C#',octave:5},';':{note:'D',octave:5},
    'q':{note:'B',octave:4},'w':{note:'C#',octave:5},'e':{note:'D',octave:5},'r':{note:'E',octave:5},'t':{note:'F#',octave:5},'y':{note:'G#',octave:5},'u':{note:'A',octave:5},'i':{note:'B',octave:5},'o':{note:'C#',octave:6},'p':{note:'D',octave:6},
    '1':{note:'B',octave:5},'2':{note:'C#',octave:6},'3':{note:'D',octave:6},'4':{note:'E',octave:6},'5':{note:'F#',octave:6},'6':{note:'G#',octave:6},'7':{note:'A',octave:6},'8':{note:'B',octave:6},'9':{note:'C#',octave:7},'0':{note:'D',octave:7}
  },
  'Phrygian': { // B C D E F# G A
    'z':{note:'B',octave:2},'x':{note:'C',octave:3},'c':{note:'D',octave:3},'v':{note:'E',octave:3},'b':{note:'F#',octave:3},'n':{note:'G',octave:3},'m':{note:'A',octave:3},',':{note:'B',octave:3},'.':{note:'C',octave:4},'/':{note:'D',octave:4},
    'a':{note:'B',octave:3},'s':{note:'C',octave:4},'d':{note:'D',octave:4},'f':{note:'E',octave:4},'g':{note:'F#',octave:4},'h':{note:'G',octave:4},'j':{note:'A',octave:4},'k':{note:'B',octave:4},'l':{note:'C',octave:5},';':{note:'D',octave:5},
    'q':{note:'B',octave:4},'w':{note:'C',octave:5},'e':{note:'D',octave:5},'r':{note:'E',octave:5},'t':{note:'F#',octave:5},'y':{note:'G',octave:5},'u':{note:'A',octave:5},'i':{note:'B',octave:5},'o':{note:'C',octave:6},'p':{note:'D',octave:6},
    '1':{note:'B',octave:5},'2':{note:'C',octave:6},'3':{note:'D',octave:6},'4':{note:'E',octave:6},'5':{note:'F#',octave:6},'6':{note:'G',octave:6},'7':{note:'A',octave:6},'8':{note:'B',octave:6},'9':{note:'C',octave:7},'0':{note:'D',octave:7}
  },
  'Lydian': { // B C# D# E# F# G# A#
    'z':{note:'B',octave:2},'x':{note:'C#',octave:3},'c':{note:'D#',octave:3},'v':{note:'E#',octave:3},'b':{note:'F#',octave:3},'n':{note:'G#',octave:3},'m':{note:'A#',octave:3},',':{note:'B',octave:3},'.':{note:'C#',octave:4},'/':{note:'D#',octave:4},
    'a':{note:'B',octave:3},'s':{note:'C#',octave:4},'d':{note:'D#',octave:4},'f':{note:'E#',octave:4},'g':{note:'F#',octave:4},'h':{note:'G#',octave:4},'j':{note:'A#',octave:4},'k':{note:'B',octave:4},'l':{note:'C#',octave:5},';':{note:'D#',octave:5},
    'q':{note:'B',octave:4},'w':{note:'C#',octave:5},'e':{note:'D#',octave:5},'r':{note:'E#',octave:5},'t':{note:'F#',octave:5},'y':{note:'G#',octave:5},'u':{note:'A#',octave:5},'i':{note:'B',octave:5},'o':{note:'C#',octave:6},'p':{note:'D#',octave:6},
    '1':{note:'B',octave:5},'2':{note:'C#',octave:6},'3':{note:'D#',octave:6},'4':{note:'E#',octave:6},'5':{note:'F#',octave:6},'6':{note:'G#',octave:6},'7':{note:'A#',octave:6},'8':{note:'B',octave:6},'9':{note:'C#',octave:7},'0':{note:'D#',octave:7}
  },
  'Mixolydian': { // B C# D# E F# G# A
    'z':{note:'B',octave:2},'x':{note:'C#',octave:3},'c':{note:'D#',octave:3},'v':{note:'E',octave:3},'b':{note:'F#',octave:3},'n':{note:'G#',octave:3},'m':{note:'A',octave:3},',':{note:'B',octave:3},'.':{note:'C#',octave:4},'/':{note:'D#',octave:4},
    'a':{note:'B',octave:3},'s':{note:'C#',octave:4},'d':{note:'D#',octave:4},'f':{note:'E',octave:4},'g':{note:'F#',octave:4},'h':{note:'G#',octave:4},'j':{note:'A',octave:4},'k':{note:'B',octave:4},'l':{note:'C#',octave:5},';':{note:'D#',octave:5},
    'q':{note:'B',octave:4},'w':{note:'C#',octave:5},'e':{note:'D#',octave:5},'r':{note:'E',octave:5},'t':{note:'F#',octave:5},'y':{note:'G#',octave:5},'u':{note:'A',octave:5},'i':{note:'B',octave:5},'o':{note:'C#',octave:6},'p':{note:'D#',octave:6},
    '1':{note:'B',octave:5},'2':{note:'C#',octave:6},'3':{note:'D#',octave:6},'4':{note:'E',octave:6},'5':{note:'F#',octave:6},'6':{note:'G#',octave:6},'7':{note:'A',octave:6},'8':{note:'B',octave:6},'9':{note:'C#',octave:7},'0':{note:'D#',octave:7}
  },
  'Locrian': { // B C D E F G A
    'z':{note:'B',octave:2},'x':{note:'C',octave:3},'c':{note:'D',octave:3},'v':{note:'E',octave:3},'b':{note:'F',octave:3},'n':{note:'G',octave:3},'m':{note:'A',octave:3},',':{note:'B',octave:3},'.':{note:'C',octave:4},'/':{note:'D',octave:4},
    'a':{note:'B',octave:3},'s':{note:'C',octave:4},'d':{note:'D',octave:4},'f':{note:'E',octave:4},'g':{note:'F',octave:4},'h':{note:'G',octave:4},'j':{note:'A',octave:4},'k':{note:'B',octave:4},'l':{note:'C',octave:5},';':{note:'D',octave:5},
    'q':{note:'B',octave:4},'w':{note:'C',octave:5},'e':{note:'D',octave:5},'r':{note:'E',octave:5},'t':{note:'F',octave:5},'y':{note:'G',octave:5},'u':{note:'A',octave:5},'i':{note:'B',octave:5},'o':{note:'C',octave:6},'p':{note:'D',octave:6},
    '1':{note:'B',octave:5},'2':{note:'C',octave:6},'3':{note:'D',octave:6},'4':{note:'E',octave:6},'5':{note:'F',octave:6},'6':{note:'G',octave:6},'7':{note:'A',octave:6},'8':{note:'B',octave:6},'9':{note:'C',octave:7},'0':{note:'D',octave:7}
  }
}
};

function getNotesForScale(keyName, scaleName) {
    const scaleMap = flexKeymaps[keyName]?.[scaleName];
    if (!scaleMap) return new Set();

    const notes = new Set();
    for (const key in scaleMap) {
        let noteName = scaleMap[key].note;
        const flatEquivalent = sharpToFlatMap[noteName];
        if (flatEquivalent) {
            noteName = flatEquivalent;
        }
        notes.add(noteName);
    }
    return notes;
}

const whitesEl = document.getElementById('whites');
const blacksEl = document.getElementById('blacks');
let whiteKeysPhysical = [];
let blackKeysPhysical = [];

// This new structure replaces the old keyNoteMap objects.
// It stores the note name and a base octave for each key, separated by layout.
// This provides the necessary data for the dynamic note calculation logic.
const keyData = {
  // Row 1 (Numbers)
  '1': { green: {}, blue: null },
  '2': { green: {}, blue: { note: 'Db', octave: 4 } },
  '3': { green: {}, blue: { note: 'Eb', octave: 4 } },
  '4': { green: {}, blue: null },
  '5': { green: {}, blue: { note: 'Gb', octave: 4 } },
  '6': { green: {}, blue: { note: 'Ab', octave: 4 } },
  '7': { green: {}, blue: { note: 'Bb', octave: 4 } },
  '8': { green: {}, blue: null },
  '9': { green: {}, blue: { note: 'Db', octave: 5 } },
  '0': { green: {}, blue: { note: 'Eb', octave: 5 } },

  // Row 2 (QWERTY)
  'q': { green: {}, blue: { note: 'C', octave: 4 } },
  'w': { green: {}, blue: { note: 'D', octave: 4 } },
  'e': { green: {}, blue: { note: 'E', octave: 4 } },
  'r': { green: {}, blue: { note: 'F', octave: 4 } },
  't': { green: {}, blue: { note: 'G', octave: 4 } },
  'y': { green: {}, blue: { note: 'A', octave: 4 } },
  'u': { green: {}, blue: { note: 'B', octave: 4 } },
  'i': { green: {}, blue: { note: 'C', octave: 5 } },
  'o': { green: {}, blue: { note: 'D', octave: 5 } },
  'p': { green: {}, blue: { note: 'E', octave: 5 } },

  // Row 3 (ASDF)
  'a': { green: {}, blue: null },
  's': { green: {}, blue: { note: 'Db', octave: 3 } },
  'd': { green: {}, blue: { note: 'Eb', octave: 3 } },
  'f': { green: {}, blue: null },
  'g': { green: {}, blue: { note: 'Gb', octave: 3 } },
  'h': { green: {}, blue: { note: 'Ab', octave: 3 } },
  'j': { green: {}, blue: { note: 'Bb', octave: 3 } },
  'k': { green: {}, blue: null },
  'l': { green: {}, blue: { note: 'Db', octave: 4 } },
  ';': { green: {}, blue: { note: 'Eb', octave: 4 } },

  // Row 4 (ZXCV)
  'z': { green: {}, blue: { note: 'C', octave: 3 } },
  'x': { green: {}, blue: { note: 'D', octave: 3 } },
  'c': { green: {}, blue: { note: 'E', octave: 3 } },
  'v': { green: {}, blue: { note: 'F', octave: 3 } },
  'b': { green: {}, blue: { note: 'G', octave: 3 } },
  'n': { green: {}, blue: { note: 'A', octave: 3 } },
  'm': { green: {}, blue: { note: 'B', octave: 3 } },
  ',': { green: {}, blue: { note: 'C', octave: 4 } },
  '.': { green: {}, blue: { note: 'D', octave: 4 } },
  '/': { green: {}, blue: { note: 'E', octave: 4 } },
};

function updateFlexLayout(keyName, scaleName) {
  const scaleMap = flexKeymaps[keyName]?.[scaleName];
  if (!scaleMap) {
    // Maybe default to C Major if the map doesn't exist, or just clear the layout
    console.warn(`No keymap found for ${keyName} ${scaleName}`);
    return;
  }

  for (const key in scaleMap) {
    if (keyData[key] && keyData[key].green) {
      keyData[key].green = scaleMap[key];
    }
  }
}

let baseNoteOctaves = {};

function updateBaseNoteOctaves(keyName, scaleName) {
  baseNoteOctaves = {};
  const scaleMap = flexKeymaps[keyName]?.[scaleName];
  if (!scaleMap) return;

  const noteOctaves = {};
  for (const key in scaleMap) {
    const {note, octave} = scaleMap[key];
    if (!noteOctaves[note]) {
      noteOctaves[note] = [];
    }
    noteOctaves[note].push(octave);
  }

  for (const note in noteOctaves) {
    baseNoteOctaves[note] = Math.min(...noteOctaves[note]);
  }
}

const keyBindings = {
  't-green': {
    1: {
      'C3': '1qaz', 'D3': '2wsx', 'E3': '3edc', 'F3': '4rfv', 'G3': '5tgb', 'A3': '6yhn', 'B3': '7ujm',
      'C4': '8ik,', 'D4': '9ol.', 'E4': '0p;/'
    },
    2: {
      'C3': 'zq', 'D3': 'xw', 'E3': 'ce', 'F3': 'vr', 'G3': 'bt', 'A3': 'ny', 'B3': 'mu',
      'C4': '1a,i', 'D4': '2s.o', 'E4': '3d/p', // Note: User bindings were slightly different, this is corrected based on keyData
      'F4': '4f', 'G4': '5g', 'A4': '6h', 'B4': '7j',
      'C5': '8k', 'D5': '9l', 'E5': '0;'
    },
    3: {}, 4: {}
  },
  't-blue': {
    1: {
      'C3': 'zq', 'Db3': 's2', 'D3': 'xw', 'Eb3': 'd3', 'E3': 'ce', 'F3': 'vr', 'Gb3': 'g5', 'G3': 'bt', 'Ab3': 'h6', 'A3': 'ny', 'Bb3': 'j7', 'B3': 'mu',
      'C4': ',i', 'Db4': 'l9', 'D4': '.o', 'Eb4': ';0', 'E4': '/p'
    },
    2: {
        'C3': 'z', 'Db3': 's', 'D3': 'x', 'Eb3': 'd', 'E3': 'c', 'F3': 'v', 'Gb3': 'g', 'G3': 'b', 'Ab3': 'h', 'A3': 'n', 'Bb3': 'j', 'B3': 'm',
        'C4': ',q', 'Db4': 'l2', 'D4': '.w', 'Eb4': ';3', 'E4': '/e',
        'F4': 'r', 'Gb4': '5', 'G4': 't', 'Ab4': '6', 'A4': 'y', 'Bb4': '7', 'B4': 'u',
        'C5': 'i', 'Db5': '9', 'D5': 'o', 'Eb5': '0', 'E5': 'p'
    },
    3: {}, 4: {}
  }
};

function populateDynamicBindings() {
  // Generate bindings for green 3 & 4
  for (let octaves = 3; octaves <= 4; octaves++) {
    const bindings = {};
    for (const key in keyData) {
      const keyInfo = keyData[key].green;
      if (keyInfo) {
        const note = `${keyInfo.note}${keyInfo.octave}`;
        if (!bindings[note]) bindings[note] = '';
        bindings[note] += key;
      }
    }
    keyBindings['t-green'][octaves] = bindings;
  }

  // Generate un-shifted bindings for blue 3 & 4
  for (let octaves = 3; octaves <= 4; octaves++) {
    const bindings = {};
    for (const key in keyData) {
      const keyInfo = keyData[key].blue;
      if (keyInfo) {
        const note = `${keyInfo.note}${keyInfo.octave}`;
        if (!bindings[note]) bindings[note] = '';
        bindings[note] += key;
      }
    }
    keyBindings['t-blue'][octaves] = bindings;
  }

  // Calculate shifted blue bindings just once
  const shiftedBlueBindings = {};
  for (const key in keyData) {
    const keyInfo = keyData[key].blue;
    if (keyInfo) {
      const shiftedNote = `${keyInfo.note}${keyInfo.octave + 2}`;
      const displayKey = key.toUpperCase();
      if (!shiftedBlueBindings[shiftedNote]) {
        shiftedBlueBindings[shiftedNote] = '';
      }
      shiftedBlueBindings[shiftedNote] += displayKey;
    }
  }

  // Merge the shifted bindings into all blue layouts
  for (let octaves = 1; octaves <= 4; octaves++) {
    const targetBindings = keyBindings['t-blue'][octaves];
    for (const note in shiftedBlueBindings) {
      if (targetBindings[note]) {
        targetBindings[note] += shiftedBlueBindings[note];
      } else {
        targetBindings[note] = shiftedBlueBindings[note];
      }
    }
  }
}

updateFlexLayout('C', 'Major');
updateBaseNoteOctaves('C', 'Major');
populateDynamicBindings();

function formatBinding(bindingString) {
    const chars = bindingString.split('');
    if (chars.length === 4) {
        return `${chars[0]}${chars[1]}<br>${chars[2]}${chars[3]}`;
    } else if (chars.length === 2) {
        return `${chars[0]} ${chars[1]}`;
    }
    return bindingString;
}

function drawKeyboard(numOctaves = 1) {
  whitesEl.innerHTML = '';
  blacksEl.innerHTML = '';
  whiteKeysPhysical = [];
  blackKeysPhysical = [];
  
  const colorMode = toggleStates.color[currentToggleStates.color];
  const namesMode = toggleStates.names[currentToggleStates.names];
  const bindingsMode = toggleStates.bindings[currentToggleStates.bindings];
  const layoutMode = currentToggleStates.layout;
  const focusMode = toggleStates.focus[currentToggleStates.focus];

  // Get notes for the current scale, used for both Orange Names and Focus modes.
  const currentKeyName = document.querySelector('.key-selector').value;
  const currentScaleName = document.querySelector('.scale-selector').value;
  const notesInCurrentScale = getNotesForScale(currentKeyName, currentScaleName);

  const keyName = document.querySelector('.key-selector').value;
  let range;

  if (layoutMode === 't-blue') { // Chromatic mode
    range = { startNote: 'C3', endNoteBase: 'E' };
  } else { // Flex mode
    range = keyDisplayRanges[keyName] || keyDisplayRanges['C'];
  }
  
  let startNote = range.startNote;
  if (numOctaves === 1) {
    const noteName = startNote.slice(0, -1);
    const octave = parseInt(startNote.slice(-1), 10);
    startNote = `${noteName}${octave + 1}`;
  }
  const startOctave = parseInt(startNote.slice(-1));
  
  const noteOrder = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
  const fullKeyboard = [];

  // Generate a few octaves up and down from the start octave to be safe
  for (let o = -2; o < numOctaves + 2; o++) {
      for(const noteName of noteOrder) {
          fullKeyboard.push(noteName + (startOctave + o));
      }
  }

    const startNoteName = startNote.slice(0, -1);
    let endOctave = startOctave + numOctaves;
    if (pitchIndex[range.endNoteBase] < pitchIndex[startNoteName]) {
        endOctave++;
    }
    let endNote = range.endNoteBase + endOctave;
    let endNoteName = endNote.slice(0, -1);
    const endNoteOctave = endNote.slice(-1);
    if (sharpToFlatMap[endNoteName]) {
        endNote = sharpToFlatMap[endNoteName] + endNoteOctave;
    }

    let startNoteForSearch = startNote;
    const startNoteOctave = startNoteForSearch.slice(-1);
    if (sharpToFlatMap[startNoteName]) {
        startNoteForSearch = sharpToFlatMap[startNoteName] + startNoteOctave;
    }

    const startIndex = fullKeyboard.indexOf(startNoteForSearch);
    const endIndex = fullKeyboard.indexOf(endNote);

    if (startIndex === -1 || endIndex === -1) {
      console.error("Could not find start or end notes for keyboard range.", `start: ${startNoteForSearch}`, `end: ${endNote}`);
      return;
    }

    const finalKeyboard = fullKeyboard.slice(startIndex, endIndex + 1);
    
    finalKeyboard.forEach(note => {
        if (note.includes('#') || note.includes('b')) {
            blackKeysPhysical.push(note);
        } else {
            whiteKeysPhysical.push(note);
        }
    });
  
  const blackBetweenIndex = {};
  blackKeysPhysical.forEach(note => {
      const octave = parseInt(note.at(-1), 10);
      const pc = note.slice(0, -1);
      let referenceNote;
      switch(pc) {
          case 'Db': referenceNote = 'C' + octave; break;
          case 'Eb': referenceNote = 'D' + octave; break;
          case 'Gb': referenceNote = 'F' + octave; break;
          case 'Ab': referenceNote = 'G' + octave; break;
          case 'Bb': referenceNote = 'A' + octave; break;
      }
      const idx = whiteKeysPhysical.indexOf(referenceNote);
      if (idx !== -1) blackBetweenIndex[note] = idx;
  });

  const totalWhiteKeys = whiteKeysPhysical.length;
  const maxKeyboardWidth = window.innerWidth * 0.95;
  let whiteKeyWidth = Math.min(60, maxKeyboardWidth / totalWhiteKeys);
  let blackKeyWidth = whiteKeyWidth * 0.6;

  document.documentElement.style.setProperty('--white-w', `${whiteKeyWidth}px`);
  document.documentElement.style.setProperty('--black-w', `${blackKeyWidth}px`);
  document.getElementById('kb').style.width = `${totalWhiteKeys * whiteKeyWidth}px`;

  whiteKeysPhysical.forEach((note, i) => {
      const div = document.createElement('div');
      div.className = 'white-key';
      div.style.left = `${i * whiteKeyWidth}px`;
      div.dataset.note = note;
      const noteName = note.slice(0, -1);

      let isNoteInScale = notesInCurrentScale.has(noteName);
      let isDisabled = focusMode === 't-purple' && !isNoteInScale;

      if (isDisabled) {
        div.classList.add('key-disabled');
      }

      if (colorMode === 't-green') {
        const color = noteColors[noteName] || '#fff';
        if (color !== '#fff') {
          div.style.background = `linear-gradient(to bottom, ${color} 50%, #fff 50%)`;
        } else {
          div.style.backgroundColor = '#fff';
        }
      } else {
        div.style.backgroundColor = '#fff';
      }
      
      let showLabel = false;
      if (namesMode === 't-orange') {
        showLabel = notesInCurrentScale && notesInCurrentScale.has(noteName);
      } else if (namesMode === 't-yellow' || namesMode === 't-green') {
        showLabel = true;
      }

      if (showLabel) {
        const label = document.createElement('div');
        label.className = 'key-label';
        label.textContent = noteName;
        div.appendChild(label);
      }

      if (bindingsMode !== 'deactivated') {
        const binding = keyBindings[layoutMode]?.[numOctaves]?.[note];
        if (binding) {
          const bindingLabel = document.createElement('div');
          bindingLabel.className = 'binding-label';
          bindingLabel.innerHTML = formatBinding(binding);
          div.appendChild(bindingLabel);
          div.classList.add('bindings-active');
        }
      }

      whitesEl.appendChild(div);
      if (!isDisabled) {
        div.addEventListener('mousedown', () => onPointerDown(note));
        div.addEventListener('mouseup', () => onPointerUp(note));
        // mouseleave listener removed to allow for dragging
        div.addEventListener('touchstart', (ev) => { ev.preventDefault(); onPointerDown(note); }, {passive:false});
        div.addEventListener('touchend', () => onPointerUp(note));
      }
  });

  blackKeysPhysical.forEach((note) => {
      const div = document.createElement('div');
      div.className = 'black-key';
      const leftIndex = blackBetweenIndex[note];
      if (leftIndex === undefined) return;
      const x = (leftIndex + 1) * whiteKeyWidth - (blackKeyWidth / 2);
      div.style.left = `${x}px`;
      div.dataset.note = note;
      const pc = note.slice(0, -1);

      const sharpEquivalent = flatToSharpMap[pc];
      const isNoteInScale = notesInCurrentScale.has(pc) || (sharpEquivalent && notesInCurrentScale.has(sharpEquivalent));
      let isDisabled = focusMode === 't-purple' && !isNoteInScale;

      if (isDisabled) {
        div.classList.add('key-disabled');
      }

      let showLabel = false;
      if (namesMode === 't-orange') {
        showLabel = notesInCurrentScale && notesInCurrentScale.has(pc);
      } else if (namesMode === 't-blue' || namesMode === 't-green') {
        showLabel = true;
      }

      if (showLabel) {
        const label = document.createElement('div');
        label.className = 'key-label';
        label.innerHTML = blackKeyDisplayMap[pc] || '';
        div.appendChild(label);
      }

      if (bindingsMode !== 'deactivated') {
        const binding = keyBindings[layoutMode]?.[numOctaves]?.[note];
        if (binding) {
          const bindingLabel = document.createElement('div');
          bindingLabel.className = 'binding-label';
          bindingLabel.innerHTML = formatBinding(binding);
          div.appendChild(bindingLabel);
          div.classList.add('bindings-active');
        }
      }

      blacksEl.appendChild(div);
      if (!isDisabled) {
        div.addEventListener('mousedown', () => onPointerDown(note));
        div.addEventListener('mouseup', () => onPointerUp(note));
        // mouseleave listener removed to allow for dragging
        div.addEventListener('touchstart', (ev) => { ev.preventDefault(); onPointerDown(note); }, {passive:false});
        div.addEventListener('touchend', () => onPointerUp(note));
      }
  });
}

// -------- INTERACTION --------
let isDragging = false;
let lastDraggedNote = null;

function pressVisual(finalNote, pressed) {
  const el = document.querySelector(`[data-note="${finalNote}"]`);
  if (!el) return;

  el.classList.toggle('pressed', pressed);

  const noteName = finalNote.slice(0, -1);
  const colorMode = toggleStates.color[currentToggleStates.color];
  const isWhiteKey = el.classList.contains('white-key');

  if (isWhiteKey) {
    // === WHITE KEY LOGIC ===
    if (pressed) {
      if (colorMode === 'deactivated') {
        el.style.backgroundColor = '#d3d3d3'; // Turn grey when played
      } else if (colorMode === 't-green') {
        el.style.background = noteColors[noteName] || '#fff'; // Brighter version
      } else if (colorMode === 't-blue') {
        el.style.backgroundColor = noteColors[noteName] || '#fff'; // Assigned color
      }
    } else { // Released
      if (colorMode === 'deactivated') {
        el.style.backgroundColor = '#fff'; // Back to white
      } else if (colorMode === 't-green') {
        const color = noteColors[noteName] || '#fff';
        if (color !== '#fff') {
          el.style.background = `linear-gradient(to bottom, ${color} 50%, #fff 50%)`;
        } else {
          el.style.backgroundColor = '#fff';
        }
      } else if (colorMode === 't-blue') {
        el.style.backgroundColor = '#fff'; // Back to white
      }
    }
  } else {
    // === BLACK KEY LOGIC ===
    if (pressed) {
      if (colorMode === 'deactivated') {
        el.style.background = '#d3d3d3'; // Turn grey when played
      } else if (colorMode === 't-green' || colorMode === 't-blue') {
        el.style.background = blackNoteColors[noteName] || '#333'; // Assigned color
      }
    } else { // Released
      // In all modes, return to black.
      el.style.background = ''; // Reset to CSS gradient
    }
  }
}

const downKeys = new Map();

function getActiveOctaveCount() {
  const activeOption = document.querySelector('.toggle-option.active');
  return activeOption ? parseInt(activeOption.dataset.octaves, 10) : 1;
}

function getNoteMapping(key, layout, octaves, isShifted) {
  const keyInfo = keyData[key];
  if (!keyInfo) return null;

  const layoutKeyData = (layout === 't-green') ? keyInfo.green : keyInfo.blue;
  if (!layoutKeyData || !layoutKeyData.note) return null;

  const { note, octave } = layoutKeyData;

  // Check for Focus mode
  const focusMode = toggleStates.focus[currentToggleStates.focus];
  if (focusMode === 't-purple') {
    const currentKeyName = document.querySelector('.key-selector').value;
    const currentScaleName = document.querySelector('.scale-selector').value;
    const notesInCurrentScale = getNotesForScale(currentKeyName, currentScaleName);
    
    let noteToCheck = note;
    const flatEquivalent = sharpToFlatMap[noteToCheck];
    if (flatEquivalent) {
        noteToCheck = flatEquivalent;
    }

    if (!notesInCurrentScale.has(noteToCheck)) {
      return null; // Key is not in scale, disable binding
    }
  }

  let noteToPlay = `${note}${octave}`;
  let noteToLightUp = noteToPlay;

  function normalizeNoteForDisplay(noteStr) {
      const noteName = noteStr.slice(0, -1);
      const octaveNum = noteStr.slice(-1);
      const flatName = sharpToFlatMap[noteName];
      return flatName ? `${flatName}${octaveNum}` : noteStr;
  }

  if (layout === 't-green') {
    const baseOctave = baseNoteOctaves[note];
    const specialKey = getSpecialKeyInfo(key);

    if (baseOctave === undefined) {
      console.warn(`No base octave found for note ${note}`);
    } else {
      if (octaves === 1) {
        let lightUpOctave = baseOctave;
        if (specialKey) {
          lightUpOctave = baseOctave + 1;
        }
        noteToLightUp = `${note}${lightUpOctave}`;
      } else if (octaves === 2) {
        let lightUpOctave;
        if (specialKey) {
          lightUpOctave = baseOctave + ((specialKey.octaveIncrement - 1) % 2) + 1;
        } else {
          const row = getKeyRow(key);
          if (row === 'z' || row === 'q') {
            lightUpOctave = baseOctave;
          } else { // 'a' or '1' rows
            lightUpOctave = baseOctave + 1;
          }
        }
        noteToLightUp = `${note}${lightUpOctave}`;
      }
    }
  } else {
    // --- Chromatic Mode Note Lighting Logic ---
    if (octaves < 3 && isShifted) {
        noteToPlay = `${note}${octave + 2}`;
    }
    noteToLightUp = noteToPlay;
  }
  
  if (octaves === 1) {
    const noteName = noteToLightUp.slice(0, -1);
    const oct = parseInt(noteToLightUp.slice(-1), 10);
    noteToLightUp = `${noteName}${oct + 1}`;
  }
  
  return { noteToPlay, noteToLightUp: normalizeNoteForDisplay(noteToLightUp) };
}

function getKeyRow(key) {
    if ('zxcvbnm,./'.includes(key)) return 'z';
    if ('asdfghjkl;'.includes(key)) return 'a';
    if ('qwertyuiop'.includes(key)) return 'q';
    if ('1234567890'.includes(key)) return '1';
    return null;
}

const specialKeyGroups = {
    ',': { group: 'comma', octaveIncrement: 1 },
    '.': { group: 'comma', octaveIncrement: 1 },
    '/': { group: 'comma', octaveIncrement: 1 },
    'k': { group: 'k', octaveIncrement: 2 },
    'l': { group: 'k', octaveIncrement: 2 },
    ';': { group: 'k', octaveIncrement: 2 },
    'i': { group: 'i', octaveIncrement: 3 },
    'o': { group: 'i', octaveIncrement: 3 },
    'p': { group: 'i', octaveIncrement: 3 },
    '8': { group: '8', octaveIncrement: 4 },
    '9': { group: '8', octaveIncrement: 4 },
    '0': { group: '8', octaveIncrement: 4 },
};

function getSpecialKeyInfo(key) {
    return specialKeyGroups[key] || null;
}

const shiftKeyMap = {
    '@': '2', '#': '3', '%': '5', '^': '6', '&': '7', '(': '9', ')': '0',
    '<': ',', '>': '.', '?': '/', ':': ';'
};

document.addEventListener('keydown', (e) => {
  if (e.repeat || downKeys.has(e.code)) return;

  const layoutMode = currentToggleStates.layout;
  const octaves = getActiveOctaveCount();
  const isShifted = e.shiftKey || e.getModifierState("CapsLock");
  
  let key = e.key;
  if (e.shiftKey && shiftKeyMap[key]) {
      key = shiftKeyMap[key];
  }
  key = key.toLowerCase();

  const mapping = getNoteMapping(key, layoutMode, octaves, isShifted);
  if (!mapping) return;
  
  if (ctx.state !== 'running') ctx.resume();

  pressVisual(mapping.noteToLightUp, true);
  startNote(mapping.noteToPlay, 0.2);
  
  downKeys.set(e.code, mapping);
});

document.addEventListener('keyup', (e) => {
  const mapping = downKeys.get(e.code);
  if (!mapping) return;
  downKeys.delete(e.code);

  pressVisual(mapping.noteToLightUp, false);
  stopNote(mapping.noteToPlay);
});

let capsLock = false;
window.addEventListener('keydown', e => { if (e.key === 'CapsLock') capsLock = !capsLock; });

function onPointerDown(note) {
  if (ctx.state !== 'running') ctx.resume();
  pressVisual(note, true);
  startNote(note, 0.2);
  isDragging = true;
  lastDraggedNote = note;
}

function onPointerUp(note) {
  pressVisual(note, false);
  stopNote(note);
}

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;

    const elem = document.elementFromPoint(e.clientX, e.clientY);
    if (!elem) return;
    
    const isKey = elem.classList.contains('white-key') || elem.classList.contains('black-key');
    if (!isKey) return;

    const note = elem.dataset.note;
    if (note && note !== lastDraggedNote) {
        if (lastDraggedNote) {
            stopNote(lastDraggedNote);
            pressVisual(lastDraggedNote, false);
        }
        onPointerDown(note);
    }
});

document.addEventListener('mouseup', () => {
    if (isDragging) {
        if (lastDraggedNote) {
            stopNote(lastDraggedNote);
            pressVisual(lastDraggedNote, false);
            lastDraggedNote = null;
        }
        isDragging = false;
    }
});

document.addEventListener('touchmove', (e) => {
    if (!isDragging) return;
    try { e.preventDefault(); } catch (e) {}

    const touch = e.touches[0];
    const elem = document.elementFromPoint(touch.clientX, touch.clientY);
    if (!elem) return;
    
    const isKey = elem.classList.contains('white-key') || elem.classList.contains('black-key');
    if (!isKey) return;

    const note = elem.dataset.note;
    if (note && note !== lastDraggedNote) {
        if (lastDraggedNote) {
            stopNote(lastDraggedNote);
            pressVisual(lastDraggedNote, false);
        }
        onPointerDown(note);
    }
}, { passive: false });

document.addEventListener('touchend', () => {
    if (isDragging) {
        if (lastDraggedNote) {
            stopNote(lastDraggedNote);
            pressVisual(lastDraggedNote, false);
            lastDraggedNote = null;
        }
        isDragging = false;
    }
});

// -------- NEW CONTROLS --------
const octaveToggleOptions = document.querySelectorAll('.toggle-option');
const soundDisplay = document.getElementById('sound-name-display');
const prevSoundBtn = document.getElementById('prev-sound');
const nextSoundBtn = document.getElementById('next-sound');

const sounds = ['sine', 'triangle', 'square', 'sawtooth', 'organ'];
let currentSoundIndex = 1; // Default to triangle

function updateSoundByIndex(index) {
    // Update state
    currentSoundIndex = index;
    currentSound = sounds[currentSoundIndex];
    const displayName = currentSound.charAt(0).toUpperCase() + currentSound.slice(1);

    // Update visuals
    soundDisplay.textContent = displayName;
}

// Sound Dial Logic
prevSoundBtn.addEventListener('click', () => {
    currentSoundIndex = (currentSoundIndex - 1 + sounds.length) % sounds.length;
    updateSoundByIndex(currentSoundIndex);
});

nextSoundBtn.addEventListener('click', () => {
    currentSoundIndex = (currentSoundIndex + 1) % sounds.length;
    updateSoundByIndex(currentSoundIndex);
});

// Octave Toggle Logic
octaveToggleOptions.forEach(option => {
    option.addEventListener('click', () => {
        octaveToggleOptions.forEach(opt => opt.classList.remove('active'));
        option.classList.add('active');
        const numOctaves = parseInt(option.dataset.octaves, 10);
        drawKeyboard(numOctaves);
    });
});


// -------- TOGGLE GRID LOGIC --------
const toggleStates = {
  color: ['deactivated', 't-green', 't-blue'],
  names: ['deactivated', 't-orange', 't-yellow', 't-green', 't-blue'],
  bindings: ['deactivated', 't-blue'],
  focus: ['deactivated', 't-purple'],
};

const currentToggleStates = {
  color: 1,
  names: 0,
  bindings: 0,
  layout: 't-green', // This is for Flex/Chromatic
  focus: 0, // This is for the new Focus toggle
};

// -------- NEW LAYOUT CONTROLS --------
const flexBtn = document.querySelector('.flex-btn');
const chromaticBtn = document.querySelector('.chromatic-btn');
const keySelector = document.querySelector('.key-selector');
const scaleSelector = document.querySelector('.scale-selector');

keySelector.addEventListener('change', (e) => {
  const keyName = e.target.value;
  const scaleName = scaleSelector.value;
  updateFlexLayout(keyName, scaleName);
  updateBaseNoteOctaves(keyName, scaleName);
  const activeOctaveEl = document.querySelector('.toggle-option.active');
  const numOctaves = activeOctaveEl ? parseInt(activeOctaveEl.dataset.octaves, 10) : 1;
  drawKeyboard(numOctaves);
  e.target.blur();
});

scaleSelector.addEventListener('change', (e) => {
  const scaleName = e.target.value;
  const keyName = document.querySelector('.key-selector').value;
  updateFlexLayout(keyName, scaleName);
  updateBaseNoteOctaves(keyName, scaleName);
  const activeOctaveEl = document.querySelector('.toggle-option.active');
  const numOctaves = activeOctaveEl ? parseInt(activeOctaveEl.dataset.octaves, 10) : 1;
  drawKeyboard(numOctaves);
  e.target.blur();
});

flexBtn.addEventListener('click', () => {
  if (currentToggleStates.layout === 't-green') return;
  currentToggleStates.layout = 't-green';
  flexBtn.classList.add('active');
  chromaticBtn.classList.remove('active');
  const activeOctaveEl = document.querySelector('.toggle-option.active');
  const numOctaves = activeOctaveEl ? parseInt(activeOctaveEl.dataset.octaves, 10) : 1;
  drawKeyboard(numOctaves);
});

chromaticBtn.addEventListener('click', () => {
  if (currentToggleStates.layout === 't-blue') return;
  currentToggleStates.layout = 't-blue';
  chromaticBtn.classList.add('active');
  flexBtn.classList.remove('active');
  const activeOctaveEl = document.querySelector('.toggle-option.active');
  const numOctaves = activeOctaveEl ? parseInt(activeOctaveEl.dataset.octaves, 10) : 1;
  drawKeyboard(numOctaves);
});


function setupToggles() {
  for (const toggleName in toggleStates) {
    const button = document.getElementById(`toggle-${toggleName}`);
    if (button) {
      // Initialize button state visually
      const initialState = toggleStates[toggleName][currentToggleStates[toggleName]];
      if (initialState && initialState !== 'deactivated') {
        button.classList.add(initialState);
      }

      button.addEventListener('click', () => {
        const states = toggleStates[toggleName];
        let currentIndex = currentToggleStates[toggleName];
        
        currentIndex = (currentIndex + 1) % states.length;
        currentToggleStates[toggleName] = currentIndex;

        const newState = states[currentIndex];

        // Reset classes, keeping the base class
        button.className = 'toggle-btn'; 
        if (newState !== 'deactivated') {
          button.classList.add(newState);
        }

        // If the color, names, layout, or bindings toggle was changed, redraw the keyboard
        if (toggleName === 'color' || toggleName === 'names' || toggleName === 'layout' || toggleName === 'bindings' || toggleName === 'focus') {
          const activeOctaveEl = document.querySelector('.toggle-option.active');
          const numOctaves = activeOctaveEl ? parseInt(activeOctaveEl.dataset.octaves, 10) : 1;
          drawKeyboard(numOctaves);
        }
      });
    }
  }
}


// Initial draw
setupToggles();
drawKeyboard(1);
updateSoundByIndex(currentSoundIndex);

const collapseBtn = document.getElementById('collapse-btn');
const controlsContainer = document.querySelector('.controls-container');

collapseBtn.addEventListener('click', () => {
  controlsContainer.classList.toggle('hidden');
  if (controlsContainer.classList.contains('hidden')) {
    collapseBtn.textContent = '▲';
  } else {
    collapseBtn.textContent = '▼';
  }
});
