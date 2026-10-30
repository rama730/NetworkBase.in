-- The workspace topic is open to anyone who can see the Updates tab, so it must only carry posts they can all read.
-- Public posts for everyone go there; members-only posts go to a members' topic; a post with a narrower audience stays
-- on its own topic, whose join checks that audience. No text or names ever travelled, but ids and counts did.
CREATE OR REPLACE FUNCTION app_private.update_event_send(p_workspace uuid, p_update uuid, p_event text, p_payload jsonb) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_visibility text;
  v_audience jsonb;
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN RETURN; END IF;
  -- An announcement must never fail the like or comment that caused it.
  BEGIN
    SELECT u.visibility, u.audience INTO v_visibility, v_audience FROM public.workspace_updates u WHERE u.id = p_update;
    PERFORM realtime.send(p_payload, p_event, 'updates:post:' || p_update::text, true);
    IF coalesce(v_audience, '{}'::jsonb) = '{}'::jsonb THEN
      IF v_visibility = 'public' THEN
        PERFORM realtime.send(p_payload, p_event, 'updates:workspace:' || p_workspace::text, true);
      ELSIF v_visibility IS NOT NULL THEN
        PERFORM realtime.send(p_payload, p_event, 'updates:members:' || p_workspace::text, true);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END
$$;
--> statement-breakpoint
-- A post narrowed from public: those who had it on screen hear only that it changed, and their re-read decides.
CREATE OR REPLACE FUNCTION app_private.update_event_row() RETURNS trigger
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
  IF (NEW.visibility, NEW.audience) IS DISTINCT FROM (OLD.visibility, OLD.audience)
     AND OLD.visibility = 'public' AND OLD.audience = '{}'::jsonb AND to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
    BEGIN
      PERFORM realtime.send(jsonb_build_object('id', NEW.id, 'seq', NEW.activity_seq), 'update.changed', 'updates:workspace:' || NEW.workspace_id::text, true);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
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
CREATE OR REPLACE FUNCTION app_private.nb_update_topic_readable(p_topic text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT CASE
    WHEN p_topic ~ '^updates:workspace:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      app_private.nb_workspace_tab_visible(split_part(p_topic, ':', 3)::uuid, 'updates')
    WHEN p_topic ~ '^updates:members:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      app_private.nb_workspace_tab_visible(split_part(p_topic, ':', 3)::uuid, 'updates')
      AND (app_private.nb_workspace_can_write(split_part(p_topic, ':', 3)::uuid)
        OR EXISTS (SELECT 1 FROM public.workspace_members pm WHERE pm.workspace_id = split_part(p_topic, ':', 3)::uuid AND pm.user_id = (SELECT auth.uid())))
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
