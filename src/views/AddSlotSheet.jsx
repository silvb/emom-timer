import { For, Show } from 'solid-js';
import { eligibleExercises, defaultSide } from '../structure.js';
import { describeSlot } from '../render.js';
import ExerciseLine from '../components/ExerciseLine.jsx';

// The picker only ever lists exercises this workout can legally hold:
// eligibleExercises drops archived ones and any ramp whose round count differs
// from the workout's, which check_slot_shape (0001) would reject anyway. An
// offered-then-rejected choice is worse than one never offered.
export default function AddSlotSheet(props) {
  const choices = () => eligibleExercises(props.exercises, props.workout);

  // No `position`: DetailView strips it from existing slots when the draft
  // opens, because save_workout_slots renumbers from array order. Setting it
  // here would put two shapes in the same draft list — the drift the stripping
  // exists to prevent.
  function pick(exercise) {
    props.onAdd({
      side: defaultSide(exercise),
      exercise,
    });
  }

  return (
    <div class="edit-sheet-backdrop" onClick={props.onClose}>
      <div class="edit-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 class="edit-sheet-title">Add exercise</h2>

        <Show
          when={choices().length > 0}
          fallback={
            <p class="edit-hint">
              No exercise fits a {props.workout.rounds}-round workout yet. Ramp-up exercises
              only fit a workout with the same round count.
            </p>
          }
        >
          <ul class="picker-list">
            <For each={choices()}>
              {(exercise) => (
                <li>
                  <button class="picker-item" onClick={() => pick(exercise)}>
                    <ExerciseLine
                      parts={describeSlot({ side: defaultSide(exercise), exercise }, null)}
                    />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <div class="edit-actions">
          <button class="edit-cancel-btn" onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
