-- Messages mix, Phase 10 (media): what a tile needs before the file itself loads. All nullable; old rows stay as they are.
--   thumb_asset_id: a 640 px WebP for a photo, or a poster frame for a video (the sender's own verified upload)
--   preview:        a 12×12 colour grid (RGB hex, 864 chars) painted at once, pixelated
--   duration_ms:    video and audio length
--   peaks:          48 bars (0–100) for an audio waveform
-- Give up rather than queue sends behind this migration's locks.
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE public.chat_attachments
  ADD COLUMN thumb_asset_id uuid,
  ADD COLUMN preview text,
  ADD COLUMN duration_ms integer,
  ADD COLUMN peaks smallint[];
--> statement-breakpoint
ALTER TABLE public.chat_attachments ADD CONSTRAINT chat_attachments_media_check CHECK (
  (preview IS NULL OR preview ~ '^[0-9a-f]{864}$')
  AND (duration_ms IS NULL OR (duration_ms >= 0 AND duration_ms <= 86400000))
  AND (peaks IS NULL OR (cardinality(peaks) <= 48 AND 0 <= ALL (peaks) AND 100 >= ALL (peaks)))
) NOT VALID; -- the columns are new, so every existing row is NULL: nothing to scan
--> statement-breakpoint
-- The attachment route serves a thumbnail to the conversation's members: find it by its asset.
CREATE INDEX chat_attachments_thumb_idx ON public.chat_attachments (thumb_asset_id) WHERE thumb_asset_id IS NOT NULL;
