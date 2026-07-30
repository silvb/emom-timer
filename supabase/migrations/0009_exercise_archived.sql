-- An exercise that has ever had a prescription can never be deleted:
-- prescriptions.exercise_slug is `on delete restrict`, deliberately, because
-- the prescription history is the user's training journal. Retiring therefore
-- cannot be expressed as a delete, and without a flag the add-slot picker
-- would grow monotonically for the life of the app.
--
-- Reversible by design: archiving hides, it never destroys.
alter table exercises add column archived boolean not null default false;

-- No index on this column, deliberately. The app reads `exercises` with an
-- unfiltered select * and does the archived filtering client-side, so no query
-- has the predicate to match; and on a table of tens of rows the planner would
-- pick a sequential scan regardless.
