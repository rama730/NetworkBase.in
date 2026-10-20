-- Application threads, second pass: the cover letter follows the application (edit, reapply, legacy rows), the card
-- message and the member roles are protected, and the sidebar preview of a decision names who made it.

-- 1. The cover letter is the first message of the thread. When the application's text changes, that message follows.
CREATE OR REPLACE FUNCTION app_private.chat_sync_application_letter(p_application_id uuid)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_message record;
  v_body text;
BEGIN
  SELECT left(coalesce(a.message, ''), 4000) INTO v_body FROM public.role_applications a WHERE a.id = p_application_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;
  UPDATE public.chat_messages m SET body = v_body, edited_at = now()
  FROM public.chat_channels c
  WHERE c.application_id = p_application_id AND m.channel_id = c.id
    AND m.client_message_id = 'application:' || p_application_id AND m.kind = 'user' AND m.deleted_at IS NULL
    AND m.body IS DISTINCT FROM v_body
  RETURNING m.channel_id, m.channel_seq, m.body, m.edited_at INTO v_message;
  IF v_message.channel_id IS NULL THEN
    RETURN;
  END IF;
  UPDATE public.chat_channels SET last_preview = left(regexp_replace(btrim(v_body), '\s+', ' ', 'g'), 120)
  WHERE id = v_message.channel_id AND last_top_seq = v_message.channel_seq;
  PERFORM realtime.send(
    jsonb_build_object('seq', v_message.channel_seq, 'body', v_message.body, 'edited_at', v_message.edited_at),
    'message.edit',
    'chat:channel:' || v_message.channel_id,
    true
  );
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_sync_application_letter(uuid) FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION app_private.chat_application_letter_changed()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM app_private.chat_sync_application_letter(NEW.id);
  RETURN NULL;
END
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.chat_application_letter_changed() FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
DROP TRIGGER IF EXISTS chat_application_letter_changed ON public.role_applications;
--> statement-breakpoint
CREATE TRIGGER chat_application_letter_changed
AFTER UPDATE OF message ON public.role_applications
FOR EACH ROW WHEN (OLD.message IS DISTINCT FROM NEW.message)
EXECUTE FUNCTION app_private.chat_application_letter_changed();
--> statement-breakpoint

-- 2. Old applications carried their portfolio link and availability inside the message ("Portfolio / GitHub: ...").
-- Move them into details (only http(s) links: anything else stays in the text and is never rendered as a link), keep the cover letter clean (the trigger above updates each thread's first message).
UPDATE public.role_applications a
SET details = a.details || jsonb_strip_nulls(jsonb_build_object(
      'portfolioUrl', substring(a.message from '(?:^|\n)Portfolio / GitHub: (https?://\S+)'),
      'availability', nullif(btrim(substring(a.message from '(?:^|\n)Availability: ([^\n]*)')), ''))),
    message = coalesce(nullif(btrim(regexp_replace(regexp_replace(a.message, '\n*Portfolio / GitHub: https?://\S+', '', 'g'), '\n*Availability: [^\n]*', '', 'g')), ''), a.message)
WHERE a.details = '{}'::jsonb AND a.message ~ '(^|\n)(Portfolio / GitHub: https?://\S|Availability: )';
--> statement-breakpoint

-- 3. The application card message is not editable through chat; its text is the application's.
CREATE OR REPLACE FUNCTION app_private.chat_edit_message(p_channel_id uuid, p_seq bigint, p_user_id uuid, p_body text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
BEGIN
  IF p_body IS NULL OR char_length(p_body) > 4000 THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_body';
  END IF;
  IF btrim(p_body) = ''
    AND NOT EXISTS (SELECT 1 FROM public.chat_attachments a WHERE a.channel_id = p_channel_id AND a.message_seq = p_seq)
    AND NOT EXISTS (SELECT 1 FROM public.chat_message_cards k WHERE k.channel_id = p_channel_id AND k.message_seq = p_seq) THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_body';
  END IF;
  -- The application card message is the application's record: its text changes only through the application itself.
  IF EXISTS (SELECT 1 FROM public.chat_message_cards k WHERE k.channel_id = p_channel_id AND k.message_seq = p_seq AND k.kind = 'application') THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_not_editable';
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
$function$;
--> statement-breakpoint

-- 4. Nobody changes member roles in an application thread (the cast is fixed): a thread admin could delete others' messages.
CREATE OR REPLACE FUNCTION app_private.chat_set_member_role(p_channel_id uuid, p_actor uuid, p_user_id uuid, p_role text)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF p_role NOT IN ('admin', 'member') THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'chat_invalid_role';
  END IF;
  IF EXISTS (SELECT 1 FROM public.chat_channels WHERE id = p_channel_id AND application_id IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'chat_application_members_fixed';
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
--> statement-breakpoint

-- 5. The preview of a decision line says who made it.
CREATE OR REPLACE FUNCTION app_private.chat_append_message(p_channel_id uuid, p_author_id uuid, p_kind text, p_body text, p_client_id text, p_thread_root bigint, p_attachments jsonb, p_card jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
DECLARE
  v_seq bigint;
  v_existing bigint;
  v_now timestamptz := now();
  -- A decision line in an application thread is news for the other side: it counts as unread and shows in the preview.
  v_top boolean := p_thread_root IS NULL AND (p_kind = 'user' OR (p_kind = 'system' AND EXISTS (
    SELECT 1 FROM public.chat_channels ac WHERE ac.id = p_channel_id AND ac.application_id IS NOT NULL)));
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
    -- A decision line in an application thread names who did it ("Ann declined this application").
    WHEN p_kind = 'system' AND v_top AND btrim(coalesce(p_body, '')) <> '' THEN left(regexp_replace(
      coalesce((SELECT coalesce(pr.full_name, pr.username) || ' ' FROM public.profiles pr WHERE pr.id = p_author_id), '') || btrim(p_body), '\s+', ' ', 'g'), 120)
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
    -- DISTINCT: replying in your own thread lists you twice, and one INSERT ... ON CONFLICT
    -- DO UPDATE can't touch the same row twice (it failed the whole send).
    FROM (SELECT DISTINCT u FROM unnest(ARRAY[p_author_id, v_root.author_id]) AS u) AS d
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
$function$;
--> statement-breakpoint

-- 6. A status line brings back a thread the other side had closed (a decline that is reopened, a late withdrawal),
-- like a new message does.
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
  UPDATE public.chat_channel_members SET archived_at = NULL
  WHERE channel_id = v_id AND user_id <> p_actor AND archived_at IS NOT NULL;
  RETURN v_id;
END
$$;
