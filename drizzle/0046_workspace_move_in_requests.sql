-- Report §28.6, decision 57: Workspaces → Requests and Needs your attention find move-in requests by organization.
-- Partial, so only workspaces with a pending request are in it; admins' sidebar reads it on every load.
CREATE INDEX workspaces_move_in_request_idx ON public.workspaces USING btree (((org_settings -> 'moveInRequest'::text) ->> 'orgId'::text))
    WHERE ((org_settings ? 'moveInRequest'::text) AND (deleted_at IS NULL));
