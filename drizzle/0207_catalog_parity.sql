-- 0207: Production and a fresh baseline replay must have identical catalogs (MIG-001).
-- 1. "Public avatars can be viewed by anyone" was created outside the journal. The avatars bucket
--    is public, so object URLs need no policy; the policy only let anyone list every avatar key.
-- 2. 0180 wrote `idx BETWEEN 0 AND 9`, stored as a nested AND that a schema reload flattens, so
--    the two catalogs printed different text for the same rule. Restate it flat on both.
DROP POLICY IF EXISTS "Public avatars can be viewed by anyone" ON storage.objects;
--> statement-breakpoint
ALTER TABLE public.chat_attachments
  DROP CONSTRAINT chat_attachments_shape_check,
  ADD CONSTRAINT chat_attachments_shape_check CHECK (idx >= 0 AND idx <= 9 AND size >= 0 AND char_length(name) <= 255);
