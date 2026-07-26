import { createSignal, createMemo, Index, Show } from 'solid-js';
import { savePrescription } from '../db.js';
import { prescriptionFormError, normalizeDecimal, stepValue } from '../model.js';

// 2.5 kg is one pair of 1.25 kg plates — the smallest real jump on a barbell,
// and every ramp exercise in the programme is a barbell lift. Anything finer,
// or a fixed-jump kettlebell, gets typed instead.
const WEIGHT_STEP = 2.5;
const REPS_STEP = 1;

// A labelled text field with -/+ buttons either side. Text rather than
// type="number" because a number input discards anything it considers invalid,
// which ate the comma decimal separator and threw the cursor to the start.
// mousedown is suppressed on the buttons so tapping one does not blur the
// input — on a phone that would close the keyboard between every press.
function StepperField(props) {
  const bump = (delta) =>
    props.onInput(stepValue(props.value, delta, { min: props.min, integer: props.integer }));

  return (
    <div class="edit-field">
      <label>{props.label}</label>
      <div class="stepper">
        <button
          type="button"
          class="stepper-btn"
          aria-label={`Decrease ${props.label}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => bump(-props.step)}
        >
          −
        </button>
        <input
          type="text"
          inputmode={props.inputmode}
          autocomplete="off"
          value={props.value}
          onInput={(e) => props.onInput(e.currentTarget.value)}
        />
        <button
          type="button"
          class="stepper-btn"
          aria-label={`Increase ${props.label}`}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => bump(props.step)}
        >
          +
        </button>
      </div>
    </div>
  );
}

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
        weights: weights().map((w) => Number(normalizeDecimal(w))),
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
            <StepperField
              label="Reps"
              value={repsMin()}
              onInput={setSingleReps}
              step={REPS_STEP}
              min={1}
              integer
              inputmode="numeric"
            />
          }
        >
          <StepperField
            label="Reps Min"
            value={repsMin()}
            onInput={setRepsMin}
            step={REPS_STEP}
            min={1}
            integer
            inputmode="numeric"
          />
          <StepperField
            label="Reps Max"
            value={repsMax()}
            onInput={setRepsMax}
            step={REPS_STEP}
            min={1}
            integer
            inputmode="numeric"
          />
        </Show>

        <Show
          when={isRampUp()}
          fallback={
            <StepperField
              label="Weight"
              value={weights()[0]}
              onInput={(v) => setWeightAt(0, v)}
              step={WEIGHT_STEP}
              min={0}
              inputmode="decimal"
            />
          }
        >
          {/* Index, not For: For is keyed by item value, so editing one weight
              rebuilds that row's DOM and the focused input — and the mobile
              number pad — is destroyed mid-typing. Index keys by position. */}
          <Index each={weights()}>
            {(w, i) => (
              <StepperField
                label={`Round ${i + 1}`}
                value={w()}
                onInput={(v) => setWeightAt(i, v)}
                step={WEIGHT_STEP}
                min={0}
                inputmode="decimal"
              />
            )}
          </Index>
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
