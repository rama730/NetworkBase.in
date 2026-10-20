-- 1. A status line in an application thread took four round trips (find the application, find the thread,
-- check the card, post). One function does it: find the thread, open it if it does not exist yet, post the line.
CREATE OR REPLACE FUNCTION app_private.chat_post_application_update(p_application_id uuid, p_actor uuid, p_body text)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_id uuid;
BEGIN
  SELECT id INTO v_id FROM public.chat_channels WHERE application_id = p_application_id;
  IF v_id IS NULL THEN
    v_id := app_private.chat_ensure_application_channel(p_application_id);
  END IF;
  PERFORM app_private.chat_post_system(v_id, p_actor, left(p_body, 4000));
  RETURN v_id;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_post_application_update(uuid, uuid, text) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
-- 2. Threads that lost their card before the delete guard existed get it back now (the guard in 0226 stops new losses;
-- status lines no longer re-check it on every post).
SELECT app_private.chat_ensure_application_channel(c.application_id)
FROM public.chat_channels c
WHERE c.application_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM public.chat_message_cards k WHERE k.channel_id = c.id AND k.kind = 'application' AND k.ref_id = c.application_id);
--> statement-breakpoint
-- 3. Three indexes on role_applications are prefixes of others and add write cost for nothing:
--   (project_id) is the prefix of the unique (project_id, applicant_id);
--   (applicant_id) is the prefix of (applicant_id, status);
--   (role_id) is the prefix of the unique (role_id, applicant_id).
-- The foreign keys keep an index through the longer ones. creator_id keeps its own index: deleting a profile
-- cascades through it.
DROP INDEX IF EXISTS public.role_applications_project_id_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS public.role_applications_applicant_id_idx;
--> statement-breakpoint
DROP INDEX IF EXISTS public.role_applications_role_id_idx;
