-- Live-fix 9 (report §16.4, decisions 14 and 147): a main assignment has no review or completion of its own; only
-- each person's copy does. Before the guard in transitionTaskTx, a main one could go through ordinary review and
-- show "Changes requested". Clear that state; the board works out its column from the copies.
UPDATE public.tasks
SET review_status = 'none', review_submitted_at = NULL, review_content_hash = NULL,
    completed_at = NULL, completed_by = NULL, completion_source = NULL
WHERE kind = 'assignment' AND assignment_id IS NULL
  AND (review_status <> 'none' OR review_submitted_at IS NOT NULL OR review_content_hash IS NOT NULL OR completed_at IS NOT NULL);
