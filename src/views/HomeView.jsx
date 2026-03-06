import { For } from 'solid-js';

export default function HomeView({ workouts, onSelect }) {
  return (
    <div class="home-view">
      <header class="home-header">
        <div class="logo-mark">EMOM</div>
        <p class="home-sub">Select a workout to begin</p>
      </header>
      <ul class="workout-list">
        <For each={workouts}>
          {(w) => (
            <li class="workout-card" onClick={() => onSelect(w)}>
              <div class="workout-card-inner">
                <span class="workout-title">{w.title}</span>
                <div class="workout-meta">
                  <span class="meta-pill">{w.minutes} min</span>
                  <span class="meta-pill">{w.exercises.length} exercises</span>
                </div>
              </div>
              <span class="card-arrow">→</span>
            </li>
          )}
        </For>
      </ul>
    </div>
  );
}
