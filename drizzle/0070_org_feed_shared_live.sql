-- Shared posts and the organization feed (audit 2026-11-09, N50): sharing a workspace post up, hiding it from the
-- organization or showing it again sends the organization's feed a live event, so it appears or leaves without a reload.
CREATE OR REPLACE FUNCTION app_private.update_activity_seq()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
  IF (NEW.like_count, NEW.comment_count, NEW.content, NEW.is_pinned, NEW.pinned_until, NEW.visibility, NEW.audience, NEW.deleted_at, NEW.reply_policy, NEW.shared_to_org_at, NEW.hidden_from_org_at)
     IS DISTINCT FROM (OLD.like_count, OLD.comment_count, OLD.content, OLD.is_pinned, OLD.pinned_until, OLD.visibility, OLD.audience, OLD.deleted_at, OLD.reply_policy, OLD.shared_to_org_at, OLD.hidden_from_org_at) THEN
    NEW.activity_seq := OLD.activity_seq + 1;
  END IF;
  RETURN NEW;
END
$function$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.update_event_row()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  -- Audit N50: sharing a post up, hiding it or showing it again reaches the organization's own feed live.
  IF (NEW.shared_to_org_at IS NOT NULL AND NEW.hidden_from_org_at IS NULL) IS DISTINCT FROM (OLD.shared_to_org_at IS NOT NULL AND OLD.hidden_from_org_at IS NULL) THEN
    PERFORM app_private.update_event_send(p.parent_id, NEW.id,
      CASE WHEN NEW.shared_to_org_at IS NOT NULL AND NEW.hidden_from_org_at IS NULL THEN 'update.created' ELSE 'update.removed' END,
      jsonb_build_object('id', NEW.id, 'seq', NEW.activity_seq))
    FROM public.workspaces p WHERE p.id = NEW.workspace_id AND p.parent_id IS NOT NULL;
  END IF;
  IF (NEW.content, NEW.is_pinned, NEW.pinned_until, NEW.visibility, NEW.audience, NEW.deleted_at, NEW.reply_policy)
     IS DISTINCT FROM (OLD.content, OLD.is_pinned, OLD.pinned_until, OLD.visibility, OLD.audience, OLD.deleted_at, OLD.reply_policy) THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.id, 'update.changed', jsonb_build_object('id', NEW.id, 'seq', NEW.activity_seq));
  END IF;
  RETURN NULL;
END
$function$;
