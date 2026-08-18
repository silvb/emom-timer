# EMOM Timer

A phone-first EMOM (Every Minute On the Minute) workout timer and training journal.

Each minute of a workout is one exercise slot: the app shows what to do, with how many reps
and at what weight, counts the minute down with audio cues, and rolls straight into the next
slot. Between sessions it doubles as the place where the programme itself lives — the weekly
schedule, the exercises, and the current prescription (reps and weights) for each one.

## Who it's for

One person: the author, on their phone, in their gym. It's a single-user app by design —
there is exactly one account, public signup is disabled in Supabase, and every authenticated
session is treated as the owner. It is not multi-tenant and isn't trying to be.

That constraint is worth knowing before reading the code: the Supabase publishable key ships
in the client bundle, so the single account's password is the security boundary, and the
row-level-security policies exist to enforce data *shape* rules (append-only prescriptions,
above all) rather than to separate users from each other.

## What it does

**Run a workout.** Pick a workout from the weekly schedule, hit start, and get a 10-second
countdown followed by one screen per minute: current exercise with its reps and weight, what's
coming next, round counter, and time left. Audio cues fire at the start of each minute, at the
halfway mark, at ten seconds, and for the last three seconds — plus a success melody at the
end. Pause and resume are supported mid-session.

**Keep the programme up to date.** Reps and weights can be edited from the phone, right after
the set that earned the change. Every edit appends a new row rather than overwriting the old
one, so the prescription table *is* the training journal — a queryable history of what was
lifted and when. Nothing is ever updated or deleted; the database refuses both.

**Edit the structure.** Create and edit workouts, reorder or replace the exercises in a slot
list, and manage the exercise library (create, edit, archive, delete when nothing depends on
it). The slot list is edited as a draft and written back in one atomic transaction, so a failed
save never leaves a workout half-rewritten.

**Work offline-ish.** The last good read is cached in `localStorage`. If the network is
unreachable in the gym, the app loads the cached programme and shows a banner saying how old it
is. Structural editing is disabled while the data is known stale — writing a whole slot list
back from a stale copy could silently undo a change made elsewhere — but prescription edits stay
available, because they're append-only and carry no such hazard.

**Installable.** There's a web app manifest and icons, so it can be added to a phone home
screen and run standalone.

## Domain model in one minute

- **Exercise** — identity only, never numbers that change over time. Its `type` is one of
  `ramp_up` (constant reps, one weight per round), `rep_range` (min–max reps, one weight),
  `fixed`, or `plain` (Rest, Carry, Skip — no numbers, never has a prescription). A `movement`
  column groups variants so they trend together.
- **Prescription** — the reps and weights for an exercise, append-only. Latest row wins, via
  the `current_prescriptions` view.
- **Workout** — a title, an optional day of the week, and a round count.
- **Slot** — one position in a workout pointing at an exercise. Unilateral exercises carry a
  `side`: `alternating` (both sides inside the minute) or `per_round` (left on round 1, then
  alternating by round).

Timing: `minute = floor(elapsed / 60)`, `slotIndex = minute % slots.length`,
`roundIndex = floor(minute / slots.length)`. Total minutes are derived from
`rounds × slots.length`, not the other way around.

Database triggers enforce the invariants that make the rest of the app safe to assume — a
`ramp_up` exercise needs exactly one weight per round and can only sit in a workout with a
matching round count; a `plain` exercise can never have a prescription; a slot's side must
match the exercise's laterality. `src/structure.js` mirrors those rules on the client so a
refusal can be explained *before* Postgres raises it.

## Stack

- [SolidJS](https://www.solidjs.com/) — no router; navigation is a `view` signal in `App.jsx`
- [Vite](https://vite.dev/) for dev server and build
- [Vitest](https://vitest.dev/) for the unit tests
- [Supabase](https://supabase.com/) (Postgres + auth + RLS) as the only source of truth
- Web Audio API for the cues — no audio files

The logic worth testing is factored into pure modules with no framework or I/O:
`timer.js` (timer state), `model.js` (shaping and validation), `render.js` (display parts),
`structure.js` (structural-editing rules).

## Getting started

Requires Node 22.12 (see `.nvmrc`) and [pnpm](https://pnpm.io/) — the repo pins
`pnpm@10.32.1` via `packageManager`.

```bash
pnpm install
cp .env.example .env.local   # then fill in your Supabase project values
pnpm run dev
```

### Environment

```
VITE_SUPABASE_URL=https://your-project-ref.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
```

Both are required and both are safe to ship in the client bundle — RLS is the security
boundary, not secrecy of these values.

> **Never** put a service-role key in a `VITE_`-prefixed variable or commit one to any file.
> Vite inlines every `VITE_*` value directly into the built JavaScript.

### Database

SQL migrations live in `supabase/migrations/`, numbered in apply order (`0001_schema.sql`
through `0010_save_workout_slots.sql`). Run them in order against a fresh Supabase project —
via the SQL editor or the Supabase CLI — then create the single user in the dashboard and
**disable public signup**. `0003_seed.sql` loads a starter programme; skip it if you'd rather
start empty.

## Commands

```bash
pnpm run dev      # start the dev server (Vite)
pnpm run build    # production build to dist/
pnpm run preview  # serve the production build locally
pnpm test         # run the Vitest suite once
pnpm test:watch   # Vitest in watch mode
```

Testing the app on a phone against the dev server: `pnpm run dev --host` and open the LAN
address it prints. Audio needs a user gesture before it will play, so the first tap on Start
is what unlocks it — `resumeAudio()` is called there for exactly that reason.

## Layout

```
src/
  App.jsx              view routing, top-level signals, programme resource
  auth.jsx             session signal + LoginGate
  db.js                Supabase I/O, localStorage cache, all writes
  model.js             shapeProgramme, validateWorkout, prescriptionFormError
  timer.js             deriveTimerState — pure
  render.js            display parts for slots — pure
  structure.js         structural-editing rules, mirrors the DB triggers — pure
  audio.js             Web Audio cues, lazy AudioContext
  views/               ScheduleView, DetailView, ActiveView, ExerciseLibraryView, + sheets
  components/          ExerciseLine, Toast
supabase/migrations/   numbered SQL, apply in order
docs/                  design notes and decision records
```

`CLAUDE.md` holds the longer architecture notes and the accumulated gotchas — read it before
changing anything around prop reactivity, save/refetch error handling, or the stale-cache
paths, where the non-obvious failure modes are documented with their reasons.
