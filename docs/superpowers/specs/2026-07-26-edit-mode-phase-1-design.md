# Edit Mode — Phase 1

## Goal

Workout prescriptions (reps and weights) currently live in `src/workouts.json` and can only
be changed by hand-editing that file and pushing. In practice this means performance has to
be remembered from the gym until the user reaches a computer.

Phase 1 makes prescriptions editable from the phone, and records every change as queryable
data so weight and volume trends can be analysed later.

## Requirements

### Data

- Workout structure, exercises, and prescriptions are stored in Postgres (Supabase). The
  bundled `src/workouts.json` is removed; the database is the only source of truth.
- **Prescriptions are append-only.** Editing a prescription inserts a new row; nothing is
  ever updated or deleted. The current prescription for an exercise is its most recent row,
  and the full row history is the workout journal.
- Prescriptions (reps and weights) belong to the **exercise**, not to a workout slot. An
  exercise used by two workouts progresses in both simultaneously — this is intended.
- Exercises are one of four kinds:
  - **ramp_up** — constant reps, one weight per round (e.g. 6 reps at 80/90/110/100 kg).
  - **rep_range** — a min–max rep target at a single weight (e.g. 5–8 reps at 18.5 kg).
  - **fixed** — constant reps at a single weight.
  - **plain** — no numbers at all (Rest, Carry, Skip). Never has a prescription.
- Exercises carry a `movement` identifier so variants of the same movement can be grouped
  for trend analysis even when they are separate exercise records.
- A `ramp_up` exercise declares its own round count and may only be used in a workout with a
  matching round count. Its weight list length must equal that round count. Every other kind
  has exactly one weight.
- Laterality: whether an exercise is one-sided is a property of the exercise; how a given
  workout uses it is a property of the slot, and is either `alternating` (both sides within
  the minute) or `per_round` (left on odd rounds, right on even).
- Workouts declare an explicit round count. Total minutes is derived from rounds × slot
  count, and is display-only.
- Existing workout content is migrated into the database as seed data, matching the mapping
  agreed during design. Two workouts change shape as part of that migration:
  `squat_acc` becomes 2 slots × 6 rounds (was 4 × 3), and `upper_acc` becomes 4 rounds
  (was 3), extending it from 9 to 12 minutes.

### Editing

- Reps and weights can be edited from the workout detail screen, on a phone, after the
  workout. Editing during an active workout is out of scope.
- A ramp exercise presents one weight input per round. Other kinds present a single weight.
  Rep-range exercises expose both a minimum and a maximum.
- `plain` exercises are not editable.
- Because prescriptions are shared, the edit UI must show which workouts an edit will
  affect before it is saved.
- A failed save surfaces an error and leaves the user able to retry. No offline queueing.

### Timer display

- The active workout screen shows the current exercise's reps, name, and weight.
- For a ramp exercise, **all** weights are shown with the current round's weight visually
  emphasised, so the next weight can be read at a glance while loading plates.
- A one-line preview of the next exercise is shown, with the same emphasis applied to the
  weight **that upcoming round will use** — which may belong to the following round when the
  preview wraps past the last slot of the current one.
- Side labels are derived per round for `per_round` slots, and the next-exercise preview
  resolves the upcoming round's side, not the current one.
- A weight of zero (bodyweight movements) is not displayed.
- Existing timer behaviour must not change: one minute per slot, the ten-second start
  countdown, the start ping, the ten-second and three-second warnings, the halfway beep, the
  per-exercise background colours, pause/resume, and the completion melody.
- Background colour must remain stable for the whole of an exercise's minute even though its
  displayed text now varies by round.

### Access and availability

- The app requires authentication. It is a single-user application; any authenticated
  session is the owner, and public signup is disabled at the provider.
- Credentials that grant privileged database access must never reach the client bundle.
- The last successful read is cached locally and rendered when a fetch fails, marked clearly
  as stale. A first load on a device with no connectivity showing nothing is accepted.

### Validation

- A workout whose slots violate the ramp round-count rule must refuse to start, with a
  blocking error rather than a dismissible one — this is a failure that would otherwise
  surface mid-workout with the wrong weight on the bar.
- The database enforces the same rules independently of the app.

## Out of scope

Explicitly deferred to a later phase, and not to be built here:

- Creating, renaming, or deleting exercises.
- Creating or editing workouts: adding, removing, or reordering slots, changing round
  counts, changing which exercise a slot points at, or setting a slot's side.
- Recording per-session performance: actual reps achieved, subjective difficulty, or any
  row written on workout completion. A row is written **only** when a prescription changes.
- Charts, graphs, or any trend visualisation. Phase 1 only has to make the data queryable.
- Offline writes, retry queues, and multi-user support.

## Success criteria

1. A weight or rep change can be made on a phone, in a few taps, and is immediately
   reflected in the app.
2. Every change is persisted as a new row; no edit path performs an update or a delete, so
   the change history is complete and queryable by exercise and by date.
3. The seeded database reproduces the current training programme, including the two agreed
   structural changes to `squat_acc` and `upper_acc`.
4. During a ramp exercise, the weight for the next round is readable from the screen without
   arithmetic.
5. The next-exercise preview shows the correct weight and side when the upcoming slot falls
   in the following round.
6. All existing timer and audio behaviour is unchanged.
7. A database or network failure degrades to cached data with a stale indicator rather than
   an empty screen, and a failed save is reported rather than silently dropped.
8. The application builds, and the round/slot index arithmetic and display formatting are
   covered by automated tests.
