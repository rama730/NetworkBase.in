-- org_email_invites_org_idx (org_id) became redundant when 0068 added org_email_invites_org_created_idx
-- (org_id, created_at): the longer index serves every lookup by org_id, and the short one only cost writes.
-- Found by tests/db/no-redundant-indexes.test.ts.
DROP INDEX IF EXISTS public.org_email_invites_org_idx;
