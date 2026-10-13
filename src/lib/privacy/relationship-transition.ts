import { and, eq, or, sql, inArray } from "drizzle-orm";
import { connections, profiles } from "@/lib/db/schema";

type Tx = any;

export async function replaceRelationshipWithBlockedState(
  tx: Tx,
  blockerId: string,
  blockedUserId: string,
  now: Date,
) {
  // SEC-010: Check if an existing block row exists between this pair
  const existingBlock = await tx
    .select({ id: connections.id, status: connections.status, blockedBy: connections.blockedBy })
    .from(connections)
    .where(
      or(
        and(eq(connections.requesterId, blockerId), eq(connections.addresseeId, blockedUserId)),
        and(eq(connections.requesterId, blockedUserId), eq(connections.addresseeId, blockerId)),
      ),
    )
    .limit(1);

  if (existingBlock.length > 0 && existingBlock[0].status === "blocked") {
    // If target has already blocked this user, preserve target's block row without deletion or overwrite.
    if (existingBlock[0].blockedBy === blockedUserId || existingBlock[0].blockedBy === blockerId) {
      return existingBlock[0].id;
    }
  }

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
