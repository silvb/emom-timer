import { createSignal, createMemo, For, Show } from 'solid-js';
import { savePrescription } from '../db.js';
import { prescriptionFormError } from '../model.js';

// Bottom sheet for editing the reps/weights of a single exercise. Prescriptions
// are append-only (see db.js) and are keyed by exercise slug, not by slot, so
// the same exercise can appear in more than one workout — the affected-workouts
// note below exists because a save here can silently change another workout too.
export default function EditSlotSheet(props) {
  const exercise = () => props.slot.exercise;
  const type = () => exercise().type;
  const isRampUp = () => type() === 'ramp_up';
  const isRepRange = () => type() === 'rep_range';

  const prescription = exercise().prescription;

  function initialWeights() {
    const count = isRampUp() ? exercise().rounds : 1;
    const existing = prescription?.weights ?? [];
    return Array.from({ length: count }, (_, i) => String(existing[i] ?? ''));
  }

  const [repsMin, setRepsMin] = createSignal(String(prescription?.reps_min ?? ''));
  const [repsMax, setRepsMax] = createSignal(String(prescription?.reps_max ?? ''));
  const [weights, setWeights] = createSignal(initialWeights());
  const [formError, setFormError] = createSignal(null);
  const [busy, setBusy] = createSignal(false);

  function setSingleReps(value) {
    setRepsMin(value);
    setRepsMax(value);
  }

  function setWeightAt(index, value) {
    setWeights((current) => current.map((w, i) => (i === index ? value : w)));
  }

  // The exercise object is shared across every slot that references it (see
  // model.js), so identifying "this" workout by slot membership — rather than
  // requiring a separate prop — is enough to find every *other* workout using it.
  const currentWorkout = () => props.workouts.find((w) => w.slots.includes(props.slot));

  const affectedWorkouts = createMemo(() => {
    const slug = exercise().slug;
    const current = currentWorkout();
    return props.workouts
      .filter((w) => w.id !== current?.id)
      .filter((w) => w.slots.some((s) => s.exercise.slug === slug))
      .map((w) => w.title);
  });

  // The rules themselves live in model.js so they can be unit tested without a
  // DOM; this only gathers the current field values.
  const validationError = () =>
    prescriptionFormError({
      type: type(),
      rounds: exercise().rounds,
      repsMin: repsMin(),
      repsMax: repsMax(),
      weights: weights(),
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
      await savePrescription({
        exercise_slug: exercise().slug,
        reps_min: Number(repsMin()),
        reps_max: Number(repsMax()),
        weights: weights().map(Number),
      });
      props.onSaved(); // triggers refetch in App
      props.onClose();
    } catch (e) {
      // Surface the failure in-sheet, not via the global toast: the sheet is
      // deliberately kept open for retry, and the toast renders at the same
      // bottom-of-viewport spot behind the sheet's own backdrop, so a toast
      // here would be invisible to the user who is looking at this form.
      setFormError(e.message ?? 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="edit-sheet-backdrop" onClick={props.onClose}>
      <div class="edit-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 class="edit-sheet-title">{exercise().name}</h2>

        <Show
          when={isRepRange()}
          fallback={
            <div class="edit-field">
              <label>Reps</label>
              <input
                type="number"
                inputmode="numeric"
                step="1"
                min="1"
                value={repsMin()}
                onInput={(e) => setSingleReps(e.currentTarget.value)}
              />
            </div>
          }
        >
          <div class="edit-field">
            <label>Reps Min</label>
            <input
              type="number"
              inputmode="numeric"
              step="1"
              min="1"
              value={repsMin()}
              onInput={(e) => setRepsMin(e.currentTarget.value)}
            />
          </div>
          <div class="edit-field">
            <label>Reps Max</label>
            <input
              type="number"
              inputmode="numeric"
              step="1"
              min="1"
              value={repsMax()}
              onInput={(e) => setRepsMax(e.currentTarget.value)}
            />
          </div>
        </Show>

        <Show
          when={isRampUp()}
          fallback={
            <div class="edit-field">
              <label>Weight</label>
              <input
                type="number"
                inputmode="decimal"
                step="0.5"
                min="0"
                value={weights()[0]}
                onInput={(e) => setWeightAt(0, e.currentTarget.value)}
              />
            </div>
          }
        >
          <For each={weights()}>
            {(w, i) => (
              <div class="edit-field">
                <label>Round {i() + 1}</label>
                <input
                  type="number"
                  inputmode="decimal"
                  step="0.5"
                  min="0"
                  value={w}
                  onInput={(e) => setWeightAt(i(), e.currentTarget.value)}
                />
              </div>
            )}
          </For>
        </Show>

        <Show when={affectedWorkouts().length > 0}>
          <p class="edit-affected">Also changes: {affectedWorkouts().join(', ')}</p>
        </Show>

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
      </div>
    </div>
  );
}
