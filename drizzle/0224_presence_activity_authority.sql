-- AUTH-011: one rule for who may see whose activity, shared by the server projection (getPresence),
-- list reads and Realtime. Activity is visible between two people only when neither has hidden theirs
-- and neither has blocked the other; you always see your own. Realtime additionally requires a
-- relationship (shared direct chat or project). A hidden person may not publish presence at all.
-- Existing subscriptions are re-authorized by Realtime when the access token refreshes; the client also
-- leaves its presence room as soon as the preference changes.
CREATE OR REPLACE FUNCTION app_private.nb_presence_activity_visible(p_viewer uuid, p_target uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT p_viewer IS NOT NULL AND p_target IS NOT NULL AND (
    p_viewer = p_target
    OR (
      NOT EXISTS (
        SELECT 1 FROM public.connections c
        WHERE c.status = 'blocked'
          AND ((c.requester_id = p_viewer AND c.addressee_id = p_target)
            OR (c.requester_id = p_target AND c.addressee_id = p_viewer))
      )
      AND (SELECT count(*) FROM public.profiles p WHERE p.id IN (p_viewer, p_target) AND p.show_activity) = 2
    )
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_presence_activity_visible(uuid, uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_can_observe_user_presence(p_target_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT
    p_target_user_id = (SELECT auth.uid())
    OR (
      app_private.nb_presence_activity_visible((SELECT auth.uid()), p_target_user_id)
      AND (
        EXISTS (
          SELECT 1
          FROM public.chat_channel_members viewer
          JOIN public.chat_channels c ON c.id = viewer.channel_id AND (c.kind = 'dm' OR (c.kind = 'private' AND c.name IS NULL))
          JOIN public.chat_channel_members target ON target.channel_id = viewer.channel_id
          WHERE viewer.user_id = (SELECT auth.uid())
            AND target.user_id = p_target_user_id
        )
        OR EXISTS (
          SELECT 1
          FROM public.project_members viewer
          JOIN public.project_members target
            ON target.project_id = viewer.project_id
          WHERE viewer.user_id = (SELECT auth.uid())
            AND target.user_id = p_target_user_id
        )
      )
    );
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.nb_can_publish_user_presence()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce((SELECT p.show_activity FROM public.profiles p WHERE p.id = (SELECT auth.uid())), false);
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_can_publish_user_presence() FROM PUBLIC, anon;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.nb_can_publish_user_presence() TO authenticated;
--> statement-breakpoint
ALTER POLICY application_topic_send ON realtime.messages
WITH CHECK (
CASE
    WHEN (( SELECT realtime.topic() AS topic) ~ '^presence:user:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = ANY (ARRAY['presence'::text, 'broadcast'::text])) AND (split_part(( SELECT realtime.topic() AS topic), ':'::text, 3) = (( SELECT auth.uid() AS uid))::text) AND app_private.nb_can_publish_user_presence())
    WHEN (( SELECT realtime.topic() AS topic) ~ '^presence:task:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = ANY (ARRAY['presence'::text, 'broadcast'::text])) AND (EXISTS ( SELECT 1
       FROM tasks task
      WHERE (((task.id)::text = split_part(( SELECT realtime.topic() AS topic), ':'::text, 3)) AND app_private.nb_project_tab_visible(task.project_id, 'tasks'::text)))))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^project-stats:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = 'broadcast'::text) AND app_private.nb_project_can_read((split_part(( SELECT realtime.topic() AS topic), ':'::text, 2))::uuid))
    WHEN (( SELECT realtime.topic() AS topic) ~ '^chat:channel:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN false
    WHEN (( SELECT realtime.topic() AS topic) ~ '^chat:typing:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-5][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$'::text) THEN ((extension = 'broadcast'::text) AND app_private.chat_is_member((split_part(( SELECT realtime.topic() AS topic), ':'::text, 3))::uuid, ( SELECT auth.uid() AS uid)))
    ELSE false
END
);
