-- No client listens for changes on these three: update cards moved to database broadcasts (0275) and comment likes refresh by request. Each write to a published table costs Realtime work for nothing.
ALTER PUBLICATION supabase_realtime DROP TABLE public.task_comment_likes, public.workspace_update_comments, public.workspace_updates;
