-- DB-005: derived values follow every transition.
-- A cleared profile field removes the key from Auth metadata (other keys kept).
CREATE OR REPLACE FUNCTION public.sync_profile_to_auth_user_metadata()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_fields jsonb := jsonb_build_object('avatar_url', NEW.avatar_url, 'full_name', NEW.full_name, 'username', NEW.username);
BEGIN
  UPDATE auth.users
  SET raw_user_meta_data =
    (coalesce(raw_user_meta_data, '{}'::jsonb)
      - ARRAY(SELECT key FROM jsonb_each(v_fields) WHERE value = 'null'::jsonb))
    || jsonb_strip_nulls(v_fields)
  WHERE id = NEW.id;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
-- Moving a role to another project recounts both projects.
CREATE OR REPLACE FUNCTION public.sync_project_open_roles_count()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  UPDATE public.projects p
  SET open_roles_count = (
    SELECT count(*) FROM public.project_open_roles r WHERE r.project_id = p.id AND r.filled < r.count
  )
  WHERE p.id IN (
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.project_id END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.project_id END
  );
  RETURN NULL;
END;
$$;
