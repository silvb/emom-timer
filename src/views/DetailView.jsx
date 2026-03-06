import { For } from 'solid-js';

export default function DetailView({ workout, onStart, onBack }) {
  const rounds = () => workout.minutes / workout.exercises.length;

  return (
    <div class="detail-view">
      <button class="back-btn" onClick={onBack}>← Back</button>

      <div class="detail-content">
        <h1 class="detail-title">{workout.title}</h1>

        <div class="detail-stats">
          <div class="stat-block">
            <span class="stat-value">{workout.minutes}</span>
            <span class="stat-label">minutes</span>
          </div>
          <div class="stat-divider" />
          <div class="stat-block">
            <span class="stat-value">{workout.exercises.length}</span>
            <span class="stat-label">exercises</span>
          </div>
          <div class="stat-divider" />
          <div class="stat-block">
            <span class="stat-value">{rounds()}</span>
            <span class="stat-label">rounds</span>
          </div>
        </div>

        <ul class="exercise-list">
          <For each={workout.exercises}>
            {(ex, i) => (
              <li class="exercise-item">
                <span class="exercise-num">{String(i() + 1).padStart(2, '0')}</span>
                <span class="exercise-name">{ex}</span>
                <span class="exercise-duration">1 min</span>
              </li>
            )}
          </For>
        </ul>

        <button class="start-btn" onClick={onStart}>
          Start Workout
        </button>
      </div>
    </div>
  );
}
