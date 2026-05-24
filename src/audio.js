let ctx = null;

function getCtx() {
  if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
  return ctx;
}

function playTone(frequency, duration, gain = 0.3, type = 'sine', delay = 0) {
  const ac = getCtx();
  const osc = ac.createOscillator();
  const gainNode = ac.createGain();

  osc.connect(gainNode);
  gainNode.connect(ac.destination);

  osc.type = type;
  osc.frequency.setValueAtTime(frequency, ac.currentTime + delay);

  gainNode.gain.setValueAtTime(0, ac.currentTime + delay);
  gainNode.gain.linearRampToValueAtTime(gain, ac.currentTime + delay + 0.01);
  gainNode.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + delay + duration);

  osc.start(ac.currentTime + delay);
  osc.stop(ac.currentTime + delay + duration + 0.05);
}

// Three short beeps — played at 3s before transition
export function playWarningBeeps() {
  playTone(880, 0.12, 0.25, 'square', 0);
  playTone(880, 0.12, 0.25, 'square', 0.18);
  playTone(1100, 0.2, 0.35, 'square', 0.36);
}

// Soft mid-tone pulse — played at 30s (halfway)
export function playHalfwayBeep() {
  playTone(520, 0.18, 0.3, 'sine', 0);
  playTone(520, 0.18, 0.3, 'sine', 0.22);
}

// Gentle bell-like ping — played at 0s when a new exercise starts
export function playStartPing() {
  playTone(880, 0.6, 0.2, 'sine', 0);
  playTone(1760, 0.6, 0.07, 'sine', 0);
}

// Ascending 4-note arpeggio — played when the workout completes
export function playSuccessMelody() {
  playTone(523, 0.25, 0.22, 'sine', 0.00);     // C5
  playTone(659, 0.25, 0.22, 'sine', 0.13);     // E5
  playTone(784, 0.25, 0.22, 'sine', 0.26);     // G5
  playTone(1047, 0.55, 0.26, 'sine', 0.39);    // C6 (longer)
  playTone(2093, 0.55, 0.08, 'sine', 0.39);    // C7 sparkle overtone
}

// Distortion curve for WaveShaper — hard-clipping for a gritty sound
function makeDistortionCurve(amount = 80) {
  const samples = 256;
  const curve = new Float32Array(samples);
  const deg = Math.PI / 180;
  for (let i = 0; i < samples; i++) {
    const x = (i * 2) / samples - 1;
    curve[i] = ((3 + amount) * x * 20 * deg) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}

// Low, buzzy raspberry — played 10s before next exercise.
// Sawtooth at ~100 Hz with heavy distortion and a resonant lowpass for a
// solid, reedy "PRRRT" texture that cuts through music via harmonics.
export function playTenSecondWarning() {
  const ac = getCtx();
  const t0 = ac.currentTime;
  const duration = 0.32;

  const osc = ac.createOscillator();
  const shaper = ac.createWaveShaper();
  const filter = ac.createBiquadFilter();
  const gainNode = ac.createGain();

  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(150, t0);
  osc.frequency.linearRampToValueAtTime(135, t0 + 0.08);
  osc.frequency.linearRampToValueAtTime(145, t0 + 0.18);
  osc.frequency.linearRampToValueAtTime(118, t0 + duration);

  shaper.curve = makeDistortionCurve(260);
  shaper.oversample = '4x';

  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1900, t0);
  filter.Q.setValueAtTime(3, t0);

  // Noise layer for fricative rasp texture — mixed in before distortion so
  // the shaper crunches it together with the sawtooth.
  const noiseBuf = ac.createBuffer(1, Math.ceil(ac.sampleRate * (duration + 0.1)), ac.sampleRate);
  const noiseData = noiseBuf.getChannelData(0);
  for (let i = 0; i < noiseData.length; i++) noiseData[i] = Math.random() * 2 - 1;
  const noiseSrc = ac.createBufferSource();
  noiseSrc.buffer = noiseBuf;
  const noiseGain = ac.createGain();
  noiseGain.gain.setValueAtTime(0.28, t0);

  osc.connect(shaper);
  noiseSrc.connect(noiseGain);
  noiseGain.connect(shaper);
  shaper.connect(filter);
  filter.connect(gainNode);
  gainNode.connect(ac.destination);

  gainNode.gain.setValueAtTime(0, t0);
  gainNode.gain.linearRampToValueAtTime(0.38, t0 + 0.015);
  gainNode.gain.setValueAtTime(0.38, t0 + duration - 0.06);
  gainNode.gain.exponentialRampToValueAtTime(0.001, t0 + duration);

  osc.start(t0);
  osc.stop(t0 + duration + 0.05);
  noiseSrc.start(t0);
  noiseSrc.stop(t0 + duration + 0.05);
}

// Resume audio context (must be called from a user gesture)
export function resumeAudio() {
  getCtx().resume();
}
