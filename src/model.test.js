import { describe, it, expect } from 'vitest';
import { shapeProgramme, validateWorkout, prescriptionFormError } from './model.js';

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

// Every row this rejects would otherwise be permanent: prescriptions are
// append-only, so a bad save can only ever be followed by another row, never
// corrected. These are the cases the edit sheet has to catch before insert.
describe('prescriptionFormError', () => {
  // The form always holds strings, because that is what an <input> gives back.
  const form = (over = {}) => ({
    type: 'fixed', rounds: null, repsMin: '10', repsMax: '10', weights: ['32'], ...over,
  });

  it('accepts a valid fixed exercise', () => {
    expect(prescriptionFormError(form())).toBeNull();
  });

  it('accepts a valid rep_range exercise', () => {
    expect(prescriptionFormError(form({ type: 'rep_range', repsMin: '5', repsMax: '8', weights: ['18.5'] }))).toBeNull();
  });

  it('accepts a valid ramp_up exercise with one weight per round', () => {
    expect(prescriptionFormError(form({
      type: 'ramp_up', rounds: 4, repsMin: '6', repsMax: '6', weights: ['80', '90', '110', '100'],
    }))).toBeNull();
  });

  it('accepts a valid plain-weight bodyweight exercise', () => {
    // 'plain' exercises never reach the sheet, but a non-ramp kind with a
    // single weight is the shape they would take if one ever did.
    expect(prescriptionFormError(form({ repsMin: '20', repsMax: '20', weights: ['0'] }))).toBeNull();
  });

  it('accepts a weight of exactly 0, which is a real bodyweight prescription', () => {
    expect(prescriptionFormError(form({ weights: ['0'] }))).toBeNull();
  });

  it('rejects an emptied weight rather than saving it as 0', () => {
    // The whole reason this runs on strings: Number('') is 0, not NaN, so an
    // emptied field would otherwise land in the journal as a deliberate 0kg.
    expect(prescriptionFormError(form({ weights: [''] }))).toBe('Enter a weight for every round.');
  });

  it('rejects a whitespace-only weight', () => {
    expect(prescriptionFormError(form({ weights: ['   '] }))).toBe('Enter a weight for every round.');
  });

  it('rejects a blank weight anywhere in a ramp, not just the first', () => {
    expect(prescriptionFormError(form({
      type: 'ramp_up', rounds: 4, repsMin: '6', repsMax: '6', weights: ['80', '90', '', '100'],
    }))).toBe('Enter a weight for every round.');
  });

  it('rejects a negative weight', () => {
    expect(prescriptionFormError(form({ weights: ['-5'] }))).toBe('Every weight must be a number of 0 or more.');
  });

  it('rejects a non-numeric weight', () => {
    expect(prescriptionFormError(form({ weights: ['heavy'] }))).toBe('Every weight must be a number of 0 or more.');
  });

  it('rejects an emptied reps field', () => {
    expect(prescriptionFormError(form({ repsMin: '', repsMax: '' }))).toBe('Enter a value for reps.');
  });

  it('rejects a fractional rep count, which the int column would reject opaquely', () => {
    expect(prescriptionFormError(form({ repsMin: '5.5', repsMax: '5.5' })))
      .toBe('Reps must be a whole number of 1 or more.');
  });

  it('rejects reps below 1', () => {
    expect(prescriptionFormError(form({ repsMin: '0', repsMax: '0' })))
      .toBe('Reps must be a whole number of 1 or more.');
  });

  it('rejects a max below the min', () => {
    expect(prescriptionFormError(form({ type: 'rep_range', repsMin: '8', repsMax: '5', weights: ['18.5'] })))
      .toBe('Max reps must be a whole number greater than or equal to min reps.');
  });

  it('rejects a fractional max rep count', () => {
    expect(prescriptionFormError(form({ type: 'rep_range', repsMin: '5', repsMax: '8.5', weights: ['18.5'] })))
      .toBe('Max reps must be a whole number greater than or equal to min reps.');
  });

  it('rejects a ramp with too few weights', () => {
    expect(prescriptionFormError(form({
      type: 'ramp_up', rounds: 4, repsMin: '6', repsMax: '6', weights: ['80', '90'],
    }))).toBe('This ramp needs exactly 4 weights.');
  });

  it('rejects a ramp with too many weights', () => {
    expect(prescriptionFormError(form({
      type: 'ramp_up', rounds: 4, repsMin: '6', repsMax: '6', weights: ['80', '90', '110', '100', '105'],
    }))).toBe('This ramp needs exactly 4 weights.');
  });

  it('rejects a non-ramp exercise carrying more than one weight', () => {
    expect(prescriptionFormError(form({ weights: ['32', '36'] })))
      .toBe('This exercise takes a single weight.');
  });

  it('rejects an empty weight list outright', () => {
    expect(prescriptionFormError(form({ weights: [] }))).toBe('Enter a weight for every round.');
  });
});
