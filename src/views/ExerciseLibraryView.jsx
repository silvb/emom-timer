import { createSignal, createMemo, For, Show } from 'solid-js';
import { usedByWorkouts, deleteBlockedReason } from '../structure.js';
import { setExerciseArchived, deleteExercise } from '../db.js';
import ExerciseFormSheet from './ExerciseFormSheet.jsx';

const TYPE_LABELS = {
  ramp_up: 'Ramp',
  rep_range: 'Rep range',
  fixed: 'Fixed',
  plain: 'No numbers',
};

export default function ExerciseLibraryView(props) {
  const [showArchived, setShowArchived] = createSignal(false);
  const [form, setForm] = createSignal(null); // null | { exercise, mode }
  const [busySlug, setBusySlug] = createSignal(null);
  const [confirmingSlug, setConfirmingSlug] = createSignal(null);

  const all = createMemo(() =>
    Object.values(props.programme.exercises).sort((a, b) => a.name.localeCompare(b.name))
  );

  const visible = () => (showArchived() ? all() : all().filter((e) => !e.archived));

  async function toggleArchived(exercise) {
    // Archiving an exercise a workout still uses would leave that workout
    // holding something the picker claims does not exist. Refuse with the
    // blockers named, matching how deletion behaves.
    const blockers = usedByWorkouts(exercise.slug, props.workouts);
    if (!exercise.archived && blockers.length > 0) {
      props.onError(`${exercise.name} is still used by ${blockers.join(', ')}.`);
      return;
    }

    setBusySlug(exercise.slug);
    const verb = exercise.archived ? 'Restored' : 'Archived';
    try {
      await setExerciseArchived(exercise.slug, !exercise.archived);
    } catch (e) {
      props.onError(e.message || 'Could not save. Try again.');
      setBusySlug(null);
      return;
    }

    // Split from the write above so the message can't claim a failure that did
    // not happen: the row is already changed by this point, and telling the
    // user to "try again" would have them re-archive something that is
    // archived. Same distinction DetailView draws around saveWorkoutSlots.
    try {
      await props.onSaved();
    } catch (e) {
      props.onError(`${verb}, but the screen could not refresh. ${e.message || 'Try reloading.'}`);
    } finally {
      setBusySlug(null);
    }
  }

  // Deletion is offered for every exercise rather than hidden where it cannot
  // work, because the spec requires a refused deletion to name what is blocking
  // it — and a button that is simply absent explains nothing. This mirrors
  // Archive, which is likewise always offered and refuses with its blockers
  // named.
  function askToRemove(exercise) {
    const blocked = deleteBlockedReason(exercise, props.workouts);
    if (blocked) {
      props.onError(blocked);
      return;
    }
    setConfirmingSlug(exercise.slug);
  }

  // There is one user, no undo, and this button sits a few millimetres from
  // Archive in a wrapping row on a phone. Confirming matches how deleting a
  // workout already behaves in WorkoutFormSheet.
  async function remove(exercise) {
    const blocked = deleteBlockedReason(exercise, props.workouts);
    if (blocked) {
      props.onError(blocked);
      setConfirmingSlug(null);
      return;
    }

    setBusySlug(exercise.slug);
    try {
      await deleteExercise(exercise.slug);
    } catch (e) {
      props.onError(e.message || 'Could not delete. Try again.');
      setBusySlug(null);
      return;
    }

    setConfirmingSlug(null);
    try {
      await props.onSaved();
    } catch (e) {
      props.onError(`Deleted, but the screen could not refresh. ${e.message || 'Try reloading.'}`);
    } finally {
      setBusySlug(null);
    }
  }

  return (
    <div class="library-view">
      <button class="back-btn" onClick={props.onBack}>← Back</button>

      <div class="detail-content">
        <h1 class="detail-title">Exercises</h1>

        <div class="library-controls">
          <button
            class="secondary-btn"
            disabled={props.stale}
            onClick={() => setForm({ exercise: null, mode: 'create' })}
          >
            + New exercise
          </button>
          <label class="library-toggle">
            <input
              type="checkbox"
              checked={showArchived()}
              onInput={(e) => setShowArchived(e.currentTarget.checked)}
            />
            Show archived
          </label>
        </div>

        <Show when={props.stale}>
          <p class="schedule-stale-note">Editing is unavailable while showing saved data.</p>
        </Show>

        <ul class="library-list">
          <For each={visible()}>
            {(exercise) => (
              <li class="library-item" classList={{ 'library-item-archived': exercise.archived }}>
                <div class="library-item-main">
                  <span class="library-item-name">{exercise.name}</span>
                  <span class="library-item-meta">
                    {TYPE_LABELS[exercise.type]}
                    <Show when={exercise.type === 'ramp_up'}> · {exercise.rounds} rounds</Show>
                    <Show when={exercise.unilateral}> · one side at a time</Show>
                  </span>
                  <Show when={usedByWorkouts(exercise.slug, props.workouts).length > 0}>
                    <span class="library-item-used">
                      {usedByWorkouts(exercise.slug, props.workouts).join(', ')}
                    </span>
                  </Show>
                </div>

                <Show
                  when={confirmingSlug() === exercise.slug}
                  fallback={
                    <div class="library-item-actions">
                      <button
                        class="secondary-btn"
                        disabled={props.stale || busySlug() === exercise.slug}
                        onClick={() => setForm({ exercise, mode: 'edit' })}
                      >
                        Edit
                      </button>
                      <button
                        class="secondary-btn"
                        disabled={props.stale || busySlug() === exercise.slug}
                        onClick={() => toggleArchived(exercise)}
                      >
                        {exercise.archived ? 'Restore' : 'Archive'}
                      </button>
                      <button
                        class="danger-btn danger-btn-inline"
                        disabled={props.stale || busySlug() === exercise.slug}
                        onClick={() => askToRemove(exercise)}
                      >
                        Delete
                      </button>
                    </div>
                  }
                >
                  <div class="library-item-actions">
                    <span class="library-item-confirm">Delete permanently?</span>
                    <button
                      class="secondary-btn"
                      disabled={busySlug() === exercise.slug}
                      onClick={() => setConfirmingSlug(null)}
                    >
                      Keep
                    </button>
                    <button
                      class="danger-btn danger-btn-inline"
                      disabled={busySlug() === exercise.slug}
                      onClick={() => remove(exercise)}
                    >
                      {busySlug() === exercise.slug ? 'Deleting…' : 'Delete'}
                    </button>
                  </div>
                </Show>
              </li>
            )}
          </For>
        </ul>
      </div>

      <Show when={form()} keyed>
        {(state) => (
          <ExerciseFormSheet
            exercise={state.exercise}
            mode={state.mode}
            programme={props.programme}
            workouts={props.workouts}
            onDuplicate={(exercise) => setForm({ exercise, mode: 'duplicate' })}
            onClose={() => setForm(null)}
            onSaved={props.onSaved}
            onError={props.onError}
          />
        )}
      </Show>
    </div>
  );
}
