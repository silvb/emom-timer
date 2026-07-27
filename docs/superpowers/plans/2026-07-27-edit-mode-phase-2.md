# Edit Mode Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user create and restructure exercises, workouts and slots from the app — phone or desktop — instead of hand-writing SQL in the Supabase dashboard.

**Architecture:** Three new SQL migrations re-open write access to the structure tables, add an `archived` flag to `exercises`, and add one `save_workout_slots(text, jsonb)` function so a slot-set rewrite is a single atomic request. All new pure logic goes into one new module, `src/structure.js`, so it is unit-testable without a DOM; all Supabase I/O stays in `src/db.js`. The UI adds an explicit edit mode to `DetailView` (local draft, one atomic save on commit), a new `ExerciseLibraryView`, and three new bottom sheets that follow the existing `EditSlotSheet` pattern.

**Tech Stack:** SolidJS 1.9, Vite 7, Vitest 4 (node environment — no DOM), Supabase JS 2, PostgreSQL with plpgsql triggers.

## Global Constraints

- Node 22.12 (`.nvmrc`). Package manager is **pnpm**, never npm.
- Tests: `pnpm test` (Vitest, node environment). **There is no jsdom and no component-testing setup.** Only pure modules (`model.js`, `render.js`, `timer.js`, and the new `structure.js`) get automated tests. Every `.jsx` task is verified with `pnpm build` plus the manual check written into that task.
- **The agent cannot apply or verify migrations.** There is no local Supabase stack in this repo — `supabase/` contains migrations only. Migration SQL is written and committed; the user applies it in the Supabase dashboard. No task may claim a migration "works".
- `prescriptions` stays append-only: insert only, never update, never delete. Trigger `prescriptions_append_only` (0005) rejects both regardless of who asks.
- The five database invariants (triggers `check_prescription_shape`, `check_slot_shape`, `check_workout_rounds`, `check_exercise_update`) stay in force. Client-side checks duplicate them for good error messages; they never replace them.
- Every new plpgsql function must pin its search path — `set search_path = public, pg_temp` — matching migration 0007.
- Solid props: read `props.x` at every call site inside components that stay mounted while their data changes. Never destructure props in `DetailView`, `ExerciseLibraryView`, or any sheet. (See the `Gotchas` section of `CLAUDE.md`.)
- Weight and reps inputs are `type="text"`, not `type="number"` — a number input discards the comma decimal separator. Normalise with `normalizeDecimal` from `model.js`.
- Do not touch `src/timer.js`, `src/audio.js`, or `src/views/ActiveView.jsx`. The active workout screen must behave exactly as it does today.
- Commit after every task with a conventional-commit subject (`feat:`, `fix:`, `docs:`, `test:`).

---

## File Structure

**Created:**
- `supabase/migrations/0008_structural_write_policies.sql` — re-grant insert/update/delete on the three structure tables.
- `supabase/migrations/0009_exercise_archived.sql` — `archived` boolean on `exercises`.
- `supabase/migrations/0010_save_workout_slots.sql` — atomic slot-set rewrite function.
- `src/structure.js` — all pure logic for structural editing: slug derivation, list reordering, form validation, field locking, picker eligibility, reference blockers, warnings.
- `src/structure.test.js` — its tests.
- `src/views/ExerciseLibraryView.jsx` — exercise list, archive toggle, entry to the exercise form.
- `src/views/ExerciseFormSheet.jsx` — create / edit / duplicate an exercise, including its opening prescription.
- `src/views/WorkoutFormSheet.jsx` — create / rename / re-day / re-round / delete a workout.
- `src/views/AddSlotSheet.jsx` — exercise picker and side chooser for a new slot.

**Modified:**
- `src/model.js` — carry `archived` through `shapeProgramme`.
- `src/db.js` — structural write functions.
- `src/App.jsx` — `library` view value, stale flag plumbed to views.
- `src/views/ScheduleView.jsx` — "New workout" and "Exercises" entry points.
- `src/views/DetailView.jsx` — edit mode.
- `src/index.css` — styles, added per view task.
- `CLAUDE.md` — architecture and data-model sections.

---

### Task 1: Migrations

The three SQL files. **Nothing here can be executed or verified by the implementer** — no local Supabase stack exists. Deliverable is reviewed SQL, committed.

**Files:**
- Create: `supabase/migrations/0008_structural_write_policies.sql`
- Create: `supabase/migrations/0009_exercise_archived.sql`
- Create: `supabase/migrations/0010_save_workout_slots.sql`

**Interfaces:**
- Consumes: nothing.
- Produces: an `exercises.archived` boolean column (not null, default false); a callable function `save_workout_slots(p_workout_id text, p_slots jsonb) returns void`, where each element of `p_slots` is `{"exercise_slug": text, "side": text|null}` **in final display order**.

- [ ] **Step 1: Write the write-access migration**

Create `supabase/migrations/0008_structural_write_policies.sql`:

```sql
-- 0006 narrowed exercises/workouts/workout_slots to `for select` because the
-- app only ever read them, and Phase-2 structural edits were expected to be
-- hand-written dashboard SQL running as the service role. Phase 2 instead puts
-- that editing in the app, so the three tables need write access back.
--
-- The select policies from 0006 stay as they are; these only add the missing
-- verbs. Every write still passes the invariant triggers from 0001/0002, which
-- are role-agnostic and unaffected by RLS.
--
-- Accepted trade-off, recorded deliberately: this restores the exposure 0006
-- removed. The publishable key ships in the client bundle, so the single
-- account's password is the whole boundary, and a stray .delete() in a future
-- refactor could drop workout structure. prescriptions remain protected —
-- their append-only trigger (0005) rejects UPDATE and DELETE for every role.
create policy owner_insert on exercises for insert to authenticated with check (true);
create policy owner_update on exercises for update to authenticated using (true) with check (true);
create policy owner_delete on exercises for delete to authenticated using (true);

create policy owner_insert on workouts for insert to authenticated with check (true);
create policy owner_update on workouts for update to authenticated using (true) with check (true);
create policy owner_delete on workouts for delete to authenticated using (true);

create policy owner_insert on workout_slots for insert to authenticated with check (true);
create policy owner_update on workout_slots for update to authenticated using (true) with check (true);
create policy owner_delete on workout_slots for delete to authenticated using (true);
```

- [ ] **Step 2: Write the archived-column migration**

Create `supabase/migrations/0009_exercise_archived.sql`:

```sql
-- An exercise that has ever had a prescription can never be deleted:
-- prescriptions.exercise_slug is `on delete restrict`, deliberately, because
-- the prescription history is the user's training journal. Retiring therefore
-- cannot be expressed as a delete, and without a flag the add-slot picker
-- would grow monotonically for the life of the app.
--
-- Reversible by design: archiving hides, it never destroys.
alter table exercises add column archived boolean not null default false;

-- Partial index: the picker and the default library listing both filter to
-- archived = false, and that is the only predicate ever used.
create index exercises_active on exercises (slug) where archived = false;
```

- [ ] **Step 3: Write the atomic slot-rewrite migration**

Create `supabase/migrations/0010_save_workout_slots.sql`:

```sql
-- Reordering slots cannot be a plain UPDATE: the primary key is
-- (workout_id, position), so moving slot 3 to position 1 collides with the row
-- already there. The workable shape is delete-all-then-reinsert, which over
-- Supabase's REST layer is two separate requests with no transaction between
-- them. If the second fails, the workout is left with no slots at all and the
-- user finds out at the rack.
--
-- A plpgsql function body runs inside one transaction, so both statements
-- commit or neither does. That — not privilege — is the entire reason this
-- exists, which is why it is deliberately NOT `security definer`: it runs as
-- the caller, RLS applies normally, and it grants nothing the client did not
-- already have from 0008.
--
-- Positions are renumbered 1..N from array order, so the client never has to
-- send or reason about position numbers; it sends the list in display order.
create function save_workout_slots(p_workout_id text, p_slots jsonb)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from workouts where id = p_workout_id) then
    raise exception 'workout % does not exist', p_workout_id;
  end if;

  if jsonb_typeof(p_slots) <> 'array' then
    raise exception 'p_slots must be a JSON array, got %', jsonb_typeof(p_slots);
  end if;

  delete from workout_slots where workout_id = p_workout_id;

  insert into workout_slots (workout_id, position, exercise_slug, side)
  select p_workout_id,
         (ord)::int,
         elem->>'exercise_slug',
         nullif(elem->>'side', '')
  from jsonb_array_elements(p_slots) with ordinality as t(elem, ord);
end;
$$;
```

- [ ] **Step 4: Verify the SQL parses as far as tooling allows**

There is no local Postgres. Re-read each file once against these checks and fix anything that fails:
- Every statement ends in a semicolon.
- `0008` adds policies with names not already used on that table (`owner_read` from 0006 is the only existing one — confirm with `grep -rn "create policy" supabase/migrations/`).
- `0010` uses `with ordinality`, which requires the `jsonb_array_elements(...) as t(elem, ord)` alias form exactly as written.

Run: `grep -rn "create policy" supabase/migrations/`
Expected: only `owner_all` (0001, dropped in 0006), `owner_read` (0006), `prescriptions_read`/`prescriptions_insert` (0001), and the new `owner_insert`/`owner_update`/`owner_delete`. No duplicate name on the same table.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0008_structural_write_policies.sql supabase/migrations/0009_exercise_archived.sql supabase/migrations/0010_save_workout_slots.sql
git commit -m "feat: add phase 2 migrations for structural write access"
```

---

### Task 2: Slug derivation and list reordering

**Files:**
- Create: `src/structure.js`
- Create: `src/structure.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces: `deriveSlug(name: string) => string`, `moveItem(list: T[], index: number, delta: number) => T[]`, `nextPosition(items: {position:number}[]) => number`.

- [ ] **Step 1: Write the failing tests**

Create `src/structure.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test structure`
Expected: FAIL — `Failed to resolve import "./structure.js"`.

- [ ] **Step 3: Write the implementation**

Create `src/structure.js`:

```js
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
    .replace(/[\u0300-\u036f]/g, '')
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
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test structure`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add src/structure.js src/structure.test.js
git commit -m "feat: add slug derivation and list reordering helpers"
```

---

### Task 3: Exercise and workout form validation

**Files:**
- Modify: `src/structure.js`
- Modify: `src/structure.test.js`

**Interfaces:**
- Consumes: `deriveSlug` from Task 2.
- Produces:
  - `EXERCISE_TYPES: string[]` — `['ramp_up', 'rep_range', 'fixed', 'plain']`
  - `DAY_KEYS: string[]` — the seven lowercase day names
  - `exerciseFormError({ name, slug, movement, type, rounds, existingSlugs, isNew }) => string | null`
  - `workoutFormError({ id, title, day, rounds, existingIds, isNew }) => string | null`

  `rounds` arrives as a **string** from the form input in both cases, for the same reason `prescriptionFormError` takes strings: `Number('')` is `0`, which would pass a naive positive check on an emptied field.

- [ ] **Step 1: Write the failing tests**

Append to `src/structure.test.js` (and add the new names to the import at the top of the file):

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test structure`
Expected: FAIL — `exerciseFormError is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/structure.js`:

```js
export const EXERCISE_TYPES = ['ramp_up', 'rep_range', 'fixed', 'plain'];

export const DAY_KEYS = [
  'monday',
  'tuesday',
  'wednesday',
  'thursday',
  'friday',
  'saturday',
  'sunday',
];

const SLUG_PATTERN = /^[a-z0-9_]+$/;

// Round counts arrive as strings straight from the form. Number('') is 0, so
// an emptied field would pass a bare `> 0` check on the coerced value — the
// blank test has to come first, exactly as in prescriptionFormError.
function roundsError(value, { required, label }) {
  const raw = String(value ?? '').trim();

  if (raw === '') {
    return required ? `Enter how many rounds ${label}.` : null;
  }

  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return 'Rounds must be a number.';
  if (!Number.isInteger(parsed)) return 'Rounds must be a whole number.';
  if (parsed < 1) return `Enter how many rounds ${label}.`;
  return null;
}

export function exerciseFormError({
  name,
  slug,
  movement,
  type,
  rounds,
  existingSlugs = [],
  isNew = true,
}) {
  if (String(name ?? '').trim() === '') return 'Enter a name.';
  if (String(movement ?? '').trim() === '') return 'Choose or enter a movement.';

  const slugValue = String(slug ?? '').trim();
  if (!SLUG_PATTERN.test(slugValue)) {
    return 'The identifier may only contain lowercase letters, digits and underscores.';
  }
  if (isNew && existingSlugs.includes(slugValue)) {
    return `The identifier "${slugValue}" is already in use.`;
  }

  if (!EXERCISE_TYPES.includes(type)) return 'Choose a kind.';

  if (type === 'ramp_up') {
    const error = roundsError(rounds, { required: true, label: 'this ramp climbs over' });
    if (error) return error;
  } else if (String(rounds ?? '').trim() !== '') {
    // Mirrors the ramp_rounds_present CHECK in 0001: a round count on a
    // non-ramp exercise is rejected by the database, so catch it here where
    // the message can say why.
    return 'A round count applies to ramp-up exercises only.';
  }

  return null;
}

export function workoutFormError({
  id,
  title,
  day,
  rounds,
  existingIds = [],
  isNew = true,
}) {
  if (String(title ?? '').trim() === '') return 'Enter a title.';

  const idValue = String(id ?? '').trim();
  if (!SLUG_PATTERN.test(idValue)) {
    return 'The identifier may only contain lowercase letters, digits and underscores.';
  }
  if (isNew && existingIds.includes(idValue)) {
    return `The identifier "${idValue}" is already in use.`;
  }

  if (day !== null && day !== undefined && day !== '' && !DAY_KEYS.includes(day)) {
    return 'Choose a valid day, or leave it unassigned.';
  }

  return roundsError(rounds, { required: true, label: 'this workout repeats for' });
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test structure`
Expected: PASS, 32 tests.

- [ ] **Step 5: Commit**

```bash
git add src/structure.js src/structure.test.js
git commit -m "feat: add exercise and workout form validation"
```

---

### Task 4: Field locking, picker eligibility, reference blockers, warnings

The rules that mirror the `check_exercise_update`, `check_slot_shape` and `check_workout_rounds` triggers, so the UI can explain a refusal before the database issues one.

**Files:**
- Modify: `src/structure.js`
- Modify: `src/structure.test.js`

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `usedByWorkouts(slug, workouts) => string[]` — titles of workouts holding a slot for this exercise.
  - `lockedExerciseFields(exercise, workouts) => { type: string|null, rounds: string|null, unilateral: string|null }` — a reason string when locked, `null` when free.
  - `canHardDelete(exercise, workouts) => boolean`
  - `eligibleExercises(exercises, workout) => exercise[]` — sorted by name.
  - `defaultSide(exercise) => 'alternating' | null`
  - `sideWarnings(workout) => string[]`

  `exercise` is the shape produced by `shapeProgramme`: `{ slug, movement, name, type, rounds, unilateral, archived, prescription }`. `workout` is `{ id, title, rounds, slots }` where each slot is `{ position, side, exercise }`.

- [ ] **Step 1: Write the failing tests**

Append to `src/structure.test.js` (adding the new names to the import):

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test structure`
Expected: FAIL — `usedByWorkouts is not a function`.

- [ ] **Step 3: Write the implementation**

Append to `src/structure.js`:

```js
// --- Reference checks -------------------------------------------------------
// The database already refuses these (on delete restrict, check_exercise_update),
// but a Postgres error string is not something to show a user mid-planning.
// These produce the same verdict early, with the blocking workout named.

export function usedByWorkouts(slug, workouts) {
  return workouts
    .filter((w) => w.slots.some((s) => s.exercise?.slug === slug))
    .map((w) => w.title);
}

// check_exercise_update (0002) fires on update of rounds, type or unilateral
// and re-validates every prescription and slot already attached. The result is
// that some edits have no valid statement order at all: dropping a ramp from 4
// rounds to 3 is rejected because the existing prescription holds 4 weights,
// and writing a 3-weight prescription first is rejected because the exercise
// still says 4. That is design decision D4 — a different round count is a
// different exercise — so the UI locks the field and offers duplication.
export function lockedExerciseFields(exercise, workouts) {
  const users = usedByWorkouts(exercise.slug, workouts);
  const inUse = users.length > 0
    ? `In use by ${users.join(', ')}. Duplicate this exercise to change it.`
    : null;
  const prescribed = exercise.prescription
    ? 'It already has a prescription. Duplicate this exercise to change it.'
    : null;

  return {
    // The weight-array shape is derived from type and rounds, so an existing
    // prescription pins both.
    type: inUse ?? prescribed,
    rounds: inUse ?? prescribed,
    // Laterality only constrains slots — a prescription says nothing about sides.
    unilateral: inUse,
  };
}

export function canHardDelete(exercise, workouts) {
  return !exercise.prescription && usedByWorkouts(exercise.slug, workouts).length === 0;
}

// --- Slot construction ------------------------------------------------------

// Accepts either the array form or the slug-keyed record shapeProgramme
// produces, because the library screen holds one and the add-slot picker the
// other, and forcing a conversion at each call site is how they drift.
export function eligibleExercises(exercises, workout) {
  const list = Array.isArray(exercises) ? exercises : Object.values(exercises ?? {});

  return list
    .filter((e) => !e.archived)
    // Invariant 2 (check_slot_shape): a ramp only fits a workout whose round
    // count equals its own. Filtering here means the picker cannot offer a
    // choice the database would reject.
    .filter((e) => e.type !== 'ramp_up' || e.rounds === workout.rounds)
    .sort((a, b) => a.name.localeCompare(b.name));
}

// Invariant 4 (check_slot_shape): a unilateral exercise's slot must carry a
// side, and a bilateral one must not.
export function defaultSide(exercise) {
  return exercise.unilateral ? 'alternating' : null;
}

// Invariant 5 is warn-only by design: balancing a per_round slot across an odd
// round count would require remembering which side was started last session,
// which the app deliberately does not record.
export function sideWarnings(workout) {
  if (workout.rounds % 2 === 0) return [];

  return workout.slots
    .filter((s) => s.side === 'per_round')
    .map(
      (s) =>
        `${s.exercise?.name ?? 'This exercise'} alternates sides per round, but ${workout.rounds} rounds is odd — one side gets an extra set.`
    );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test structure`
Expected: PASS, 52 tests.

- [ ] **Step 5: Commit**

```bash
git add src/structure.js src/structure.test.js
git commit -m "feat: add exercise locking, picker eligibility and side warnings"
```

---

### Task 5: Carry `archived` through the programme shape

**Files:**
- Modify: `src/model.js:15-24`
- Modify: `src/model.test.js`
- Modify: `src/db.js:9`

**Interfaces:**
- Consumes: nothing.
- Produces: every exercise object from `shapeProgramme` now carries `archived: boolean`. A row that predates migration 0009, or a cache entry written before this change, reads as `false`.

- [ ] **Step 1: Write the failing test**

Add to the `describe('shapeProgramme', ...)` block in `src/model.test.js`:

```js
  it('carries the archived flag onto the exercise', () => {
    const r = rows();
    r.exercises[0].archived = true;
    const p = shapeProgramme(r.exercises, r.prescriptions, r.workouts, r.slots);
    expect(p.exercises.sumo_deadlift.archived).toBe(true);
  });

  it('treats a missing archived column as not archived', () => {
    const r = rows();
    const p = shapeProgramme(r.exercises, r.prescriptions, r.workouts, r.slots);
    expect(p.exercises.rest.archived).toBe(false);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `pnpm test model`
Expected: FAIL — `expected undefined to be false`.

- [ ] **Step 3: Add the field**

In `src/model.js`, inside the `exerciseRows.forEach` block, add `archived` after `unilateral`:

```js
      unilateral: e.unilateral,
      // Rows written before migration 0009, and cache entries written before
      // this field existed, both arrive as undefined and must read as active.
      archived: e.archived ?? false,
      prescription: byExercise.get(e.slug) ?? null,
```

- [ ] **Step 4: Bump the cache key**

In `src/db.js`, change line 9 so a cache written by the previous version is not reused under the new shape:

```js
const CACHE_KEY = 'emom.programme.v2';
```

- [ ] **Step 5: Run the full suite**

Run: `pnpm test`
Expected: PASS, 78 tests.

- [ ] **Step 6: Commit**

```bash
git add src/model.js src/model.test.js src/db.js
git commit -m "feat: carry the archived flag through the programme shape"
```

---

### Task 6: Structural write functions

**Files:**
- Modify: `src/db.js`

**Interfaces:**
- Consumes: `supabase` client already exported from `src/db.js`.
- Produces, all `async`, all throwing the Supabase error on failure (callers catch and surface):
  - `createExercise({ slug, movement, name, type, rounds, unilateral })`
  - `updateExercise(slug, fields)` — `fields` is any subset of `{ name, movement, type, rounds, unilateral }`
  - `setExerciseArchived(slug, archived)`
  - `deleteExercise(slug)`
  - `createWorkout({ id, title, day, rounds, position })`
  - `updateWorkout(id, fields)` — subset of `{ title, day, rounds }`
  - `deleteWorkout(id)`
  - `saveWorkoutSlots(workoutId, slots)` — `slots` is `[{ exercise_slug, side }]` in display order

- [ ] **Step 1: Add the write functions**

Append to `src/db.js`:

```js
// --- Structural writes ------------------------------------------------------
// Phase 2. Migration 0008 re-granted insert/update/delete on these three
// tables; before it, they were select-only and every structural change was
// dashboard SQL. The invariant triggers from 0001/0002 still police every one
// of these writes, so a rejection here is expected behaviour, not a bug — the
// callers surface the message rather than swallowing it.

function throwIf(error) {
  if (error) throw error;
}

export async function createExercise({ slug, movement, name, type, rounds, unilateral }) {
  const { error } = await supabase.from('exercises').insert({
    slug,
    movement,
    name,
    type,
    // ramp_rounds_present (0001) requires rounds to be null for every kind
    // except ramp_up, so an empty form field must become null, not 0.
    rounds: type === 'ramp_up' ? rounds : null,
    unilateral,
  });
  throwIf(error);
}

export async function updateExercise(slug, fields) {
  const { error } = await supabase.from('exercises').update(fields).eq('slug', slug);
  throwIf(error);
}

export async function setExerciseArchived(slug, archived) {
  const { error } = await supabase.from('exercises').update({ archived }).eq('slug', slug);
  throwIf(error);
}

// Only ever succeeds for an exercise with no prescriptions and no slots: both
// foreign keys are `on delete restrict`. canHardDelete() in structure.js is
// the pre-check that keeps this from being offered when it cannot work.
export async function deleteExercise(slug) {
  const { error } = await supabase.from('exercises').delete().eq('slug', slug);
  throwIf(error);
}

export async function createWorkout({ id, title, day, rounds, position }) {
  const { error } = await supabase.from('workouts').insert({ id, title, day, rounds, position });
  throwIf(error);
}

export async function updateWorkout(id, fields) {
  const { error } = await supabase.from('workouts').update(fields).eq('id', id);
  throwIf(error);
}

// workout_slots cascades; exercises and their prescriptions do not.
export async function deleteWorkout(id) {
  const { error } = await supabase.from('workouts').delete().eq('id', id);
  throwIf(error);
}

// The one RPC in the app. A slot rewrite is a delete plus an insert, and over
// the REST layer those would be two requests with no transaction between them
// — a failure after the delete would leave the workout with no slots at all.
// save_workout_slots (migration 0010) runs both inside one function body, so
// they commit together or not at all. Positions are renumbered from array
// order server-side; send the list in display order and nothing else.
export async function saveWorkoutSlots(workoutId, slots) {
  const { error } = await supabase.rpc('save_workout_slots', {
    p_workout_id: workoutId,
    p_slots: slots.map((s) => ({ exercise_slug: s.exercise_slug, side: s.side ?? null })),
  });
  throwIf(error);
}
```

- [ ] **Step 2: Verify the module still parses and the suite is unaffected**

Run: `pnpm test && pnpm build`
Expected: 78 tests pass; build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/db.js
git commit -m "feat: add structural write functions to db"
```

---

### Task 7: App-level wiring for the library view and stale flag

**Files:**
- Modify: `src/App.jsx`

**Interfaces:**
- Consumes: nothing new.
- Produces: a `library` value for the `view` signal; a `stale` boolean passed to `ScheduleView` and `DetailView`; `onEditingBlocked` semantics are handled by each view reading `props.stale`.

- [ ] **Step 1: Add the library view and stale plumbing**

In `src/App.jsx`:

1. Add the import alongside the other views:

```js
import ExerciseLibraryView from './views/ExerciseLibraryView.jsx';
```

2. Change the `view` signal comment and add a helper below `selectedWorkout` (line 30):

```js
  const [view, setView] = createSignal('schedule'); // 'schedule' | 'detail' | 'active' | 'library'
```

```js
  // Structural editing reads the current slot set, changes it, and writes the
  // whole set back. Doing that from a cached copy can silently undo a change
  // made elsewhere, so the editors are closed while the data is known stale.
  // Prescription writes are append-only and carry no such hazard, which is why
  // they stay available.
  const stale = () => Boolean(data()?.stale);
```

3. Pass `stale` and the library entry point to `ScheduleView`:

```js
        <Match when={data() && view() === 'schedule'}>
          <ScheduleView
            workouts={workouts()}
            stale={stale()}
            onSelect={selectWorkout}
            onNewWorkout={() => setView('library')}
            onOpenLibrary={() => setView('library')}
          />
        </Match>
```

  Replace `onNewWorkout` with the real handler in Task 8; for now both point at the library so the app stays runnable.

4. Pass `stale` to `DetailView`, keeping every existing prop:

```js
        <Match when={data() && view() === 'detail'}>
          <DetailView
            workout={selectedWorkout()}
            workouts={workouts()}
            stale={stale()}
            onStart={startWorkout}
            onBack={() => setView('schedule')}
            onSaved={refetch}
            onError={(m) => setToast(m)}
          />
        </Match>
```

5. Add the library match after the active match:

```js
        <Match when={data() && view() === 'library'}>
          <ExerciseLibraryView
            programme={data().programme}
            workouts={workouts()}
            stale={stale()}
            onBack={() => setView('schedule')}
            onSaved={refetch}
            onError={(m) => setToast(m)}
          />
        </Match>
```

- [ ] **Step 2: Create a placeholder library view so the build passes**

Create `src/views/ExerciseLibraryView.jsx` with a minimal shell. Task 12 fills it in.

```js
// Filled in by Task 12. This shell exists so App.jsx compiles from Task 7 on.
export default function ExerciseLibraryView(props) {
  return (
    <div class="library-view">
      <button class="back-btn" onClick={props.onBack}>← Back</button>
    </div>
  );
}
```

- [ ] **Step 3: Verify**

Run: `pnpm build && pnpm test`
Expected: build succeeds, 78 tests pass.

- [ ] **Step 4: Commit**

```bash
git add src/App.jsx src/views/ExerciseLibraryView.jsx
git commit -m "feat: wire the exercise library view and stale flag into App"
```

---

### Task 8: Schedule entry points

**Files:**
- Modify: `src/views/ScheduleView.jsx`
- Modify: `src/App.jsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `WorkoutFormSheet` does not exist yet — this task adds the button and an `onNewWorkout` callback that `App.jsx` fulfils in Task 9. For this task `onNewWorkout` opens nothing; wire the button to the prop and leave the prop pointing at a no-op in `App.jsx`.
- Produces: `ScheduleView` props gain `stale: boolean`, `onNewWorkout: () => void`, `onOpenLibrary: () => void`.

- [ ] **Step 1: Add the entry points**

In `src/views/ScheduleView.jsx`, change the component signature. **Stop destructuring** — this view now reads props that change while it is mounted (`stale` flips on a refetch):

```js
export default function ScheduleView(props) {
  const byDay = (key) => props.workouts.filter((w) => w.day === key);
  const scheduledDays = () => DAYS.filter((d) => byDay(d.key).length > 0);
  const unassigned = () => props.workouts.filter((w) => !w.day);
```

Update the two `WorkoutCard` usages to `onSelect={props.onSelect}`.

Then insert the structural actions directly above the sign-out button:

```js
        <div class="schedule-actions">
          <button
            class="secondary-btn"
            disabled={props.stale}
            onClick={() => props.onNewWorkout()}
          >
            + New workout
          </button>
          <button
            class="secondary-btn"
            disabled={props.stale}
            onClick={() => props.onOpenLibrary()}
          >
            Exercises
          </button>
        </div>

        <Show when={props.stale}>
          <p class="schedule-stale-note">
            Editing is unavailable while showing saved data.
          </p>
        </Show>
```

- [ ] **Step 2: Add the styles**

Append to `src/index.css`:

```css
.schedule-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 2rem;
}

.secondary-btn {
  flex: 1;
  padding: 0.85rem 1rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 12px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.95rem;
  cursor: pointer;
}

.secondary-btn:disabled {
  opacity: 0.4;
  cursor: default;
}

.schedule-stale-note {
  margin-top: 0.75rem;
  font-size: 0.8rem;
  opacity: 0.6;
  text-align: center;
}
```

- [ ] **Step 3: Point `onNewWorkout` at a no-op for now**

In `src/App.jsx`, change the `ScheduleView` usage so the two callbacks are distinct:

```js
            onNewWorkout={() => {}}
            onOpenLibrary={() => setView('library')}
```

- [ ] **Step 4: Verify**

Run: `pnpm build && pnpm test`
Expected: build succeeds, 78 tests pass.

Manual check (`pnpm run dev`): the schedule screen shows "+ New workout" and "Exercises" above Sign out; "Exercises" opens the (empty) library screen and Back returns.

- [ ] **Step 5: Commit**

```bash
git add src/views/ScheduleView.jsx src/App.jsx src/index.css
git commit -m "feat: add structural entry points to the schedule screen"
```

---

### Task 9: Workout form sheet

Create, rename, re-day, re-round and delete a workout.

**Files:**
- Create: `src/views/WorkoutFormSheet.jsx`
- Modify: `src/App.jsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `workoutFormError`, `deriveSlug`, `nextPosition`, `DAY_KEYS` from `src/structure.js`; `createWorkout`, `updateWorkout`, `deleteWorkout` from `src/db.js`.
- Produces: `WorkoutFormSheet` with props `{ workout: object|null, workouts: array, onClose, onSaved, onDeleted }`. A `null` workout means create.

- [ ] **Step 1: Write the sheet**

Create `src/views/WorkoutFormSheet.jsx`:

```js
import { createSignal, For, Show } from 'solid-js';
import { createWorkout, updateWorkout, deleteWorkout } from '../db.js';
import { workoutFormError, deriveSlug, nextPosition, DAY_KEYS } from '../structure.js';

const DAY_LABELS = {
  monday: 'Monday',
  tuesday: 'Tuesday',
  wednesday: 'Wednesday',
  thursday: 'Thursday',
  friday: 'Friday',
  saturday: 'Saturday',
  sunday: 'Sunday',
};

// Create or edit a workout's own fields. Its slots are edited on the detail
// screen, not here — the two have different failure modes and different save
// paths, and merging them would put a destructive round-count change behind
// the same button as a harmless reorder.
export default function WorkoutFormSheet(props) {
  const existing = props.workout;
  const isNew = !existing;

  const [title, setTitle] = createSignal(existing?.title ?? '');
  const [day, setDay] = createSignal(existing?.day ?? '');
  const [rounds, setRounds] = createSignal(String(existing?.rounds ?? ''));
  // Auto-derived while creating so a phone user never types it, but still
  // shown and overridable: the id is a permanent primary key.
  const [id, setId] = createSignal(existing?.id ?? '');
  const [idTouched, setIdTouched] = createSignal(!isNew);
  const [formError, setFormError] = createSignal(null);
  const [confirmingDelete, setConfirmingDelete] = createSignal(false);
  const [busy, setBusy] = createSignal(false);

  function changeTitle(value) {
    setTitle(value);
    if (isNew && !idTouched()) setId(deriveSlug(value));
  }

  const validationError = () =>
    workoutFormError({
      id: id(),
      title: title(),
      day: day() === '' ? null : day(),
      rounds: rounds(),
      existingIds: props.workouts.map((w) => w.id),
      isNew,
    });

  async function save() {
    const error = validationError();
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    setBusy(true);
    try {
      const fields = {
        title: title().trim(),
        day: day() === '' ? null : day(),
        rounds: Number(rounds()),
      };
      if (isNew) {
        await createWorkout({
          id: id().trim(),
          ...fields,
          position: nextPosition(props.workouts),
        });
      } else {
        await updateWorkout(existing.id, fields);
      }
      props.onSaved();
      props.onClose();
    } catch (e) {
      // A round-count change on a workout holding a ramp exercise is rejected
      // by check_workout_rounds (0001). Its message names the exercise and
      // both counts, so show it rather than a generic failure.
      setFormError(e.message ?? 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await deleteWorkout(existing.id);
      props.onDeleted();
      props.onClose();
    } catch (e) {
      setFormError(e.message ?? 'Could not delete. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="edit-sheet-backdrop" onClick={props.onClose}>
      <div class="edit-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 class="edit-sheet-title">{isNew ? 'New workout' : 'Edit workout'}</h2>

        <div class="edit-field">
          <label for="workout-title">Title</label>
          <input
            id="workout-title"
            type="text"
            autocomplete="off"
            value={title()}
            onInput={(e) => changeTitle(e.currentTarget.value)}
          />
        </div>

        <Show when={isNew}>
          <div class="edit-field">
            <label for="workout-id">Identifier</label>
            <input
              id="workout-id"
              type="text"
              autocomplete="off"
              value={id()}
              onInput={(e) => {
                setIdTouched(true);
                setId(e.currentTarget.value);
              }}
            />
            <p class="edit-hint">Permanent once saved.</p>
          </div>
        </Show>

        <div class="edit-field">
          <label for="workout-day">Day</label>
          <select id="workout-day" value={day()} onInput={(e) => setDay(e.currentTarget.value)}>
            <option value="">Unassigned</option>
            <For each={DAY_KEYS}>
              {(key) => <option value={key}>{DAY_LABELS[key]}</option>}
            </For>
          </select>
        </div>

        <div class="edit-field">
          <label for="workout-rounds">Rounds</label>
          <input
            id="workout-rounds"
            type="text"
            inputmode="numeric"
            autocomplete="off"
            value={rounds()}
            onInput={(e) => setRounds(e.currentTarget.value)}
          />
        </div>

        <Show when={formError()}>
          <p class="edit-error" role="alert">{formError()}</p>
        </Show>

        <div class="edit-actions">
          <button class="edit-cancel-btn" onClick={props.onClose} disabled={busy()}>
            Cancel
          </button>
          <button class="edit-save-btn" onClick={save} disabled={busy()}>
            {busy() ? 'Saving…' : 'Save'}
          </button>
        </div>

        <Show when={!isNew}>
          <Show
            when={confirmingDelete()}
            fallback={
              <button class="danger-btn" onClick={() => setConfirmingDelete(true)} disabled={busy()}>
                Delete workout
              </button>
            }
          >
            <p class="edit-warning">
              Delete “{existing.title}” and its {existing.slots.length} slots? The exercises and
              their history are not affected.
            </p>
            <div class="edit-actions">
              <button class="edit-cancel-btn" onClick={() => setConfirmingDelete(false)} disabled={busy()}>
                Keep
              </button>
              <button class="danger-btn" onClick={remove} disabled={busy()}>
                {busy() ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </Show>
        </Show>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the styles**

Append to `src/index.css`:

```css
.edit-field select,
.edit-field input[type='text'] {
  width: 100%;
  padding: 0.7rem 0.8rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  font: inherit;
}

.edit-hint {
  margin-top: 0.35rem;
  font-size: 0.75rem;
  opacity: 0.55;
}

.edit-warning {
  margin-top: 1rem;
  font-size: 0.85rem;
  line-height: 1.5;
}

.danger-btn {
  width: 100%;
  margin-top: 1rem;
  padding: 0.8rem 1rem;
  border: 1px solid rgba(255, 90, 90, 0.5);
  border-radius: 12px;
  background: transparent;
  color: #ff7a7a;
  font: inherit;
  cursor: pointer;
}

.danger-btn:disabled {
  opacity: 0.4;
  cursor: default;
}
```

- [ ] **Step 3: Open the sheet from the schedule**

In `src/App.jsx`, add the import, a signal, and the sheet:

```js
import WorkoutFormSheet from './views/WorkoutFormSheet.jsx';
```

```js
  const [workoutForm, setWorkoutForm] = createSignal(null); // null | { workout: object|null }
```

Change the `ScheduleView` callback:

```js
            onNewWorkout={() => setWorkoutForm({ workout: null })}
```

And render the sheet just above `<Toast .../>`:

```js
      <Show when={workoutForm()} keyed>
        {(form) => (
          <WorkoutFormSheet
            workout={form.workout}
            workouts={workouts()}
            onClose={() => setWorkoutForm(null)}
            onSaved={refetch}
            onDeleted={() => {
              setView('schedule');
              refetch();
            }}
          />
        )}
      </Show>
```

`Show` is already imported in `App.jsx`; confirm `keyed` is used so the sheet re-seeds its form state when switching between workouts.

- [ ] **Step 4: Verify**

Run: `pnpm build && pnpm test`
Expected: build succeeds, 78 tests pass.

Manual check (after the user has applied migrations 0008–0010): "+ New workout" opens the sheet, typing a title fills the identifier, saving adds a workout to the schedule.

- [ ] **Step 5: Commit**

```bash
git add src/views/WorkoutFormSheet.jsx src/App.jsx src/index.css
git commit -m "feat: add the workout form sheet"
```

---

### Task 10: Detail view edit mode

The slot editor. Changes are held in a local draft and written once, atomically, on Save — so an intermediate reorder never reaches the database.

**Files:**
- Modify: `src/views/DetailView.jsx`
- Modify: `src/App.jsx`
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `moveItem`, `sideWarnings` from `src/structure.js`; `saveWorkoutSlots` from `src/db.js`; `describeSlot` from `src/render.js`.
- Produces: `DetailView` props gain `stale: boolean` and `onEditWorkout: (workout) => void`. Task 11 adds `AddSlotSheet` into the edit-mode block.

- [ ] **Step 1: Add edit mode to DetailView**

Rewrite `src/views/DetailView.jsx`:

```js
import { createSignal, For, Show } from 'solid-js';
import { describeSlot } from '../render.js';
import { validateWorkout } from '../model.js';
import { moveItem, sideWarnings } from '../structure.js';
import { saveWorkoutSlots } from '../db.js';
import ExerciseLine from '../components/ExerciseLine.jsx';
import EditSlotSheet from './EditSlotSheet.jsx';
import AddSlotSheet from './AddSlotSheet.jsx';

export default function DetailView(props) {
  const problems = () => validateWorkout(props.workout);
  const [editingSlot, setEditingSlot] = createSignal(null);

  // Structural edit mode. `draft` is null when off; when on it holds the slot
  // list being rearranged. Nothing reaches the database until Save, so an
  // intermediate ordering — which would violate nothing, but would be a
  // pointless write — never leaves the device.
  const [draft, setDraft] = createSignal(null);
  const [addingSlot, setAddingSlot] = createSignal(false);
  const [editError, setEditError] = createSignal(null);
  const [busy, setBusy] = createSignal(false);

  const isEditable = (slot) => Boolean(slot.exercise) && slot.exercise.type !== 'plain';

  function editSlot(slot) {
    if (!isEditable(slot)) return;
    setEditingSlot(slot);
  }

  function enterEditMode() {
    setEditError(null);
    setDraft(props.workout.slots.map((s) => ({ ...s })));
  }

  function cancelEdit() {
    setDraft(null);
    setAddingSlot(false);
    setEditError(null);
  }

  function move(index, delta) {
    setDraft((current) => moveItem(current, index, delta));
  }

  function removeAt(index) {
    setDraft((current) => current.filter((_, i) => i !== index));
  }

  function addSlot(slot) {
    setDraft((current) => [...current, slot]);
    setAddingSlot(false);
  }

  function cycleSide(index) {
    setDraft((current) =>
      current.map((s, i) =>
        i === index ? { ...s, side: s.side === 'alternating' ? 'per_round' : 'alternating' } : s
      )
    );
  }

  // Warnings are computed against the draft, so the odd-round note appears as
  // soon as a per_round slot is added — before the save, when it can still be
  // reconsidered.
  const draftWarnings = () =>
    draft()
      ? sideWarnings({ rounds: props.workout.rounds, slots: draft() })
      : sideWarnings(props.workout);

  async function saveSlots() {
    setBusy(true);
    setEditError(null);
    try {
      await saveWorkoutSlots(
        props.workout.id,
        draft().map((s) => ({ exercise_slug: s.exercise.slug, side: s.side }))
      );
      props.onSaved();
      setDraft(null);
    } catch (e) {
      // save_workout_slots is atomic: a failure here means nothing changed,
      // so the draft is still exactly what the user intended and stays open
      // for retry.
      setEditError(e.message ?? 'Could not save. Nothing was changed — try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="detail-view">
      <button class="back-btn" onClick={props.onBack}>← Back</button>

      <div class="detail-content">
        <h1 class="detail-title">{props.workout.title}</h1>

        <div class="detail-stats">
          <div class="stat-block">
            <span class="stat-value">{props.workout.minutes}</span>
            <span class="stat-label">minutes</span>
          </div>
          <div class="stat-divider" />
          <div class="stat-block">
            <span class="stat-value">{props.workout.slots.length}</span>
            <span class="stat-label">exercises</span>
          </div>
          <div class="stat-divider" />
          <div class="stat-block">
            <span class="stat-value">{props.workout.rounds}</span>
            <span class="stat-label">rounds</span>
          </div>
        </div>

        <Show
          when={draft()}
          fallback={
            <>
              <ul class="exercise-list">
                <For each={props.workout.slots}>
                  {(slot, i) => (
                    <li
                      class="exercise-item"
                      classList={{ 'exercise-item-tappable': isEditable(slot) }}
                      onClick={() => editSlot(slot)}
                    >
                      <span class="exercise-num">{String(i() + 1).padStart(2, '0')}</span>
                      <span class="exercise-name">
                        <ExerciseLine parts={describeSlot(slot, null)} />
                      </span>
                      <span class="exercise-duration">1 min</span>
                    </li>
                  )}
                </For>
              </ul>

              <For each={draftWarnings()}>
                {(w) => <p class="slot-warning">{w}</p>}
              </For>

              <Show
                when={problems().length === 0}
                fallback={
                  <div class="validation-panel" role="alert">
                    <p class="validation-panel-title">This workout can't be started</p>
                    <ul class="validation-panel-list">
                      <For each={problems()}>{(p) => <li>{p}</li>}</For>
                    </ul>
                  </div>
                }
              >
                <button class="start-btn" onClick={props.onStart}>
                  Start Workout
                </button>
              </Show>

              <div class="detail-edit-actions">
                <button
                  class="secondary-btn"
                  disabled={props.stale}
                  onClick={enterEditMode}
                >
                  Edit exercises
                </button>
                <button
                  class="secondary-btn"
                  disabled={props.stale}
                  onClick={() => props.onEditWorkout(props.workout)}
                >
                  Workout settings
                </button>
              </div>

              <Show when={props.stale}>
                <p class="schedule-stale-note">
                  Editing is unavailable while showing saved data.
                </p>
              </Show>
            </>
          }
        >
          <ul class="exercise-list exercise-list-editing">
            <For each={draft()}>
              {(slot, i) => (
                <li class="exercise-item exercise-item-editing">
                  <div class="slot-move">
                    <button
                      class="slot-move-btn"
                      aria-label="Move up"
                      disabled={i() === 0}
                      onClick={() => move(i(), -1)}
                    >
                      ↑
                    </button>
                    <button
                      class="slot-move-btn"
                      aria-label="Move down"
                      disabled={i() === draft().length - 1}
                      onClick={() => move(i(), 1)}
                    >
                      ↓
                    </button>
                  </div>
                  <span class="exercise-name">
                    <ExerciseLine parts={describeSlot(slot, null)} />
                  </span>
                  <Show when={slot.exercise.unilateral}>
                    <button class="slot-side-btn" onClick={() => cycleSide(i())}>
                      {slot.side === 'per_round' ? 'per round' : 'both sides'}
                    </button>
                  </Show>
                  <button
                    class="slot-remove-btn"
                    aria-label={`Remove ${slot.exercise.name}`}
                    onClick={() => removeAt(i())}
                  >
                    ✕
                  </button>
                </li>
              )}
            </For>
          </ul>

          <button class="secondary-btn" onClick={() => setAddingSlot(true)}>
            + Add exercise
          </button>

          <For each={draftWarnings()}>
            {(w) => <p class="slot-warning">{w}</p>}
          </For>

          <Show when={editError()}>
            <p class="edit-error" role="alert">{editError()}</p>
          </Show>

          <div class="edit-actions">
            <button class="edit-cancel-btn" onClick={cancelEdit} disabled={busy()}>
              Cancel
            </button>
            <button class="edit-save-btn" onClick={saveSlots} disabled={busy()}>
              {busy() ? 'Saving…' : 'Save order'}
            </button>
          </div>

          <Show when={addingSlot()}>
            <AddSlotSheet
              workout={props.workout}
              exercises={props.exercises}
              onAdd={addSlot}
              onClose={() => setAddingSlot(false)}
            />
          </Show>
        </Show>
      </div>

      <Show when={editingSlot()} keyed>
        {(slot) => (
          <EditSlotSheet
            slot={slot}
            workouts={props.workouts}
            onClose={() => setEditingSlot(null)}
            onSaved={props.onSaved}
            onError={props.onError}
          />
        )}
      </Show>
    </div>
  );
}
```

- [ ] **Step 2: Add the styles**

Append to `src/index.css`:

```css
.detail-edit-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 1.25rem;
}

.exercise-item-editing {
  display: flex;
  align-items: center;
  gap: 0.6rem;
}

.slot-move {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}

.slot-move-btn {
  width: 2rem;
  height: 1.5rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: 0.8rem;
  line-height: 1;
  cursor: pointer;
}

.slot-move-btn:disabled {
  opacity: 0.25;
  cursor: default;
}

.slot-side-btn {
  padding: 0.3rem 0.6rem;
  border: 1px solid rgba(255, 255, 255, 0.18);
  border-radius: 999px;
  background: transparent;
  color: inherit;
  font: inherit;
  font-size: 0.75rem;
  white-space: nowrap;
  cursor: pointer;
}

.slot-remove-btn {
  width: 2rem;
  height: 2rem;
  border: none;
  border-radius: 8px;
  background: transparent;
  color: #ff7a7a;
  font-size: 1rem;
  cursor: pointer;
}

.slot-warning {
  margin-top: 0.75rem;
  padding: 0.6rem 0.8rem;
  border-left: 3px solid #e0b341;
  font-size: 0.82rem;
  line-height: 1.5;
  opacity: 0.9;
}
```

- [ ] **Step 3: Pass the new props from App**

In `src/App.jsx`, add `exercises` and `onEditWorkout` to the `DetailView` usage:

```js
          <DetailView
            workout={selectedWorkout()}
            workouts={workouts()}
            exercises={data().programme.exercises}
            stale={stale()}
            onStart={startWorkout}
            onBack={() => setView('schedule')}
            onEditWorkout={(w) => setWorkoutForm({ workout: w })}
            onSaved={refetch}
            onError={(m) => setToast(m)}
          />
```

- [ ] **Step 4: Verify**

Run: `pnpm build && pnpm test`
Expected: build succeeds after Task 11 creates `AddSlotSheet.jsx`. **If `AddSlotSheet` does not exist yet, create it as a one-line shell now** and let Task 11 replace it:

```js
export default function AddSlotSheet(props) {
  return null; // Task 11
}
```

Manual check: "Edit exercises" switches the list to edit mode with ↑↓ and ✕ per row; Cancel restores the normal list unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/views/DetailView.jsx src/views/AddSlotSheet.jsx src/App.jsx src/index.css
git commit -m "feat: add structural edit mode to the workout detail screen"
```

---

### Task 11: Add-slot sheet

**Files:**
- Modify: `src/views/AddSlotSheet.jsx` (replacing the Task 10 shell)
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `eligibleExercises`, `defaultSide` from `src/structure.js`.
- Produces: `AddSlotSheet` with props `{ workout, exercises, onAdd, onClose }`. `onAdd` receives a slot object shaped like the ones in `workout.slots`: `{ position: null, side, exercise }` — `position` is unused because `save_workout_slots` renumbers from array order.

- [ ] **Step 1: Write the sheet**

Replace `src/views/AddSlotSheet.jsx`:

```js
import { For, Show } from 'solid-js';
import { eligibleExercises, defaultSide } from '../structure.js';
import { describeSlot } from '../render.js';
import ExerciseLine from '../components/ExerciseLine.jsx';

// The picker only ever lists exercises this workout can legally hold:
// eligibleExercises drops archived ones and any ramp whose round count differs
// from the workout's, which check_slot_shape (0001) would reject anyway. An
// offered-then-rejected choice is worse than one never offered.
export default function AddSlotSheet(props) {
  const choices = () => eligibleExercises(props.exercises, props.workout);

  function pick(exercise) {
    props.onAdd({
      position: null,
      side: defaultSide(exercise),
      exercise,
    });
  }

  return (
    <div class="edit-sheet-backdrop" onClick={props.onClose}>
      <div class="edit-sheet" onClick={(e) => e.stopPropagation()}>
        <h2 class="edit-sheet-title">Add exercise</h2>

        <Show
          when={choices().length > 0}
          fallback={
            <p class="edit-hint">
              No exercise fits a {props.workout.rounds}-round workout yet. Ramp-up exercises
              only fit a workout with the same round count.
            </p>
          }
        >
          <ul class="picker-list">
            <For each={choices()}>
              {(exercise) => (
                <li>
                  <button class="picker-item" onClick={() => pick(exercise)}>
                    <ExerciseLine
                      parts={describeSlot({ side: defaultSide(exercise), exercise }, null)}
                    />
                  </button>
                </li>
              )}
            </For>
          </ul>
        </Show>

        <div class="edit-actions">
          <button class="edit-cancel-btn" onClick={props.onClose}>Cancel</button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the styles**

Append to `src/index.css`:

```css
.picker-list {
  max-height: 50vh;
  overflow-y: auto;
  margin: 0;
  padding: 0;
  list-style: none;
}

.picker-item {
  width: 100%;
  padding: 0.75rem 0.5rem;
  border: none;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  background: transparent;
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
}
```

- [ ] **Step 3: Verify**

Run: `pnpm build && pnpm test`
Expected: build succeeds, 78 tests pass.

Manual check: in edit mode, "+ Add exercise" lists exercises; a 3-round ramp does not appear in a 4-round workout; picking one appends it to the list; a unilateral pick arrives showing "both sides".

- [ ] **Step 4: Commit**

```bash
git add src/views/AddSlotSheet.jsx src/index.css
git commit -m "feat: add the slot exercise picker"
```

---

### Task 12: Exercise library view

**Files:**
- Modify: `src/views/ExerciseLibraryView.jsx` (replacing the Task 7 shell)
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `usedByWorkouts`, `canHardDelete` from `src/structure.js`; `setExerciseArchived`, `deleteExercise` from `src/db.js`.
- Produces: `ExerciseLibraryView` with props `{ programme, workouts, stale, onBack, onSaved, onError }`. Task 13 adds the form sheet it opens.

- [ ] **Step 1: Write the view**

Replace `src/views/ExerciseLibraryView.jsx`:

```js
import { createSignal, createMemo, For, Show } from 'solid-js';
import { usedByWorkouts, canHardDelete } from '../structure.js';
import { setExerciseArchived, deleteExercise } from '../db.js';
import ExerciseFormSheet from './ExerciseFormSheet.jsx';

const TYPE_LABELS = {
  ramp_up: 'Ramp',
  rep_range: 'Rep range',
  fixed: 'Fixed',
  plain: 'No numbers',
};

export default function ExerciseLibraryView(props) {
  const [showArchived, setShowArchived] = createSignal(false);
  const [form, setForm] = createSignal(null); // null | { exercise, mode }
  const [busySlug, setBusySlug] = createSignal(null);

  const all = createMemo(() =>
    Object.values(props.programme.exercises).sort((a, b) => a.name.localeCompare(b.name))
  );

  const visible = () => (showArchived() ? all() : all().filter((e) => !e.archived));

  async function toggleArchived(exercise) {
    // Archiving an exercise a workout still uses would leave that workout
    // holding something the picker claims does not exist. Refuse with the
    // blockers named, matching how deletion behaves.
    const blockers = usedByWorkouts(exercise.slug, props.workouts);
    if (!exercise.archived && blockers.length > 0) {
      props.onError(`${exercise.name} is still used by ${blockers.join(', ')}.`);
      return;
    }

    setBusySlug(exercise.slug);
    try {
      await setExerciseArchived(exercise.slug, !exercise.archived);
      props.onSaved();
    } catch (e) {
      props.onError(e.message ?? 'Could not save. Try again.');
    } finally {
      setBusySlug(null);
    }
  }

  async function remove(exercise) {
    const blockers = usedByWorkouts(exercise.slug, props.workouts);
    if (blockers.length > 0) {
      props.onError(`${exercise.name} is still used by ${blockers.join(', ')}.`);
      return;
    }
    if (exercise.prescription) {
      props.onError(
        `${exercise.name} has recorded history, so it can't be deleted. Archive it instead.`
      );
      return;
    }

    setBusySlug(exercise.slug);
    try {
      await deleteExercise(exercise.slug);
      props.onSaved();
    } catch (e) {
      props.onError(e.message ?? 'Could not delete. Try again.');
    } finally {
      setBusySlug(null);
    }
  }

  return (
    <div class="library-view">
      <button class="back-btn" onClick={props.onBack}>← Back</button>

      <div class="detail-content">
        <h1 class="detail-title">Exercises</h1>

        <div class="library-controls">
          <button
            class="secondary-btn"
            disabled={props.stale}
            onClick={() => setForm({ exercise: null, mode: 'create' })}
          >
            + New exercise
          </button>
          <label class="library-toggle">
            <input
              type="checkbox"
              checked={showArchived()}
              onInput={(e) => setShowArchived(e.currentTarget.checked)}
            />
            Show archived
          </label>
        </div>

        <Show when={props.stale}>
          <p class="schedule-stale-note">Editing is unavailable while showing saved data.</p>
        </Show>

        <ul class="library-list">
          <For each={visible()}>
            {(exercise) => (
              <li class="library-item" classList={{ 'library-item-archived': exercise.archived }}>
                <div class="library-item-main">
                  <span class="library-item-name">{exercise.name}</span>
                  <span class="library-item-meta">
                    {TYPE_LABELS[exercise.type]}
                    <Show when={exercise.type === 'ramp_up'}> · {exercise.rounds} rounds</Show>
                    <Show when={exercise.unilateral}> · one side at a time</Show>
                  </span>
                  <Show when={usedByWorkouts(exercise.slug, props.workouts).length > 0}>
                    <span class="library-item-used">
                      {usedByWorkouts(exercise.slug, props.workouts).join(', ')}
                    </span>
                  </Show>
                </div>

                <div class="library-item-actions">
                  <button
                    class="secondary-btn"
                    disabled={props.stale || busySlug() === exercise.slug}
                    onClick={() => setForm({ exercise, mode: 'edit' })}
                  >
                    Edit
                  </button>
                  <button
                    class="secondary-btn"
                    disabled={props.stale || busySlug() === exercise.slug}
                    onClick={() => toggleArchived(exercise)}
                  >
                    {exercise.archived ? 'Restore' : 'Archive'}
                  </button>
                  <Show when={canHardDelete(exercise, props.workouts)}>
                    <button
                      class="danger-btn danger-btn-inline"
                      disabled={props.stale || busySlug() === exercise.slug}
                      onClick={() => remove(exercise)}
                    >
                      Delete
                    </button>
                  </Show>
                </div>
              </li>
            )}
          </For>
        </ul>
      </div>

      <Show when={form()} keyed>
        {(state) => (
          <ExerciseFormSheet
            exercise={state.exercise}
            mode={state.mode}
            programme={props.programme}
            workouts={props.workouts}
            onClose={() => setForm(null)}
            onSaved={props.onSaved}
          />
        )}
      </Show>
    </div>
  );
}
```

- [ ] **Step 2: Add the styles**

Append to `src/index.css`:

```css
.library-view {
  min-height: 100%;
}

.library-controls {
  display: flex;
  align-items: center;
  gap: 1rem;
  margin: 1rem 0 1.5rem;
}

.library-toggle {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  opacity: 0.75;
  white-space: nowrap;
}

.library-list {
  margin: 0;
  padding: 0;
  list-style: none;
}

.library-item {
  display: flex;
  flex-wrap: wrap;
  gap: 0.75rem;
  align-items: flex-start;
  justify-content: space-between;
  padding: 0.9rem 0;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.library-item-archived {
  opacity: 0.45;
}

.library-item-main {
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
  min-width: 0;
}

.library-item-name {
  font-size: 1rem;
}

.library-item-meta,
.library-item-used {
  font-size: 0.75rem;
  opacity: 0.6;
}

.library-item-actions {
  display: flex;
  gap: 0.4rem;
  flex-wrap: wrap;
}

.library-item-actions .secondary-btn,
.danger-btn-inline {
  flex: 0 0 auto;
  width: auto;
  margin-top: 0;
  padding: 0.4rem 0.7rem;
  font-size: 0.8rem;
}
```

- [ ] **Step 3: Verify**

Run: `pnpm build && pnpm test`
Expected: build succeeds after Task 13 creates `ExerciseFormSheet.jsx`. **Create a shell now if it does not exist:**

```js
export default function ExerciseFormSheet(props) {
  return null; // Task 13
}
```

Manual check: "Exercises" lists all 18 seeded exercises with kind and the workouts using them; Delete is offered only where nothing references the exercise; archiving an in-use exercise shows a toast naming the workouts.

- [ ] **Step 4: Commit**

```bash
git add src/views/ExerciseLibraryView.jsx src/views/ExerciseFormSheet.jsx src/index.css
git commit -m "feat: add the exercise library view"
```

---

### Task 13: Exercise form sheet with duplicate flow

Create, edit and duplicate an exercise, including its opening prescription.

**Files:**
- Modify: `src/views/ExerciseFormSheet.jsx` (replacing the Task 12 shell)
- Modify: `src/index.css`

**Interfaces:**
- Consumes: `exerciseFormError`, `deriveSlug`, `lockedExerciseFields`, `EXERCISE_TYPES` from `src/structure.js`; `prescriptionFormError`, `normalizeDecimal` from `src/model.js`; `createExercise`, `updateExercise` from `src/db.js`; `savePrescription` from `src/db.js`.
- Produces: `ExerciseFormSheet` with props `{ exercise, mode: 'create'|'edit'|'duplicate', programme, workouts, onClose, onSaved }`.

- [ ] **Step 1: Write the sheet**

Replace `src/views/ExerciseFormSheet.jsx`:

```js
import { createSignal, createMemo, Index, For, Show } from 'solid-js';
import { createExercise, updateExercise, savePrescription } from '../db.js';
import { prescriptionFormError, normalizeDecimal } from '../model.js';
import {
  exerciseFormError,
  deriveSlug,
  lockedExerciseFields,
  EXERCISE_TYPES,
} from '../structure.js';

const TYPE_LABELS = {
  ramp_up: 'Ramp up — one weight per round',
  rep_range: 'Rep range — min to max reps',
  fixed: 'Fixed — one rep count, one weight',
  plain: 'No numbers — Rest, Carry, Skip',
};

// Create, edit or duplicate an exercise.
//
// 'duplicate' exists because some edits have no valid statement order at all
// once data is attached: check_exercise_update (0002) re-validates every
// existing prescription and slot, so changing a ramp's round count is rejected
// whichever way round it is attempted. That is decision D4 — a different round
// count is a different exercise — and duplication is how it is honoured without
// touching the original's history. The shared `movement` keeps the old and new
// comparable on a trend line.
export default function ExerciseFormSheet(props) {
  const source = props.exercise;
  const mode = props.mode;
  const isEdit = mode === 'edit';

  const [name, setName] = createSignal(
    mode === 'duplicate' ? `${source.name} (new)` : (source?.name ?? '')
  );
  const [slug, setSlug] = createSignal(isEdit ? source.slug : '');
  const [slugTouched, setSlugTouched] = createSignal(isEdit);
  const [movement, setMovement] = createSignal(source?.movement ?? '');
  const [movementIsNew, setMovementIsNew] = createSignal(false);
  const [type, setType] = createSignal(source?.type ?? 'fixed');
  const [rounds, setRounds] = createSignal(String(source?.rounds ?? ''));
  const [unilateral, setUnilateral] = createSignal(Boolean(source?.unilateral));

  const [repsMin, setRepsMin] = createSignal(String(source?.prescription?.reps_min ?? ''));
  const [repsMax, setRepsMax] = createSignal(String(source?.prescription?.reps_max ?? ''));
  const [weights, setWeights] = createSignal(
    (source?.prescription?.weights ?? ['']).map((w) => String(w))
  );

  const [formError, setFormError] = createSignal(null);
  const [busy, setBusy] = createSignal(false);

  // Locked fields only apply while editing in place. A duplicate is a brand-new
  // row with nothing attached, so every field is free — that is the point.
  const locks = createMemo(() =>
    isEdit
      ? lockedExerciseFields(source, props.workouts)
      : { type: null, rounds: null, unilateral: null }
  );

  const movements = createMemo(() =>
    [...new Set(Object.values(props.programme.exercises).map((e) => e.movement))].sort()
  );

  const needsPrescription = () => type() !== 'plain';
  const weightCount = () => (type() === 'ramp_up' ? Math.max(1, Number(rounds()) || 1) : 1);

  function changeName(value) {
    setName(value);
    if (!slugTouched()) setSlug(deriveSlug(value));
  }

  function setWeightAt(index, value) {
    setWeights((current) => current.map((w, i) => (i === index ? value : w)));
  }

  // Keep the weight field count in step with the round count while typing, so
  // a ramp always shows exactly as many inputs as it will need rows for.
  const syncedWeights = createMemo(() => {
    const count = weightCount();
    const current = weights();
    return Array.from({ length: count }, (_, i) => current[i] ?? '');
  });

  function validate() {
    const shape = exerciseFormError({
      name: name(),
      slug: slug(),
      movement: movement(),
      type: type(),
      rounds: type() === 'ramp_up' ? rounds() : '',
      existingSlugs: Object.keys(props.programme.exercises),
      isNew: !isEdit,
    });
    if (shape) return shape;

    // A 'plain' exercise never gets a prescription — check_prescription_shape
    // raises if one is written for it.
    if (!needsPrescription()) return null;

    return prescriptionFormError({
      type: type(),
      rounds: Number(rounds()),
      repsMin: repsMin(),
      repsMax: repsMax(),
      weights: syncedWeights(),
    });
  }

  async function save() {
    const error = validate();
    if (error) {
      setFormError(error);
      return;
    }
    setFormError(null);
    setBusy(true);

    try {
      if (isEdit) {
        // Only name and movement are ever editable in place; type, rounds and
        // unilateral are locked whenever anything is attached, and when nothing
        // is attached they are still sent so an untouched new exercise can be
        // corrected.
        await updateExercise(source.slug, {
          name: name().trim(),
          movement: movement().trim(),
          ...(locks().type ? {} : { type: type() }),
          ...(locks().rounds ? {} : { rounds: type() === 'ramp_up' ? Number(rounds()) : null }),
          ...(locks().unilateral ? {} : { unilateral: unilateral() }),
        });
      } else {
        await createExercise({
          slug: slug().trim(),
          movement: movement().trim(),
          name: name().trim(),
          type: type(),
          rounds: Number(rounds()),
          unilateral: unilateral(),
        });

        // Two requests, deliberately not atomic. If the prescription insert
        // fails the exercise exists without one, which validateWorkout()
        // already reports as "has no prescription yet" and the edit sheet can
        // fix — unlike a slot rewrite, there is no state here that silently
        // breaks a workout.
        if (needsPrescription()) {
          await savePrescription({
            exercise_slug: slug().trim(),
            reps_min: Number(repsMin()),
            reps_max: Number(repsMax()),
            weights: syncedWeights().map((w) => Number(normalizeDecimal(w))),
          });
        }
      }

      props.onSaved();
      props.onClose();
    } catch (e) {
      setFormError(e.message ?? 'Could not save. Try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div class="edit-sheet-backdrop" onClick={props.onClose}>
      <div class="edit-sheet edit-sheet-tall" onClick={(e) => e.stopPropagation()}>
        <h2 class="edit-sheet-title">
          {mode === 'create' ? 'New exercise' : mode === 'duplicate' ? 'Duplicate exercise' : source.name}
        </h2>

        <Show when={mode === 'duplicate'}>
          <p class="edit-hint">
            Creates a separate exercise. “{source.name}” and its history stay exactly as they are,
            and both keep the movement “{source.movement}” so their progress stays comparable.
          </p>
        </Show>

        <div class="edit-field">
          <label for="ex-name">Name</label>
          <input
            id="ex-name"
            type="text"
            autocomplete="off"
            value={name()}
            onInput={(e) => changeName(e.currentTarget.value)}
          />
        </div>

        <Show when={!isEdit}>
          <div class="edit-field">
            <label for="ex-slug">Identifier</label>
            <input
              id="ex-slug"
              type="text"
              autocomplete="off"
              value={slug()}
              onInput={(e) => {
                setSlugTouched(true);
                setSlug(e.currentTarget.value);
              }}
            />
            <p class="edit-hint">Permanent once saved.</p>
          </div>
        </Show>

        <div class="edit-field">
          <label for="ex-movement">Movement</label>
          <Show
            when={movementIsNew()}
            fallback={
              <select
                id="ex-movement"
                value={movement()}
                onInput={(e) => {
                  if (e.currentTarget.value === '__new__') {
                    setMovementIsNew(true);
                    setMovement(slug());
                  } else {
                    setMovement(e.currentTarget.value);
                  }
                }}
              >
                <option value="">Choose…</option>
                <For each={movements()}>{(m) => <option value={m}>{m}</option>}</For>
                <option value="__new__">New movement…</option>
              </select>
            }
          >
            <input
              id="ex-movement"
              type="text"
              autocomplete="off"
              value={movement()}
              onInput={(e) => setMovement(e.currentTarget.value)}
            />
          </Show>
          <p class="edit-hint">Groups variants of the same lift so their progress lines up.</p>
        </div>

        <div class="edit-field">
          <label for="ex-type">Kind</label>
          <select
            id="ex-type"
            value={type()}
            disabled={Boolean(locks().type)}
            onInput={(e) => setType(e.currentTarget.value)}
          >
            <For each={EXERCISE_TYPES}>
              {(t) => <option value={t}>{TYPE_LABELS[t]}</option>}
            </For>
          </select>
          <Show when={locks().type}>
            <p class="edit-locked">{locks().type}</p>
          </Show>
        </div>

        <Show when={type() === 'ramp_up'}>
          <div class="edit-field">
            <label for="ex-rounds">Rounds</label>
            <input
              id="ex-rounds"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              value={rounds()}
              disabled={Boolean(locks().rounds)}
              onInput={(e) => setRounds(e.currentTarget.value)}
            />
            <Show when={locks().rounds}>
              <p class="edit-locked">{locks().rounds}</p>
            </Show>
          </div>
        </Show>

        <div class="edit-field">
          <label class="library-toggle">
            <input
              type="checkbox"
              checked={unilateral()}
              disabled={Boolean(locks().unilateral)}
              onInput={(e) => setUnilateral(e.currentTarget.checked)}
            />
            One side at a time
          </label>
          <Show when={locks().unilateral}>
            <p class="edit-locked">{locks().unilateral}</p>
          </Show>
        </div>

        <Show when={needsPrescription() && !isEdit}>
          <h3 class="edit-subhead">Opening prescription</h3>

          <div class="edit-field">
            <label for="ex-reps-min">{type() === 'rep_range' ? 'Reps min' : 'Reps'}</label>
            <input
              id="ex-reps-min"
              type="text"
              inputmode="numeric"
              autocomplete="off"
              value={repsMin()}
              onInput={(e) => {
                setRepsMin(e.currentTarget.value);
                if (type() !== 'rep_range') setRepsMax(e.currentTarget.value);
              }}
            />
          </div>

          <Show when={type() === 'rep_range'}>
            <div class="edit-field">
              <label for="ex-reps-max">Reps max</label>
              <input
                id="ex-reps-max"
                type="text"
                inputmode="numeric"
                autocomplete="off"
                value={repsMax()}
                onInput={(e) => setRepsMax(e.currentTarget.value)}
              />
            </div>
          </Show>

          {/* Index, not For: For is keyed by value, so editing one weight
              rebuilds that input and destroys focus mid-typing. Same reason as
              EditSlotSheet. */}
          <Index each={syncedWeights()}>
            {(w, i) => (
              <div class="edit-field">
                <label for={`ex-weight-${i}`}>
                  {type() === 'ramp_up' ? `Round ${i + 1} weight` : 'Weight'}
                </label>
                <input
                  id={`ex-weight-${i}`}
                  type="text"
                  inputmode="decimal"
                  autocomplete="off"
                  value={w()}
                  onInput={(e) => setWeightAt(i, e.currentTarget.value)}
                />
              </div>
            )}
          </Index>
        </Show>

        <Show when={isEdit && (locks().type || locks().rounds || locks().unilateral)}>
          <button
            class="secondary-btn"
            onClick={() => props.onDuplicate?.(source)}
          >
            Duplicate as new exercise
          </button>
        </Show>

        <Show when={formError()}>
          <p class="edit-error" role="alert">{formError()}</p>
        </Show>

        <div class="edit-actions">
          <button class="edit-cancel-btn" onClick={props.onClose} disabled={busy()}>
            Cancel
          </button>
          <button class="edit-save-btn" onClick={save} disabled={busy()}>
            {busy() ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Wire the duplicate action in the library**

In `src/views/ExerciseLibraryView.jsx`, pass `onDuplicate` into the sheet so the lock message has somewhere to go:

```js
          <ExerciseFormSheet
            exercise={state.exercise}
            mode={state.mode}
            programme={props.programme}
            workouts={props.workouts}
            onDuplicate={(exercise) => setForm({ exercise, mode: 'duplicate' })}
            onClose={() => setForm(null)}
            onSaved={props.onSaved}
          />
```

`Show ... keyed` already re-creates the sheet when `form()` changes identity, so switching from `edit` to `duplicate` re-seeds every field.

- [ ] **Step 3: Add the styles**

Append to `src/index.css`:

```css
.edit-sheet-tall {
  max-height: 88vh;
  overflow-y: auto;
}

.edit-subhead {
  margin: 1.5rem 0 0.5rem;
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.55;
}

.edit-locked {
  margin-top: 0.35rem;
  font-size: 0.75rem;
  line-height: 1.45;
  color: #e0b341;
}

.edit-field select:disabled,
.edit-field input:disabled {
  opacity: 0.45;
  cursor: default;
}
```

- [ ] **Step 4: Verify**

Run: `pnpm build && pnpm test`
Expected: build succeeds, 78 tests pass.

Manual check: "+ New exercise" creates a ramp with four weight fields when Rounds is 4; opening an existing seeded exercise shows Kind and Rounds disabled with a reason naming the blocking workout, and "Duplicate as new exercise" re-opens the sheet with every field free and the movement carried over.

- [ ] **Step 5: Commit**

```bash
git add src/views/ExerciseFormSheet.jsx src/views/ExerciseLibraryView.jsx src/index.css
git commit -m "feat: add the exercise form sheet with duplicate flow"
```

---

### Task 14: Documentation and whole-feature verification

**Files:**
- Modify: `CLAUDE.md`

**Interfaces:**
- Consumes: everything above.
- Produces: nothing consumed by other tasks.

- [ ] **Step 1: Update CLAUDE.md**

Make these edits:

1. In **Architecture → Data flow**, change the `view` signal line to list four values:

```
navigation is a `view` signal in `App.jsx` with values `'schedule' | 'detail' | 'active' | 'library'`
```

2. In **Data flow**, extend the `db.js` bullet:

```
- `db.js` — `loadProgramme()` fetches all four tables, calls `shapeProgramme`, and caches the result in localStorage; on fetch failure it falls back to the cache and marks the data `stale`. `savePrescription()` inserts a new `prescriptions` row. Phase 2 added the structural writes: `createExercise`, `updateExercise`, `setExerciseArchived`, `deleteExercise`, `createWorkout`, `updateWorkout`, `deleteWorkout`, and `saveWorkoutSlots` (the one RPC).
```

3. In **Key modules**, add:

```
- `structure.js` — pure logic for structural editing: `deriveSlug`, `moveItem`, `nextPosition`, `exerciseFormError`, `workoutFormError`, `lockedExerciseFields`, `usedByWorkouts`, `canHardDelete`, `eligibleExercises`, `defaultSide`, `sideWarnings`. Mirrors the database triggers so a refusal can be explained before Postgres raises it.
- `views/ExerciseLibraryView.jsx`, `views/ExerciseFormSheet.jsx`, `views/WorkoutFormSheet.jsx`, `views/AddSlotSheet.jsx` — the Phase 2 structural editors.
```

4. In **Data model**, add:

```
- Structural writes go directly to the tables (`0008` re-granted insert/update/delete after `0006` had narrowed them to select). The one exception is the slot set: `save_workout_slots(workout_id, slots)` (`0010`) rewrites it inside a single transaction, because delete-then-insert over the REST layer is two requests and a failure between them empties the workout. It is `security invoker`, so RLS still applies.
- `exercises.archived` (`0009`) is how an exercise is retired. It cannot be deleted once it has prescriptions — `on delete restrict` protects the journal — so archiving hides it from the add-slot picker and the default library listing without destroying anything.
- Some exercise edits have no valid statement order once data is attached: `check_exercise_update` re-validates every existing prescription and slot, so a ramp's round count cannot be changed in place. `lockedExerciseFields` detects this and the editor offers duplication instead, per D4.
```

5. In **Gotchas**, add:

```
- `DetailView`'s edit mode holds a local draft of the slot list and writes it once on Save. Intermediate reorders never reach the database, and a failed save leaves the draft intact for retry because `save_workout_slots` is atomic.
- `ScheduleView` no longer destructures its props — it reads `props.stale`, which flips on a refetch while the view stays mounted.
```

- [ ] **Step 2: Run the full verification**

Run: `pnpm test && pnpm build`
Expected: 78 tests pass, build succeeds with no warnings other than the pre-existing bundle-size note.

- [ ] **Step 3: Confirm the untouched files really are untouched**

Run: `git diff --name-only main...HEAD`
Expected: the list contains no `src/timer.js`, `src/audio.js`, or `src/views/ActiveView.jsx`.

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: document phase 2 structural editing"
```

---

## Deferred to the user

The implementer cannot do these; they belong in the human-review notes.

1. **Apply migrations 0008, 0009 and 0010 in the Supabase dashboard** before any manual testing. Nothing in the UI works until they are applied, and the failure mode is an RLS denial that looks like a silent no-op on write.
2. Confirm public signups are still disabled in Supabase Auth. Migration 0008 widens what an authenticated session can do, which makes that toggle more load-bearing than it was.

## Self-Review

**Spec coverage.** Every requirement maps to a task: exercise library → 12, 13; workout editor → 9; slot editor → 10, 11; retire/delete → 9 (workouts), 12 (exercises), 1 (`archived` column); blocked edits and duplication → 4, 13; guardrails → 4 (warnings), 10 (draft warnings), 13 (lock reasons), and the affected-workouts note already exists in `EditSlotSheet`; offline → 7 (`stale`), 8, 10, 12; reach → up/down buttons in 10. Success criteria 1–8 are covered by the manual checks in tasks 9–13; criterion 9 by the atomic RPC in 1 and 10; criterion 10 by the `stale` gating; criterion 11 by the tests in 2–5 plus the final run in 14.

**Placeholder scan.** The only intentional stubs are the two one-line shells in tasks 7, 10 and 12, each of which names the task that replaces it and is replaced within the same plan.

**Type consistency.** `exercise` is always the `shapeProgramme` shape `{ slug, movement, name, type, rounds, unilateral, archived, prescription }`; `slot` is always `{ position, side, exercise }`; `saveWorkoutSlots` takes `[{ exercise_slug, side }]` in display order and is called that way in Task 10; `lockedExerciseFields` returns `{ type, rounds, unilateral }` of reason-or-null in both Task 4 and Task 13.

**Known gap, flagged rather than fixed.** `ExerciseFormSheet` grew to roughly 350 lines — the largest file in the project. It is one coherent form with three modes, and splitting the prescription fields into a shared component with `EditSlotSheet` is the obvious follow-up, but doing it inside this plan would couple a working screen to a refactor of a shipped one. Left for a reviewer to rule on.
