# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
pnpm run dev      # start dev server (Vite)
pnpm run build    # production build
pnpm run preview  # preview production build
pnpm test         # run the Vitest suite once
pnpm test:watch   # run Vitest in watch mode
```

Node version: 22.12 (see .nvmrc).

## Architecture

SolidJS single-page app. No router library — navigation is a `view` signal in `App.jsx` with values `'schedule' | 'detail' | 'active' | 'library'`.

**Data flow:**
- Supabase is the only source of truth — tables `exercises`, `prescriptions`, `workouts`, `workout_slots`, plus a `current_prescriptions` view (`distinct on (exercise_slug)`, latest row per exercise)
- `db.js` — `loadProgramme()` fetches all four tables, calls `shapeProgramme`, and caches the result in localStorage; on fetch failure it falls back to the cache and marks the data `stale`. `savePrescription()` inserts a new `prescriptions` row. Phase 2 added the structural writes: `createExercise`, `updateExercise`, `setExerciseArchived`, `deleteExercise`, `createWorkout`, `updateWorkout`, `deleteWorkout`, and `saveWorkoutSlots` (the one RPC).
- `model.js` — `shapeProgramme(exerciseRows, prescriptionRows, workoutRows, slotRows)` turns the flat table reads into the nested `{ workouts, exercises }` shape the views consume; `validateWorkout(workout)` returns human-readable problems (missing prescriptions, wrong weight counts) before a workout can start
- `App.jsx` — loads the programme once via `createResource(loadProgramme)` behind `LoginGate`; holds top-level signals (`view`, `selectedId`, `colorMap`, `toast`) and passes callbacks down to views
- Views live in `views/`; most are stateless, but `ActiveView` (elapsed/phase), `DetailView` (`editingSlot`), and `EditSlotSheet` (`repsMin`, `repsMax`, `weights`, `formError`, `busy`) hold their own signals

**Key modules:**
- `timer.js` — pure function `deriveTimerState(elapsed, workout, phase)` that derives all display state from elapsed seconds; no side effects, easy to test
- `render.js` — pure functions (`describeSlot`, `repsText`, `weightParts`, `sideLabel`) that turn a slot plus a round index into display parts, not a formatted string, so the active screen can emphasise one weight inside a ramp
- `db.js` — Supabase I/O: fetch, localStorage cache fallback, append-only `savePrescription`
- `auth.jsx` — session signal backed by `supabase.auth`, plus the `LoginGate` component that shows a sign-in form until a session exists
- `audio.js` — Web Audio API with lazy `AudioContext` initialization; `resumeAudio()` must be called from a user gesture before sounds will play
- `ActiveView.jsx` — owns the interval (100ms ticks, 0.1s increments), a 10-second countdown phase before the workout starts, pause/resume logic, and `createEffect` hooks that trigger audio cues
- `components/ExerciseLine.jsx`, `components/Toast.jsx`, `views/EditSlotSheet.jsx` — presentational pieces; the edit sheet is the only place that calls `savePrescription`
- `structure.js` — pure logic for structural editing: `deriveSlug`, `moveItem`, `nextPosition`, `exerciseFormError`, `workoutFormError`, `lockedExerciseFields`, `usedByWorkouts`, `deleteBlockedReason`, `eligibleExercises`, `defaultSide`, `sideWarnings`, `MAX_ROUNDS`. Mirrors the database triggers so a refusal can be explained before Postgres raises it. `exerciseFormError`/`workoutFormError` take an optional `currentSlug`/`currentId` (not an `isNew` flag) to exclude the record's own identifier from the uniqueness check — the uniqueness check always runs, so an edit can never collide with a *different* record's identifier.
- `views/ExerciseLibraryView.jsx`, `views/ExerciseFormSheet.jsx`, `views/WorkoutFormSheet.jsx`, `views/AddSlotSheet.jsx` — the Phase 2 structural editors.

**EMOM timing logic** (in `timer.js`):
- Each slot gets exactly 1 minute
- Round and slot come from an absolute minute index `m = floor(elapsed / 60)`: `slotIndex = m % slots.length`, `roundIndex = floor(m / slots.length)`
- `totalRounds = workout.rounds` (source of truth); `minutes = rounds * slots.length` is derived and display-only — this inverts the old relationship where rounds were derived from minutes

**Audio cues** (in `ActiveView.jsx`):
- Start ping at second 0 of each exercise (including the first)
- 10-second warning
- Warning beeps at 3 seconds left in each round
- Halfway beep at 30 seconds into each round
- Warning beeps also fire during the last 3 seconds of the countdown
- Success melody when the workout completes, instead of the next start ping
- The dedupe key is the absolute minute index (`floor(elapsed / 60)`), not `roundIndex`, which resets every round

## Data model

- Exercise `type`: `ramp_up` (constant reps, one weight per round), `rep_range` (min–max reps, one weight), `fixed`, `plain` (no numbers — Rest, Carry, Skip; never has a prescription)
- `prescriptions` is **append-only**: one row per change, and that row history is the user's training journal. There is no update or delete RLS policy — the app only ever `select`s and `insert`s. `current_prescriptions` exposes just the latest row per exercise.
- `movement` groups exercise variants together for trend analysis (e.g. different Squat variants share a movement)
- Slot `side`: `alternating` (both sides done within the minute) or `per_round` (left on even `roundIndex`, right on odd — round 1 is left); whether a slot needs a side at all is determined by the exercise's `unilateral` flag, enforced by the `check_slot_shape` DB trigger
- `exercises`, `workouts` and `workout_slots` were **read-only to `authenticated`** under `0006_narrow_policies.sql` (`owner_read`, select only); `0008_structural_write_policies.sql` re-granted insert/update/delete on all three so Phase 2's structural editors can write from the client. This is a deliberate, recorded trade-off, not an oversight — the publishable key ships in the client bundle, so the single account's password is the whole boundary. `prescriptions` is unaffected: its append-only trigger (`0005`) still rejects update and delete for every role.
- Edit-form rules live in `prescriptionFormError` (`model.js`), not in the sheet, so they are unit-testable. It takes the raw input **strings**: `Number('')` is `0` and `0` is a legitimate bodyweight prescription, so blank fields must be caught before any coercion.
- Structural writes go directly to the tables via `0008`'s policies, with one exception: the slot set. `save_workout_slots(workout_id, slots)` (`0010`) rewrites it inside a single transaction, because delete-then-insert over the REST layer is two requests and a failure between them empties the workout. It is `security invoker` (not `security definer`), so RLS still applies — the function only runs the two statements atomically, it grants no privilege the client didn't already have from `0008`.
- `exercises.archived` (`0009`) is how an exercise is retired. It cannot be deleted once it has prescriptions — `on delete restrict` protects the journal — so archiving hides it from the add-slot picker and the default library listing without destroying anything. Delete is still offered on every library row rather than hidden where it cannot work: `deleteBlockedReason` refuses it naming every blocker (the workouts holding a slot, and the prescription), because a button that is simply absent explains nothing.
- Some exercise edits have no valid statement order once data is attached: `check_exercise_update` re-validates every existing prescription and slot, so a ramp's round count cannot be changed in place. `lockedExerciseFields` detects this and the editor offers duplication instead, per D4.

## Gotchas

- The hazard isn't destructuring itself, it's reading a prop that can change while the component stays mounted: destructuring reads each getter once, at mount, so a view whose data changes underneath it (e.g. `DetailView` across a save-triggered `refetch()`) keeps rendering stale values. Use `props.x` at every call site for anything that can change post-mount. `ActiveView.jsx` still destructures its props, but safely — `Switch`/`Match` unmounts and remounts it on every view change, so there's never a stale-read window. `ScheduleView.jsx` no longer destructures: it reads `props.stale`, which flips on a refetch while the view stays mounted (the `stale` gate on "New workout" and "Exercises" needs the live value).
- `DetailView`'s edit mode holds a local draft of the slot list and writes it once on Save. Intermediate reorders never reach the database, and a failed save leaves the draft intact for retry because `save_workout_slots` is atomic against a server-side rejection.
- `deriveTimerState`'s phase argument must route `paused` down the `running` branch (`phase() === 'countdown' ? 'countdown' : 'running'`) — sending `paused` to the countdown branch returns a shape with no `.slot`, which throws as soon as Pause is pressed.
- `DetailView`'s `saveSlots()` deliberately splits its two awaits (the `save_workout_slots` call and the `onSaved` refetch) into separate `try`/`catch` blocks rather than one. A failure in the first means nothing changed — the draft stays open and "try again" is correct. A failure in the second means the write already committed and only the refresh failed, so the draft still clears and the message must not imply retrying the save. Merging them back into one try/catch would let the UI claim nothing changed after a write that actually landed. The same split now applies in `EditSlotSheet`, `ExerciseFormSheet`, `WorkoutFormSheet` and `ExerciseLibraryView`: every surface awaits its refetch and reports a refresh failure as a refresh failure.
- A refetch that cannot reach the network **does not reject** — `loadProgramme` falls back to the cache and resolves with `stale: true`. So a post-save `catch` on the refetch almost never fires; the realistic failure is a silent stale re-render showing the pre-save state. Any write path that re-reads to confirm has to check `props.stale` after the await, not just catch a rejection. `DetailView` does; the sheets close on save and rely on the app-level stale banner instead.
- Post-save messages in `DetailView` go through `props.onError` (the app-level toast), not `setEditError`. The in-sheet error paragraph only renders inside the edit-mode block, so a message set on a path that also clears the draft would be written and unmounted in the same tick.
- `ExerciseFormSheet`'s weight inputs write through `syncedWeights()`, never through the raw `weights` signal directly. `weights` starts at length 1 and is never resized on its own; the rendered input count comes from the round count, so a positional write (`weights().map(...)`) past index 0 would silently drop every value beyond the backing array's length while the input still displayed the typed text. `syncedWeights()` pads the array to the rendered length first, so the write always lands. The bug this prevents is invisible in the UI — it only surfaces as a validation error at save time.

## Environment

`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are required and safe to ship in the client bundle — RLS is the security boundary, not secrecy of these values. A service-role key must never be assigned to a `VITE_`-prefixed variable or committed to any file: Vite inlines every `VITE_*` value into the built JavaScript.
