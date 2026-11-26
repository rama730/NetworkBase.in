-- Plan B6.2b (report 35.5 calls 2–5): a lab workspace's Notebook — dated entries that lock at the end of their day
-- (the lab's time zone) and take amendments after that, nothing removed; Run this protocol records the Approved version
-- used; experiments group entries with a hypothesis, status and conclusion. Read by the workspace's members and the
-- lab's PI and Researchers. No link to the lab itself: a notebook stays with its workspace when the lab goes (review).
-- An entry keeps the protocol's title and version as run, even if the page is later removed. Server only.

CREATE TABLE public.lab_experiments (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    title text NOT NULL,
    hypothesis text DEFAULT '' NOT NULL,
    status text DEFAULT 'planned' NOT NULL,
    conclusion text DEFAULT '' NOT NULL,
    created_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_experiments_title CHECK (char_length(title) BETWEEN 1 AND 120),
    CONSTRAINT lab_experiments_hypothesis CHECK (char_length(hypothesis) <= 2000),
    CONSTRAINT lab_experiments_conclusion CHECK (char_length(conclusion) <= 4000),
    CONSTRAINT lab_experiments_status CHECK (status IN ('planned', 'running', 'done', 'stopped'))
);
--> statement-breakpoint
CREATE INDEX lab_experiments_workspace_idx ON public.lab_experiments (workspace_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX lab_experiments_created_by_idx ON public.lab_experiments (created_by) WHERE created_by IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.lab_entries (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    entry_date date NOT NULL,
    title text NOT NULL,
    body jsonb DEFAULT '{}'::jsonb NOT NULL,
    protocol_doc_id uuid REFERENCES public.workspace_documents(id) ON DELETE SET NULL,
    protocol_version_id uuid REFERENCES public.lab_protocol_versions(id) ON DELETE SET NULL,
    protocol_title text,
    protocol_version integer,
    experiment_id uuid REFERENCES public.lab_experiments(id) ON DELETE SET NULL,
    untrained boolean DEFAULT false NOT NULL,
    written_later boolean DEFAULT false NOT NULL,
    locks_at timestamp with time zone NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_entries_title CHECK (char_length(title) BETWEEN 1 AND 160),
    CONSTRAINT lab_entries_body CHECK (jsonb_typeof(body) = 'object' AND pg_column_size(body) <= 200000),
    CONSTRAINT lab_entries_protocol_title CHECK (protocol_title IS NULL OR char_length(protocol_title) <= 200)
);
--> statement-breakpoint
CREATE INDEX lab_entries_workspace_idx ON public.lab_entries (workspace_id, entry_date DESC);
--> statement-breakpoint
CREATE INDEX lab_entries_author_idx ON public.lab_entries (author_id) WHERE author_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX lab_entries_experiment_idx ON public.lab_entries (experiment_id) WHERE experiment_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX lab_entries_protocol_doc_idx ON public.lab_entries (protocol_doc_id) WHERE protocol_doc_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX lab_entries_protocol_version_idx ON public.lab_entries (protocol_version_id) WHERE protocol_version_id IS NOT NULL;
--> statement-breakpoint
-- Call 3: a locked entry never changes (the app also refuses; this holds for anything else that writes).
CREATE FUNCTION app_private.lab_entries_locked() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  -- Only the record itself is frozen; links cleared by a deleted page, person or experiment (SET NULL) still apply.
  IF OLD.locks_at <= now() AND (NEW.title IS DISTINCT FROM OLD.title OR NEW.body IS DISTINCT FROM OLD.body OR NEW.entry_date IS DISTINCT FROM OLD.entry_date
      OR NEW.locks_at IS DISTINCT FROM OLD.locks_at OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id OR NEW.untrained IS DISTINCT FROM OLD.untrained
      OR NEW.written_later IS DISTINCT FROM OLD.written_later OR NEW.protocol_title IS DISTINCT FROM OLD.protocol_title OR NEW.protocol_version IS DISTINCT FROM OLD.protocol_version
      OR (NEW.experiment_id IS DISTINCT FROM OLD.experiment_id AND NEW.experiment_id IS NOT NULL)) THEN
    RAISE EXCEPTION 'lab entry % is locked; add an amendment', OLD.id USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER lab_entries_locked BEFORE UPDATE ON public.lab_entries FOR EACH ROW EXECUTE FUNCTION app_private.lab_entries_locked();
--> statement-breakpoint
CREATE TABLE public.lab_entry_amendments (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    entry_id uuid NOT NULL REFERENCES public.lab_entries(id) ON DELETE CASCADE,
    author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    body text NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_entry_amendments_body CHECK (char_length(body) BETWEEN 1 AND 4000)
);
--> statement-breakpoint
CREATE INDEX lab_entry_amendments_entry_idx ON public.lab_entry_amendments (entry_id, created_at);
--> statement-breakpoint
CREATE INDEX lab_entry_amendments_author_idx ON public.lab_entry_amendments (author_id) WHERE author_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.lab_experiments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lab_entries ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lab_entry_amendments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_experiments FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_entries FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_entry_amendments FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_experiments TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.lab_entries TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT ON TABLE public.lab_entry_amendments TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_experiments TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_entries TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_entry_amendments TO service_role;
