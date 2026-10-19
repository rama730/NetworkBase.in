-- 0219 created a trigger function in public with the default PUBLIC execute grant, which Supabase
-- exposes to browser roles as an RPC. A trigger function needs no caller EXECUTE privilege.
REVOKE ALL ON FUNCTION public.set_connection_acceptance_time() FROM PUBLIC, anon, authenticated;
