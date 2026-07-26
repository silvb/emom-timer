// Given an absolute minute index, which slot and which round are we in?
export function positionAt(minuteIndex, slotCount, totalRounds) {
  const clamped = Math.min(minuteIndex, totalRounds * slotCount - 1);
  return {
    slotIndex: clamped % slotCount,
    roundIndex: Math.floor(clamped / slotCount),
  };
}

// Given elapsed seconds and workout config, derive all display state
export function deriveTimerState(elapsed, workout, phase) {
  if (phase === 'countdown') {
    return {
      phase: 'countdown',
      countdownSeconds: Math.max(0, 10 - elapsed),
    };
  }

  const slotCount = workout.slots.length;
  const totalRounds = workout.rounds;
  const totalMinutes = totalRounds * slotCount;
  const totalSeconds = totalMinutes * 60;
  const remaining = Math.max(0, totalSeconds - elapsed);

  const minuteIndex = Math.floor(elapsed / 60);
  const secondsLeftInRound = 60 - (elapsed % 60);

  const cur = positionAt(minuteIndex, slotCount, totalRounds);
  const hasNext = minuteIndex + 1 < totalMinutes;
  const nextPos = hasNext ? positionAt(minuteIndex + 1, slotCount, totalRounds) : null;

  return {
    phase: remaining <= 0 ? 'done' : 'running',
    remaining,
    secondsLeftInRound: remaining <= 0 ? 0 : secondsLeftInRound,
    slotIndex: cur.slotIndex,
    roundIndex: cur.roundIndex,
    currentRound: cur.roundIndex + 1,
    totalRounds,
    slot: workout.slots[cur.slotIndex],
    next: nextPos
      ? { ...nextPos, slot: workout.slots[nextPos.slotIndex] }
      : null,
  };
}

// A "Rest" slot is a recovery minute, not a real exercise — it's part of the
// EMOM cycle but hidden from the weekly schedule listing. Carry and Skip are
// also numberless, but they are the whole point of their workouts, so they stay.
export const isRest = (exercise) => exercise.slug === 'rest';

// Assign a color to each exercise, randomly from a curated palette
const PALETTE = [
  '#E8533A', // terracotta red
  '#3A7BD5', // cobalt blue
  '#2EAB6E', // emerald
  '#D4A017', // amber
  '#9B4FC8', // violet
  '#D4534A', // coral
  '#1A9E9E', // teal
  '#E87D3A', // burnt orange
];

export function assignColors(slots) {
  const shuffled = [...PALETTE].sort(() => Math.random() - 0.5);
  const map = {};
  slots.forEach((slot, i) => {
    map[slot.exercise.slug] = shuffled[i % shuffled.length];
  });
  return map;
}
