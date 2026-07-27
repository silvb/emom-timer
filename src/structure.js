// Pure logic for structural editing (exercises, workouts, slots). Kept out of
// the views for the same reason prescriptionFormError is: these rules mirror
// database triggers, and a rule that can only be exercised by clicking through
// a phone UI is a rule that silently drifts from the trigger it mirrors.

// Slugs are primary keys and are permanent once written, so this only ever
// proposes one — every form shows the result and lets it be overridden before
// the first save. NFD + combining-mark strip keeps 'Überzüge' as 'uberzuge'
// instead of 'berzge', which matters on a German-language keyboard.
export function deriveSlug(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

// Reorder by swap. Returns a new array so Solid sees a new reference; a
// move that would fall off either end is a no-op rather than an error,
// because the up/down buttons at the ends stay visible and just do nothing.
export function moveItem(list, index, delta) {
  const target = index + delta;
  if (index < 0 || index >= list.length) return list;
  if (target < 0 || target >= list.length) return list;

  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function nextPosition(items) {
  return items.reduce((max, item) => Math.max(max, item.position ?? 0), 0) + 1;
}
