# Edit mode phase 1 — review fix summary

Resolution pass over the blind PR review
(`2026-07-26-edit-mode-phase-1-pr-review.md`), done with the spec, the plan and
the design decisions in hand.

## C1 (Critical as filed) — seed data — not a defect, no change

The reviewer flagged five prescriptions that differ from the deleted
`src/workouts.json`: `nordic_curl` 5 reps, `ring_face_pull` 12 reps,
`hinge_acc`'s lateral raises as `alternating`, and `one_leg_kb_rdl` and
`lm_meadows_row` as `per_round`. All five were explicit owner decisions in the
design session and have been re-confirmed. The seed is correct; nothing was
touched. The reviewer was right that the diff carries no record of the intent —
that is what this file is for.

## I1 — narrowed the write-open RLS policies — fixed

`exercises`, `workouts` and `workout_slots` carried
`for all to authenticated using (true) with check (true)`, but `src/db.js` only
ever SELECTs them and `savePrescription` touches `prescriptions` alone. The
publishable key ships in the bundle, so a stolen password — or a stray
`.delete()` in a later refactor — could have dropped the workout structure.

`supabase/migrations/0006_narrow_policies.sql` drops the three `owner_all`
policies and replaces them with `owner_read`, `for select to authenticated`.
Applied to `eragwvimbqhiytpgpdbv`. Phase-2 admin edits are documented as
dashboard SQL run by the service role, which bypasses RLS, so no documented
workflow is blocked.

Verified empirically as `authenticated`, inside a rolled-back transaction:

```
SELECT exercises                     ALLOWED, 18 rows visible
SELECT workouts                      ALLOWED, 9 rows visible
SELECT workout_slots                 ALLOWED, 22 rows visible
INSERT exercises                     DENIED: new row violates row-level security policy for table "exercises"
INSERT workouts                      DENIED: new row violates row-level security policy for table "workouts"
INSERT workout_slots                 DENIED: new row violates row-level security policy for table "workout_slots"
UPDATE exercises                     DENIED: 0 rows matched (no UPDATE policy)
UPDATE workouts                      DENIED: 0 rows matched (no UPDATE policy)
UPDATE workout_slots                 DENIED: 0 rows matched (no UPDATE policy)
DELETE workout_slots                 DENIED: 0 rows matched (no DELETE policy)
DELETE workouts                      DENIED: 0 rows matched (no DELETE policy)
DELETE exercises                     DENIED: 0 rows matched (no DELETE policy)
still-intact check                   exercises=18 workouts=9 slots=22
```

Note the asymmetry, which is normal Postgres RLS: INSERT raises, while
UPDATE/DELETE simply match zero rows because no policy makes any row visible to
those commands. Both are denials; only one is loud.

The app's own read path was checked in the same way and still works —
`SELECT current_prescriptions` returns 15 rows and `INSERT prescriptions` (the
edit path) is still ALLOWED.

Row counts after everything rolled back, unchanged from the baseline taken
before the migration: **18 exercises, 15 prescriptions, 9 workouts, 22 slots**,
`nordic_curl` still named "Nordic Curls", `max(prescriptions.id) = 22`.

Policies now in `public`: `exercises:owner_read:SELECT`,
`workouts:owner_read:SELECT`, `workout_slots:owner_read:SELECT`,
`prescriptions:prescriptions_read:SELECT`,
`prescriptions:prescriptions_insert:INSERT`.

## I2 — made the current ramp weight actually stand out — fixed

`.ex-weight-current` relied on `font-weight: 700` and `font-size: 1.08em`, and
`.ex-weight` had no rule at all. The active screen is Bebas Neue, imported at a
single weight, so the bold could only ever be synthetic faux-bold: about 4px and
a smudge, at 40-60px, on a saturated background, read mid-set. That is success
criterion 4.

Non-current weights are now de-emphasised directly:

```css
.active-view .ex-weight         { opacity: 0.5; }
.active-view .ex-weight-current { opacity: 1; font-size: 1.15em; }
```

**Why that selector cannot dim the detail and schedule screens.** Both call
`describeSlot(slot, null)`. In `weightParts`, a null round sets `highlight = -1`,
so *every* weight on those screens is `current: false` — an unscoped
`.ex-weight` rule, or a `:not(.ex-weight-current)` rule, would dim all of them
and emphasise nothing. Scoping to `.active-view` is what makes the rule safe:
inside it, `roundIndex` is always a real number (running/paused pass
`state().roundIndex` and `state().next.roundIndex`; the countdown passes a
literal `0`), so exactly one weight is current whenever any weight is shown.
Specificity works out because both rules are `(0,2,0)` and the `-current` rule
comes second. No `border-radius` was introduced.

## I3 — tested the edit validation — fixed

`validationError` in `EditSlotSheet.jsx` was the only thing between a
fat-fingered phone input and a permanent row in an append-only journal, and no
test imported it.

Extracted to `prescriptionFormError` in **`src/model.js`** rather than a new
`src/validation.js`. `model.js` already owns `validateWorkout`, which enforces
the same two invariants ("a ramp has one weight per round, everything else has
exactly one") one step later, on shaped data. Splitting the same rules across
two files is how they drift; a reader who changes one now has the other on
screen. `model.js` stays pure and DOM-free, so it tests the same way.

`EditSlotSheet` now only gathers field values and calls it — the logic is not
duplicated. The function takes raw strings deliberately, since `Number('')` is
`0` and `0` is a legitimate bodyweight prescription.

19 tests added, covering: emptied weight, whitespace-only weight, a blank in the
middle of a ramp, `0` accepted, negative weight, non-numeric weight, emptied
reps, fractional reps, reps below 1, `reps_max < reps_min`, fractional max, ramp
with too few / too many weights, non-ramp with more than one weight, empty
weight list, and a valid case of `fixed`, `rep_range`, `ramp_up` and a
bodyweight-zero prescription.

## Minor findings

**Taken:**

- **Cache age in the stale banner.** `loadProgramme` now returns `cachedAt`, and
  the banner reads "Offline — showing workouts saved 3 days ago." Formatting is
  `cacheAgeText` in `render.js` (pure, 4 tests, coarse on purpose: just now /
  minutes / hours / days). Falls back to "earlier" for cache entries written
  before the field existed, and clamps a backwards clock to "just now".
- **`<Show keyed>` in `DetailView`.** A truthy-to-truthy slot swap would have
  reused the mounted sheet with the previous exercise's captured form state.
  Unreachable today because the backdrop covers the list — and cheap to make
  unreachable by construction instead.
- **Tappable affordance vs. `editSlot`.** Both now go through one
  `isEditable(slot)` predicate, so a slot with a missing exercise no longer
  looks tappable while doing nothing.
- **Dead auth exports.** `signOut` is now wired: a small muted "Sign out" at the
  bottom of the schedule screen, deliberately nowhere near the detail or active
  screens, where a mis-tap would end a workout. `useSession` was deleted —
  `LoginGate` closes over the signal directly and nothing else ever read it.
- **False comment in `render.test.js`.** Checked against the live rows:
  `numeric[]` serialises as JSON numbers (`[80,90,110,100]`, and `to_json` agrees),
  not strings. The comment now says the coercion is defensive rather than
  documenting a premise that is not true.
- **Mutable `search_path` on the five trigger functions.**
  `0007_function_search_path.sql` pins `public, pg_temp` on
  `check_prescription_shape`, `check_slot_shape`, `check_workout_rounds`,
  `check_exercise_update` and `reject_prescription_mutation`. Applied and
  confirmed in `pg_proc.proconfig`; the advisor warnings are gone.

**Skipped, as instructed and recorded as accepted:** the `every(v => v === 0)`
weight-hiding rule, the `Math.min` clamp in `weightParts`, `createClient`
throwing at import on missing env, the per-tick `describeSlot` allocation, and
`movement` currently equalling `slug` for every row.

## Disagreements and notes

- Nothing in the fix list was refused. The one place I deviated from the letter
  of the instruction is I3's location: `model.js` instead of a new
  `src/validation.js`, for the cohesion reason above. The instruction explicitly
  allowed that call.
- I2 uses `opacity: 0.5` rather than something darker. The non-current weights
  still have to be *readable* — the ramp is shown in full precisely so the next
  round's weight needs no arithmetic — so the goal was clear ranking, not
  hiding.
- Two Supabase advisor warnings remain, both deliberate or out of scope:
  `prescriptions_insert` is `with check (true)`, which is the append path the
  app requires in a single-user design; and leaked-password protection is off,
  a dashboard auth toggle, not something this branch should flip unannounced.
  Worth turning on, since the account password is the whole boundary.

## Verification

- `pnpm test` — **62 passed** (was 39; +19 validation, +4 cache-age).
- `pnpm run build` — clean.
- `grep -rn "\.update(\|\.delete(\|\.upsert(" src/` — no matches. `prescriptions`
  remains append-only, in the client and in the database.
- Row counts confirmed unchanged after all probing: 18 / 15 / 9 / 22.
