import { describe, it, expect } from 'vitest';
import {
  deriveSlug,
  moveItem,
  nextPosition,
  EXERCISE_TYPES,
  DAY_KEYS,
  exerciseFormError,
  workoutFormError,
  usedByWorkouts,
  lockedExerciseFields,
  canHardDelete,
  eligibleExercises,
  defaultSide,
  sideWarnings,
} from './structure.js';

describe('deriveSlug', () => {
  it('lowercases and underscores a display name', () => {
    expect(deriveSlug('Bulgarian Split Squat')).toBe('bulgarian_split_squat');
  });

  it('strips diacritics rather than dropping the letter', () => {
    expect(deriveSlug('Überzüge')).toBe('uberzuge');
  });

  it('collapses runs of punctuation into a single underscore', () => {
    expect(deriveSlug('Push-Up  (on KBs)')).toBe('push_up_on_kbs');
  });

  it('trims leading and trailing underscores', () => {
    expect(deriveSlug('  Rest!  ')).toBe('rest');
  });

  it('returns an empty string for input with no usable characters', () => {
    expect(deriveSlug('!!!')).toBe('');
    expect(deriveSlug(null)).toBe('');
  });
});

describe('moveItem', () => {
  it('swaps an item with the one after it', () => {
    expect(moveItem(['a', 'b', 'c'], 0, 1)).toEqual(['b', 'a', 'c']);
  });

  it('swaps an item with the one before it', () => {
    expect(moveItem(['a', 'b', 'c'], 2, -1)).toEqual(['a', 'c', 'b']);
  });

  it('returns the list unchanged when the move would leave the range', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 0, -1)).toEqual(list);
    expect(moveItem(list, 2, 1)).toEqual(list);
  });

  it('does not mutate the input', () => {
    const list = ['a', 'b'];
    moveItem(list, 0, 1);
    expect(list).toEqual(['a', 'b']);
  });
});

describe('nextPosition', () => {
  it('is one past the highest existing position', () => {
    expect(nextPosition([{ position: 2 }, { position: 7 }])).toBe(8);
  });

  it('starts at 1 for an empty list', () => {
    expect(nextPosition([])).toBe(1);
  });
});

describe('exerciseFormError', () => {
  const valid = () => ({
    name: 'Bulgarian Split Squat',
    slug: 'bulgarian_split_squat',
    movement: 'split_squat',
    type: 'fixed',
    rounds: '',
    existingSlugs: ['goblet_squat'],
  });

  it('accepts a well-formed new exercise', () => {
    expect(exerciseFormError(valid())).toBeNull();
  });

  it('rejects a blank name', () => {
    expect(exerciseFormError({ ...valid(), name: '   ' })).toMatch(/name/i);
  });

  it('rejects a blank movement', () => {
    expect(exerciseFormError({ ...valid(), movement: '' })).toMatch(/movement/i);
  });

  it('rejects a slug with characters that are not lowercase, digits or underscore', () => {
    expect(exerciseFormError({ ...valid(), slug: 'Split Squat' })).toMatch(/identifier/i);
  });

  it('rejects a slug already taken by another exercise', () => {
    expect(exerciseFormError({ ...valid(), slug: 'goblet_squat' })).toMatch(/already/i);
  });

  it('allows an existing slug when editing that same exercise', () => {
    expect(
      exerciseFormError({ ...valid(), slug: 'goblet_squat', currentSlug: 'goblet_squat' })
    ).toBeNull();
  });

  it('editing an exercise and keeping its own slug is allowed', () => {
    expect(
      exerciseFormError({
        ...valid(),
        slug: 'bulgarian_split_squat',
        currentSlug: 'bulgarian_split_squat',
      })
    ).toBeNull();
  });

  it('editing an exercise and taking a different existing exercise slug is rejected', () => {
    expect(
      exerciseFormError({ ...valid(), slug: 'goblet_squat', currentSlug: 'bulgarian_split_squat' })
    ).toMatch(/already/i);
  });

  it('rejects an unknown type', () => {
    expect(exerciseFormError({ ...valid(), type: 'pyramid' })).toMatch(/kind/i);
  });

  it('requires a round count for ramp_up', () => {
    expect(exerciseFormError({ ...valid(), type: 'ramp_up', rounds: '' })).toMatch(/rounds/i);
  });

  it('rejects a fractional round count', () => {
    expect(exerciseFormError({ ...valid(), type: 'ramp_up', rounds: '3.5' })).toMatch(/whole/i);
  });

  it('rejects a round count below 1', () => {
    expect(exerciseFormError({ ...valid(), type: 'ramp_up', rounds: '0' })).toMatch(/rounds/i);
  });

  it('accepts a valid ramp_up', () => {
    expect(exerciseFormError({ ...valid(), type: 'ramp_up', rounds: '4' })).toBeNull();
  });

  it('rejects a round count on a type that must not carry one', () => {
    expect(exerciseFormError({ ...valid(), type: 'fixed', rounds: '4' })).toMatch(/only ramp/i);
  });
});

describe('workoutFormError', () => {
  const valid = () => ({
    id: 'push_day',
    title: 'Push Day',
    day: 'monday',
    rounds: '4',
    existingIds: ['squat_main'],
  });

  it('accepts a well-formed new workout', () => {
    expect(workoutFormError(valid())).toBeNull();
  });

  it('accepts a workout with no day', () => {
    expect(workoutFormError({ ...valid(), day: null })).toBeNull();
  });

  it('rejects a blank title', () => {
    expect(workoutFormError({ ...valid(), title: '' })).toMatch(/title/i);
  });

  it('rejects a malformed id', () => {
    expect(workoutFormError({ ...valid(), id: 'Push Day' })).toMatch(/identifier/i);
  });

  it('rejects an id already in use', () => {
    expect(workoutFormError({ ...valid(), id: 'squat_main' })).toMatch(/already/i);
  });

  it('allows the existing id when editing', () => {
    expect(workoutFormError({ ...valid(), id: 'squat_main', currentId: 'squat_main' })).toBeNull();
  });

  it('rejects an unknown day', () => {
    expect(workoutFormError({ ...valid(), day: 'caturday' })).toMatch(/day/i);
  });

  it('rejects a blank round count', () => {
    expect(workoutFormError({ ...valid(), rounds: '' })).toMatch(/rounds/i);
  });

  it('rejects a fractional round count', () => {
    expect(workoutFormError({ ...valid(), rounds: '2.5' })).toMatch(/whole/i);
  });

  it('editing a workout and keeping its own id is allowed', () => {
    expect(
      workoutFormError({ ...valid(), id: 'push_day', currentId: 'push_day' })
    ).toBeNull();
  });

  it('editing a workout and taking a different existing workout id is rejected', () => {
    expect(
      workoutFormError({ ...valid(), id: 'squat_main', currentId: 'push_day' })
    ).toMatch(/already/i);
  });
});

const ex = (over = {}) => ({
  slug: 'zercher_squat',
  movement: 'zercher_squat',
  name: 'Zercher Squats',
  type: 'ramp_up',
  rounds: 4,
  unilateral: false,
  archived: false,
  prescription: { reps_min: 10, reps_max: 10, weights: [45, 50, 60, 60] },
  ...over,
});

const workoutWith = (exercise, over = {}) => ({
  id: 'squat_main',
  title: 'Squat Main',
  rounds: 4,
  slots: [{ position: 1, side: null, exercise }],
  ...over,
});

describe('usedByWorkouts', () => {
  it('names every workout holding a slot for the exercise', () => {
    const e = ex();
    const workouts = [
      workoutWith(e),
      workoutWith(e, { id: 'other', title: 'Other Day' }),
      { id: 'empty', title: 'Empty', rounds: 4, slots: [] },
    ];
    expect(usedByWorkouts('zercher_squat', workouts)).toEqual(['Squat Main', 'Other Day']);
  });

  it('tolerates a slot whose exercise reference is missing', () => {
    const workouts = [{ id: 'w', title: 'W', rounds: 4, slots: [{ position: 1, exercise: null }] }];
    expect(usedByWorkouts('zercher_squat', workouts)).toEqual([]);
  });
});

describe('lockedExerciseFields', () => {
  it('locks type and rounds when a prescription exists', () => {
    const locked = lockedExerciseFields(ex(), []);
    expect(locked.type).toMatch(/prescription/i);
    expect(locked.rounds).toMatch(/prescription/i);
  });

  it('locks all three when the exercise is used by a workout', () => {
    const e = ex({ prescription: null });
    const locked = lockedExerciseFields(e, [workoutWith(e)]);
    expect(locked.type).toMatch(/Squat Main/);
    expect(locked.rounds).toMatch(/Squat Main/);
    expect(locked.unilateral).toMatch(/Squat Main/);
  });

  it('leaves every field free for an unused exercise with no prescription', () => {
    expect(lockedExerciseFields(ex({ prescription: null }), [])).toEqual({
      type: null,
      rounds: null,
      unilateral: null,
    });
  });

  it('does not lock unilateral on prescription alone', () => {
    expect(lockedExerciseFields(ex(), []).unilateral).toBeNull();
  });
});

describe('canHardDelete', () => {
  it('is false when a prescription exists', () => {
    expect(canHardDelete(ex(), [])).toBe(false);
  });

  it('is false when a workout uses it', () => {
    const e = ex({ prescription: null });
    expect(canHardDelete(e, [workoutWith(e)])).toBe(false);
  });

  it('is true when nothing references it', () => {
    expect(canHardDelete(ex({ prescription: null }), [])).toBe(true);
  });
});

describe('eligibleExercises', () => {
  const pool = () => [
    ex({ slug: 'zercher_squat', name: 'Zercher Squats', type: 'ramp_up', rounds: 4 }),
    ex({ slug: 'press_3r', name: 'Press', type: 'ramp_up', rounds: 3 }),
    ex({ slug: 'rest', name: 'Rest', type: 'plain', rounds: null, prescription: null }),
    ex({ slug: 'old_curl', name: 'Old Curl', type: 'fixed', rounds: null, archived: true }),
  ];

  it('drops archived exercises', () => {
    const names = eligibleExercises(pool(), { rounds: 4 }).map((e) => e.slug);
    expect(names).not.toContain('old_curl');
  });

  it('drops ramps whose round count does not match the workout', () => {
    const names = eligibleExercises(pool(), { rounds: 4 }).map((e) => e.slug);
    expect(names).toContain('zercher_squat');
    expect(names).not.toContain('press_3r');
  });

  it('keeps non-ramp exercises regardless of round count', () => {
    expect(eligibleExercises(pool(), { rounds: 7 }).map((e) => e.slug)).toContain('rest');
  });

  it('sorts by display name', () => {
    expect(eligibleExercises(pool(), { rounds: 4 }).map((e) => e.name)).toEqual([
      'Rest',
      'Zercher Squats',
    ]);
  });

  it('accepts a plain object or a Map-style record of exercises', () => {
    const record = Object.fromEntries(pool().map((e) => [e.slug, e]));
    expect(eligibleExercises(record, { rounds: 4 }).map((e) => e.slug)).toEqual([
      'rest',
      'zercher_squat',
    ]);
  });
});

describe('defaultSide', () => {
  it('is alternating for a unilateral exercise', () => {
    expect(defaultSide(ex({ unilateral: true }))).toBe('alternating');
  });

  it('is null for a bilateral exercise', () => {
    expect(defaultSide(ex({ unilateral: false }))).toBeNull();
  });
});

describe('sideWarnings', () => {
  const unilateral = ex({ slug: 'gorilla_row', name: 'Gorilla Rows', unilateral: true, type: 'fixed', rounds: null });

  it('warns about a per_round slot in an odd-round workout', () => {
    const w = { id: 'w', title: 'W', rounds: 3, slots: [{ position: 1, side: 'per_round', exercise: unilateral }] };
    expect(sideWarnings(w)).toHaveLength(1);
    expect(sideWarnings(w)[0]).toMatch(/Gorilla Rows/);
  });

  it('stays silent in an even-round workout', () => {
    const w = { id: 'w', title: 'W', rounds: 4, slots: [{ position: 1, side: 'per_round', exercise: unilateral }] };
    expect(sideWarnings(w)).toEqual([]);
  });

  it('stays silent for alternating slots', () => {
    const w = { id: 'w', title: 'W', rounds: 3, slots: [{ position: 1, side: 'alternating', exercise: unilateral }] };
    expect(sideWarnings(w)).toEqual([]);
  });
});
