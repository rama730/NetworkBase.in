-- Live screens hear "this row changed" on private topics, then re-read what they may see. Replaces postgres_changes.
-- Events carry ids, counts and timestamps, never titles, bodies or names. The per-user events use the existing
-- chat:user:<id> topic; the four live: topics below follow the read rule of the table they announce.
CREATE FUNCTION app_private.live_send(p_topic text, p_event text, p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN RETURN; END IF;
  -- An announcement must never fail the write that caused it.
  BEGIN
    PERFORM realtime.send(p_payload, p_event, p_topic, true);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.live_task_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.id ELSE NEW.id END;
  v_workspace uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
  v_payload jsonb := jsonb_build_object('op', TG_OP, 'id', v_id);
BEGIN
  PERFORM app_private.live_send('live:tasks:' || v_workspace::text, 'task.changed', v_payload);
  PERFORM app_private.live_send('live:task:' || v_id::text, 'task.changed', v_payload);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.live_task_comment_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_task uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.task_id ELSE NEW.task_id END;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP <> 'DELETE' THEN
    v_new := jsonb_build_object('id', NEW.id, 'parent_comment_id', NEW.parent_comment_id, 'deleted_at', NEW.deleted_at, 'deleted_by', NEW.deleted_by);
  END IF;
  IF TG_OP <> 'INSERT' THEN
    v_old := jsonb_build_object('id', OLD.id, 'parent_comment_id', OLD.parent_comment_id, 'deleted_at', OLD.deleted_at);
  END IF;
  PERFORM app_private.live_send('live:task:' || v_task::text, 'comment.changed', jsonb_build_object('op', TG_OP, 'new', v_new, 'old', v_old));
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.live_task_subtask_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_task uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.task_id ELSE NEW.task_id END;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP <> 'DELETE' THEN v_new := jsonb_build_object('id', NEW.id, 'completed', NEW.completed); END IF;
  IF TG_OP <> 'INSERT' THEN v_old := jsonb_build_object('id', OLD.id, 'completed', OLD.completed); END IF;
  PERFORM app_private.live_send('live:task:' || v_task::text, 'subtask.changed', jsonb_build_object('op', TG_OP, 'new', v_new, 'old', v_old));
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.live_task_link_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_task uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.task_id ELSE NEW.task_id END;
BEGIN
  PERFORM app_private.live_send('live:task:' || v_task::text, 'attachment.changed', jsonb_build_object('op', TG_OP));
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.live_workflow_column_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_workspace uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
BEGIN
  PERFORM app_private.live_send('live:tasks:' || v_workspace::text, 'workflow.changed', '{}'::jsonb);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.live_file_lock_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_workspace uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.workspace_id ELSE NEW.workspace_id END;
BEGIN
  PERFORM app_private.live_send('live:files:' || v_workspace::text, 'lock.changed', '{}'::jsonb);
  RETURN NULL;
END
$$;
--> statement-breakpoint
-- Anyone who can read the workspace can already read these public numbers. Import progress only signals a re-read.
CREATE FUNCTION app_private.live_workspace_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.live_send('live:workspace:' || NEW.id::text, 'workspace.changed', jsonb_build_object(
    'current_stage_index', NEW.current_stage_index,
    'stage_completion_dates', NEW.stage_completion_dates,
    'view_count', NEW.view_count,
    'followers_count', NEW.followers_count,
    'updated_at', NEW.updated_at));
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.live_profile_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM app_private.live_send('chat:user:' || NEW.id::text, 'profile.changed', '{}'::jsonb);
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.live_notification_event() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  v_new jsonb;
  v_old jsonb;
BEGIN
  IF TG_OP <> 'DELETE' THEN v_new := jsonb_build_object('id', NEW.id, 'kind', NEW.kind, 'activity_at', NEW.activity_at); END IF;
  IF TG_OP <> 'INSERT' THEN v_old := jsonb_build_object('id', OLD.id, 'kind', OLD.kind, 'activity_at', OLD.activity_at); END IF;
  PERFORM app_private.live_send('chat:user:' || v_user::text, 'notification.changed', jsonb_build_object('op', TG_OP, 'new', v_new, 'old', v_old));
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER live_task_event AFTER INSERT OR UPDATE OR DELETE ON public.tasks
  FOR EACH ROW EXECUTE FUNCTION app_private.live_task_event();
--> statement-breakpoint
CREATE TRIGGER live_task_comment_event AFTER INSERT OR UPDATE OR DELETE ON public.task_comments
  FOR EACH ROW EXECUTE FUNCTION app_private.live_task_comment_event();
--> statement-breakpoint
CREATE TRIGGER live_task_subtask_event AFTER INSERT OR UPDATE OR DELETE ON public.task_subtasks
  FOR EACH ROW EXECUTE FUNCTION app_private.live_task_subtask_event();
--> statement-breakpoint
CREATE TRIGGER live_task_link_event AFTER INSERT OR UPDATE OR DELETE ON public.task_node_links
  FOR EACH ROW EXECUTE FUNCTION app_private.live_task_link_event();
--> statement-breakpoint
CREATE TRIGGER live_workflow_column_event AFTER INSERT OR UPDATE OR DELETE ON public.workspace_workflow_columns
  FOR EACH ROW EXECUTE FUNCTION app_private.live_workflow_column_event();
--> statement-breakpoint
CREATE TRIGGER live_file_lock_event AFTER INSERT OR UPDATE OR DELETE ON public.workspace_node_locks
  FOR EACH ROW EXECUTE FUNCTION app_private.live_file_lock_event();
--> statement-breakpoint
CREATE TRIGGER live_workspace_event AFTER UPDATE ON public.workspaces
  FOR EACH ROW WHEN (
    (OLD.current_stage_index, OLD.stage_completion_dates, OLD.view_count, OLD.followers_count, OLD.import_source)
    IS DISTINCT FROM (NEW.current_stage_index, NEW.stage_completion_dates, NEW.view_count, NEW.followers_count, NEW.import_source)
  ) EXECUTE FUNCTION app_private.live_workspace_event();
--> statement-breakpoint
CREATE TRIGGER live_profile_event AFTER UPDATE ON public.profiles
  FOR EACH ROW WHEN ((OLD.username, OLD.full_name, OLD.avatar_url) IS DISTINCT FROM (NEW.username, NEW.full_name, NEW.avatar_url))
  EXECUTE FUNCTION app_private.live_profile_event();
--> statement-breakpoint
CREATE TRIGGER live_notification_event AFTER INSERT OR UPDATE OR DELETE ON public.user_notifications
  FOR EACH ROW EXECUTE FUNCTION app_private.live_notification_event();
--> statement-breakpoint
CREATE FUNCTION app_private.nb_live_topic_readable(p_topic text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  WITH parsed AS (
    SELECT split_part(p_topic, ':', 2) AS area, split_part(p_topic, ':', 3)::uuid AS id
    WHERE p_topic ~ '^live:(workspace|tasks|task|files):[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
  )
  SELECT coalesce((
    SELECT CASE p.area
      WHEN 'workspace' THEN app_private.nb_workspace_can_read(p.id)
      WHEN 'tasks' THEN app_private.nb_workspace_tab_visible(p.id, 'tasks')
      WHEN 'task' THEN app_private.nb_task_visible(p.id)
      WHEN 'files' THEN (
        EXISTS (SELECT 1 FROM public.workspaces w WHERE w.id = p.id AND w.deleted_at IS NULL AND w.owner_id = (SELECT auth.uid()))
        OR EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = p.id AND m.user_id = (SELECT auth.uid())))
    END
    FROM parsed p
  ), false)
$$;
--> statement-breakpoint
CREATE POLICY live_topics_read ON realtime.messages AS PERMISSIVE FOR SELECT TO authenticated USING (
  extension = 'broadcast'
  AND (SELECT realtime.topic()) LIKE 'live:%'
  AND (SELECT app_private.nb_live_topic_readable((SELECT realtime.topic())))
);
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.live_send(text, text, jsonb) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.live_task_event() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.live_task_comment_event() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.live_task_subtask_event() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.live_task_link_event() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.live_workflow_column_event() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.live_file_lock_event() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.live_workspace_event() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.live_profile_event() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.live_notification_event() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_live_topic_readable(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.nb_live_topic_readable(text) TO authenticated;
