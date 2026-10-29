-- 0239 let any update on an accepted row overwrite accepted_at (NEW won over OLD) and dropped 0219's search_path.
-- The first acceptance time now sticks; NEW.accepted_at only fills a missing one.
CREATE OR REPLACE FUNCTION public.set_connection_acceptance_time() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.status = 'accepted' THEN
        IF TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'accepted' THEN
            NEW.accepted_at := COALESCE(NEW.accepted_at, now());
        ELSE
            NEW.accepted_at := COALESCE(OLD.accepted_at, NEW.accepted_at, now());
        END IF;
    ELSE
        NEW.accepted_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;
