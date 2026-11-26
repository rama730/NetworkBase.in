-- Plan B6.4 (report 35.4, R3): a research lab's Library. Lab sources are literature_sources rows whose workspace is the
-- lab (W5's record moved up to the lab); a thesis row can point at the lab's source (no copies) and carries a
-- systematic review's screening state. Lab notes are shared and signed; reading states and private notes belong to one
-- person and are never read by anyone else; themes carry a people-set Disagrees mark. Server only.

ALTER TABLE public.literature_sources
    ADD COLUMN venue text,
    ADD COLUMN code_available boolean,
    ADD COLUMN data_available boolean,
    ADD COLUMN lab_source_id uuid REFERENCES public.literature_sources(id) ON DELETE SET NULL,
    ADD COLUMN screening text,
    ADD COLUMN exclude_reason text,
    ADD CONSTRAINT literature_sources_venue_length CHECK (venue IS NULL OR char_length(venue) <= 200),
    ADD CONSTRAINT literature_sources_screening CHECK (screening IS NULL OR screening IN ('found', 'screened', 'included', 'excluded')),
    ADD CONSTRAINT literature_sources_exclude_reason CHECK (exclude_reason IS NULL OR char_length(exclude_reason) <= 300);
--> statement-breakpoint
CREATE INDEX literature_sources_lab_source_idx ON public.literature_sources (lab_source_id) WHERE lab_source_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.lab_source_notes (
    source_id uuid NOT NULL REFERENCES public.literature_sources(id) ON DELETE CASCADE,
    section text NOT NULL,
    body text NOT NULL,
    -- Kept when the writer leaves the lab (their name stays); only a deleted account clears it.
    author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (source_id, section),
    CONSTRAINT lab_source_notes_section CHECK (section IN ('question', 'method', 'findings', 'limitations')),
    CONSTRAINT lab_source_notes_body CHECK (char_length(body) BETWEEN 1 AND 5000)
);
--> statement-breakpoint
CREATE INDEX lab_source_notes_author_idx ON public.lab_source_notes (author_id) WHERE author_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.lab_reading (
    source_id uuid NOT NULL REFERENCES public.literature_sources(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    state text NOT NULL,
    private_note text DEFAULT '' NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (source_id, user_id),
    CONSTRAINT lab_reading_state CHECK (state IN ('to_read', 'reading', 'read')),
    CONSTRAINT lab_reading_note CHECK (char_length(private_note) <= 5000)
);
--> statement-breakpoint
CREATE INDEX lab_reading_user_idx ON public.lab_reading (user_id, updated_at DESC);
--> statement-breakpoint
CREATE TABLE public.lab_source_themes (
    source_id uuid NOT NULL REFERENCES public.literature_sources(id) ON DELETE CASCADE,
    theme text NOT NULL,
    disagrees boolean DEFAULT false NOT NULL,
    why text DEFAULT '' NOT NULL,
    set_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (source_id, theme),
    CONSTRAINT lab_source_themes_theme CHECK (char_length(theme) BETWEEN 1 AND 60),
    CONSTRAINT lab_source_themes_why CHECK (char_length(why) <= 300)
);
--> statement-breakpoint
CREATE INDEX lab_source_themes_set_by_idx ON public.lab_source_themes (set_by) WHERE set_by IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.lab_source_notes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lab_reading ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lab_source_themes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_source_notes FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_reading FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_source_themes FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_source_notes TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_reading TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_source_themes TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_source_notes TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_reading TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_source_themes TO service_role;
