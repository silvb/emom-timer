import { createSignal, For, Show } from 'solid-js';
import { createWorkout, updateWorkout, deleteWorkout } from '../db.js';
import { workoutFormError, deriveSlug, nextPosition, DAY_KEYS } from '../structure.js';

const DAY_LABELS = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

// Create or edit a workout's own fields. Its slots are edited on the detail
// screen, not here — the two have different failure modes and different save
// paths, and merging them would put a destructive round-count change behind
// the same button as a harmless reorder.
export default function WorkoutFormSheet(props) {
  const existing = props.workout;
  const isNew = !existing;

  const [title, setTitle] = createSignal(existing?.title ?? '');
  const [day, setDay] = createSignal(existing?.day ?? '');
  const [rounds, setRounds] = createSignal(String(existing?.rounds ?? ''));
  // Auto-derived while creating so a phone user never types it, but still
  // shown and overridable: the id is a permanent primary key.
  const [id, setId] = createSignal(existing?.id ?? '');
  const [idTouched, setIdTouched] = createSignal(!isNew);
  const [formError, setFormError] = createSignal(null);
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  function changeTitle(value) {
    setTitle(value);
    if (isNew && !idTouched()) setId(deriveSlug(value));
  }

  const validationError = () =>
    workoutFormError({
      id: id(),
      title: title(),
      day: day() === '' ? null : day(),
      rounds: rounds(),
      existingIds: props.workouts.map((w) => w.id),
      currentId: existing?.id,
    });

  async function save() {
    const error = validationError();
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      const fields = {
        title: title().trim(),
        day: day() === '' ? null : day(),
        rounds: Number(rounds()),
      };
      if (isNew) {
        await createWorkout({
          id: id().trim(),
          ...fields,
          position: nextPosition(props.workouts),
        });
      } else {
        await updateWorkout(existing.id, fields);
      }
      props.onSaved();
      props.onClose();
    } catch (e) {
      // A round-count change on a workout holding a ramp exercise is rejected
      // by check_workout_rounds (0001). Its message names the exercise and
      // both counts, so show it rather than a generic failure.
      setFormError(e.message ?? 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteWorkout(existing.id);
      props.onDeleted();
      props.onClose();
    } catch (e) {
      setFormError(e.message ?? 'Could not delete. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="edit-sheet-backdrop" onClick={props.onClose}>
      <div class="edit-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 class="edit-sheet-title">{isNew ? 'New workout' : 'Edit workout'}</h2>

        <div class="edit-field">
          <label for="workout-title">Title</label>
          <input
            id="workout-title"
            type="text"
            autocomplete="off"
            value={title()}
            onInput={(e) => changeTitle(e.currentTarget.value)}
          />
        </div>

        <Show when={isNew}>
          <div class="edit-field">
            <label for="workout-id">Identifier</label>
            <input
              id="workout-id"
              type="text"
              autocomplete="off"
              value={id()}
              onInput={(e) => {
                setIdTouched(true);
                setId(e.currentTarget.value);
              }}
            />
            <p class="edit-hint">Permanent once saved.</p>
          </div>
        </Show>

        <div class="edit-field">
          <label for="workout-day">Day</label>
          <select id="workout-day" value={day()} onInput={(e) => setDay(e.currentTarget.value)}>
            <option value="">Unassigned</option>
            <For each={DAY_KEYS}>
              {(key) => <option value={key}>{DAY_LABELS[key]}</option>}
            </For>
          </select>
        </div>

        <div class="edit-field">
          <label for="workout-rounds">Rounds</label>
          <input
            id="workout-rounds"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            value={rounds()}
            onInput={(e) => setRounds(e.currentTarget.value)}
          />
        </div>

        <Show when={formError()}>
          <p class="edit-error" role="alert">{formError()}</p>
        </Show>

        <div class="edit-actions">
          <button class="edit-cancel-btn" onClick={props.onClose} disabled={busy()}>
            Cancel
          </button>
          <button class="edit-save-btn" onClick={save} disabled={busy()}>
            {busy() ? 'Saving…' : 'Save'}
          </button>
        </div>

        <Show when={!isNew}>
          <Show
            when={confirmingDelete()}
            fallback={
              <button class="danger-btn" onClick={() => setConfirmingDelete(true)} disabled={busy()}>
                Delete workout
              </button>
            }
          >
            <p class="edit-warning">
              Delete “{existing.title}” and its {existing.slots.length} slots? The exercises and
              their history are not affected.
            </p>
            <div class="edit-actions">
              <button class="edit-cancel-btn" onClick={() => setConfirmingDelete(false)} disabled={busy()}>
                Keep
              </button>
              <button class="danger-btn" onClick={remove} disabled={busy()}>
                {busy() ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
