// -------- AUDIO (pleasant tone, click-free) --------
const AudioCtx = window.AudioContext || window.webkitAudioContext;
const ctx = new AudioCtx();

// Single shared compressor (prevents pops, evens levels)
const compressor = ctx.createDynamicsCompressor();
compressor.threshold.value = -24;
compressor.knee.value = 30;
compressor.ratio.value = 12;
compressor.attack.value = 0.003;
compressor.release.value = 0.25;
compressor.connect(ctx.destination);

const active = new Map(); // note -> {osc, gain, filter}
let currentSound = "piano"; // Default sound

// Sound profiles
const soundProfiles = {
  piano: {
    oscillator: "triangle",
    attack: 0.012,
    decay: 0.06,
    sustain: 0.26,
    release: 0.18,
    filterType: "lowpass",
    filterFreq: 5200,
    filterQ: 0.8,
    setup: () => {}
  },
  synth: {
    oscillator: "sawtooth",
    attack: 0.03,
    decay: 0.1,
    sustain: 0.5,
    release: 0.4,
    filterType: "lowpass",
    filterFreq: 2500,
    filterQ: 5,
    setup: (osc, filter, gain, velocity) => {
      osc.detune.value = Math.random() * 10 - 5;
      const osc2 = ctx.createOscillator();
      osc2.type = "square";
      osc2.frequency.value = osc.frequency.value;
      osc2.detune.value = 7;
      const gain2 = ctx.createGain();
      gain2.gain.value = 0.15;
      osc2.connect(gain2).connect(filter);
      osc2.start();
      return { additionalOsc: osc2 };
    }
  },
  organ: {
    oscillator: "sine",
    attack: 0.005,
    decay: 0.01,
    sustain: 0.98,
    release: 0.08,
    filterType: "lowpass",
    filterFreq: 3000,
    filterQ: 0.1,
    setup: (osc, filter, gain, velocity) => {
      const harmonics = [1, 2, 3, 4];
      const additionalOscs = [];
      for (let i = 1; i < harmonics.length; i++) {
        const harmOsc = ctx.createOscillator();
        harmOsc.type = "sine";
        harmOsc.frequency.value = osc.frequency.value * harmonics[i];
        const harmGain = ctx.createGain();
        harmGain.gain.value = velocity * (0.75 / (i + 1));
        harmOsc.connect(harmGain).connect(filter);
        harmOsc.start();
        additionalOscs.push(harmOsc);
      }
      return { additionalOscs };
    }
  },
  cosmic: {
    oscillator: "sine",
    attack: 0.1,
    decay: 0.4,
    sustain: 0.4,
    release: 2.0,
    filterType: "bandpass",
    filterFreq: 1000,
    filterQ: 4,
    setup: (osc, filter, gain) => {
      const lfo = ctx.createOscillator();
      const lfoGain = ctx.createGain();
      lfo.frequency.value = 5 + Math.random() * 3;
      lfoGain.gain.value = 100;
      lfo.connect(lfoGain);
      lfoGain.connect(filter.frequency);
      lfo.start();
      const delay = ctx.createDelay();
      const delayFeedback = ctx.createGain();
      delay.delayTime.value = 0.4;
      delayFeedback.gain.value = 0.3;
      gain.connect(delay);
      delay.connect(delayFeedback);
      delayFeedback.connect(delay);
      delay.connect(compressor);
      return { lfo, delay };
    }
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

function startNote(note, velocity = 0.35, octaveOffset = 0) {
  const finalNote = note.slice(0,-1) + (parseInt(note.at(-1), 10) + octaveOffset);
  if (active.has(finalNote)) return;

  const profile = soundProfiles[currentSound];
  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const filter = ctx.createBiquadFilter();

  osc.type = profile.oscillator;
  osc.frequency.value = freqOf(note, octaveOffset);
  filter.type = profile.filterType;
  filter.frequency.value = profile.filterFreq;
  filter.Q.value = profile.filterQ;

  const now = ctx.currentTime;
  const A = profile.attack, D = profile.decay, S = profile.sustain;
  gain.gain.cancelScheduledValues(now);
  gain.gain.setValueAtTime(0.0, now);
  gain.gain.linearRampToValueAtTime(velocity, now + A);
  gain.gain.linearRampToValueAtTime(S * velocity, now + A + D);

  osc.connect(filter).connect(gain).connect(compressor);
  osc.start(now);

  const additionalNodes = profile.setup ? profile.setup(osc, filter, gain, velocity) : {};
  active.set(finalNote, { osc, gain, filter, ...additionalNodes });
}

function stopNote(note, octaveOffset = 0) {
  const finalNote = note.slice(0,-1) + (parseInt(note.at(-1), 10) + octaveOffset);
  const node = active.get(finalNote);
  if (!node) return;

  const { osc, gain } = node;
  const profile = soundProfiles[currentSound];
  const now = ctx.currentTime;
  const R = profile.release;

  gain.gain.cancelScheduledValues(now);
  gain.gain.setTargetAtTime(0.0001, now, R / 3);
  osc.stop(now + R + 0.02);

  if (node.additionalOsc) node.additionalOsc.stop(now + R + 0.02);
  if (node.additionalOscs) node.additionalOscs.forEach(o => o.stop(now + R + 0.02));
  if (node.lfo) node.lfo.stop(now + R + 0.02);

  active.delete(finalNote);
}

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
  if (el) el.classList.toggle('pressed', pressed);
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
  startNote(note, 0.35, octaveOffset);
});

document.addEventListener('keyup', (e) => {
  const downKeyInfo = downKeys.get(e.code);
  if (!downKeyInfo) return;
  downKeys.delete(e.code);
  const { note, shifted } = downKeyInfo;
  const octaveOffset = shifted ? 2 : 0;
  pressVisual(note, false, octaveOffset);
  stopNote(note, shifted ? 2 : 0);
});

let capsLock = false;
window.addEventListener('keydown', e => { if (e.key === 'CapsLock') capsLock = !capsLock; });

function onPointerDown(note) {
  if (ctx.state !== 'running') ctx.resume();
  const octaveOffset = capsLock ? 2 : 0;
  pressVisual(note, true, octaveOffset);
  startNote(note, 0.35, octaveOffset);
}
function onPointerUp(note) {
  const octaveOffset = capsLock ? 2 : 0;
  pressVisual(note, false, octaveOffset);
  stopNote(note, capsLock ? 2 : 0);
}

// -------- NEW CONTROLS --------
const knob = document.querySelector('.knob');
const soundLabels = document.querySelectorAll('.sound-labels span');
const octaveToggleOptions = document.querySelectorAll('.toggle-option');

// Sound Knob Logic
let isDragging = false;
let currentAngle = -120; // Initial angle (10 o'clock)
const soundStops = [-120, -156, 156, 120]; // Piano (8), Synth (34), Organ (26), Cosmic (4)
const sounds = ["piano", "synth", "organ", "cosmic"];

function updateSound(angle) {
    const closestStop = soundStops.reduce((prev, curr) => {
        return (Math.abs(curr - angle) < Math.abs(prev - angle) ? curr : prev);
    });
    const soundIndex = soundStops.indexOf(closestStop);
    
    knob.style.transform = `rotate(${closestStop}deg)`;
    currentSound = sounds[soundIndex];
    
    soundLabels.forEach((label, index) => {
        label.classList.toggle('active', index === soundIndex);
    });
}

knob.addEventListener('mousedown', (e) => {
    isDragging = true;
    knob.style.transition = 'none';
});

document.addEventListener('mousemove', (e) => {
    if (!isDragging) return;
    const rect = knob.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const angle = Math.atan2(e.clientY - centerY, e.clientX - centerX) * 180 / Math.PI + 90;
    
    currentAngle = angle;
    updateSound(currentAngle);
});

document.addEventListener('mouseup', () => {
    if (isDragging) {
        isDragging = false;
        knob.style.transition = '';
        updateSound(currentAngle); // Snap to closest sound
    }
});

// Sound Label Click Logic
soundLabels.forEach((label, index) => {
    label.addEventListener('click', () => {
        currentAngle = soundStops[index];
        knob.style.transition = 'transform 0.3s ease-out'; // Animate the snap
        updateSound(currentAngle);
        // Remove transition after animation so it doesn't affect dragging
        setTimeout(() => {
            knob.style.transition = '';
        }, 300);
    });
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
updateSound(currentAngle);
