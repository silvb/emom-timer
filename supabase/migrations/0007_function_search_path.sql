-- The five trigger functions ran with a mutable search_path, so the tables they
-- resolve unqualified (`exercises`, `workouts`) depended on whatever search_path
-- the calling session happened to set. Pin it. pg_temp is listed last so a
-- session-created temp table can never shadow a real one.
alter function check_prescription_shape()   set search_path = public, pg_temp;
alter function check_slot_shape()           set search_path = public, pg_temp;
alter function check_workout_rounds()       set search_path = public, pg_temp;
alter function check_exercise_update()      set search_path = public, pg_temp;
alter function reject_prescription_mutation() set search_path = public, pg_temp;
