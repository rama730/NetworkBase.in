import { inngest } from "../client";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { githubSyncRuns, workspaceNodeLocks } from "@/lib/db/schema";
import { runReviewedGitHubSync } from "@/lib/github/sync-runner";
import { cleanupReviewedSyncSnapshots } from "@/lib/github/sync-service";
import {
  verifySignedJobRequestToken,
  createSignedJobRequestToken,
} from "@/lib/security/job-request";
import { deleteExpiredFileLeases } from "@/lib/files/file-lock-service";
import { cleanupExpiredUploadIntents } from "@/lib/upload/upload-intents";

// ponytail: per-project concurrency limit 1 unlocks multi-tenant parallel execution. ceiling: 1 job per project at once. upgrade: per-branch concurrency keys if parallel branch sync required.
const concurrency = { limit: 1, key: "event.data.projectId" };
export const gitPush = inngest.createFunction(
  { id: "git-push", retries: 0, concurrency },
  { event: "git/push" },
  async ({ event, step }) => {
    const { projectId, userId, runId, jobSignature } = event.data;
    if (
      !runId ||
      !verifySignedJobRequestToken(jobSignature, {
        kind: "git/push",
        actorId: userId,
        subjectId: runId,
      }).ok
    )
      throw new Error("A signed, reviewed push operation is required");
    return step.run("execute-reviewed-publication", () =>
      runReviewedGitHubSync(runId, userId, projectId),
    );
  },
);
export const gitPull = inngest.createFunction(
  { id: "git-pull", retries: 0, concurrency },
  { event: "git/pull" },
  async ({ event, step }) => {
    const { projectId, userId, runId, jobSignature } = event.data;
    if (
      !runId ||
      !verifySignedJobRequestToken(jobSignature, {
        kind: "git/pull",
        actorId: userId,
        subjectId: runId,
      }).ok
    )
      throw new Error("A signed, reviewed pull operation is required");

    const activeLease = await step.run("check-file-leases", async () => {
      return db.query.workspaceNodeLocks.findFirst({
        where: and(
          eq(workspaceNodeLocks.projectId, projectId),
          sql`${workspaceNodeLocks.expiresAt} > now()`,
        ),
        columns: { nodeId: true, expiresAt: true },
      });
    });
    if (activeLease) {
      await step.run("record-lease-deferral", async () => {
        await db
          .update(githubSyncRuns)
          .set({
            stage: `Repository sync waits because a member is editing a file until ${new Date(activeLease.expiresAt).toLocaleTimeString()}`,
            updatedAt: new Date(),
          })
          .where(eq(githubSyncRuns.id, runId));
      });
      await step.sleepUntil(
        "wait-for-collaborator-lease",
        new Date(activeLease.expiresAt),
      );
    }

    return step.run("execute-reviewed-pull", () =>
      runReviewedGitHubSync(runId, userId, projectId),
    );
  },
);
export const gitSyncRecovery = inngest.createFunction(
  { id: "git-sync-recovery", concurrency: 1 },
  { cron: "0 * * * *" },
  async ({ step }) =>
    step.run("recover-and-dispatch-sync", async () => {
      const [work] = await db.execute<{ pending: boolean }>(sql`
        SELECT EXISTS (
          SELECT 1 FROM github_sync_runs
          WHERE status IN ('review', 'running', 'queued')
            OR credential IS NOT NULL
            OR (status IN ('completed', 'cancelled') AND COALESCE(result->>'snapshotsCleaned', 'false') <> 'true')
        ) AS pending
      `);
      if (!work?.pending) return { dispatched: 0 };
      await db.execute(sql`
        WITH expired AS (
          UPDATE github_sync_runs
          SET status = 'cancelled', credential = NULL, stage = 'Review expired — compare again', updated_at = now()
          WHERE status = 'review' AND created_at < now() - interval '1 hour'
          RETURNING id
        ), interrupted AS (
          UPDATE github_sync_runs
          SET status = 'failed', stage = 'Worker interrupted — review and retry',
            error = 'The worker lease expired. Previously applied files and remote commit identity have been retained.',
            lease_id = NULL, lease_expires_at = NULL, updated_at = now()
          WHERE status = 'running' AND lease_expires_at < now()
          RETURNING id
        )
        UPDATE github_sync_runs
        SET credential = NULL
        WHERE credential IS NOT NULL
          AND status IN ('failed', 'needs_review', 'cancelled', 'completed')
          AND created_at < now() - interval '1 hour'
      `);
      await cleanupReviewedSyncSnapshots();
      const queued = await db
        .select({
          id: githubSyncRuns.id,
          projectId: githubSyncRuns.projectId,
          actorId: githubSyncRuns.actorId,
          manifest: githubSyncRuns.manifest,
        })
        .from(githubSyncRuns)
        .where(
          and(
            eq(githubSyncRuns.status, "queued"),
            sql`${githubSyncRuns.updatedAt} < now() - interval '30 seconds'`,
          ),
        )
        .limit(50);
      if (queued.length > 0) {
        await inngest.send(
          queued.map((run) => {
            const direction = run.manifest?.direction === "push" ? "push" : "pull";
            return {
              name: (direction === "push" ? "git/push" : "git/pull") as "git/push" | "git/pull",
              id: `sync-recover:${run.id}:${Math.floor(Date.now() / 120_000)}`,
              data: {
                projectId: run.projectId,
                userId: run.actorId,
                runId: run.id,
                commitMessage: run.manifest?.message ?? "Automated sync recovery",
                jobSignature: createSignedJobRequestToken({
                  kind: `git/${direction}` as any,
                  actorId: run.actorId,
                  subjectId: run.id,
                  ttlSeconds: 3600,
                }),
              },
            };
          }),
        );
      }
      return { dispatched: queued.length };
    }),
);
export const uploadIntentCleanup = inngest.createFunction(
  { id: "upload-intent-cleanup", concurrency: 1 },
  { cron: "*/15 * * * *" },
  async ({ step }) =>
    step.run("cleanup-expired-intents", cleanupExpiredUploadIntents),
);
export const lockCleanup = inngest.createFunction(
  { id: "lock-cleanup" },
  { cron: "*/5 * * * *" },
  async () => {
    let deleted = 0;
    for (let batch = 0; batch < 10; batch++) {
      const count = await deleteExpiredFileLeases(1000);
      deleted += count;
      if (count < 1000) break;
    }
    return { cleaned: true, deleted };
  },
);
