-- Report §10.1, §36.4, §38.6 (DB2, DB5): how a membership ended, who ended it and the reason they wrote; when the
-- person dismissed the write-up nudge; and the order they chose for their profile's Organizations section.
-- Existing ended entries keep end_reason NULL and read as "left": their real reason was never recorded (§41.4).
ALTER TABLE public.profile_contributions
    ADD COLUMN end_reason text,
    ADD COLUMN ended_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
    ADD COLUMN end_note text,
    ADD COLUMN nudge_dismissed_at timestamptz,
    ADD CONSTRAINT profile_contributions_end_reason_check CHECK (end_reason IS NULL OR end_reason IN ('left', 'removed', 'term_ended', 'org_deleted')),
    ADD CONSTRAINT profile_contributions_end_note_length CHECK (end_note IS NULL OR char_length(end_note) <= 500);
--> statement-breakpoint
ALTER TABLE public.workspace_members ADD COLUMN profile_order integer;
