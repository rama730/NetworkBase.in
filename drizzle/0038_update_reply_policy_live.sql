-- Changing who can reply reaches everyone looking at the post, like any other change to it.
CREATE OR REPLACE FUNCTION app_private.update_activity_seq() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF (NEW.like_count, NEW.comment_count, NEW.content, NEW.is_pinned, NEW.pinned_until, NEW.visibility, NEW.audience, NEW.deleted_at, NEW.reply_policy)
     IS DISTINCT FROM (OLD.like_count, OLD.comment_count, OLD.content, OLD.is_pinned, OLD.pinned_until, OLD.visibility, OLD.audience, OLD.deleted_at, OLD.reply_policy) THEN
    NEW.activity_seq := OLD.activity_seq + 1;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.update_event_row() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
  IF (NEW.content, NEW.is_pinned, NEW.pinned_until, NEW.visibility, NEW.audience, NEW.deleted_at, NEW.reply_policy)
     IS DISTINCT FROM (OLD.content, OLD.is_pinned, OLD.pinned_until, OLD.visibility, OLD.audience, OLD.deleted_at, OLD.reply_policy) THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.id, 'update.changed', jsonb_build_object('id', NEW.id, 'seq', NEW.activity_seq));
  END IF;
  RETURN NULL;
END
$$;
