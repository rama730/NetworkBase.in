-- 0245_org_updates.sql
-- Org Updates (docs/organization-concept-report.md §17): announcement and discussion posts, an audience
-- (roles or child projects; empty = everyone), a notify level, pins with an unpin date (up to 3 in an org,
-- 1 elsewhere), comments off, and child posts shared up to the org. Mirrors src/lib/organizations/update-rules.ts.

ALTER TABLE public.project_updates DROP CONSTRAINT IF EXISTS project_updates_update_type_check;

--> statement-breakpoint

ALTER TABLE public.project_updates
  ADD CONSTRAINT project_updates_update_type_check CHECK (
    update_type IS NULL OR update_type IN (
      'progress', 'milestone', 'release', 'blocker', 'decision', 'collaboration_request', 'behind_the_scenes',
      'announcement', 'discussion'
    )
  );

--> statement-breakpoint

ALTER TABLE public.project_updates DROP CONSTRAINT IF EXISTS project_updates_reply_policy_check;

--> statement-breakpoint

ALTER TABLE public.project_updates
  ADD CONSTRAINT project_updates_reply_policy_check CHECK (reply_policy IN ('logged_in', 'members', 'closed')),
  ADD COLUMN audience jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN notify_level text NOT NULL DEFAULT 'in_app',
  ADD COLUMN pinned_until timestamptz,
  ADD COLUMN shared_to_org_at timestamptz,
  ADD CONSTRAINT project_updates_notify_level_check CHECK (notify_level IN ('in_app', 'email'));

--> statement-breakpoint

-- Shared-up child posts, read by the org feed newest first.
CREATE INDEX project_updates_shared_idx ON public.project_updates (shared_to_org_at DESC, id DESC)
  WHERE shared_to_org_at IS NOT NULL AND deleted_at IS NULL;

--> statement-breakpoint

-- Pins: up to 3 live pins in an org, 1 in any other project (0217 kept one per project with a unique
-- index; the limit now depends on the project's kind, so it moves into a trigger). A pin whose
-- pinned_until has passed no longer counts.
DROP INDEX IF EXISTS public.project_updates_one_live_pin_idx;

--> statement-breakpoint

CREATE FUNCTION app_private.nb_project_update_pin_limit()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
DECLARE
  v_kind text;
  v_live integer;
  v_limit integer;
BEGIN
  IF NOT NEW.is_pinned OR NEW.deleted_at IS NOT NULL OR (NEW.pinned_until IS NOT NULL AND NEW.pinned_until <= now()) THEN
    RETURN NEW;
  END IF;
  SELECT kind INTO v_kind FROM public.projects WHERE id = NEW.project_id FOR UPDATE;
  SELECT count(*) INTO v_live
  FROM public.project_updates u
  WHERE u.project_id = NEW.project_id AND u.id <> NEW.id AND u.is_pinned AND u.deleted_at IS NULL
    AND (u.pinned_until IS NULL OR u.pinned_until > now());
  v_limit := CASE WHEN v_kind = 'organization' THEN 3 ELSE 1 END;
  IF v_live >= v_limit THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'project_update_pin_limit';
  END IF;
  RETURN NEW;
END
$$;

--> statement-breakpoint

CREATE TRIGGER project_updates_pin_limit
  BEFORE INSERT OR UPDATE OF is_pinned, pinned_until, deleted_at ON public.project_updates
  FOR EACH ROW EXECUTE FUNCTION app_private.nb_project_update_pin_limit();

--> statement-breakpoint

-- Audience: everyone when empty; otherwise the author, the org's owner and admins, the listed roles, and
-- members of the listed child projects.
CREATE FUNCTION app_private.nb_update_audience_ok(p_project_id uuid, p_author_id uuid, p_audience jsonb)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_audience IS NULL OR p_audience = '{}'::jsonb
    OR p_author_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.projects p WHERE p.id = p_project_id AND p.owner_id = (SELECT auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.project_members pm
      WHERE pm.project_id = p_project_id AND pm.user_id = (SELECT auth.uid())
        AND (pm.role = 'admin' OR p_audience->'roles' @> to_jsonb(pm.role))
    )
    OR (p_audience->'projectIds' IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.project_members cm
      WHERE cm.user_id = (SELECT auth.uid())
        AND cm.project_id::text IN (SELECT jsonb_array_elements_text(p_audience->'projectIds'))
    ));
$$;

--> statement-breakpoint

REVOKE ALL ON FUNCTION app_private.nb_update_audience_ok(uuid, uuid, jsonb) FROM PUBLIC;

--> statement-breakpoint

GRANT EXECUTE ON FUNCTION app_private.nb_update_audience_ok(uuid, uuid, jsonb) TO anon, authenticated, service_role;

--> statement-breakpoint

DROP POLICY IF EXISTS project_updates_read ON public.project_updates;

--> statement-breakpoint

CREATE POLICY project_updates_read ON public.project_updates FOR SELECT TO anon, authenticated
  USING (
    (deleted_at IS NULL OR author_id = (SELECT auth.uid()))
    AND app_private.nb_project_tab_visible(project_id, 'updates')
    AND (visibility = 'public' OR app_private.nb_project_can_write(project_id)
         OR EXISTS (SELECT 1 FROM public.project_members pm WHERE pm.project_id = project_updates.project_id AND pm.user_id = (SELECT auth.uid())))
    AND app_private.nb_update_audience_ok(project_id, author_id, audience)
  );
