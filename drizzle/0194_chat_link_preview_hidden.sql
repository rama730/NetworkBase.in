-- 0194: authors can remove a message's link preview (round 3 #260). A flag on the
-- message, so every viewer stops showing the card; the link itself stays in the text.
ALTER TABLE public.chat_messages ADD COLUMN IF NOT EXISTS link_preview_hidden boolean NOT NULL DEFAULT false;
