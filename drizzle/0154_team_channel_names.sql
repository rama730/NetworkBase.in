-- Team channels (2026-11-26): a team's main channel inside an organization is named for the team's title
-- ("team-falcon-hash-table-library"), not its slug with the random ending ("…-oxao5"). Renames the existing ones;
-- mentions and links use the channel's id, so nothing that points at them changes.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_default_channel_name(p_project_id uuid) RETURNS text
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT CASE
    WHEN p.parent_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.workspaces o WHERE o.id = p.parent_id AND o.kind = 'organization')
      THEN coalesce(nullif(left(trim(both '-' FROM regexp_replace(lower(p.title), '[^a-z0-9]+', '-', 'g')), 80), ''), 'general')
    ELSE 'general'
  END
  FROM public.workspaces p WHERE p.id = p_project_id
$$;
--> statement-breakpoint
UPDATE public.chat_channels c
SET name = app_private.chat_default_channel_name(c.workspace_id)
FROM public.workspaces p
JOIN public.workspaces o ON o.id = p.parent_id AND o.kind = 'organization'
WHERE c.workspace_id = p.id AND c.is_default
  AND c.name IS DISTINCT FROM app_private.chat_default_channel_name(c.workspace_id)
  AND NOT EXISTS (
    SELECT 1 FROM public.chat_channels x
    WHERE x.workspace_id = c.workspace_id AND x.id <> c.id AND lower(x.name) = app_private.chat_default_channel_name(c.workspace_id)
  );
