-- The API let anyone list a public workspace's members, including people who turned off Show on my profile, and its followers. The server reads these with nb_app; browsers only ever need their own rows.
ALTER POLICY workspace_members_select_visible ON public.workspace_members USING ((SELECT auth.uid()) = user_id);
--> statement-breakpoint
ALTER POLICY workspace_members_select_visible ON public.workspace_members RENAME TO workspace_members_select_own;
--> statement-breakpoint
REVOKE SELECT (joined_at, file_upload_enabled, title, show_on_profile, last_seen_updates_at, unit_id) ON public.workspace_members FROM anon, authenticated;
--> statement-breakpoint
ALTER POLICY workspace_follows_select_visible ON public.workspace_follows USING ((SELECT auth.uid()) = user_id);
--> statement-breakpoint
ALTER POLICY workspace_follows_select_visible ON public.workspace_follows RENAME TO workspace_follows_select_own;
