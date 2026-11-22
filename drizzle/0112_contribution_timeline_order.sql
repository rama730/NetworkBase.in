-- Profile mix (2026-11-23 spec, Contributions ⋯ Move up / Move down): the order you set on your contributions
-- timeline. Null keeps the default (pinned first, then newest). Separate from workspace_members.profile_order,
-- which orders the Organizations list.
ALTER TABLE public.profile_contributions ADD COLUMN timeline_order integer;
