-- 0188: Files is an opt-in tab, added from "+" like a canvas (one per channel,
-- shared with everyone in it), instead of always showing.
ALTER TABLE public.chat_channel_tabs DROP CONSTRAINT IF EXISTS chat_channel_tabs_kind_check;
ALTER TABLE public.chat_channel_tabs ADD CONSTRAINT chat_channel_tabs_kind_check CHECK (kind IN ('tasks', 'link', 'files'));
CREATE UNIQUE INDEX IF NOT EXISTS chat_channel_tabs_files_uniq ON public.chat_channel_tabs (channel_id) WHERE kind = 'files';
