-- 0251: indexes behind the organization foreign keys that lacked one (live lineage gate; same rule as 0206).
-- Deleting a profile, project, unit or sprint looks up referencing rows by these columns. Nullable keys get
-- "<column> IS NOT NULL" partial indexes, which Postgres can use for that lookup; the existing partial
-- unique indexes on (org_id, email) and (sprint_id, ...) can't, because their predicates are on other columns.
-- Built inside the migration transaction: the org tables are new and projects is small.
CREATE INDEX IF NOT EXISTS org_email_invites_org_idx ON public.org_email_invites (org_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS org_email_invites_child_project_idx ON public.org_email_invites (child_project_id) WHERE child_project_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS org_email_invites_unit_idx ON public.org_email_invites (unit_id) WHERE unit_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS org_email_invites_invited_by_idx ON public.org_email_invites (invited_by) WHERE invited_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS org_join_blocks_blocked_by_idx ON public.org_join_blocks (blocked_by) WHERE blocked_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS projects_verified_by_idx ON public.projects (verified_by) WHERE verified_by IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sprint_materials_sprint_idx ON public.sprint_materials (sprint_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sprint_materials_added_by_idx ON public.sprint_materials (added_by) WHERE added_by IS NOT NULL;
