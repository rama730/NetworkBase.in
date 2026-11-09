-- agent_questions.to_user_id had only a partial index (open questions), so deleting a person scanned the table for
-- their answered ones (ON DELETE CASCADE). One full index serves both the foreign key and the open-questions list.
CREATE INDEX agent_questions_to_user_idx ON public.agent_questions (to_user_id, created_at DESC);
--> statement-breakpoint
DROP INDEX IF EXISTS public.agent_questions_to_open_idx;
