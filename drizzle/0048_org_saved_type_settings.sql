-- Report §21.2, DB3: settings stop following the organization's type. New organizations save these when made;
-- this fills the same keys for organizations made before, from their current type. Existing values win (the right
-- side of || overrides), so nothing anyone set changes. Matches savedTypeSettings() in type-profile.ts.
UPDATE public.workspaces w
SET org_settings = jsonb_build_object(
        'assignmentReview', w.org_type IS NOT DISTINCT FROM 'education',
        'assignmentLateRule', CASE WHEN w.org_type = 'education' THEN 'until' ELSE 'always' END,
        'storyPoints', CASE WHEN w.org_type = 'education' THEN 'hidden' ELSE 'shown' END,
        'membersCreateChannels', w.org_type IS DISTINCT FROM 'education',
        'generalNotify', CASE WHEN w.org_type = 'education' THEN 'mentions' ELSE 'all' END
    ) || coalesce(w.org_settings, '{}'::jsonb)
WHERE w.kind = 'organization'
  AND NOT (coalesce(w.org_settings, '{}'::jsonb) ?& ARRAY['assignmentReview', 'assignmentLateRule', 'storyPoints', 'membersCreateChannels', 'generalNotify']);
