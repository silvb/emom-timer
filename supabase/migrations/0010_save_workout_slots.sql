-- Reordering slots cannot be a plain UPDATE: the primary key is
-- (workout_id, position), so moving slot 3 to position 1 collides with the row
-- already there. The workable shape is delete-all-then-reinsert, which over
-- Supabase's REST layer is two separate requests with no transaction between
-- them. If the second fails, the workout is left with no slots at all and the
-- user finds out at the rack.
--
-- A plpgsql function body runs inside one transaction, so both statements
-- commit or neither does. That — not privilege — is the entire reason this
-- exists, which is why it is deliberately NOT `security definer`: it runs as
-- the caller, RLS applies normally, and it grants nothing the client did not
-- already have from 0008.
--
-- Positions are renumbered 1..N from array order, so the client never has to
-- send or reason about position numbers; it sends the list in display order.
create function save_workout_slots(p_workout_id text, p_slots jsonb)
returns void
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if not exists (select 1 from workouts where id = p_workout_id) then
    raise exception 'workout % does not exist', p_workout_id;
  end if;

  if jsonb_typeof(p_slots) <> 'array' then
    raise exception 'p_slots must be a JSON array, got %', jsonb_typeof(p_slots);
  end if;

  delete from workout_slots where workout_id = p_workout_id;

  insert into workout_slots (workout_id, position, exercise_slug, side)
  select p_workout_id,
         (ord)::int,
         elem->>'exercise_slug',
         nullif(elem->>'side', '')
  from jsonb_array_elements(p_slots) with ordinality as t(elem, ord);
end;
$$;
