-- Plan B1.3a (report 30.9 W8): sections inside a class — a group of students with its own TAs, times and room.
-- One section per student per kind (call 4) is a database rule. Server only (no browser grants).

CREATE TABLE public.class_sections (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    kind text DEFAULT 'lab' NOT NULL,
    meets jsonb DEFAULT '[]'::jsonb NOT NULL,
    room text,
    office_hours jsonb,
    seat_limit integer,
    position integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT class_sections_name_length CHECK (char_length(name) BETWEEN 1 AND 60),
    CONSTRAINT class_sections_kind_check CHECK (kind IN ('lab', 'tutorial', 'lecture')),
    CONSTRAINT class_sections_seat_limit_check CHECK (seat_limit IS NULL OR seat_limit BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE INDEX class_sections_workspace_idx ON public.class_sections (workspace_id, position);
--> statement-breakpoint
CREATE TABLE public.class_section_members (
    section_id uuid NOT NULL REFERENCES public.class_sections(id) ON DELETE CASCADE,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    role text NOT NULL,
    kind text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    PRIMARY KEY (section_id, user_id),
    CONSTRAINT class_section_members_role_check CHECK (role IN ('ta', 'student'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX class_section_members_one_per_kind ON public.class_section_members (workspace_id, kind, user_id) WHERE role = 'student';
--> statement-breakpoint
CREATE INDEX class_section_members_user_idx ON public.class_section_members (user_id);
--> statement-breakpoint
ALTER TABLE public.class_sections ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.class_section_members ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.class_sections FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.class_section_members FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.class_sections TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.class_section_members TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.class_sections TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.class_section_members TO service_role;
