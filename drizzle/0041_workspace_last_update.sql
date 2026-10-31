-- Who last did real work in a workspace, and when: tasks, files, posted updates, GitHub pushes (stamped here) and detail edits (stamped by the server). updated_at also moves for system changes, so it can't answer this.
ALTER TABLE public.workspaces
    ADD COLUMN last_update_at timestamp with time zone DEFAULT now() NOT NULL,
    ADD COLUMN last_update_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
CREATE INDEX workspaces_last_update_by_idx ON public.workspaces USING btree (last_update_by) WHERE last_update_by IS NOT NULL;
--> statement-breakpoint
-- The server reads these as nb_app; browsers read no column they weren't granted.
REVOKE SELECT (last_update_at, last_update_by), INSERT (last_update_at, last_update_by), UPDATE (last_update_at, last_update_by) ON public.workspaces FROM anon, authenticated;
--> statement-breakpoint
-- The newest real event, else updated_at with no name.
WITH newest AS (
    SELECT DISTINCT ON (workspace_id) workspace_id, actor_id, at
    FROM (
        SELECT e.workspace_id, e.actor_id, e.created_at AS at
        FROM public.task_activity_events e
        JOIN public.tasks t ON t.id = e.task_id
        JOIN public.workspaces w ON w.id = e.workspace_id
        WHERE e.actor_id IS NOT NULL AND NOT (w.kind = 'organization' AND t.assignment_id IS NOT NULL)
        UNION ALL
        SELECT workspace_id, actor_id, created_at FROM public.workspace_node_events
        WHERE actor_id IS NOT NULL AND ((node_id IS NOT NULL AND type NOT LIKE 'lock\_%') OR type IN ('project_social_links.updated', 'project_readme.settings_updated', 'task_merge'))
        UNION ALL
        SELECT workspace_id, author_id, created_at FROM public.workspace_updates
        WHERE author_id IS NOT NULL AND deleted_at IS NULL
        UNION ALL
        SELECT workspace_id, actor_id, updated_at FROM public.github_sync_runs
        WHERE status = 'completed' AND manifest->>'direction' = 'push'
          AND ((manifest->>'mode' = 'direct' AND result->>'pushed' = 'true')
            OR (manifest->>'mode' = 'pr' AND nullif(result->>'pullRequestUrl', '') IS NOT NULL))
    ) events
    ORDER BY workspace_id, at DESC
)
UPDATE public.workspaces w
SET last_update_at = coalesce(n.at, w.updated_at, w.created_at, now()),
    last_update_by = (SELECT p.id FROM public.profiles p WHERE p.id = n.actor_id)
FROM public.workspaces base
LEFT JOIN newest n ON n.workspace_id = base.id
WHERE base.id = w.id;
--> statement-breakpoint
-- One minute per person: bursts of edits and bulk inserts don't rewrite the row.
CREATE FUNCTION app_private.stamp_workspace_update(p_workspace uuid, p_actor uuid) RETURNS void
LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  UPDATE public.workspaces SET last_update_at = now(), last_update_by = p_actor
  WHERE id = p_workspace AND deleted_at IS NULL
    AND (last_update_by IS DISTINCT FROM p_actor OR last_update_at < now() - interval '1 minute');
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.workspace_update_from_task_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- A member's own copy of an assignment stays private on the organization; a team's copy in its own workspace counts.
  IF NOT EXISTS (
    SELECT 1 FROM public.tasks t JOIN public.workspaces w ON w.id = t.workspace_id
    WHERE t.id = NEW.task_id AND t.assignment_id IS NOT NULL AND w.kind = 'organization'
  ) THEN
    PERFORM app_private.stamp_workspace_update(NEW.workspace_id, NEW.actor_id);
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_update_task_event AFTER INSERT ON public.task_activity_events
  FOR EACH ROW WHEN (NEW.actor_id IS NOT NULL) EXECUTE FUNCTION app_private.workspace_update_from_task_event();
--> statement-breakpoint
CREATE FUNCTION app_private.workspace_update_from_node_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.stamp_workspace_update(NEW.workspace_id, NEW.actor_id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_update_node_event AFTER INSERT ON public.workspace_node_events
  FOR EACH ROW WHEN (NEW.actor_id IS NOT NULL AND ((NEW.node_id IS NOT NULL AND NEW.type NOT LIKE 'lock\_%') OR NEW.type IN ('project_social_links.updated', 'project_readme.settings_updated', 'task_merge')))
  EXECUTE FUNCTION app_private.workspace_update_from_node_event();
--> statement-breakpoint
CREATE FUNCTION app_private.workspace_update_from_post() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.stamp_workspace_update(NEW.workspace_id, NEW.author_id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_update_post AFTER INSERT ON public.workspace_updates
  FOR EACH ROW WHEN (NEW.author_id IS NOT NULL) EXECUTE FUNCTION app_private.workspace_update_from_post();
--> statement-breakpoint
CREATE FUNCTION app_private.workspace_update_from_github_push() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.stamp_workspace_update(NEW.workspace_id, NEW.actor_id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_update_github_push AFTER UPDATE OF status ON public.github_sync_runs
  FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status AND NEW.status = 'completed' AND NEW.manifest->>'direction' = 'push'
    AND ((NEW.manifest->>'mode' = 'direct' AND NEW.result->>'pushed' = 'true')
      OR (NEW.manifest->>'mode' = 'pr' AND nullif(NEW.result->>'pullRequestUrl', '') IS NOT NULL)))
  EXECUTE FUNCTION app_private.workspace_update_from_github_push();
--> statement-breakpoint
CREATE FUNCTION app_private.workspace_update_on_create() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  NEW.last_update_by := NEW.owner_id;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_update_on_create BEFORE INSERT ON public.workspaces
  FOR EACH ROW EXECUTE FUNCTION app_private.workspace_update_on_create();
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.stamp_workspace_update(uuid, uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.workspace_update_from_task_event() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.workspace_update_from_node_event() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.workspace_update_from_post() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.workspace_update_from_github_push() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.workspace_update_on_create() FROM PUBLIC;
