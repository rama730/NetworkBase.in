import { and, eq, isNull, or, sql } from 'drizzle-orm'
import { db } from '@/lib/db'
import { connections, profiles } from '@/lib/db/schema'

/** Authoritative totals: both directions, active peers, no stored counter drift. */
export async function getConnectionStatsForUser(targetId: string) {
    const [stats] = await db.select({
        totalConnections: sql<number>`count(*) FILTER (WHERE ${connections.status} = 'accepted')::int`,
        pendingIncoming: sql<number>`count(*) FILTER (WHERE ${connections.status} = 'pending' AND ${connections.addresseeId} = ${targetId})::int`,
        pendingSent: sql<number>`count(*) FILTER (WHERE ${connections.status} = 'pending' AND ${connections.requesterId} = ${targetId})::int`,
    })
        .from(connections)
        .innerJoin(profiles, eq(profiles.id, sql`CASE WHEN ${connections.requesterId} = ${targetId} THEN ${connections.addresseeId} ELSE ${connections.requesterId} END`))
        .where(and(
            or(eq(connections.requesterId, targetId), eq(connections.addresseeId, targetId)),
            isNull(profiles.deletedAt),
        ))
    return {
        totalConnections: Number(stats?.totalConnections ?? 0),
        pendingIncoming: Number(stats?.pendingIncoming ?? 0),
        pendingSent: Number(stats?.pendingSent ?? 0),
    }
}
