-- Drop old dangling policies created in migration 0063
DROP POLICY IF EXISTS "Users can create connection requests" ON public.connections;
DROP POLICY IF EXISTS "Users can update own connections" ON public.connections;
DROP POLICY IF EXISTS "Users can view own connections" ON public.connections;
DROP POLICY IF EXISTS connections_insert_own ON public.connections;
DROP POLICY IF EXISTS connections_update_own ON public.connections;

-- Explicitly revoke direct mutation access from public PostgREST API
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.connections FROM anon, authenticated;

-- Replace SELECT policy to prevent leaking block attribution to blocked users
DROP POLICY IF EXISTS connections_select_participant_visible ON public.connections;
CREATE POLICY connections_select_participant_visible ON public.connections
  FOR SELECT TO authenticated
  USING (
    (auth.uid() = requester_id OR auth.uid() = addressee_id)
    AND (status <> 'blocked' OR blocked_by = auth.uid())
  );

-- Allow updating accepted_at on already-accepted rows without reverting to null
CREATE OR REPLACE FUNCTION public.set_connection_acceptance_time()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status = 'accepted' THEN
        IF TG_OP = 'INSERT' THEN
            NEW.accepted_at := COALESCE(NEW.accepted_at, now());
        ELSIF OLD.status IS DISTINCT FROM 'accepted' THEN
            NEW.accepted_at := COALESCE(NEW.accepted_at, now());
        ELSE
            NEW.accepted_at := COALESCE(NEW.accepted_at, OLD.accepted_at, now());
        END IF;
    ELSE
        NEW.accepted_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;

-- Backfill accepted_at from updated_at or created_at for legacy accepted rows
UPDATE public.connections
SET accepted_at = COALESCE(updated_at, created_at, now())
WHERE status = 'accepted' AND accepted_at IS NULL;

-- Constraint: Accepted status strictly requires accepted_at timestamp
ALTER TABLE public.connections
  DROP CONSTRAINT IF EXISTS connections_status_accepted_at_check;
ALTER TABLE public.connections
  ADD CONSTRAINT connections_status_accepted_at_check
  CHECK (status <> 'accepted' OR accepted_at IS NOT NULL);

-- Immutability trigger: prevent connection participants from being altered on UPDATE
CREATE OR REPLACE FUNCTION public.prevent_connection_pair_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.requester_id IS DISTINCT FROM OLD.requester_id OR NEW.addressee_id IS DISTINCT FROM OLD.addressee_id THEN
    RAISE EXCEPTION 'Connection participants cannot be altered.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS connections_immutability_trigger ON public.connections;
CREATE TRIGGER connections_immutability_trigger
  BEFORE UPDATE ON public.connections
  FOR EACH ROW EXECUTE FUNCTION public.prevent_connection_pair_mutation();

-- High-concurrency partial covering B-tree indexes for zero-sort pagination
CREATE INDEX IF NOT EXISTS connections_addressee_pending_created_idx 
ON public.connections (addressee_id, created_at DESC, id DESC)
WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS connections_requester_pending_created_idx 
ON public.connections (requester_id, created_at DESC, id DESC)
WHERE status = 'pending';
