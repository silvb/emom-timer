-- Finding 1: weights_present used array_length, which returns NULL (not 0)
-- for a zero-element array, and a CHECK evaluating to NULL passes. That let
-- weights = '{}' through, invisibly, for any exercise. It was masked in
-- practice by check_prescription_shape() for 'plain'/'rep_range'/'fixed'/
-- most 'ramp_up' cases, but a ramp_up exercise with rounds = 0 slipped past
-- both, since nothing constrained exercises.rounds to be positive either.
alter table prescriptions drop constraint weights_present;
alter table prescriptions add constraint weights_present check (cardinality(weights) >= 1);

alter table exercises add constraint rounds_positive check (rounds is null or rounds > 0);

-- Finding 2: the only triggers were on the child tables, so an UPDATE on
-- exercises (rounds, type, or unilateral) succeeded unconditionally even
-- when it left existing prescriptions or workout_slots invalid. This is the
-- documented way to edit an exercise until Phase 2 ships an editing UI, so
-- it needs the same guards the insert-time triggers already enforce.
create function check_exercise_update() returns trigger
language plpgsql as $$
declare
  bad_workout workouts%rowtype;
  bad_slot    workout_slots%rowtype;
  presc       prescriptions%rowtype;
  n           int;
begin
  -- ramp_up rounds must still match every workout containing this exercise
  if new.type = 'ramp_up' then
    select w.* into bad_workout
    from workout_slots s
    join workouts w on w.id = s.workout_id
    where s.exercise_slug = new.slug and w.rounds <> new.rounds
    limit 1;

    if bad_workout.id is not null then
      raise exception 'exercise % now has % rounds but workout % has %',
        new.slug, new.rounds, bad_workout.id, bad_workout.rounds;
    end if;
  end if;

  -- switching to plain must not strand existing prescriptions
  if new.type = 'plain' then
    select * into presc from prescriptions where exercise_slug = new.slug limit 1;
    if presc.id is not null then
      raise exception 'exercise % changed to plain but prescription % still exists for it',
        new.slug, presc.id;
    end if;
  end if;

  -- existing prescriptions must still match the (possibly new) weight shape
  if new.type <> 'plain' then
    for presc in select * from prescriptions where exercise_slug = new.slug loop
      n := coalesce(array_length(presc.weights, 1), 0);
      if new.type = 'ramp_up' then
        if n <> new.rounds then
          raise exception 'exercise % now needs % weights but prescription % has %',
            new.slug, new.rounds, presc.id, n;
        end if;
      else
        if n <> 1 then
          raise exception 'exercise % now needs exactly 1 weight but prescription % has %',
            new.slug, presc.id, n;
        end if;
      end if;
    end loop;
  end if;

  -- laterality must still match every existing slot's side
  if new.unilateral then
    select * into bad_slot from workout_slots
    where exercise_slug = new.slug and side is null
    limit 1;

    if bad_slot.workout_id is not null then
      raise exception 'exercise % is now unilateral so slot %/% needs a side',
        new.slug, bad_slot.workout_id, bad_slot.position;
    end if;
  else
    select * into bad_slot from workout_slots
    where exercise_slug = new.slug and side is not null
    limit 1;

    if bad_slot.workout_id is not null then
      raise exception 'exercise % is no longer unilateral so slot %/% must not set a side',
        new.slug, bad_slot.workout_id, bad_slot.position;
    end if;
  end if;

  return new;
end;
$$;

create trigger exercises_update_guard
after update of rounds, type, unilateral on exercises
for each row execute function check_exercise_update();
