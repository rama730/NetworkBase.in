-- Blocking, second pass (the Blocking report, checked line by line after 0273).
--
-- Sending: mentions, @channel/@here, hints and pushes skip anyone in a block with the author, so no badge or push
-- crosses a block in groups and threads either (B8, B33, K31).
CREATE OR REPLACE FUNCTION app_private.chat_send_message(p_channel_id uuid, p_author_id uuid, p_body text, p_client_id text DEFAULT NULL::text, p_thread_root bigint DEFAULT NULL::bigint, p_mentions uuid[] DEFAULT '{}'::uuid[], p_broadcast text DEFAULT NULL::text, p_attachments jsonb DEFAULT '[]'::jsonb, p_card jsonb DEFAULT NULL::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_channel record;
  v_other uuid;
  v_result jsonb;
  v_seq bigint;
  v_direct boolean;
  v_mentioned uuid[] := '{}';
  v_notify uuid[] := '{}';
  v_muted uuid[] := '{}';
  v_follows uuid[] := '{}';
BEGIN
  p_body := coalesce(p_body, '');
  p_attachments := coalesce(p_attachments, '[]'::jsonb);
  IF char_length(p_body) > 4000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_body_too_long';
  END IF;
  IF btrim(p_body) = '' AND jsonb_array_length(p_attachments) = 0 AND p_card IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_empty_message';
  END IF;
  IF jsonb_array_length(p_attachments) > 10 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_too_many_attachments';
  END IF;
  IF p_broadcast IS NOT NULL AND p_broadcast NOT IN ('channel', 'here') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_broadcast';
  END IF;

  SELECT id, kind, name, workspace_id, archived_at, member_count, application_id INTO v_channel FROM public.chat_channels WHERE id = p_channel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;
  IF NOT app_private.chat_is_member(p_channel_id, p_author_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_channel_archived';
  END IF;
  -- An application thread is a shared room: nobody posts into it while blocked with someone else in it.
  IF v_channel.application_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_channel_members bm
    WHERE bm.channel_id = p_channel_id AND bm.user_id <> p_author_id AND app_private.chat_is_blocked(p_author_id, bm.user_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_blocked';
  END IF;
  IF v_channel.kind = 'dm' THEN
    SELECT user_id INTO v_other FROM public.chat_channel_members
    WHERE channel_id = p_channel_id AND user_id <> p_author_id LIMIT 1;
    IF v_other IS NOT NULL AND app_private.chat_is_blocked(p_author_id, v_other) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_blocked';
    END IF;
  END IF;
  IF p_broadcast IS NOT NULL AND v_channel.member_count > 100 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_broadcast_mention_too_large';
  END IF;

  v_result := app_private.chat_append_message(p_channel_id, p_author_id, 'user', p_body, p_client_id, p_thread_root, p_attachments, p_card);
  IF (v_result->>'deduped')::boolean THEN
    RETURN v_result;
  END IF;
  v_seq := (v_result->>'channel_seq')::bigint;

  IF p_broadcast IS NOT NULL OR cardinality(coalesce(p_mentions, '{}')) > 0 THEN
    SELECT coalesce(array_agg(m.user_id), '{}') INTO v_mentioned
    FROM public.chat_channel_members m
    WHERE m.channel_id = p_channel_id
      AND m.user_id <> p_author_id
      -- Mentions, @channel and @here never reach someone in a block with the author: no row, no badge (B33, K31).
      AND NOT app_private.blocked_between(m.user_id, p_author_id)
      AND (p_broadcast IS NOT NULL OR m.user_id = ANY (p_mentions));
    -- A follower mentioned in a thread reply already got a 'thread_reply' row from
    -- chat_append_message: the mention wins, so it files under Mentions (#1).
    INSERT INTO public.chat_mentions (user_id, channel_id, message_seq, kind)
    SELECT u, p_channel_id, v_seq, coalesce(p_broadcast, 'user') FROM unnest(v_mentioned) AS u
    ON CONFLICT (user_id, channel_id, message_seq) DO UPDATE SET kind = EXCLUDED.kind
      WHERE public.chat_mentions.kind = 'thread_reply';
    UPDATE public.chat_channel_members
    SET mention_count = mention_count + 1, archived_at = NULL
    WHERE channel_id = p_channel_id AND user_id = ANY (v_mentioned);
  END IF;

  -- A new DM or group-chat message brings the conversation back for everyone.
  IF v_channel.kind = 'dm' OR v_channel.kind = 'private' THEN
    UPDATE public.chat_channel_members
    SET archived_at = NULL
    WHERE channel_id = p_channel_id AND user_id <> p_author_id AND archived_at IS NOT NULL;
  END IF;

  -- Who gets a live hint: DM and group-chat members (notify = all), mentioned
  -- members and thread followers. Muted members get a hint only when mentioned
  -- (their badge counts it, #9) and never a push (`muted`). `follows` lists the
  -- thread followers, so a reply only counts for people who follow it (#3).
  -- Skipped for ordinary channel messages so big channels pay nothing extra.
  v_direct := v_channel.kind = 'dm' OR (v_channel.kind = 'private' AND v_channel.workspace_id IS NULL) OR v_channel.application_id IS NOT NULL;
  IF v_direct OR cardinality(v_mentioned) > 0 OR p_thread_root IS NOT NULL THEN
    SELECT coalesce(array_agg(m.user_id), '{}'),
           coalesce(array_agg(m.user_id) FILTER (WHERE m.notify = 'mute'), '{}'),
           coalesce(array_agg(m.user_id) FILTER (WHERE f.user_id IS NOT NULL), '{}')
    INTO v_notify, v_muted, v_follows
    FROM public.chat_channel_members m
    LEFT JOIN public.chat_thread_follows f
      ON p_thread_root IS NOT NULL AND f.user_id = m.user_id AND f.channel_id = p_channel_id AND f.root_seq = p_thread_root
    WHERE m.channel_id = p_channel_id AND m.user_id <> p_author_id
      -- No hint or push from someone you're in a block with, in groups and threads too (B8, B33).
      AND NOT app_private.blocked_between(m.user_id, p_author_id)
      AND (
        m.user_id = ANY (v_mentioned)
        OR (m.notify <> 'mute' AND ((v_direct AND m.notify = 'all') OR f.user_id IS NOT NULL))
      );
  END IF;

  RETURN v_result || jsonb_build_object('notify', to_jsonb(v_notify), 'muted', to_jsonb(v_muted),
    'follows', to_jsonb(v_follows), 'channel_kind', v_channel.kind);
END
$function$;
--> statement-breakpoint
-- Folded messages don't make a channel unread for the person who blocked their author (B33, K32): someone who had read
-- up to the message before keeps reading up to it.
CREATE FUNCTION app_private.block_keep_read() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.kind <> 'user' OR NEW.thread_root_seq IS NOT NULL OR NEW.author_id IS NULL THEN RETURN NULL; END IF;
  UPDATE public.chat_channel_members m SET last_read_seq = NEW.channel_seq
  FROM public.user_blocks b
  WHERE m.channel_id = NEW.channel_id AND b.blocker_id = m.user_id AND b.blocked_id = NEW.author_id
    AND m.last_read_seq >= coalesce((SELECT max(p.channel_seq) FROM public.chat_messages p
      WHERE p.channel_id = NEW.channel_id AND p.thread_root_seq IS NULL AND p.channel_seq < NEW.channel_seq), 0);
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.block_keep_read() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER chat_messages_block_keep_read AFTER INSERT ON public.chat_messages
  FOR EACH ROW EXECUTE FUNCTION app_private.block_keep_read();
--> statement-breakpoint
-- Ownership never goes to someone the owner is in a block with (B36, K35). A team inside an organization is the
-- organization's to hand over, so it isn't covered (B45).
CREATE FUNCTION app_private.block_guard_owner() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.parent_id IS NULL AND app_private.blocked_between(OLD.owner_id, NEW.owner_id) THEN
    PERFORM app_private.refuse_across_block();
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.block_guard_owner() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER workspaces_block_guard_owner BEFORE UPDATE OF owner_id ON public.workspaces
  FOR EACH ROW WHEN (OLD.owner_id IS DISTINCT FROM NEW.owner_id) EXECUTE FUNCTION app_private.block_guard_owner();
--> statement-breakpoint
-- "Remove and block from this workspace" for owners (B27): the same join block organizations already have, now kept
-- by the database for any workspace, so a removed person can't come back by code, link, application or invitation.
CREATE FUNCTION app_private.join_block_guard() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_user uuid;
BEGIN
  -- One branch per table: plpgsql resolves every field an expression names, even in a branch not taken.
  IF TG_TABLE_NAME = 'workspace_members' THEN v_user := NEW.user_id;
  ELSIF TG_TABLE_NAME = 'role_applications' THEN v_user := NEW.applicant_id;
  ELSE v_user := NEW.candidate_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.org_join_blocks j WHERE j.org_id = NEW.workspace_id AND j.user_id = v_user) THEN
    PERFORM app_private.refuse_across_block();
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.join_block_guard() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER workspace_members_join_block BEFORE INSERT ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION app_private.join_block_guard();
--> statement-breakpoint
CREATE TRIGGER role_applications_join_block BEFORE INSERT ON public.role_applications FOR EACH ROW EXECUTE FUNCTION app_private.join_block_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_invitations_join_block BEFORE INSERT ON public.workspace_invitations FOR EACH ROW EXECUTE FUNCTION app_private.join_block_guard();
--> statement-breakpoint
-- A group chat outside any workspace that gains someone you blocked: the same private heads-up as a workspace, with
-- the conversation (and its Leave) one tap away (B41). Workspace channels are covered by the workspace's own heads-up.
CREATE FUNCTION app_private.chat_block_heads_up() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chat_channels c WHERE c.id = NEW.channel_id AND c.kind = 'private' AND c.workspace_id IS NULL AND c.application_id IS NULL) THEN
    RETURN NULL;
  END IF;
  INSERT INTO public.user_notifications (user_id, kind, importance, title, body, href, dedupe_key)
  SELECT b.blocker_id, 'chat_invite', 'important',
         'Someone you blocked is in a group chat with you',
         'Only you can see this. Their messages are folded for you, and you can leave the conversation any time.',
         '/messages/' || NEW.channel_id::text,
         'block-heads-up:' || NEW.channel_id::text || ':' || b.blocked_id::text
  FROM public.chat_channel_members m
  JOIN public.user_blocks b ON (b.blocker_id = m.user_id AND b.blocked_id = NEW.user_id) OR (b.blocker_id = NEW.user_id AND b.blocked_id = m.user_id)
  WHERE m.channel_id = NEW.channel_id AND m.user_id <> NEW.user_id
  ON CONFLICT (user_id, dedupe_key) DO NOTHING;
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_block_heads_up() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE TRIGGER chat_channel_members_block_heads_up AFTER INSERT ON public.chat_channel_members
  FOR EACH ROW EXECUTE FUNCTION app_private.chat_block_heads_up();
--> statement-breakpoint
-- "Getting around a block" is a report reason (B28, K26), under §15.
ALTER TABLE public.content_reports DROP CONSTRAINT content_reports_reason_check;
--> statement-breakpoint
ALTER TABLE public.content_reports ADD CONSTRAINT content_reports_reason_check CHECK (reason = ANY (ARRAY['threat', 'self_harm', 'child_safety',
  'intimate_images', 'private_info', 'harassment', 'hate_speech', 'impersonation', 'evading_block', 'scam', 'inappropriate', 'spam', 'other']));
--> statement-breakpoint
-- Mute (B26): a lighter, private choice than a block. Their posts, comments and messages fold for you; nothing is
-- removed and nobody is told.
CREATE TABLE public.user_mutes (
  muter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  muted_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (muter_id, muted_id),
  CONSTRAINT user_mutes_not_self CHECK (muter_id <> muted_id)
);
--> statement-breakpoint
ALTER TABLE public.user_mutes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.user_mutes FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- The heads-up points to the private way out (B48): "Ask to change team" in a team's "⋯" inside an organization.
CREATE OR REPLACE FUNCTION app_private.block_heads_up() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_title text;
  v_team boolean;
BEGIN
  SELECT w.title, w.parent_id IS NOT NULL INTO v_title, v_team
  FROM public.workspaces w WHERE w.id = NEW.workspace_id AND w.kind <> 'organization' AND w.deleted_at IS NULL;
  IF v_title IS NULL THEN RETURN NEW; END IF;
  INSERT INTO public.user_notifications (user_id, kind, importance, title, body, href, entity_refs, dedupe_key)
  SELECT b.blocker_id, 'org_membership', 'important',
         'Someone you blocked is also in ' || v_title,
         CASE WHEN v_team
           THEN 'Only you can see this. Their posts and messages fold for you. To move, use “Ask to change team” in the team’s “⋯”; nobody else is named.'
           ELSE 'Only you can see this. Their posts and messages fold for you.' END,
         '/workspaces/' || NEW.workspace_id::text,
         jsonb_build_object('projectId', NEW.workspace_id),
         'block-heads-up:' || NEW.workspace_id::text || ':' || b.blocked_id::text
  FROM public.workspace_members m
  JOIN public.user_blocks b ON (b.blocker_id = m.user_id AND b.blocked_id = NEW.user_id) OR (b.blocker_id = NEW.user_id AND b.blocked_id = m.user_id)
  WHERE m.workspace_id = NEW.workspace_id AND m.user_id <> NEW.user_id
  ON CONFLICT (user_id, dedupe_key) DO NOTHING;
  RETURN NEW;
END
$$;
