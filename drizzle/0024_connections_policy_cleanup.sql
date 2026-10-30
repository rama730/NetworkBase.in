-- One read rule for connections. The old own-row rule overlapped the newer one and kept blocked rows visible to the
-- person who was blocked; the newer rule now resolves the caller once per query instead of once per row.
DROP POLICY connections_select_own ON public.connections;
--> statement-breakpoint
ALTER POLICY connections_select_participant_visible ON public.connections
  USING ((((SELECT auth.uid()) = requester_id) OR ((SELECT auth.uid()) = addressee_id)) AND ((status <> 'blocked'::public.status_connection) OR (blocked_by = (SELECT auth.uid()))));
