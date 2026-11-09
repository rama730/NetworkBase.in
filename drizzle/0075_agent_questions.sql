-- CLI 2.0 Phase 3 (P3.5, P3.6; report §20.4, §26.4, A11.6, §44): agents asking people, and an agent session's
-- notifications held for one summary.
CREATE TABLE public.agent_questions (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
    asker_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    asker_session_id uuid,
    agent_name text,
    to_role text NOT NULL,
    to_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    context text,
    questions jsonb NOT NULL,
    answer jsonb,
    status text DEFAULT 'open' NOT NULL,
    answered_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    answered_at timestamp with time zone,
    expires_at timestamp with time zone NOT NULL,
    CONSTRAINT agent_questions_to_role_check CHECK (to_role = ANY (ARRAY['me'::text, 'assignee'::text, 'reviewer'::text])),
    CONSTRAINT agent_questions_status_check CHECK (status = ANY (ARRAY['open'::text, 'answered'::text, 'cancelled'::text]))
);
--> statement-breakpoint
CREATE INDEX agent_questions_to_open_idx ON public.agent_questions (to_user_id, created_at DESC) WHERE status = 'open';
--> statement-breakpoint
CREATE INDEX agent_questions_session_idx ON public.agent_questions (asker_session_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX agent_questions_task_idx ON public.agent_questions (task_id) WHERE task_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.agent_question_mutes (
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    session_id uuid NOT NULL,
    task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT agent_question_mutes_pkey PRIMARY KEY (user_id, session_id, task_id)
);
--> statement-breakpoint
CREATE TABLE public.agent_notification_buffer (
    id uuid DEFAULT gen_random_uuid() NOT NULL PRIMARY KEY,
    session_id uuid NOT NULL,
    recipient_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    write jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX agent_notification_buffer_session_idx ON public.agent_notification_buffer (session_id, created_at);
--> statement-breakpoint
ALTER TABLE public.agent_questions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.agent_question_mutes ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.agent_notification_buffer ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.agent_questions, public.agent_question_mutes, public.agent_notification_buffer FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.agent_questions, public.agent_question_mutes, public.agent_notification_buffer TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.agent_questions, public.agent_question_mutes, public.agent_notification_buffer TO service_role;
