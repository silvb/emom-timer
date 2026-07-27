import { createSignal, createMemo, Index, For, Show } from 'solid-js';
import { createExercise, updateExercise, savePrescription } from '../db.js';
import { prescriptionFormError, normalizeDecimal } from '../model.js';
import {
  exerciseFormError,
  deriveSlug,
  lockedExerciseFields,
  EXERCISE_TYPES,
  MAX_ROUNDS,
  rampRoundsError,
} from '../structure.js';

const TYPE_LABELS = {
  ramp_up: 'Ramp up — one weight per round',
  rep_range: 'Rep range — min to max reps',
  fixed: 'Fixed — one rep count, one weight',
  plain: 'No numbers — Rest, Carry, Skip',
};

// Create, edit or duplicate an exercise.
//
// 'duplicate' exists because some edits have no valid statement order at all
// once data is attached: check_exercise_update (0002) re-validates every
// existing prescription and slot, so changing a ramp's round count is rejected
// whichever way round it is attempted. That is decision D4 — a different round
// count is a different exercise — and duplication is how it is honoured without
// touching the original's history. The shared `movement` keeps the old and new
// comparable on a trend line.
export default function ExerciseFormSheet(props) {
  const source = props.exercise;
  const mode = props.mode;
  const isEdit = mode === 'edit';

  // Duplicate mode's name is pre-filled, not typed, so its slug has to be
  // derived from that same initial value up front — otherwise the identifier
  // sits blank until the user happens to retype the name, and Save fails on a
  // field they were never prompted to fill.
  const initialName = mode === 'duplicate' ? `${source.name} (new)` : (source?.name ?? '');
  const [name, setName] = createSignal(initialName);
  const [slug, setSlug] = createSignal(isEdit ? source.slug : deriveSlug(initialName));
  const [slugTouched, setSlugTouched] = createSignal(isEdit);

  // A brand-new exercise defaults to its own identifier as its movement: most
  // lifts are their own movement, and the grouping only matters once a second
  // variant exists. Until the field is touched the default tracks the
  // identifier live, so renaming before the first save carries the movement
  // with it instead of stranding whatever the name happened to be when the
  // field was first shown.
  const [movementInput, setMovementInput] = createSignal(source?.movement ?? '');
  const [movementTouched, setMovementTouched] = createSignal(mode !== 'create');
  const movement = () => (movementTouched() ? movementInput() : slug());

  function chooseMovement(value) {
    setMovementTouched(true);
    setMovementInput(value);
  }

  // Which control the movement field shows. It starts on the free-text input
  // for a new exercise because that is where the identifier default lives, and
  // both directions are reachable — picking an existing movement is the whole
  // reason the field is not just a text box.
  const [movementIsNew, setMovementIsNew] = createSignal(mode === 'create');
  const [type, setType] = createSignal(source?.type ?? 'fixed');
  const [rounds, setRounds] = createSignal(String(source?.rounds ?? ''));
  const [unilateral, setUnilateral] = createSignal(Boolean(source?.unilateral));

  const [repsMin, setRepsMin] = createSignal(String(source?.prescription?.reps_min ?? ''));
  const [repsMax, setRepsMax] = createSignal(String(source?.prescription?.reps_max ?? ''));
  const [weights, setWeights] = createSignal(
    (source?.prescription?.weights ?? ['']).map((w) => String(w))
  );

  const [formError, setFormError] = createSignal(null);
  const [busy, setBusy] = createSignal(false);

  // Creating is two writes — the exercise row, then its opening prescription —
  // and they are deliberately not atomic (see save()). Remembering that the
  // first one landed is what makes the second attempt a retry rather than a
  // duplicate-key error on an insert that already succeeded: without it, Save
  // is permanently unusable after a mid-create network drop, and the only way
  // to add the missing prescription is to leave, attach the exercise to a
  // workout and use EditSlotSheet.
  const [createdSlug, setCreatedSlug] = createSignal(null);
  // While this is set, the exercise row exists and only its prescription is
  // outstanding, so every field that belongs to the row is frozen — editing
  // them would silently do nothing.
  const pendingPrescription = () => Boolean(createdSlug());

  // Locked fields only apply while editing in place. A duplicate is a brand-new
  // row with nothing attached, so every field is free — that is the point.
  const locks = createMemo(() =>
    isEdit
      ? lockedExerciseFields(source, props.workouts)
      : { type: null, rounds: null, unilateral: null }
  );

  const movements = createMemo(() =>
    [...new Set(Object.values(props.programme.exercises).map((e) => e.movement))].sort()
  );

  const needsPrescription = () => type() !== 'plain';
  // Clamped to MAX_ROUNDS because this drives how many weight inputs render on
  // every keystroke, before validation has had a chance to reject the value.
  const weightCount = () =>
    type() === 'ramp_up' ? Math.min(MAX_ROUNDS, Math.max(1, Number(rounds()) || 1)) : 1;

  // Shown under the Rounds field while typing, because weightCount() clamps.
  // Without this the clamp is silent: type 500 and thirty inputs appear with
  // nothing to explain why the form disagrees with the number on screen. A
  // blank field is deliberately excluded — it is a save-time error, and
  // flagging it the moment the kind is switched to ramp-up would put a red
  // message under a field the user has not reached yet.
  const roundsFieldError = () => {
    if (type() !== 'ramp_up') return null;
    if (String(rounds()).trim() === '') return null;
    return rampRoundsError(rounds());
  };

  function changeName(value) {
    setName(value);
    if (!slugTouched()) setSlug(deriveSlug(value));
  }

  // Keep the weight field count in step with the round count while typing, so
  // a ramp always shows exactly as many inputs as it will need rows for.
  const syncedWeights = createMemo(() => {
    const count = weightCount();
    const current = weights();
    return Array.from({ length: count }, (_, i) => current[i] ?? '');
  });

  // Writes go through the synced array, not the raw signal: `weights` starts
  // at length 1 and is never resized on its own, so a plain `.map` over it
  // can't reach index 2 or 3 of a 4-round ramp — the keystroke would be
  // silently dropped while the rendered <Index> (keyed by position) kept
  // showing the typed character, since its source is `syncedWeights()`, not
  // `weights()`. Reading through `syncedWeights()` first pads the array to the
  // rendered length before the positional write lands, matching how
  // `EditSlotSheet.jsx` sizes its array up front in `initialWeights()`.
  function setWeightAt(index, value) {
    setWeights(syncedWeights().map((w, i) => (i === index ? value : w)));
  }

  function validate() {
    const shape = exerciseFormError({
      name: name(),
      slug: slug(),
      movement: movement(),
      type: type(),
      rounds: type() === 'ramp_up' ? rounds() : '',
      existingSlugs: Object.keys(props.programme.exercises),
      currentSlug: isEdit ? source.slug : undefined,
    });
    if (shape) return shape;

    // The prescription fields render only on create/duplicate (needsPrescription()
    // && !isEdit) — validating them while editing would block Save on input the
    // user cannot see or correct, including a pure name/movement rename on an
    // exercise that has no prescription yet. A 'plain' exercise never gets a
    // prescription either way — check_prescription_shape raises if one is
    // written for it.
    if (!needsPrescription() || isEdit) return null;

    return prescriptionFormError({
      type: type(),
      rounds: Number(rounds()),
      repsMin: repsMin(),
      repsMax: repsMax(),
      weights: syncedWeights(),
    });
  }

  async function save() {
    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    setBusy(true);

    try {
      if (isEdit) {
        // Only name and movement are ever editable in place; type, rounds and
        // unilateral are locked whenever anything is attached, and when nothing
        // is attached they are still sent so an untouched new exercise can be
        // corrected.
        await updateExercise(source.slug, {
          name: name().trim(),
          movement: movement().trim(),
          ...(locks().type ? {} : { type: type() }),
          ...(locks().rounds ? {} : { rounds: type() === 'ramp_up' ? Number(rounds()) : null }),
          ...(locks().unilateral ? {} : { unilateral: unilateral() }),
        });
      } else {
        // Two requests, deliberately not atomic. If the prescription insert
        // fails the exercise exists without one, which validateWorkout()
        // already reports as "has no prescription yet" — unlike a slot rewrite,
        // there is no state here that silently breaks a workout. What the split
        // does need is a retry that does not redo the half that succeeded,
        // hence createdSlug: pressing Save again completes the prescription
        // instead of failing on a duplicate primary key.
        if (!pendingPrescription()) {
          await createExercise({
            slug: slug().trim(),
            movement: movement().trim(),
            name: name().trim(),
            type: type(),
            rounds: Number(rounds()),
            unilateral: unilateral(),
          });
          setCreatedSlug(slug().trim());
        }

        if (needsPrescription()) {
          await savePrescription({
            exercise_slug: createdSlug(),
            reps_min: Number(repsMin()),
            reps_max: Number(repsMax()),
            weights: syncedWeights().map((w) => Number(normalizeDecimal(w))),
          });
        }
      }
    } catch (e) {
      setFormError(e.message || 'Could not save. Try again.');
      setBusy(false);
      return;
    }

    // The write has landed. A refetch failure from here is a refresh problem,
    // not a write problem, and must not be reported as "could not save" —
    // the same distinction DetailView draws after saveWorkoutSlots.
    try {
      await props.onSaved();
    } catch (e) {
      props.onError?.(`Saved, but the screen could not refresh. ${e.message || 'Try reloading.'}`);
    }

    setBusy(false);
    props.onClose();
  }

  return (
    <div
      class="edit-sheet-backdrop"
      onClick={() => {
        // Not while a write is in flight: Cancel is disabled for the same
        // reason, and a backdrop tap here would discard the typed form —
        // including the record of a half-finished create that Save needs to
        // finish the job.
        if (!busy()) props.onClose();
      }}
    >
      <div class="edit-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 class="edit-sheet-title">
          {mode === 'create' ? 'New exercise' : mode === 'duplicate' ? 'Duplicate exercise' : source.name}
        </h2>

        <Show when={pendingPrescription()}>
          <p class="edit-warning" role="alert">
            “{name().trim()}” was created, but its opening prescription was not saved. Save again to
            add it — the exercise itself is already stored and can no longer be changed here.
          </p>
        </Show>

        <Show when={mode === 'duplicate'}>
          <p class="edit-hint">
            Creates a separate exercise. “{source.name}” and its history stay exactly as they are,
            and both keep the movement “{source.movement}” so their progress stays comparable.
          </p>
        </Show>

        <div class="edit-field">
          <label for="ex-name">Name</label>
          <input
            id="ex-name"
            type="text"
            autocomplete="off"
            value={name()}
            disabled={pendingPrescription()}
            onInput={(e) => changeName(e.currentTarget.value)}
          />
        </div>

        <Show when={!isEdit}>
          <div class="edit-field">
            <label for="ex-slug">Identifier</label>
            <input
              id="ex-slug"
              type="text"
              autocomplete="off"
              value={slug()}
              disabled={pendingPrescription()}
              onInput={(e) => {
                setSlugTouched(true);
                setSlug(e.currentTarget.value);
              }}
            />
            <p class="edit-hint">Permanent once saved.</p>
          </div>
        </Show>

        <div class="edit-field">
          <label for="ex-movement">Movement</label>
          <Show
            when={movementIsNew()}
            fallback={
              <select
                id="ex-movement"
                value={movement()}
                disabled={pendingPrescription()}
                onInput={(e) => {
                  if (e.currentTarget.value === '__new__') {
                    setMovementIsNew(true);
                    // Untouch it so the free-text box falls back to the live
                    // identifier rather than a value captured at this instant.
                    setMovementTouched(false);
                    setMovementInput('');
                  } else {
                    chooseMovement(e.currentTarget.value);
                  }
                }}
              >
                <option value="">Choose…</option>
                <For each={movements()}>{(m) => <option value={m}>{m}</option>}</For>
                <option value="__new__">New movement…</option>
              </select>
            }
          >
            <input
              id="ex-movement"
              type="text"
              autocomplete="off"
              value={movement()}
              disabled={pendingPrescription()}
              onInput={(e) => chooseMovement(e.currentTarget.value)}
            />
            <button
              type="button"
              class="edit-link-btn"
              disabled={pendingPrescription()}
              onClick={() => {
                setMovementIsNew(false);
                chooseMovement('');
              }}
            >
              Use an existing movement
            </button>
          </Show>
          <p class="edit-hint">Groups variants of the same lift so their progress lines up.</p>
        </div>

        <div class="edit-field">
          <label for="ex-type">Kind</label>
          <select
            id="ex-type"
            value={type()}
            disabled={Boolean(locks().type) || pendingPrescription()}
            onInput={(e) => setType(e.currentTarget.value)}
          >
            <For each={EXERCISE_TYPES}>
              {(t) => <option value={t}>{TYPE_LABELS[t]}</option>}
            </For>
          </select>
          <Show when={locks().type}>
            <p class="edit-locked">{locks().type}</p>
          </Show>
        </div>

        <Show when={type() === 'ramp_up'}>
          <div class="edit-field">
            <label for="ex-rounds">Rounds</label>
            <input
              id="ex-rounds"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              value={rounds()}
              disabled={Boolean(locks().rounds) || pendingPrescription()}
              onInput={(e) => setRounds(e.currentTarget.value)}
            />
            <Show when={locks().rounds}>
              <p class="edit-locked">{locks().rounds}</p>
            </Show>
            <Show when={roundsFieldError()}>
              <p class="edit-error" role="alert">{roundsFieldError()}</p>
            </Show>
          </div>
        </Show>

        <div class="edit-field">
          <label class="library-toggle">
            <input
              type="checkbox"
              checked={unilateral()}
              disabled={Boolean(locks().unilateral) || pendingPrescription()}
              onInput={(e) => setUnilateral(e.currentTarget.checked)}
            />
            One side at a time
          </label>
          <Show when={locks().unilateral}>
            <p class="edit-locked">{locks().unilateral}</p>
          </Show>
        </div>

        <Show when={needsPrescription() && !isEdit}>
          <h3 class="edit-subhead">Opening prescription</h3>

          <div class="edit-field">
            <label for="ex-reps-min">{type() === 'rep_range' ? 'Reps min' : 'Reps'}</label>
            <input
              id="ex-reps-min"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              value={repsMin()}
              onInput={(e) => {
                setRepsMin(e.currentTarget.value);
                if (type() !== 'rep_range') setRepsMax(e.currentTarget.value);
              }}
            />
          </div>

          <Show when={type() === 'rep_range'}>
            <div class="edit-field">
              <label for="ex-reps-max">Reps max</label>
              <input
                id="ex-reps-max"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                value={repsMax()}
                onInput={(e) => setRepsMax(e.currentTarget.value)}
              />
            </div>
          </Show>

          {/* Index, not For: For is keyed by value, so editing one weight
              rebuilds that input and destroys focus mid-typing. Same reason as
              EditSlotSheet. */}
          <Index each={syncedWeights()}>
            {(w, i) => (
              <div class="edit-field">
                <label for={`ex-weight-${i}`}>
                  {type() === 'ramp_up' ? `Round ${i + 1} weight` : 'Weight'}
                </label>
                <input
                  id={`ex-weight-${i}`}
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  value={w()}
                  onInput={(e) => setWeightAt(i, e.currentTarget.value)}
                />
              </div>
            )}
          </Index>
        </Show>

        <Show when={isEdit && (locks().type || locks().rounds || locks().unilateral)}>
          <button
            class="secondary-btn"
            disabled={busy()}
            onClick={() => props.onDuplicate?.(source)}
          >
            Duplicate as new exercise
          </button>
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
