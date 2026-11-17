-- Report Part H, phase H-3 (M8): merge requests from a branch into main, their reviews, comments (with suggested
-- edits), checks posted by builds, and what happened on them. docs/superpowers/plans/2026-11-17-m8-h3-merge-requests.md
CREATE TABLE public.merge_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    number integer NOT NULL,
    source_branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    target_branch_id uuid NOT NULL REFERENCES public.branches(id) ON DELETE CASCADE,
    title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 20000),
    state text NOT NULL DEFAULT 'open' CHECK (state IN ('draft', 'open', 'merged', 'closed')),
    author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    via text CHECK (via IN ('cli', 'agent')),
    agent_name text,
    task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
    merge_method text CHECK (merge_method IN ('merge', 'squash')),
    merge_save_id uuid REFERENCES public.saves(id) ON DELETE SET NULL,
    merged_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    merged_at timestamptz,
    closed_at timestamptz,
    -- A merge held for the person's yes (an agent's) keeps its change set, valid while the branch head stays put.
    pending_change_set_id uuid REFERENCES public.change_sets(id) ON DELETE SET NULL,
    pending_head_save_id uuid REFERENCES public.saves(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK (source_branch_id <> target_branch_id)
);
--> statement-breakpoint
CREATE UNIQUE INDEX merge_requests_number_uq ON public.merge_requests (workspace_id, number);
--> statement-breakpoint
-- One open merge request per pair of branches (H4).
CREATE UNIQUE INDEX merge_requests_open_pair_uq ON public.merge_requests (source_branch_id, target_branch_id) WHERE state IN ('draft', 'open');
--> statement-breakpoint
CREATE INDEX merge_requests_workspace_state_idx ON public.merge_requests (workspace_id, state, updated_at DESC);
--> statement-breakpoint
CREATE TABLE public.merge_request_reviews (
    merge_request_id uuid NOT NULL REFERENCES public.merge_requests(id) ON DELETE CASCADE,
    reviewer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    state text NOT NULL DEFAULT 'requested' CHECK (state IN ('requested', 'approved', 'changes_requested', 'commented')),
    save_id uuid REFERENCES public.saves(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (merge_request_id, reviewer_id)
);
--> statement-breakpoint
CREATE INDEX merge_request_reviews_reviewer_idx ON public.merge_request_reviews (reviewer_id, state);
--> statement-breakpoint
CREATE TABLE public.merge_request_comments (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    merge_request_id uuid NOT NULL REFERENCES public.merge_requests(id) ON DELETE CASCADE,
    author_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    via text CHECK (via IN ('cli', 'agent')),
    agent_name text,
    body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 20000),
    review_state text CHECK (review_state IN ('approved', 'changes_requested', 'commented')),
    path text,
    line integer CHECK (line IS NULL OR line >= 1),
    end_line integer CHECK (end_line IS NULL OR end_line >= line),
    save_id uuid REFERENCES public.saves(id) ON DELETE SET NULL,
    suggestion text CHECK (suggestion IS NULL OR char_length(suggestion) <= 100000),
    original text,
    applied_save_id uuid REFERENCES public.saves(id) ON DELETE SET NULL,
    resolved_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    edited_at timestamptz,
    deleted_at timestamptz,
    CHECK (line IS NULL OR path IS NOT NULL),
    CHECK (suggestion IS NULL OR (line IS NOT NULL AND original IS NOT NULL))
);
--> statement-breakpoint
CREATE INDEX merge_request_comments_mr_idx ON public.merge_request_comments (merge_request_id, created_at);
--> statement-breakpoint
CREATE TABLE public.merge_request_checks (
    merge_request_id uuid NOT NULL REFERENCES public.merge_requests(id) ON DELETE CASCADE,
    save_id uuid NOT NULL REFERENCES public.saves(id) ON DELETE CASCADE,
    name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 100),
    state text NOT NULL CHECK (state IN ('running', 'passed', 'failed')),
    url text CHECK (url IS NULL OR (char_length(url) <= 2000 AND url ~ '^https://')),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (merge_request_id, save_id, name)
);
--> statement-breakpoint
CREATE TABLE public.merge_request_events (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    merge_request_id uuid NOT NULL REFERENCES public.merge_requests(id) ON DELETE CASCADE,
    actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    via text CHECK (via IN ('cli', 'agent')),
    agent_name text,
    kind text NOT NULL CHECK (kind IN ('opened', 'ready', 'draft', 'closed', 'reopened', 'merged', 'edited', 'reviewers')),
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX merge_request_events_mr_idx ON public.merge_request_events (merge_request_id, id);
--> statement-breakpoint
ALTER TABLE public.merge_requests ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.merge_request_reviews ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.merge_request_comments ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.merge_request_checks ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.merge_request_events ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.merge_requests, public.merge_request_reviews, public.merge_request_comments, public.merge_request_checks, public.merge_request_events FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.merge_requests, public.merge_request_reviews, public.merge_request_comments, public.merge_request_checks, public.merge_request_events TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.merge_requests, public.merge_request_reviews, public.merge_request_comments, public.merge_request_checks, public.merge_request_events TO service_role;
--> statement-breakpoint
-- History like GitHub's commit list (H-2b): lines added and removed, worked out once per change and kept.
ALTER TABLE public.save_changes ADD COLUMN IF NOT EXISTS lines_added integer, ADD COLUMN IF NOT EXISTS lines_removed integer;
--> statement-breakpoint
ALTER TABLE public.saves ADD COLUMN IF NOT EXISTS lines_added integer, ADD COLUMN IF NOT EXISTS lines_removed integer;
