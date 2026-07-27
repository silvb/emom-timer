// Pure logic for structural editing (exercises, workouts, slots). Kept out of
// the views for the same reason prescriptionFormError is: these rules mirror
// database triggers, and a rule that can only be exercised by clicking through
// a phone UI is a rule that silently drifts from the trigger it mirrors.

// Slugs are primary keys and are permanent once written, so this only ever
// proposes one — every form shows the result and lets it be overridden before
// the first save. NFD + combining-mark strip keeps 'Überzüge' as 'uberzuge'
// instead of 'berzge', which matters on a German-language keyboard.
export function deriveSlug(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Reorder by swap. Returns a new array so Solid sees a new reference; a
// move that would fall off either end is a no-op rather than an error,
// because the up/down buttons at the ends stay visible and just do nothing.
export function moveItem(list, index, delta) {
  const target = index + delta;
  if (index < 0 || index >= list.length) return list;
  if (target < 0 || target >= list.length) return list;

  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function nextPosition(items) {
  return items.reduce((max, item) => Math.max(max, item.position ?? 0), 0) + 1;
}

export const EXERCISE_TYPES = ['ramp_up', 'rep_range', 'fixed', 'plain'];

export const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const SLUG_PATTERN = /^[a-z0-9_]+$/;

// No database constraint caps a round count, but the exercise form renders one
// weight input per round while the field is being typed, so an unbounded value
// is a rendering hazard rather than a data one: '1e9' is a finite integer that
// passes every other check here and would ask the browser for a billion inputs.
// 30 rounds is already a 30-minute single-exercise EMOM — far past anything the
// programme uses.
export const MAX_ROUNDS = 30;

// Round counts arrive as strings straight from the form. Number('') is 0, so
// an emptied field would pass a bare `> 0` check on the coerced value — the
// blank test has to come first, exactly as in prescriptionFormError.
function roundsError(value, { required, label }) {
  const raw = String(value ?? '').trim();

  if (raw === '') {
    return required ? `Enter how many rounds ${label}.` : null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 'Rounds must be a number.';
  if (!Number.isInteger(parsed)) return 'Rounds must be a whole number.';
  if (parsed < 1) return `Enter how many rounds ${label}.`;
  if (parsed > MAX_ROUNDS) return `Rounds must be ${MAX_ROUNDS} or fewer.`;
  return null;
}

// The ramp round-count rule on its own, so the form can show it live under the
// field instead of only at save time. Without it the clamp in the form's weight
// input count silently disagrees with what was typed: enter 500 and thirty
// inputs render, with nothing on screen explaining the other 470 until Save.
// exerciseFormError delegates here so the two can never drift apart.
export function rampRoundsError(rounds) {
  return roundsError(rounds, { required: true, label: 'this ramp climbs over' });
}

export function exerciseFormError({
  name,
  slug,
  movement,
  type,
  rounds,
  existingSlugs = [],
  currentSlug = undefined,
}) {
  if (String(name ?? '').trim() === '') return 'Enter a name.';
  if (String(movement ?? '').trim() === '') return 'Choose or enter a movement.';

  const slugValue = String(slug ?? '').trim();
  if (!SLUG_PATTERN.test(slugValue)) {
    return 'The identifier may only contain lowercase letters, digits and underscores.';
  }

  // The identifier is a primary key, so a collision is a database error either
  // way. This validation turns an opaque Postgres duplicate-key error into a
  // sentence the user can act on. When editing, exclude the record's own slug
  // from the collision set so the user can keep their current identifier.
  const taken = existingSlugs.filter((s) => s !== currentSlug);
  if (taken.includes(slugValue)) {
    return `The identifier "${slugValue}" is already in use.`;
  }

  if (!EXERCISE_TYPES.includes(type)) return 'Choose a kind.';

  if (type === 'ramp_up') {
    const error = rampRoundsError(rounds);
    if (error) return error;
  } else if (String(rounds ?? '').trim() !== '') {
    // Mirrors the ramp_rounds_present CHECK in 0001: a round count on a
    // non-ramp exercise is rejected by the database, so catch it here where
    // the message can say why.
    return 'Only ramp-up exercises can have a round count.';
  }

  return null;
}

export function workoutFormError({
  id,
  title,
  day,
  rounds,
  existingIds = [],
  currentId = undefined,
}) {
  if (String(title ?? '').trim() === '') return 'Enter a title.';

  const idValue = String(id ?? '').trim();
  if (!SLUG_PATTERN.test(idValue)) {
    return 'The identifier may only contain lowercase letters, digits and underscores.';
  }

  // The identifier is a primary key, so a collision is a database error either
  // way. This validation turns an opaque Postgres duplicate-key error into a
  // sentence the user can act on. When editing, exclude the record's own id
  // from the collision set so the user can keep their current identifier.
  const taken = existingIds.filter((id) => id !== currentId);
  if (taken.includes(idValue)) {
    return `The identifier "${idValue}" is already in use.`;
  }

  if (day !== null && day !== undefined && day !== '' && !DAY_KEYS.includes(day)) {
    return 'Choose a valid day, or leave it unassigned.';
  }

  return roundsError(rounds, { required: true, label: 'this workout repeats for' });
}

// --- Reference checks -------------------------------------------------------
// The database already refuses these (on delete restrict, check_exercise_update),
// but a Postgres error string is not something to show a user mid-planning.
// These produce the same verdict early, with the blocking workout named.

export function usedByWorkouts(slug, workouts) {
  return workouts
    .filter((w) => w.slots.some((s) => s.exercise?.slug === slug))
    .map((w) => w.title);
}

// check_exercise_update (0002) fires on update of rounds, type or unilateral
// and re-validates every prescription and slot already attached. The result is
// that some edits have no valid statement order at all: dropping a ramp from 4
// rounds to 3 is rejected because the existing prescription holds 4 weights,
// and writing a 3-weight prescription first is rejected because the exercise
// still says 4. That is design decision D4 — a different round count is a
// different exercise — so the UI locks the field and offers duplication.
export function lockedExerciseFields(exercise, workouts) {
  const users = usedByWorkouts(exercise.slug, workouts);
  const inUse = users.length > 0
    ? `In use by ${users.join(', ')}. Duplicate this exercise to change it.`
    : null;
  const prescribed = exercise.prescription
    ? 'It already has a prescription. Duplicate this exercise to change it.'
    : null;

  return {
    // The weight-array shape is derived from type and rounds, so an existing
    // prescription pins both.
    type: inUse ?? prescribed,
    rounds: inUse ?? prescribed,
    // Laterality only constrains slots — a prescription says nothing about sides.
    unilateral: inUse,
  };
}

// Both foreign keys into `exercises` are `on delete restrict`, so a delete with
// anything attached fails in Postgres with a constraint name and no hint about
// which workout or which journal entry is holding it. The spec requires the
// refusal to name what is blocking it, so every blocker is listed — a slot and
// a prescription can block the same exercise at once, and hearing about only
// the first means deleting the workout and being refused a second time.
// Returns null when the delete can go ahead.
export function deleteBlockedReason(exercise, workouts) {
  const blockers = [];

  const users = usedByWorkouts(exercise.slug, workouts);
  if (users.length > 0) blockers.push(`it is still used by ${users.join(', ')}`);
  if (exercise.prescription) blockers.push('it has a saved prescription');

  if (blockers.length === 0) return null;
  return `${exercise.name} can't be deleted: ${blockers.join(', and ')}. Archive it instead.`;
}

// --- Slot construction ------------------------------------------------------

// Accepts either the array form or the slug-keyed record shapeProgramme
// produces, because the library screen holds one and the add-slot picker the
// other, and forcing a conversion at each call site is how they drift.
export function eligibleExercises(exercises, workout) {
  const list = Array.isArray(exercises) ? exercises : Object.values(exercises ?? {});

  return list
    .filter((e) => !e.archived)
    // Invariant 2 (check_slot_shape): a ramp only fits a workout whose round
    // count equals its own. Filtering here means the picker cannot offer a
    // choice the database would reject.
    .filter((e) => e.type !== 'ramp_up' || e.rounds === workout.rounds)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Invariant 4 (check_slot_shape): a unilateral exercise's slot must carry a
// side, and a bilateral one must not.
export function defaultSide(exercise) {
  return exercise.unilateral ? 'alternating' : null;
}

// Invariant 5 is warn-only by design: balancing a per_round slot across an odd
// round count would require remembering which side was started last session,
// which the app deliberately does not record.
export function sideWarnings(workout) {
  if (workout.rounds % 2 === 0) return [];

  return workout.slots
    .filter((s) => s.side === 'per_round')
    .map(
      (s) =>
        `${s.exercise?.name ?? 'This exercise'} alternates sides per round, but ${workout.rounds} rounds is odd — one side gets an extra set.`
    );
}
