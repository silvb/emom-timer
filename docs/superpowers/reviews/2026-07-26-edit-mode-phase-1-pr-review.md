# Blind PR review — edit mode phase 1

Reviewed by a fresh agent given only the finished diff and the spec's goal and
requirements — no plan, no design notes, no implementation reasoning. The diff
excluded `docs/superpowers/` and `docs/edit-mode-plan.md` so the reviewer could
not read the rationale behind any choice.

## Verdict as delivered

Do not merge as-is, on one Critical finding about seed data.

## Verified working

- 39 tests pass; build clean.
- Ramp preview arithmetic checked end to end against the live deployed rows, every
  minute of all nine workouts. `squat_main` m4 previews the next round's weight;
  `squat_acc` m1 previews round 2's side; `hinge_main` m8 previews `@80-90-110-[100]`.
  Every wrap correct in both weight and side.
- `squat_acc` reshape is faithful: old 4 slots x 3 rounds and new 2 slots x 6 rounds
  both give 3 left + 3 right per movement in the same 12 minutes.
- `current_prescriptions` carries `security_invoker=on`; `prescriptions_append_only`
  is `BEFORE DELETE OR UPDATE`, so append-only holds even for the service role,
  which RLS alone would not do.
- Signup confirmed disabled at the provider (`disable_signup: true`), one user row.
- No service-role key anywhere; only `.env.example` is tracked.
- Nothing out-of-scope was built.

## C1 (Critical as filed) — seed data differs from `workouts.json` — RESOLVED, NOT A DEFECT

The reviewer found five prescriptions that differ from the deleted `src/workouts.json`
and could not verify they were sanctioned, since the code carries no record of it:
`nordic_curl` gaining 5 reps, `ring_face_pull` gaining 12, `hinge_acc`'s lateral
raises becoming `alternating`, and `one_leg_kb_rdl` and `lm_meadows_row` becoming
`per_round`.

All five were explicit decisions by the owner during the design session that produced
this work, and were confirmed again after this review. The reviewer was correct that
they differ from the old file and correct that nothing in the diff proves intent —
that is the blind review working as designed, not a flaw in it.

No change made. Recorded here so the next reader does not re-litigate it.

## I1 (Important) — `authenticated` could destroy the programme — FIXED

`exercises`, `workouts` and `workout_slots` carried `for all to authenticated
using (true)`, but the app only ever SELECTs them. The publishable key ships in the
bundle, so the single account's password was the only thing standing between a
stolen credential — or a stray `.delete()` — and the loss of the workout structure.
`prescriptions` would survive via `on delete restrict`, but without the structure
that gives it meaning.

Narrowed to `for select`. Phase-2 admin edits run as the service role via dashboard
SQL and are unaffected.

## I2 (Important) — ramp emphasis was the weakest treatment in the app — FIXED

`.ex-weight-current` relied on `font-weight: 700` plus `font-size: 1.08em`, and
`.ex-weight` had no rule at all. The active screen uses Bebas Neue, imported at a
single weight, so the bold could only render as synthetic faux-bold — roughly 4px
and a smudge, at 40-60px on a saturated background. That is success criterion 4,
and the only thing between the user and the wrong plates.

Non-current weights are now de-emphasised directly, which reads at arm's length
regardless of the font's weight axis.

## I3 (Important) — edit validation had no test coverage — FIXED

`validationError` is the only thing between a fat-fingered phone input and a
permanent row in the append-only journal, and nothing imported it. Extracted to a
pure module and covered by tests.

## Minor findings

Triaged; the ones fixed are noted in the fix summary. The rest are recorded in the
human review notes.
