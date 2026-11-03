-- Live-fix 36 (report §7.8, §37.5): starter folders made before this fix get what new ones have, a line about their
-- purpose and, for Templates, the Template chip. Only an organization's top-level folders with the known names.
-- The words match STARTER_PURPOSE in src/lib/organizations/file-rules.ts.
UPDATE public.workspace_nodes n
SET metadata = coalesce(n.metadata, '{}'::jsonb)
    || jsonb_build_object('purpose', CASE
        WHEN n.name IN ('Course materials', 'Shared') THEN 'Files everyone in the organization can open'
        WHEN n.name = 'Docs' THEN 'Where new documents are kept'
        WHEN n.name = 'Templates' THEN 'Starting points people copy'
        ELSE 'Only admins can open this' END)
    || CASE WHEN n.name = 'Templates' THEN '{"template": true}'::jsonb ELSE '{}'::jsonb END
FROM public.workspaces w
WHERE w.id = n.workspace_id AND w.kind = 'organization' AND n.type = 'folder' AND n.parent_id IS NULL AND n.deleted_at IS NULL
  AND (n.name IN ('Course materials', 'Shared', 'Docs', 'Templates')
       OR (n.name IN ('Staff', 'Admins', 'Managers') AND n.metadata->>'access' = 'admins'))
  AND NOT (coalesce(n.metadata, '{}'::jsonb) ? 'purpose');
