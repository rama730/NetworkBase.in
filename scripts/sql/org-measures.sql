-- Organization success measures (report §41.7). Read only; run by hand once a month against production:
--   psql "$DATABASE_URL" -f scripts/sql/org-measures.sql
-- Targets are set after the pilot. Speed (the last row of §41.7) comes from the benchmark, not from here.
BEGIN TRANSACTION READ ONLY;

-- Do classes get set up? Days from creating an organization to its first published assignment (last 90 days).
SELECT o.id, o.title, o.created_at::date AS created,
  round(extract(epoch FROM min((m.assignment_settings->>'publishedAt')::timestamptz) - o.created_at) / 86400, 1) AS days_to_first_assignment
FROM workspaces o LEFT JOIN tasks m ON m.workspace_id = o.id AND m.kind = 'assignment' AND m.assignment_id IS NULL AND m.deleted_at IS NULL
WHERE o.kind = 'organization' AND o.deleted_at IS NULL AND o.created_at > now() - interval '90 days'
GROUP BY o.id ORDER BY o.created_at DESC;

-- Do classes get set up? Email invites accepted within 7 days.
SELECT count(*) FILTER (WHERE accepted_at <= created_at + interval '7 days') AS joined_within_7_days, count(*) AS invited
FROM org_email_invites WHERE created_at BETWEEN now() - interval '37 days' AND now() - interval '7 days';

-- Does the work flow? Copies handed in by the due date (first version not late), over copies due in the last 30 days.
SELECT count(DISTINCT s.copy_id) FILTER (WHERE s.version = 1 AND NOT s.late) AS on_time, count(DISTINCT c.id) AS due
FROM tasks c JOIN tasks m ON m.id = c.assignment_id LEFT JOIN assignment_submissions s ON s.copy_id = c.id
WHERE c.deleted_at IS NULL AND c.excused_at IS NULL AND c.due_date BETWEEN now() - interval '30 days' AND now();

-- Does the work flow? Hours from the last hand-in to approval (median and 90th percentile, last 30 days).
SELECT percentile_cont(0.5) WITHIN GROUP (ORDER BY h) AS median_hours, percentile_cont(0.9) WITHIN GROUP (ORDER BY h) AS p90_hours, count(*) AS approved
FROM (SELECT extract(epoch FROM c.completed_at - max(s.submitted_at)) / 3600 AS h
      FROM tasks c JOIN assignment_submissions s ON s.copy_id = c.id
      WHERE c.completion_source = 'review' AND c.completed_at > now() - interval '30 days' GROUP BY c.id) t;

-- Does the work flow? Uploads that failed or expired in organizations and their workspaces (decision 172). Hand-in
-- uploads aren't tagged apart, so this is the ceiling; resumable uploads come only if it is high.
SELECT u.status, count(*) FROM upload_intents u JOIN workspaces w ON w.id = u.workspace_id
LEFT JOIN workspaces o ON o.id = w.parent_id
WHERE u.scope = 'workspace_file' AND u.created_at > now() - interval '30 days' AND (w.kind = 'organization' OR o.kind = 'organization')
GROUP BY u.status;

-- Do they stay? Organizations at least four weeks old with someone active in their fourth week.
SELECT count(*) FILTER (WHERE active) AS active_in_week_4, count(*) AS four_weeks_old
FROM (SELECT o.id, EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = o.id
        AND m.last_active_here_at BETWEEN o.created_at + interval '21 days' AND o.created_at + interval '28 days') AS active
      FROM workspaces o WHERE o.kind = 'organization' AND o.deleted_at IS NULL AND o.created_at < now() - interval '28 days') t;

-- Do they stay? Members active in each of the last four weeks, over all members.
SELECT count(*) FILTER (WHERE last_active_here_at > now() - interval '7 days') AS active_this_week, count(*) AS members
FROM workspace_members m JOIN workspaces o ON o.id = m.workspace_id AND o.kind = 'organization' AND o.deleted_at IS NULL;

-- Is the profile accurate? Organization entries published and verified; entries still titled "Contributor" (should be 0).
SELECT count(*) FILTER (WHERE c.published_at IS NOT NULL) AS published, count(*) FILTER (WHERE c.verified_at IS NOT NULL) AS verified,
  count(*) FILTER (WHERE c.role_title = 'Contributor') AS still_contributor, count(*) AS entries
FROM profile_contributions c JOIN workspaces o ON o.id = c.workspace_id AND o.kind = 'organization'
WHERE c.deleted_at IS NULL;

-- Costs (decision 164): organization emails waiting more than an hour, by kind. Any row here needs a look.
SELECT kind, status, count(*), min(created_at) AS oldest FROM email_outbox
WHERE status IN ('pending', 'processing') AND created_at < now() - interval '1 hour' AND workspace_id IS NOT NULL
GROUP BY kind, status ORDER BY oldest;

ROLLBACK;
