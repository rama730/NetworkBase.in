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
