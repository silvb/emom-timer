# Edit Mode Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move the workout programme out of `src/workouts.json` into Supabase, and let reps and weights be edited from the phone, with every change appended as a new row so the change history is a queryable training journal.

**Architecture:** Four pure modules (`timer.js` timing math, `model.js` data shaping and validation, `render.js` display formatting, all unit-tested with Vitest) sit under one I/O module (`db.js`: Supabase client, fetch, localStorage cache, prescription insert). SolidJS views consume a single shaped `programme` object loaded once via `createResource`. Prescriptions are append-only — the app never issues an UPDATE or DELETE against them.

**Tech Stack:** SolidJS 1.9, Vite 7, `@supabase/supabase-js`, Supabase Postgres 17 + Supabase Auth, Vitest.

## Global Constraints

- Supabase project ref: `eragwvimbqhiytpgpdbv`, region `eu-north-1`. URL `https://eragwvimbqhiytpgpdbv.supabase.co`.
- Client env vars are exactly `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. **No service-role key may appear in any `VITE_`-prefixed variable, in `.env`, or in any committed file.** Vite inlines every `VITE_*` value into the bundle.
- `prescriptions` is append-only. No task may write code that issues `UPDATE` or `DELETE` against it. This is the one thing Phase 2 cannot repair.
- Slots are always exactly 1 minute. Round 1 is `roundIndex === 0`. `per_round` slots are **left on even `roundIndex`, right on odd** (so round 1 is left).
- `movement` must be populated on every exercise, even when it equals the slug.
- Both foreign keys pointing at `exercises` use `on delete restrict`.
- Node 22.12 (`.nvmrc`), package manager `pnpm@10.32.1`.
- Do not build anything listed in the spec's "Out of scope" section. In particular: no exercise/workout/slot CRUD, no per-session performance logging, no charts.
- Existing timer and audio behaviour must not change: 10s countdown, start ping, 10s and 3s warnings, halfway beep at 30s, pause/resume, completion melody.

---

## File Structure

**Create:**
- `supabase/migrations/0001_schema.sql` — tables, constraints, triggers, RLS, view
- `supabase/migrations/0002_seed.sql` — seed programme data
- `src/model.js` — pure: `shapeProgramme`, `validateWorkout`
- `src/render.js` — pure: display-part builders for exercise lines
- `src/db.js` — I/O: Supabase client, `loadProgramme`, `savePrescription`
- `src/auth.jsx` — session signal + `LoginGate` component
- `src/views/EditSlotSheet.jsx` — the edit form
- `src/components/Toast.jsx` — transient error toast
- `src/timer.test.js`, `src/model.test.js`, `src/render.test.js`
- `.env.example`

**Modify:** `src/timer.js`, `src/App.jsx`, `src/views/ScheduleView.jsx`, `src/views/DetailView.jsx`, `src/views/ActiveView.jsx`, `src/index.css`, `vite.config.js`, `package.json`, `.gitignore`, `CLAUDE.md`

**Delete:** `src/workouts.json`

### Shaped data contract (produced by `model.js`, consumed by every view)

```js
exercise = {
  slug: 'sumo_deadlift',
  movement: 'sumo_deadlift',
  name: 'Sumo Deadlifts',
  type: 'ramp_up',          // 'ramp_up' | 'rep_range' | 'fixed' | 'plain'
  rounds: 4,                // number for ramp_up, null otherwise
  unilateral: false,
  prescription: { reps_min: 6, reps_max: 6, weights: [80, 90, 110, 100] }, // null for 'plain'
}

slot = { position: 1, side: null, exercise }   // side: null | 'alternating' | 'per_round'

workout = { id, title, day, rounds, position, slots: [slot], minutes }  // minutes = rounds * slots.length

programme = { workouts: [workout], exercises: { [slug]: exercise } }
```

---

## Task 1: Database schema

**Files:**
- Create: `supabase/migrations/0001_schema.sql`

**Interfaces:**
- Produces: tables `exercises`, `prescriptions`, `workouts`, `workout_slots`; view `current_prescriptions`. Every later task reads these names.

Apply migrations with the Supabase MCP tool `apply_migration` against project `eragwvimbqhiytpgpdbv`, and also commit the SQL file so the schema is reproducible.

- [ ] **Step 1: Write the schema migration**

Create `supabase/migrations/0001_schema.sql`:

```sql
-- Identity only. Never contains numbers that change over time.
create table exercises (
  slug        text primary key,
  movement    text not null,
  name        text not null,
  type        text not null check (type in ('ramp_up','rep_range','fixed','plain')),
  rounds      int,
  unilateral  boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint ramp_rounds_present check ((type = 'ramp_up') = (rounds is not null))
);

-- Append-only. One row per prescription change. Never UPDATE, never DELETE.
create table prescriptions (
  id            bigserial primary key,
  exercise_slug text not null references exercises(slug) on delete restrict,
  effective_at  timestamptz not null default now(),
  reps_min      int not null,
  reps_max      int not null,
  weights       numeric[] not null,
  constraint reps_ordered check (reps_max >= reps_min),
  constraint reps_positive check (reps_min > 0),
  constraint weights_present check (array_length(weights, 1) >= 1)
);
create index prescriptions_lookup on prescriptions (exercise_slug, effective_at desc, id desc);

create table workouts (
  id       text primary key,
  title    text not null,
  day      text check (day in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  rounds   int  not null check (rounds > 0),
  position int  not null
);

create table workout_slots (
  workout_id    text not null references workouts(id) on delete cascade,
  position      int  not null,
  exercise_slug text not null references exercises(slug) on delete restrict,
  side          text check (side in ('alternating','per_round')),
  primary key (workout_id, position)
);

-- Current prescription per exercise
create view current_prescriptions as
select distinct on (exercise_slug) *
from prescriptions
order by exercise_slug, effective_at desc, id desc;

-- Invariant 1 + 3: weight-array length matches the exercise kind, and
-- 'plain' exercises never get a prescription at all.
create function check_prescription_shape() returns trigger
language plpgsql as $$
declare
  ex exercises%rowtype;
  n  int;
begin
  select * into ex from exercises where slug = new.exercise_slug;
  n := coalesce(array_length(new.weights, 1), 0);

  if ex.type = 'plain' then
    raise exception 'exercise % is plain and cannot have a prescription', ex.slug;
  elsif ex.type = 'ramp_up' then
    if n <> ex.rounds then
      raise exception 'ramp_up exercise % needs exactly % weights, got %', ex.slug, ex.rounds, n;
    end if;
  else
    if n <> 1 then
      raise exception 'exercise % needs exactly 1 weight, got %', ex.slug, n;
    end if;
  end if;

  return new;
end;
$$;

create trigger prescriptions_shape
before insert or update on prescriptions
for each row execute function check_prescription_shape();

-- Invariant 2 + 4: a ramp exercise only fits a workout with the same round
-- count, and a slot's side must match the exercise's laterality.
create function check_slot_shape() returns trigger
language plpgsql as $$
declare
  ex exercises%rowtype;
  wo workouts%rowtype;
begin
  select * into ex from exercises where slug = new.exercise_slug;
  select * into wo from workouts  where id   = new.workout_id;

  if ex.type = 'ramp_up' and ex.rounds <> wo.rounds then
    raise exception 'ramp_up exercise % has % rounds but workout % has %',
      ex.slug, ex.rounds, wo.id, wo.rounds;
  end if;

  if ex.unilateral and new.side is null then
    raise exception 'exercise % is unilateral so slot %/% needs a side',
      ex.slug, new.workout_id, new.position;
  end if;

  if not ex.unilateral and new.side is not null then
    raise exception 'exercise % is not unilateral so slot %/% must not set a side',
      ex.slug, new.workout_id, new.position;
  end if;

  return new;
end;
$$;

create trigger workout_slots_shape
before insert or update on workout_slots
for each row execute function check_slot_shape();

-- Changing a workout's round count must not silently break its ramp slots.
create function check_workout_rounds() returns trigger
language plpgsql as $$
declare
  bad text;
begin
  select e.slug into bad
  from workout_slots s
  join exercises e on e.slug = s.exercise_slug
  where s.workout_id = new.id and e.type = 'ramp_up' and e.rounds <> new.rounds
  limit 1;

  if bad is not null then
    raise exception 'workout % now has % rounds but ramp exercise % expects %',
      new.id, new.rounds, bad, (select rounds from exercises where slug = bad);
  end if;

  return new;
end;
$$;

create trigger workouts_rounds_guard
after update of rounds on workouts
for each row execute function check_workout_rounds();

alter table exercises      enable row level security;
alter table prescriptions  enable row level security;
alter table workouts       enable row level security;
alter table workout_slots  enable row level security;

-- Single-user app: any authenticated session is the owner.
-- Public signup MUST be disabled in the Supabase dashboard; that toggle is
-- the security boundary these policies rely on.
create policy owner_all on exercises     for all to authenticated using (true) with check (true);
create policy owner_all on workouts      for all to authenticated using (true) with check (true);
create policy owner_all on workout_slots for all to authenticated using (true) with check (true);

-- Prescriptions are append-only: authenticated users may read and insert,
-- but there is deliberately no update or delete policy, so RLS denies both.
create policy prescriptions_read   on prescriptions for select to authenticated using (true);
create policy prescriptions_insert on prescriptions for insert to authenticated with check (true);
```

- [ ] **Step 2: Apply the migration**

Use the Supabase MCP tool:

```
apply_migration(project_id: "eragwvimbqhiytpgpdbv", name: "schema", query: <contents of 0001_schema.sql>)
```

- [ ] **Step 3: Verify the invariants actually bite**

Run each of these with the MCP `execute_sql` tool. The first three must **fail**; the last must succeed.

```sql
-- must fail: ramp weight count mismatch
insert into exercises (slug, movement, name, type, rounds) values ('t_ramp','t','T','ramp_up',4);
insert into prescriptions (exercise_slug, reps_min, reps_max, weights) values ('t_ramp',5,5,'{10,20}');
```

```sql
-- must fail: plain exercise with a prescription
insert into exercises (slug, movement, name, type) values ('t_plain','t','T','plain');
insert into prescriptions (exercise_slug, reps_min, reps_max, weights) values ('t_plain',1,1,'{0}');
```

```sql
-- must fail: unilateral exercise in a slot with no side
insert into exercises (slug, movement, name, type, unilateral) values ('t_uni','t','T','fixed',true);
insert into workouts (id, title, rounds, position) values ('t_w','T',3,99);
insert into workout_slots (workout_id, position, exercise_slug, side) values ('t_w',1,'t_uni',null);
```

```sql
-- must succeed
insert into workout_slots (workout_id, position, exercise_slug, side) values ('t_w',1,'t_uni','alternating');
```

Record which raised and which passed. Then clean up:

```sql
delete from workout_slots where workout_id = 't_w';
delete from workouts where id = 't_w';
delete from prescriptions where exercise_slug in ('t_ramp','t_plain','t_uni');
delete from exercises where slug in ('t_ramp','t_plain','t_uni');
```

- [ ] **Step 4: Disable public signup**

**This is the security boundary the RLS policies depend on and it cannot be done in SQL.**
The policies grant full read and write access to *any* authenticated user, so as long as
signup is open, anyone can create an account and get that access.

In the Supabase dashboard for project `eragwvimbqhiytpgpdbv`:
Authentication → Sign In / Providers → Email → turn **Allow new users to sign up** off.

Then create the single account manually: Authentication → Users → Add user, with a real
email and password. Those credentials are what Task 7's login form will use.

If this cannot be completed (no dashboard access in this environment), **stop and report it**
rather than proceeding — do not leave an open-signup project holding real data.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0001_schema.sql
git commit -m "feat: add edit mode database schema with invariant triggers"
```

---

## Task 2: Seed the programme

**Files:**
- Create: `supabase/migrations/0002_seed.sql`

**Interfaces:**
- Consumes: tables from Task 1.
- Produces: 18 exercises, 15 prescriptions, 9 workouts, 22 slots.

This replaces the old `src/workouts.json` content. Note two deliberate structural changes carried over from the design: `squat_acc` is 2 slots × 6 rounds (was 4 × 3), and `upper_acc` is 4 rounds (was 3). Do not "correct" these back.

- [ ] **Step 1: Write the seed migration**

Create `supabase/migrations/0002_seed.sql`:

```sql
insert into exercises (slug, movement, name, type, rounds, unilateral) values
  ('nordic_curl',         'nordic_curl',         'Nordic Curls',        'fixed',     null, false),
  ('rest',                'rest',                'Rest',                'plain',     null, false),
  ('zercher_squat',       'zercher_squat',       'Zercher Squats',      'ramp_up',      4, false),
  ('lm_lateral_raise',    'lm_lateral_raise',    'LM Lateral Raises',   'fixed',     null, true),
  ('kb_incline_press',    'kb_incline_press',    'KB Incline Press',    'fixed',     null, true),
  ('overhead_press',      'overhead_press',      'Overhead Press',      'ramp_up',      4, false),
  ('gorilla_row',         'gorilla_row',         'Gorilla Rows',        'fixed',     null, true),
  ('lm_meadows_row',      'lm_meadows_row',      'LM Meadows Rows',     'fixed',     null, true),
  ('ring_face_pull',      'ring_face_pull',      'Ring Face Pulls',     'fixed',     null, false),
  ('chin_up',             'chin_up',             'Chin-ups',            'rep_range', null, false),
  ('goblet_squat',        'goblet_squat',        'Goblet Squat',        'fixed',     null, false),
  ('incline_bench_press', 'incline_bench_press', 'Incline Bench Press', 'fixed',     null, false),
  ('one_leg_kb_rdl',      'one_leg_kb_rdl',      '1-leg KB RDL',        'fixed',     null, true),
  ('sumo_deadlift',       'sumo_deadlift',       'Sumo Deadlifts',      'ramp_up',      4, false),
  ('push_up_on_kbs',      'push_up_on_kbs',      'Push-ups on KBs',     'fixed',     null, false),
  ('cossack_squat',       'cossack_squat',       'Cossack Squats',      'fixed',     null, true),
  ('carry',               'carry',               'Carry!',              'plain',     null, false),
  ('skip',                'skip',                'Skip!',               'plain',     null, false);

-- 'plain' exercises (rest, carry, skip) deliberately have no prescription.
insert into prescriptions (exercise_slug, reps_min, reps_max, weights) values
  ('nordic_curl',          5,  5, '{0}'),
  ('zercher_squat',       10, 10, '{45,50,60,60}'),
  ('lm_lateral_raise',    12, 12, '{2.5}'),
  ('kb_incline_press',    10, 10, '{16}'),
  ('overhead_press',       8,  8, '{35,40,45,40}'),
  ('gorilla_row',         10, 10, '{32}'),
  ('lm_meadows_row',      10, 10, '{22.5}'),
  ('ring_face_pull',      12, 12, '{0}'),
  ('chin_up',              5,  8, '{18.5}'),
  ('goblet_squat',        15, 15, '{24}'),
  ('incline_bench_press', 10, 10, '{45}'),
  ('one_leg_kb_rdl',       8,  8, '{32}'),
  ('sumo_deadlift',        6,  6, '{80,90,110,100}'),
  ('push_up_on_kbs',      20, 20, '{0}'),
  ('cossack_squat',        8,  8, '{16}');

insert into workouts (id, title, day, rounds, position) values
  ('squat_main',     'Squat Main',       'monday',   4, 1),
  ('squat_acc',      'Squat Accessory',  'monday',   6, 2),
  ('upper_main',     'Upper Main',       'tuesday',  4, 3),
  ('upper_acc',      'Upper Accessory',  'tuesday',  4, 4),
  ('full_body',      'Full Body',        'thursday', 4, 5),
  ('hinge_main',     'Hinge Main',       'friday',   4, 6),
  ('hinge_acc',      'Hinge Accessory',  'friday',   3, 7),
  ('loaded_carries', 'Loaded Carries',   null,       5, 8),
  ('jump_rope',      'Jump Rope',        null,       7, 9);

insert into workout_slots (workout_id, position, exercise_slug, side) values
  ('squat_main',     1, 'nordic_curl',         null),
  ('squat_main',     2, 'rest',                null),
  ('squat_main',     3, 'zercher_squat',       null),
  ('squat_acc',      1, 'lm_lateral_raise',    'per_round'),
  ('squat_acc',      2, 'kb_incline_press',    'per_round'),
  ('upper_main',     1, 'overhead_press',      null),
  ('upper_main',     2, 'gorilla_row',         'alternating'),
  ('upper_main',     3, 'rest',                null),
  ('upper_acc',      1, 'lm_meadows_row',      'per_round'),
  ('upper_acc',      2, 'rest',                null),
  ('upper_acc',      3, 'ring_face_pull',      null),
  ('full_body',      1, 'chin_up',             null),
  ('full_body',      2, 'goblet_squat',        null),
  ('full_body',      3, 'incline_bench_press', null),
  ('full_body',      4, 'one_leg_kb_rdl',      'per_round'),
  ('hinge_main',     1, 'sumo_deadlift',       null),
  ('hinge_main',     2, 'push_up_on_kbs',      null),
  ('hinge_main',     3, 'rest',                null),
  ('hinge_acc',      1, 'cossack_squat',       'alternating'),
  ('hinge_acc',      2, 'lm_lateral_raise',    'alternating'),
  ('loaded_carries', 1, 'carry',               null),
  ('jump_rope',      1, 'skip',                null);
```

- [ ] **Step 2: Apply the seed**

```
apply_migration(project_id: "eragwvimbqhiytpgpdbv", name: "seed_programme", query: <contents of 0002_seed.sql>)
```

If any trigger raises, the data is wrong — fix the seed, do not weaken the trigger.

- [ ] **Step 3: Verify counts and derived minutes**

```sql
select
  (select count(*) from exercises)     as exercises,      -- expect 18
  (select count(*) from prescriptions) as prescriptions,  -- expect 15
  (select count(*) from workouts)      as workouts,       -- expect 9
  (select count(*) from workout_slots) as slots;          -- expect 22
```

```sql
select w.id, w.rounds, count(s.*) as slots, w.rounds * count(s.*) as minutes
from workouts w join workout_slots s on s.workout_id = w.id
group by w.id, w.rounds order by w.id;
```

Expected minutes: `full_body` 16, `hinge_acc` 6, `hinge_main` 12, `jump_rope` 7, `loaded_carries` 5, `squat_acc` 12, `squat_main` 12, `upper_acc` 12, `upper_main` 12.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/0002_seed.sql
git commit -m "feat: seed workout programme into supabase"
```

---

## Task 3: Vitest and the timer rewrite

**Files:**
- Modify: `package.json`, `vite.config.js`, `src/timer.js`
- Test: `src/timer.test.js`

**Interfaces:**
- Produces:
  - `deriveTimerState(elapsed, workout, phase)` → for `phase === 'running'`: `{ phase, remaining, secondsLeftInRound, slotIndex, roundIndex, currentRound, totalRounds, slot, next }` where `next` is `{ slotIndex, roundIndex, slot }` or `null` on the final minute.
  - `positionAt(minuteIndex, slotCount, totalRounds)` → `{ slotIndex, roundIndex }`
  - `assignColors(slots)` → `{ [exerciseSlug]: hexColor }`
  - `isRest(exercise)` → boolean
  - `PALETTE` stays private.

The old `exerciseIndex` and `exerciseName` fields are gone; `minutes` is no longer read from the workout.

- [ ] **Step 1: Install Vitest and wire it up**

```bash
pnpm add -D vitest
```

Add to `package.json` scripts:

```json
"test": "vitest run",
"test:watch": "vitest"
```

Add the `test` block to `vite.config.js`, keeping the existing solid plugin config untouched:

```js
test: {
  environment: 'node',
  include: ['src/**/*.test.js'],
},
```

- [ ] **Step 2: Write the failing tests**

Create `src/timer.test.js`:

```js
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
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — `positionAt` is not exported, `slotIndex`/`next` undefined.

- [ ] **Step 4: Rewrite `src/timer.js`**

Replace `deriveTimerState`, `isRest` and `assignColors`. Keep the `PALETTE` array exactly as it is.

```js
// Given an absolute minute index, which slot and which round are we in?
export function positionAt(minuteIndex, slotCount, totalRounds) {
  const clamped = Math.min(minuteIndex, totalRounds * slotCount - 1);
  return {
    slotIndex: clamped % slotCount,
    roundIndex: Math.floor(clamped / slotCount),
  };
}

// Given elapsed seconds and workout config, derive all display state
export function deriveTimerState(elapsed, workout, phase) {
  if (phase === 'countdown') {
    return {
      phase: 'countdown',
      countdownSeconds: Math.max(0, 10 - elapsed),
    };
  }

  const slotCount = workout.slots.length;
  const totalRounds = workout.rounds;
  const totalMinutes = totalRounds * slotCount;
  const totalSeconds = totalMinutes * 60;
  const remaining = Math.max(0, totalSeconds - elapsed);

  const minuteIndex = Math.floor(elapsed / 60);
  const secondsLeftInRound = 60 - (elapsed % 60);

  const cur = positionAt(minuteIndex, slotCount, totalRounds);
  const hasNext = minuteIndex + 1 < totalMinutes;
  const nextPos = hasNext ? positionAt(minuteIndex + 1, slotCount, totalRounds) : null;

  return {
    phase: remaining <= 0 ? 'done' : 'running',
    remaining,
    secondsLeftInRound: remaining <= 0 ? 0 : secondsLeftInRound,
    slotIndex: cur.slotIndex,
    roundIndex: cur.roundIndex,
    currentRound: cur.roundIndex + 1,
    totalRounds,
    slot: workout.slots[cur.slotIndex],
    next: nextPos
      ? { ...nextPos, slot: workout.slots[nextPos.slotIndex] }
      : null,
  };
}

// A "Rest" slot is a recovery minute, not a real exercise — it's part of the
// EMOM cycle but hidden from the weekly schedule listing. Carry and Skip are
// also numberless, but they are the whole point of their workouts, so they stay.
export const isRest = (exercise) => exercise.slug === 'rest';
```

And `assignColors`, keyed by slug so the colour survives the per-round weight text:

```js
export function assignColors(slots) {
  const shuffled = [...PALETTE].sort(() => Math.random() - 0.5);
  const map = {};
  slots.forEach((slot, i) => {
    map[slot.exercise.slug] = shuffled[i % shuffled.length];
  });
  return map;
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS, all timer tests green.

- [ ] **Step 6: Commit**

```bash
git add package.json pnpm-lock.yaml vite.config.js src/timer.js src/timer.test.js
git commit -m "feat: derive timer state from explicit rounds and slots"
```

---

## Task 4: Display formatting

**Files:**
- Create: `src/render.js`, `src/render.test.js`

**Interfaces:**
- Produces:
  - `sideLabel(slot, roundIndex)` → `'left' | 'right' | 'L/R' | null`
  - `repsText(slot)` → `'6' | '5-8' | '10/10' | null`
  - `weightParts(exercise, roundIndex)` → `[{ value: number, current: boolean }]`, empty when every weight is 0
  - `describeSlot(slot, roundIndex)` → `{ reps, name, weights, side }`

`roundIndex` may be `null`, meaning "no particular round" — used by the schedule and detail screens, which show the whole ramp with nothing highlighted.

- [ ] **Step 1: Write the failing tests**

Create `src/render.test.js`:

```js
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — cannot resolve `./render.js`.

- [ ] **Step 3: Write `src/render.js`**

```js
// Turns a slot plus a round index into the structured parts a view renders.
// Deliberately returns parts rather than a formatted string: the active screen
// has to emphasise one weight inside a ramp, which a string cannot express.

export function sideLabel(slot, roundIndex) {
  if (slot.side !== 'per_round') return null;
  if (roundIndex === null || roundIndex === undefined) return 'L/R';
  return roundIndex % 2 === 0 ? 'left' : 'right';
}

export function repsText(slot) {
  const p = slot.exercise.prescription;
  if (!p) return null;
  const base = p.reps_max > p.reps_min ? `${p.reps_min}-${p.reps_max}` : `${p.reps_min}`;
  return slot.side === 'alternating' ? `${base}/${base}` : base;
}

export function weightParts(exercise, roundIndex) {
  const p = exercise.prescription;
  if (!p) return [];

  const values = p.weights.map(Number);
  if (values.every((v) => v === 0)) return [];

  const highlight =
    roundIndex === null || roundIndex === undefined
      ? -1
      : exercise.type === 'ramp_up'
        ? Math.min(roundIndex, values.length - 1)
        : 0;

  return values.map((value, i) => ({ value, current: i === highlight }));
}

export function describeSlot(slot, roundIndex) {
  return {
    reps: repsText(slot),
    name: slot.exercise.name,
    weights: weightParts(slot.exercise, roundIndex),
    side: sideLabel(slot, roundIndex),
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/render.js src/render.test.js
git commit -m "feat: add structured exercise line rendering"
```

---

## Task 5: Data shaping and workout validation

**Files:**
- Create: `src/model.js`, `src/model.test.js`

**Interfaces:**
- Produces:
  - `shapeProgramme(exercises, prescriptions, workouts, slots)` → `{ workouts: [...], exercises: { [slug]: exercise } }` (the shape in "Shaped data contract" above)
  - `validateWorkout(workout)` → array of human-readable problem strings, empty when valid

`validateWorkout` implements the blocking check: a ramp exercise whose `rounds` disagrees with its workout's `rounds` would otherwise put the wrong weight on the bar mid-workout.

- [ ] **Step 1: Write the failing tests**

Create `src/model.test.js`:

```js
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
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `pnpm test`
Expected: FAIL — cannot resolve `./model.js`.

- [ ] **Step 3: Write `src/model.js`**

```js
// Turns the four flat table reads into the nested shape the views consume.
// Pure — no network, no storage — so it can be unit tested directly.
export function shapeProgramme(exerciseRows, prescriptionRows, workoutRows, slotRows) {
  const byExercise = new Map();
  prescriptionRows.forEach((p) => {
    byExercise.set(p.exercise_slug, {
      reps_min: p.reps_min,
      reps_max: p.reps_max,
      weights: p.weights,
    });
  });

  const exercises = {};
  exerciseRows.forEach((e) => {
    exercises[e.slug] = {
      slug: e.slug,
      movement: e.movement,
      name: e.name,
      type: e.type,
      rounds: e.rounds,
      unilateral: e.unilateral,
      prescription: byExercise.get(e.slug) ?? null,
    };
  });

  const slotsByWorkout = new Map();
  slotRows.forEach((s) => {
    if (!slotsByWorkout.has(s.workout_id)) slotsByWorkout.set(s.workout_id, []);
    slotsByWorkout.get(s.workout_id).push(s);
  });

  const workouts = [...workoutRows]
    .sort((a, b) => a.position - b.position)
    .map((w) => {
      const slots = (slotsByWorkout.get(w.id) ?? [])
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((s) => ({
          position: s.position,
          side: s.side,
          exercise: exercises[s.exercise_slug],
        }));

      return {
        id: w.id,
        title: w.title,
        day: w.day,
        rounds: w.rounds,
        position: w.position,
        slots,
        minutes: w.rounds * slots.length,
      };
    });

  return { workouts, exercises };
}

// Problems severe enough that starting the workout would put the wrong weight
// on the bar. Returns human-readable strings; empty means good to go.
export function validateWorkout(workout) {
  const problems = [];

  workout.slots.forEach((slot) => {
    const ex = slot.exercise;
    if (!ex) {
      problems.push(`Slot ${slot.position} points at an exercise that no longer exists.`);
      return;
    }
    if (ex.type === 'plain') return;

    if (!ex.prescription) {
      problems.push(`${ex.name} has no prescription yet.`);
      return;
    }

    const count = ex.prescription.weights.length;

    if (ex.type === 'ramp_up') {
      if (ex.rounds !== workout.rounds) {
        problems.push(
          `${ex.name} is built for ${ex.rounds} rounds but this workout has ${workout.rounds}.`
        );
      }
      if (count !== ex.rounds) {
        problems.push(`${ex.name} needs ${ex.rounds} weights but has ${count}.`);
      }
    } else if (count !== 1) {
      problems.push(`${ex.name} should have a single weight but has ${count}.`);
    }
  });

  return problems;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `pnpm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/model.js src/model.test.js
git commit -m "feat: add programme shaping and workout validation"
```

---

## Task 6: Supabase client, cache and prescription writes

**Files:**
- Create: `src/db.js`, `.env.example`
- Modify: `.gitignore`, `package.json`

**Interfaces:**
- Consumes: `shapeProgramme` from `src/model.js`.
- Produces:
  - `supabase` — the shared client
  - `loadProgramme()` → `Promise<{ programme, stale: boolean, error?: Error }>`
  - `savePrescription({ exercise_slug, reps_min, reps_max, weights })` → `Promise<void>`, throws on failure
  - `readCache()` / `writeCache(programme)`

- [ ] **Step 1: Install the client and set up env**

```bash
pnpm add @supabase/supabase-js
```

Confirm `.gitignore` contains `.env` and `.env.local`; add them if missing.

Create `.env.example` (placeholders only — never real keys):

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
```

Create a local, gitignored `.env` with the real values. Get the publishable key with the Supabase MCP tool `get_publishable_keys(project_id: "eragwvimbqhiytpgpdbv")` and use a key whose `disabled` field is false or absent. The URL is `https://eragwvimbqhiytpgpdbv.supabase.co`.

- [ ] **Step 2: Write `src/db.js`**

```js
import { createClient } from '@supabase/supabase-js';
import { shapeProgramme } from './model.js';

const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;

export const supabase = createClient(url, key);

const CACHE_KEY = 'emom.programme.v1';

export function writeCache(programme) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), programme }));
  } catch {
    // A full or unavailable localStorage must never break the workout.
  }
}

export function readCache() {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

async function fetchProgramme() {
  const [exercises, prescriptions, workouts, slots] = await Promise.all([
    supabase.from('exercises').select('*'),
    supabase.from('current_prescriptions').select('*'),
    supabase.from('workouts').select('*'),
    supabase.from('workout_slots').select('*'),
  ]);

  const failed = [exercises, prescriptions, workouts, slots].find((r) => r.error);
  if (failed) throw failed.error;

  return shapeProgramme(exercises.data, prescriptions.data, workouts.data, slots.data);
}

// Always prefer live data. Fall back to the last good read so a network blip
// outdoors degrades to stale content rather than an empty screen.
export async function loadProgramme() {
  try {
    const programme = await fetchProgramme();
    writeCache(programme);
    return { programme, stale: false };
  } catch (error) {
    const cached = readCache();
    if (cached) return { programme: cached.programme, stale: true, error };
    throw error;
  }
}

// Append-only: this inserts a new row, it never updates the previous one.
// The insert history is the training journal.
export async function savePrescription({ exercise_slug, reps_min, reps_max, weights }) {
  const { error } = await supabase.from('prescriptions').insert({
    exercise_slug,
    reps_min,
    reps_max,
    weights,
  });
  if (error) throw error;
}
```

- [ ] **Step 3: Verify the build still passes**

Run: `pnpm run build`
Expected: succeeds. (`App.jsx` does not import `db.js` yet — that is Task 7.)

- [ ] **Step 4: Commit**

```bash
git add package.json pnpm-lock.yaml .gitignore .env.example src/db.js
git commit -m "feat: add supabase client with cache fallback and append-only writes"
```

---

## Task 7: Auth gate and async app shell

**Files:**
- Create: `src/auth.jsx`, `src/components/Toast.jsx`
- Modify: `src/App.jsx`, `src/index.css`

**Interfaces:**
- Consumes: `supabase`, `loadProgramme` from `src/db.js`.
- Produces:
  - `useSession()` → Solid accessor returning the session or `null`
  - `<LoginGate>{children}</LoginGate>` — renders the email/password form until authenticated
  - `<Toast message={} onDismiss={} />`

- [ ] **Step 1: Write `src/auth.jsx`**

```jsx
import { createSignal, onCleanup, Show } from 'solid-js';
import { supabase } from './db.js';

const [session, setSession] = createSignal(null);
const [ready, setReady] = createSignal(false);

supabase.auth.getSession().then(({ data }) => {
  setSession(data.session);
  setReady(true);
});

const { data: sub } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));

export const useSession = () => session;
export const signOut = () => supabase.auth.signOut();

export function LoginGate(props) {
  const [email, setEmail] = createSignal('');
  const [password, setPassword] = createSignal('');
  const [error, setError] = createSignal(null);
  const [busy, setBusy] = createSignal(false);

  onCleanup(() => sub?.subscription?.unsubscribe());

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error: err } = await supabase.auth.signInWithPassword({
      email: email(),
      password: password(),
    });
    if (err) setError(err.message);
    setBusy(false);
  }

  return (
    <Show when={ready()} fallback={<div class="app-state">Loading…</div>}>
      <Show
        when={session()}
        fallback={
          <div class="login-view">
            <div class="logo-mark">EMOM</div>
            <form class="login-form" onSubmit={submit}>
              <input
                type="email"
                placeholder="Email"
                autocomplete="username"
                value={email()}
                onInput={(e) => setEmail(e.currentTarget.value)}
                required
              />
              <input
                type="password"
                placeholder="Password"
                autocomplete="current-password"
                value={password()}
                onInput={(e) => setPassword(e.currentTarget.value)}
                required
              />
              <button class="start-btn" type="submit" disabled={busy()}>
                {busy() ? 'Signing in…' : 'Sign in'}
              </button>
              <Show when={error()}>
                <p class="login-error">{error()}</p>
              </Show>
            </form>
          </div>
        }
      >
        {props.children}
      </Show>
    </Show>
  );
}
```

- [ ] **Step 2: Write `src/components/Toast.jsx`**

```jsx
import { Show, createEffect, onCleanup } from 'solid-js';

export default function Toast(props) {
  createEffect(() => {
    if (!props.message) return;
    const id = setTimeout(() => props.onDismiss(), 5000);
    onCleanup(() => clearTimeout(id));
  });

  return (
    <Show when={props.message}>
      <div class="toast" role="alert" onClick={() => props.onDismiss()}>
        {props.message}
      </div>
    </Show>
  );
}
```

- [ ] **Step 3: Rewrite `src/App.jsx`**

The workout list is now async. Wrap everything in `LoginGate`, load once with `createResource`, and keep a `stale` flag for the banner. `assignColors` now runs on the selected workout's slots.

```jsx
import { createSignal, createResource, Show, Switch, Match } from 'solid-js';
import { assignColors } from './timer.js';
import { resumeAudio } from './audio.js';
import { loadProgramme } from './db.js';
import { LoginGate } from './auth.jsx';
import Toast from './components/Toast.jsx';
import DetailView from './views/DetailView.jsx';
import ActiveView from './views/ActiveView.jsx';
import ScheduleView from './views/ScheduleView.jsx';

export default function App() {
  return (
    <div class="app">
      <LoginGate>
        <Programme />
      </LoginGate>
    </div>
  );
}

function Programme() {
  const [data, { refetch }] = createResource(loadProgramme);
  const [view, setView] = createSignal('schedule'); // 'schedule' | 'detail' | 'active'
  const [selectedId, setSelectedId] = createSignal(null);
  const [colorMap, setColorMap] = createSignal({});
  const [toast, setToast] = createSignal(null);

  const workouts = () => data()?.programme.workouts ?? [];
  const selectedWorkout = () => workouts().find((w) => w.id === selectedId()) ?? null;

  function selectWorkout(w) {
    setSelectedId(w.id);
    setView('detail');
  }

  function startWorkout() {
    resumeAudio();
    setColorMap(assignColors(selectedWorkout().slots));
    setView('active');
  }

  return (
    <>
      <Show when={data()?.stale}>
        <div class="stale-banner">Offline — showing your last saved workouts.</div>
      </Show>

      <Switch fallback={<div class="app-state">Loading…</div>}>
        <Match when={data.error}>
          <div class="app-state app-error">
            Could not load your workouts.
            <button class="start-btn" onClick={() => refetch()}>Retry</button>
          </div>
        </Match>

        <Match when={data() && view() === 'schedule'}>
          <ScheduleView workouts={workouts()} onSelect={selectWorkout} />
        </Match>

        <Match when={data() && view() === 'detail'}>
          <DetailView
            workout={selectedWorkout()}
            onStart={startWorkout}
            onBack={() => setView('schedule')}
            onSaved={refetch}
            onError={(m) => setToast(m)}
          />
        </Match>

        <Match when={data() && view() === 'active'}>
          <ActiveView
            workout={selectedWorkout()}
            colorMap={colorMap()}
            onCancel={() => setView('detail')}
            onComplete={() => setView('detail')}
          />
        </Match>
      </Switch>

      <Toast message={toast()} onDismiss={() => setToast(null)} />
    </>
  );
}
```

Note `selectedId` rather than holding the workout object: after `refetch()` the objects are new, and an id keeps the detail view pointed at fresh data.

- [ ] **Step 4: Add styles to `src/index.css`**

Match the existing visual language (the file already defines `.start-btn`, `.logo-mark`, `.detail-view` etc.). Add rules for `.login-view`, `.login-form`, `.login-error`, `.app-state`, `.app-error`, `.stale-banner`, `.toast`. The toast should be fixed to the bottom of the viewport, above the controls, and legible on both light and dark backgrounds.

- [ ] **Step 5: Verify the build**

Run: `pnpm run build && pnpm test`
Expected: both succeed. The app will not render correctly until Tasks 8–9 update the views — that is expected at this point.

- [ ] **Step 6: Commit**

```bash
git add src/auth.jsx src/components/Toast.jsx src/App.jsx src/index.css
git commit -m "feat: gate app behind supabase auth and load programme async"
```

---

## Task 8: Schedule and detail views

**Files:**
- Modify: `src/views/ScheduleView.jsx`, `src/views/DetailView.jsx`

**Files (continued):**
- Create: `src/components/ExerciseLine.jsx`

**Interfaces:**
- Consumes: `describeSlot` from `src/render.js`, `isRest` from `src/timer.js`, `validateWorkout` from `src/model.js`.
- Produces: `<ExerciseLine parts={} />`, default-exported from `src/components/ExerciseLine.jsx`. It lives in `components/` rather than inside a view because Task 9's `ActiveView` also renders it, and views should not import from each other.

- [ ] **Step 1: Update `ScheduleView.jsx`**

`workout.exercises` is gone. Iterate `workout.slots`, filter with `isRest(slot.exercise)`, and render each line with `describeSlot(slot, null)` — no round context on the schedule, so the whole ramp shows with nothing highlighted. `workout.minutes` is now supplied by `shapeProgramme`, so the `.meta-pill` needs no change.

Render a line as `reps name @weights [side]`, omitting any part that is null or empty. For example:
- `6 Sumo Deadlifts @80–90–110–100kg`
- `12 LM Lateral Raises @2.5kg [L/R]`
- `Carry!`

- [ ] **Step 2: Update `DetailView.jsx`**

Four changes:

1. `rounds()` no longer divides minutes — read `workout.rounds`. The stats block shows `workout.minutes` (already derived), `workout.slots.length` exercises, and `workout.rounds` rounds.
2. The exercise list iterates `workout.slots` and renders `describeSlot(slot, null)`.
3. Run `validateWorkout(workout)` and, when it returns problems, replace the Start button with a blocking error panel listing them. The workout must not be startable. This is deliberately not a dismissible toast.
4. Each non-`plain` slot row becomes tappable to open the editor (wired in Task 10). Leave a click handler stub that Task 10 fills in; `plain` rows are not tappable.

Create `src/components/ExerciseLine.jsx` so `ActiveView` can share it (import `Show` and `For` from `solid-js`):

```jsx
export default function ExerciseLine(props) {
  return (
    <span class="ex-line">
      <Show when={props.parts.reps}><span class="ex-reps">{props.parts.reps}</span>{' '}</Show>
      <span class="ex-name">{props.parts.name}</span>
      <Show when={props.parts.weights.length}>
        {' @'}
        <For each={props.parts.weights}>
          {(w, i) => (
            <>
              <Show when={i() > 0}><span class="ex-weight-sep">–</span></Show>
              <span classList={{ 'ex-weight': true, 'ex-weight-current': w.current }}>{w.value}</span>
            </>
          )}
        </For>
        {'kg'}
      </Show>
      <Show when={props.parts.side}>{' '}<span class="ex-side">[{props.parts.side}]</span></Show>
    </span>
  );
}
```

Add `.ex-weight-current` styling to `src/index.css`: bold and slightly larger than its siblings. It must remain legible against the coloured `ActiveView` backgrounds.

- [ ] **Step 3: Verify**

Run: `pnpm run build && pnpm test`
Expected: both succeed.

Then start the dev server (`pnpm run dev`), sign in, and confirm the schedule lists all nine workouts with correct minutes, and that a detail screen shows reps, names and weights.

- [ ] **Step 4: Commit**

```bash
git add src/components/ExerciseLine.jsx src/views/ScheduleView.jsx src/views/DetailView.jsx src/index.css
git commit -m "feat: render schedule and detail views from the database"
```

---

## Task 9: Active view rendering

**Files:**
- Modify: `src/views/ActiveView.jsx`

**Interfaces:**
- Consumes: `deriveTimerState` from `src/timer.js`, `describeSlot` from `src/render.js`, `ExerciseLine` from `src/components/ExerciseLine.jsx`.

**Audio must not change.** The sound effects block keys its dedupe on `Math.floor(elapsed / 60)`, which is still the absolute minute index — leave that logic alone. Only the rendering and the state field names change.

- [ ] **Step 1: Update the state field references**

- `state().exerciseName` → `state().slot.exercise.name`
- `bgColor()`: `colorMap[s.exerciseName]` → `colorMap[s.slot.exercise.slug]`
- The "Last round!" condition becomes simply `state().next === null` — drop the old `currentRound === totalRounds && exerciseIndex === exercises.length - 1` expression.
- The countdown's `First up:` line renders `<ExerciseLine parts={describeSlot(workout.slots[0], 0)} />`.

- [ ] **Step 2: Render the current exercise with its ramp**

Replace the `.exercise-display` div's plain name with:

```jsx
<div class="exercise-display">
  <ExerciseLine parts={describeSlot(state().slot, state().roundIndex)} />
</div>
```

- [ ] **Step 3: Render the next-exercise preview against the correct round**

```jsx
<div class="next-exercise-preview">
  <Show when={state().next} fallback="Last round!">
    {'Next: '}
    <ExerciseLine parts={describeSlot(state().next.slot, state().next.roundIndex)} />
  </Show>
</div>
```

This is the plate-loading path. `state().next.roundIndex` is the wrapped round — for `hinge_main` at round 2 / Rest, it must resolve to sumo deadlift at 110 kg, not 90 kg.

- [ ] **Step 4: Verify against the trap case**

Run: `pnpm run build && pnpm test`

Then in the dev server, start **Hinge Main** and step through. During the Rest minute at the end of round 2, the preview must read `Next: 6 Sumo Deadlifts @80–90–**110**–100kg` with 110 emphasised. If it shows 90 emphasised, the preview is reading the current round — fix it before committing.

Also confirm on **Squat Accessory**: the lateral raise slot shows `[left]` in round 1 and `[right]` in round 2, and the preview shows the upcoming round's side.

- [ ] **Step 5: Commit**

```bash
git add src/views/ActiveView.jsx
git commit -m "feat: show ramp weights and next-round preview during workouts"
```

---

## Task 10: Edit mode

**Files:**
- Create: `src/views/EditSlotSheet.jsx`
- Modify: `src/views/DetailView.jsx`

**Interfaces:**
- Consumes: `savePrescription` from `src/db.js`.
- Props: `<EditSlotSheet slot={} workouts={} onClose={} onSaved={} onError={} />` where `workouts` is the full workout list, used to name the other workouts this edit will affect.

- [ ] **Step 1: Write `src/views/EditSlotSheet.jsx`**

A bottom sheet over the detail view containing:

- The exercise name as a heading.
- Rep inputs: a single `reps` number for `fixed` and `ramp_up`; two inputs (`min`, `max`) for `rep_range`.
- Weight inputs: one per round for `ramp_up` (labelled `Round 1`…`Round N`), otherwise a single weight input. Use `type="number"`, `inputmode="decimal"`, `step="0.5"`.
- An affected-workouts note listing every workout whose slots reference this exercise, when there is more than one — for example "Also changes: Hinge Accessory". This is required by the spec because prescriptions are shared.
- Cancel and Save buttons.

Save behaviour:

```jsx
async function save() {
  setBusy(true);
  try {
    await savePrescription({
      exercise_slug: props.slot.exercise.slug,
      reps_min: Number(repsMin()),
      reps_max: Number(repsMax()),
      weights: weights().map(Number),
    });
    props.onSaved();   // triggers refetch in App
    props.onClose();
  } catch (e) {
    props.onError(e.message ?? 'Could not save. Try again.');
  } finally {
    setBusy(false);
  }
}
```

For non-`rep_range` types, `reps_min` and `reps_max` are both set to the single reps value. Never call anything other than `savePrescription` — no update path.

Validate before saving and block with an inline message rather than hitting the database:
- every weight must be a number ≥ 0
- reps must be ≥ 1, and `reps_max >= reps_min`
- a ramp must have exactly `exercise.rounds` weights

- [ ] **Step 2: Wire it into `DetailView.jsx`**

Hold an `editingSlot` signal. Tapping a non-`plain` exercise row sets it; the sheet renders when it is set. Pass `onSaved` and `onError` straight through from `App`.

- [ ] **Step 3: Add sheet styles to `src/index.css`**

`.edit-sheet`, `.edit-sheet-backdrop`, `.edit-field`, `.edit-affected`, `.edit-actions`. Thumb-friendly: inputs at least 44px tall, sheet anchored to the bottom of the viewport.

- [ ] **Step 4: Verify the append-only property end to end**

Run: `pnpm run dev`, open Hinge Main, tap Sumo Deadlifts, change round 3 from 110 to 115, save. The detail view must show 115 after the refetch.

Then confirm with MCP `execute_sql` that a row was **added**, not changed:

```sql
select id, exercise_slug, effective_at, reps_min, reps_max, weights
from prescriptions where exercise_slug = 'sumo_deadlift' order by id;
```

Expected: two rows — the seeded `{80,90,110,100}` and the new `{80,90,115,100}`. If the original row is gone or altered, the write path is wrong and must be fixed before committing.

Also confirm the shared-exercise note: open Squat Accessory → LM Lateral Raises and check it names Hinge Accessory.

- [ ] **Step 5: Commit**

```bash
git add src/views/EditSlotSheet.jsx src/views/DetailView.jsx src/index.css
git commit -m "feat: edit reps and weights from the workout detail screen"
```

---

## Task 11: Remove the JSON and update the docs

**Files:**
- Delete: `src/workouts.json`
- Modify: `CLAUDE.md`

- [ ] **Step 1: Delete the JSON and confirm nothing imports it**

```bash
git rm src/workouts.json
grep -rn "workouts.json" src/ || echo "no references"
```

Expected: no references. (`docs/` may still mention it historically — that is fine.)

- [ ] **Step 2: Rewrite the stale sections of `CLAUDE.md`**

The Architecture section is wrong once this lands. Update:

- **Commands** — add `pnpm test` / `pnpm test:watch`, and drop "No test runner is configured."
- **Data flow** — `workouts.json` no longer exists. Describe: Supabase tables → `db.js` (fetch + localStorage cache) → `model.js` `shapeProgramme` → views. Note the `programme` shape.
- **Key modules** — add `model.js`, `render.js`, `db.js`, `auth.jsx`. Keep the `timer.js` and `audio.js` entries, correcting `deriveTimerState`'s inputs.
- **EMOM timing logic** — replace the old formulas. Round and slot come from an absolute minute index: `slotIndex = m % slots.length`, `roundIndex = floor(m / slots.length)`, `totalRounds = workout.rounds`, `minutes = rounds × slots.length` (derived, display-only).
- **Audio cues** — unchanged, but state the invariant explicitly: audio dedupe keys on the absolute minute index.
- Add a short **Data model** section: exercise kinds, prescriptions being append-only, `movement`, and the `alternating`/`per_round` slot side.
- Add an **Environment** line: the two `VITE_` variables, and that no service-role key may ever be `VITE_`-prefixed.

- [ ] **Step 3: Full verification**

```bash
pnpm test && pnpm run build
```

Expected: all tests pass, build succeeds.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "refactor: remove bundled workouts.json and update project docs"
```

---

## Verification checklist

Before the branch is considered done:

- [ ] Public signup is disabled in the Supabase dashboard and exactly one user exists.
- [ ] `pnpm test` passes.
- [ ] `pnpm run build` succeeds.
- [ ] `grep -rn "workouts.json" src/` returns nothing.
- [ ] `grep -rni "service_role" .` returns nothing outside `docs/`.
- [ ] No `.env` file is tracked by git.
- [ ] `grep -rn "from('prescriptions')" src/` shows `select` and `insert` only — no `update`, no `delete`.
- [ ] Hinge Main, Rest minute of round 2: preview reads Sumo Deadlifts with **110** emphasised.
- [ ] Squat Accessory round 1 shows `[left]`, round 2 shows `[right]`.
- [ ] Editing a weight adds a `prescriptions` row and leaves the previous one untouched.
- [ ] Audio cues fire exactly as before: start ping, 10s warning, 3s warning, 30s halfway, completion melody.
