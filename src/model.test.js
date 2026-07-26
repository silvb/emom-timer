import { describe, it, expect } from 'vitest';
import { shapeProgramme, validateWorkout } from './model.js';

const rows = () => ({
  exercises: [
    { slug: 'sumo_deadlift', movement: 'sumo_deadlift', name: 'Sumo Deadlifts', type: 'ramp_up', rounds: 4, unilateral: false },
    { slug: 'rest', movement: 'rest', name: 'Rest', type: 'plain', rounds: null, unilateral: false },
  ],
  prescriptions: [
    { exercise_slug: 'sumo_deadlift', reps_min: 6, reps_max: 6, weights: ['80', '90', '110', '100'] },
  ],
  workouts: [
    { id: 'hinge_main', title: 'Hinge Main', day: 'friday', rounds: 4, position: 6 },
  ],
  slots: [
    { workout_id: 'hinge_main', position: 2, exercise_slug: 'rest', side: null },
    { workout_id: 'hinge_main', position: 1, exercise_slug: 'sumo_deadlift', side: null },
  ],
});

describe('shapeProgramme', () => {
  it('nests the current prescription onto its exercise', () => {
    const r = rows();
    const p = shapeProgramme(r.exercises, r.prescriptions, r.workouts, r.slots);
    expect(p.exercises.sumo_deadlift.prescription.weights).toEqual(['80', '90', '110', '100']);
  });

  it('leaves plain exercises without a prescription', () => {
    const r = rows();
    const p = shapeProgramme(r.exercises, r.prescriptions, r.workouts, r.slots);
    expect(p.exercises.rest.prescription).toBeNull();
  });

  it('orders slots by position regardless of row order', () => {
    const r = rows();
    const p = shapeProgramme(r.exercises, r.prescriptions, r.workouts, r.slots);
    expect(p.workouts[0].slots.map((s) => s.exercise.slug)).toEqual(['sumo_deadlift', 'rest']);
  });

  it('derives minutes from rounds and slot count', () => {
    const r = rows();
    const p = shapeProgramme(r.exercises, r.prescriptions, r.workouts, r.slots);
    expect(p.workouts[0].minutes).toBe(8); // 4 rounds x 2 slots
  });

  it('shares one exercise object between every slot that references it', () => {
    const r = rows();
    r.workouts.push({ id: 'other', title: 'Other', day: null, rounds: 4, position: 9 });
    r.slots.push({ workout_id: 'other', position: 1, exercise_slug: 'sumo_deadlift', side: null });
    const p = shapeProgramme(r.exercises, r.prescriptions, r.workouts, r.slots);
    const a = p.workouts.find((w) => w.id === 'hinge_main').slots[0].exercise;
    const b = p.workouts.find((w) => w.id === 'other').slots[0].exercise;
    expect(a).toBe(b);
  });
});

describe('validateWorkout', () => {
  const build = (workoutRounds, exerciseRounds) => ({
    id: 'w', title: 'W', day: null, rounds: workoutRounds, position: 1, minutes: 0,
    slots: [{
      position: 1, side: null,
      exercise: {
        slug: 'sumo_deadlift', name: 'Sumo Deadlifts', type: 'ramp_up',
        rounds: exerciseRounds, unilateral: false,
        prescription: { reps_min: 6, reps_max: 6, weights: [80, 90, 110, 100] },
      },
    }],
  });

  it('passes when the ramp matches the workout', () => {
    expect(validateWorkout(build(4, 4))).toEqual([]);
  });

  it('reports a ramp whose round count disagrees with the workout', () => {
    const problems = validateWorkout(build(4, 3));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/Sumo Deadlifts/);
  });

  it('reports a ramp whose weight count disagrees with its rounds', () => {
    const w = build(4, 4);
    w.slots[0].exercise.prescription.weights = [80, 90];
    expect(validateWorkout(w)).toHaveLength(1);
  });

  it('reports a non-plain exercise with no prescription at all', () => {
    const w = build(4, 4);
    w.slots[0].exercise.prescription = null;
    expect(validateWorkout(w)).toHaveLength(1);
  });

  it('reports a workout with no slots instead of allowing it to start', () => {
    const w = { id: 'w', title: 'W', day: null, rounds: 4, position: 1, minutes: 0, slots: [] };
    expect(validateWorkout(w)).toEqual(['This workout has no exercises yet.']);
  });
});
