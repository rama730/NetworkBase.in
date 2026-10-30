-- The old project names were kept as views for one release after the rename, and the current code reads none of them.
-- Browsers also stop reading notification preferences on workspaces and members; the server still does.
DROP VIEW public.profile_project_contribution_stages;
--> statement-breakpoint
DROP VIEW public.profile_project_contributions;
--> statement-breakpoint
DROP VIEW public.project_doc_versions;
--> statement-breakpoint
DROP VIEW public.project_docs;
--> statement-breakpoint
DROP VIEW public.project_event_counters;
--> statement-breakpoint
DROP VIEW public.project_file_index;
--> statement-breakpoint
DROP VIEW public.project_follows;
--> statement-breakpoint
DROP VIEW public.project_git_deltas;
--> statement-breakpoint
DROP VIEW public.project_guidance_appointments;
--> statement-breakpoint
DROP VIEW public.project_invitations;
--> statement-breakpoint
DROP VIEW public.project_members;
--> statement-breakpoint
DROP VIEW public.project_node_conflicts;
--> statement-breakpoint
DROP VIEW public.project_node_events;
--> statement-breakpoint
DROP VIEW public.project_node_locks;
--> statement-breakpoint
DROP VIEW public.project_nodes;
--> statement-breakpoint
DROP VIEW public.project_open_roles;
--> statement-breakpoint
DROP VIEW public.project_skills;
--> statement-breakpoint
DROP VIEW public.project_sprint_events;
--> statement-breakpoint
DROP VIEW public.project_sprints;
--> statement-breakpoint
DROP VIEW public.project_tags;
--> statement-breakpoint
DROP VIEW public.project_task_policy_events;
--> statement-breakpoint
DROP VIEW public.project_update_comments;
--> statement-breakpoint
DROP VIEW public.project_update_draft_media_assets;
--> statement-breakpoint
DROP VIEW public.project_update_drafts;
--> statement-breakpoint
DROP VIEW public.project_update_likes;
--> statement-breakpoint
DROP VIEW public.project_update_media_assets;
--> statement-breakpoint
DROP VIEW public.project_updates;
--> statement-breakpoint
DROP VIEW public.project_workflow_columns;
--> statement-breakpoint
DROP VIEW public.projects;
--> statement-breakpoint
REVOKE SELECT (notification_preferences) ON public.workspaces FROM anon, authenticated;
--> statement-breakpoint
REVOKE SELECT ON public.workspace_members FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT (id, workspace_id, user_id, role, joined_at, file_upload_enabled, title, show_on_profile, last_seen_updates_at, unit_id) ON public.workspace_members TO anon, authenticated;
