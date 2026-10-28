-- 0252: applications are written by the server only. 0199 revoked every browser grant on role_applications,
-- but 0238 re-created two browser UPDATE policies ("Project admins can update applications", "Applicants can
-- edit their own pending applications") TO public. With no grant they could never run, and the server's role
-- bypasses RLS, so they only contradicted the contract (SELECT-only TO authenticated) the catalog check enforces.
-- Accept, decline, withdraw and edit keep going through the server actions, which check the same rules.
DROP POLICY IF EXISTS "Project admins can update applications" ON public.role_applications;
--> statement-breakpoint
DROP POLICY IF EXISTS "Applicants can edit their own pending applications" ON public.role_applications;
