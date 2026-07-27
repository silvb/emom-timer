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

  // Plain slots (Rest, Carry, Skip) have no prescription row and never open the
  // editor. Also guard against a slot whose exercise reference is gone —
  // validateWorkout() already anticipates that shape (model.js). The tappable
  // class is driven off the same predicate: a row that looks tappable and does
  // nothing reads as a broken app, mid-workout, on a phone.
  const isEditable = (slot) => Boolean(slot.exercise) && slot.exercise.type !== 'plain';

  function editSlot(slot) {
    if (!isEditable(slot)) return;
    setEditingSlot(slot);
  }

  function enterEditMode() {
    setEditError(null);
    // Drop `position`: it reflects the slot's place in the saved list, which
    // a reorder immediately invalidates. Nothing reads it today, but carrying
    // a stale value forward is how a future reader (e.g. the add-slot picker)
    // ends up trusting the wrong index.
    setDraft(props.workout.slots.map(({ position, ...s }) => ({ ...s })));
  }

  function cancelEdit() {
    setDraft(null);
    setAddingSlot(false);
    setEditError(null);
  }

  // Back is top-left, where a thumb lands by habit; Cancel sits at the bottom
  // of a scrolled list. While a draft is open, routing Back through Cancel
  // means an instinctive tap can't silently discard an unsaved restructure —
  // it just closes edit mode the same way Cancel does.
  function handleBack() {
    if (draft()) {
      cancelEdit();
      return;
    }
    props.onBack();
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

  // The save and the refetch that follows it fail for different reasons, and
  // the user needs to be told which one happened: a save failure means
  // nothing changed, so the draft stays open and "try again" is the right
  // instruction. A refetch failure means the write already landed — the
  // draft is stale work, not pending work, so it clears like the success
  // path, and the message must not suggest retrying the save itself.
  async function saveSlots() {
    setBusy(true);
    setEditError(null);

    try {
      await saveWorkoutSlots(
        props.workout.id,
        draft().map((s) => ({ exercise_slug: s.exercise.slug, side: s.side }))
      );
    } catch (e) {
      // save_workout_slots is atomic against a server-side rejection — no
      // partial write. It does not cover a connection dropped after commit,
      // so an error here can describe a write that actually landed. Retrying
      // is still safe either way: the payload is a whole-list replace, so
      // sending it again is idempotent.
      setEditError(`Nothing was changed. ${e.message || 'Try again.'}`);
      setBusy(false);
      return;
    }

    // The save has committed by this point. Await the refetch before
    // clearing the draft: onSaved (createResource's refetch) is async and
    // data() still holds the pre-save slots while it is in flight. Clearing
    // the draft first would show that stale order with busy() already false
    // — "Edit exercises" tappable again — so a second edit started in that
    // window would be built on top of a list missing the change that's still
    // landing, and saving it would silently revert edit #1.
    try {
      await props.onSaved();
    } catch (e) {
      // This is a refresh problem, not a write problem: the save already
      // succeeded, so the draft is cleared here too rather than left open
      // for a "retry" that would just resend an identical, already-applied
      // list.
      setEditError(`Saved, but the screen could not refresh. ${e.message || 'Try reloading.'}`);
      setDraft(null);
      setBusy(false);
      return;
    }

    setDraft(null);
    setBusy(false);
  }

  return (
    <div class="detail-view">
      <button class="back-btn" onClick={handleBack}>
        {draft() ? '← Cancel edit' : '← Back'}
      </button>

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
          <ul class="exercise-list">
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
                  <Show when={slot.exercise?.unilateral}>
                    <button class="slot-side-btn" onClick={() => cycleSide(i())}>
                      {slot.side === 'per_round' ? 'per round' : 'both sides'}
                    </button>
                  </Show>
                  <button
                    class="slot-remove-btn"
                    aria-label={`Remove ${slot.exercise?.name}`}
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
              {busy() ? 'Saving…' : 'Save changes'}
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
