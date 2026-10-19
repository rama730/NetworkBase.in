-- 0206: Indexes behind every foreign key that lacked one (MIG-001 lineage gate, INDEX-003).
-- Deleting a message, user, channel or project row makes Postgres look up referencing rows by the FK columns;
-- without an index each lookup scans the table. chat_mentions/chat_saved get one
-- (channel_id, message_seq) index on the logical table, not one per cloned partition FK.
-- Partial indexes only count when their predicate is "<fk column> IS NOT NULL"; other partial
-- indexes cannot serve the FK lookup.
-- Built inside the migration transaction: chat_reactions is partitioned and the tables are small.
-- ponytail: brief write lock per table while building; build per partition without a lock if they grow.
CREATE INDEX IF NOT EXISTS chat_mentions_message_idx ON public.chat_mentions (channel_id, message_seq);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chat_saved_message_idx ON public.chat_saved (channel_id, message_seq);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chat_scheduled_messages_channel_idx ON public.chat_scheduled_messages (channel_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chat_reactions_user_idx ON public.chat_reactions (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chat_reports_reporter_idx ON public.chat_reports (reporter_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chat_pins_pinned_by_idx ON public.chat_pins (pinned_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chat_channels_created_by_idx ON public.chat_channels (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chat_channel_tabs_created_by_idx ON public.chat_channel_tabs (created_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chat_canvases_updated_by_idx ON public.chat_canvases (updated_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS projects_status_set_by_idx ON public.projects (status_set_by);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS email_outbox_user_idx ON public.email_outbox (user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS chat_channels_project_idx ON public.chat_channels (project_id) WHERE project_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS profile_project_contributions_profile_idx ON public.profile_project_contributions (profile_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS profile_project_contributions_project_ref_idx ON public.profile_project_contributions (project_id) WHERE project_id IS NOT NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS profile_project_contribution_stages_contribution_ref_idx ON public.profile_project_contribution_stages (contribution_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS profile_project_contribution_stages_profile_ref_idx ON public.profile_project_contribution_stages (profile_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_guidance_appointments_guide_idx ON public.project_guidance_appointments (guide_user_id);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS project_invitations_inviter_idx ON public.project_invitations (inviter_id);
--> statement-breakpoint
-- The (update_id, parent_id) FK: widen the parent lookup index instead of adding a second one.
DROP INDEX IF EXISTS public.project_update_comments_parent_idx;
--> statement-breakpoint
CREATE INDEX project_update_comments_parent_idx ON public.project_update_comments (parent_id, update_id) WHERE parent_id IS NOT NULL;
