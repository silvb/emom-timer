import { describe, it, expect } from 'vitest';
import { deriveSlug, moveItem, nextPosition } from './structure.js';

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
