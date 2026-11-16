import "server-only";

import { randomBytes } from "node:crypto";

import { and, asc, eq, isNotNull, lte, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import { scheduleWorkspaceStorageDeletion } from "@/lib/workspaces/server/lifecycle";

/**
 * nb learn's practice workspace (report C1, C15): private, owned by the person, one at a time, and deleted when the
 * practice ends; one left behind goes in the daily sweep once its 24 hours are up. Nothing reaches a real workspace.
 */
export const SANDBOX_HOURS = 24;
const columns = { id: workspaces.id, slug: workspaces.slug, title: workspaces.title, expiresAt: workspaces.sandboxExpiresAt };

/** The person's practice workspace: the one they have, or a new one. */
export async function startSandbox(userId: string) {
  const [existing] = await db.select(columns).from(workspaces).where(and(eq(workspaces.ownerId, userId), isNotNull(workspaces.sandboxExpiresAt))).limit(1);
  if (existing && existing.expiresAt && existing.expiresAt > new Date()) return { ...existing, created: false };
  if (existing) await endSandbox(userId, existing.id);
  // Two starts at once (two terminals): one makes it, the other finds it (the one-per-person index decides).
  const made = await db.transaction(async (tx) => {
    const [row] = await tx.insert(workspaces).values({
      ownerId: userId,
      title: "Practice (nb learn)",
      slug: `practice-${randomBytes(4).toString("hex")}`,
      shortDescription: `A practice workspace for nb learn. It's deleted when the practice ends, or after ${SANDBOX_HOURS} hours.`,
      visibility: "private",
      sandboxExpiresAt: sql`now() + make_interval(hours => ${SANDBOX_HOURS})`,
    }).returning(columns);
    await tx.insert(workspaceMembers).values({ projectId: row!.id, userId, role: "owner" });
    return row!;
  }).catch(async (error: unknown) => {
    if ((error as { code?: string; cause?: { code?: string } })?.code !== "23505" && (error as { cause?: { code?: string } })?.cause?.code !== "23505") throw error;
    return null;
  });
  if (!made) {
    const [other] = await db.select(columns).from(workspaces).where(and(eq(workspaces.ownerId, userId), isNotNull(workspaces.sandboxExpiresAt))).limit(1);
    if (!other) throw new Error("Couldn’t make the practice workspace");
    return { ...other, created: false };
  }
  return { ...made, created: true };
}

/**
 * Deletes a practice workspace, as deleting a workspace does (its stored files go too). Only while it's still just
 * practice: once anyone else is in it, invited or applying, or it's inside an organization, it has become a real
 * workspace, so it's kept and stops being a sandbox (security review). Never a real workspace.
 * @returns "deleted", "kept" (it became real) or "missing"
 */
export async function endSandbox(userId: string | null, workspaceId: string): Promise<"deleted" | "kept" | "missing"> {
  return db.transaction(async (tx) => {
    const [row] = await tx.execute<{ id: string; alone: boolean }>(sql`
      SELECT w.id,
             (w.parent_id IS NULL AND w.kind = 'workspace'
              AND NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id <> w.owner_id)
              AND NOT EXISTS (SELECT 1 FROM workspace_invitations i WHERE i.workspace_id = w.id)
              AND NOT EXISTS (SELECT 1 FROM role_applications a WHERE a.workspace_id = w.id)) AS alone
      FROM workspaces w
      WHERE w.id = ${workspaceId}::uuid AND w.sandbox_expires_at IS NOT NULL ${userId ? sql`AND w.owner_id = ${userId}::uuid` : sql``}
      FOR UPDATE OF w
    `);
    if (!row) return "missing";
    if (!row.alone) {
      await tx.update(workspaces).set({ sandboxExpiresAt: null }).where(eq(workspaces.id, workspaceId));
      return "kept";
    }
    await scheduleWorkspaceStorageDeletion(tx, workspaceId);
    await tx.delete(workspaces).where(eq(workspaces.id, workspaceId));
    return "deleted";
  });
}

/** The daily sweep (download-history-retention): practice workspaces past their end time. */
export async function sweepSandboxes(limit = 50) {
  const due = await db.select({ id: workspaces.id }).from(workspaces)
    .where(and(isNotNull(workspaces.sandboxExpiresAt), lte(workspaces.sandboxExpiresAt, sql`now()`)))
    .orderBy(asc(workspaces.sandboxExpiresAt)).limit(limit);
  let deleted = 0;
  let kept = 0;
  for (const w of due) {
    // One that can't be deleted now doesn't stop the rest; it's tried again tomorrow.
    const r = await endSandbox(null, w.id).catch((error: unknown) => {
      logger.warn("sandbox.sweep_failed", { module: "sandbox", workspaceId: w.id, error: error instanceof Error ? error.message : String(error) });
      return "missing" as const;
    });
    if (r === "deleted") deleted += 1;
    if (r === "kept") kept += 1;
  }
  return { deleted, kept };
}
