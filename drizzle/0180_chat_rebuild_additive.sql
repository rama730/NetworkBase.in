-- Chat rebuild, step 1 of 2 (additive). Report: docs/plans/messaging-slack-rebuild-report.md
-- Creates the Slack-style chat system next to the old messaging tables. Nothing
-- old is dropped here; 0181 removes the old system at cutover.
--
-- Shape for 1M users (report section 8):
-- * every table leads with channel_id; messages are keyed (channel_id, channel_seq)
-- * chat_messages, chat_attachments, chat_reactions are hash-partitioned 32 ways
-- * one SQL function per send (one round trip); no trigger on the send path
-- * all definers live in app_private with search_path = '' and are callable by
--   service_role only (chat_is_member is also used by RLS and Realtime policies)

CREATE SCHEMA IF NOT EXISTS app_private;
--> statement-breakpoint

-- ── Tables ──────────────────────────────────────────────────────────────────

-- ponytail: last_seq is bumped under a row lock per send (L-17). ceiling: ~300
-- sends/s in one channel. upgrade: batched seq allocation when any channel
-- sustains > 100 sends/s. fillfactor 70 keeps the per-message update HOT;
-- none of the hot columns (last_*, member_count) may ever be indexed.
CREATE TABLE IF NOT EXISTS public.chat_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  name text,
  topic text,
  description text,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  application_id uuid REFERENCES public.role_applications(id) ON DELETE CASCADE,
  is_default boolean NOT NULL DEFAULT false,
  dm_key text,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  last_seq bigint NOT NULL DEFAULT 0,
  last_top_seq bigint NOT NULL DEFAULT 0,
  last_message_at timestamptz,
  -- ponytail: preview of the last top-level user message only (L-21). ceiling:
  -- deleting it shows "Message deleted" until the next message. upgrade:
  -- recompute from the previous message in chat_delete_message.
  last_preview text,
  last_author_id uuid,
  member_count integer NOT NULL DEFAULT 0,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_channels_kind_check CHECK (kind IN ('public', 'private', 'dm')),
  CONSTRAINT chat_channels_name_check CHECK (name IS NULL OR name ~ '^[a-z0-9-]{1,80}$'),
  CONSTRAINT chat_channels_public_shape_check CHECK (kind <> 'public' OR (name IS NOT NULL AND project_id IS NOT NULL)),
  CONSTRAINT chat_channels_dm_shape_check CHECK ((kind = 'dm') = (dm_key IS NOT NULL)),
  CONSTRAINT chat_channels_dm_scope_check CHECK (kind <> 'dm' OR (project_id IS NULL AND name IS NULL AND application_id IS NULL)),
  CONSTRAINT chat_channels_default_check CHECK (NOT is_default OR kind = 'public'),
  CONSTRAINT chat_channels_text_check CHECK (
    (topic IS NULL OR char_length(topic) <= 250)
    AND (description IS NULL OR char_length(description) <= 250)
    AND (last_preview IS NULL OR char_length(last_preview) <= 120)
  ),
  CONSTRAINT chat_channels_counter_check CHECK (last_seq >= 0 AND last_top_seq <= last_seq AND member_count >= 0)
) WITH (fillfactor = 70);

CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_dm_key_uniq ON public.chat_channels (dm_key) WHERE dm_key IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_project_name_uniq ON public.chat_channels (project_id, lower(name)) WHERE name IS NOT NULL AND project_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_default_uniq ON public.chat_channels (project_id) WHERE is_default;
CREATE UNIQUE INDEX IF NOT EXISTS chat_channels_application_uniq ON public.chat_channels (application_id) WHERE application_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_channels_project_browse_idx ON public.chat_channels (project_id, kind) WHERE archived_at IS NULL AND project_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.chat_channel_members (
  channel_id uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member',
  last_read_seq bigint NOT NULL DEFAULT 0,
  mention_count integer NOT NULL DEFAULT 0,
  notify text NOT NULL DEFAULT 'all',
  starred boolean NOT NULL DEFAULT false,
  archived_at timestamptz,
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, user_id),
  CONSTRAINT chat_channel_members_role_check CHECK (role IN ('owner', 'admin', 'member')),
  CONSTRAINT chat_channel_members_notify_check CHECK (notify IN ('all', 'mentions', 'mute')),
  CONSTRAINT chat_channel_members_counter_check CHECK (last_read_seq >= 0 AND mention_count >= 0)
) WITH (fillfactor = 80);
-- No INCLUDE columns: they would break HOT updates of last_read_seq.
CREATE INDEX IF NOT EXISTS chat_channel_members_user_idx ON public.chat_channel_members (user_id, channel_id);

-- ponytail: 32 hash partitions, fixed at creation (L-18). ceiling: ~22 GB per
-- partition at 1M users. upgrade: rebuild with 128 when a partition passes 150 GB.
CREATE TABLE IF NOT EXISTS public.chat_messages (
  channel_id uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  channel_seq bigint NOT NULL,
  author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  kind text NOT NULL DEFAULT 'user',
  body text NOT NULL DEFAULT '',
  thread_root_seq bigint,
  reply_count integer NOT NULL DEFAULT 0,
  last_reply_seq bigint,
  last_reply_at timestamptz,
  client_message_id text,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, channel_seq),
  CONSTRAINT chat_messages_kind_check CHECK (kind IN ('user', 'system')),
  CONSTRAINT chat_messages_body_check CHECK (char_length(body) <= 4000),
  CONSTRAINT chat_messages_client_id_check CHECK (client_message_id IS NULL OR char_length(client_message_id) BETWEEN 1 AND 160),
  CONSTRAINT chat_messages_thread_check CHECK (thread_root_seq IS NULL OR thread_root_seq < channel_seq)
) PARTITION BY HASH (channel_id);

CREATE UNIQUE INDEX IF NOT EXISTS chat_messages_client_uniq ON public.chat_messages (channel_id, author_id, client_message_id) WHERE client_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS chat_messages_thread_idx ON public.chat_messages (channel_id, thread_root_seq, channel_seq) WHERE thread_root_seq IS NOT NULL;
-- ponytail: author index for export and account deletion jobs (L-19). ceiling:
-- one extra index write per send. upgrade: drop it if the send p95 gate fails.
CREATE INDEX IF NOT EXISTS chat_messages_author_idx ON public.chat_messages (author_id, channel_id, channel_seq);

CREATE TABLE IF NOT EXISTS public.chat_message_cards (
  channel_id uuid NOT NULL,
  message_seq bigint NOT NULL,
  kind text NOT NULL,
  ref_id uuid NOT NULL,
  snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (channel_id, message_seq),
  FOREIGN KEY (channel_id, message_seq) REFERENCES public.chat_messages (channel_id, channel_seq) ON DELETE CASCADE,
  CONSTRAINT chat_message_cards_kind_check CHECK (kind IN ('application', 'task', 'invite')),
  CONSTRAINT chat_message_cards_snapshot_check CHECK (jsonb_typeof(snapshot) = 'object')
);
CREATE INDEX IF NOT EXISTS chat_message_cards_ref_idx ON public.chat_message_cards (kind, ref_id);

CREATE TABLE IF NOT EXISTS public.chat_attachments (
  channel_id uuid NOT NULL,
  message_seq bigint NOT NULL,
  idx smallint NOT NULL,
  asset_id uuid NOT NULL REFERENCES public.storage_assets(id),
  name text NOT NULL DEFAULT '',
  mime text NOT NULL,
  size bigint NOT NULL,
  width integer,
  height integer,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, message_seq, idx),
  FOREIGN KEY (channel_id, message_seq) REFERENCES public.chat_messages (channel_id, channel_seq) ON DELETE CASCADE,
  CONSTRAINT chat_attachments_shape_check CHECK (idx BETWEEN 0 AND 9 AND size >= 0 AND char_length(name) <= 255)
) PARTITION BY HASH (channel_id);
CREATE INDEX IF NOT EXISTS chat_attachments_asset_idx ON public.chat_attachments (asset_id);

CREATE TABLE IF NOT EXISTS public.chat_reactions (
  channel_id uuid NOT NULL,
  message_seq bigint NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  emoji text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, message_seq, user_id, emoji),
  FOREIGN KEY (channel_id, message_seq) REFERENCES public.chat_messages (channel_id, channel_seq) ON DELETE CASCADE,
  CONSTRAINT chat_reactions_emoji_check CHECK (char_length(emoji) BETWEEN 1 AND 64)
) PARTITION BY HASH (channel_id);

CREATE TABLE IF NOT EXISTS public.chat_mentions (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL,
  message_seq bigint NOT NULL,
  kind text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id, message_seq),
  FOREIGN KEY (channel_id, message_seq) REFERENCES public.chat_messages (channel_id, channel_seq) ON DELETE CASCADE,
  CONSTRAINT chat_mentions_kind_check CHECK (kind IN ('user', 'channel', 'here', 'thread_reply'))
);
CREATE INDEX IF NOT EXISTS chat_mentions_feed_idx ON public.chat_mentions (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.chat_thread_follows (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL,
  root_seq bigint NOT NULL,
  last_read_seq bigint NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id, root_seq),
  FOREIGN KEY (channel_id, root_seq) REFERENCES public.chat_messages (channel_id, channel_seq) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS chat_thread_follows_root_idx ON public.chat_thread_follows (channel_id, root_seq);

CREATE TABLE IF NOT EXISTS public.chat_pins (
  channel_id uuid NOT NULL,
  message_seq bigint NOT NULL,
  pinned_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  pinned_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (channel_id, message_seq),
  FOREIGN KEY (channel_id, message_seq) REFERENCES public.chat_messages (channel_id, channel_seq) ON DELETE CASCADE
);

-- ponytail: reports only, no moderation UI (L-15). ceiling: reports pile up.
-- upgrade: review UI when > 50 open reports or a policy requires it.
CREATE TABLE IF NOT EXISTS public.chat_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL,
  message_seq bigint NOT NULL,
  reporter_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (channel_id, message_seq) REFERENCES public.chat_messages (channel_id, channel_seq) ON DELETE CASCADE,
  CONSTRAINT chat_reports_reason_check CHECK (char_length(btrim(reason)) BETWEEN 1 AND 1000),
  CONSTRAINT chat_reports_status_check CHECK (status IN ('open', 'reviewed', 'dismissed'))
);
CREATE UNIQUE INDEX IF NOT EXISTS chat_reports_once_uniq ON public.chat_reports (channel_id, message_seq, reporter_id);
CREATE INDEX IF NOT EXISTS chat_reports_queue_idx ON public.chat_reports (status, created_at);
--> statement-breakpoint

-- Partitions: RLS on and every grant revoked, so a partition can only be read
-- through its parent (where the member policy applies).
DO $chat_partitions$
DECLARE
  base text;
  part text;
  i integer;
BEGIN
  FOREACH base IN ARRAY ARRAY['chat_messages', 'chat_attachments', 'chat_reactions'] LOOP
    FOR i IN 0..31 LOOP
      part := format('%s_p%s', base, lpad(i::text, 2, '0'));
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS public.%I PARTITION OF public.%I FOR VALUES WITH (MODULUS 32, REMAINDER %s)',
        part, base, i
      );
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', part);
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', part);
      END IF;
    END LOOP;
  END LOOP;
END
$chat_partitions$;
--> statement-breakpoint

-- ── Helpers ─────────────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_private.chat_is_member(p_channel_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.chat_channel_members m
    WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id
  )
$$;

CREATE OR REPLACE FUNCTION app_private.chat_is_project_member(p_project_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.project_members pm
    WHERE pm.project_id = p_project_id AND pm.user_id = p_user_id
  )
$$;

CREATE OR REPLACE FUNCTION app_private.chat_is_blocked(p_a uuid, p_b uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.connections c
    WHERE c.status = 'blocked'
      AND ((c.requester_id = p_a AND c.addressee_id = p_b) OR (c.requester_id = p_b AND c.addressee_id = p_a))
  )
$$;

-- Who may open a DM: the recipient's message_privacy plus blocks either way.
CREATE OR REPLACE FUNCTION app_private.chat_can_dm(p_from uuid, p_to uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT CASE
    WHEN p_from IS NULL OR p_to IS NULL THEN false
    WHEN p_from = p_to THEN true
    WHEN app_private.chat_is_blocked(p_from, p_to) THEN false
    WHEN NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_to AND deleted_at IS NULL) THEN false
    WHEN (SELECT coalesce(message_privacy, 'connections') FROM public.profiles WHERE id = p_to) = 'everyone' THEN true
    ELSE EXISTS (
      SELECT 1 FROM public.connections c
      WHERE c.status = 'accepted'
        AND ((c.requester_id = p_from AND c.addressee_id = p_to) OR (c.requester_id = p_to AND c.addressee_id = p_from))
    )
  END
$$;

-- Channel admin: owner/admin of the channel, or owner/admin of its project.
CREATE OR REPLACE FUNCTION app_private.chat_is_channel_admin(p_channel_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.chat_channel_members m
    WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id AND m.role IN ('owner', 'admin')
  ) OR EXISTS (
    SELECT 1 FROM public.chat_channels c
    JOIN public.project_members pm ON pm.project_id = c.project_id
    WHERE c.id = p_channel_id AND pm.user_id = p_user_id AND pm.role IN ('owner', 'admin')
  )
$$;
--> statement-breakpoint

-- ── Append (internal, no permission checks) ─────────────────────────────────
-- Locks the channel row, allocates a gap-free channel_seq, inserts the message
-- with its attachments, card and thread bookkeeping. Callers check permissions.
CREATE OR REPLACE FUNCTION app_private.chat_append_message(
  p_channel_id uuid,
  p_author_id uuid,
  p_kind text,
  p_body text,
  p_client_id text,
  p_thread_root bigint,
  p_attachments jsonb,
  p_card jsonb
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_seq bigint;
  v_existing bigint;
  v_now timestamptz := now();
  v_top boolean := p_thread_root IS NULL AND p_kind = 'user';
  v_preview text;
  v_root record;
BEGIN
  PERFORM 1 FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;

  IF p_client_id IS NOT NULL THEN
    SELECT channel_seq INTO v_existing FROM public.chat_messages
    WHERE channel_id = p_channel_id AND author_id = p_author_id AND client_message_id = p_client_id;
    IF FOUND THEN
      RETURN jsonb_build_object('channel_seq', v_existing, 'deduped', true);
    END IF;
  END IF;

  IF p_thread_root IS NOT NULL THEN
    SELECT thread_root_seq, deleted_at, author_id INTO v_root FROM public.chat_messages
    WHERE channel_id = p_channel_id AND channel_seq = p_thread_root;
    IF NOT FOUND OR v_root.thread_root_seq IS NOT NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_thread_root';
    END IF;
  END IF;

  v_preview := CASE
    WHEN btrim(coalesce(p_body, '')) <> '' THEN left(regexp_replace(btrim(p_body), '\s+', ' ', 'g'), 120)
    WHEN p_card IS NOT NULL THEN CASE p_card->>'kind' WHEN 'application' THEN 'Application' WHEN 'task' THEN 'Task' ELSE 'Invitation' END
    WHEN jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0 THEN 'Attachment'
    ELSE ''
  END;

  UPDATE public.chat_channels SET
    last_seq = last_seq + 1,
    last_top_seq = CASE WHEN v_top THEN last_seq + 1 ELSE last_top_seq END,
    last_message_at = CASE WHEN v_top THEN v_now ELSE last_message_at END,
    last_preview = CASE WHEN v_top THEN v_preview ELSE last_preview END,
    last_author_id = CASE WHEN v_top THEN p_author_id ELSE last_author_id END
  WHERE id = p_channel_id
  RETURNING last_seq INTO v_seq;

  INSERT INTO public.chat_messages (channel_id, channel_seq, author_id, kind, body, thread_root_seq, client_message_id, created_at)
  VALUES (p_channel_id, v_seq, p_author_id, p_kind, coalesce(p_body, ''), p_thread_root, p_client_id, v_now);

  IF jsonb_array_length(coalesce(p_attachments, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.chat_attachments (channel_id, message_seq, idx, asset_id, name, mime, size, width, height)
    SELECT p_channel_id, v_seq, (t.ord - 1)::smallint, (t.a->>'asset_id')::uuid, coalesce(t.a->>'name', ''),
           t.a->>'mime', (t.a->>'size')::bigint, (t.a->>'width')::integer, (t.a->>'height')::integer
    FROM jsonb_array_elements(p_attachments) WITH ORDINALITY AS t(a, ord);
  END IF;

  IF p_card IS NOT NULL THEN
    INSERT INTO public.chat_message_cards (channel_id, message_seq, kind, ref_id, snapshot)
    VALUES (p_channel_id, v_seq, p_card->>'kind', (p_card->>'ref_id')::uuid, coalesce(p_card->'snapshot', '{}'::jsonb));
  END IF;

  IF p_thread_root IS NOT NULL THEN
    UPDATE public.chat_messages
    SET reply_count = reply_count + 1, last_reply_seq = v_seq, last_reply_at = v_now
    WHERE channel_id = p_channel_id AND channel_seq = p_thread_root;

    INSERT INTO public.chat_thread_follows (user_id, channel_id, root_seq, last_read_seq)
    SELECT u, p_channel_id, p_thread_root, CASE WHEN u = p_author_id THEN v_seq ELSE 0 END
    FROM unnest(ARRAY[p_author_id, v_root.author_id]) AS u
    WHERE u IS NOT NULL
    ON CONFLICT (user_id, channel_id, root_seq) DO UPDATE
      SET last_read_seq = greatest(public.chat_thread_follows.last_read_seq, EXCLUDED.last_read_seq);

    INSERT INTO public.chat_mentions (user_id, channel_id, message_seq, kind)
    SELECT f.user_id, p_channel_id, v_seq, 'thread_reply'
    FROM public.chat_thread_follows f
    WHERE f.channel_id = p_channel_id AND f.root_seq = p_thread_root AND f.user_id IS DISTINCT FROM p_author_id
    ON CONFLICT DO NOTHING;
  ELSIF p_author_id IS NOT NULL THEN
    UPDATE public.chat_channel_members
    SET last_read_seq = greatest(last_read_seq, v_seq)
    WHERE channel_id = p_channel_id AND user_id = p_author_id;
  END IF;

  RETURN jsonb_build_object('channel_seq', v_seq, 'created_at', v_now, 'deduped', false);
END
$$;

CREATE OR REPLACE FUNCTION app_private.chat_post_system(p_channel_id uuid, p_actor_id uuid, p_body text)
RETURNS void
LANGUAGE sql SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT app_private.chat_append_message(p_channel_id, p_actor_id, 'system', p_body, NULL, NULL, '[]'::jsonb, NULL);
$$;
--> statement-breakpoint

-- ── Send ────────────────────────────────────────────────────────────────────
-- ponytail: @channel/@here only in channels of 100 members or fewer (L-13).
-- ceiling: 100 inline mention updates. upgrade: async batches for bigger channels.
CREATE OR REPLACE FUNCTION app_private.chat_send_message(
  p_channel_id uuid,
  p_author_id uuid,
  p_body text,
  p_client_id text DEFAULT NULL,
  p_thread_root bigint DEFAULT NULL,
  p_mentions uuid[] DEFAULT '{}',
  p_broadcast text DEFAULT NULL,
  p_attachments jsonb DEFAULT '[]'::jsonb,
  p_card jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_channel record;
  v_other uuid;
  v_result jsonb;
  v_seq bigint;
  v_direct boolean;
  v_mentioned uuid[] := '{}';
  v_notify uuid[] := '{}';
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

  SELECT id, kind, name, project_id, archived_at, member_count INTO v_channel FROM public.chat_channels WHERE id = p_channel_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;
  IF NOT app_private.chat_is_member(p_channel_id, p_author_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  IF v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_channel_archived';
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
      AND (p_broadcast IS NOT NULL OR m.user_id = ANY (p_mentions));
    INSERT INTO public.chat_mentions (user_id, channel_id, message_seq, kind)
    SELECT u, p_channel_id, v_seq, coalesce(p_broadcast, 'user') FROM unnest(v_mentioned) AS u
    ON CONFLICT DO NOTHING;
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

  -- Who gets a live hint and a push: DM and group-chat members (notify = all),
  -- mentioned members and thread followers; never muted members. Skipped for
  -- ordinary channel messages so big channels pay nothing extra.
  v_direct := v_channel.kind = 'dm' OR (v_channel.kind = 'private' AND v_channel.project_id IS NULL);
  IF v_direct OR cardinality(v_mentioned) > 0 OR p_thread_root IS NOT NULL THEN
    SELECT coalesce(array_agg(m.user_id), '{}') INTO v_notify
    FROM public.chat_channel_members m
    WHERE m.channel_id = p_channel_id AND m.user_id <> p_author_id AND m.notify <> 'mute'
      AND (
        m.user_id = ANY (v_mentioned)
        OR (v_direct AND m.notify = 'all')
        OR (p_thread_root IS NOT NULL AND EXISTS (
          SELECT 1 FROM public.chat_thread_follows f
          WHERE f.user_id = m.user_id AND f.channel_id = p_channel_id AND f.root_seq = p_thread_root
        ))
      );
  END IF;

  RETURN v_result || jsonb_build_object('notify', to_jsonb(v_notify), 'channel_kind', v_channel.kind);
END
$$;
--> statement-breakpoint

-- ── Conversations: DMs, group chats, channels ───────────────────────────────

CREATE OR REPLACE FUNCTION app_private.chat_get_or_create_dm(p_from uuid, p_to uuid, p_reason text DEFAULT 'user')
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_key text;
  v_id uuid;
BEGIN
  IF p_from IS NULL OR p_to IS NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_dm_requires_two_users';
  END IF;
  IF app_private.chat_is_blocked(p_from, p_to) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_blocked';
  END IF;
  v_key := least(p_from::text, p_to::text) || ':' || greatest(p_from::text, p_to::text);

  SELECT id INTO v_id FROM public.chat_channels WHERE dm_key = v_key;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  -- Invites and applications may open a DM regardless of message_privacy;
  -- ordinary DMs follow it.
  IF p_reason NOT IN ('invite', 'application') AND NOT app_private.chat_can_dm(p_from, p_to) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_dm_not_allowed';
  END IF;

  INSERT INTO public.chat_channels (kind, dm_key, created_by, member_count)
  VALUES ('dm', v_key, p_from, CASE WHEN p_from = p_to THEN 1 ELSE 2 END)
  ON CONFLICT (dm_key) WHERE dm_key IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.chat_channels WHERE dm_key = v_key;
    RETURN v_id;
  END IF;

  INSERT INTO public.chat_channel_members (channel_id, user_id, role)
  SELECT DISTINCT v_id, u, 'member' FROM unnest(ARRAY[p_from, p_to]) AS u;
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION app_private.chat_create_group(p_creator uuid, p_members uuid[])
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
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

-- ponytail: 200 channels per project (L-6). ceiling: Browse lists at most 200
-- rows. upgrade: raise once Browse query time is measured at the cap.
CREATE OR REPLACE FUNCTION app_private.chat_create_channel(
  p_project_id uuid,
  p_creator uuid,
  p_name text,
  p_description text,
  p_private boolean
)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT app_private.chat_is_project_member(p_project_id, p_creator) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_project_member';
  END IF;
  IF p_name IS NULL OR p_name !~ '^[a-z0-9-]{1,80}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_channel_name';
  END IF;
  IF (
    SELECT count(*) FROM public.chat_channels
    WHERE project_id = p_project_id AND application_id IS NULL AND archived_at IS NULL
  ) >= 200 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_project_channel_limit';
  END IF;

  INSERT INTO public.chat_channels (kind, name, description, project_id, created_by, member_count)
  VALUES (CASE WHEN p_private THEN 'private' ELSE 'public' END, p_name, nullif(btrim(coalesce(p_description, '')), ''),
          p_project_id, p_creator, 1)
  RETURNING id INTO v_id;
  INSERT INTO public.chat_channel_members (channel_id, user_id, role) VALUES (v_id, p_creator, 'owner');
  PERFORM app_private.chat_post_system(v_id, p_creator, 'created #' || p_name);
  RETURN v_id;
END
$$;

CREATE OR REPLACE FUNCTION app_private.chat_update_channel(
  p_channel_id uuid,
  p_actor uuid,
  p_name text,
  p_topic text,
  p_description text
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_channel record;
BEGIN
  SELECT * INTO v_channel FROM public.chat_channels WHERE id = p_channel_id;
  IF NOT FOUND OR v_channel.kind = 'dm' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;
  IF NOT app_private.chat_is_channel_admin(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_channel_admin';
  END IF;
  IF p_name IS NOT NULL AND p_name IS DISTINCT FROM v_channel.name THEN
    IF v_channel.is_default OR p_name !~ '^[a-z0-9-]{1,80}$' THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_channel_name';
    END IF;
    UPDATE public.chat_channels SET name = p_name WHERE id = p_channel_id;
    PERFORM app_private.chat_post_system(p_channel_id, p_actor, 'renamed the channel to #' || p_name);
  END IF;
  IF p_topic IS NOT NULL AND nullif(btrim(p_topic), '') IS DISTINCT FROM v_channel.topic THEN
    UPDATE public.chat_channels SET topic = nullif(btrim(p_topic), '') WHERE id = p_channel_id;
    PERFORM app_private.chat_post_system(p_channel_id, p_actor, 'set the topic');
  END IF;
  IF p_description IS NOT NULL THEN
    UPDATE public.chat_channels SET description = nullif(btrim(p_description), '') WHERE id = p_channel_id;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION app_private.chat_archive_channel(p_channel_id uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chat_channels WHERE id = p_channel_id AND kind <> 'dm' AND NOT is_default) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_archivable';
  END IF;
  IF NOT app_private.chat_is_channel_admin(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_channel_admin';
  END IF;
  UPDATE public.chat_channels SET archived_at = now() WHERE id = p_channel_id AND archived_at IS NULL;
END
$$;

-- ponytail: 500 members per channel and 500 channels per user. ceiling: every
-- fan-out (mentions, typing, broadcasts) is bounded by these. upgrade: only
-- together with a fan-out redesign.
CREATE OR REPLACE FUNCTION app_private.chat_assert_capacity(p_channel_id uuid, p_users uuid[])
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT member_count FROM public.chat_channels WHERE id = p_channel_id) + cardinality(p_users) > 500 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_member_limit';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.chat_channel_members m
    WHERE m.user_id = ANY (p_users)
    GROUP BY m.user_id HAVING count(*) >= 500
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_user_channel_limit';
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION app_private.chat_join_channel(p_channel_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_channel record;
  v_added integer;
BEGIN
  SELECT kind, project_id, archived_at INTO v_channel FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  IF NOT FOUND OR v_channel.kind <> 'public' OR v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_channel_not_joinable';
  END IF;
  IF NOT app_private.chat_is_project_member(v_channel.project_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_project_member';
  END IF;
  PERFORM app_private.chat_assert_capacity(p_channel_id, ARRAY[p_user_id]);
  INSERT INTO public.chat_channel_members (channel_id, user_id) VALUES (p_channel_id, p_user_id) ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  IF v_added > 0 THEN
    UPDATE public.chat_channels SET member_count = member_count + 1 WHERE id = p_channel_id;
    PERFORM app_private.chat_post_system(p_channel_id, p_user_id, 'joined');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION app_private.chat_leave_channel(p_channel_id uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_removed integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chat_channels WHERE id = p_channel_id AND kind <> 'dm' AND NOT is_default) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_channel_not_leavable';
  END IF;
  DELETE FROM public.chat_channel_members WHERE channel_id = p_channel_id AND user_id = p_user_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  IF v_removed > 0 THEN
    UPDATE public.chat_channels SET member_count = greatest(member_count - 1, 0) WHERE id = p_channel_id;
    PERFORM app_private.chat_post_system(p_channel_id, p_user_id, 'left');
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION app_private.chat_add_members(p_channel_id uuid, p_actor uuid, p_users uuid[])
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_channel record;
  v_new uuid[];
  v_added integer;
BEGIN
  SELECT kind, project_id, archived_at INTO v_channel FROM public.chat_channels WHERE id = p_channel_id FOR UPDATE;
  IF NOT FOUND OR v_channel.kind = 'dm' OR v_channel.archived_at IS NOT NULL THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;
  IF NOT app_private.chat_is_member(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  SELECT coalesce(array_agg(DISTINCT u), '{}') INTO v_new
  FROM unnest(coalesce(p_users, '{}')) AS u
  WHERE u IS NOT NULL AND NOT app_private.chat_is_member(p_channel_id, u);
  IF cardinality(v_new) = 0 THEN
    RETURN 0;
  END IF;
  IF v_channel.project_id IS NOT NULL THEN
    IF EXISTS (SELECT 1 FROM unnest(v_new) AS u WHERE NOT app_private.chat_is_project_member(v_channel.project_id, u)) THEN
      RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_project_member';
    END IF;
  ELSIF EXISTS (SELECT 1 FROM unnest(v_new) AS u WHERE NOT app_private.chat_can_dm(p_actor, u)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_dm_not_allowed';
  END IF;
  PERFORM app_private.chat_assert_capacity(p_channel_id, v_new);

  INSERT INTO public.chat_channel_members (channel_id, user_id)
  SELECT p_channel_id, u FROM unnest(v_new) AS u
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  UPDATE public.chat_channels SET member_count = member_count + v_added WHERE id = p_channel_id;
  IF v_added > 0 THEN
    PERFORM app_private.chat_post_system(
      p_channel_id, p_actor,
      'added ' || (SELECT string_agg('<@' || u || '>', ', ') FROM unnest(v_new) AS u)
    );
  END IF;
  RETURN v_added;
END
$$;

CREATE OR REPLACE FUNCTION app_private.chat_remove_member(p_channel_id uuid, p_actor uuid, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_removed integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.chat_channels WHERE id = p_channel_id AND kind <> 'dm' AND NOT is_default) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;
  IF NOT app_private.chat_is_channel_admin(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_channel_admin';
  END IF;
  DELETE FROM public.chat_channel_members WHERE channel_id = p_channel_id AND user_id = p_user_id;
  GET DIAGNOSTICS v_removed = ROW_COUNT;
  IF v_removed > 0 THEN
    UPDATE public.chat_channels SET member_count = greatest(member_count - 1, 0) WHERE id = p_channel_id;
    PERFORM app_private.chat_post_system(p_channel_id, p_actor, 'removed <@' || p_user_id || '>');
  END IF;
END
$$;
--> statement-breakpoint

-- ── Per-member state, reads, edits ──────────────────────────────────────────

CREATE OR REPLACE FUNCTION app_private.chat_set_member_state(
  p_channel_id uuid,
  p_user_id uuid,
  p_notify text,
  p_starred boolean,
  p_archived boolean
)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  UPDATE public.chat_channel_members SET
    notify = coalesce(p_notify, notify),
    starred = coalesce(p_starred, starred),
    archived_at = CASE WHEN p_archived IS NULL THEN archived_at WHEN p_archived THEN coalesce(archived_at, now()) ELSE NULL END
  WHERE channel_id = p_channel_id AND user_id = p_user_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
END
$$;

-- Only-if-newer: a stale or repeated cursor write touches no row (no dead tuple).
CREATE OR REPLACE FUNCTION app_private.chat_mark_read(p_channel_id uuid, p_user_id uuid, p_seq bigint)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
SET search_path = ''
AS $$
  WITH moved AS (
    UPDATE public.chat_channel_members m
    SET last_read_seq = p_seq, mention_count = 0
    FROM public.chat_channels c
    WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id
      AND c.id = m.channel_id AND p_seq <= c.last_seq AND m.last_read_seq < p_seq
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM moved)
$$;

CREATE OR REPLACE FUNCTION app_private.chat_mark_thread_read(p_channel_id uuid, p_user_id uuid, p_root bigint, p_seq bigint)
RETURNS boolean
LANGUAGE sql SECURITY DEFINER
SET search_path = ''
AS $$
  WITH moved AS (
    UPDATE public.chat_thread_follows
    SET last_read_seq = p_seq
    WHERE user_id = p_user_id AND channel_id = p_channel_id AND root_seq = p_root AND last_read_seq < p_seq
    RETURNING 1
  )
  SELECT EXISTS (SELECT 1 FROM moved)
$$;

CREATE OR REPLACE FUNCTION app_private.chat_edit_message(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_body text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_body IS NULL OR btrim(p_body) = '' OR char_length(p_body) > 4000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_body';
  END IF;
  UPDATE public.chat_messages SET body = p_body, edited_at = now()
  WHERE channel_id = p_channel_id AND channel_seq = p_seq AND author_id = p_user_id
    AND kind = 'user' AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_editable';
  END IF;
  UPDATE public.chat_channels SET last_preview = left(regexp_replace(btrim(p_body), '\s+', ' ', 'g'), 120)
  WHERE id = p_channel_id AND last_top_seq = p_seq;
END
$$;

CREATE OR REPLACE FUNCTION app_private.chat_delete_message(p_channel_id uuid, p_seq bigint, p_user_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_author uuid;
BEGIN
  SELECT author_id INTO v_author FROM public.chat_messages
  WHERE channel_id = p_channel_id AND channel_seq = p_seq AND kind = 'user' AND deleted_at IS NULL;
  IF NOT FOUND OR NOT (
    (v_author = p_user_id AND app_private.chat_is_member(p_channel_id, p_user_id))
    OR app_private.chat_is_channel_admin(p_channel_id, p_user_id)
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_deletable';
  END IF;
  UPDATE public.chat_messages SET body = '', deleted_at = now()
  WHERE channel_id = p_channel_id AND channel_seq = p_seq;
  DELETE FROM public.chat_attachments WHERE channel_id = p_channel_id AND message_seq = p_seq;
  DELETE FROM public.chat_message_cards WHERE channel_id = p_channel_id AND message_seq = p_seq;
  DELETE FROM public.chat_pins WHERE channel_id = p_channel_id AND message_seq = p_seq;
  UPDATE public.chat_channels SET last_preview = 'Message deleted'
  WHERE id = p_channel_id AND last_top_seq = p_seq;
END
$$;

CREATE OR REPLACE FUNCTION app_private.chat_react(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_emoji text, p_on boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT app_private.chat_is_member(p_channel_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  IF p_on THEN
    IF NOT EXISTS (SELECT 1 FROM public.chat_messages WHERE channel_id = p_channel_id AND channel_seq = p_seq AND deleted_at IS NULL) THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_message_not_found';
    END IF;
    INSERT INTO public.chat_reactions (channel_id, message_seq, user_id, emoji)
    VALUES (p_channel_id, p_seq, p_user_id, p_emoji) ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.chat_reactions
    WHERE channel_id = p_channel_id AND message_seq = p_seq AND user_id = p_user_id AND emoji = p_emoji;
  END IF;
END
$$;

-- In DMs and group chats any member pins; in project channels only admins.
CREATE OR REPLACE FUNCTION app_private.chat_pin(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_on boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_project uuid;
BEGIN
  SELECT project_id INTO v_project FROM public.chat_channels WHERE id = p_channel_id;
  IF NOT app_private.chat_is_member(p_channel_id, p_user_id)
     OR (v_project IS NOT NULL AND NOT app_private.chat_is_channel_admin(p_channel_id, p_user_id)) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_allowed_to_pin';
  END IF;
  IF p_on THEN
    INSERT INTO public.chat_pins (channel_id, message_seq, pinned_by)
    SELECT p_channel_id, p_seq, p_user_id
    WHERE EXISTS (SELECT 1 FROM public.chat_messages WHERE channel_id = p_channel_id AND channel_seq = p_seq AND deleted_at IS NULL)
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.chat_pins WHERE channel_id = p_channel_id AND message_seq = p_seq;
  END IF;
END
$$;

CREATE OR REPLACE FUNCTION app_private.chat_report(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_reason text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  IF NOT app_private.chat_is_member(p_channel_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  INSERT INTO public.chat_reports (channel_id, message_seq, reporter_id, reason)
  VALUES (p_channel_id, p_seq, p_user_id, p_reason)
  RETURNING id INTO v_id;
  RETURN v_id;
END
$$;
--> statement-breakpoint

-- ── Project and application wiring ──────────────────────────────────────────

-- ops: 'ensure_default' (create #general, add all members), 'add' (one member
-- joins the default channel), 'remove' (leaves every project channel), 'role'
-- (default-channel role follows the project role).
CREATE OR REPLACE FUNCTION app_private.chat_sync_project_members(p_project_id uuid, p_user_id uuid, p_op text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_default uuid;
  v_added integer;
BEGIN
  IF p_op = 'remove' THEN
    WITH removed AS (
      DELETE FROM public.chat_channel_members m
      USING public.chat_channels c
      WHERE c.id = m.channel_id AND c.project_id = p_project_id AND m.user_id = p_user_id
      RETURNING m.channel_id
    )
    UPDATE public.chat_channels c
    SET member_count = greatest(c.member_count - 1, 0)
    FROM removed WHERE c.id = removed.channel_id;
    RETURN NULL;
  END IF;

  IF p_op NOT IN ('ensure_default', 'add', 'role') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_sync_op';
  END IF;

  SELECT id INTO v_default FROM public.chat_channels WHERE project_id = p_project_id AND is_default;
  IF NOT FOUND THEN
    INSERT INTO public.chat_channels (kind, name, project_id, is_default, description, created_by)
    SELECT 'public', 'general', p.id, true, 'Everyone in the project', p.owner_id
    FROM public.projects p WHERE p.id = p_project_id
    ON CONFLICT (project_id) WHERE is_default DO NOTHING
    RETURNING id INTO v_default;
    IF v_default IS NULL THEN
      SELECT id INTO v_default FROM public.chat_channels WHERE project_id = p_project_id AND is_default;
    END IF;
    IF v_default IS NULL THEN
      RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_project_not_found';
    END IF;
  END IF;

  IF p_op = 'role' THEN
    UPDATE public.chat_channel_members m
    SET role = CASE pm.role WHEN 'owner' THEN 'owner' WHEN 'admin' THEN 'admin' ELSE 'member' END
    FROM public.project_members pm
    WHERE m.channel_id = v_default AND m.user_id = p_user_id
      AND pm.project_id = p_project_id AND pm.user_id = p_user_id;
    RETURN v_default;
  END IF;

  INSERT INTO public.chat_channel_members (channel_id, user_id, role)
  SELECT v_default, pm.user_id, CASE pm.role WHEN 'owner' THEN 'owner' WHEN 'admin' THEN 'admin' ELSE 'member' END
  FROM public.project_members pm
  WHERE pm.project_id = p_project_id AND (p_user_id IS NULL OR pm.user_id = p_user_id)
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  IF v_added > 0 THEN
    UPDATE public.chat_channels SET member_count = member_count + v_added WHERE id = v_default;
  END IF;
  RETURN v_default;
END
$$;

-- One private channel per application: applicant plus the project's owner and
-- admins, opened by the application card (the applicant's message as body).
CREATE OR REPLACE FUNCTION app_private.chat_ensure_application_channel(p_application_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_app record;
  v_id uuid;
  v_added integer;
BEGIN
  SELECT a.id, a.project_id, a.applicant_id, a.message INTO v_app
  FROM public.role_applications a WHERE a.id = p_application_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_application_not_found';
  END IF;

  SELECT id INTO v_id FROM public.chat_channels WHERE application_id = p_application_id;
  IF FOUND THEN
    RETURN v_id;
  END IF;

  INSERT INTO public.chat_channels (kind, project_id, application_id, created_by)
  VALUES ('private', v_app.project_id, p_application_id, v_app.applicant_id)
  ON CONFLICT (application_id) WHERE application_id IS NOT NULL DO NOTHING
  RETURNING id INTO v_id;
  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.chat_channels WHERE application_id = p_application_id;
    RETURN v_id;
  END IF;

  INSERT INTO public.chat_channel_members (channel_id, user_id, role)
  SELECT v_id, v_app.applicant_id, 'member'
  UNION
  SELECT v_id, p.owner_id, 'owner' FROM public.projects p WHERE p.id = v_app.project_id
  UNION
  SELECT v_id, pm.user_id, CASE pm.role WHEN 'owner' THEN 'owner' ELSE 'admin' END
  FROM public.project_members pm
  WHERE pm.project_id = v_app.project_id AND pm.role IN ('owner', 'admin')
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS v_added = ROW_COUNT;
  UPDATE public.chat_channels SET member_count = v_added WHERE id = v_id;

  PERFORM app_private.chat_append_message(
    v_id, v_app.applicant_id, 'user', left(coalesce(v_app.message, ''), 4000), 'application:' || p_application_id,
    NULL, '[]'::jsonb, jsonb_build_object('kind', 'application', 'ref_id', p_application_id)
  );
  RETURN v_id;
END
$$;
--> statement-breakpoint

-- ── Bootstrap: one call on app entry and for the background poll ────────────
-- ponytail: background unread for non-open channels comes from this poll every
-- 90 s ± 30 s (L-2). ceiling: ≤ 2 min staleness; ~1.1k calls/s at 100k
-- concurrent users. upgrade: tick topics for the top-N channels when the poll
-- passes 15% of DB CPU. DMs and mentions arrive instantly via chat:user hints.
CREATE OR REPLACE FUNCTION app_private.chat_bootstrap(p_user_id uuid, p_since timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  WITH mine AS (
    SELECT c.id, c.kind, c.name, c.topic, c.project_id, c.application_id, c.is_default, c.last_seq, c.last_top_seq,
           c.last_message_at, c.last_preview, c.last_author_id, c.member_count, c.archived_at AS channel_archived_at,
           m.role, m.last_read_seq, m.mention_count, m.notify, m.starred, m.archived_at, m.joined_at
    FROM public.chat_channel_members m
    JOIN public.chat_channels c ON c.id = m.channel_id
    WHERE m.user_id = p_user_id
      AND (p_since IS NULL OR c.last_message_at > p_since OR m.joined_at > p_since)
  ), ranked AS (
    SELECT mine.*, row_number() OVER (PARTITION BY (kind = 'dm') ORDER BY last_message_at DESC NULLS LAST) AS rn
    FROM mine
  )
  SELECT jsonb_build_object(
    'server_time', now(),
    'activity_latest_at', (SELECT max(created_at) FROM public.chat_mentions WHERE user_id = p_user_id),
    'channels', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'name', r.name, 'topic', r.topic, 'project_id', r.project_id,
        'application_id', r.application_id, 'is_default', r.is_default, 'last_seq', r.last_seq,
        'last_top_seq', r.last_top_seq, 'last_read_seq', r.last_read_seq, 'mention_count', r.mention_count,
        'notify', r.notify, 'starred', r.starred, 'archived_at', r.archived_at,
        'channel_archived_at', r.channel_archived_at, 'last_message_at', r.last_message_at,
        'last_preview', r.last_preview, 'last_author_id', r.last_author_id, 'member_count', r.member_count,
        'role', r.role,
        'dm_user', CASE WHEN r.kind = 'dm' THEN (
          SELECT jsonb_build_object('id', p.id, 'username', p.username, 'full_name', p.full_name, 'avatar_url', p.avatar_url)
          FROM public.chat_channel_members o JOIN public.profiles p ON p.id = o.user_id
          WHERE o.channel_id = r.id
          ORDER BY (o.user_id = p_user_id) LIMIT 1
        ) END,
        'members_preview', CASE WHEN r.kind = 'private' AND r.name IS NULL THEN (
          SELECT jsonb_agg(jsonb_build_object('id', x.id, 'username', x.username, 'full_name', x.full_name, 'avatar_url', x.avatar_url))
          FROM (
            SELECT p.id, p.username, p.full_name, p.avatar_url
            FROM public.chat_channel_members o JOIN public.profiles p ON p.id = o.user_id
            WHERE o.channel_id = r.id AND o.user_id <> p_user_id
            ORDER BY o.joined_at LIMIT 3
          ) x
        ) END
      ))
      FROM ranked r
      -- ponytail: the first payload carries the 100 most recent DMs (L-30).
      -- ceiling: older DMs load from the DM list. upgrade: paging if it grows.
      WHERE r.kind <> 'dm' OR r.rn <= 100
    ), '[]'::jsonb),
    'projects', CASE WHEN p_since IS NULL THEN coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', p.id, 'title', p.title, 'slug', p.slug, 'cover_image', p.cover_image, 'role', pm.role) ORDER BY p.title)
      FROM public.project_members pm JOIN public.projects p ON p.id = pm.project_id
      WHERE pm.user_id = p_user_id
    ), '[]'::jsonb) END
  )
$$;
--> statement-breakpoint

-- ── Live cards ──────────────────────────────────────────────────────────────
-- A status change on a task, application or invitation tells every channel that
-- shows its card (typically 1-3) to refetch that card.
CREATE OR REPLACE FUNCTION app_private.chat_card_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_card record;
BEGIN
  FOR v_card IN
    SELECT channel_id, message_seq FROM public.chat_message_cards
    WHERE kind = TG_ARGV[0] AND ref_id = NEW.id
  LOOP
    PERFORM realtime.send(
      jsonb_build_object('kind', TG_ARGV[0], 'ref_id', NEW.id, 'seq', v_card.message_seq),
      'card.changed',
      'chat:channel:' || v_card.channel_id,
      true
    );
  END LOOP;
  RETURN NULL;
END
$$;

DROP TRIGGER IF EXISTS chat_card_changed_task ON public.tasks;
CREATE TRIGGER chat_card_changed_task
AFTER UPDATE OF status, assignee_id, title, priority, due_date ON public.tasks
FOR EACH ROW
WHEN (
  OLD.status IS DISTINCT FROM NEW.status OR OLD.assignee_id IS DISTINCT FROM NEW.assignee_id
  OR OLD.title IS DISTINCT FROM NEW.title OR OLD.priority IS DISTINCT FROM NEW.priority
  OR OLD.due_date IS DISTINCT FROM NEW.due_date
)
EXECUTE FUNCTION app_private.chat_card_changed('task');

DROP TRIGGER IF EXISTS chat_card_changed_application ON public.role_applications;
CREATE TRIGGER chat_card_changed_application
AFTER UPDATE OF status ON public.role_applications
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION app_private.chat_card_changed('application');

DROP TRIGGER IF EXISTS chat_card_changed_invite ON public.project_invitations;
CREATE TRIGGER chat_card_changed_invite
AFTER UPDATE OF status ON public.project_invitations
FOR EACH ROW WHEN (OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION app_private.chat_card_changed('invite');
--> statement-breakpoint

-- ── Grants and RLS ──────────────────────────────────────────────────────────
-- Writes go only through the app_private functions (service role). Browser
-- roles get read-only, member-scoped access (Realtime authorization and
-- defence in depth).
ALTER TABLE public.chat_channels ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_channel_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_message_cards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_mentions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_thread_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_pins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_reports ENABLE ROW LEVEL SECURITY;

DO $chat_grants$
DECLARE
  fn record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.chat_channels, public.chat_channel_members, public.chat_messages, public.chat_message_cards,
      public.chat_attachments, public.chat_reactions, public.chat_mentions, public.chat_thread_follows,
      public.chat_pins, public.chat_reports FROM anon, authenticated;
    GRANT SELECT ON public.chat_channels, public.chat_channel_members, public.chat_messages, public.chat_message_cards,
      public.chat_attachments, public.chat_reactions, public.chat_mentions, public.chat_thread_follows,
      public.chat_pins, public.chat_reports TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON public.chat_channels, public.chat_channel_members, public.chat_messages, public.chat_message_cards,
      public.chat_attachments, public.chat_reactions, public.chat_mentions, public.chat_thread_follows,
      public.chat_pins, public.chat_reports TO service_role;
  END IF;

  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private' AND p.proname LIKE 'chat\_%'
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.signature);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn.signature);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
    END IF;
  END LOOP;

  -- RLS and Realtime policies evaluate these as the browser role.
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    GRANT USAGE ON SCHEMA app_private TO authenticated;
    GRANT EXECUTE ON FUNCTION app_private.chat_is_member(uuid, uuid) TO authenticated;
    GRANT EXECUTE ON FUNCTION app_private.chat_is_project_member(uuid, uuid) TO authenticated;
  END IF;
END
$chat_grants$;

DROP POLICY IF EXISTS chat_channels_member_select ON public.chat_channels;
CREATE POLICY chat_channels_member_select ON public.chat_channels FOR SELECT TO authenticated
USING (
  app_private.chat_is_member(id, (SELECT auth.uid()))
  OR (kind = 'public' AND archived_at IS NULL AND app_private.chat_is_project_member(project_id, (SELECT auth.uid())))
);

DROP POLICY IF EXISTS chat_channel_members_member_select ON public.chat_channel_members;
CREATE POLICY chat_channel_members_member_select ON public.chat_channel_members FOR SELECT TO authenticated
USING (app_private.chat_is_member(channel_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS chat_messages_member_select ON public.chat_messages;
CREATE POLICY chat_messages_member_select ON public.chat_messages FOR SELECT TO authenticated
USING (app_private.chat_is_member(channel_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS chat_message_cards_member_select ON public.chat_message_cards;
CREATE POLICY chat_message_cards_member_select ON public.chat_message_cards FOR SELECT TO authenticated
USING (app_private.chat_is_member(channel_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS chat_attachments_member_select ON public.chat_attachments;
CREATE POLICY chat_attachments_member_select ON public.chat_attachments FOR SELECT TO authenticated
USING (app_private.chat_is_member(channel_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS chat_reactions_member_select ON public.chat_reactions;
CREATE POLICY chat_reactions_member_select ON public.chat_reactions FOR SELECT TO authenticated
USING (app_private.chat_is_member(channel_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS chat_pins_member_select ON public.chat_pins;
CREATE POLICY chat_pins_member_select ON public.chat_pins FOR SELECT TO authenticated
USING (app_private.chat_is_member(channel_id, (SELECT auth.uid())));

DROP POLICY IF EXISTS chat_mentions_owner_select ON public.chat_mentions;
CREATE POLICY chat_mentions_owner_select ON public.chat_mentions FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS chat_thread_follows_owner_select ON public.chat_thread_follows;
CREATE POLICY chat_thread_follows_owner_select ON public.chat_thread_follows FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS chat_reports_owner_select ON public.chat_reports;
CREATE POLICY chat_reports_owner_select ON public.chat_reports FOR SELECT TO authenticated
USING (reporter_id = (SELECT auth.uid()));
--> statement-breakpoint

-- ── Realtime topics ─────────────────────────────────────────────────────────
-- The drift check requires these two policy names, so the chat topics are new
-- CASE branches. Every branch from 0160 is kept verbatim (presence:conversation
-- is removed in 0181 with the old system).
--   chat:channel:<uuid>  members read; members send (typing only, client-side)
--   chat:user:<uuid>     only that user reads; nobody sends (server publishes)
DROP POLICY IF EXISTS application_topic_read ON realtime.messages;
DROP POLICY IF EXISTS application_topic_send ON realtime.messages;

CREATE POLICY application_topic_read ON realtime.messages
FOR SELECT TO authenticated
USING (
  CASE
    WHEN (SELECT realtime.topic()) ~ '^presence:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension IN ('presence', 'broadcast')
      AND app_private.nb_can_observe_user_presence(split_part((SELECT realtime.topic()), ':', 3)::uuid)
    WHEN (SELECT realtime.topic()) ~ '^presence:conversation:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension IN ('presence', 'broadcast')
      AND app_private.nb_is_conversation_participant(split_part((SELECT realtime.topic()), ':', 3)::uuid)
    WHEN (SELECT realtime.topic()) ~ '^presence:task:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension IN ('presence', 'broadcast')
      AND EXISTS (
        SELECT 1 FROM public.tasks task
        WHERE task.id::text = split_part((SELECT realtime.topic()), ':', 3)
          AND app_private.nb_project_can_read(task.project_id)
      )
    WHEN (SELECT realtime.topic()) ~ '^project-stats:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension = 'broadcast'
      AND app_private.nb_project_can_read(split_part((SELECT realtime.topic()), ':', 2)::uuid)
    WHEN (SELECT realtime.topic()) ~ '^chat:channel:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension = 'broadcast'
      AND app_private.chat_is_member(split_part((SELECT realtime.topic()), ':', 3)::uuid, (SELECT auth.uid()))
    WHEN (SELECT realtime.topic()) ~ '^chat:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension = 'broadcast'
      AND split_part((SELECT realtime.topic()), ':', 3) = (SELECT auth.uid())::text
    ELSE FALSE
  END
);

CREATE POLICY application_topic_send ON realtime.messages
FOR INSERT TO authenticated
WITH CHECK (
  CASE
    WHEN (SELECT realtime.topic()) ~ '^presence:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension IN ('presence', 'broadcast')
      AND split_part((SELECT realtime.topic()), ':', 3) = (SELECT auth.uid())::text
    WHEN (SELECT realtime.topic()) ~ '^presence:conversation:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension IN ('presence', 'broadcast')
      AND app_private.nb_is_conversation_participant(split_part((SELECT realtime.topic()), ':', 3)::uuid)
    WHEN (SELECT realtime.topic()) ~ '^presence:task:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension IN ('presence', 'broadcast')
      AND EXISTS (
        SELECT 1 FROM public.tasks task
        WHERE task.id::text = split_part((SELECT realtime.topic()), ':', 3)
          AND app_private.nb_project_can_read(task.project_id)
      )
    WHEN (SELECT realtime.topic()) ~ '^project-stats:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension = 'broadcast'
      AND app_private.nb_project_can_read(split_part((SELECT realtime.topic()), ':', 2)::uuid)
    WHEN (SELECT realtime.topic()) ~ '^chat:channel:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$' THEN
      realtime.messages.extension = 'broadcast'
      AND app_private.chat_is_member(split_part((SELECT realtime.topic()), ':', 3)::uuid, (SELECT auth.uid()))
    ELSE FALSE
  END
);
