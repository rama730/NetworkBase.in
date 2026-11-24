-- Plan B1.5b (report 30.8 call: team copies): one mark for every member of a team copy, with an optional
-- "Adjust for one person" (a total and a reason), kept per member id on the mark.

ALTER TABLE public.assignment_marks ADD COLUMN adjustments jsonb DEFAULT '{}'::jsonb NOT NULL;
--> statement-breakpoint
ALTER TABLE public.assignment_marks ADD CONSTRAINT assignment_marks_adjustments_object CHECK (jsonb_typeof(adjustments) = 'object');
