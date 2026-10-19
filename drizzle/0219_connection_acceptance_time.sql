-- Historical update/request dates cannot establish when a connection was accepted.
ALTER TABLE public.connections ADD COLUMN IF NOT EXISTS accepted_at timestamptz;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION public.set_connection_acceptance_time() RETURNS trigger
LANGUAGE plpgsql SET search_path = public, pg_temp AS $$
BEGIN
    IF NEW.status = 'accepted' THEN
        IF TG_OP = 'INSERT' THEN
            NEW.accepted_at := now();
        ELSIF OLD.status IS DISTINCT FROM 'accepted' THEN
            NEW.accepted_at := now();
        ELSE
            NEW.accepted_at := OLD.accepted_at;
        END IF;
    ELSE
        NEW.accepted_at := NULL;
    END IF;
    RETURN NEW;
END;
$$;
--> statement-breakpoint
DROP TRIGGER IF EXISTS connections_acceptance_time ON public.connections;
CREATE TRIGGER connections_acceptance_time BEFORE INSERT OR UPDATE ON public.connections
FOR EACH ROW EXECUTE FUNCTION public.set_connection_acceptance_time();
