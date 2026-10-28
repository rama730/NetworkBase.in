import { and, eq, isNull, lte, sql } from "drizzle-orm";

import { handOverLedChildProjects, handOverOwnedOrgs } from "@/lib/organizations/succession";
import { db } from "@/lib/db";
import { anonymizeChatAuthor, deleteDirectMessagesSql } from "@/lib/messaging/account";
import {
  accountDeletions,
  extensionRecoveryDrafts,
  profiles,
  projects,
} from "@/lib/db/schema";
import { logger } from "@/lib/logger";
import { queueDeletionCompletedEmail } from "@/lib/email/security-queue";
import { verifySignedJobRequestToken } from "@/lib/security/job-request";
import { createAdminClient } from "@/lib/supabase/server";
import { isLooseUuid } from "@/lib/validations/uuid";

export const ACCOUNT_HARD_DELETE_JOB_KIND = "account/hard-delete";

/**
 * SEC-C3: permanently delete a user's account and all associated data.
 *
 * This is NOT a `'use server'` server action — it lives in `src/lib` so it is
 * never exposed to the browser as an RPC endpoint. The only supported call
 * site is the Inngest cron (`src/inngest/functions/account-hard-delete.ts`),
 * which must mint a signed job-request token with the matching kind / actor /
 * subject triple. Any caller that cannot produce a valid token is rejected
 * before a single row is touched.
 *
 * DESTRUCTIVE — cannot be undone.
 */
export async function executeHardDelete(
  userId: string,
  deletionId: string,
  jobSignature: string,
): Promise<{ success: boolean; error?: string }> {
  try {
    if (!isLooseUuid(userId)) {
      return { success: false, error: "Invalid user ID" };
    }
    if (!isLooseUuid(deletionId)) {
      return { success: false, error: "Invalid deletion ID" };
    }

    // SEC-C3: require a valid signed job-request token. The token binds the
    // hard-delete to the exact (userId, deletionId) pair so a leaked token
    // can't be replayed against a different account.
    const signature = verifySignedJobRequestToken(jobSignature, {
      kind: ACCOUNT_HARD_DELETE_JOB_KIND,
      actorId: userId,
      subjectId: deletionId,
    });
    if (!signature.ok) {
      logger.error("account.hard-delete.unauthorized", {
        module: "account",
        userId,
        deletionId,
      });
      return { success: false, error: "Unauthorized" };
    }

    // Phase 1 (destructive, transactional): only from storage_scheduled, past
    // the grace period, not cancelled. The deletion row lock makes cancellation
    // and this phase mutually exclusive (COR-053).
    const phase = await db.transaction(async (tx) => {
      const [deletion] = await tx
        .select({ phase: accountDeletions.cleanupStatus })
        .from(accountDeletions)
        .where(and(
          eq(accountDeletions.id, deletionId),
          eq(accountDeletions.userId, userId),
          isNull(accountDeletions.cancelledAt),
          isNull(accountDeletions.completedAt),
          lte(accountDeletions.hardDeleteAt, new Date()),
        ))
        .for("update");
      if (!deletion) return "ineligible" as const;
      if (deletion.phase === "db_deleted") return "db_deleted" as const;
      if (deletion.phase !== "storage_scheduled") return deletion.phase;

      // A recovery draft without a lifecycle record would lose its cleanup
      // evidence when the profile cascade runs. Registration must finish first.
      const [unregisteredDraft] = await tx
        .select({ id: extensionRecoveryDrafts.id })
        .from(extensionRecoveryDrafts)
        .where(and(eq(extensionRecoveryDrafts.userId, userId), isNull(extensionRecoveryDrafts.assetId)))
        .limit(1);
      if (unregisteredDraft) return "registration_pending" as const;

      // Report §30.7: child projects pass on (again: someone may have made them lead during the grace), an org
      // still owned passes to its longest-serving admin, and only then do owned projects go. Individual
      // assignment copies go; team copies stay, shown as "Deleted user" (assignee set null by the cascade).
      await handOverLedChildProjects(tx, userId);
      if (await handOverOwnedOrgs(tx, userId)) return "org_owner_without_admin" as const;
      await tx.execute(sql`
        DELETE FROM tasks t WHERE t.assignee_id = ${userId}::uuid AND t.assignment_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = t.id AND tm.user_id <> ${userId}::uuid)`);
      await anonymizeChatAuthor(userId, tx);
      await tx.execute(deleteDirectMessagesSql(userId));
      await tx.delete(projects).where(eq(projects.ownerId, userId));
      await tx.execute(sql`
        UPDATE projects SET followers_count = GREATEST(0, followers_count - 1)
        WHERE id IN (SELECT project_id FROM project_follows WHERE user_id = ${userId}::uuid)
      `);
      // Decrement connected peers' connections_count before cascading profile deletion
      await tx.execute(sql`
        WITH deleted_peers AS (
          SELECT CASE WHEN requester_id = ${userId}::uuid THEN addressee_id ELSE requester_id END AS peer_id
          FROM connections
          WHERE status = 'accepted' AND (requester_id = ${userId}::uuid OR addressee_id = ${userId}::uuid)
        )
        UPDATE profiles
        SET connections_count = GREATEST(0, connections_count - 1), updated_at = now()
        WHERE id IN (SELECT peer_id FROM deleted_peers)
      `);
      await tx.delete(profiles).where(eq(profiles.id, userId));
      await tx
        .update(accountDeletions)
        .set({
          cleanupStatus: "db_deleted",
          cleanupDetails: { databaseCleanupAt: new Date().toISOString(), authCleanupPending: true },
        })
        .where(and(eq(accountDeletions.id, deletionId), eq(accountDeletions.cleanupStatus, "storage_scheduled")));
      return "db_deleted" as const;
    });
    if (phase !== "db_deleted") {
      return { success: false, error: phase === "ineligible" ? "Deletion record not found, cancelled or not yet due" : `Deletion is in phase ${phase}; retry later` };
    }

    // Phase 2: Auth deletion (idempotent). Failure keeps db_deleted for retry.
    const admin = await createAdminClient();
    let authError: { message: string } | null = null;
    try {
      const { error } = await admin.auth.admin.deleteUser(userId);
      // Already gone after a previous partial run is success.
      authError = error && !/not.?found/i.test(error.message) ? error : null;
    } catch (error) {
      authError = {
        message: error instanceof Error ? error.message : "Auth deletion not available",
      };
    }
    if (authError) {
      logger.error("account.hard-delete.auth-deletion.failed", {
        module: "account",
        userId,
        deletionId,
        error: authError.message,
      });
      return { success: false, error: `Auth deletion pending retry: ${authError.message}` };
    }

    await db
      .update(accountDeletions)
      .set({
        completedAt: new Date(),
        cleanupStatus: "completed",
        // Keep only registration identifiers until legalRetentionUntil. The
        // lifecycle job then anonymizes them automatically. The profile,
        // content, storage, and authentication identity are already deleted.
        reason: null,
        metadata: {},
        cleanupDetails: {
          databaseCleanupComplete: true,
          authCleanupComplete: true,
          completedAt: new Date().toISOString(),
          minimalRegistrationRecordRetained: true,
        },
      })
      .where(and(eq(accountDeletions.id, deletionId), eq(accountDeletions.cleanupStatus, "db_deleted")));

    // One last email to the address on the deletion record (the queue key makes a retried run send it once).
    const [record] = await db.select({ email: accountDeletions.email }).from(accountDeletions).where(eq(accountDeletions.id, deletionId)).limit(1);
    if (record?.email) await queueDeletionCompletedEmail(record.email, deletionId);

    return { success: true };
  } catch (error) {
    logger.error("account.hard-delete.failed", {
      module: "account",
      error: error instanceof Error ? error.message : String(error),
    });

    // Keep the durable phase so the next run resumes where this one stopped;
    // only record the error.
    try {
      await db
        .update(accountDeletions)
        .set({
          cleanupDetails: sql`coalesce(${accountDeletions.cleanupDetails}, '{}'::jsonb) || jsonb_build_object(
            'lastError', ${error instanceof Error ? error.message.slice(0, 500) : String(error).slice(0, 500)},
            'lastErrorAt', now()
          )`,
        })
        .where(eq(accountDeletions.id, deletionId));
    } catch {
      // Best effort
    }

    return { success: false, error: "Failed to execute hard delete" };
  }
}
