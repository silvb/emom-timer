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

SolidJS single-page app. No router library — navigation is a `view` signal in `App.jsx` with values `'schedule' | 'detail' | 'active'`.

**Data flow:**
- Supabase is the only source of truth — tables `exercises`, `prescriptions`, `workouts`, `workout_slots`, plus a `current_prescriptions` view (`distinct on (exercise_slug)`, latest row per exercise)
- `db.js` — `loadProgramme()` fetches all four tables, calls `shapeProgramme`, and caches the result in localStorage; on fetch failure it falls back to the cache and marks the data `stale`. `savePrescription()` inserts a new `prescriptions` row.
- `model.js` — `shapeProgramme(exerciseRows, prescriptionRows, workoutRows, slotRows)` turns the flat table reads into the nested `{ workouts, exercises }` shape the views consume; `validateWorkout(workout)` returns human-readable problems (missing prescriptions, wrong weight counts) before a workout can start
- `App.jsx` — loads the programme once via `createResource(loadProgramme)` behind `LoginGate`; holds top-level signals (`view`, `selectedId`, `colorMap`, `toast`) and passes callbacks down to views
- Views live in `views/` and are stateless except for `ActiveView`

**Key modules:**
- `timer.js` — pure function `deriveTimerState(elapsed, workout, phase)` that derives all display state from elapsed seconds; no side effects, easy to test
- `render.js` — pure functions (`describeSlot`, `repsText`, `weightParts`, `sideLabel`) that turn a slot plus a round index into display parts, not a formatted string, so the active screen can emphasise one weight inside a ramp
- `db.js` — Supabase I/O: fetch, localStorage cache fallback, append-only `savePrescription`
- `auth.jsx` — session signal backed by `supabase.auth`, plus the `LoginGate` component that shows a sign-in form until a session exists
- `audio.js` — Web Audio API with lazy `AudioContext` initialization; `resumeAudio()` must be called from a user gesture before sounds will play
- `ActiveView.jsx` — owns the interval (100ms ticks, 0.1s increments), a 10-second countdown phase before the workout starts, pause/resume logic, and `createEffect` hooks that trigger audio cues
- `components/ExerciseLine.jsx`, `components/Toast.jsx`, `views/EditSlotSheet.jsx` — presentational pieces; the edit sheet is the only place that calls `savePrescription`

**EMOM timing logic** (in `timer.js`):
- Each slot gets exactly 1 minute
- Round and slot come from an absolute minute index `m = floor(elapsed / 60)`: `slotIndex = m % slots.length`, `roundIndex = floor(m / slots.length)`
- `totalRounds = workout.rounds` (source of truth); `minutes = rounds * slots.length` is derived and display-only — this inverts the old relationship where rounds were derived from minutes

**Audio cues** (in `ActiveView.jsx`):
- Warning beeps at 3 seconds left in each round
- Halfway beep at 30 seconds into each round
- Warning beeps also fire during the last 3 seconds of the countdown
- The dedupe key is the absolute minute index (`floor(elapsed / 60)`), not `roundIndex`, which resets every round

## Data model

- Exercise `type`: `ramp_up` (constant reps, one weight per round), `rep_range` (min–max reps, one weight), `fixed`, `plain` (no numbers — Rest, Carry, Skip; never has a prescription)
- `prescriptions` is **append-only**: one row per change, and that row history is the user's training journal. There is no update or delete RLS policy — the app only ever `select`s and `insert`s. `current_prescriptions` exposes just the latest row per exercise.
- `movement` groups exercise variants together for trend analysis (e.g. different Squat variants share a movement)
- Slot `side`: `alternating` (both sides done within the minute) or `per_round` (left on even `roundIndex`, right on odd — round 1 is left)

## Environment

`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are required and safe to ship in the client bundle — RLS is the security boundary, not secrecy of these values. A service-role key must never be assigned to a `VITE_`-prefixed variable or committed to any file: Vite inlines every `VITE_*` value into the built JavaScript.
