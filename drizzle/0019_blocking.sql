-- user_blocks, user_mutes, the blocked_between rule and its guards.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE FUNCTION app_private.block_guard_chat() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
CREATE FUNCTION app_private.block_guard_owner() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF NEW.parent_id IS NULL AND app_private.blocked_between(OLD.owner_id, NEW.owner_id) THEN
    PERFORM app_private.refuse_across_block();
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.block_guard_social() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
CREATE FUNCTION app_private.block_heads_up() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
--> statement-breakpoint
CREATE FUNCTION app_private.block_keep_read() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
CREATE FUNCTION app_private.block_user(p_blocker uuid, p_blocked uuid, p_source text, p_case uuid) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
CREATE FUNCTION app_private.blocked_between(p_a uuid, p_b uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p_a IS NOT NULL AND p_b IS NOT NULL AND p_a <> p_b AND EXISTS (
    SELECT 1 FROM public.user_blocks b
    WHERE (b.blocker_id = p_a AND b.blocked_id = p_b) OR (b.blocker_id = p_b AND b.blocked_id = p_a)
  )
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.personal_workspace_owner(p_workspace uuid) RETURNS uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT w.owner_id FROM public.workspaces w WHERE w.id = p_workspace AND w.kind <> 'organization' AND w.parent_id IS NULL
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.refuse_across_block() RETURNS void
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'not_available';
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.review_hidden_by_block(p_reviewer uuid, p_applicant uuid, p_workspace uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT app_private.blocked_between(p_reviewer, p_applicant) AND EXISTS (
    SELECT 1 FROM (
      SELECT w.owner_id AS id FROM public.workspaces w WHERE w.id = p_workspace
      UNION SELECT m.user_id FROM public.workspace_members m WHERE m.workspace_id = p_workspace AND m.role IN ('owner', 'admin')
    ) other
    WHERE other.id NOT IN (p_reviewer, p_applicant) AND NOT app_private.blocked_between(other.id, p_applicant)
  )
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.undo_block(p_blocker uuid, p_blocked uuid, p_window_seconds integer) RETURNS boolean
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
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
CREATE TABLE public.user_blocks (
    blocker_id uuid NOT NULL,
    blocked_id uuid NOT NULL,
    source text DEFAULT 'profile'::text NOT NULL,
    case_id uuid,
    note text,
    restore jsonb,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_blocks_not_self CHECK ((blocker_id <> blocked_id)),
    CONSTRAINT user_blocks_note_check CHECK (((note IS NULL) OR (char_length(note) <= 500))),
    CONSTRAINT user_blocks_source_check CHECK ((source = ANY (ARRAY['profile'::text, 'message'::text, 'comment'::text, 'person_card'::text, 'member_list'::text, 'report'::text, 'settings'::text, 'legacy'::text])))
);
--> statement-breakpoint
CREATE TABLE public.user_mutes (
    muter_id uuid NOT NULL,
    muted_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT user_mutes_not_self CHECK ((muter_id <> muted_id))
);
--> statement-breakpoint
ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_pkey PRIMARY KEY (blocker_id, blocked_id);
--> statement-breakpoint
ALTER TABLE ONLY public.user_mutes
    ADD CONSTRAINT user_mutes_pkey PRIMARY KEY (muter_id, muted_id);
--> statement-breakpoint
CREATE INDEX user_blocks_blocked_idx ON public.user_blocks USING btree (blocked_id, blocker_id);
--> statement-breakpoint
CREATE INDEX user_blocks_case_idx ON public.user_blocks USING btree (case_id) WHERE (case_id IS NOT NULL);
--> statement-breakpoint
CREATE TRIGGER chat_canvases_block_guard BEFORE INSERT OR UPDATE ON public.chat_canvases FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_chat();
--> statement-breakpoint
CREATE TRIGGER chat_channel_tabs_block_guard BEFORE INSERT ON public.chat_channel_tabs FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_chat();
--> statement-breakpoint
CREATE TRIGGER chat_mentions_block_guard BEFORE INSERT ON public.chat_mentions FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_chat();
--> statement-breakpoint
CREATE TRIGGER chat_messages_block_guard BEFORE INSERT OR UPDATE OF body ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_chat();
--> statement-breakpoint
CREATE TRIGGER chat_messages_block_keep_read AFTER INSERT ON public.chat_messages FOR EACH ROW EXECUTE FUNCTION app_private.block_keep_read();
--> statement-breakpoint
CREATE TRIGGER chat_pins_block_guard BEFORE INSERT ON public.chat_pins FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_chat();
--> statement-breakpoint
CREATE TRIGGER chat_reactions_block_guard BEFORE INSERT ON public.chat_reactions FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_chat();
--> statement-breakpoint
CREATE TRIGGER comment_mentions_block_guard BEFORE INSERT ON public.comment_mentions FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER connections_block_guard BEFORE INSERT ON public.connections FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER role_applications_block_guard BEFORE INSERT ON public.role_applications FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER task_comment_likes_block_guard BEFORE INSERT ON public.task_comment_likes FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER task_comments_block_guard BEFORE INSERT ON public.task_comments FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER workspace_follows_block_guard BEFORE INSERT ON public.workspace_follows FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER workspace_invitations_block_guard BEFORE INSERT ON public.workspace_invitations FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER workspace_members_block_guard BEFORE INSERT ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER workspace_members_block_heads_up AFTER INSERT ON public.workspace_members FOR EACH ROW EXECUTE FUNCTION app_private.block_heads_up();
--> statement-breakpoint
CREATE TRIGGER workspace_update_comments_block_guard BEFORE INSERT ON public.workspace_update_comments FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER workspace_update_likes_block_guard BEFORE INSERT ON public.workspace_update_likes FOR EACH ROW EXECUTE FUNCTION app_private.block_guard_social();
--> statement-breakpoint
CREATE TRIGGER workspaces_block_guard_owner BEFORE UPDATE OF owner_id ON public.workspaces FOR EACH ROW WHEN ((old.owner_id IS DISTINCT FROM new.owner_id)) EXECUTE FUNCTION app_private.block_guard_owner();
--> statement-breakpoint
ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocked_id_fkey FOREIGN KEY (blocked_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_blocker_id_fkey FOREIGN KEY (blocker_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.user_blocks
    ADD CONSTRAINT user_blocks_case_id_fkey FOREIGN KEY (case_id) REFERENCES public.moderation_cases(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.user_mutes
    ADD CONSTRAINT user_mutes_muted_id_fkey FOREIGN KEY (muted_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.user_mutes
    ADD CONSTRAINT user_mutes_muter_id_fkey FOREIGN KEY (muter_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.user_blocks TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.user_mutes TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE public.user_blocks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.user_mutes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.block_guard_chat() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.block_guard_chat() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.block_guard_owner() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.block_guard_owner() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.block_guard_social() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.block_guard_social() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.block_heads_up() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.block_heads_up() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.block_keep_read() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.block_keep_read() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.block_user(p_blocker uuid, p_blocked uuid, p_source text, p_case uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.block_user(p_blocker uuid, p_blocked uuid, p_source text, p_case uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.blocked_between(p_a uuid, p_b uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.blocked_between(p_a uuid, p_b uuid) TO nb_app;
GRANT ALL ON FUNCTION app_private.blocked_between(p_a uuid, p_b uuid) TO authenticated;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.personal_workspace_owner(p_workspace uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.personal_workspace_owner(p_workspace uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.refuse_across_block() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.refuse_across_block() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.review_hidden_by_block(p_reviewer uuid, p_applicant uuid, p_workspace uuid) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.review_hidden_by_block(p_reviewer uuid, p_applicant uuid, p_workspace uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.undo_block(p_blocker uuid, p_blocked uuid, p_window_seconds integer) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.undo_block(p_blocker uuid, p_blocked uuid, p_window_seconds integer) TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.user_blocks TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_blocks TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.user_mutes TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.user_mutes TO nb_app;
