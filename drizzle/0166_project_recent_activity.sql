-- Project Analytics has been replaced by the Dashboard recent-activity card.
-- Shared task, file, member, and GitHub audit tables remain intact.
ALTER TABLE projects
  ALTER COLUMN public_tab_visibility
  SET DEFAULT '{"dashboard":true,"readme":true,"updates":true,"files":true,"sprints":false,"tasks":false}'::jsonb;

UPDATE projects
SET public_tab_visibility = public_tab_visibility - 'analytics'
WHERE public_tab_visibility ? 'analytics';
