import { For, Show } from 'solid-js';
import { describeSlot } from '../render.js';
import { validateWorkout } from '../model.js';
import ExerciseLine from '../components/ExerciseLine.jsx';

export default function DetailView({ workout, onStart, onBack, onSaved, onError }) {
  const problems = () => validateWorkout(workout);

  // Task 10 wires up the actual editor; plain slots (Rest, Carry, Skip) never open it.
  function editSlot(slot) {
    if (slot.exercise.type === 'plain') return;
  }

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
            <span class="stat-value">{workout.slots.length}</span>
            <span class="stat-label">exercises</span>
          </div>
          <div class="stat-divider" />
          <div class="stat-block">
            <span class="stat-value">{workout.rounds}</span>
            <span class="stat-label">rounds</span>
          </div>
        </div>

        <ul class="exercise-list">
          <For each={workout.slots}>
            {(slot, i) => (
              <li
                class="exercise-item"
                classList={{ 'exercise-item-tappable': slot.exercise.type !== 'plain' }}
                onClick={() => editSlot(slot)}
              >
                <span class="exercise-num">{String(i() + 1).padStart(2, '0')}</span>
                <span class="exercise-name"><ExerciseLine parts={describeSlot(slot, null)} /></span>
                <span class="exercise-duration">1 min</span>
              </li>
            )}
          </For>
        </ul>

        <Show
          when={problems().length === 0}
          fallback={
            <div class="validation-panel" role="alert">
              <p class="validation-panel-title">This workout can't be started</p>
              <ul class="validation-panel-list">
                <For each={problems()}>{(p) => <li>{p}</li>}</For>
              </ul>
            </div>
          }
        >
          <button class="start-btn" onClick={onStart}>
            Start Workout
          </button>
        </Show>
      </div>
    </div>
  );
}
