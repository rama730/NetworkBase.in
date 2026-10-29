import "server-only";

import type { AuthSnapshotResolution } from "@/lib/auth/snapshot";
import { logger } from "@/lib/logger";

// Suspensions and bans apply at once (F14). A suspension deletes the person's sessions, but a sign-in token is
// checked locally and stays valid for up to an hour; this gate closes that hour for every server read and write.

const REFRESH_MS = 30_000;
let cached: { at: number; since: Map<string, number> } | null = null;

/** Accounts suspended or banned right now, with when that started; one small query per server every 30 seconds. */
async function restrictedSince() {
  if (cached && Date.now() - cached.at < REFRESH_MS) return cached.since;
  const [{ db }, { sql }] = await Promise.all([import("@/lib/db"), import("drizzle-orm")]);
  const rows = await db.execute<{ subject_id: string; since: number }>(sql`
    SELECT subject_id, (extract(epoch FROM min(created_at)) * 1000)::bigint AS since FROM moderation_actions
    WHERE action IN ('suspension', 'ban') AND subject_id IS NOT NULL AND undone_at IS NULL AND reversed_at IS NULL
      AND lifted_at IS NULL AND paused_at IS NULL AND (ends_at IS NULL OR ends_at > now())
    GROUP BY subject_id`);
  cached = { at: Date.now(), since: new Map([...rows].map((r) => [r.subject_id, Number(r.since)])) };
  return cached.since;
}

/**
 * A suspended or banned person is signed out when their token predates the restriction. After signing in again
 * they see only the restricted screen: their server actions count as signed out, except the appeal.
 */
export async function withModerationGate(resolution: AuthSnapshotResolution, request: { target: string; serverAction: boolean }): Promise<AuthSnapshotResolution> {
  if (!resolution.user || !resolution.snapshot) return resolution;
  let since: number | undefined;
  try {
    since = (await restrictedSince()).get(resolution.user.id);
  } catch (error) {
    // The database guards still stop the main writes; never lock everyone out over a failed lookup.
    logger.warn("trust.session_gate_failed", { module: "trust", error: error instanceof Error ? error.message : String(error) });
    return resolution;
  }
  if (since === undefined) return resolution;
  const issuedMs = (resolution.snapshot.issuedAt ?? 0) * 1000;
  const oldToken = issuedMs < since;
  const blockedWrite = request.serverAction && !request.target.startsWith("/appeal/");
  return oldToken || blockedWrite ? { ...resolution, session: null, snapshot: null, user: null } : resolution;
}

/** Tests and a decision that just changed the list read it fresh. */
export function resetModerationGateCache() {
  cached = null;
}
