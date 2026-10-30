-- Likes on comments and replies (Updates as posts, UP10). The server reads and writes them; browsers get nothing.
ALTER TABLE public.workspace_update_comments
    ADD COLUMN like_count integer DEFAULT 0 NOT NULL,
    ADD CONSTRAINT workspace_update_comments_like_count_check CHECK (like_count >= 0);
--> statement-breakpoint
CREATE TABLE public.workspace_update_comment_likes (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    comment_id uuid NOT NULL REFERENCES public.workspace_update_comments(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_update_comment_likes_unique UNIQUE (comment_id, user_id)
);
--> statement-breakpoint
CREATE INDEX workspace_update_comment_likes_user_idx ON public.workspace_update_comment_likes USING btree (user_id);
--> statement-breakpoint
ALTER TABLE public.workspace_update_comment_likes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.workspace_update_comment_likes FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE, UPDATE ON TABLE public.workspace_update_comment_likes TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.workspace_update_comment_likes TO service_role;
--> statement-breakpoint
CREATE FUNCTION app_private.block_guard_update_comment_like() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF app_private.blocked_between(NEW.user_id, (SELECT c.user_id FROM public.workspace_update_comments c WHERE c.id = NEW.comment_id)) THEN
    PERFORM app_private.refuse_across_block();
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.block_guard_update_comment_like() FROM PUBLIC;
--> statement-breakpoint
CREATE TRIGGER workspace_update_comment_likes_block_guard BEFORE INSERT ON public.workspace_update_comment_likes FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_update_comment_like();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.update_comment_event_row() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
  ELSIF NEW.like_count IS DISTINCT FROM OLD.like_count THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.update_id, 'comment.likes', jsonb_build_object('updateId', NEW.update_id, 'commentId', NEW.id, 'likes', NEW.like_count));
  END IF;
  RETURN NULL;
END
$$;
