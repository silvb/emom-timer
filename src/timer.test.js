import { describe, it, expect } from 'vitest';
import { deriveTimerState, positionAt, assignColors, isRest } from './timer.js';

const ex = (slug, extra = {}) => ({
  slug, movement: slug, name: slug, type: 'fixed', rounds: null, unilateral: false,
  prescription: { reps_min: 1, reps_max: 1, weights: [1] }, ...extra,
});

// hinge_main: [sumo, pushups, rest] x 4 rounds
const hinge = {
  id: 'hinge_main', title: 'Hinge Main', day: 'friday', rounds: 4, position: 1,
  slots: [
    { position: 1, side: null, exercise: ex('sumo_deadlift', { type: 'ramp_up', rounds: 4 }) },
    { position: 2, side: null, exercise: ex('push_up_on_kbs') },
    { position: 3, side: null, exercise: ex('rest', { type: 'plain', prescription: null }) },
  ],
};

describe('positionAt', () => {
  it('maps minute 0 to the first slot of round 1', () => {
    expect(positionAt(0, 3, 4)).toEqual({ slotIndex: 0, roundIndex: 0 });
  });

  it('wraps to the next round after the last slot', () => {
    expect(positionAt(3, 3, 4)).toEqual({ slotIndex: 0, roundIndex: 1 });
  });

  it('clamps past the end of the workout', () => {
    expect(positionAt(99, 3, 4)).toEqual({ slotIndex: 2, roundIndex: 3 });
  });
});

describe('deriveTimerState', () => {
  it('reports the countdown before the workout starts', () => {
    const s = deriveTimerState(4, hinge, 'countdown');
    expect(s.phase).toBe('countdown');
    expect(s.countdownSeconds).toBe(6);
  });

  it('reads totalRounds from the workout, not from minutes', () => {
    expect(deriveTimerState(0, hinge, 'running').totalRounds).toBe(4);
  });

  it('advances slot and round from elapsed seconds', () => {
    const s = deriveTimerState(3 * 60 + 10, hinge, 'running'); // minute 3
    expect(s.slotIndex).toBe(0);
    expect(s.roundIndex).toBe(1);
    expect(s.currentRound).toBe(2);
    expect(s.slot.exercise.slug).toBe('sumo_deadlift');
  });

  // The off-by-one this whole design turns on: standing in Rest at the end of
  // round 2, the next sumo set belongs to round 3.
  it('resolves the next slot into the following round when it wraps', () => {
    const s = deriveTimerState(5 * 60 + 30, hinge, 'running'); // minute 5 = round 2, Rest
    expect(s.slot.exercise.slug).toBe('rest');
    expect(s.roundIndex).toBe(1);
    expect(s.next.slot.exercise.slug).toBe('sumo_deadlift');
    expect(s.next.roundIndex).toBe(2); // round 3
  });

  it('has no next slot on the final minute', () => {
    expect(deriveTimerState(11 * 60 + 30, hinge, 'running').next).toBeNull();
  });

  it('counts down the seconds left in the current minute', () => {
    expect(deriveTimerState(90, hinge, 'running').secondsLeftInRound).toBe(30);
  });

  it('finishes after rounds * slots minutes', () => {
    const s = deriveTimerState(12 * 60, hinge, 'running');
    expect(s.phase).toBe('done');
    expect(s.remaining).toBe(0);
    expect(s.secondsLeftInRound).toBe(0);
  });
});

describe('assignColors', () => {
  it('keys colours by exercise slug so they survive per-round text changes', () => {
    const map = assignColors(hinge.slots);
    expect(Object.keys(map).sort()).toEqual(['push_up_on_kbs', 'rest', 'sumo_deadlift']);
    Object.values(map).forEach((c) => expect(c).toMatch(/^#[0-9A-Fa-f]{6}$/));
  });
});

describe('isRest', () => {
  it('is true only for the rest slug', () => {
    expect(isRest(ex('rest', { type: 'plain' }))).toBe(true);
  });

  it('is false for other plain exercises', () => {
    expect(isRest(ex('carry', { type: 'plain' }))).toBe(false);
    expect(isRest(ex('skip', { type: 'plain' }))).toBe(false);
  });
});
