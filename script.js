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
const whitesEl = document.getElementById('whites');
const blacksEl = document.getElementById('blacks');
let whiteKeysPhysical = [];
let blackKeysPhysical = [];

// This new structure replaces the old keyNoteMap objects.
// It stores the note name and a base octave for each key, separated by layout.
// This provides the necessary data for the dynamic note calculation logic.
const keyData = {
  // Row 1 (Numbers)
  '1': { green: { note: 'C', octave: 6 }, blue: null },
  '2': { green: { note: 'D', octave: 6 }, blue: { note: 'Db', octave: 4 } },
  '3': { green: { note: 'E', octave: 6 }, blue: { note: 'Eb', octave: 4 } },
  '4': { green: { note: 'F', octave: 6 }, blue: null },
  '5': { green: { note: 'G', octave: 6 }, blue: { note: 'Gb', octave: 4 } },
  '6': { green: { note: 'A', octave: 6 }, blue: { note: 'Ab', octave: 4 } },
  '7': { green: { note: 'B', octave: 6 }, blue: { note: 'Bb', octave: 4 } },
  '8': { green: { note: 'C', octave: 7 }, blue: null },
  '9': { green: { note: 'D', octave: 7 }, blue: { note: 'Db', octave: 5 } },
  '0': { green: { note: 'E', octave: 7 }, blue: { note: 'Eb', octave: 5 } },

  // Row 2 (QWERTY)
  'q': { green: { note: 'C', octave: 5 }, blue: { note: 'C', octave: 4 } },
  'w': { green: { note: 'D', octave: 5 }, blue: { note: 'D', octave: 4 } },
  'e': { green: { note: 'E', octave: 5 }, blue: { note: 'E', octave: 4 } },
  'r': { green: { note: 'F', octave: 5 }, blue: { note: 'F', octave: 4 } },
  't': { green: { note: 'G', octave: 5 }, blue: { note: 'G', octave: 4 } },
  'y': { green: { note: 'A', octave: 5 }, blue: { note: 'A', octave: 4 } },
  'u': { green: { note: 'B', octave: 5 }, blue: { note: 'B', octave: 4 } },
  'i': { green: { note: 'C', octave: 6 }, blue: { note: 'C', octave: 5 } },
  'o': { green: { note: 'D', octave: 6 }, blue: { note: 'D', octave: 5 } },
  'p': { green: { note: 'E', octave: 6 }, blue: { note: 'E', octave: 5 } },

  // Row 3 (ASDF)
  'a': { green: { note: 'C', octave: 4 }, blue: null },
  's': { green: { note: 'D', octave: 4 }, blue: { note: 'Db', octave: 3 } },
  'd': { green: { note: 'E', octave: 4 }, blue: { note: 'Eb', octave: 3 } },
  'f': { green: { note: 'F', octave: 4 }, blue: null },
  'g': { green: { note: 'G', octave: 4 }, blue: { note: 'Gb', octave: 3 } },
  'h': { green: { note: 'A', octave: 4 }, blue: { note: 'Ab', octave: 3 } },
  'j': { green: { note: 'B', octave: 4 }, blue: { note: 'Bb', octave: 3 } },
  'k': { green: { note: 'C', octave: 5 }, blue: null },
  'l': { green: { note: 'D', octave: 5 }, blue: { note: 'Db', octave: 4 } },
  ';': { green: { note: 'E', octave: 5 }, blue: { note: 'Eb', octave: 4 } },

  // Row 4 (ZXCV)
  'z': { green: { note: 'C', octave: 3 }, blue: { note: 'C', octave: 3 } },
  'x': { green: { note: 'D', octave: 3 }, blue: { note: 'D', octave: 3 } },
  'c': { green: { note: 'E', octave: 3 }, blue: { note: 'E', octave: 3 } },
  'v': { green: { note: 'F', octave: 3 }, blue: { note: 'F', octave: 3 } },
  'b': { green: { note: 'G', octave: 3 }, blue: { note: 'G', octave: 3 } },
  'n': { green: { note: 'A', octave: 3 }, blue: { note: 'A', octave: 3 } },
  'm': { green: { note: 'B', octave: 3 }, blue: { note: 'B', octave: 3 } },
  ',': { green: { note: 'C', octave: 4 }, blue: { note: 'C', octave: 4 } },
  '.': { green: { note: 'D', octave: 4 }, blue: { note: 'D', octave: 4 } },
  '/': { green: { note: 'E', octave: 4 }, blue: { note: 'E', octave: 4 } },
};

const keyBindings = {
  't-green': {
    1: {
      'C3': 'zaq1', 'D3': 'xsw2', 'E3': 'cde3', 'F3': 'vfr4', 'G3': 'bgt5', 'A3': 'nhy6', 'B3': 'mju7',
      'C4': ',ki8', 'D4': '.lo9', 'E4': '/;p0'
    },
    2: {
      'C3': 'zq', 'D3': 'xw', 'E3': 'ce', 'F3': 'vr', 'G3': 'bt', 'A3': 'ny', 'B3': 'mu',
      'C4': ',ai1', 'D4': '.so2', 'E4': '/dp3',
      'F4': 'f4', 'G4': 'g5', 'A4': 'h6', 'B4': 'j7',
      'C5': 'k8', 'D5': 'l9', 'E5': ';0'
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
        'F4': 'r', 'Gb4': 'g5', 'G4': 't', 'Ab4': 'h6', 'A4': 'y', 'Bb4': 'j7', 'B4': 'u',
        'C5': 'i', 'Db5': '9', 'D5': 'o', 'Eb5': '0', 'E5': 'p'
    },
    3: {}, 4: {}
  }
};

function populateDynamicBindings() {
  // For modes 3 and 4, bindings are 1-to-1 with the lighting-up note.
  for (let octaves = 3; octaves <= 4; octaves++) {
    for (const layout of ['t-green', 't-blue']) {
      const bindings = {};
      for (const key in keyData) {
        const keyInfo = (layout === 't-green') ? keyData[key].green : keyData[key].blue;
        if (keyInfo) {
          const note = `${keyInfo.note}${keyInfo.octave}`;
          if (!bindings[note]) bindings[note] = '';
          bindings[note] += key;
        }
      }
      keyBindings[layout][octaves] = bindings;
    }
  }

  // Special handling for blue layout shifted keys (adds 2 to octave)
  for (let octaves = 1; octaves <= 4; octaves++) {
    const bindings = keyBindings['t-blue'][octaves];
    const shiftedBindings = {};
    for (const key in keyData) {
      const keyInfo = keyData[key].blue;
      if (keyInfo) {
        // Shifted notes for blue are octave + 2
        const shiftedNote = `${keyInfo.note}${keyInfo.octave + 2}`;
        const displayKey = key.toUpperCase();
        if (!bindings[shiftedNote] && !shiftedBindings[shiftedNote]) {
           shiftedBindings[shiftedNote] = '';
        }
        if(shiftedBindings[shiftedNote] !== undefined){
            shiftedBindings[shiftedNote] += displayKey;
        }
      }
    }
    // Merge shifted bindings into the main blue bindings
    for(const note in shiftedBindings){
        if(bindings[note]){
            bindings[note] += shiftedBindings[note];
        } else {
            bindings[note] = shiftedBindings[note];
        }
    }
  }
}

populateDynamicBindings();

function drawKeyboard(numOctaves = 1) {
  whitesEl.innerHTML = '';
  blacksEl.innerHTML = '';
  whiteKeysPhysical = [];
  blackKeysPhysical = [];
  
  const colorMode = toggleStates.color[currentToggleStates.color];
  const namesMode = toggleStates.names[currentToggleStates.names];
  const bindingsMode = toggleStates.bindings[currentToggleStates.bindings];
  const layoutMode = toggleStates.layout[currentToggleStates.layout];

  const startOctave = 3;
    const noteOrder = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
    const fullKeyboard = [];

    for (let o = 0; o < numOctaves + 1; o++) {
        for(const noteName of noteOrder) {
            fullKeyboard.push(noteName + (startOctave + o));
        }
    }

    const endNote = 'E' + (startOctave + numOctaves);
    const endIndex = fullKeyboard.indexOf(endNote);
    const finalKeyboard = fullKeyboard.slice(0, endIndex + 1);
    
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

      // Apply color based on mode
      if (colorMode === 't-green') {
        div.style.backgroundColor = noteLightColors[noteName] || '#fff';
      } else {
        div.style.backgroundColor = '#fff';
      }
      
      if (namesMode === 't-yellow' || namesMode === 't-green') {
        const label = document.createElement('div');
        label.className = 'key-label';
        label.textContent = noteName;
        
        // Set text color based on the Color toggle state
        if (colorMode === 't-green') {
          label.style.color = 'white';
        } else { // 'deactivated' or 't-blue'
          label.style.color = 'black';
        }

        div.appendChild(label);
      }

      if (bindingsMode !== 'deactivated') {
        const binding = keyBindings[layoutMode]?.[numOctaves]?.[note];
        if (binding) {
          const bindingLabel = document.createElement('div');
          bindingLabel.className = 'binding-label';
          bindingLabel.textContent = binding;
          div.appendChild(bindingLabel);
        }
      }

      whitesEl.appendChild(div);
      div.addEventListener('mousedown', () => onPointerDown(note));
      div.addEventListener('mouseup', () => onPointerUp(note));
      div.addEventListener('mouseleave', () => onPointerUp(note));
      div.addEventListener('touchstart', (ev) => { ev.preventDefault(); onPointerDown(note); }, {passive:false});
      div.addEventListener('touchend', () => onPointerUp(note));
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

      // Black keys are always black, styled by CSS.

      if (namesMode === 't-blue' || namesMode === 't-green') {
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
          bindingLabel.textContent = binding;
          div.appendChild(bindingLabel);
        }
      }

      blacksEl.appendChild(div);
      div.addEventListener('mousedown', () => onPointerDown(note));
      div.addEventListener('mouseup', () => onPointerUp(note));
      div.addEventListener('mouseleave', () => onPointerUp(note));
      div.addEventListener('touchstart', (ev) => { ev.preventDefault(); onPointerDown(note); }, {passive:false});
      div.addEventListener('touchend', () => onPointerUp(note));
  });
}

// -------- INTERACTION --------
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
        el.style.backgroundColor = noteColors[noteName] || '#fff'; // Brighter version
      } else if (colorMode === 't-blue') {
        el.style.backgroundColor = noteColors[noteName] || '#fff'; // Assigned color
      }
    } else { // Released
      if (colorMode === 'deactivated') {
        el.style.backgroundColor = '#fff'; // Back to white
      } else if (colorMode === 't-green') {
        el.style.backgroundColor = noteLightColors[noteName] || '#fff'; // Back to light color
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
  if (!layoutKeyData) return null;

  const { note, octave } = layoutKeyData;
  let noteToPlay = `${note}${octave}`;
  let noteToLightUp = noteToPlay;

  // --- Logic for 3 or 4 octaves (default behavior) ---
  if (octaves >= 3) {
    if (layout === 't-blue' && isShifted) {
      noteToPlay = `${note}${octave + 2}`;
    }
    // For this mode, the key you light up is the one you play,
    // unless shifted in blue mode.
    return { noteToPlay, noteToLightUp };
  }

  // --- Logic for 1 octave ---
  if (octaves === 1) {
    const startOctave = 3; // The first visible octave
    
    if (layout === 't-green') {
        const keyRow = getKeyRow(key);
        if (!keyRow) return null;

        noteToPlay = `${note}${octave}`; // Use the correct octave from keyData
        noteToLightUp = `${note}${startOctave}`;

        // Override for special keys
        const specialKey = getSpecialKeyInfo(key);
        if (specialKey) {
            noteToLightUp = `${specialKey.note}4`;
        }

    } else { // Blue layout
        noteToPlay = `${note}${octave}`;
        noteToLightUp = `${note}${startOctave}`;
        if (isShifted) {
            noteToPlay = `${note}${octave + 2}`;
        }
    }
    return { noteToPlay, noteToLightUp };
  }

  // --- Logic for 2 octaves ---
  if (octaves === 2) {
    if (layout === 't-green') {
        const keyRow = getKeyRow(key);
        if (!keyRow) return null;

        noteToPlay = `${note}${octave}`;
        
        let lightOctave = 3;
        if (keyRow === 'a' || keyRow === '1') {
            lightOctave = 4;
        }
        noteToLightUp = `${note}${lightOctave}`;

        // Override for special keys
        const specialKey = getSpecialKeyInfo(key);
        if (specialKey) {
            if (specialKey.group === 'comma' || specialKey.group === 'i') {
                noteToLightUp = `${specialKey.note}4`;
            } else { // k or 8 group
                noteToLightUp = `${specialKey.note}5`;
            }
        }

    } else { // Blue layout
        noteToPlay = `${note}${octave}`;
        noteToLightUp = noteToPlay;
        if (isShifted) {
            noteToPlay = `${note}${octave + 2}`;
        }
    }
    return { noteToPlay, noteToLightUp };
  }

  return null; // Should not be reached
}

function getKeyRow(key) {
    if ('zxcvbnm,./'.includes(key)) return 'z';
    if ('asdfghjkl;'.includes(key)) return 'a';
    if ('qwertyuiop'.includes(key)) return 'q';
    if ('1234567890'.includes(key)) return '1';
    return null;
}

const specialKeyGroups = {
    ',': { group: 'comma', note: 'C'},
    '.': { group: 'comma', note: 'D'},
    '/': { group: 'comma', note: 'E'},
    'k': { group: 'k', note: 'C'},
    'l': { group: 'k', note: 'D'},
    ';': { group: 'k', note: 'E'},
    'i': { group: 'i', note: 'C'},
    'o': { group: 'i', note: 'D'},
    'p': { group: 'i', note: 'E'},
    '8': { group: '8', note: 'C'},
    '9': { group: '8', note: 'D'},
    '0': { group: '8', note: 'E'},
};

function getSpecialKeyInfo(key) {
    return specialKeyGroups[key] || null;
}

document.addEventListener('keydown', (e) => {
  if (e.repeat || downKeys.has(e.code)) return;

  const layoutMode = toggleStates.layout[currentToggleStates.layout];
  const octaves = getActiveOctaveCount();
  const isShifted = e.shiftKey || e.getModifierState("CapsLock");
  const key = e.key.toLowerCase();

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
  // Per user instruction, mouse clicks ignore modifiers and play the note as-is.
  pressVisual(note, true);
  startNote(note, 0.2);
}
function onPointerUp(note) {
  // Per user instruction, mouse clicks ignore modifiers.
  pressVisual(note, false);
  stopNote(note);
}

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
  names: ['deactivated', 't-yellow', 't-green', 't-blue'],
  bindings: ['deactivated', 't-blue'],
  layout: ['t-green', 't-blue']
};

const currentToggleStates = {
  color: 0,
  names: 0,
  bindings: 0,
  layout: 0
};

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
        if (toggleName === 'color' || toggleName === 'names' || toggleName === 'layout' || toggleName === 'bindings') {
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
