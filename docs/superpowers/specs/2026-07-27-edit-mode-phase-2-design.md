# Edit Mode Phase 2 — Structural Editing

## Goal

Create and change the *structure* of the training programme from the app — on a
phone or a desktop — instead of hand-writing SQL in the Supabase dashboard.

Phase 1 made the numbers editable: reps and weights are recorded from the gym as
an append-only journal. Everything else about the programme — which exercises
exist, which workouts exist, and which exercise occupies which minute — is still
read-only to the app and can only be changed with dashboard SQL. This phase
closes that gap.

## Background

The app is a single-user EMOM (every-minute-on-the-minute) workout timer. A
workout is an ordered list of *slots*, each exactly one minute long, repeated for
a fixed number of *rounds*. Slots reference *exercises*; exercises carry an
append-only history of *prescriptions* (reps and weights).

Exercises come in four kinds:

- `ramp_up` — constant reps, one weight per round, so the load climbs across the
  workout. Carries its own round count.
- `rep_range` — a min–max rep range with one weight.
- `fixed` — one rep count, one weight.
- `plain` — no numbers at all (Rest, Carry, Skip). Never has a prescription.

An exercise may be `unilateral` (one side at a time). A slot holding a unilateral
exercise must declare a `side`: `alternating` (both sides within the minute) or
`per_round` (left on odd rounds, right on even).

Exercises also carry a `movement`, which groups variants of the same lift so
their progress can be compared over time even when they are separate exercises.

The database enforces a set of cross-table rules on every write, independently of
the app. This phase must work within them, not around them:

1. A `ramp_up` exercise's prescription holds exactly one weight per round; every
   other kind holds exactly one weight.
2. A slot may only use a `ramp_up` exercise in a workout whose round count
   matches the exercise's.
3. A `plain` exercise never has a prescription.
4. A unilateral exercise's slots must set a side; a non-unilateral exercise's
   slots must not.
5. A `per_round` slot in a workout with an odd round count is legal but
   unbalanced (3 rounds gives 2 left, 1 right). Warn, never block.

## Requirements

### Exercise library

- A dedicated library screen lists every exercise, reachable from the schedule.
- Create an exercise: name, movement, kind, round count (`ramp_up` only),
  unilateral flag, and — for every kind except `plain` — its opening
  prescription.
- The identifier is derived from the name, shown before saving, and editable at
  that point. Once created it never changes.
- The movement field offers the movements already in use, plus the option to
  start a new one. A new exercise defaults to its own identifier as its movement.
- Edit an existing exercise's name and movement freely.
- Kind, round count and unilateral flag are fixed once anything references the
  exercise — see *Blocked edits* below.

### Workout editor

- Create a workout: title, day of the week (optional — some workouts are
  unscheduled), and round count.
- Rename an existing workout, change its day, and change its round count.
- Delete a workout. Its slots go with it; the exercises and their journals do
  not.

### Slot editor

- A workout's detail screen has an explicit edit mode, entered deliberately and
  exited deliberately. Outside edit mode the screen behaves exactly as it does
  today.
- In edit mode: add a slot, remove a slot, move a slot up or down, and set a
  slot's side.
- The exercise picker for a new slot excludes retired exercises, and excludes
  exercises that cannot legally sit in this workout (rule 2).
- Saving a reordered or edited slot set is **all-or-nothing**. A failure part way
  through must never leave a workout with a partial, duplicated or empty slot
  set. This is the failure that would otherwise be discovered at the rack.

### Retiring and deleting exercises

- An exercise that has ever had a prescription cannot be destroyed — the journal
  is the point of the app. Retiring must therefore be a first-class action,
  distinct from deletion: a retired exercise disappears from the add-slot picker
  and from the default library listing, keeps its history intact, and can be
  brought back.
- Retiring an exercise still used by a slot is refused, naming the workouts that
  hold it.
- Permanent deletion is offered only when nothing references the exercise at all
  — no slots, no prescriptions. When it is refused, the reason names what is
  blocking it.

### Blocked edits

Some changes are impossible while an exercise has data attached, because they
would invalidate existing prescriptions or slots. Changing a `ramp_up`
exercise's round count is the main one: its existing prescription holds one
weight per round, so a new round count contradicts it, and there is no order of
operations that satisfies both.

This is by design — a different round count is a different exercise, kept
separate so the two progress independently.

- Fields locked by attached data are shown disabled, with the reason stated in
  the UI.
- Where a lock is hit, the editor offers to **duplicate the exercise as a new
  one**: the name and movement carry over, the identifier is new, and the new
  settings and opening prescription are chosen fresh. The original and its
  history are untouched, and the shared movement keeps the two comparable.

### Guardrails

- A `per_round` slot in an odd-round workout shows a non-blocking warning
  explaining the imbalance.
- Editing an exercise affects every workout that uses it. Any edit screen for a
  shared exercise names the workouts it will change, before the change is made.
- Every write failure surfaces visibly. No edit may appear to succeed when it did
  not.

### Offline

- The app already falls back to a cached copy of the programme when it cannot
  reach the network, and marks it as stale.
- Structural editing is unavailable while showing stale data. Editing a stale
  copy of a slot set risks overwriting good data with old data.
- Editing reps and weights continues to work exactly as it does today, stale or
  not — those writes only ever add to the journal and cannot destroy anything.

### Reach

Usable on a phone and on a desktop browser. Reordering uses explicit move
controls rather than dragging.

## Out of scope

- Reordering workouts within a day, or moving a workout between days by
  reordering. Setting a workout's day is in scope; a new workout is appended.
- Editing during a running workout. Structural editing is a planning activity.
- Any change to the timer, the audio cues, or the active workout screen.
- Bulk import or export.
- Undo history for structural edits. The prescription journal is unaffected and
  keeps its full history.

## Must not change

- The schedule → workout detail → Start → active timer path, and everything on
  the active screen, behave exactly as they do now.
- Prescriptions remain append-only: new rows only, never modified, never removed.
  This is the user's training journal and it is the one thing that cannot be
  rebuilt.
- The five database rules above stay enforced for every write, including writes
  this phase introduces.
- The app remains usable with no network, from cache, for the purpose of running
  a workout.

## Success criteria

The following can be done entirely in the app, on a phone, with no dashboard SQL:

1. Create a new exercise, including a `ramp_up` one with a per-round weight
   ramp, and give it an opening prescription.
2. Add that exercise to an existing workout, position it, and — if it is
   unilateral — set how its sides are handled.
3. Reorder and remove slots in a workout, and see the change reflected on the
   active timer screen when the workout is run.
4. Create a new workout from scratch, set its day and round count, populate it
   with slots, and start it.
5. Change an existing workout's round count, and be stopped with a clear
   explanation when a ramp exercise in it makes that impossible.
6. Attempt to change a `ramp_up` exercise's round count, be told why it is
   locked, and use the offered duplicate flow to get a new exercise at the new
   round count with the original's history left intact.
7. Retire an exercise no longer in use and confirm it disappears from the picker
   while its history survives; bring it back.
8. Be refused, with the blocking workouts named, when retiring or deleting an
   exercise still in use.

And:

9. A slot save interrupted by a network failure leaves the workout exactly as it
   was — never partially written.
10. Structural editing is unavailable while the stale-data banner is showing,
    while rep and weight editing still works.
11. The existing test suite still passes, and the logic introduced here that can
    be tested without a browser is covered by tests.
