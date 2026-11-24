-- Plan B1.6c (report 30.5 call: second marking): on an exam a second marker marks every copy or a 10% sample; when
-- the two totals differ by more than 10% of the out-of the mark needs agreement until one final mark is saved.

ALTER TABLE public.assignment_marks ADD COLUMN second_total numeric(8,2);
--> statement-breakpoint
ALTER TABLE public.assignment_marks ADD COLUMN second_marker_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE public.assignment_marks ADD COLUMN second_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE public.assignment_marks ADD COLUMN agreed_at timestamp with time zone;
--> statement-breakpoint
ALTER TABLE public.assignment_marks ADD CONSTRAINT assignment_marks_second_total_check CHECK (second_total IS NULL OR (second_total >= 0 AND second_total <= out_of));
