-- Blocking, end to end (Trust & Safety report, Blocking tab, B1–B52). Blocks get their own table with one row per
-- direction, so each person's block is their own (B1, K4). One rule, blocked_between, answers "is there a block
-- either way?" for every query, function and policy (B2). The database itself refuses every interaction across a
-- block (B29), so no screen, API or job can get around it.

CREATE TABLE public.user_blocks (
  blocker_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  source text NOT NULL DEFAULT 'profile' CONSTRAINT user_blocks_source_check
    CHECK (source IN ('profile', 'message', 'comment', 'person_card', 'member_list', 'report', 'settings', 'legacy')),
  case_id uuid REFERENCES public.moderation_cases(id) ON DELETE SET NULL,
  note text CONSTRAINT user_blocks_note_check CHECK (note IS NULL OR char_length(note) <= 500),
  -- What the block removed, so Undo within 10 seconds can put it back (B12, D1). Cleared after the window.
  restore jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);
--> statement-breakpoint
CREATE INDEX user_blocks_blocked_idx ON public.user_blocks (blocked_id, blocker_id);
--> statement-breakpoint
CREATE INDEX user_blocks_case_idx ON public.user_blocks (case_id) WHERE case_id IS NOT NULL;
--> statement-breakpoint
REVOKE ALL ON public.user_blocks FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
-- Existing blocks move over as they are: the connections row's blocked_by is the blocker.
INSERT INTO public.user_blocks (blocker_id, blocked_id, source, created_at)
SELECT c.blocked_by, CASE WHEN c.blocked_by = c.requester_id THEN c.addressee_id ELSE c.requester_id END, 'legacy', coalesce(c.blocked_at, c.updated_at)
FROM public.connections c
WHERE c.status = 'blocked' AND c.blocked_by IS NOT NULL
ON CONFLICT DO NOTHING;
--> statement-breakpoint
DELETE FROM public.connections WHERE status = 'blocked';
--> statement-breakpoint
-- The one rule (B2).
CREATE FUNCTION app_private.blocked_between(p_a uuid, p_b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_a IS NOT NULL AND p_b IS NOT NULL AND p_a <> p_b AND EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = p_a AND b.blocked_id = p_b) OR (b.blocker_id = p_b AND b.blocked_id = p_a)
  )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.blocked_between(uuid, uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.blocked_between(uuid, uuid) TO authenticated;
--> statement-breakpoint
-- Every existing caller of the old checks now asks the one rule.
CREATE OR REPLACE FUNCTION app_private.chat_is_blocked(p_a uuid, p_b uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app_private.blocked_between(p_a, p_b)
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_presence_activity_visible(p_viewer uuid, p_target uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT p_viewer IS NOT NULL AND p_target IS NOT NULL AND (
    p_viewer = p_target
    OR (
      NOT app_private.blocked_between(p_viewer, p_target)
      AND (SELECT count(*) FROM public.profiles p WHERE p.id IN (p_viewer, p_target) AND p.show_activity) = 2
    )
  );
$$;
--> statement-breakpoint
-- A conversation where contact is cut: a DM across a block, or a group that has shrunk to a blocked pair (B34).
CREATE FUNCTION app_private.chat_contact_cut(p_channel uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channels c
    JOIN public.chat_channel_members m ON m.channel_id = c.id AND m.user_id <> p_user
    WHERE c.id = p_channel
      AND (c.kind = 'dm' OR (c.workspace_id IS NULL AND c.application_id IS NULL AND (SELECT count(*) FROM public.chat_channel_members a WHERE a.channel_id = c.id) = 2))
      AND app_private.blocked_between(p_user, m.user_id)
  )
$$;
--> statement-breakpoint
-- Typing goes to members only, and never across a block (B32, K29).
CREATE FUNCTION app_private.chat_can_signal(p_channel uuid, p_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT app_private.chat_is_member(p_channel, p_user) AND NOT app_private.chat_contact_cut(p_channel, p_user)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_contact_cut(uuid, uuid), app_private.chat_can_signal(uuid, uuid) FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.chat_contact_cut(uuid, uuid), app_private.chat_can_signal(uuid, uuid) TO authenticated;
--> statement-breakpoint
ALTER POLICY application_topic_send ON realtime.messages
WITH CHECK (
CASE
    WHEN (( SELECT realtime.topic() AS topic) ~ '^presence:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = ANY (ARRAY['presence'::text, 'broadcast'::text])) AND (split_part(( SELECT realtime.topic() AS topic), ':'::text, 3) = (( SELECT auth.uid() AS uid))::text) AND app_private.nb_can_publish_user_presence())
    WHEN (( SELECT realtime.topic() AS topic) ~ '^presence:task:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = ANY (ARRAY['presence'::text, 'broadcast'::text])) AND (EXISTS ( SELECT 1
       FROM tasks task
      WHERE (((task.id)::text = split_part(( SELECT realtime.topic() AS topic), ':'::text, 3)) AND app_private.nb_workspace_tab_visible(task.workspace_id, 'tasks'::text)))))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^project-stats:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = 'broadcast'::text) AND app_private.nb_workspace_can_read((split_part(( SELECT realtime.topic() AS topic), ':'::text, 2))::uuid))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^chat:channel:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN false
    WHEN (( SELECT realtime.topic() AS topic) ~ '^chat:typing:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = 'broadcast'::text) AND app_private.chat_can_signal((split_part(( SELECT realtime.topic() AS topic), ':'::text, 3))::uuid, ( SELECT auth.uid() AS uid)))
    ELSE false
END
);
--> statement-breakpoint
-- A workspace someone owns personally (not an organization, not a team inside one): a block by its owner keeps the
-- other person out (B36). Organizations are institutions and never are (B45, D6).
CREATE FUNCTION app_private.personal_workspace_owner(p_workspace uuid) RETURNS uuid
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT w.owner_id FROM public.workspaces w WHERE w.id = p_workspace AND w.kind <> 'organization' AND w.parent_id IS NULL
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.personal_workspace_owner(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- One refusal for every write across a block. The wording never says "blocked" (B31).
CREATE FUNCTION app_private.refuse_across_block() RETURNS void
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_available';
END
$$;
--> statement-breakpoint
-- Likes, comments, replies and mentions on posts and tasks (B9, K6, K19).
CREATE FUNCTION app_private.block_guard_social() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_other uuid;
BEGIN
  IF TG_TABLE_NAME = 'workspace_update_likes' THEN
    SELECT u.author_id INTO v_other FROM public.workspace_updates u WHERE u.id = NEW.update_id;
    IF app_private.blocked_between(NEW.user_id, v_other) THEN PERFORM app_private.refuse_across_block(); END IF;
  ELSIF TG_TABLE_NAME = 'workspace_update_comments' THEN
    SELECT u.author_id INTO v_other FROM public.workspace_updates u WHERE u.id = NEW.update_id;
    IF app_private.blocked_between(NEW.user_id, v_other)
       OR app_private.blocked_between(NEW.user_id, NEW.target_user_id)
       OR app_private.blocked_between(NEW.user_id, (SELECT p.user_id FROM public.workspace_update_comments p WHERE p.id = NEW.parent_id)) THEN
      PERFORM app_private.refuse_across_block();
    END IF;
  ELSIF TG_TABLE_NAME = 'task_comment_likes' THEN
    SELECT c.user_id INTO v_other FROM public.task_comments c WHERE c.id = NEW.comment_id;
    IF app_private.blocked_between(NEW.user_id, v_other) THEN PERFORM app_private.refuse_across_block(); END IF;
  ELSIF TG_TABLE_NAME = 'task_comments' THEN
    IF NEW.parent_comment_id IS NOT NULL
       AND app_private.blocked_between(NEW.user_id, (SELECT p.user_id FROM public.task_comments p WHERE p.id = NEW.parent_comment_id)) THEN
      PERFORM app_private.refuse_across_block();
    END IF;
  ELSIF TG_TABLE_NAME = 'comment_mentions' THEN
    -- A mention across a block is dropped, not refused: the comment still posts, the person isn't reached (B9).
    IF app_private.blocked_between(NEW.mentioned_user_id, (SELECT c.user_id FROM public.task_comments c WHERE c.id = NEW.comment_id)) THEN
      RETURN NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'workspace_follows' THEN
    IF app_private.blocked_between(NEW.user_id, (SELECT w.owner_id FROM public.workspaces w WHERE w.id = NEW.workspace_id)) THEN
      PERFORM app_private.refuse_across_block();
    END IF;
  ELSIF TG_TABLE_NAME = 'workspace_invitations' THEN
    IF app_private.blocked_between(NEW.inviter_id, NEW.candidate_id)
       OR app_private.blocked_between(app_private.personal_workspace_owner(NEW.workspace_id), NEW.candidate_id) THEN
      PERFORM app_private.refuse_across_block();
    END IF;
  ELSIF TG_TABLE_NAME = 'role_applications' THEN
    IF app_private.blocked_between(NEW.applicant_id, app_private.personal_workspace_owner(NEW.workspace_id)) THEN
      PERFORM app_private.refuse_across_block();
    END IF;
  ELSIF TG_TABLE_NAME = 'workspace_members' THEN
    IF app_private.blocked_between(NEW.user_id, app_private.personal_workspace_owner(NEW.workspace_id)) THEN
      PERFORM app_private.refuse_across_block();
    END IF;
  ELSIF TG_TABLE_NAME = 'connections' THEN
    IF app_private.blocked_between(NEW.requester_id, NEW.addressee_id) THEN PERFORM app_private.refuse_across_block(); END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER workspace_update_likes_block_guard BEFORE INSERT ON public.workspace_update_likes FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER workspace_update_comments_block_guard BEFORE INSERT ON public.workspace_update_comments FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER task_comment_likes_block_guard BEFORE INSERT ON public.task_comment_likes FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER task_comments_block_guard BEFORE INSERT ON public.task_comments FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER comment_mentions_block_guard BEFORE INSERT ON public.comment_mentions FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER workspace_follows_block_guard BEFORE INSERT ON public.workspace_follows FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER workspace_invitations_block_guard BEFORE INSERT ON public.workspace_invitations FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER role_applications_block_guard BEFORE INSERT ON public.role_applications FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER workspace_members_block_guard BEFORE INSERT ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER connections_block_guard BEFORE INSERT ON public.connections FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
-- Messages: reactions to their messages are refused everywhere (B15, K12, K44); mentions, @channel and @here never
-- reach the other (B33, K31); a conversation where contact is cut takes no new messages, edits, pins, tabs or canvas
-- changes (B15, B34, K13, K33, K38).
CREATE FUNCTION app_private.block_guard_chat() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Partitioned tables fire this under each partition's name (chat_messages_p05), hence the prefixes.
  IF TG_TABLE_NAME LIKE 'chat_reactions%' THEN
    IF app_private.blocked_between(NEW.user_id, (SELECT m.author_id FROM public.chat_messages m WHERE m.channel_id = NEW.channel_id AND m.channel_seq = NEW.message_seq))
       OR app_private.chat_contact_cut(NEW.channel_id, NEW.user_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_blocked';
    END IF;
  ELSIF TG_TABLE_NAME = 'chat_mentions' THEN
    IF app_private.blocked_between(NEW.user_id, (SELECT m.author_id FROM public.chat_messages m WHERE m.channel_id = NEW.channel_id AND m.channel_seq = NEW.message_seq)) THEN
      RETURN NULL;
    END IF;
  ELSIF TG_TABLE_NAME LIKE 'chat_messages%' THEN
    IF NEW.kind = 'user' AND NEW.author_id IS NOT NULL AND NEW.deleted_at IS NULL
       AND (TG_OP = 'INSERT' OR NEW.body IS DISTINCT FROM OLD.body)
       AND app_private.chat_contact_cut(NEW.channel_id, NEW.author_id) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_blocked';
    END IF;
  ELSIF TG_TABLE_NAME = 'chat_pins' THEN
    IF app_private.chat_contact_cut(NEW.channel_id, NEW.pinned_by) THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_blocked'; END IF;
  ELSIF TG_TABLE_NAME = 'chat_channel_tabs' THEN
    IF app_private.chat_contact_cut(NEW.channel_id, NEW.created_by) THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_blocked'; END IF;
  ELSIF TG_TABLE_NAME = 'chat_canvases' THEN
    IF app_private.chat_contact_cut(NEW.channel_id, NEW.updated_by) THEN RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_blocked'; END IF;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER chat_reactions_block_guard BEFORE INSERT ON public.chat_reactions FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_chat();
--> statement-breakpoint
CREATE TRIGGER chat_mentions_block_guard BEFORE INSERT ON public.chat_mentions FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_chat();
--> statement-breakpoint
CREATE TRIGGER chat_messages_block_guard BEFORE INSERT OR UPDATE OF body ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_chat();
--> statement-breakpoint
CREATE TRIGGER chat_pins_block_guard BEFORE INSERT ON public.chat_pins FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_chat();
--> statement-breakpoint
CREATE TRIGGER chat_channel_tabs_block_guard BEFORE INSERT ON public.chat_channel_tabs FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_chat();
--> statement-breakpoint
CREATE TRIGGER chat_canvases_block_guard BEFORE INSERT OR UPDATE ON public.chat_canvases FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_chat();
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.refuse_across_block(), app_private.block_guard_social(), app_private.block_guard_chat() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- Making a block (B3, B19): everything between the two that the block ends goes in one transaction, and what it
-- removed is kept so Undo can put it back (B39). Returns false when the block already existed.
CREATE FUNCTION app_private.block_user(p_blocker uuid, p_blocked uuid, p_source text, p_case uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_restore jsonb := '{}'::jsonb;
  v_rows jsonb;
BEGIN
  IF p_blocker = p_blocked THEN RAISE EXCEPTION 'cannot block self'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('connection-pair:' || least(p_blocker, p_blocked)::text || ':' || greatest(p_blocker, p_blocked)::text, 0));
  IF EXISTS (SELECT 1 FROM public.user_blocks WHERE blocker_id = p_blocker AND blocked_id = p_blocked) THEN RETURN false; END IF;

  -- The connection and any request either way.
  WITH gone AS (
    DELETE FROM public.connections c
    WHERE (c.requester_id = p_blocker AND c.addressee_id = p_blocked) OR (c.requester_id = p_blocked AND c.addressee_id = p_blocker)
    RETURNING c.*
  ) SELECT coalesce(jsonb_agg(to_jsonb(gone)), '[]'::jsonb) INTO v_rows FROM gone;
  v_restore := v_restore || jsonb_build_object('connections', v_rows);
  UPDATE public.profiles SET connections_count = GREATEST(0, connections_count - 1), updated_at = now()
  WHERE id IN (p_blocker, p_blocked) AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_rows) r WHERE r->>'status' = 'accepted');

  -- Follows of each other's workspaces (B19, K17).
  WITH gone AS (
    DELETE FROM public.workspace_follows f USING public.workspaces w
    WHERE w.id = f.workspace_id AND ((f.user_id = p_blocker AND w.owner_id = p_blocked) OR (f.user_id = p_blocked AND w.owner_id = p_blocker))
    RETURNING f.*
  ) SELECT coalesce(jsonb_agg(to_jsonb(gone)), '[]'::jsonb) INTO v_rows FROM gone;
  v_restore := v_restore || jsonb_build_object('follows', v_rows);

  -- Pending applications to each other's personal workspaces (B3, B19).
  WITH gone AS (
    UPDATE public.role_applications a SET status = 'withdrawn', decision_at = now(), decision_reason_code = 'other', updated_at = now()
    WHERE a.status = 'pending'
      AND ((a.applicant_id = p_blocked AND app_private.personal_workspace_owner(a.workspace_id) = p_blocker)
        OR (a.applicant_id = p_blocker AND app_private.personal_workspace_owner(a.workspace_id) = p_blocked))
    RETURNING a.id
  ) SELECT coalesce(jsonb_agg(gone.id), '[]'::jsonb) INTO v_rows FROM gone;
  v_restore := v_restore || jsonb_build_object('applications', v_rows);

  -- Pending invitations between them (B3).
  WITH gone AS (
    UPDATE public.workspace_invitations i SET status = 'cancelled', resolved_at = now(), updated_at = now()
    WHERE i.status = 'pending'
      AND ((i.inviter_id = p_blocker AND i.candidate_id = p_blocked) OR (i.inviter_id = p_blocked AND i.candidate_id = p_blocker)
        OR (i.candidate_id = p_blocked AND app_private.personal_workspace_owner(i.workspace_id) = p_blocker))
    RETURNING i.id
  ) SELECT coalesce(jsonb_agg(gone.id), '[]'::jsonb) INTO v_rows FROM gone;
  v_restore := v_restore || jsonb_build_object('invitations', v_rows);

  -- Mentoring between them ends (B19, K20).
  WITH gone AS (
    UPDATE public.workspace_mentors m SET status = 'ended', ended_at = now(), ended_by = p_blocker, end_reason = 'unavailable', updated_at = now()
    FROM public.workspaces w
    WHERE w.id = m.workspace_id AND m.status = 'active'
      AND ((m.guide_user_id = p_blocked AND w.owner_id = p_blocker) OR (m.guide_user_id = p_blocker AND w.owner_id = p_blocked))
    RETURNING m.id
  ) SELECT coalesce(jsonb_agg(gone.id), '[]'::jsonb) INTO v_rows FROM gone;
  v_restore := v_restore || jsonb_build_object('mentors', v_rows);

  -- The blocker's scheduled messages to them are cancelled (B16).
  WITH gone AS (
    UPDATE public.chat_scheduled_messages s SET failed_reason = 'cancelled_by_block'
    WHERE s.user_id = p_blocker AND s.sent_at IS NULL AND s.failed_reason IS NULL
      AND EXISTS (SELECT 1 FROM public.chat_channels c JOIN public.chat_channel_members m ON m.channel_id = c.id
                  WHERE c.id = s.channel_id AND c.kind = 'dm' AND m.user_id = p_blocked)
    RETURNING s.id
  ) SELECT coalesce(jsonb_agg(gone.id), '[]'::jsonb) INTO v_rows FROM gone;
  v_restore := v_restore || jsonb_build_object('scheduled', v_rows);

  DELETE FROM public.connection_suggestions s
  WHERE (s.user_id = p_blocker AND s.suggested_user_id = p_blocked) OR (s.user_id = p_blocked AND s.suggested_user_id = p_blocker);

  INSERT INTO public.user_blocks (blocker_id, blocked_id, source, case_id, restore)
  VALUES (p_blocker, p_blocked, p_source, p_case, v_restore);
  RETURN true;
END
$$;
--> statement-breakpoint
-- Undo within the window puts back everything the block removed, then the block itself goes (B12, B39, D1).
CREATE FUNCTION app_private.undo_block(p_blocker uuid, p_blocked uuid, p_window_seconds integer) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_block public.user_blocks;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('connection-pair:' || least(p_blocker, p_blocked)::text || ':' || greatest(p_blocker, p_blocked)::text, 0));
  SELECT * INTO v_block FROM public.user_blocks
  WHERE blocker_id = p_blocker AND blocked_id = p_blocked AND created_at > now() - make_interval(secs => p_window_seconds) FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  DELETE FROM public.user_blocks WHERE blocker_id = p_blocker AND blocked_id = p_blocked;
  -- Only when no block remains the other way: a mutual block keeps everything cut.
  IF v_block.restore IS NOT NULL AND NOT app_private.blocked_between(p_blocker, p_blocked) THEN
    INSERT INTO public.connections SELECT * FROM jsonb_populate_recordset(NULL::public.connections, v_block.restore->'connections') ON CONFLICT DO NOTHING;
    UPDATE public.profiles SET connections_count = connections_count + 1, updated_at = now()
    WHERE id IN (p_blocker, p_blocked) AND EXISTS (SELECT 1 FROM jsonb_array_elements(v_block.restore->'connections') r WHERE r->>'status' = 'accepted');
    INSERT INTO public.workspace_follows SELECT * FROM jsonb_populate_recordset(NULL::public.workspace_follows, v_block.restore->'follows') ON CONFLICT DO NOTHING;
    UPDATE public.role_applications SET status = 'pending', decision_at = NULL, decision_reason_code = NULL, updated_at = now()
    WHERE id IN (SELECT (jsonb_array_elements_text(v_block.restore->'applications'))::uuid) AND status = 'withdrawn';
    UPDATE public.workspace_invitations SET status = 'pending', resolved_at = NULL, updated_at = now()
    WHERE id IN (SELECT (jsonb_array_elements_text(v_block.restore->'invitations'))::uuid) AND status = 'cancelled';
    UPDATE public.workspace_mentors SET status = 'active', ended_at = NULL, ended_by = NULL, end_reason = NULL, updated_at = now()
    WHERE id IN (SELECT (jsonb_array_elements_text(v_block.restore->'mentors'))::uuid) AND status = 'ended';
    UPDATE public.chat_scheduled_messages SET failed_reason = NULL
    WHERE id IN (SELECT (jsonb_array_elements_text(v_block.restore->'scheduled'))::uuid) AND failed_reason = 'cancelled_by_block';
  END IF;
  RETURN true;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.block_user(uuid, uuid, text, uuid), app_private.undo_block(uuid, uuid, integer) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.blocked_between(uuid, uuid), app_private.chat_contact_cut(uuid, uuid), app_private.block_user(uuid, uuid, text, uuid),
  app_private.undo_block(uuid, uuid, integer) TO nb_app;
