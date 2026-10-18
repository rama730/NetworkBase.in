import { and, eq, or, sql, inArray } from "drizzle-orm";
import { connections, profiles } from "@/lib/db/schema";

type Tx = any;

// Same key as sendConnectionRequest, so connection changes and blocks on a pair serialize together.
function lockPair(tx: Tx, a: string, b: string) {
  return tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`connection-pair:${[a, b].sort().join(":")}`}, 0))`);
}

export async function replaceRelationshipWithBlockedState(
  tx: Tx,
  blockerId: string,
  blockedUserId: string,
  now: Date,
) {
  // SEC-010: one row per pair means one owner. A pair lock keeps two simultaneous blocks from
  // both passing the check below. Whoever blocked first keeps the row; the second blocker gets
  // the same success answer (a rejection would tell them they are blocked) and cannot remove it.
  // ponytail: a reciprocal block is not stored; directional edges (DB-RESTRUCTURE-027) when needed.
  await lockPair(tx, blockerId, blockedUserId);
  const [existingBlock] = await tx
    .select({ id: connections.id })
    .from(connections)
    .where(
      and(
        eq(connections.status, "blocked"),
        or(
          and(eq(connections.requesterId, blockerId), eq(connections.addresseeId, blockedUserId)),
          and(eq(connections.requesterId, blockedUserId), eq(connections.addresseeId, blockerId)),
        ),
      ),
    )
    .limit(1);
  if (existingBlock) return existingBlock.id;

  const deleted = await tx
    .delete(connections)
    .where(
      or(
        and(eq(connections.requesterId, blockerId), eq(connections.addresseeId, blockedUserId)),
        and(eq(connections.requesterId, blockedUserId), eq(connections.addresseeId, blockerId)),
      ),
    )
    .returning({ status: connections.status });

  const wasAccepted = deleted.some((row: any) => row.status === "accepted");
  if (wasAccepted) {
    await tx
      .update(profiles)
      .set({
        connectionsCount: sql`GREATEST(0, ${profiles.connectionsCount} - 1)`,
        updatedAt: now,
      })
      .where(inArray(profiles.id, [blockerId, blockedUserId]));
  }

  const inserted = await tx
    .insert(connections)
    .values({
      requesterId: blockerId,
      addresseeId: blockedUserId,
      status: "blocked",
      blockedBy: blockerId,
      blockedAt: now,
    })
    .returning({ id: connections.id });

  return inserted[0]?.id ?? null;
}

export async function clearBlockedRelationshipState(
  tx: Tx,
  blockerId: string,
  blockedUserId: string,
) {
  await lockPair(tx, blockerId, blockedUserId);
  await tx
    .delete(connections)
    .where(
      or(
        and(
          eq(connections.requesterId, blockerId),
          eq(connections.addresseeId, blockedUserId),
          eq(connections.status, "blocked"),
          eq(connections.blockedBy, blockerId),
        ),
        and(
          eq(connections.requesterId, blockedUserId),
          eq(connections.addresseeId, blockerId),
          eq(connections.status, "blocked"),
          eq(connections.blockedBy, blockerId),
        ),
      ),
    );
}
