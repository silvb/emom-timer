import { describe, it, expect } from 'vitest';
import { sideLabel, repsText, weightParts, describeSlot } from './render.js';

const exercise = (over = {}) => ({
  slug: 'x', movement: 'x', name: 'X', type: 'fixed', rounds: null, unilateral: false,
  prescription: { reps_min: 10, reps_max: 10, weights: [32] }, ...over,
});
const slot = (ex, side = null) => ({ position: 1, side, exercise: ex });

describe('sideLabel', () => {
  it('is null when the slot has no side', () => {
    expect(sideLabel(slot(exercise()), 0)).toBeNull();
  });

  it('is null for alternating, because the reps already read 10/10', () => {
    expect(sideLabel(slot(exercise({ unilateral: true }), 'alternating'), 0)).toBeNull();
  });

  it('is left on round 1 and right on round 2 for per_round', () => {
    const s = slot(exercise({ unilateral: true }), 'per_round');
    expect(sideLabel(s, 0)).toBe('left');
    expect(sideLabel(s, 1)).toBe('right');
    expect(sideLabel(s, 2)).toBe('left');
  });

  it('collapses to L/R when no round is given', () => {
    expect(sideLabel(slot(exercise({ unilateral: true }), 'per_round'), null)).toBe('L/R');
  });
});

describe('repsText', () => {
  it('shows a single number for fixed reps', () => {
    expect(repsText(slot(exercise()))).toBe('10');
  });

  it('shows a range for rep_range exercises', () => {
    const ex = exercise({ type: 'rep_range', prescription: { reps_min: 5, reps_max: 8, weights: [18.5] } });
    expect(repsText(slot(ex))).toBe('5-8');
  });

  it('doubles the reps for an alternating slot', () => {
    expect(repsText(slot(exercise({ unilateral: true }), 'alternating'))).toBe('10/10');
  });

  it('is null for a plain exercise', () => {
    expect(repsText(slot(exercise({ type: 'plain', prescription: null })))).toBeNull();
  });
});

describe('weightParts', () => {
  it('marks the single weight as current', () => {
    expect(weightParts(exercise(), 0)).toEqual([{ value: 32, current: true }]);
  });

  it('hides bodyweight movements whose only weight is zero', () => {
    expect(weightParts(exercise({ prescription: { reps_min: 20, reps_max: 20, weights: [0] } }), 0)).toEqual([]);
  });

  it('is empty for a plain exercise', () => {
    expect(weightParts(exercise({ type: 'plain', prescription: null }), 0)).toEqual([]);
  });

  it('highlights the weight belonging to the given round of a ramp', () => {
    const ramp = exercise({
      type: 'ramp_up', rounds: 4,
      prescription: { reps_min: 6, reps_max: 6, weights: [80, 90, 110, 100] },
    });
    expect(weightParts(ramp, 2)).toEqual([
      { value: 80, current: false },
      { value: 90, current: false },
      { value: 110, current: true },
      { value: 100, current: false },
    ]);
  });

  it('highlights nothing when no round is given', () => {
    const ramp = exercise({
      type: 'ramp_up', rounds: 4,
      prescription: { reps_min: 6, reps_max: 6, weights: [80, 90, 110, 100] },
    });
    expect(weightParts(ramp, null).every((w) => w.current === false)).toBe(true);
  });

  it('coerces numeric strings, because postgres numeric[] arrives as strings', () => {
    const ex = exercise({ prescription: { reps_min: 12, reps_max: 12, weights: ['2.5'] } });
    expect(weightParts(ex, 0)).toEqual([{ value: 2.5, current: true }]);
  });
});

describe('describeSlot', () => {
  it('assembles the full line for a ramp mid-workout', () => {
    const ramp = exercise({
      slug: 'sumo_deadlift', name: 'Sumo Deadlifts', type: 'ramp_up', rounds: 4,
      prescription: { reps_min: 6, reps_max: 6, weights: [80, 90, 110, 100] },
    });
    expect(describeSlot(slot(ramp), 2)).toEqual({
      reps: '6',
      name: 'Sumo Deadlifts',
      weights: [
        { value: 80, current: false },
        { value: 90, current: false },
        { value: 110, current: true },
        { value: 100, current: false },
      ],
      side: null,
    });
  });

  it('assembles a bare line for Rest', () => {
    const rest = exercise({ slug: 'rest', name: 'Rest', type: 'plain', prescription: null });
    expect(describeSlot(slot(rest), 0)).toEqual({ reps: null, name: 'Rest', weights: [], side: null });
  });
});
