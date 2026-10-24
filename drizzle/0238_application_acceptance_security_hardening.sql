-- Tighten RLS on role_applications so applicants cannot self-accept applications directly via PostgREST.
-- Applicants can only edit pending applications (or withdraw them).
-- Decisions (accept, reject, reopen) are strictly reserved for project administrators.

DROP POLICY IF EXISTS "Users can update their own applications or project admins can manage" ON public.role_applications;
DROP POLICY IF EXISTS "Project admins can update applications" ON public.role_applications;
DROP POLICY IF EXISTS "Applicants can edit their own pending applications" ON public.role_applications;

CREATE POLICY "Project admins can update applications"
ON public.role_applications FOR UPDATE
USING (app_private.nb_project_can_admin(project_id))
WITH CHECK (app_private.nb_project_can_admin(project_id));

CREATE POLICY "Applicants can edit their own pending applications"
ON public.role_applications FOR UPDATE
USING (applicant_id = auth.uid() AND status = 'pending')
WITH CHECK (applicant_id = auth.uid() AND status IN ('pending', 'withdrawn'));

-- High-concurrency performance index for cascading role closures and capacity queries
CREATE INDEX IF NOT EXISTS "role_applications_role_status_idx" ON public.role_applications (role_id, status);
CREATE INDEX IF NOT EXISTS "role_applications_project_role_pending_idx" ON public.role_applications (project_id, role_id) WHERE status = 'pending';
