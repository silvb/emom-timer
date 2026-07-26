# Edit mode phase 1 — what to test, and where to spend your attention

PR: https://github.com/silvb/emom-timer/pull/1

Everything below is either something no agent in this pipeline could verify, or a
judgement call that is genuinely yours. Ranked — do 1 and 2 before you train on this.

---

## Do these before you rely on it

### 1. One real save, end to end

**Nothing in this pipeline ever completed an authenticated save.** RLS needs a
session, and I would not let an agent create credentials or touch your `auth.users`
row. The write path is verified by code trace, an insert-only grep, and unit tests —
but the first genuine round trip is yours.

```
Sign in → Hinge Main → tap Sumo Deadlifts → change round 3 from 110 → Save
```

Two things must both be true:

- The detail row shows the new number **without leaving the screen**. This is the
  exact bug that was caught late: `DetailView` destructured its props, which in Solid
  freezes them at mount, so the saved value never appeared. It is fixed, but it is
  worth confirming with your own eyes because it is invisible to a passing test.
- The database gained a row rather than changing one:

```sql
select id, effective_at, reps_min, reps_max, weights
from prescriptions where exercise_slug = 'sumo_deadlift' order by id;
```

**Baseline: the table holds exactly 15 rows right now, one per non-plain exercise,
all seed. None were written by the app.** You should see two rows for
`sumo_deadlift` afterwards, the seeded `{80,90,110,100}` untouched.

### 2. A failed save actually tells you

Airplane mode, open the sheet, tap Save. You should get an error **inside the sheet**,
with the sheet still open and your values intact.

This is worth testing specifically because it was broken in a way no unit test would
catch: the error went to a global toast at `z-index: 30`, sitting underneath the edit
sheet's backdrop at `40` — and the sheet occupies the bottom of the screen, exactly
where the toast renders. You would have seen the Save button un-grey and nothing else.
Errors now render in-sheet.

---

## Judgement calls that are yours, not mine

### 3. Is the current ramp weight obvious enough at arm's length?

Success criterion 4 is "readable without arithmetic", and this is the one thing
between you and the wrong plates.

The original treatment was bold + 8% larger. That turned out to be near-useless: the
active screen uses Bebas Neue imported at a **single weight**, so `font-weight: 700`
could only render as synthetic faux-bold — a smudge and about 4px at 40–60px.

It now dims the *other* weights (`opacity: .5`) and enlarges the current one, which
reads regardless of the font's weight axis. **Try it mid-set, in your actual gym
lighting, with a bar in your hands.** If it is not instant, say so and I will push it
further — more contrast, a colour change, or a separate "next up" line.

### 4. Three display readings the seed decided for you

All three match what you specified during the design session, but they are visible
changes to your programme and only you can confirm they read right:

- **Hinge Accessory** now shows `12/12 LM Lateral Raises` — the old JSON said
  `12 LM Lateral Raises` with no side, and the slot is now `alternating`.
- **Squat Main** now shows `5 Nordic Curls`, and **Upper Accessory** shows
  `12 Ring Face Pulls`. The old JSON carried no rep count for either.
- **Upper Accessory is now 12 minutes, not 9** (3 rounds → 4), so Meadows rows
  balance at 2 per side under `per_round`.

The blind reviewer flagged all of these as unsanctioned changes and called the PR
unmergeable over them — correctly, from where it stood, since the code carries no
record of your having chosen them. Worth a glance to be sure the reading matches
your intent.

### 5. All five audio cues, on the phone

There is **no automated coverage of `audio.js`**, and browser verification was
abandoned partway through the branch because headless Chrome hangs in this sandbox.
The audio block itself is byte-identical in the diff, so nothing should have changed —
but confirm: start ping, 10-second warning, 3-second warning, halfway beep at 30s,
completion melody. Plus pause and resume.

**Pause is worth a specific try.** It was crashing — and separately, it had been
rendering `NaN:NaN` with a black background since before this project. Both fixed by
the same one-line change.

---

## Two dashboard actions still outstanding

1. **Raise the JWT expiry** — you chose this to fix the offline lockout. Supabase's
   default access token lives 1 hour; when it expires with no network, the auth
   client returns a null session and you get the login form instead of your cached
   workouts, which defeats the whole point of the cache. Auth → Sessions → raise the
   access-token lifetime (24h or a week is reasonable for a single-user app).

2. **Enable leaked-password protection** — Auth settings. On a single-account app
   whose policies grant full access to any authenticated user, your password is the
   entire security boundary, and it is currently not checked against known breaches.

Public signup is already off — verified independently: `disable_signup: true`, one
user row.

---

## Where the risk actually sits

Ranked by what would hurt most if wrong:

1. **The append-only invariant.** This is the one thing a later phase cannot repair.
   It is now enforced three ways: no UPDATE or DELETE policy in RLS, a
   `before update or delete` trigger that raises unconditionally (so even dashboard
   SQL running as `postgres` cannot mutate a row), and no mutation call anywhere in
   `src/`. Verified by executing UPDATE and DELETE against a real row — both raise
   `P0001` — inside a rolled-back transaction.

2. **The preview off-by-one.** The reason the design took the shape it did. Proven
   by executing the real modules against real rows: `hinge_main` in the Rest minute
   of round 2 previews Sumo Deadlifts at **110**, round 3's weight, not round 2's 90.
   A blind reviewer independently re-derived it across every minute of all nine
   workouts.

3. **The unauthenticated read that was nearly shipped.** `current_prescriptions` was
   created without `security_invoker`, so the view ran as its owner and ignored RLS —
   `anon` could read all 15 prescriptions through it while the base tables correctly
   returned zero. Since the publishable key ships in your bundle by design, anyone
   with your Vercel URL could have read your data. Fixed in `0004`; verified `anon`
   now sees 0 and `authenticated` still sees 15.

4. **Write-open policies on the structure tables.** `exercises`, `workouts` and
   `workout_slots` had `for all to authenticated`, though the app only reads them.
   Narrowed to `select` in `0006`.

---

## Known limitations, accepted deliberately

- **No PWA manifest or service worker**, despite the PWA framing. The localStorage
  cache only helps if the browser's HTTP cache still has the app shell. Not a
  regression — it was equally true before — but it caps how much the offline story
  can deliver.
- **Bundle is 246 kB / 67 kB gzipped.** Full `supabase-js` pulls in realtime, storage
  and functions, none of which this app uses.
- **A missing env var gives a white screen**, because the Supabase client is created
  at module import.
- **A `fixed` exercise with `reps_min ≠ reps_max`** is silently narrowed by the edit
  sheet, which shows one Reps field for non-rep-range kinds. Nothing seeded hits this.
- **A mid-workout sign-out** would unmount the running timer.
- **`movement` equals `slug` for all 18 exercises.** Correct per design — it only
  earns its keep once you create a variant — but your first trend query will need a
  pass over the data first.

---

## For Phase 2

- The invariant triggers are immediate, not deferred, so once an exercise has
  prescriptions or slots attached, its `rounds`/`type`/`unilateral` **cannot be
  changed by plain SQL at all** — every statement ordering gets rejected. That is
  consistent with D4 (a new round count means a new exercise slug), but a Phase-2
  editor needs a deliberate mechanism: deferred constraint triggers, a batched
  `SECURITY DEFINER` function, or the new-identity convention.
- `ScheduleView` and `ActiveView` still destructure their props. Safe today only
  because `Switch`/`Match` unmounts them on every view change. If Phase 2 gives
  either a prop that updates while mounted, they will silently freeze.
- `EditSlotSheet` seeds its form state non-reactively, relying on the sheet fully
  unmounting between opens. A "next exercise" button inside the sheet would break it.
- The schema needs **zero migrations** for Phase 2 — `workouts` and `workout_slots`
  are real tables, `movement` is populated, slugs are stable, both foreign keys use
  `on delete restrict`, and `position` is a plain int.
