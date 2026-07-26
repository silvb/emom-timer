-- RLS denies UPDATE/DELETE on prescriptions for `authenticated`, but
-- relforcerowsecurity is false, so the table owner and service role (i.e.
-- exactly the roles used for the documented Phase-1 admin workflow of
-- hand-written SQL in the Supabase dashboard) are exempt from RLS entirely.
-- A trigger is role-agnostic: it fires regardless of who owns the row lock,
-- so it is the only backstop that actually protects the append-only
-- invariant from a careless dashboard UPDATE or DELETE.
create function reject_prescription_mutation() returns trigger
language plpgsql as $$
begin
  raise exception 'prescriptions are append-only; insert a new row instead';
end;
$$;

create trigger prescriptions_append_only
  before update or delete on prescriptions
  for each row execute function reject_prescription_mutation();

-- prescriptions_shape (0001) fired on insert or update to validate weight-
-- array shape. Update is now unconditionally rejected above, so narrow it to
-- insert — an update can never reach it, and keeping "or update" would just
-- leave two triggers racing to reject the same statement for different
-- reasons.
drop trigger prescriptions_shape on prescriptions;

create trigger prescriptions_shape
  before insert on prescriptions
  for each row execute function check_prescription_shape();
