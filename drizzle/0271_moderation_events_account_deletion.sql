-- The moderation log stays append-only, but deleting an account (or a case) blanks its id on the log through
-- ON DELETE SET NULL, which is an UPDATE. 0269's trigger refused every UPDATE, so the account of anyone with a log
-- entry (an appeal, a claim, a note) could never be deleted. Only that blanking is allowed now; nothing else changes.
CREATE OR REPLACE FUNCTION app_private.moderation_events_append_only() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF NEW.id = OLD.id AND NEW.kind = OLD.kind AND NEW.data = OLD.data AND NEW.created_at = OLD.created_at
    AND (NEW.actor_id IS NULL OR NEW.actor_id = OLD.actor_id)
    AND (NEW.case_id IS NULL OR NEW.case_id = OLD.case_id) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION USING ERRCODE = '42501', MESSAGE = 'moderation_events_append_only';
END
$$;
