import { createSignal, For, Show } from 'solid-js';
import { describeSlot } from '../render.js';
import { validateWorkout } from '../model.js';
import ExerciseLine from '../components/ExerciseLine.jsx';
import EditSlotSheet from './EditSlotSheet.jsx';

export default function DetailView(props) {
  const problems = () => validateWorkout(props.workout);
  const [editingSlot, setEditingSlot] = createSignal(null);

  // Plain slots (Rest, Carry, Skip) have no prescription row and never open the
  // editor. Also guard against a slot whose exercise reference is gone —
  // validateWorkout() already anticipates that shape (model.js).
  function editSlot(slot) {
    if (!slot.exercise) return;
    if (slot.exercise.type === 'plain') return;
    setEditingSlot(slot);
  }

  return (
    <div class="detail-view">
      <button class="back-btn" onClick={props.onBack}>← Back</button>

      <div class="detail-content">
        <h1 class="detail-title">{props.workout.title}</h1>

        <div class="detail-stats">
          <div class="stat-block">
            <span class="stat-value">{props.workout.minutes}</span>
            <span class="stat-label">minutes</span>
          </div>
          <div class="stat-divider" />
          <div class="stat-block">
            <span class="stat-value">{props.workout.slots.length}</span>
            <span class="stat-label">exercises</span>
          </div>
          <div class="stat-divider" />
          <div class="stat-block">
            <span class="stat-value">{props.workout.rounds}</span>
            <span class="stat-label">rounds</span>
          </div>
        </div>

        <ul class="exercise-list">
          <For each={props.workout.slots}>
            {(slot, i) => (
              <li
                class="exercise-item"
                classList={{ 'exercise-item-tappable': slot.exercise?.type !== 'plain' }}
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
          <button class="start-btn" onClick={props.onStart}>
            Start Workout
          </button>
        </Show>
      </div>

      <Show when={editingSlot()}>
        <EditSlotSheet
          slot={editingSlot()}
          workouts={props.workouts}
          onClose={() => setEditingSlot(null)}
          onSaved={props.onSaved}
          onError={props.onError}
        />
      </Show>
    </div>
  );
}
