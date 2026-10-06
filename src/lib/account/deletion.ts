import "server-only";

import { and, eq, isNull, or, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  accountDeletions,
  connections,
  profileAuditEvents,
  profiles,
  projectFollows,
  projects,
} from "@/lib/db/schema";

/**
 * Account deletion lifecycle (COR-053). `cleanup_status` names one phase:
 *   pending -> storage_running -> storage_scheduled -> db_deleted -> completed
 * `failed` is a storage-registration blocker the cleanup worker retries.
 * Every transition is a conditional update from the expected phase; the
 * finalizer and cancellation both lock the deletion row, so cancellation can
 * never interleave with the destructive phase, and phases before db_deleted
 * stay cancellable.
 */
const CANCELLABLE_DELETION_PHASES = ["pending", "storage_running", "storage_scheduled", "failed"] as const;

const ACCOUNT_DELETION_GRACE_DAYS = 30;
const LEGAL_REGISTRATION_RETENTION_DAYS = 180;
type ProfileVisibility = "public" | "connections" | "private";
const PROFILE_VISIBILITIES = new Set<string>(["public", "connections", "private"]);

type ScheduleAccountDeletionResult =
  | { ok: true; deletionId: string; hardDeleteAt: Date; affectedUserIds: string[] }
  | { ok: false; code: "ALREADY_SCHEDULED" };

/**
 * Soft-deletes the account and opens the grace period. The caller must have
 * authenticated the user and verified a fresh step-up (see the
 * /api/v1/account/delete route); this command is not a server action.
 */
export async function scheduleAccountDeletionForUser(input: {
  userId: string;
  email: string;
  username: string | null;
  reason: string | null;
}): Promise<ScheduleAccountDeletionResult> {
  const now = new Date();
  const hardDeleteAt = new Date(now.getTime() + ACCOUNT_DELETION_GRACE_DAYS * 86_400_000);
  const legalRetentionUntil = new Date(now.getTime() + LEGAL_REGISTRATION_RETENTION_DAYS * 86_400_000);

  return db.transaction(async (tx) => {
    // Serialize concurrent requests for the same user on the profile row.
    const [profile] = await tx
      .select({ visibility: profiles.visibility })
      .from(profiles)
      .where(eq(profiles.id, input.userId))
      .for("update");
    const [open] = await tx
      .select({ id: accountDeletions.id })
      .from(accountDeletions)
      .where(and(
        eq(accountDeletions.userId, input.userId),
        isNull(accountDeletions.cancelledAt),
        isNull(accountDeletions.completedAt),
      ))
      .limit(1);
    if (open) return { ok: false, code: "ALREADY_SCHEDULED" } as const;

    const [peers, ownedProjects] = await Promise.all([
      tx.select({ requesterId: connections.requesterId, addresseeId: connections.addresseeId })
        .from(connections)
        .where(or(eq(connections.requesterId, input.userId), eq(connections.addresseeId, input.userId))),
      tx.select({ id: projects.id }).from(projects).where(eq(projects.ownerId, input.userId)),
    ]);

    await tx.update(profiles)
      .set({ deletedAt: now, visibility: "private", updatedAt: now })
      .where(eq(profiles.id, input.userId));

    const [deletion] = await tx.insert(accountDeletions).values({
      userId: input.userId,
      email: input.email,
      username: input.username,
      reason: input.reason,
      scheduledAt: now,
      hardDeleteAt,
      legalRetentionUntil,
      cleanupStatus: "pending",
      metadata: {
        // Restored exactly on cancellation (SEC-002).
        previousVisibility: profile?.visibility ?? "private",
        projectCount: ownedProjects.length,
        connectionCount: peers.length,
      },
    }).returning({ id: accountDeletions.id });

    await tx.delete(connections).where(or(eq(connections.requesterId, input.userId), eq(connections.addresseeId, input.userId)));
    await tx.execute(sql`
      UPDATE projects SET followers_count = GREATEST(0, followers_count - 1)
      WHERE id IN (SELECT project_id FROM project_follows WHERE user_id = ${input.userId}::uuid)
    `);
    await tx.delete(projectFollows).where(eq(projectFollows.userId, input.userId));
    await tx.delete(profileAuditEvents).where(eq(profileAuditEvents.userId, input.userId));

    const affectedUserIds = peers
      .map((row) => (row.requesterId === input.userId ? row.addresseeId : row.requesterId))
      .filter((id) => id !== input.userId);
    return { ok: true, deletionId: deletion!.id, hardDeleteAt, affectedUserIds } as const;
  });
}

/**
 * Cancels a deletion that has not reached the destructive phase and restores
 * the profile with the visibility it had before (SEC-002). Rows written before
 * that was recorded stay private until the user changes it.
 */
export async function cancelAccountDeletionForUser(userId: string): Promise<"cancelled" | "not_found" | "too_late"> {
  return db.transaction(async (tx) => {
    const [deletion] = await tx
      .select({ id: accountDeletions.id, phase: accountDeletions.cleanupStatus, metadata: accountDeletions.metadata })
      .from(accountDeletions)
      .where(and(
        eq(accountDeletions.userId, userId),
        isNull(accountDeletions.cancelledAt),
        isNull(accountDeletions.completedAt),
      ))
      .limit(1)
      .for("update");
    if (!deletion) return "not_found";
    if (!(CANCELLABLE_DELETION_PHASES as readonly string[]).includes(deletion.phase)) return "too_late";

    const now = new Date();
    await tx.update(accountDeletions).set({ cancelledAt: now }).where(eq(accountDeletions.id, deletion.id));
    const previous = deletion.metadata?.previousVisibility;
    await tx.update(profiles)
      .set({
        deletedAt: null,
        visibility: typeof previous === "string" && PROFILE_VISIBILITIES.has(previous) ? previous as ProfileVisibility : "private",
        updatedAt: now,
      })
      .where(eq(profiles.id, userId));
    return "cancelled";
  });
}
