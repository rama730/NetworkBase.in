-- 0213: One durable lease table for long-running server work (ARCH-001).
-- A session advisory lock lives on one pooled backend and a transaction lock dies with its
-- transaction, so neither can guard work that spans external I/O. A lease row can: it carries an
-- owner token, an expiry that renewals extend, and a fence that rises on every takeover, and the
-- short transactions that mutate data re-check it (FOR SHARE) before writing.
CREATE TABLE public.work_leases (
  scope text PRIMARY KEY,
  lease_id uuid NOT NULL,
  fence bigint NOT NULL DEFAULT 1,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
ALTER TABLE public.work_leases ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
REVOKE ALL ON public.work_leases FROM PUBLIC, anon, authenticated;
--> statement-breakpoint
GRANT ALL ON public.work_leases TO service_role;
