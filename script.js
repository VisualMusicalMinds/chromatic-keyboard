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
    oscillator: "custom", // This will signal to use the periodic wave
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

function freqOf(note, octaveOffset = 0) {
  const octave = parseInt(note.at(-1), 10) + octaveOffset;
  const pc = note.slice(0, -1);
  const idx = pitchIndex[pc];
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

function startNote(note, velocity = 0.2, octaveOffset = 0) {
  const finalNote = note.slice(0,-1) + (parseInt(note.at(-1), 10) + octaveOffset);
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

  filter.type = profile.filterType;
  filter.frequency.value = profile.filterFreq;
  filter.Q.value = profile.filterQ;

  if (profile.oscillator === 'custom') { // It's the organ
    if (!organWave) organWave = buildPeriodicVoiceWave(ctx);
    osc.setPeriodicWave(organWave);
    osc.frequency.value = freqOf(note, octaveOffset);

    lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    const now = ctx.currentTime;
    lfo.frequency.setValueAtTime(4, now);
    lfo.frequency.linearRampToValueAtTime(6, now + 1.5);
    lfoGain.gain.value = 2.5; // Vibrato depth in Hz
    lfo.connect(lfoGain).connect(osc.frequency);
    lfo.start(now);
  } else {
    osc.type = profile.oscillator;
    osc.frequency.value = freqOf(note, octaveOffset);
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

const keyNoteMap = {
  'z':'C3', 'x':'D3', 'c':'E3', 'v':'F3', 'b':'G3', 'n':'A3', 'm':'B3',
  ',':'C4', '.':'D4', '/':'E4',
  'q':'C4', 'w':'D4', 'e':'E4', 'r':'F4', 't':'G4', 'y':'A4', 'u':'B4',
  'i':'C5', 'o':'D5', 'p':'E5',
  's':'Db3', 'd':'Eb3', 'g':'Gb3', 'h':'Ab3', 'j':'Bb3',
  'l':'Db4', ';':'Eb4',
  '2':'Db4', '3':'Eb4', '5':'Gb4', '6':'Ab4', '7':'Bb4',
  '9':'Db5', '0':'Eb5',
};

function drawKeyboard(numOctaves = 1) {
  whitesEl.innerHTML = '';
  blacksEl.innerHTML = '';
  whiteKeysPhysical = [];
  blackKeysPhysical = [];

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
      if (noteLightColors[noteName]) {
        div.style.backgroundColor = noteLightColors[noteName];
      }
      const label = document.createElement('div');
      label.className = 'key-label';
      label.textContent = noteName;
      div.appendChild(label);
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
      const label = document.createElement('div');
      label.className = 'key-label';
      label.innerHTML = blackKeyDisplayMap[pc] || '';
      div.appendChild(label);
      blacksEl.appendChild(div);
      div.addEventListener('mousedown', () => onPointerDown(note));
      div.addEventListener('mouseup', () => onPointerUp(note));
      div.addEventListener('mouseleave', () => onPointerUp(note));
      div.addEventListener('touchstart', (ev) => { ev.preventDefault(); onPointerDown(note); }, {passive:false});
      div.addEventListener('touchend', () => onPointerUp(note));
  });
}

// -------- INTERACTION --------
function pressVisual(note, pressed, octaveOffset = 0) {
  const finalNote = note.slice(0,-1) + (parseInt(note.at(-1), 10) + octaveOffset);
  const el = document.querySelector(`[data-note="${finalNote}"]`);
  if (!el) return;

  el.classList.toggle('pressed', pressed);

  const noteName = finalNote.slice(0, -1);

  // Handle white keys
  if (el.classList.contains('white-key')) {
    if (noteColors[noteName] && noteLightColors[noteName]) {
      el.style.backgroundColor = pressed ? noteColors[noteName] : noteLightColors[noteName];
    }
  }
  // Handle black keys
  else if (el.classList.contains('black-key')) {
    if (pressed) {
      if (blackNoteColors[noteName]) {
        el.style.background = blackNoteColors[noteName];
      }
    } else {
      // Reset to original gradient by clearing the inline style
      el.style.background = '';
    }
  }
}

const downKeys = new Map();
function keyToNote(key) { return keyNoteMap[key] || null; }

document.addEventListener('keydown', (e) => {
  if (e.repeat || downKeys.has(e.code)) return;
  const isShifted = e.shiftKey || e.getModifierState("CapsLock");
  let key = e.key.toLowerCase();
  const note = keyToNote(key);
  if (!note) return;
  if (ctx.state !== 'running') ctx.resume();
  const octaveOffset = isShifted ? 2 : 0;
  downKeys.set(e.code, { note, shifted: isShifted });
  pressVisual(note, true, octaveOffset);
  startNote(note, 0.2, octaveOffset);
});

document.addEventListener('keyup', (e) => {
  const downKeyInfo = downKeys.get(e.code);
  if (!downKeyInfo) return;
  downKeys.delete(e.code);
  const { note, shifted } = downKeyInfo;
  const octaveOffset = shifted ? 2 : 0;
  pressVisual(note, false, octaveOffset);
  const finalNote = note.slice(0,-1) + (parseInt(note.at(-1), 10) + octaveOffset);
  stopNote(finalNote);
});

let capsLock = false;
window.addEventListener('keydown', e => { if (e.key === 'CapsLock') capsLock = !capsLock; });

function onPointerDown(note) {
  if (ctx.state !== 'running') ctx.resume();
  const octaveOffset = capsLock ? 2 : 0;
  pressVisual(note, true, octaveOffset);
  startNote(note, 0.2, octaveOffset);
}
function onPointerUp(note) {
  const octaveOffset = capsLock ? 2 : 0;
  pressVisual(note, false, octaveOffset);
  const finalNote = note.slice(0,-1) + (parseInt(note.at(-1), 10) + octaveOffset);
  stopNote(finalNote);
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

    // Update visuals
    soundDisplay.textContent = currentSound;
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


// Initial draw
drawKeyboard(1);
updateSoundByIndex(currentSoundIndex);
