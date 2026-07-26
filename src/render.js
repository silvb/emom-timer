// Turns a slot plus a round index into the structured parts a view renders.
// Deliberately returns parts rather than a formatted string: the active screen
// has to emphasise one weight inside a ramp, which a string cannot express.

export function sideLabel(slot, roundIndex) {
  if (slot.side !== 'per_round') return null;
  if (roundIndex === null || roundIndex === undefined) return 'L/R';
  return roundIndex % 2 === 0 ? 'left' : 'right';
}

export function repsText(slot) {
  const p = slot.exercise.prescription;
  if (!p) return null;
  const base = p.reps_max > p.reps_min ? `${p.reps_min}-${p.reps_max}` : `${p.reps_min}`;
  return slot.side === 'alternating' ? `${base}/${base}` : base;
}

export function weightParts(exercise, roundIndex) {
  const p = exercise.prescription;
  if (!p) return [];

  const values = p.weights.map(Number);
  if (values.every((v) => v === 0)) return [];

  const highlight =
    roundIndex === null || roundIndex === undefined
      ? -1
      : exercise.type === 'ramp_up'
        ? Math.min(roundIndex, values.length - 1)
        : 0;

  return values.map((value, i) => ({ value, current: i === highlight }));
}

export function describeSlot(slot, roundIndex) {
  return {
    reps: repsText(slot),
    name: slot.exercise.name,
    weights: weightParts(slot.exercise, roundIndex),
    side: sideLabel(slot, roundIndex),
  };
}
