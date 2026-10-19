import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/lib/db';

export type SharedConnectionsSummary = {
    targetIds: string[];
    total: number;
    people: Array<{ id: string; username: string | null; fullName: string | null; avatarUrl: string | null }>;
};

/** Distinct, visible accepted peers shared with the suggestions actually shown. */
export async function readSharedConnections(viewerId: string, targetIds: string[], page: { limit?: number; offset?: number } = {}): Promise<SharedConnectionsSummary> {
    const targets = [...new Set(targetIds.filter(id => id !== viewerId))];
    if (targets.length === 0) return { targetIds: [], total: 0, people: [] };
    const rows = await db.execute<SharedConnectionsSummary['people'][number] & { total: number }>(sql`
        WITH viewer_peers AS (
            SELECT addressee_id AS id FROM connections WHERE requester_id = ${viewerId}::uuid AND status = 'accepted'
            UNION
            SELECT requester_id FROM connections WHERE addressee_id = ${viewerId}::uuid AND status = 'accepted'
        ), targets AS (
            SELECT jsonb_array_elements_text(${JSON.stringify(targets)}::jsonb)::uuid AS id
        )
        SELECT p.id, p.username, p.full_name AS "fullName", p.avatar_url AS "avatarUrl", count(*) OVER ()::int AS total
        FROM profiles p
        JOIN viewer_peers vp ON vp.id = p.id
        WHERE p.id <> ${viewerId}::uuid AND p.deleted_at IS NULL AND p.onboarding_status = 'completed'
          AND coalesce(p.visibility, 'public') IN ('public', 'connections')
          AND NOT EXISTS (
              SELECT 1 FROM connections blocked WHERE blocked.status = 'blocked'
              AND ((blocked.requester_id = ${viewerId}::uuid AND blocked.addressee_id = p.id)
                OR (blocked.addressee_id = ${viewerId}::uuid AND blocked.requester_id = p.id))
          )
          AND EXISTS (
              SELECT 1 FROM targets t JOIN connections c ON c.status = 'accepted'
                AND ((c.requester_id = t.id AND c.addressee_id = p.id)
                  OR (c.addressee_id = t.id AND c.requester_id = p.id))
          )
        ORDER BY lower(coalesce(p.full_name, p.username, p.id::text)), p.id
        LIMIT ${Math.max(1, Math.min(page.limit ?? 4, 20))} OFFSET ${Math.max(0, Math.min(page.offset ?? 0, 10000))}
    `);
    return {
        targetIds: targets,
        total: Number(rows[0]?.total ?? 0),
        people: Array.from(rows, ({ id, username, fullName, avatarUrl }) => ({ id, username, fullName, avatarUrl })),
    };
}
