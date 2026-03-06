import { createSignal, createEffect, onCleanup, Show } from 'solid-js';
import { deriveTimerState } from '../timer.js';
import { playWarningBeeps, playHalfwayBeep, resumeAudio } from '../audio.js';

export default function ActiveView({ workout, colorMap, onCancel, onComplete }) {
  const [elapsed, setElapsed] = createSignal(0);
  const [phase, setPhase] = createSignal('countdown'); // 'countdown' | 'running' | 'paused'
  const [pausedAt, setPausedAt] = createSignal(null);

  // Sound tracking — avoid re-triggering within the same second
  let lastWarningSec = -1;
  let lastHalfwaySec = -1;
  let lastCountdownBeep = false;

  let intervalId = null;

  function startInterval() {
    intervalId = setInterval(() => {
      setElapsed(e => e + 0.1);
    }, 100);
  }

  function stopInterval() {
    if (intervalId !== null) {
      clearInterval(intervalId);
      intervalId = null;
    }
  }

  // Start the countdown immediately
  startInterval();
  onCleanup(stopInterval);

  const state = () => deriveTimerState(elapsed(), workout, phase() === 'running' ? 'running' : 'countdown');

  // Transition from countdown to running
  createEffect(() => {
    const s = state();
    if (phase() === 'countdown' && s.countdownSeconds <= 0) {
      setPhase('running');
      setElapsed(0);
      lastWarningSec = -1;
      lastHalfwaySec = -1;
    }
  });

  // Sound effects
  createEffect(() => {
    const s = state();
    if (phase() === 'countdown') {
      const cd = Math.ceil(s.countdownSeconds);
      if (cd <= 3 && cd >= 1 && !lastCountdownBeep) {
        lastCountdownBeep = true;
        playWarningBeeps();
      }
      if (cd > 3) lastCountdownBeep = false;
      return;
    }
    if (phase() !== 'running') return;

    const secsLeft = Math.ceil(s.secondsLeftInRound);
    const secsMid = Math.floor((elapsed()) % 60);

    // 3-second warning before next round
    if (secsLeft === 3 && lastWarningSec !== Math.floor(elapsed() / 60)) {
      lastWarningSec = Math.floor(elapsed() / 60);
      playWarningBeeps();
    }

    // Halfway beep at 30 seconds into each round
    if (secsMid === 30 && lastHalfwaySec !== Math.floor(elapsed() / 60)) {
      lastHalfwaySec = Math.floor(elapsed() / 60);
      playHalfwayBeep();
    }
  });

  // Workout completion
  createEffect(() => {
    const s = state();
    if (phase() === 'running' && s.phase === 'done') {
      stopInterval();
      onComplete();
    }
  });

  function togglePause() {
    if (phase() === 'paused') {
      setPhase('running');
      startInterval();
    } else if (phase() === 'running') {
      setPhase('paused');
      stopInterval();
    }
  }

  const bgColor = () => {
    const s = state();
    if (phase() === 'countdown') return '#111';
    return colorMap[s.exerciseName] || '#111';
  };

  const formatTime = (secs) => {
    const s = Math.ceil(secs);
    const m = Math.floor(s / 60);
    const sec = s % 60;
    return `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  };

  return (
    <div
      class="active-view"
      style={{ 'background-color': bgColor(), transition: 'background-color 0.6s ease' }}
    >
      <Show when={phase() === 'countdown'}>
        <div class="countdown-screen">
          <div class="countdown-label">Get ready</div>
          <div class="countdown-number">{Math.ceil(state().countdownSeconds)}</div>
          <div class="countdown-first">
            First up: <strong>{workout.exercises[0]}</strong>
          </div>
        </div>
      </Show>

      <Show when={phase() === 'running' || phase() === 'paused'}>
        <div class="running-screen">
          <div class="running-top">
            <div class="round-indicator">
              Round {state().currentRound} / {state().totalRounds}
            </div>
          </div>

          <div class="running-center">
            <div class="exercise-display">{state().exerciseName}</div>
            <div class="time-display">{formatTime(state().secondsLeftInRound)}</div>
            <div class="total-remaining">
              {formatTime(state().remaining)} total remaining
            </div>
          </div>

          <Show when={phase() === 'paused'}>
            <div class="paused-overlay">PAUSED</div>
          </Show>

          <div class="running-controls">
            <button class="ctrl-btn cancel-btn" onClick={onCancel}>Cancel</button>
            <button class="ctrl-btn pause-btn" onClick={togglePause}>
              {phase() === 'paused' ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>
      </Show>
    </div>
  );
}
