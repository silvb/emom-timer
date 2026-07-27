// Turns the four flat table reads into the nested shape the views consume.
// Pure — no network, no storage — so it can be unit tested directly.
export function shapeProgramme(exerciseRows, prescriptionRows, workoutRows, slotRows) {
  const byExercise = new Map();
  prescriptionRows.forEach((p) => {
    byExercise.set(p.exercise_slug, {
      reps_min: p.reps_min,
      reps_max: p.reps_max,
      weights: p.weights,
    });
  });

  const exercises = {};
  exerciseRows.forEach((e) => {
    exercises[e.slug] = {
      slug: e.slug,
      movement: e.movement,
      name: e.name,
      type: e.type,
      rounds: e.rounds,
      unilateral: e.unilateral,
      // Rows written before migration 0009, and cache entries written before
      // this field existed, both arrive as undefined and must read as active.
      archived: e.archived ?? false,
      prescription: byExercise.get(e.slug) ?? null,
    };
  });

  const slotsByWorkout = new Map();
  slotRows.forEach((s) => {
    if (!slotsByWorkout.has(s.workout_id)) slotsByWorkout.set(s.workout_id, []);
    slotsByWorkout.get(s.workout_id).push(s);
  });

  const workouts = [...workoutRows]
    .sort((a, b) => a.position - b.position)
    .map((w) => {
      const slots = (slotsByWorkout.get(w.id) ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((s) => ({
          position: s.position,
          side: s.side,
          exercise: exercises[s.exercise_slug],
        }));

      return {
        id: w.id,
        title: w.title,
        day: w.day,
        rounds: w.rounds,
        position: w.position,
        slots,
        minutes: w.rounds * slots.length,
      };
    });

  return { workouts, exercises };
}

// Problems severe enough that starting the workout would put the wrong weight
// on the bar. Returns human-readable strings; empty means good to go.
export function validateWorkout(workout) {
  const problems = [];

  if (workout.slots.length === 0) {
    problems.push('This workout has no exercises yet.');
    return problems;
  }

  workout.slots.forEach((slot) => {
    const ex = slot.exercise;
    if (!ex) {
      problems.push(`Slot ${slot.position} points at an exercise that no longer exists.`);
      return;
    }
    if (ex.type === 'plain') return;

    if (!ex.prescription) {
      problems.push(`${ex.name} has no prescription yet.`);
      return;
    }

    const count = ex.prescription.weights.length;

    if (ex.type === 'ramp_up') {
      if (ex.rounds !== workout.rounds) {
        problems.push(
          `${ex.name} is built for ${ex.rounds} rounds but this workout has ${workout.rounds}.`
        );
      } else if (count !== ex.rounds) {
        problems.push(`${ex.name} needs ${ex.rounds} weights but has ${count}.`);
      }
    } else if (count !== 1) {
      problems.push(`${ex.name} should have a single weight but has ${count}.`);
    }
  });

  return problems;
}

// The last check between a fat-fingered phone input and a permanent row in an
// append-only journal — nothing downstream can correct a bad save, only append
// after it. Lives here, next to validateWorkout, because it enforces the same
// two invariants ("a ramp has one weight per round, everything else has exactly
// one") one step earlier, on the raw form strings; the two must never drift.
//
// Takes strings deliberately: '' coerces to 0 through Number(), and a weight of
// 0 is legitimate (bodyweight movements), so an emptied field and a deliberate
// zero are indistinguishable after coercion. The blank checks have to happen
// before any Number() call.
//
// Returns a human-readable message, or null when the input is safe to save.
// A comma is the decimal separator on a German keyboard, and it is what gets
// typed for "82,5". `type="number"` inputs reject it outright, so the weight
// fields are plain text and normalise here instead.
export const normalizeDecimal = (value) => String(value ?? '').trim().replace(',', '.');

// One press of a +/- stepper. Treats a blank or unparseable field as 0 so the
// first press still lands on something sensible, clamps at `min`, and rounds
// away float noise (0.1 + 0.2) rather than writing 2.8000000000000003 to a row
// that can never be edited afterwards.
export function stepValue(current, delta, { min = 0, integer = false } = {}) {
  const parsed = Number(normalizeDecimal(current));
  const base = Number.isFinite(parsed) ? parsed : 0;
  let next = base + delta;
  if (integer) next = Math.round(next);
  if (next < min) next = min;
  return String(Number(next.toFixed(2)));
}

export function prescriptionFormError({ type, rounds, repsMin, repsMax, weights }) {
  const weightStrings = (weights ?? []).map((w) => String(w ?? ''));

  if (weightStrings.length === 0 || weightStrings.some((w) => w.trim() === '')) {
    return 'Enter a weight for every round.';
  }
  if (String(repsMin ?? '').trim() === '' || String(repsMax ?? '').trim() === '') {
    return 'Enter a value for reps.';
  }

  const parsedWeights = weightStrings.map((w) => Number(normalizeDecimal(w)));
  if (parsedWeights.some((w) => Number.isNaN(w) || w < 0)) {
    return 'Every weight must be a number of 0 or more.';
  }
  if (type === 'ramp_up' && parsedWeights.length !== rounds) {
    return `This ramp needs exactly ${rounds} weights.`;
  }
  if (type !== 'ramp_up' && parsedWeights.length !== 1) {
    return 'This exercise takes a single weight.';
  }

  const min = Number(repsMin);
  const max = Number(repsMax);
  // reps_min/reps_max are `int` columns in Postgres — a 5.5 from an
  // over-stepped input passes every check above but fails at the database with
  // an opaque "invalid input syntax for type integer", so catch it here.
  if (!Number.isInteger(min) || min < 1) {
    return 'Reps must be a whole number of 1 or more.';
  }
  if (!Number.isInteger(max) || max < min) {
    return 'Max reps must be a whole number greater than or equal to min reps.';
  }

  return null;
}
