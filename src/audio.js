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
  playTone(520, 0.18, 0.18, 'sine', 0);
  playTone(520, 0.18, 0.18, 'sine', 0.22);
}

// Resume audio context (must be called from a user gesture)
export function resumeAudio() {
  getCtx().resume();
}
