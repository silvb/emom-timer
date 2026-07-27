# Edit Mode Phase 2 — Human Testing Notes

PR: https://github.com/silvb/emom-timer/pull/2

Read the three "focus review here" items at the bottom first if you are short on
time. The rest is a script you can follow.

---

## 0. Before anything else — apply the migrations

**Nothing in this PR works until you do this, and the failure is quiet.** An RLS
denial looks like a write that simply didn't happen, not an error.

In the Supabase dashboard SQL editor, run these three files in order, from the
branch (not from memory — `0009` and `0010` were both edited during review, so
an earlier copy is wrong):

```
supabase/migrations/0008_structural_write_policies.sql
supabase/migrations/0009_exercise_archived.sql
supabase/migrations/0010_save_workout_slots.sql
```

Then confirm the function actually resolves, because PostgREST caches its schema
and a stale cache gives you `PGRST202 Could not find the function`:

```sql
select save_workout_slots('squat_main', (
  select jsonb_agg(jsonb_build_object('exercise_slug', exercise_slug, 'side', side)
         order by position)
  from workout_slots where workout_id = 'squat_main'
));
```

That rewrites `squat_main` with exactly the slots it already has, so it is a
no-op you can safely run. If it errors, stop and fix that before testing the UI.

Also confirm public signups are still disabled in Supabase Auth. Migration
`0008` widens what any authenticated session may do — it re-grants insert,
update and delete on `exercises`, `workouts` and `workout_slots`, which
migration `0006` had deliberately removed. That toggle is now carrying more
weight than it was.

Then: `pnpm install && pnpm run dev`.

---

## 1. The two flows most likely to be wrong

Do these first. Both had genuine bugs found late, and both are the reason the
feature exists.

**Create a ramp-up exercise with 4 rounds.** Library → New exercise → kind
"Ramp up" → Rounds 4. You should get exactly four weight fields. **Type a
different number into each one**, then save.

Why this first: an earlier version silently kept only the first weight while
still *displaying* all four, and failed at save with a misleading "Enter a
weight for every round." Also type into the **last** field first — the fix has
to be order-independent. Then change Rounds from 4 to 6 and back to 2, and check
that your typed values survive the increase and that the discarded ones do not
come back.

**Reorder and remove slots, then save.** Open a workout → Edit exercises → move
rows with ↑↓, remove one, add one, then Save changes. Now start the workout and
confirm the active screen runs the new order.

Why: this is the one write in the app that replaces a whole list rather than
appending to a journal. It goes through a database function so it is
all-or-nothing — if it fails, nothing changed.

---

## 2. Edge cases worth checking by hand

These are the ones a human is better placed to catch than any of the reviews
were.

- **Look at the new screens in daylight.** All the new CSS originally hardcoded
  dark-theme borders while your app is light by default (`--bg: #fafaf7`, with
  dark scoped only to `.active-view`). It's fixed, but "fixed" here means
  "changed to variables and never rendered by anyone". The ↑↓ reorder buttons
  are the affordance most at risk of being invisible.
- **The unilateral checkbox in the exercise form.** `.edit-field input` sizes
  every input to full width and 44px tall; the checkbox lives inside one. An
  explicit opt-out was added so it should render as a normal 1.15rem box — but
  nobody has seen it. One glance settles it.
- **Try to break a ramp's round count.** Edit a seeded ramp exercise (Zercher
  Squats, Sumo Deadlifts, Overhead Press). Kind and Rounds should be disabled
  with a reason naming the workout that blocks them, and offer "Duplicate as new
  exercise". Take that path, set a different round count, save — you should get a
  second exercise sharing the same `movement`, with the original's history
  untouched.
- **Change a workout's round count while it holds a ramp.** This must be refused
  by the database, and the message should name the exercise and both counts. It
  is the clearest test that the trigger and the UI agree.
- **Archive an exercise that a workout still uses.** Refused, naming the
  workouts. Then remove it from every workout and archive it — it should vanish
  from the add-slot picker and reappear when you restore it.
- **Delete an exercise you just created and never prescribed.** That is the only
  case where permanent deletion is possible; anything with recorded history can
  never be deleted, by design. Confirm the Delete button now explains *why* when
  it refuses rather than just being absent.
- **Go offline mid-edit** (airplane mode with dev tools open). The stale banner
  should appear and every structural entry point should disable. Editing reps
  and weights must keep working — those only ever append to your journal.
- **Odd round counts.** Put a `per_round` slot in a 3-round workout. You should
  get a non-blocking warning about one side getting an extra set, visible while
  you can still reconsider — not after saving.

---

## 3. Focus your review here

Ranked. These are the judgement calls, not the mechanics.

**1. Reopening write access is the load-bearing decision.** Migration `0008`
reverses `0006`, which had locked the three structure tables to read-only
specifically so a stolen password or a stray `.delete()` couldn't destroy your
programme. Phase 2 needs those writes, so it takes that exposure back. Your
training journal is still protected — `prescriptions` stays append-only via a
trigger that ignores RLS entirely — but the workout *structure* is now
destroyable from the client. You chose this over the RPC-per-operation
alternative when I asked; this is the moment to confirm you still want it,
because it is the hardest thing here to walk back later.

**2. The slot rewrite is the one exception, and it's worth understanding.**
Everything else writes tables directly, but reordering slots goes through
`save_workout_slots` because delete-then-insert over the REST layer is two
requests with no transaction — a failure between them would leave a workout with
*no slots at all*, discovered next time you tried to train. The function makes it
atomic. It is deliberately not `SECURITY DEFINER`: it needs a transaction, not
elevated privilege.

**3. What happens when a save succeeds but the refresh doesn't.** This is the
subtlest thing in the branch and it got reworked twice. `loadProgramme` falls
back to cache rather than failing, so a connection that drops right after a
successful save used to leave you looking at the *pre-save* order with no
indication anything had happened. It now detects that case and tells you. Worth
provoking deliberately: save a reorder, kill the network the instant you tap,
and see whether the message you get matches reality.

Two smaller ones, both flagged in the fix summary as deliberately not addressed:

- **`ExerciseFormSheet` is 469 lines**, the largest file in the project. The
  obvious cleanup — sharing the prescription fields with `EditSlotSheet` — was
  left out rather than dragging a refactor of shipped code into this PR.
- **Cancelling a half-finished create** leaves an exercise with no prescription.
  Visible (`validateWorkout` reports it) and now fixable from the library, but
  not prevented.

---

## 4. What has and hasn't been verified

- **139 unit tests pass, build is clean.** All pure logic — slug derivation,
  reordering, form validation, field locking, picker eligibility, warnings.
- **No UI is covered by automated tests.** Vitest runs in bare node with no
  jsdom, so every screen in this PR has only been read, never rendered.
- **No SQL has ever been executed.** There is no local Supabase stack in this
  repo. The migrations were checked by hand against the existing schema —
  column names, RPC parameter names, trigger interactions all verified by
  reading — but the first real execution will be yours.
- **The active workout screen is untouched.** `src/timer.js`, `src/audio.js` and
  `src/views/ActiveView.jsx` do not appear in the diff, checked at every stage.
  Your gym path should behave exactly as before; if it doesn't, that's a
  regression worth reporting loudly.
