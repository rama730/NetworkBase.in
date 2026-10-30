-- Update cards, live (the "Update card real-time" report). The database announces every change to an update or a
-- comment when it commits, whichever path wrote it. Events carry ids and counts only: text, names and photos always
-- come from the normal per-viewer reads, so private profiles, blocks and moderation stay in one place (RT3).

-- Rises with every change clients care about; they ignore anything lower, so repeats and reordering do no harm.
ALTER TABLE public.workspace_updates ADD COLUMN activity_seq bigint NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE FUNCTION app_private.update_event_send(p_workspace uuid, p_update uuid, p_event text, p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN RETURN; END IF;
  -- An announcement must never fail the like or comment that caused it.
  BEGIN
    PERFORM realtime.send(p_payload, p_event, 'updates:workspace:' || p_workspace::text, true);
    PERFORM realtime.send(p_payload, p_event, 'updates:post:' || p_update::text, true);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.update_activity_seq() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF (NEW.like_count, NEW.comment_count, NEW.content, NEW.is_pinned, NEW.pinned_until, NEW.visibility, NEW.audience, NEW.deleted_at)
     IS DISTINCT FROM (OLD.like_count, OLD.comment_count, OLD.content, OLD.is_pinned, OLD.pinned_until, OLD.visibility, OLD.audience, OLD.deleted_at) THEN
    NEW.activity_seq := OLD.activity_seq + 1;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_updates_activity_seq BEFORE UPDATE ON public.workspace_updates
  FOR EACH ROW EXECUTE FUNCTION app_private.update_activity_seq();
--> statement-breakpoint
CREATE FUNCTION app_private.update_event_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM app_private.update_event_send(OLD.workspace_id, OLD.id, 'update.removed', jsonb_build_object('id', OLD.id));
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.id, 'update.created', jsonb_build_object('id', NEW.id, 'seq', NEW.activity_seq));
    RETURN NULL;
  END IF;
  IF NEW.activity_seq = OLD.activity_seq THEN RETURN NULL; END IF;
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.id, 'update.removed', jsonb_build_object('id', NEW.id, 'seq', NEW.activity_seq));
    RETURN NULL;
  END IF;
  IF NEW.like_count IS DISTINCT FROM OLD.like_count OR NEW.comment_count IS DISTINCT FROM OLD.comment_count THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.id, 'update.counts',
      jsonb_build_object('id', NEW.id, 'likes', NEW.like_count, 'comments', NEW.comment_count, 'seq', NEW.activity_seq));
  END IF;
  IF (NEW.content, NEW.is_pinned, NEW.pinned_until, NEW.visibility, NEW.audience, NEW.deleted_at)
     IS DISTINCT FROM (OLD.content, OLD.is_pinned, OLD.pinned_until, OLD.visibility, OLD.audience, OLD.deleted_at) THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.id, 'update.changed', jsonb_build_object('id', NEW.id, 'seq', NEW.activity_seq));
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_updates_event AFTER INSERT OR UPDATE OR DELETE ON public.workspace_updates
  FOR EACH ROW EXECUTE FUNCTION app_private.update_event_row();
--> statement-breakpoint
CREATE FUNCTION app_private.update_comment_event_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM app_private.update_event_send(OLD.workspace_id, OLD.update_id, 'comment.removed', jsonb_build_object('updateId', OLD.update_id, 'commentId', OLD.id));
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.update_id, 'comment.created',
      jsonb_build_object('updateId', NEW.update_id, 'commentId', NEW.id, 'parentId', NEW.parent_id));
  ELSIF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.update_id, 'comment.removed', jsonb_build_object('updateId', NEW.update_id, 'commentId', NEW.id));
  ELSIF (NEW.content, NEW.deleted_at) IS DISTINCT FROM (OLD.content, OLD.deleted_at) THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.update_id, 'comment.changed', jsonb_build_object('updateId', NEW.update_id, 'commentId', NEW.id));
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_update_comments_event AFTER INSERT OR UPDATE OR DELETE ON public.workspace_update_comments
  FOR EACH ROW EXECUTE FUNCTION app_private.update_comment_event_row();
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.update_event_send(uuid, uuid, text, jsonb), app_private.update_activity_seq(),
  app_private.update_event_row(), app_private.update_comment_event_row() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- Who can listen: anyone who can read the workspace's updates, or that one post. Checked once, at join. Nobody but the
-- database can publish: no send policy covers these topics. Signed-out visitors get no live updates (RT9).
CREATE FUNCTION app_private.nb_update_topic_readable(p_topic text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_topic ~ '^updates:workspace:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      app_private.nb_workspace_tab_visible(split_part(p_topic, ':', 3)::uuid, 'updates')
    WHEN p_topic ~ '^updates:post:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN EXISTS (
      SELECT 1 FROM public.workspace_updates u
      WHERE u.id = split_part(p_topic, ':', 3)::uuid
        AND app_private.nb_workspace_tab_visible(u.workspace_id, 'updates')
        AND (u.visibility = 'public' OR app_private.nb_workspace_can_write(u.workspace_id)
          OR EXISTS (SELECT 1 FROM public.workspace_members pm WHERE pm.workspace_id = u.workspace_id AND pm.user_id = (SELECT auth.uid())))
        AND app_private.nb_update_audience_ok(u.workspace_id, u.author_id, u.audience))
    ELSE false
  END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_update_topic_readable(text) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.nb_update_topic_readable(text) TO authenticated;
--> statement-breakpoint
CREATE POLICY update_topics_read ON realtime.messages FOR SELECT TO authenticated
  USING (extension = 'broadcast' AND (SELECT realtime.topic()) LIKE 'updates:%' AND (SELECT app_private.nb_update_topic_readable((SELECT realtime.topic()))));
