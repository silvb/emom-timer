-- Identity only. Never contains numbers that change over time.
create table exercises (
  slug        text primary key,
  movement    text not null,
  name        text not null,
  type        text not null check (type in ('ramp_up','rep_range','fixed','plain')),
  rounds      int,
  unilateral  boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint ramp_rounds_present check ((type = 'ramp_up') = (rounds is not null))
);

-- Append-only. One row per prescription change. Never UPDATE, never DELETE.
create table prescriptions (
  id            bigserial primary key,
  exercise_slug text not null references exercises(slug) on delete restrict,
  effective_at  timestamptz not null default now(),
  reps_min      int not null,
  reps_max      int not null,
  weights       numeric[] not null,
  constraint reps_ordered check (reps_max >= reps_min),
  constraint reps_positive check (reps_min > 0),
  constraint weights_present check (array_length(weights, 1) >= 1)
);
create index prescriptions_lookup on prescriptions (exercise_slug, effective_at desc, id desc);

create table workouts (
  id       text primary key,
  title    text not null,
  day      text check (day in ('monday','tuesday','wednesday','thursday','friday','saturday','sunday')),
  rounds   int  not null check (rounds > 0),
  position int  not null
);

create table workout_slots (
  workout_id    text not null references workouts(id) on delete cascade,
  position      int  not null,
  exercise_slug text not null references exercises(slug) on delete restrict,
  side          text check (side in ('alternating','per_round')),
  primary key (workout_id, position)
);

-- Current prescription per exercise
create view current_prescriptions as
select distinct on (exercise_slug) *
from prescriptions
order by exercise_slug, effective_at desc, id desc;

-- Invariant 1 + 3: weight-array length matches the exercise kind, and
-- 'plain' exercises never get a prescription at all.
create function check_prescription_shape() returns trigger
language plpgsql as $$
declare
  ex exercises%rowtype;
  n  int;
begin
  select * into ex from exercises where slug = new.exercise_slug;
  n := coalesce(array_length(new.weights, 1), 0);

  if ex.type = 'plain' then
    raise exception 'exercise % is plain and cannot have a prescription', ex.slug;
  elsif ex.type = 'ramp_up' then
    if n <> ex.rounds then
      raise exception 'ramp_up exercise % needs exactly % weights, got %', ex.slug, ex.rounds, n;
    end if;
  else
    if n <> 1 then
      raise exception 'exercise % needs exactly 1 weight, got %', ex.slug, n;
    end if;
  end if;

  return new;
end;
$$;

create trigger prescriptions_shape
before insert or update on prescriptions
for each row execute function check_prescription_shape();

-- Invariant 2 + 4: a ramp exercise only fits a workout with the same round
-- count, and a slot's side must match the exercise's laterality.
create function check_slot_shape() returns trigger
language plpgsql as $$
declare
  ex exercises%rowtype;
  wo workouts%rowtype;
begin
  select * into ex from exercises where slug = new.exercise_slug;
  select * into wo from workouts  where id   = new.workout_id;

  if ex.type = 'ramp_up' and ex.rounds <> wo.rounds then
    raise exception 'ramp_up exercise % has % rounds but workout % has %',
      ex.slug, ex.rounds, wo.id, wo.rounds;
  end if;

  if ex.unilateral and new.side is null then
    raise exception 'exercise % is unilateral so slot %/% needs a side',
      ex.slug, new.workout_id, new.position;
  end if;

  if not ex.unilateral and new.side is not null then
    raise exception 'exercise % is not unilateral so slot %/% must not set a side',
      ex.slug, new.workout_id, new.position;
  end if;

  return new;
end;
$$;

create trigger workout_slots_shape
before insert or update on workout_slots
for each row execute function check_slot_shape();

-- Changing a workout's round count must not silently break its ramp slots.
create function check_workout_rounds() returns trigger
language plpgsql as $$
declare
  bad text;
begin
  select e.slug into bad
  from workout_slots s
  join exercises e on e.slug = s.exercise_slug
  where s.workout_id = new.id and e.type = 'ramp_up' and e.rounds <> new.rounds
  limit 1;

  if bad is not null then
    raise exception 'workout % now has % rounds but ramp exercise % expects %',
      new.id, new.rounds, bad, (select rounds from exercises where slug = bad);
  end if;

  return new;
end;
$$;

create trigger workouts_rounds_guard
after update of rounds on workouts
for each row execute function check_workout_rounds();

alter table exercises      enable row level security;
alter table prescriptions  enable row level security;
alter table workouts       enable row level security;
alter table workout_slots  enable row level security;

-- Single-user app: any authenticated session is the owner.
-- Public signup MUST be disabled in the Supabase dashboard; that toggle is
-- the security boundary these policies rely on.
create policy owner_all on exercises     for all to authenticated using (true) with check (true);
create policy owner_all on workouts      for all to authenticated using (true) with check (true);
create policy owner_all on workout_slots for all to authenticated using (true) with check (true);

-- Prescriptions are append-only: authenticated users may read and insert,
-- but there is deliberately no update or delete policy, so RLS denies both.
create policy prescriptions_read   on prescriptions for select to authenticated using (true);
create policy prescriptions_insert on prescriptions for insert to authenticated with check (true);
