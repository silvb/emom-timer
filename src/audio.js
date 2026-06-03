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
  playTone(880, 0.12, 0.25, 'square', 0);
}

// Resume audio context (must be called from a user gesture)
export function resumeAudio() {
  getCtx().resume();
}
