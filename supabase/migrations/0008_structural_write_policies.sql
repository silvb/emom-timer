-- 0006 narrowed exercises/workouts/workout_slots to `for select` because the
-- app only ever read them, and Phase-2 structural edits were expected to be
-- hand-written dashboard SQL running as the service role. Phase 2 instead puts
-- that editing in the app, so the three tables need write access back.
--
-- The select policies from 0006 stay as they are; these only add the missing
-- verbs. Every write still passes the invariant triggers from 0001/0002, which
-- are role-agnostic and unaffected by RLS.
--
-- Accepted trade-off, recorded deliberately: this restores the exposure 0006
-- removed. The publishable key ships in the client bundle, so the single
-- account's password is the whole boundary, and a stray .delete() in a future
-- refactor could drop workout structure. prescriptions remain protected —
-- their append-only trigger (0005) rejects UPDATE and DELETE for every role.
create policy owner_insert on exercises for insert to authenticated with check (true);
create policy owner_update on exercises for update to authenticated using (true) with check (true);
create policy owner_delete on exercises for delete to authenticated using (true);

create policy owner_insert on workouts for insert to authenticated with check (true);
create policy owner_update on workouts for update to authenticated using (true) with check (true);
create policy owner_delete on workouts for delete to authenticated using (true);

create policy owner_insert on workout_slots for insert to authenticated with check (true);
create policy owner_update on workout_slots for update to authenticated using (true) with check (true);
create policy owner_delete on workout_slots for delete to authenticated using (true);
