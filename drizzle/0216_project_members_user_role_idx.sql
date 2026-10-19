-- 0216: Composite index on project_members (user_id, role)
-- Optimizes getProfileProjectsWithOpenRolesAction and profile portfolio queries
-- filtering members by user_id AND role IN ('owner', 'admin') at 1M scale.
CREATE INDEX IF NOT EXISTS project_members_user_role_idx ON project_members (user_id, role);
