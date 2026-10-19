-- A soft-deleted project showed up a second time in Messages: chat_bootstrap listed its membership and
-- its channels as if it were live. A deleted project now owns no chat state anywhere.
-- 1. The bootstrap ignores deleted projects (project list and channel list).
CREATE OR REPLACE FUNCTION app_private.chat_bootstrap(p_user_id uuid, p_since timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  WITH mine AS (
    SELECT c.id, c.kind, c.name, c.title, c.topic, c.project_id, c.application_id, c.is_default, c.last_seq, c.last_top_seq,
           c.last_message_at, c.last_preview, c.last_author_id, c.member_count, c.archived_at AS channel_archived_at,
           m.role, m.last_read_seq, m.mention_count, m.notify, m.starred, m.archived_at, m.joined_at
    FROM public.chat_channel_members m
    JOIN public.chat_channels c ON c.id = m.channel_id
    WHERE m.user_id = p_user_id
      AND (p_since IS NULL OR c.last_message_at > p_since OR m.joined_at > p_since)
      -- A deleted project owns no chat: its channels and its project row stay out of the sidebar.
      AND NOT EXISTS (SELECT 1 FROM public.projects dp WHERE dp.id = c.project_id AND dp.deleted_at IS NOT NULL)
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
      WHERE pm.user_id = p_user_id AND p.deleted_at IS NULL
    ), '[]'::jsonb) END
  )
$function$;
--> statement-breakpoint
-- 2. Joining or browsing a project's channels needs a live project.
CREATE OR REPLACE FUNCTION app_private.chat_is_project_member(p_project_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.project_members pm
    JOIN public.projects p ON p.id = pm.project_id AND p.deleted_at IS NULL
    WHERE pm.project_id = p_project_id AND pm.user_id = p_user_id
  )
$$;
--> statement-breakpoint
-- 3. Soft-deleting a project removes its chat, as a hard delete already does (channels cascade to
-- members, messages and mentions).
CREATE OR REPLACE FUNCTION app_private.drop_chat_of_deleted_project()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.chat_channels WHERE project_id = NEW.id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.drop_chat_of_deleted_project() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS projects_drop_chat_on_soft_delete ON public.projects;
--> statement-breakpoint
CREATE TRIGGER projects_drop_chat_on_soft_delete
AFTER UPDATE OF deleted_at ON public.projects
FOR EACH ROW
WHEN (OLD.deleted_at IS NULL AND NEW.deleted_at IS NOT NULL)
EXECUTE FUNCTION app_private.drop_chat_of_deleted_project();
--> statement-breakpoint
-- 4. Clean what earlier versions of project delete left behind.
DELETE FROM public.chat_channels
WHERE project_id IN (SELECT id FROM public.projects WHERE deleted_at IS NOT NULL);
