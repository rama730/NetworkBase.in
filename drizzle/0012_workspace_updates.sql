-- Workspace updates, comments, likes, drafts, media, live update events.
SET LOCAL check_function_bodies = off;
--> statement-breakpoint
SELECT pg_catalog.set_config('search_path', '', true);
--> statement-breakpoint
CREATE FUNCTION app_private.nb_update_audience_ok(p_project_id uuid, p_author_id uuid, p_audience jsonb) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p_audience IS NULL OR p_audience = '{}'::jsonb
    OR p_author_id = (SELECT auth.uid())
    OR EXISTS (SELECT 1 FROM public.workspaces p WHERE p.id = p_project_id AND p.owner_id = (SELECT auth.uid()))
    OR EXISTS (
      SELECT 1 FROM public.workspace_members pm
      WHERE pm.workspace_id = p_project_id AND pm.user_id = (SELECT auth.uid())
        AND (pm.role = 'admin' OR p_audience->'roles' @> to_jsonb(pm.role))
    )
    OR (p_audience->'projectIds' IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.workspace_members cm
      WHERE cm.user_id = (SELECT auth.uid())
        AND cm.workspace_id::text IN (SELECT jsonb_array_elements_text(p_audience->'projectIds'))
    ));
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_update_topic_readable(p_topic text) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $_$
  SELECT CASE
    WHEN p_topic ~ '^updates:workspace:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      app_private.nb_workspace_tab_visible(split_part(p_topic, ':', 3)::uuid, 'updates')
    WHEN p_topic ~ '^updates:members:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN
      app_private.nb_workspace_tab_visible(split_part(p_topic, ':', 3)::uuid, 'updates')
      AND (app_private.nb_workspace_can_write(split_part(p_topic, ':', 3)::uuid)
        OR EXISTS (SELECT 1 FROM public.workspace_members pm WHERE pm.workspace_id = split_part(p_topic, ':', 3)::uuid AND pm.user_id = (SELECT auth.uid())))
    WHEN p_topic ~ '^updates:post:[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' THEN EXISTS (
      SELECT 1 FROM public.workspace_updates u
      WHERE u.id = split_part(p_topic, ':', 3)::uuid
        AND app_private.nb_workspace_tab_visible(u.workspace_id, 'updates')
        AND (u.visibility = 'public' OR app_private.nb_workspace_can_write(u.workspace_id)
          OR EXISTS (SELECT 1 FROM public.workspace_members pm WHERE pm.workspace_id = u.workspace_id AND pm.user_id = (SELECT auth.uid())))
        AND app_private.nb_update_audience_ok(u.workspace_id, u.author_id, u.audience))
    ELSE false
  END
$_$;
--> statement-breakpoint
CREATE FUNCTION app_private.nb_workspace_update_pin_limit() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
DECLARE
  v_kind text;
  v_live integer;
  v_limit integer;
BEGIN
  IF NOT NEW.is_pinned OR NEW.deleted_at IS NOT NULL OR (NEW.pinned_until IS NOT NULL AND NEW.pinned_until <= now()) THEN
    RETURN NEW;
  END IF;
  SELECT kind INTO v_kind FROM public.workspaces WHERE id = NEW.workspace_id FOR UPDATE;
  SELECT count(*) INTO v_live
  FROM public.workspace_updates u
  WHERE u.workspace_id = NEW.workspace_id AND u.id <> NEW.id AND u.is_pinned AND u.deleted_at IS NULL
    AND (u.pinned_until IS NULL OR u.pinned_until > now());
  v_limit := CASE WHEN v_kind = 'organization' THEN 3 ELSE 1 END;
  IF v_live >= v_limit THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'project_update_pin_limit';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.update_activity_seq() RETURNS trigger
    LANGUAGE plpgsql
    SET search_path TO ''
    AS $$
BEGIN
  IF (NEW.like_count, NEW.comment_count, NEW.content, NEW.is_pinned, NEW.pinned_until, NEW.visibility, NEW.audience, NEW.deleted_at)
     IS DISTINCT FROM (OLD.like_count, OLD.comment_count, OLD.content, OLD.is_pinned, OLD.pinned_until, OLD.visibility, OLD.audience, OLD.deleted_at) THEN
    NEW.activity_seq := OLD.activity_seq + 1;
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.update_comment_event_row() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM app_private.update_event_send(OLD.workspace_id, OLD.update_id, 'comment.removed', jsonb_build_object('updateId', OLD.update_id, 'commentId', OLD.id));
  ELSIF TG_OP = 'INSERT' THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.update_id, 'comment.created',
      jsonb_build_object('updateId', NEW.update_id, 'commentId', NEW.id, 'parentId', NEW.parent_id));
  ELSIF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.update_id, 'comment.removed', jsonb_build_object('updateId', NEW.update_id, 'commentId', NEW.id));
  ELSIF (NEW.content, NEW.deleted_at) IS DISTINCT FROM (OLD.content, OLD.deleted_at) THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.update_id, 'comment.changed', jsonb_build_object('updateId', NEW.update_id, 'commentId', NEW.id));
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.update_event_row() RETURNS trigger
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM app_private.update_event_send(OLD.workspace_id, OLD.id, 'update.removed', jsonb_build_object('id', OLD.id));
    RETURN NULL;
  END IF;
  IF TG_OP = 'INSERT' THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.id, 'update.created', jsonb_build_object('id', NEW.id, 'seq', NEW.activity_seq));
    RETURN NULL;
  END IF;
  IF NEW.activity_seq = OLD.activity_seq THEN RETURN NULL; END IF;
  IF (NEW.visibility, NEW.audience) IS DISTINCT FROM (OLD.visibility, OLD.audience)
     AND OLD.visibility = 'public' AND OLD.audience = '{}'::jsonb AND to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NOT NULL THEN
    BEGIN
      PERFORM realtime.send(jsonb_build_object('id', NEW.id, 'seq', NEW.activity_seq), 'update.changed', 'updates:workspace:' || NEW.workspace_id::text, true);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;
  IF NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.id, 'update.removed', jsonb_build_object('id', NEW.id, 'seq', NEW.activity_seq));
    RETURN NULL;
  END IF;
  IF NEW.like_count IS DISTINCT FROM OLD.like_count OR NEW.comment_count IS DISTINCT FROM OLD.comment_count THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.id, 'update.counts',
      jsonb_build_object('id', NEW.id, 'likes', NEW.like_count, 'comments', NEW.comment_count, 'seq', NEW.activity_seq));
  END IF;
  IF (NEW.content, NEW.is_pinned, NEW.pinned_until, NEW.visibility, NEW.audience, NEW.deleted_at)
     IS DISTINCT FROM (OLD.content, OLD.is_pinned, OLD.pinned_until, OLD.visibility, OLD.audience, OLD.deleted_at) THEN
    PERFORM app_private.update_event_send(NEW.workspace_id, NEW.id, 'update.changed', jsonb_build_object('id', NEW.id, 'seq', NEW.activity_seq));
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE FUNCTION app_private.update_event_send(p_workspace uuid, p_update uuid, p_event text, p_payload jsonb) RETURNS void
    LANGUAGE plpgsql SECURITY DEFINER
    SET search_path TO ''
    AS $$
DECLARE
  v_visibility text;
  v_audience jsonb;
BEGIN
  IF to_regprocedure('realtime.send(jsonb,text,text,boolean)') IS NULL THEN RETURN; END IF;
  -- An announcement must never fail the like or comment that caused it.
  BEGIN
    SELECT u.visibility, u.audience INTO v_visibility, v_audience FROM public.workspace_updates u WHERE u.id = p_update;
    PERFORM realtime.send(p_payload, p_event, 'updates:post:' || p_update::text, true);
    IF coalesce(v_audience, '{}'::jsonb) = '{}'::jsonb THEN
      IF v_visibility = 'public' THEN
        PERFORM realtime.send(p_payload, p_event, 'updates:workspace:' || p_workspace::text, true);
      ELSIF v_visibility IS NOT NULL THEN
        PERFORM realtime.send(p_payload, p_event, 'updates:members:' || p_workspace::text, true);
      END IF;
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END
$$;
--> statement-breakpoint
CREATE TABLE public.workspace_update_comments (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    update_id uuid NOT NULL,
    workspace_id uuid NOT NULL,
    user_id uuid,
    content text NOT NULL,
    deleted_by uuid,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_id uuid,
    target_user_id uuid,
    CONSTRAINT workspace_update_comments_no_self_parent_check CHECK (((parent_id IS NULL) OR (parent_id <> id)))
);
--> statement-breakpoint
CREATE TABLE public.workspace_update_draft_media_assets (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    ordinal integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_update_draft_media_assets_ordinal_check CHECK ((ordinal >= 0))
);
--> statement-breakpoint
CREATE TABLE public.workspace_update_drafts (
    workspace_id uuid NOT NULL,
    user_id uuid NOT NULL,
    content text DEFAULT ''::text NOT NULL,
    visibility text DEFAULT 'public'::text NOT NULL,
    update_type text,
    entity_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    media jsonb DEFAULT '[]'::jsonb NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.workspace_update_likes (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    update_id uuid NOT NULL,
    user_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE public.workspace_update_media_assets (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    update_id uuid NOT NULL,
    asset_id uuid NOT NULL,
    ordinal integer NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT workspace_update_media_assets_ordinal_check CHECK ((ordinal >= 0))
);
--> statement-breakpoint
CREATE TABLE public.workspace_updates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    workspace_id uuid NOT NULL,
    author_id uuid,
    content text NOT NULL,
    update_type text,
    visibility text DEFAULT 'public'::text NOT NULL,
    reply_policy text DEFAULT 'logged_in'::text NOT NULL,
    entity_refs jsonb DEFAULT '{}'::jsonb NOT NULL,
    media jsonb DEFAULT '[]'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb NOT NULL,
    is_pinned boolean DEFAULT false NOT NULL,
    like_count integer DEFAULT 0 NOT NULL,
    comment_count integer DEFAULT 0 NOT NULL,
    deleted_by uuid,
    edited_at timestamp with time zone,
    deleted_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    audience jsonb DEFAULT '{}'::jsonb NOT NULL,
    notify_level text DEFAULT 'in_app'::text NOT NULL,
    pinned_until timestamp with time zone,
    shared_to_org_at timestamp with time zone,
    activity_seq bigint DEFAULT 0 NOT NULL,
    CONSTRAINT workspace_updates_comment_count_nonnegative CHECK ((comment_count >= 0)),
    CONSTRAINT workspace_updates_like_count_nonnegative CHECK ((like_count >= 0)),
    CONSTRAINT workspace_updates_notify_level_check CHECK ((notify_level = ANY (ARRAY['in_app'::text, 'email'::text]))),
    CONSTRAINT workspace_updates_reply_policy_check CHECK ((reply_policy = ANY (ARRAY['logged_in'::text, 'members'::text, 'closed'::text]))),
    CONSTRAINT workspace_updates_update_type_check CHECK (((update_type IS NULL) OR (update_type = ANY (ARRAY['progress'::text, 'milestone'::text, 'release'::text, 'blocker'::text, 'decision'::text, 'collaboration_request'::text, 'behind_the_scenes'::text, 'announcement'::text, 'discussion'::text])))),
    CONSTRAINT workspace_updates_visibility_check CHECK ((visibility = ANY (ARRAY['public'::text, 'members'::text])))
);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_comments
    ADD CONSTRAINT workspace_update_comments_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_draft_media_assets
    ADD CONSTRAINT workspace_update_draft_media_assets_pkey PRIMARY KEY (workspace_id, user_id, asset_id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_drafts
    ADD CONSTRAINT workspace_update_drafts_workspace_id_user_id_pkey PRIMARY KEY (workspace_id, user_id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_likes
    ADD CONSTRAINT workspace_update_likes_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_media_assets
    ADD CONSTRAINT workspace_update_media_assets_pkey PRIMARY KEY (id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_updates
    ADD CONSTRAINT workspace_updates_pkey PRIMARY KEY (id);
--> statement-breakpoint
CREATE UNIQUE INDEX project_update_comments_update_id_id_key ON public.workspace_update_comments USING btree (update_id, id);
--> statement-breakpoint
CREATE UNIQUE INDEX project_updates_project_id_id_key ON public.workspace_updates USING btree (workspace_id, id);
--> statement-breakpoint
CREATE INDEX workspace_update_comments_active_parent_idx ON public.workspace_update_comments USING btree (update_id, parent_id, created_at DESC) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX workspace_update_comments_deleted_by_idx ON public.workspace_update_comments USING btree (deleted_by);
--> statement-breakpoint
CREATE INDEX workspace_update_comments_parent_idx ON public.workspace_update_comments USING btree (parent_id, update_id) WHERE (parent_id IS NOT NULL);
--> statement-breakpoint
CREATE INDEX workspace_update_comments_target_user_idx ON public.workspace_update_comments USING btree (target_user_id);
--> statement-breakpoint
CREATE INDEX workspace_update_comments_update_active_idx ON public.workspace_update_comments USING btree (update_id, created_at) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX workspace_update_comments_update_created_idx ON public.workspace_update_comments USING btree (update_id, created_at, id);
--> statement-breakpoint
CREATE INDEX workspace_update_comments_user_created_idx ON public.workspace_update_comments USING btree (user_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX workspace_update_comments_workspace_created_idx ON public.workspace_update_comments USING btree (workspace_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX workspace_update_draft_media_assets_asset_idx ON public.workspace_update_draft_media_assets USING btree (asset_id);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_update_draft_media_assets_ordinal_unique ON public.workspace_update_draft_media_assets USING btree (workspace_id, user_id, ordinal);
--> statement-breakpoint
CREATE INDEX workspace_update_drafts_updated_at_idx ON public.workspace_update_drafts USING btree (updated_at);
--> statement-breakpoint
CREATE INDEX workspace_update_drafts_user_idx ON public.workspace_update_drafts USING btree (user_id);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_update_likes_unique ON public.workspace_update_likes USING btree (update_id, user_id);
--> statement-breakpoint
CREATE INDEX workspace_update_likes_update_idx ON public.workspace_update_likes USING btree (update_id);
--> statement-breakpoint
CREATE INDEX workspace_update_likes_user_idx ON public.workspace_update_likes USING btree (user_id);
--> statement-breakpoint
CREATE INDEX workspace_update_media_assets_asset_idx ON public.workspace_update_media_assets USING btree (asset_id);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_update_media_assets_update_asset_unique ON public.workspace_update_media_assets USING btree (update_id, asset_id);
--> statement-breakpoint
CREATE UNIQUE INDEX workspace_update_media_assets_update_ordinal_unique ON public.workspace_update_media_assets USING btree (update_id, ordinal);
--> statement-breakpoint
CREATE INDEX workspace_updates_author_created_idx ON public.workspace_updates USING btree (author_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX workspace_updates_deleted_at_idx ON public.workspace_updates USING btree (deleted_at);
--> statement-breakpoint
CREATE INDEX workspace_updates_deleted_by_idx ON public.workspace_updates USING btree (deleted_by);
--> statement-breakpoint
CREATE INDEX workspace_updates_discover_feed_idx ON public.workspace_updates USING btree (created_at DESC, id DESC) WHERE ((deleted_at IS NULL) AND (visibility = 'public'::text));
--> statement-breakpoint
CREATE INDEX workspace_updates_member_feed_idx ON public.workspace_updates USING btree (workspace_id, is_pinned DESC, created_at DESC, id DESC) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX workspace_updates_public_feed_idx ON public.workspace_updates USING btree (workspace_id, visibility, is_pinned, created_at DESC, id DESC) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX workspace_updates_shared_idx ON public.workspace_updates USING btree (shared_to_org_at DESC, id DESC) WHERE ((shared_to_org_at IS NOT NULL) AND (deleted_at IS NULL));
--> statement-breakpoint
CREATE INDEX workspace_updates_workspace_created_active_idx ON public.workspace_updates USING btree (workspace_id, created_at DESC, id DESC) WHERE (deleted_at IS NULL);
--> statement-breakpoint
CREATE INDEX workspace_updates_workspace_pinned_created_idx ON public.workspace_updates USING btree (workspace_id, is_pinned, created_at DESC, id DESC);
--> statement-breakpoint
CREATE TRIGGER workspace_update_comments_event AFTER INSERT OR DELETE OR UPDATE ON public.workspace_update_comments FOR EACH ROW EXECUTE FUNCTION app_private.update_comment_event_row();
--> statement-breakpoint
CREATE TRIGGER workspace_update_comments_read_only_guard BEFORE INSERT ON public.workspace_update_comments FOR EACH ROW EXECUTE FUNCTION app_private.nb_workspace_read_only_guard();
--> statement-breakpoint
CREATE TRIGGER workspace_updates_activity_seq BEFORE UPDATE ON public.workspace_updates FOR EACH ROW EXECUTE FUNCTION app_private.update_activity_seq();
--> statement-breakpoint
CREATE TRIGGER workspace_updates_event AFTER INSERT OR DELETE OR UPDATE ON public.workspace_updates FOR EACH ROW EXECUTE FUNCTION app_private.update_event_row();
--> statement-breakpoint
CREATE TRIGGER workspace_updates_pin_limit BEFORE INSERT OR UPDATE OF is_pinned, pinned_until, deleted_at ON public.workspace_updates FOR EACH ROW EXECUTE FUNCTION app_private.nb_workspace_update_pin_limit();
--> statement-breakpoint
CREATE TRIGGER workspace_updates_read_only_guard BEFORE INSERT ON public.workspace_updates FOR EACH ROW EXECUTE FUNCTION app_private.nb_workspace_read_only_guard();
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_comments
    ADD CONSTRAINT workspace_update_comments_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_comments
    ADD CONSTRAINT workspace_update_comments_target_user_id_profiles_id_fk FOREIGN KEY (target_user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_comments
    ADD CONSTRAINT workspace_update_comments_update_id_parent_id_fkey FOREIGN KEY (update_id, parent_id) REFERENCES public.workspace_update_comments(update_id, id) ON DELETE SET NULL (parent_id);
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_comments
    ADD CONSTRAINT workspace_update_comments_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_comments
    ADD CONSTRAINT workspace_update_comments_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_comments
    ADD CONSTRAINT workspace_update_comments_workspace_id_update_id_fkey FOREIGN KEY (workspace_id, update_id) REFERENCES public.workspace_updates(workspace_id, id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_draft_media_assets
    ADD CONSTRAINT workspace_update_draft_media_assets_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.storage_assets(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_draft_media_assets
    ADD CONSTRAINT workspace_update_draft_media_assets_workspace_id_user_id_fkey FOREIGN KEY (workspace_id, user_id) REFERENCES public.workspace_update_drafts(workspace_id, user_id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_drafts
    ADD CONSTRAINT workspace_update_drafts_user_id_profiles_id_fk FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_drafts
    ADD CONSTRAINT workspace_update_drafts_workspace_id_workspaces_id_fk FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_likes
    ADD CONSTRAINT workspace_update_likes_update_id_fkey FOREIGN KEY (update_id) REFERENCES public.workspace_updates(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_likes
    ADD CONSTRAINT workspace_update_likes_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.profiles(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_media_assets
    ADD CONSTRAINT workspace_update_media_assets_asset_id_fkey FOREIGN KEY (asset_id) REFERENCES public.storage_assets(id) ON DELETE RESTRICT;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_update_media_assets
    ADD CONSTRAINT workspace_update_media_assets_update_id_fkey FOREIGN KEY (update_id) REFERENCES public.workspace_updates(id) ON DELETE CASCADE;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_updates
    ADD CONSTRAINT workspace_updates_author_id_fkey FOREIGN KEY (author_id) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_updates
    ADD CONSTRAINT workspace_updates_deleted_by_fkey FOREIGN KEY (deleted_by) REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE ONLY public.workspace_updates
    ADD CONSTRAINT workspace_updates_workspace_id_fkey FOREIGN KEY (workspace_id) REFERENCES public.workspaces(id) ON DELETE CASCADE;
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_update_comments TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_update_draft_media_assets TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_update_drafts TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_update_likes TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_update_media_assets TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
CREATE POLICY nb_app_all ON public.workspace_updates TO nb_app USING (true) WITH CHECK (true);
--> statement-breakpoint
ALTER TABLE public.workspace_update_comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_update_comments_insert_visible ON public.workspace_update_comments FOR INSERT WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM (public.workspace_updates u
     JOIN public.workspaces p ON ((p.id = u.workspace_id)))
  WHERE ((u.id = workspace_update_comments.update_id) AND (u.workspace_id = workspace_update_comments.workspace_id) AND (u.deleted_at IS NULL) AND (p.deleted_at IS NULL) AND ((p.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM public.workspace_members m
          WHERE ((m.workspace_id = p.id) AND (m.user_id = ( SELECT auth.uid() AS uid))))) OR ((p.visibility = 'public'::text) AND (u.visibility = 'public'::text) AND (u.reply_policy = 'logged_in'::text) AND ((COALESCE(p.public_tab_visibility, '{}'::jsonb) ->> 'updates'::text) IS DISTINCT FROM 'false'::text))))))));
--> statement-breakpoint
CREATE POLICY workspace_update_comments_read ON public.workspace_update_comments FOR SELECT TO authenticated, anon USING ((((deleted_at IS NULL) OR (user_id = ( SELECT auth.uid() AS uid))) AND (EXISTS ( SELECT 1
   FROM public.workspace_updates u
  WHERE (u.id = workspace_update_comments.update_id)))));
--> statement-breakpoint
CREATE POLICY workspace_update_comments_update_author_or_workspace_admin ON public.workspace_update_comments FOR UPDATE USING (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.workspaces p
  WHERE ((p.id = workspace_update_comments.workspace_id) AND (p.deleted_at IS NULL) AND ((p.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM public.workspace_members m
          WHERE ((m.workspace_id = p.id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))))))) WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.workspaces p
  WHERE ((p.id = workspace_update_comments.workspace_id) AND (p.deleted_at IS NULL) AND ((p.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM public.workspace_members m
          WHERE ((m.workspace_id = p.id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))))))));
--> statement-breakpoint
ALTER TABLE public.workspace_update_draft_media_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workspace_update_drafts ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_update_drafts_all_workspace_member ON public.workspace_update_drafts USING (((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1
   FROM public.workspaces p
  WHERE ((p.id = workspace_update_drafts.workspace_id) AND (p.deleted_at IS NULL) AND ((p.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM public.workspace_members pm
          WHERE ((pm.workspace_id = p.id) AND (pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text]))))))))))) WITH CHECK (((( SELECT auth.uid() AS uid) = user_id) AND (EXISTS ( SELECT 1
   FROM public.workspaces p
  WHERE ((p.id = workspace_update_drafts.workspace_id) AND (p.deleted_at IS NULL) AND ((p.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM public.workspace_members pm
          WHERE ((pm.workspace_id = p.id) AND (pm.user_id = ( SELECT auth.uid() AS uid)) AND (pm.role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))))))))));
--> statement-breakpoint
ALTER TABLE public.workspace_update_likes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_update_likes_delete_own ON public.workspace_update_likes FOR DELETE USING ((user_id = ( SELECT auth.uid() AS uid)));
--> statement-breakpoint
CREATE POLICY workspace_update_likes_insert_visible ON public.workspace_update_likes FOR INSERT WITH CHECK (((user_id = ( SELECT auth.uid() AS uid)) AND (EXISTS ( SELECT 1
   FROM (public.workspace_updates u
     JOIN public.workspaces p ON ((p.id = u.workspace_id)))
  WHERE ((u.id = workspace_update_likes.update_id) AND (u.deleted_at IS NULL) AND (p.deleted_at IS NULL) AND ((p.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM public.workspace_members m
          WHERE ((m.workspace_id = p.id) AND (m.user_id = ( SELECT auth.uid() AS uid))))) OR ((p.visibility = 'public'::text) AND (u.visibility = 'public'::text) AND ((COALESCE(p.public_tab_visibility, '{}'::jsonb) ->> 'updates'::text) IS DISTINCT FROM 'false'::text))))))));
--> statement-breakpoint
CREATE POLICY workspace_update_likes_select_visible ON public.workspace_update_likes FOR SELECT USING ((EXISTS ( SELECT 1
   FROM (public.workspace_updates u
     JOIN public.workspaces p ON ((p.id = u.workspace_id)))
  WHERE ((u.id = workspace_update_likes.update_id) AND (u.deleted_at IS NULL) AND (p.deleted_at IS NULL) AND ((p.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM public.workspace_members m
          WHERE ((m.workspace_id = p.id) AND (m.user_id = ( SELECT auth.uid() AS uid))))) OR ((p.visibility = 'public'::text) AND (u.visibility = 'public'::text) AND ((COALESCE(p.public_tab_visibility, '{}'::jsonb) ->> 'updates'::text) IS DISTINCT FROM 'false'::text)))))));
--> statement-breakpoint
ALTER TABLE public.workspace_update_media_assets ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.workspace_updates ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY workspace_updates_insert_workspace_member ON public.workspace_updates FOR INSERT WITH CHECK (((author_id = ( SELECT auth.uid() AS uid)) AND (deleted_at IS NULL) AND (EXISTS ( SELECT 1
   FROM public.workspaces p
  WHERE ((p.id = workspace_updates.workspace_id) AND (p.deleted_at IS NULL) AND ((p.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM public.workspace_members m
          WHERE ((m.workspace_id = p.id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text, 'member'::text])))))))))));
--> statement-breakpoint
CREATE POLICY workspace_updates_read ON public.workspace_updates FOR SELECT TO authenticated, anon USING ((((deleted_at IS NULL) OR (author_id = ( SELECT auth.uid() AS uid))) AND app_private.nb_workspace_tab_visible(workspace_id, 'updates'::text) AND ((visibility = 'public'::text) OR app_private.nb_workspace_can_write(workspace_id) OR (EXISTS ( SELECT 1
   FROM public.workspace_members pm
  WHERE ((pm.workspace_id = workspace_updates.workspace_id) AND (pm.user_id = ( SELECT auth.uid() AS uid)))))) AND app_private.nb_update_audience_ok(workspace_id, author_id, audience)));
--> statement-breakpoint
CREATE POLICY workspace_updates_update_author_or_workspace_admin ON public.workspace_updates FOR UPDATE USING (((author_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.workspaces p
  WHERE ((p.id = workspace_updates.workspace_id) AND (p.deleted_at IS NULL) AND ((p.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM public.workspace_members m
          WHERE ((m.workspace_id = p.id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text]))))))))))) WITH CHECK (((author_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
   FROM public.workspaces p
  WHERE ((p.id = workspace_updates.workspace_id) AND (p.deleted_at IS NULL) AND ((p.owner_id = ( SELECT auth.uid() AS uid)) OR (EXISTS ( SELECT 1
           FROM public.workspace_members m
          WHERE ((m.workspace_id = p.id) AND (m.user_id = ( SELECT auth.uid() AS uid)) AND (m.role = ANY (ARRAY['owner'::text, 'admin'::text])))))))))));
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_update_audience_ok(p_project_id uuid, p_author_id uuid, p_audience jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_update_audience_ok(p_project_id uuid, p_author_id uuid, p_audience jsonb) TO anon;
GRANT ALL ON FUNCTION app_private.nb_update_audience_ok(p_project_id uuid, p_author_id uuid, p_audience jsonb) TO authenticated;
GRANT ALL ON FUNCTION app_private.nb_update_audience_ok(p_project_id uuid, p_author_id uuid, p_audience jsonb) TO service_role;
GRANT ALL ON FUNCTION app_private.nb_update_audience_ok(p_project_id uuid, p_author_id uuid, p_audience jsonb) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.nb_update_topic_readable(p_topic text) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.nb_update_topic_readable(p_topic text) TO nb_app;
GRANT ALL ON FUNCTION app_private.nb_update_topic_readable(p_topic text) TO authenticated;
--> statement-breakpoint
GRANT ALL ON FUNCTION app_private.nb_workspace_update_pin_limit() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.update_activity_seq() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.update_activity_seq() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.update_comment_event_row() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.update_comment_event_row() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.update_event_row() FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.update_event_row() TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.update_event_send(p_workspace uuid, p_update uuid, p_event text, p_payload jsonb) FROM PUBLIC;
GRANT ALL ON FUNCTION app_private.update_event_send(p_workspace uuid, p_update uuid, p_event text, p_payload jsonb) TO nb_app;
--> statement-breakpoint
GRANT SELECT,MAINTAIN ON TABLE public.workspace_update_comments TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.workspace_update_comments TO authenticated;
GRANT ALL ON TABLE public.workspace_update_comments TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_update_comments TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_update_draft_media_assets TO anon;
GRANT MAINTAIN ON TABLE public.workspace_update_draft_media_assets TO authenticated;
GRANT ALL ON TABLE public.workspace_update_draft_media_assets TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_update_draft_media_assets TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_update_drafts TO anon;
GRANT MAINTAIN ON TABLE public.workspace_update_drafts TO authenticated;
GRANT ALL ON TABLE public.workspace_update_drafts TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_update_drafts TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_update_likes TO anon;
GRANT MAINTAIN ON TABLE public.workspace_update_likes TO authenticated;
GRANT ALL ON TABLE public.workspace_update_likes TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_update_likes TO nb_app;
--> statement-breakpoint
GRANT MAINTAIN ON TABLE public.workspace_update_media_assets TO anon;
GRANT MAINTAIN ON TABLE public.workspace_update_media_assets TO authenticated;
GRANT ALL ON TABLE public.workspace_update_media_assets TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_update_media_assets TO nb_app;
--> statement-breakpoint
GRANT SELECT,MAINTAIN ON TABLE public.workspace_updates TO anon;
GRANT SELECT,MAINTAIN ON TABLE public.workspace_updates TO authenticated;
GRANT ALL ON TABLE public.workspace_updates TO service_role;
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE public.workspace_updates TO nb_app;
--> statement-breakpoint
CREATE POLICY update_topics_read ON realtime.messages AS PERMISSIVE FOR SELECT TO authenticated USING (((extension = 'broadcast'::text) AND (( SELECT realtime.topic() AS topic) ~~ 'updates:%'::text) AND ( SELECT app_private.nb_update_topic_readable(( SELECT realtime.topic() AS topic)) AS nb_update_topic_readable)));
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_update_comments;
--> statement-breakpoint
ALTER PUBLICATION supabase_realtime ADD TABLE public.workspace_updates;
