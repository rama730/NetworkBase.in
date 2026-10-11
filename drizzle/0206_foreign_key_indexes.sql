-- 0206: Indexes behind every foreign key that lacked one (MIG-001 lineage gate, INDEX-003).
-- Deleting a message, user or channel makes Postgres look up referencing rows by the FK columns;
-- without an index each lookup scans the table. chat_mentions/chat_saved get one
-- (channel_id, message_seq) index on the logical table, not one per cloned partition FK.
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
