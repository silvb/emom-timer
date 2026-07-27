import { describe, it, expect } from 'vitest';
import {
  deriveSlug,
  moveItem,
  nextPosition,
  EXERCISE_TYPES,
  DAY_KEYS,
  exerciseFormError,
  workoutFormError,
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
    isNew: true,
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
      exerciseFormError({ ...valid(), slug: 'goblet_squat', isNew: false })
    ).toBeNull();
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
    isNew: true,
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
    expect(workoutFormError({ ...valid(), id: 'squat_main', isNew: false })).toBeNull();
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
});
