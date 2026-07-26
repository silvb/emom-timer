# EMOM Timer — Edit Mode: Phase 1 Handoff

Outcome of a design grilling session. Every decision below was argued and settled — the
rationale is included so Phase 1 doesn't relitigate it and Phase 2 doesn't contradict it.

---

## 1. Problem

`src/workouts.json` is both the workout template and, via git history, the workout journal.
49 of 53 commits touch it. The pain: prescriptions can only be changed at a computer, so
performance has to be held in memory from the gym until then.

**Goal:** edit reps and weights from the phone, and record every change as queryable data.

**Non-goal (Phase 1):** editing workout structure from the app.

---

## 2. Decisions

| # | Decision | Rationale |
|---|---|---|
| D1 | Verdict-only logging. No session rows, no actual reps, no RPE. | Progression rules stay in the user's head. A row is written only when a prescription changes. Accepted consequence: no way to distinguish one session at a weight from five. |
| D2 | Existing git history is abandoned. Start fresh. | Explicitly accepted. No backdating from commits. |
| D3 | Prescriptions (reps + weights) attach to the **exercise**, shared across workouts. | Monday and Friday lateral raises progress together — this is intended. |
| D4 | `ramp_up` exercises carry their own `rounds`. A ramp exercise may only be used in a workout with a matching round count. | A ramp needs one weight per round. Changing to a 3-round format means a **new exercise** with a new slug. |
| D5 | `movement` column groups exercise variants. | Without it, `sumo_deadlift_4r` and `sumo_deadlift_3r` are two unrelated trend lines joined only by a free-text name. One column now, unrecoverable later. |
| D6 | Prescriptions table is **append-only**. Current value = latest row. Exercise row never stores numbers. | Storing current-on-exercise plus a history table is a permanent sync problem. Append-only makes the journal a free side effect of the write path. |
| D7 | Slot side is one column with exactly two values: `side ∈ ('alternating','per_round')`. | `alternating` = both sides inside the minute (`10/10`). `per_round` = **left on odd rounds, right on even** (round 1 is left), one slot covering both sides across the workout. Explicit `left`/`right` values were considered and **rejected** — the only thing they buy is deliberately asymmetric programming, which is not planned. `per_round` still resolves to a left/right label at render time; that's derived, never stored. |
| D7b | `per_round` with an **odd** round count is unbalanced (3 rounds → 2 left, 1 right). The app warns; it does not block. | Balancing would require remembering the starting side across sessions, which D1 rules out. |
| D8 | `unilateral` is an **exercise** property; `side` is a **slot** property. | Gorilla Rows are inherently one-sided; whether a given workout does both sides in one round or splits them across rounds is per-slot. |
| D9 | Slots stay fixed at 1 minute. `Rest` survives as a real exercise used as filler. | Variable slot durations were considered and reverted — they break the per-minute audio cadence that jump-rope and carry workouts depend on. |
| D10 | Template holds explicit `rounds`. `minutes` becomes derived (`rounds × slot count`), display-only. | Removes the unenforced invariant where a ramp's weight-array length had to accidentally match `minutes / exercises.length`. |
| D11 | `src/workouts.json` is deleted. Workouts and slots live in Supabase from day one. | One source of truth. Accepted cost: a cold device with no signal shows nothing (see D13). |
| D12 | Supabase Auth, email + password, **single user**. No `user_id` columns; RLS policies are `to authenticated`. | ⚠️ **Public signups must be disabled in the Supabase dashboard — that toggle is the security boundary.** Without it, anyone who signs up reads and writes this data. |
| D13 | localStorage cache of the last successful read. Rendered with a "stale" marker when the fetch fails. | Replaces the offline floor the bundled JSON used to provide. First load on a new device still requires signal. |
| D14 | Write failures show an error toast. No queueing, no retry logic. | User trains with signal; manual retry is acceptable. |
| D15 | Editing happens in `DetailView`, after the workout. No mid-workout editing. | Confirmed — the "adjust between rounds" requirement was about physical plates, not data. |
| D16 | Deleting an exercise used by any slot must fail. | `on delete restrict` at the DB level, plus a pre-check in Phase 2's UI. |
| D17 | Two phases. Phase 1 = numbers only, structure seeded by script. Phase 2 = library + workout editor, separate PR, desktop **and** mobile. | Phase 1 solves the actual pain. Phase 2 is purely additive — no schema changes required. |

### Volume semantics (for the future data-viz feature, no code needed now)

- `ramp_up`: `reps × sum(weights)`, doubled when the slot is `alternating`. Fully derivable
  from the prescription row — no extra capture, ever.
- `rep_range`: **volume is not tracked.** Progress signal is weight-over-time only. Actual
  reps are deliberately not recorded (D1).
- Bodyweight is excluded (`@18.5kg` chin-ups is added weight, `@0` push-ups is zero).
  Volume is only ever comparable **within one movement over time**. Never sum across
  exercises.

---

## 3. Schema

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
  -- rounds is required for ramp_up and forbidden otherwise
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
```

### Cross-table invariants (not expressible as CHECK — use triggers)

1. **Weight array length.** For `ramp_up`, `array_length(weights,1) = exercises.rounds`.
   For every other type, `= 1`.
2. **Ramp/workout round match.** A slot referencing a `ramp_up` exercise requires
   `workouts.rounds = exercises.rounds`.
3. `plain` exercises have no prescription row, ever.
4. **Side matches laterality.** `exercises.unilateral = true` requires `workout_slots.side is not null`;
   `unilateral = false` requires `side is null`.
5. **Warn only:** `side = 'per_round'` on a workout with an odd `rounds` count is legal but
   unbalanced. Surface it in Phase 2's editor; no runtime block.

Enforce (1) and (2) with `before insert or update` triggers. The app must **also** check
them and refuse to start a workout that violates (2) — loud blocking error on the detail
view, not a dismissible toast. This is the failure that would otherwise surface at the rack.

### RLS

```sql
alter table exercises      enable row level security;
alter table prescriptions  enable row level security;
alter table workouts       enable row level security;
alter table workout_slots  enable row level security;

-- Single-user app: any authenticated session is the owner.
create policy owner_all on exercises     for all to authenticated using (true) with check (true);
create policy owner_all on prescriptions for all to authenticated using (true) with check (true);
create policy owner_all on workouts      for all to authenticated using (true) with check (true);
create policy owner_all on workout_slots for all to authenticated using (true) with check (true);
```

**Prerequisite, not optional:** disable public signups in Supabase Auth settings and create
the single account manually. These policies grant full access to *any* authenticated user.

### Environment

- `VITE_SUPABASE_URL`, `VITE_SUPABASE_PUBLISHABLE_KEY` — set in Vercel, safe to ship in the
  bundle. RLS is the boundary.
- **The service-role key must never appear in the client or in any `VITE_`-prefixed
  variable.** Vite inlines every `VITE_*` value into the built JavaScript.

---

## 4. Seed

One-time script. Parses the current `src/workouts.json`, inserts, gets committed for the
record, then never runs again. `effective_at` = seed time.

### Exercise mapping

| slug | type | rounds | reps | weights | unilateral |
|---|---|---|---|---|---|
| `nordic_curl` | fixed | — | 5 | 0 | false |
| `rest` | plain | — | — | — | false |
| `zercher_squat` | ramp_up | 4 | 10 | 45,50,60,60 | false |
| `lm_lateral_raise` | fixed | — | 12 | 2.5 | true |
| `kb_incline_press` | fixed | — | 10 | 16 | true |
| `overhead_press` | ramp_up | 4 | 8 | 35,40,45,40 | false |
| `gorilla_row` | fixed | — | 10 | 32 | true |
| `lm_meadows_row` | fixed | — | 10 | 22.5 | true |
| `ring_face_pull` | fixed | — | 12 | 0 | false |
| `chin_up` | rep_range | — | 5–8 | 18.5 | false |
| `goblet_squat` | fixed | — | 15 | 24 | false |
| `incline_bench_press` | fixed | — | 10 | 45 | false |
| `one_leg_kb_rdl` | fixed | — | 8 | 32 | true |
| `sumo_deadlift` | ramp_up | 4 | 6 | 80,90,110,100 | false |
| `push_up_on_kbs` | fixed | — | 20 | 0 | false |
| `cossack_squat` | fixed | — | 8 | 16 | true |
| `carry` | plain | — | — | — | false |
| `skip` | plain | — | — | — | false |

`movement` = `slug` for all seed rows. Variants diverge later.

Bodyweight exercises store `weights = [0]` — `nordic_curl`, `ring_face_pull`,
`push_up_on_kbs`. The renderer omits the weight entirely when it is 0, so these display as
`5 Nordic Curls`, not `5 Nordic Curls @0kg`.

### Workout mapping

| id | day | rounds | slots |
|---|---|---|---|
| `squat_main` | monday | 4 | nordic_curl, rest, zercher_squat |
| `squat_acc` | monday | **6** | lm_lateral_raise `per_round`, kb_incline_press `per_round` |
| `upper_main` | tuesday | 4 | overhead_press, gorilla_row `alternating`, rest |
| `upper_acc` | tuesday | **4** | lm_meadows_row `per_round`, rest, ring_face_pull |
| `full_body` | thursday | 4 | chin_up, goblet_squat, incline_bench_press, one_leg_kb_rdl `per_round` |
| `hinge_main` | friday | 4 | sumo_deadlift, push_up_on_kbs, rest |
| `hinge_acc` | friday | 3 | cossack_squat `alternating`, lm_lateral_raise `alternating` |
| `loaded_carries` | — | 5 | carry |
| `jump_rope` | — | 7 | skip |

`squat_acc` is the D7 collapse — 4 slots × 3 rounds became 2 slots × 6 rounds. Same 12
minutes, same 3 sets per side per exercise, same left/right pairing within each round pair.

`upper_acc` goes from 3 rounds to **4** (9 min → 12 min) so `lm_meadows_row` at `per_round`
balances at 2 left / 2 right. Every `per_round` slot in the seed now sits in an even-round
workout — invariant 5 is satisfied throughout, and nothing triggers the warning.

All three ramp exercises land in 4-round workouts — invariant (2) holds for the seed.

No open seed questions.

---

## 5. Phase 1 scope

### New

- `src/db.js` — Supabase client, typed fetches, single-payload localStorage cache
  (exercises + current prescriptions + workouts + slots written as one blob after every
  successful load).
- Login gate — email + password, session persisted by the Supabase client. Blocks the app
  until authenticated.
- `src/render.js` — turns `(exercise, prescription, slot, roundIndex)` into **structured
  parts**, not a string. The ramp highlight requires per-weight markup, so a formatted
  string is not sufficient.
- Edit mode in `DetailView` — tap a slot, edit reps (`reps_min`/`reps_max`) and N weight
  inputs (N = 1, or `rounds` for a ramp), save. One INSERT into `prescriptions`, then
  refetch. `plain` slots are not editable.
- Error toast on write failure. Stale marker when rendering from cache.

### Changed

- `App.jsx` — workouts become async. Needs loading / error / stale states and the auth gate.
  `assignColors` moves to after data load.
- `timer.js`
  - `deriveTimerState` takes `{ rounds, slots }` instead of `{ minutes, exercises }`.
  - `totalRounds` reads `workout.rounds` directly (was `minutes / exercises.length`).
  - **`assignColors` must key on exercise slug, not the display string** (`timer.js:47`).
    Display strings now carry a per-round weight, so string keys would change the background
    color every round.
  - **`isRest` must become a check for the `rest` slug specifically** (`timer.js:31`), not
    for type `plain` — `carry` and `skip` are also `plain` but must stay visible in the
    schedule.
- `DetailView.jsx` — `rounds()` stops deriving from `minutes` (`DetailView.jsx:4`); minutes
  becomes the derived value. Exercise list renders from slot + prescription.
- `ActiveView.jsx` — see below.
- `CLAUDE.md` — the entire data-flow and EMOM-timing section is wrong once this lands.

### Deleted

- `src/workouts.json`

### ActiveView rendering spec

Current exercise: reps (or range), name, weight.
- `ramp_up`: render **all** weights, with the current round's weight bold and slightly
  larger.
- Next-exercise preview: one line, same treatment — for a ramp, all weights with the weight
  **that round will use** highlighted.

This is what makes the plate workflow work: during the sumo minute the full ramp is on
screen, so the next round's weight is readable while there's still ~30s left in the set.

Side labels render from the slot: `alternating` → `10/10`; `per_round` → `[left]` on odd
rounds, `[right]` on even, derived from the round index. The next-exercise preview must
resolve the **next** round's side, not the current one — same absolute-minute-index math as
the weight highlight.

**Off-by-one trap.** The next slot may wrap into the next round. Derive both from an
absolute minute index rather than from `currentRound`:

```js
const m    = Math.floor(elapsed / 60);
const L    = workout.slots.length;
const cur  = { slot: m % L,       roundIdx: Math.floor(m / L) };
const next = { slot: (m + 1) % L, roundIdx: Math.floor((m + 1) / L) };
// highlight weights[roundIdx] for each
```

Concrete failure this avoids — `hinge_main`, slots `[sumo, pushups, rest]`, 4 rounds: at
round 2 / slot 3, the next sumo set is round 3 at **110kg**. Naive code reading
`currentRound` shows 90kg — wrong weight on the bar.

Also needs the new renderer: the countdown screen's `First up:` line
(`ActiveView.jsx:139`).

### Editing a shared exercise

D3 means editing `lm_lateral_raise` changes both `squat_acc` and `hinge_acc`. The edit UI
should say so — list the workouts affected — so it isn't a surprise.

---

## 6. Phase 2 (separate PR, do not build now)

- Exercise library CRUD — create with type, `movement`, `rounds`, `unilateral`, initial
  prescription.
- Workout editor — create/rename, day, round count.
- Slot editor — add, remove, reorder, set `side`.
- Delete guard — check `workout_slots` before allowing an exercise delete, surface which
  workouts block it (`on delete restrict` is the backstop, not the UX).
- Desktop **and** mobile.

Until it exists, structural changes are SQL in the Supabase dashboard — roughly once per
training block, from the computer.

## 7. Forward-compat constraints Phase 1 must honor

Phase 2 must require **zero schema migrations**. That means Phase 1 has to ship:

1. `workouts` and `workout_slots` as real tables — not JSON, not hardcoded.
2. `movement` populated on every exercise, even when it equals the slug.
3. Text slugs as primary keys, stable and hand-written.
4. `on delete restrict` on both foreign keys to `exercises`.
5. `workout_slots.position` as a plain int, so Phase 2 reorder is a rewrite of the set.
6. `prescriptions` written only by INSERT. Any UPDATE path added in Phase 1 destroys the
   journal and is the one thing Phase 2 cannot repair.
