import { and, eq, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles, userBlocks } from "@/lib/db/schema";
import { recordPrivacyEvent } from "@/lib/privacy/audit";
import { getRedisClient } from "@/lib/redis";
import { invalidateDiscoverCacheForUsers } from "@/lib/connections/internal-helpers";
import { userTopic } from "@/lib/messaging/constants";
import { broadcast } from "@/lib/realtime/server-broadcast";

// Blocking (Trust & Safety report, Blocking tab). Blocks live in user_blocks, one row per direction (B1); the database
// owns the rule (app_private.blocked_between) and every side effect (block_user, undo_block), so this file only
// calls them, records the privacy event and tells both people's screens that something changed (B11).

export type BlockSource = "profile" | "message" | "comment" | "person_card" | "member_list" | "report" | "settings";
export const BLOCK_UNDO_SECONDS = 10;

/** Everyone blocked by or blocking this person: lists filter with it in memory (B2). */
export async function blockedIdsFor(userId: string): Promise<Set<string>> {
  const rows = await db.select({ blockerId: userBlocks.blockerId, blockedId: userBlocks.blockedId }).from(userBlocks)
    .where(or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)));
  return new Set(rows.map((r) => (r.blockerId === userId ? r.blockedId : r.blockerId)));
}

export async function isBlockedBetween(a: string | null | undefined, b: string | null | undefined): Promise<boolean> {
  if (!a || !b || a === b) return false;
  const [row] = await db.execute<{ blocked: boolean }>(sql`SELECT app_private.blocked_between(${a}::uuid, ${b}::uuid) AS blocked`);
  return Boolean(row?.blocked);
}

/** A per-person number that rises on every block and unblock, part of every cached people answer (B18). */
export async function blockVersion(userId: string): Promise<number> {
  const redis = getRedisClient();
  if (!redis) return 0;
  return Number(await redis.get<number>(`blocks:v:${userId}`).catch(() => 0)) || 0;
}

async function afterChange(blockerId: string, targetUserId: string) {
  const redis = getRedisClient();
  if (redis) {
    await Promise.allSettled([
      redis.srem(`user:${blockerId}:connections`, targetUserId),
      redis.srem(`user:${targetUserId}:connections`, blockerId),
      redis.incr(`blocks:v:${blockerId}`),
      redis.incr(`blocks:v:${targetUserId}`),
    ]);
  }
  await invalidateDiscoverCacheForUsers([blockerId, targetUserId]);
  // Both people's open screens refetch (B11, B35). The event says only that a relationship changed, never what.
  await broadcast([
    { topic: userTopic(blockerId), event: "relationship", payload: { userId: targetUserId } },
    { topic: userTopic(targetUserId), event: "relationship", payload: { userId: blockerId } },
  ]);
}

export async function setUserBlocked(input: {
  blockerId: string;
  targetUserId: string;
  blocked: boolean;
  request: Request;
  source?: BlockSource;
  caseId?: string | null;
}) {
  if (input.blockerId === input.targetUserId) throw new Error("cannot block self");
  const [target] = await db.select({ id: profiles.id, username: profiles.username }).from(profiles).where(eq(profiles.id, input.targetUserId)).limit(1);
  if (!target) return null;

  await db.transaction(async (tx) => {
    if (input.blocked) {
      await tx.execute(sql`SELECT app_private.block_user(${input.blockerId}::uuid, ${input.targetUserId}::uuid, ${input.source ?? "profile"}, ${input.caseId ?? null}::uuid)`);
    } else {
      await tx.delete(userBlocks).where(and(eq(userBlocks.blockerId, input.blockerId), eq(userBlocks.blockedId, input.targetUserId)));
    }
    await recordPrivacyEvent({
      executor: tx,
      userId: input.blockerId,
      eventType: input.blocked ? "account_blocked" : "account_unblocked",
      request: input.request,
      metadata: { targetUserId: input.targetUserId, targetUsername: target.username ?? null, source: input.source ?? "profile" },
    });
  });
  await afterChange(input.blockerId, input.targetUserId);
  return target;
}

/** Undo within 10 seconds puts back everything the block removed (B12, B39). */
export async function undoUserBlock(blockerId: string, targetUserId: string) {
  const [row] = await db.execute<{ ok: boolean }>(sql`SELECT app_private.undo_block(${blockerId}::uuid, ${targetUserId}::uuid, ${BLOCK_UNDO_SECONDS + 5}) AS ok`);
  if (!row?.ok) return false;
  await afterChange(blockerId, targetUserId);
  return true;
}

/** The restore record is only for Undo; past the window it goes, so nothing about the old relationship lingers. */
export async function clearExpiredBlockRestores() {
  const rows = await db.execute(sql`
    UPDATE user_blocks SET restore = NULL WHERE restore IS NOT NULL AND created_at < now() - make_interval(secs => ${BLOCK_UNDO_SECONDS * 6})`);
  return rows.count ?? 0;
}
