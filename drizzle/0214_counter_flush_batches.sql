-- 0214: Applied Redis counter batches (COR-009).
-- A buffered hash is renamed to a stable batch key before it is read. The batch id (that key) is
-- recorded in the same transaction that adds its increments, so replaying a crashed or ambiguous
-- flush finds the id and skips the SQL: every batch is applied to PostgreSQL at most once.
CREATE TABLE public.counter_flush_batches (
  batch_id text PRIMARY KEY,
  kind text NOT NULL,
  entry_count integer NOT NULL DEFAULT 0,
  applied_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX counter_flush_batches_applied_idx ON public.counter_flush_batches (applied_at);
--> statement-breakpoint
ALTER TABLE public.counter_flush_batches ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.counter_flush_batches FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT ALL ON public.counter_flush_batches TO service_role;
