-- DB-002: editing requires current membership in a live channel.
-- DB-003: one capacity mechanism for joins, adds, groups and new channels,
--         serialized per user (and per project for channel creation). DMs and
--         default project-channel sync are deliberate exemptions.
-- DB-004: a partial read keeps the count of mentions it did not reach.
CREATE OR REPLACE FUNCTION app_private.chat_assert_user_capacity(p_users uuid[])
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  -- Fixed lock order across users prevents deadlocks between concurrent joins.
  PERFORM pg_advisory_xact_lock(hashtextextended('chat-user-capacity:' || u::text, 0))
  FROM (SELECT DISTINCT u FROM unnest(p_users) AS u WHERE u IS NOT NULL ORDER BY u) AS ordered;
  IF EXISTS (
    SELECT 1 FROM public.chat_channel_members m
    WHERE m.user_id = ANY (p_users)
    GROUP BY m.user_id HAVING count(*) >= 500
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_user_channel_limit';
  END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_assert_user_capacity(uuid[]) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- Callers hold the channel row lock (FOR UPDATE) when they call this.
CREATE OR REPLACE FUNCTION app_private.chat_assert_capacity(p_channel_id uuid, p_users uuid[])
RETURNS void LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (SELECT member_count FROM public.chat_channels WHERE id = p_channel_id) + cardinality(p_users) > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_member_limit';
  END IF;
  PERFORM app_private.chat_assert_user_capacity(p_users);
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_create_group(p_creator uuid, p_members uuid[])
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_others uuid[];
  v_id uuid;
BEGIN
  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_others
  FROM unnest(coalesce(p_members, '{}')) AS u WHERE u IS NOT NULL AND u <> p_creator;
  IF cardinality(v_others) < 1 OR cardinality(v_others) > 8 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_group_size';
  END IF;
  IF EXISTS (SELECT 1 FROM unnest(v_others) AS u WHERE NOT app_private.chat_can_dm(p_creator, u)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_dm_not_allowed';
  END IF;
  PERFORM app_private.chat_assert_user_capacity(array_append(v_others, p_creator));

  INSERT INTO public.chat_channels (kind, created_by, member_count)
  VALUES ('private', p_creator, cardinality(v_others) + 1)
  RETURNING id INTO v_id;
  INSERT INTO public.chat_channel_members (channel_id, user_id, role)
  SELECT v_id, p_creator, 'owner'
  UNION ALL
  SELECT v_id, u, 'member' FROM unnest(v_others) AS u;
  RETURN v_id;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_create_channel(p_project_id uuid, p_creator uuid, p_name text, p_description text, p_private boolean)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT app_private.chat_is_project_member(p_project_id, p_creator) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_project_member';
  END IF;
  IF p_name IS NULL OR p_name !~ '^[a-z0-9-]{1,80}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_channel_name';
  END IF;
  -- Serialize channel creation per project so the 200-channel limit holds under concurrency.
  PERFORM pg_advisory_xact_lock(hashtextextended('chat-project-channels:' || p_project_id::text, 0));
  IF (
    SELECT count(*) FROM public.chat_channels
    WHERE project_id = p_project_id AND application_id IS NULL AND archived_at IS NULL
  ) >= 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_project_channel_limit';
  END IF;
  PERFORM app_private.chat_assert_user_capacity(ARRAY[p_creator]);

  INSERT INTO public.chat_channels (kind, name, description, project_id, created_by, member_count)
  VALUES (CASE WHEN p_private THEN 'private' ELSE 'public' END, p_name, nullif(btrim(coalesce(p_description, '')), ''),
          p_project_id, p_creator, 1)
  RETURNING id INTO v_id;
  INSERT INTO public.chat_channel_members (channel_id, user_id, role) VALUES (v_id, p_creator, 'owner');
  PERFORM app_private.chat_post_system(v_id, p_creator, 'created #' || p_name);
  RETURN v_id;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_edit_message(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_body text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF p_body IS NULL OR char_length(p_body) > 4000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_body';
  END IF;
  IF btrim(p_body) = ''
    AND NOT EXISTS (SELECT 1 FROM public.chat_attachments a WHERE a.channel_id = p_channel_id AND a.message_seq = p_seq)
    AND NOT EXISTS (SELECT 1 FROM public.chat_message_cards k WHERE k.channel_id = p_channel_id AND k.message_seq = p_seq) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_body';
  END IF;
  -- Only a current member may edit their own message, and not in an archived channel.
  UPDATE public.chat_messages SET body = p_body, edited_at = now()
  WHERE channel_id = p_channel_id AND channel_seq = p_seq AND author_id = p_user_id
    AND kind = 'user' AND deleted_at IS NULL
    AND app_private.chat_is_member(p_channel_id, p_user_id)
    AND EXISTS (SELECT 1 FROM public.chat_channels c WHERE c.id = p_channel_id AND c.archived_at IS NULL);
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_editable';
  END IF;
  UPDATE public.chat_channels
  SET last_preview = CASE WHEN btrim(p_body) = '' THEN 'Attachment' ELSE left(regexp_replace(btrim(p_body), '\s+', ' ', 'g'), 120) END
  WHERE id = p_channel_id AND last_top_seq = p_seq;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_mark_read(p_channel_id uuid, p_user_id uuid, p_seq bigint)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_moved boolean;
BEGIN
  UPDATE public.chat_channel_members m
  SET last_read_seq = p_seq
  FROM public.chat_channels c
  WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id
    AND c.id = m.channel_id AND p_seq <= c.last_seq AND m.last_read_seq < p_seq;
  v_moved := FOUND;
  IF v_moved THEN
    UPDATE public.chat_mentions mn SET read_at = now()
    FROM public.chat_messages msg
    WHERE mn.user_id = p_user_id AND mn.channel_id = p_channel_id AND mn.message_seq <= p_seq AND mn.read_at IS NULL
      AND msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq AND msg.thread_root_seq IS NULL;
    -- Same definition as chat_mark_unread: unread mentions the read did not reach.
    UPDATE public.chat_channel_members m
    SET mention_count = (
      SELECT count(*)::int FROM public.chat_mentions mn
      WHERE mn.user_id = p_user_id AND mn.channel_id = p_channel_id
        AND mn.message_seq > p_seq AND mn.kind <> 'thread_reply' AND mn.read_at IS NULL
    )
    WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id;
  END IF;
  RETURN v_moved;
END
$$;
