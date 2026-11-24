-- Plan B1.4b (report 30.7 call 4): a student's absence note can arrive before attendance is taken, so a record may
-- hold a note with no status yet ("Notified: …"); the teacher then decides, usually Excused. Notes stay text only.

ALTER TABLE public.attendance_records ALTER COLUMN status DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.attendance_records DROP CONSTRAINT attendance_records_status_check;
--> statement-breakpoint
ALTER TABLE public.attendance_records ADD CONSTRAINT attendance_records_status_check CHECK ((status IS NULL AND note IS NOT NULL) OR status IN ('present', 'late', 'absent', 'excused'));
