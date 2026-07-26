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
