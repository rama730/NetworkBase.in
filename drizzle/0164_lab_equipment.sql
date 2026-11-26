-- Plan B6.2c (report 35.5 calls 6–8): a lab's equipment — caretaker, place, status (Available · Out of order ·
-- Maintenance), training needed (a protocol) — bookings in the lab's slots (no overlaps: checked under a lock per
-- equipment) and problem reports that pause booking and give the caretaker a task. Server only.

CREATE TABLE public.lab_equipment (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
    name text NOT NULL,
    place text DEFAULT '' NOT NULL,
    caretaker_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    training_doc_id uuid REFERENCES public.workspace_documents(id) ON DELETE SET NULL,
    -- Kept when the protocol page is removed, so booking stays closed to the untrained (review).
    needs_training boolean DEFAULT false NOT NULL,
    status text DEFAULT 'available' NOT NULL,
    status_since timestamp with time zone DEFAULT now() NOT NULL,
    bookable boolean DEFAULT true NOT NULL,
    notes text DEFAULT '' NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_equipment_name CHECK (char_length(name) BETWEEN 1 AND 80),
    CONSTRAINT lab_equipment_place CHECK (char_length(place) <= 80),
    CONSTRAINT lab_equipment_notes CHECK (char_length(notes) <= 1000),
    CONSTRAINT lab_equipment_status CHECK (status IN ('available', 'out_of_order', 'maintenance'))
);
--> statement-breakpoint
CREATE INDEX lab_equipment_workspace_idx ON public.lab_equipment (workspace_id);
--> statement-breakpoint
CREATE INDEX lab_equipment_caretaker_idx ON public.lab_equipment (caretaker_id) WHERE caretaker_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX lab_equipment_training_doc_idx ON public.lab_equipment (training_doc_id) WHERE training_doc_id IS NOT NULL;
--> statement-breakpoint
CREATE TABLE public.lab_bookings (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    equipment_id uuid NOT NULL REFERENCES public.lab_equipment(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
    starts_at timestamp with time zone NOT NULL,
    ends_at timestamp with time zone NOT NULL,
    cancelled_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_bookings_span CHECK (ends_at > starts_at AND ends_at - starts_at <= interval '1 day')
);
--> statement-breakpoint
CREATE INDEX lab_bookings_equipment_idx ON public.lab_bookings (equipment_id, starts_at) WHERE cancelled_at IS NULL;
--> statement-breakpoint
CREATE INDEX lab_bookings_user_idx ON public.lab_bookings (user_id, starts_at);
--> statement-breakpoint
CREATE TABLE public.lab_equipment_reports (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    equipment_id uuid NOT NULL REFERENCES public.lab_equipment(id) ON DELETE CASCADE,
    reporter_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    body text NOT NULL,
    task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
    fixed_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT lab_equipment_reports_body CHECK (char_length(body) BETWEEN 1 AND 1000)
);
--> statement-breakpoint
CREATE INDEX lab_equipment_reports_equipment_idx ON public.lab_equipment_reports (equipment_id, created_at DESC);
--> statement-breakpoint
CREATE INDEX lab_equipment_reports_reporter_idx ON public.lab_equipment_reports (reporter_id) WHERE reporter_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX lab_equipment_reports_task_idx ON public.lab_equipment_reports (task_id) WHERE task_id IS NOT NULL;
--> statement-breakpoint
ALTER TABLE public.lab_equipment ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lab_bookings ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
ALTER TABLE public.lab_equipment_reports ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_equipment FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_bookings FROM anon, authenticated;
--> statement-breakpoint
REVOKE ALL ON TABLE public.lab_equipment_reports FROM anon, authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lab_equipment TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.lab_bookings TO nb_app;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON TABLE public.lab_equipment_reports TO nb_app;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_equipment TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_bookings TO service_role;
--> statement-breakpoint
GRANT ALL ON TABLE public.lab_equipment_reports TO service_role;
