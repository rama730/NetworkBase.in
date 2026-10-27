-- 0248_org_profile.sql
-- Org contributions (docs/organization-concept-report.md §24.5): org admins verify members' org entries
-- ("Verified by CSE-3A") and may revoke with a reason the member sees. Verification covers role and dates only.

ALTER TABLE public.profile_project_contributions
  ADD COLUMN verification_revoked_reason text,
  ADD CONSTRAINT profile_project_contributions_revoked_reason_length CHECK (verification_revoked_reason IS NULL OR char_length(verification_revoked_reason) <= 500);
