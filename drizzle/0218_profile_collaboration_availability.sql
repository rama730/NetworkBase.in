-- Availability is independent of saved roles/capacity. Preserve the previous
-- visible state once; a new profile starts paused. Replays preserve explicit false.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS open_to_collaborate boolean;
--> statement-breakpoint
UPDATE public.profiles
SET open_to_collaborate = (jsonb_array_length(COALESCE(open_to, '[]'::jsonb)) > 0 OR hours_per_week IS NOT NULL)
WHERE open_to_collaborate IS NULL;
--> statement-breakpoint
ALTER TABLE public.profiles ALTER COLUMN open_to_collaborate SET DEFAULT false,
    ALTER COLUMN open_to_collaborate SET NOT NULL;
--> statement-breakpoint
-- Repair the compatibility projection from live accepted relationships, including
-- both directions and excluding deleted peers. UI totals read the same source.
WITH counts AS (
    SELECT p.id, COUNT(c.id)::int AS total
    FROM public.profiles p
    LEFT JOIN public.connections c ON c.status = 'accepted'
        AND (c.requester_id = p.id OR c.addressee_id = p.id)
        AND EXISTS (
            SELECT 1 FROM public.profiles peer
            WHERE peer.id = CASE WHEN c.requester_id = p.id THEN c.addressee_id ELSE c.requester_id END
                AND peer.deleted_at IS NULL
        )
    GROUP BY p.id
)
UPDATE public.profiles p SET connections_count = counts.total
FROM counts WHERE p.id = counts.id AND p.connections_count IS DISTINCT FROM counts.total;
