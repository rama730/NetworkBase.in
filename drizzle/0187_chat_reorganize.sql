-- 0187: the Messages reorganization.
-- Saved items with reminders, shared channel tabs (bookmarks, tasks), scheduled
-- messages, Inbox read state, group-chat names, message search, Mark unread,
-- member pins, unarchive, member roles and explicit thread follow.
-- New tables are written by server actions only; the browser role can SELECT
-- its own rows (or its channels' tabs), like every chat_* table.

ALTER TABLE public.chat_channels ADD COLUMN IF NOT EXISTS title text;
ALTER TABLE public.chat_mentions ADD COLUMN IF NOT EXISTS read_at timestamptz;

DO $chat_title_check$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'chat_channels_title_check') THEN
    ALTER TABLE public.chat_channels ADD CONSTRAINT chat_channels_title_check
      CHECK (title IS NULL OR char_length(title) BETWEEN 1 AND 80);
  END IF;
END
$chat_title_check$;

CREATE TABLE IF NOT EXISTS public.chat_saved (
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL,
  message_seq bigint NOT NULL,
  remind_at timestamptz,
  reminded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id, message_seq),
  FOREIGN KEY (channel_id, message_seq) REFERENCES public.chat_messages (channel_id, channel_seq) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS chat_saved_user_idx ON public.chat_saved (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS chat_saved_due_idx ON public.chat_saved (remind_at) WHERE reminded_at IS NULL AND remind_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.chat_channel_tabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  kind text NOT NULL,
  title text NOT NULL,
  url text,
  position integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_channel_tabs_kind_check CHECK (kind IN ('tasks', 'link')),
  CONSTRAINT chat_channel_tabs_title_check CHECK (char_length(btrim(title)) BETWEEN 1 AND 60),
  CONSTRAINT chat_channel_tabs_url_check CHECK (
    (kind = 'link' AND url IS NOT NULL AND char_length(url) <= 2000 AND url ~ '^https?://')
    OR (kind <> 'link' AND url IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS chat_channel_tabs_channel_idx ON public.chat_channel_tabs (channel_id, position);
CREATE UNIQUE INDEX IF NOT EXISTS chat_channel_tabs_tasks_uniq ON public.chat_channel_tabs (channel_id) WHERE kind = 'tasks';

CREATE TABLE IF NOT EXISTS public.chat_scheduled_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel_id uuid NOT NULL REFERENCES public.chat_channels(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  body text NOT NULL,
  thread_root_seq bigint,
  send_at timestamptz NOT NULL,
  sent_at timestamptz,
  failed_reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chat_scheduled_messages_body_check CHECK (char_length(body) BETWEEN 1 AND 4000),
  CONSTRAINT chat_scheduled_messages_reason_check CHECK (failed_reason IS NULL OR char_length(failed_reason) <= 120)
);
CREATE INDEX IF NOT EXISTS chat_scheduled_messages_due_idx ON public.chat_scheduled_messages (send_at) WHERE sent_at IS NULL AND failed_reason IS NULL;
CREATE INDEX IF NOT EXISTS chat_scheduled_messages_user_idx ON public.chat_scheduled_messages (user_id, send_at);

-- Message search. Built per partition; the planner prunes to the viewer's channels.
CREATE INDEX IF NOT EXISTS chat_messages_body_fts_idx ON public.chat_messages USING gin (to_tsvector('simple', body));
--> statement-breakpoint

-- Any member may pin (Slack default). Pins in project channels were admin-only.
CREATE OR REPLACE FUNCTION app_private.chat_pin(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_on boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT app_private.chat_is_member(p_channel_id, p_user_id) THEN
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

-- Mark unread from a message: the cursor moves back to just before it and the
-- mention count is rebuilt from the mentions at or after it.
CREATE OR REPLACE FUNCTION app_private.chat_mark_unread(p_channel_id uuid, p_user_id uuid, p_seq bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT app_private.chat_is_member(p_channel_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  UPDATE public.chat_mentions SET read_at = NULL
  WHERE user_id = p_user_id AND channel_id = p_channel_id AND message_seq >= p_seq;
  UPDATE public.chat_channel_members m
  SET last_read_seq = greatest(p_seq - 1, 0),
      mention_count = (
        SELECT count(*)::int FROM public.chat_mentions mn
        WHERE mn.user_id = p_user_id AND mn.channel_id = p_channel_id AND mn.message_seq >= p_seq AND mn.kind <> 'thread_reply'
      )
  WHERE m.channel_id = p_channel_id AND m.user_id = p_user_id;
END
$$;

CREATE OR REPLACE FUNCTION app_private.chat_unarchive_channel(p_channel_id uuid, p_actor uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT app_private.chat_is_channel_admin(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_channel_admin';
  END IF;
  UPDATE public.chat_channels SET archived_at = NULL WHERE id = p_channel_id AND kind <> 'dm' AND archived_at IS NOT NULL;
  IF FOUND THEN
    PERFORM app_private.chat_post_system(p_channel_id, p_actor, 'unarchived the channel');
  END IF;
END
$$;

-- Channel admins make members admins or members; the owner row never changes here.
CREATE OR REPLACE FUNCTION app_private.chat_set_member_role(p_channel_id uuid, p_actor uuid, p_user_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_role';
  END IF;
  IF NOT app_private.chat_is_channel_admin(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_channel_admin';
  END IF;
  UPDATE public.chat_channel_members SET role = p_role
  WHERE channel_id = p_channel_id AND user_id = p_user_id AND role <> 'owner';
  IF NOT FOUND THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_member_not_found';
  END IF;
END
$$;

-- Group chats (unnamed private channels outside projects) can carry a display name.
CREATE OR REPLACE FUNCTION app_private.chat_rename_group(p_channel_id uuid, p_actor uuid, p_title text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_title text := nullif(btrim(coalesce(p_title, '')), '');
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.chat_channels
    WHERE id = p_channel_id AND kind = 'private' AND name IS NULL AND project_id IS NULL AND application_id IS NULL
  ) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_channel_not_found';
  END IF;
  IF NOT app_private.chat_is_member(p_channel_id, p_actor) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  IF v_title IS NOT NULL AND char_length(v_title) > 80 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_input';
  END IF;
  UPDATE public.chat_channels SET title = v_title WHERE id = p_channel_id AND title IS DISTINCT FROM v_title;
  IF FOUND THEN
    PERFORM app_private.chat_post_system(p_channel_id, p_actor,
      CASE WHEN v_title IS NULL THEN 'removed the group name' ELSE 'named the group ' || v_title END);
  END IF;
END
$$;

-- Follow or leave a thread. Following starts read at the latest reply.
CREATE OR REPLACE FUNCTION app_private.chat_set_thread_follow(p_channel_id uuid, p_user_id uuid, p_root bigint, p_on boolean)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF NOT app_private.chat_is_member(p_channel_id, p_user_id) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_member';
  END IF;
  IF p_on THEN
    INSERT INTO public.chat_thread_follows (user_id, channel_id, root_seq, last_read_seq)
    SELECT p_user_id, p_channel_id, m.channel_seq, coalesce(m.last_reply_seq, m.channel_seq)
    FROM public.chat_messages m
    WHERE m.channel_id = p_channel_id AND m.channel_seq = p_root AND m.thread_root_seq IS NULL
    ON CONFLICT DO NOTHING;
  ELSE
    DELETE FROM public.chat_thread_follows WHERE user_id = p_user_id AND channel_id = p_channel_id AND root_seq = p_root;
  END IF;
END
$$;

-- Unread Inbox items: a mention or thread reply not marked read and not behind
-- the read cursor (the channel's for top-level messages, the thread's for replies).
CREATE OR REPLACE FUNCTION app_private.chat_inbox_unread(p_user_id uuid)
RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT count(*)::int
  FROM public.chat_mentions mn
  JOIN public.chat_channel_members mem ON mem.channel_id = mn.channel_id AND mem.user_id = mn.user_id
  JOIN public.chat_messages msg ON msg.channel_id = mn.channel_id AND msg.channel_seq = mn.message_seq
  LEFT JOIN public.chat_thread_follows f
    ON f.user_id = mn.user_id AND f.channel_id = mn.channel_id AND f.root_seq = msg.thread_root_seq
  WHERE mn.user_id = p_user_id AND mn.read_at IS NULL AND msg.deleted_at IS NULL AND mem.notify <> 'mute'
    AND NOT CASE WHEN msg.thread_root_seq IS NULL THEN mn.message_seq <= mem.last_read_seq
                 ELSE coalesce(f.last_read_seq, 0) >= mn.message_seq END
$$;

-- 0180's bootstrap plus the group title and the Inbox unread count.
CREATE OR REPLACE FUNCTION app_private.chat_bootstrap(p_user_id uuid, p_since timestamptz DEFAULT NULL)
RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  WITH mine AS (
    SELECT c.id, c.kind, c.name, c.title, c.topic, c.project_id, c.application_id, c.is_default, c.last_seq, c.last_top_seq,
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
    'inbox_unread', app_private.chat_inbox_unread(p_user_id),
    'channels', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'kind', r.kind, 'name', r.name, 'title', r.title, 'topic', r.topic, 'project_id', r.project_id,
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

ALTER TABLE public.chat_saved ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_channel_tabs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_scheduled_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS chat_saved_owner_select ON public.chat_saved;
CREATE POLICY chat_saved_owner_select ON public.chat_saved FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS chat_scheduled_messages_owner_select ON public.chat_scheduled_messages;
CREATE POLICY chat_scheduled_messages_owner_select ON public.chat_scheduled_messages FOR SELECT TO authenticated
USING (user_id = (SELECT auth.uid()));

DROP POLICY IF EXISTS chat_channel_tabs_member_select ON public.chat_channel_tabs;
CREATE POLICY chat_channel_tabs_member_select ON public.chat_channel_tabs FOR SELECT TO authenticated
USING (app_private.chat_is_member(channel_id, (SELECT auth.uid())));

DO $chat_reorganize_grants$
DECLARE
  fn record;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    REVOKE ALL ON public.chat_saved, public.chat_channel_tabs, public.chat_scheduled_messages FROM anon, authenticated;
    GRANT SELECT ON public.chat_saved, public.chat_channel_tabs, public.chat_scheduled_messages TO authenticated;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    GRANT ALL ON public.chat_saved, public.chat_channel_tabs, public.chat_scheduled_messages TO service_role;
  END IF;
  FOR fn IN
    SELECT p.oid::regprocedure AS signature
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'app_private'
      AND p.proname IN ('chat_pin', 'chat_mark_unread', 'chat_unarchive_channel', 'chat_set_member_role',
                        'chat_rename_group', 'chat_set_thread_follow', 'chat_inbox_unread', 'chat_bootstrap')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', fn.signature);
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, authenticated', fn.signature);
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', fn.signature);
    END IF;
  END LOOP;
END
$chat_reorganize_grants$;
