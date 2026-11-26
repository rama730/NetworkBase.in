-- Messages mix live check (2026-11-26). 0149's CHECK matched previews with '{864}', past Postgres's regex repeat
-- limit (255): every write of a pixel preview errored, so no thumbnail, preview, length or waveform was ever saved.
-- Same rule, checked by length. And the chat bucket takes the audio the app already accepts (voice notes failed).
SET LOCAL lock_timeout = '5s';
--> statement-breakpoint
ALTER TABLE public.chat_attachments DROP CONSTRAINT chat_attachments_media_check;
--> statement-breakpoint
ALTER TABLE public.chat_attachments ADD CONSTRAINT chat_attachments_media_check CHECK (
  (preview IS NULL OR (length(preview) = 864 AND preview ~ '^[0-9a-f]+$'))
  AND (duration_ms IS NULL OR (duration_ms >= 0 AND duration_ms <= 86400000))
  AND (peaks IS NULL OR (cardinality(peaks) <= 48 AND 0 <= ALL (peaks) AND 100 >= ALL (peaks)))
) NOT VALID; -- no row could hold a preview yet (every write failed): nothing to scan
--> statement-breakpoint
UPDATE storage.buckets
SET allowed_mime_types = ARRAY(SELECT DISTINCT unnest(allowed_mime_types || ARRAY[
  'audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/ogg', 'audio/webm', 'audio/wav', 'audio/x-wav', 'audio/flac'
]::text[]) ORDER BY 1)
WHERE id = 'chat-attachments' AND allowed_mime_types IS NOT NULL;
