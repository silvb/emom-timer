# Edit Mode Phase 2 — Blind PR Review

Reviewer: fresh agent, given only the PR diff (with this pipeline's own documents
excluded) and the goal/requirements text from the PR description. No access to
the implementation plan, the interview, or the session history.

Verification observed by the reviewer: `pnpm test` → 133 passing, 4 files.
`pnpm build` → clean, 270.69 kB / 74.11 kB gzipped, no warnings.

**Recommendation: approve with comments.**

---

## A. Spec compliance

### Met

Exercise library reachable from the schedule; create with name, movement, kind,
rounds, unilateral and an opening prescription; slug derived, shown, editable
before saving and immutable after; name and movement freely editable; kind,
rounds and unilateral locked with the reason stated, with a duplicate flow
offered. Workout create, rename, day, rounds and delete. Explicit slot edit mode
with add, remove, move and side. All-or-nothing slot save via the RPC. Archive
and restore as a first-class action distinct from delete. Odd-round `per_round`
warning, non-blocking, computed against the draft. Stale gate on all three
structural entry points, with `EditSlotSheet` deliberately ungated. Move
controls rather than drag. The timer and active-workout path are untouched.

Success criteria 1–7 and 9–11 are satisfied. Criterion 9 in particular is
genuinely delivered: `0010_save_workout_slots.sql` puts the delete and the
insert in one plpgsql body, which is the correct fix for the two-request REST
problem.

### Partially met

- **Criterion 8 — naming what blocks a deletion.** Retiring names its blockers
  correctly. Deleting does not: the Delete button is simply not rendered when
  `canHardDelete` is false, which makes the refusal messages in
  `ExerciseLibraryView.jsx` **unreachable dead code**. Blocking workouts do
  appear as row subtext, but a blocking *prescription* is never named anywhere.
- **"A new exercise defaults to its own identifier as its movement."**
  `movement` initialises to `''`. The slug default only lands if the user
  actively picks "New movement…", so a new exercise's movement starts blank and
  validation forces a choice.

### Implemented but not requested

Nothing of substance. Side warnings now also render on the read-only detail
screen, a small addition to "outside edit mode the screen behaves exactly as
today", but directly implied by the guardrails requirement.

---

## B. Findings

### Important

**1. Permanent exercise deletion has no confirmation step.**
`src/views/ExerciseLibraryView.jsx` — the Delete button calls `remove(exercise)`
directly. Workout deletion, one file over, gates on a `confirmingDelete` state.
The button is roughly 28px tall and sits beside Archive in a wrapping flex row.
On a phone, one mis-tap permanently destroys the row. The loss is bounded —
`canHardDelete` guarantees no history and no slots — but the app has one user,
no undo, and the inconsistency with the workout path is unexplained.

**2. Exercise creation is two non-atomic requests with no retry path.**
`src/views/ExerciseFormSheet.jsx`. If `createExercise` succeeds and
`savePrescription` fails, pressing Save again re-runs `createExercise` —
`props.programme` has not been refetched, so client-side uniqueness validation
still passes — and the user gets a raw `duplicate key value violates unique
constraint "exercises_pkey"`. There is no way to add just the prescription from
this sheet. Recovery requires closing it, adding the exercise to a workout, and
using `EditSlotSheet`. The code's own comment anticipates the split but not the
retry.

**3. The refetch-failure branch in `saveSlots` guards a path the cache makes
nearly unreachable, and the realistic failure is silent.**
`src/views/DetailView.jsx` handles `props.onSaved()` rejecting, but
`loadProgramme` swallows fetch failure and *resolves* with the cache. So after a
slot save that commits on a connection that then drops: the refetch resolves
stale, nothing throws, the draft clears, and the screen re-renders the
**pre-save order** with the stale banner up and no indication the save landed.
The user will reasonably conclude it failed. Not destructive, but it is the
mirror image of "no edit may appear to succeed when it did not".

### Minor

4. `0010` grants no EXECUTE explicitly and revokes none. It works on stock
   Supabase, and an `anon` caller is inert because the workout-existence guard
   raises first. But this project actively narrows grants — `0006` did exactly
   that — so an explicit grant/revoke pair costs one line.
5. `.edit-field input` sizes every input to full width and 44px minimum; the
   unilateral **checkbox** sits inside a `.edit-field`, so it may render
   stretched. Needs an eyeball; not renderable in this pipeline.
6. The new `.edit-field select, .edit-field input[type='text']` rule overrides
   the phase-1 rule, so the new sheets' text fields differ from `EditSlotSheet`'s
   numeric fields in font, background and corner radius. Probably unintended.
7. `.edit-locked { color: #8a6410 }` is roughly 3:1 against the dark-theme
   background at 0.75rem. Every other dual-theme colour goes through a variable.
8. `weightCount()` has no upper bound and `roundsError` accepts any positive
   integer, so a large ramp round count renders that many inputs. The database
   has no cap either. Cheap to cap around 30.
9. Once "New movement…" is chosen there is no way back to the dropdown without
   reopening the sheet, and the slug prefill is captured at that instant, so a
   later name change does not follow it.
10. `AddSlotSheet` sets `position: null` on new draft slots while `DetailView`
    deliberately strips `position` from existing ones. The draft holds two
    shapes — the drift the stripping was meant to prevent.
11. Bumping `CACHE_KEY` to `v2` discards every existing cache on the first load
    after deploy; if that first launch is offline the user gets the hard error
    screen instead of their programme. The bump also isn't strictly required —
    `readCache` returns the shaped programme directly, and a missing `archived`
    already reads as active. The related comment in `model.js` is inaccurate on
    both halves.
12. `ExerciseFormSheet` and `WorkoutFormSheet` call `props.onSaved()` without
    awaiting while `DetailView` and `ExerciseLibraryView` await it. A rejected
    refetch becomes an unhandled rejection.
13. `ExerciseLibraryView` reports "Could not save. Try again." when a refetch
    fails after a *successful* archive — claiming a write failed when it landed.
    `DetailView` goes to considerable length to avoid exactly this.
14. The edit-mode Save button is gated on `busy()` but not `props.stale`.
    Unreachable today, but it is the one place the offline hazard could
    materialise.
15. Sheet backdrops call `props.onClose` unconditionally, so they close mid-save
    and discard typed input, while the Cancel buttons are correctly disabled.
16. The `exercises_active` partial index duplicates the primary key on a table
    of tens of rows.
17. The side control's label shows the current state but the button toggles, so
    "per round" is ambiguous between *is* and *will become*.

---

## Clean verdicts the reviewer stated explicitly

- **The SQL is correct against 0001–0007.** Every identifier checked by hand:
  all client payloads match their table columns, the RPC argument names match
  the call site, `nullif(elem->>'side','')` correctly yields NULL for JSON null
  and for an absent key, `(ord)::int` from `WITH ORDINALITY` is valid and
  1-based, the new policy names do not collide with `0006`'s, and `search_path`
  is pinned consistently with `0007`.
- **No client guard disagrees with a trigger.** `createExercise` nulls `rounds`
  for non-ramp kinds; `setExerciseArchived` updates only `archived`, which
  correctly does not fire the `after update of rounds, type, unilateral` guard;
  `eligibleExercises` mirrors invariant 2 exactly. `lockedExerciseFields` is
  *stricter* than the database in one spot, which matches the spec's wording and
  errs the safe way.
- **`0008` re-granting write access is the right call**, not an oversight — it
  is required by the goal, the trade-off is recorded in the migration, and
  `prescriptions` stays protected by the role-agnostic `0005` trigger.
- **`save_workout_slots` not being `SECURITY DEFINER` is correct** — it needs a
  transaction, not a privilege escalation.
- **Deleting every slot and saving is safe** — `validateWorkout` already reports
  the empty workout and `DetailView` hides Start behind it, so the timer never
  sees a zero-length slot list.
- **The delete-then-reinsert inside `0010` cannot collide** on the composite
  primary key: both statements are in one transaction, delete first.
- **Test coverage for criterion 11 is real** — all eleven exported pure
  functions are exercised, including the identifier-exclusion both ways, the
  archived filter and the odd-round warning.

---

## What the reviewer wanted addressed before this reaches a phone

Findings 1 and 2, both small. Finding 3 acknowledged one way or the other, since
the code already demonstrates the author cares about that exact distinction.
Everything else is comment-grade.
