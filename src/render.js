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

// How old the cached programme is, for the offline banner. Coarse on purpose:
// the only question it has to answer is "is this yesterday's programme or last
// month's?" — the answer decides whether the weights on screen can be trusted.
// Returns null when the age is unknown, so the caller can fall back.
export function cacheAgeText(at, now = Date.now()) {
  if (typeof at !== 'number' || !Number.isFinite(at)) return null;

  const seconds = Math.max(0, Math.round((now - at) / 1000));
  if (seconds < 60) return 'just now';

  const plural = (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`;

  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return plural(minutes, 'minute');

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return plural(hours, 'hour');

  return plural(Math.floor(hours / 24), 'day');
}

export function describeSlot(slot, roundIndex) {
  return {
    reps: repsText(slot),
    name: slot.exercise.name,
    weights: weightParts(slot.exercise, roundIndex),
    side: sideLabel(slot, roundIndex),
  };
}
