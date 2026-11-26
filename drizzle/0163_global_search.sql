-- Global search mix (docs/superpowers/specs/2026-11-26-global-search-mix-report.md §4, §4b, §6).
-- Who can find me in search: everyone (default) / people in my workspaces and orgs / only my connections; find by email off.
ALTER TABLE public.profiles
  ADD COLUMN search_visibility text NOT NULL DEFAULT 'everyone',
  ADD COLUMN findable_by_email boolean NOT NULL DEFAULT false;
--> statement-breakpoint
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_search_visibility_check CHECK (search_visibility IN ('everyone', 'my_places', 'connections'));
--> statement-breakpoint
-- Saved searches, with new-match alerts (weekly / daily / off).
CREATE TABLE public.saved_searches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  query text NOT NULL CHECK (char_length(query) BETWEEN 1 AND 100),
  tab text NOT NULL DEFAULT 'discover' CHECK (tab IN ('discover', 'people', 'msgs', 'goto')),
  filters jsonb NOT NULL DEFAULT '{}'::jsonb,
  notify text NOT NULL DEFAULT 'weekly' CHECK (notify IN ('weekly', 'daily', 'off')),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE UNIQUE INDEX saved_searches_user_query_idx ON public.saved_searches (user_id, lower(query), tab, filters);
--> statement-breakpoint
CREATE INDEX saved_searches_alert_idx ON public.saved_searches (last_notified_at) WHERE notify <> 'off';
--> statement-breakpoint
-- What people search on the results page, for "Trending near you". Normalized words only; cleared after 30 days.
CREATE TABLE public.search_query_log (
  id bigserial PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  query text NOT NULL CHECK (char_length(query) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX search_query_log_created_idx ON public.search_query_log (created_at);
--> statement-breakpoint
CREATE INDEX search_query_log_user_idx ON public.search_query_log (user_id, created_at);
--> statement-breakpoint
ALTER TABLE public.saved_searches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.search_query_log ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.saved_searches FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.search_query_log FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.saved_searches TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON TABLE public.search_query_log TO nb_app;
--> statement-breakpoint
GRANT USAGE, SELECT ON SEQUENCE public.search_query_log_id_seq TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.saved_searches TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.search_query_log TO service_role;
--> statement-breakpoint
-- The places someone is in: each workspace or org they own or are a member of, its parent, and the school it belongs to.
CREATE FUNCTION app_private.search_places(p_user uuid) RETURNS SETOF uuid
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT DISTINCT v.place
  FROM public.workspaces w
  LEFT JOIN public.workspaces p ON p.id = w.parent_id
  CROSS JOIN LATERAL (VALUES (w.id), (w.parent_id), (w.institution_id), (p.institution_id)) AS v(place)
  WHERE w.deleted_at IS NULL AND v.place IS NOT NULL
    AND (w.owner_id = p_user OR EXISTS (SELECT 1 FROM public.workspace_members m WHERE m.workspace_id = w.id AND m.user_id = p_user))
$$;
--> statement-breakpoint
-- Can this viewer find this person in search? Blocks, private profiles, "Who can find me in search", and the minors
-- rule (plan R1: no age is stored, so plain members of a School or Coaching org or its classes are hidden from people
-- outside it). Deleted, unfinished and fixture accounts are left out by the query that calls this.
CREATE FUNCTION app_private.search_findable(p_viewer uuid, p_person uuid) RETURNS boolean
    LANGUAGE sql STABLE SECURITY DEFINER
    SET search_path TO ''
    AS $$
  SELECT p_viewer IS NOT NULL AND p_person IS NOT NULL AND p_viewer <> p_person
    AND NOT app_private.blocked_between(p_viewer, p_person)
    AND EXISTS (
      SELECT 1 FROM public.profiles pr
      WHERE pr.id = p_person AND coalesce(pr.visibility, 'public') <> 'private'
        AND (
          pr.search_visibility = 'everyone'
          OR (pr.search_visibility = 'connections' AND EXISTS (
            SELECT 1 FROM public.connections c WHERE c.status = 'accepted'
              AND ((c.requester_id = p_viewer AND c.addressee_id = p_person) OR (c.requester_id = p_person AND c.addressee_id = p_viewer))))
          OR (pr.search_visibility = 'my_places' AND EXISTS (
            SELECT 1 FROM app_private.search_places(p_person) a JOIN app_private.search_places(p_viewer) b ON a = b))
        )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.workspace_members m
      JOIN public.workspaces w ON w.id = m.workspace_id AND w.deleted_at IS NULL
      LEFT JOIN public.workspaces p ON p.id = w.parent_id
      CROSS JOIN LATERAL (VALUES (w.id), (w.parent_id), (w.institution_id), (p.institution_id)) AS v(place)
      JOIN public.workspaces s ON s.id = v.place
      WHERE m.user_id = p_person AND m.role = 'member'
        AND s.kind = 'organization' AND s.deleted_at IS NULL
        AND s.org_settings ->> 'schoolKind' IN ('school', 'coaching')
        AND s.id NOT IN (SELECT app_private.search_places(p_viewer))
    )
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.search_places(p_user uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.search_places(p_user uuid) TO nb_app;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app_private.search_findable(p_viewer uuid, p_person uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app_private.search_findable(p_viewer uuid, p_person uuid) TO nb_app;
