-- current_prescriptions ran as its owner (postgres), which bypasses RLS on the
-- underlying prescriptions table entirely. Since anon holds a SELECT grant on
-- the view, anyone with the deployed URL could read every prescription
-- unauthenticated, despite prescriptions/exercises both being empty to anon
-- directly. security_invoker makes the view re-check RLS as the querying
-- role, restoring the same authenticated-only boundary as the base tables.
alter view public.current_prescriptions set (security_invoker = on);
