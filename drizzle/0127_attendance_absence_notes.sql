-- Plan B1.4b (report 30.7 call 4): a student's absence note, in its own column so a staff mark never overwrites it
-- (security review). It can arrive before attendance is taken, so a record may hold only the student's note and no
-- status yet ("Notified: …"); the teacher then decides, usually Excused. Notes stay text only.

ALTER TABLE public.attendance_records ADD COLUMN student_note text;
--> statement-breakpoint
ALTER TABLE public.attendance_records ADD CONSTRAINT attendance_records_student_note_length CHECK (student_note IS NULL OR char_length(student_note) <= 300);
--> statement-breakpoint
ALTER TABLE public.attendance_records ALTER COLUMN status DROP NOT NULL;
--> statement-breakpoint
ALTER TABLE public.attendance_records DROP CONSTRAINT attendance_records_status_check;
--> statement-breakpoint
ALTER TABLE public.attendance_records ADD CONSTRAINT attendance_records_status_check CHECK ((status IS NULL AND student_note IS NOT NULL) OR status IN ('present', 'late', 'absent', 'excused'));
