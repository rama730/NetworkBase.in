-- Browsers read none of these columns; the server does, as nb_app. profiles_select_visible reads the four
-- connections columns as the caller, so anon and authenticated keep exactly those.
REVOKE SELECT ON public.connections FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT (id, requester_id, addressee_id, status) ON public.connections TO anon, authenticated;
--> statement-breakpoint
-- Lock tokens prove who holds a lock; holder and expiry are all a member needs to see.
REVOKE SELECT ON public.workspace_node_locks FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT (node_id, workspace_id, locked_by, acquired_at, expires_at, client_kind) ON public.workspace_node_locks TO anon, authenticated;
--> statement-breakpoint
REVOKE SELECT (sync_status, github_last_commit_sha, cover_image_key, current_sequence_number, status_set_by) ON public.workspaces FROM anon, authenticated;
