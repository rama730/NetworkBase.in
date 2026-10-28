-- 0256: the index behind content_reports.reporter_id (live lineage gate, same rule as 0206 and 0251). The open-report
-- unique index starts with reporter_id but is partial on status, so it can't serve the foreign-key lookup.
CREATE INDEX IF NOT EXISTS content_reports_reporter_idx ON public.content_reports (reporter_id) WHERE reporter_id IS NOT NULL;
