// Given elapsed seconds and workout config, derive all display state
export function deriveTimerState(elapsed, workout, phase) {
  if (phase === 'countdown') {
    return {
      phase: 'countdown',
      countdownSeconds: Math.max(0, 10 - elapsed),
    };
  }

  const totalSeconds = workout.minutes * 60;
  const remaining = Math.max(0, totalSeconds - elapsed);
  const secondsIntoRound = elapsed % 60;
  const secondsLeftInRound = 60 - secondsIntoRound;
  const exerciseIndex = Math.floor(elapsed / 60) % workout.exercises.length;
  const totalRounds = workout.minutes / workout.exercises.length;
  const currentRound = Math.floor(elapsed / (60 * workout.exercises.length)) + 1;

  return {
    phase: remaining <= 0 ? 'done' : 'running',
    remaining,
    secondsLeftInRound: remaining <= 0 ? 0 : secondsLeftInRound,
    exerciseIndex,
    currentRound: Math.min(currentRound, totalRounds),
    totalRounds,
    exerciseName: workout.exercises[exerciseIndex],
  };
}

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

export function assignColors(exercises) {
  const shuffled = [...PALETTE].sort(() => Math.random() - 0.5);
  const map = {};
  exercises.forEach((ex, i) => {
    map[ex] = shuffled[i % shuffled.length];
  });
  return map;
}
