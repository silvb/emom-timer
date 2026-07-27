# Edit Mode Phase 2 — Review Resolution

Resolves `2026-07-27-edit-mode-phase-2-pr-review.md`. Written with access to the
design spec and the implementation plan, which the reviewer did not have.

Verification after the changes: `pnpm test` → **139 passing, 4 files** (was 133;
+6 from the new pure-logic tests). `pnpm build` → clean, 273.46 kB / 74.83 kB
gzipped. `git diff --name-only origin/main...HEAD` contains no `src/timer.js`,
`src/audio.js` or `src/views/ActiveView.jsx`.

Summary: **15 fixed, 1 rejected with reasoning (finding 7), 1 fixed differently
than proposed (finding 11 — the reviewer's own preferred outcome).** One
sub-decision is deliberately scoped narrower than it could be (post-save
staleness is checked in `DetailView` only); the reasoning is under Important 3.

---

## A. Spec compliance gaps

### Criterion 8 — a refused deletion must name what is blocking it

**Found.** Accurate, and worse than stated. `canHardDelete(exercise, workouts)`
gated whether the Delete button rendered *at all*, so the two refusal messages
inside `remove()` were unreachable: the only way to reach them was to be
allowed to delete. A blocking prescription was never named anywhere in the UI —
the row subtext lists blocking workouts only.

**Done.** Took the "surface the button and let it refuse" option, because that
is what Archive already does one function above (Archive is always rendered and
refuses with its blockers named), and the spec asks the two to behave alike.

- New pure function `deleteBlockedReason(exercise, workouts)` in
  `structure.js`, replacing `canHardDelete`. It returns `null` when the delete
  can proceed, otherwise a sentence naming **every** blocker, not the first
  one: a slot and a prescription can hold the same exercise at once, and
  reporting only the workouts means deleting them and being refused a second
  time for a reason never mentioned.
  Example: `Zercher Squats can't be deleted: it is still used by Squat Main, and
  it has a saved prescription. Archive it instead.`
- `ExerciseLibraryView` renders Delete on every row and routes it through
  `askToRemove()`, which surfaces the reason via the app toast.
- `canHardDelete` is gone rather than kept alongside: two functions answering
  the same question is how the answer drifts. Its three tests became five
  covering the reason text (`CLAUDE.md` and `db.js`'s comment updated to match).

### "A new exercise defaults to its own identifier as its movement"

**Found.** Accurate. `movement` initialised to `''` and only ever received the
slug if the user actively selected "New movement…", so a new exercise's movement
was blank and validation refused Save until something was picked.

**Done.** In `ExerciseFormSheet`:

- `movement` is now derived: `movementTouched() ? movementInput() : slug()`. For
  `mode === 'create'` it starts untouched, so the default is the identifier, and
  it *tracks* the identifier live — renaming before the first save carries the
  movement along instead of stranding whatever the name was when the field first
  rendered. `edit` and `duplicate` start touched, so the source movement is
  carried over exactly as before (that is what makes a duplicate comparable).
- The "choose an existing movement" path is preserved and now two-way: the field
  opens on free text (where the default lives) with a "Use an existing movement"
  link back to the dropdown, and the dropdown's "New movement…" returns to free
  text. This also resolves finding 9 (see below), which was the same defect
  seen from the other side.

---

## B. Important findings

### 1. Permanent deletion had no confirmation — fixed

Added a `confirmingSlug` step to `ExerciseLibraryView`, modelled on
`WorkoutFormSheet`'s `confirmingDelete`: the row's action buttons are replaced
in place by `Delete permanently?` + Keep / Delete. `askToRemove` checks the
blockers *before* offering the confirm, so a refusal never shows a confirm
prompt for something that cannot be deleted; `remove()` re-checks before
writing, because `props.workouts` can change while the prompt is open.

### 2. Exercise creation had no retry path — fixed

The two writes stay non-atomic — the plan justifies that explicitly, and the
justification is sound (an exercise without a prescription is a state
`validateWorkout` already reports and the UI can fix; a half-written slot set is
not). What was missing was retry state.

`ExerciseFormSheet` now records `createdSlug` the moment `createExercise`
resolves. Save skips creation when it is set and goes straight to the
prescription, so the second press completes the job instead of failing on
`exercises_pkey`. While it is set, every field belonging to the already-written
row (name, identifier, movement, kind, rounds, unilateral) is disabled with an
explanatory note — leaving them editable would let the user change values that
silently cannot be applied any more. The reps and weight fields stay live, since
they are what the outstanding write needs.

Related: the sheet backdrop no longer closes mid-save (finding 15), which
matters more here than elsewhere — a backdrop tap during the create would have
discarded exactly the `createdSlug` state that makes the retry possible.

### 3. The silent post-save stale render — fixed, and the comment corrected

**Verified.** `loadProgramme` catches the fetch failure and *resolves* with
`{ programme: cached.programme, stale: true }`. So the `catch` around
`props.onSaved()` almost never fires, and the realistic failure is the silent
one the reviewer describes.

Chose to detect it rather than to document it away, because the stale banner
alone cannot distinguish "your save landed, this list is old" from "your save
failed" — and the user's next action differs between the two.

- After the awaited refetch, `saveSlots()` checks `props.stale` and, if set,
  reports: *"Saved, but the screen is showing saved data from before the change.
  Reconnect and reload to see it."* The comment above it now states plainly that
  a network-failed refetch resolves rather than rejects.
- **Found while fixing it:** both post-save messages were unrenderable. They
  were written with `setEditError`, but the `<Show when={editError()}>` that
  renders it lives *inside* the edit-mode block, and both paths clear the draft
  in the same tick — so the paragraph unmounted as the message was set. Both now
  go through `props.onError` (the app-level toast), which survives the draft
  clearing. This means the branch the reviewer called "nearly unreachable" was
  also invisible on the rare occasions it did run.
- Also softened the save-failure message, which asserted `Nothing was changed.`
  unconditionally while the comment directly above it acknowledged that a
  connection dropped after commit is indistinguishable. It now says the save
  failed and that saving again is safe (the payload is a whole-list replace),
  which is true in both cases.

**Scoped deliberately:** the same `props.stale` check is *not* added to the form
sheets. They close on save, so the user is returned to a screen carrying the
app-level stale banner, and none of them re-render a list whose content is the
thing that was just rewritten — the slot order is the only case where the stale
view is actively misleading about the write. Adding a `stale` prop to three
sheets to say what the banner already says did not seem worth the wiring; noting
it here so the human can disagree cheaply.

---

## C. Minor findings — triage

| # | Verdict | Notes |
|---|---------|-------|
| 4 | Fixed | `revoke all … from public` + `grant execute … to authenticated` on `save_workout_slots`. Postgres grants EXECUTE to `public` by default, which is exactly the exposure `0006` set out to remove. `0010` is unapplied, so edited in place. |
| 5 | Fixed by restructuring | Confirmed by reading the cascade, not a browser: `.edit-field input` (width 100%, min-height 44px, padding 10px 14px) does match the unilateral checkbox, which is a descendant of `.edit-field`. Added an explicit `.edit-field input[type='checkbox']` opt-out (fixed 1.15rem box, no stretch), so the question no longer depends on an eyeball. Still worth a glance on a phone. |
| 6 | Fixed | Dropped `input[type='text']` from the Phase-2 selector — those inputs were already fully styled by the Phase-1 `.edit-field input` rule, and restating them only made the new sheets look different from `EditSlotSheet` on the same screen. `.edit-field select` now mirrors the Phase-1 rule exactly, keeping the 16px that stops iOS zooming on focus. |
| 7 | **Rejected** | The premise does not hold: there is no dark theme for these sheets. `:root` is light-only, and the dark palette is scoped to `.active-view` (`index.css:14`) — there is no `prefers-color-scheme` block in the stylesheet at all. `#8a6410` on the actual background `#fafaf7` is ~5.2:1, which passes AA for 0.75rem text. The "everything else goes through a variable" half is also inaccurate: `.edit-error` (`#c23b2f`), `.danger-btn` and `.slot-warning` (`#e0b341`) are all hardcoded semantic colours — a hardcoded accent is the established pattern here, and the theme variables are structural (bg/surface/border/text). Introducing a variable for one warning colour would be the inconsistency. |
| 8 | Fixed | Worth more than the reviewer credited. `weightCount()` feeds `Array.from({ length })` on every keystroke, and `1e9` is a *finite integer* that passed every existing check — so typing it in the Rounds field asks the browser for a billion inputs before validation ever runs. Added `MAX_ROUNDS = 30` to `structure.js`, enforced in `roundsError` (both forms) and clamped in `weightCount()`. Four new tests, including the `1e9` case. |
| 9 | Fixed | Subsumed by the movement rework above: there is now a way back to the dropdown, and the free-text prefill tracks the identifier live instead of being captured at the instant "New movement…" was chosen. |
| 10 | Fixed | `AddSlotSheet` no longer sets `position: null`. `DetailView` strips `position` precisely so the draft holds one shape; the picker was reintroducing a second one. |
| 11 | **Verified, then reverted the bump** | The reviewer's claim holds. `loadProgramme` returns `cached.programme` directly — a cached payload never passes back through `shapeProgramme`, so the `archived ?? false` default cannot apply to it. It does not need to: every read is `!e.archived` or a truthiness test, and an absent key is falsy, i.e. active. The bump therefore bought nothing and cost every user's cache on the first load after deploy — with the error screen instead of a programme if that load is offline. `CACHE_KEY` is back to `v1`, with a comment recording why it must *not* be bumped for a falsy-safe additive field. The inaccurate half of the `model.js` comment (cache entries) is removed; the accurate half (rows read before `0009` is applied) stays. |
| 12 | Fixed | All four surfaces now `await props.onSaved()` inside their own try/catch and report a refresh failure as a refresh failure. Also applied to `EditSlotSheet`, which had the identical unawaited call — the point was to make the surfaces agree, and leaving the Phase-1 one out would have missed it. `App.jsx`'s `onDeleted` now *returns* `refetch()` so it is actually awaitable. |
| 13 | Fixed | `ExerciseLibraryView` splits the write from the refetch for both archive and delete: `Archived/Restored/Deleted, but the screen could not refresh.` instead of `Could not save. Try again.` after a write that landed. |
| 14 | Fixed | Save in edit mode is now `disabled={busy() \|\| props.stale}`, with a note explaining why. Still unreachable today, but this is the one write in the app that replaces a whole list rather than appending to a journal, so the gate belongs on it rather than only on the door in. |
| 15 | Fixed | Backdrops in `ExerciseFormSheet`, `WorkoutFormSheet` and `EditSlotSheet` no longer close while `busy()`. `AddSlotSheet` is unchanged — it performs no write and has no busy state, so there is nothing to interrupt. |
| 16 | Fixed | Dropped `exercises_active`. Beyond duplicating the primary key on a tiny table, no query has the predicate: `fetchProgramme` does an unfiltered `select *` and filters archived rows client-side. The migration is unapplied, so it is edited rather than superseded, and the comment now records why there is deliberately no index. |
| 17 | Fixed | The side button reads `sides: both` / `sides: per round`, with an `aria-label` naming the action. The bare `per round` was ambiguous between state and command. |

---

## Not addressed, on purpose

- **`ExerciseFormSheet` is now 469 lines.** The plan flagged the size as a known
  gap and left the split for a reviewer to rule on; the reviewer did not raise
  it. These fixes added to it. Splitting the prescription fields into a
  component shared with `EditSlotSheet` remains the obvious follow-up.
- **Cancelling while a create is half-finished** leaves an exercise with no
  prescription. That is the state the plan accepted deliberately, it is visible
  (`validateWorkout` reports it), and it is now fixable from the library rather
  than only via a workout slot — but it is not prevented.
- **Migrations remain unapplied and unverifiable here.** `0009` and `0010` were
  edited in place per the constraint. `0008` is untouched. Nothing in this pass
  can claim the SQL runs.
