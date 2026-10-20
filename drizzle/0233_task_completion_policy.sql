ALTER TABLE projects ADD COLUMN task_review_required boolean NOT NULL DEFAULT false;
ALTER TABLE projects ADD COLUMN task_completion_policy_version integer NOT NULL DEFAULT 0;
--> statement-breakpoint
ALTER TABLE tasks ADD COLUMN review_submitted_at timestamptz;
ALTER TABLE tasks ADD COLUMN review_content_hash text;
ALTER TABLE tasks ADD COLUMN completed_at timestamptz;
ALTER TABLE tasks ADD COLUMN completed_by uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE tasks ADD COLUMN completion_source text CHECK (completion_source IN ('direct', 'review', 'legacy'));
--> statement-breakpoint
-- Preserve existing outcomes without inventing historical completion/submission dates.
-- Pending legacy submissions require a fresh snapshot before approval.
UPDATE tasks SET completion_source = 'legacy'
WHERE status = 'done' AND review_status <> 'pending';
--> statement-breakpoint
CREATE TABLE project_task_policy_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  review_required boolean NOT NULL,
  policy_version integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX project_task_policy_events_version_idx ON project_task_policy_events(project_id, policy_version);
ALTER TABLE project_task_policy_events ENABLE ROW LEVEL SECURITY;

--> statement-breakpoint
CREATE INDEX tasks_pending_review_idx ON tasks(project_id) WHERE review_status = 'pending' AND deleted_at IS NULL;

--> statement-breakpoint
CREATE INDEX tasks_completed_by_idx ON tasks(completed_by);
CREATE INDEX project_task_policy_events_actor_idx ON project_task_policy_events(actor_id);
