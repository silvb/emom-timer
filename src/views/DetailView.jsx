import { createSignal, For, Show } from 'solid-js';
import { describeSlot } from '../render.js';
import { validateWorkout } from '../model.js';
import { moveItem, sideWarnings } from '../structure.js';
import { saveWorkoutSlots } from '../db.js';
import ExerciseLine from '../components/ExerciseLine.jsx';
import EditSlotSheet from './EditSlotSheet.jsx';
import AddSlotSheet from './AddSlotSheet.jsx';

export default function DetailView(props) {
  const problems = () => validateWorkout(props.workout);
  const [editingSlot, setEditingSlot] = createSignal(null);

  // Structural edit mode. `draft` is null when off; when on it holds the slot
  // list being rearranged. Nothing reaches the database until Save, so an
  // intermediate ordering — which would violate nothing, but would be a
  // pointless write — never leaves the device.
  const [draft, setDraft] = createSignal(null);
  const [addingSlot, setAddingSlot] = createSignal(false);
  const [editError, setEditError] = createSignal(null);
  const [busy, setBusy] = createSignal(false);

  const isEditable = (slot) => Boolean(slot.exercise) && slot.exercise.type !== 'plain';

  function editSlot(slot) {
    if (!isEditable(slot)) return;
    setEditingSlot(slot);
  }

  function enterEditMode() {
    setEditError(null);
    setDraft(props.workout.slots.map((s) => ({ ...s })));
  }

  function cancelEdit() {
    setDraft(null);
    setAddingSlot(false);
    setEditError(null);
  }

  function move(index, delta) {
    setDraft((current) => moveItem(current, index, delta));
  }

  function removeAt(index) {
    setDraft((current) => current.filter((_, i) => i !== index));
  }

  function addSlot(slot) {
    setDraft((current) => [...current, slot]);
    setAddingSlot(false);
  }

  function cycleSide(index) {
    setDraft((current) =>
      current.map((s, i) =>
        i === index ? { ...s, side: s.side === 'alternating' ? 'per_round' : 'alternating' } : s
      )
    );
  }

  // Warnings are computed against the draft, so the odd-round note appears as
  // soon as a per_round slot is added — before the save, when it can still be
  // reconsidered.
  const draftWarnings = () =>
    draft()
      ? sideWarnings({ rounds: props.workout.rounds, slots: draft() })
      : sideWarnings(props.workout);

  async function saveSlots() {
    setBusy(true);
    setEditError(null);
    try {
      await saveWorkoutSlots(
        props.workout.id,
        draft().map((s) => ({ exercise_slug: s.exercise.slug, side: s.side }))
      );
      props.onSaved();
      setDraft(null);
    } catch (e) {
      // save_workout_slots is atomic: a failure here means nothing changed,
      // so the draft is still exactly what the user intended and stays open
      // for retry.
      setEditError(e.message ?? 'Could not save. Nothing was changed — try again.');
    } finally {
      setBusy(false);
    }
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

        <Show
          when={draft()}
          fallback={
            <>
              <ul class="exercise-list">
                <For each={props.workout.slots}>
                  {(slot, i) => (
                    <li
                      class="exercise-item"
                      classList={{ 'exercise-item-tappable': isEditable(slot) }}
                      onClick={() => editSlot(slot)}
                    >
                      <span class="exercise-num">{String(i() + 1).padStart(2, '0')}</span>
                      <span class="exercise-name">
                        <ExerciseLine parts={describeSlot(slot, null)} />
                      </span>
                      <span class="exercise-duration">1 min</span>
                    </li>
                  )}
                </For>
              </ul>

              <For each={draftWarnings()}>
                {(w) => <p class="slot-warning">{w}</p>}
              </For>

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

              <div class="detail-edit-actions">
                <button
                  class="secondary-btn"
                  disabled={props.stale}
                  onClick={enterEditMode}
                >
                  Edit exercises
                </button>
                <button
                  class="secondary-btn"
                  disabled={props.stale}
                  onClick={() => props.onEditWorkout(props.workout)}
                >
                  Workout settings
                </button>
              </div>

              <Show when={props.stale}>
                <p class="schedule-stale-note">
                  Editing is unavailable while showing saved data.
                </p>
              </Show>
            </>
          }
        >
          <ul class="exercise-list exercise-list-editing">
            <For each={draft()}>
              {(slot, i) => (
                <li class="exercise-item exercise-item-editing">
                  <div class="slot-move">
                    <button
                      class="slot-move-btn"
                      aria-label="Move up"
                      disabled={i() === 0}
                      onClick={() => move(i(), -1)}
                    >
                      ↑
                    </button>
                    <button
                      class="slot-move-btn"
                      aria-label="Move down"
                      disabled={i() === draft().length - 1}
                      onClick={() => move(i(), 1)}
                    >
                      ↓
                    </button>
                  </div>
                  <span class="exercise-name">
                    <ExerciseLine parts={describeSlot(slot, null)} />
                  </span>
                  <Show when={slot.exercise.unilateral}>
                    <button class="slot-side-btn" onClick={() => cycleSide(i())}>
                      {slot.side === 'per_round' ? 'per round' : 'both sides'}
                    </button>
                  </Show>
                  <button
                    class="slot-remove-btn"
                    aria-label={`Remove ${slot.exercise.name}`}
                    onClick={() => removeAt(i())}
                  >
                    ✕
                  </button>
                </li>
              )}
            </For>
          </ul>

          <button class="secondary-btn" onClick={() => setAddingSlot(true)}>
            + Add exercise
          </button>

          <For each={draftWarnings()}>
            {(w) => <p class="slot-warning">{w}</p>}
          </For>

          <Show when={editError()}>
            <p class="edit-error" role="alert">{editError()}</p>
          </Show>

          <div class="edit-actions">
            <button class="edit-cancel-btn" onClick={cancelEdit} disabled={busy()}>
              Cancel
            </button>
            <button class="edit-save-btn" onClick={saveSlots} disabled={busy()}>
              {busy() ? 'Saving…' : 'Save order'}
            </button>
          </div>

          <Show when={addingSlot()}>
            <AddSlotSheet
              workout={props.workout}
              exercises={props.exercises}
              onAdd={addSlot}
              onClose={() => setAddingSlot(false)}
            />
          </Show>
        </Show>
      </div>

      {/* keyed: the sheet captures its form state at creation from the slot it
          was opened with. Without keying, a truthy-to-truthy slot swap would
          keep the mounted sheet and show the previous exercise's reps and
          weights under the new exercise's name. The backdrop makes that
          unreachable today; it would stop being unreachable the moment the
          list gains any other way to change slots. */}
      <Show when={editingSlot()} keyed>
        {(slot) => (
          <EditSlotSheet
            slot={slot}
            workouts={props.workouts}
            onClose={() => setEditingSlot(null)}
            onSaved={props.onSaved}
            onError={props.onError}
          />
        )}
      </Show>
    </div>
  );
}
