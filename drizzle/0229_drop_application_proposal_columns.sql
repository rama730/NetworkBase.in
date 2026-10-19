-- The application-level "proposed role" flow never had a writer: nothing sets role_applications.status to
-- 'proposed', proposed_role_id, applying_project_id or applying_project_role (project invitations are the live
-- way to offer someone a role). The server code that read them is gone, so the columns, their foreign keys and
-- their indexes go with them. Dropping a column drops its indexes and foreign keys.
-- The 'proposed' value stays in the status enum (enum values cannot be dropped); nothing writes it.
-- chat_get_or_create_dm still has an 'application' reason branch from 0180; it is unreachable (application threads
-- come from chat_ensure_application_channel) and is left alone because applied migrations are immutable.
-- Before applying live, a read-only check that the columns hold nothing worth keeping:
--   SELECT count(*) FILTER (WHERE proposed_role_id IS NOT NULL) AS proposed,
--          count(*) FILTER (WHERE applying_project_id IS NOT NULL OR applying_project_role IS NOT NULL) AS applying
--   FROM role_applications;
ALTER TABLE public.role_applications
  DROP COLUMN IF EXISTS proposed_role_id,
  DROP COLUMN IF EXISTS applying_project_id,
  DROP COLUMN IF EXISTS applying_project_role;
