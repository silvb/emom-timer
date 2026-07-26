-- The app only ever SELECTs exercises, workouts and workout_slots: src/db.js is
-- the sole read path and savePrescription() touches prescriptions alone. The
-- publishable key ships inside the client bundle, so the single account's
-- password is the entire boundary — a stolen password, or a stray .delete() in
-- a future refactor, could drop the workout structure. prescriptions would
-- survive via `on delete restrict`, but without the structure that gives it
-- meaning.
--
-- Narrow the three `for all` policies to `for select`. Phase-2 admin edits are
-- documented as hand-written SQL in the Supabase dashboard, which runs as the
-- service role and bypasses RLS entirely, so this blocks nothing that exists.
drop policy owner_all on exercises;
drop policy owner_all on workouts;
drop policy owner_all on workout_slots;

create policy owner_read on exercises     for select to authenticated using (true);
create policy owner_read on workouts      for select to authenticated using (true);
create policy owner_read on workout_slots for select to authenticated using (true);
