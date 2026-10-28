-- Organizations P15 (report §30.3 trust and safety, §30.5 lifecycle). 0241 already added suspended_at,
-- suspend_reason, deletion_scheduled_at and verification_domain; this adds the last two lifecycle columns.
-- discover_hidden_at: a platform admin hid a project or org from Discover and search.
-- verification_requested_at: the owner asked for the Verified badge (platform admin review).
ALTER TABLE public.projects
  ADD COLUMN discover_hidden_at timestamptz,
  ADD COLUMN verification_requested_at timestamptz;
--> statement-breakpoint
CREATE INDEX projects_deletion_scheduled_idx ON public.projects (deletion_scheduled_at) WHERE deletion_scheduled_at IS NOT NULL;
--> statement-breakpoint
CREATE INDEX projects_verification_requested_idx ON public.projects (verification_requested_at) WHERE verification_requested_at IS NOT NULL;
--> statement-breakpoint
-- Reports on projects, orgs, posts, docs and comments (one table beside chat_reports). Server-only.
CREATE TABLE public.content_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  target_kind text NOT NULL CONSTRAINT content_reports_kind_check CHECK (target_kind IN ('project', 'update', 'update_comment', 'doc', 'task_comment')),
  target_id uuid NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  reason text NOT NULL CONSTRAINT content_reports_reason_check CHECK (reason IN ('impersonation', 'spam', 'harassment', 'inappropriate', 'other')),
  details text CONSTRAINT content_reports_details_check CHECK (details IS NULL OR char_length(details) <= 2000),
  status text NOT NULL DEFAULT 'open' CONSTRAINT content_reports_status_check CHECK (status IN ('open', 'dismissed', 'actioned')),
  action text CONSTRAINT content_reports_action_check CHECK (action IS NULL OR action IN ('hidden', 'removed', 'suspended')),
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX content_reports_open_idx ON public.content_reports (created_at DESC) WHERE status = 'open';
--> statement-breakpoint
CREATE UNIQUE INDEX content_reports_one_open_idx ON public.content_reports (reporter_id, target_kind, target_id) WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX content_reports_target_idx ON public.content_reports (target_kind, target_id);
--> statement-breakpoint
CREATE INDEX content_reports_project_idx ON public.content_reports (project_id) WHERE project_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX content_reports_resolved_by_idx ON public.content_reports (resolved_by) WHERE resolved_by IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.content_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.content_reports FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- Read-only orgs (report §30.3, §30.5): no new chat messages in a suspended, archived or deleting org, nor in
-- child projects archived with it. System messages still post.
CREATE FUNCTION app_private.chat_org_read_only_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.kind = 'user' AND EXISTS (
    SELECT 1 FROM public.chat_channels c
    JOIN public.projects p ON p.id = c.project_id
    LEFT JOIN public.projects o ON o.id = p.parent_id AND o.kind = 'organization'
    WHERE c.id = NEW.channel_id AND (
      p.suspended_at IS NOT NULL OR p.deletion_scheduled_at IS NOT NULL
      OR (p.kind = 'organization' AND p.status = 'archived')
      OR o.suspended_at IS NOT NULL
      OR (o.status = 'archived' AND p.status = 'archived')
    )
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_org_read_only';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER chat_messages_org_read_only_guard
  BEFORE INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION app_private.chat_org_read_only_guard();
--> statement-breakpoint
-- The same rule for new posts, comments and tasks (report §30.3, §30.5): every write path, including ones that
-- don't go through the app's access layer. Only INSERT: cleanup and account deletion still update and delete.
CREATE FUNCTION app_private.nb_project_read_only(p_project_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.projects p
    LEFT JOIN public.projects o ON o.id = p.parent_id AND o.kind = 'organization'
    WHERE p.id = p_project_id AND (
      p.suspended_at IS NOT NULL OR p.deletion_scheduled_at IS NOT NULL
      OR (p.kind = 'organization' AND p.status = 'archived')
      OR o.suspended_at IS NOT NULL
      OR (o.status = 'archived' AND p.status = 'archived')
    )
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_project_read_only(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_project_read_only_guard()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_project uuid;
BEGIN
  IF TG_TABLE_NAME = 'project_update_comments' THEN
    SELECT u.project_id INTO v_project FROM public.project_updates u WHERE u.id = NEW.update_id;
  ELSIF TG_TABLE_NAME = 'task_comments' THEN
    SELECT t.project_id INTO v_project FROM public.tasks t WHERE t.id = NEW.task_id;
  ELSE
    v_project := NEW.project_id;
  END IF;
  IF v_project IS NOT NULL AND app_private.nb_project_read_only(v_project) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'project_read_only';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER project_updates_read_only_guard BEFORE INSERT ON public.project_updates
  FOR EACH ROW EXECUTE FUNCTION app_private.nb_project_read_only_guard();
--> statement-breakpoint
CREATE TRIGGER project_update_comments_read_only_guard BEFORE INSERT ON public.project_update_comments
  FOR EACH ROW EXECUTE FUNCTION app_private.nb_project_read_only_guard();
--> statement-breakpoint
CREATE TRIGGER tasks_read_only_guard BEFORE INSERT ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION app_private.nb_project_read_only_guard();
--> statement-breakpoint
CREATE TRIGGER task_comments_read_only_guard BEFORE INSERT ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION app_private.nb_project_read_only_guard();
