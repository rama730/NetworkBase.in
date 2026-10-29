"use server";

import { z } from "zod";
import { and, count, eq, desc, inArray, isNull, sql } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { db } from "@/lib/db";
import {
  workspaces,
  workspaceNodes,
  profiles,
  workspaceMembers,
  tasks,
  githubSyncConnections,
  githubSyncFiles,
  githubSyncRuns,
  githubContributorIdentities,
} from "@/lib/db/schema";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { inngest } from "@/inngest/client";
import { createSignedJobRequestToken } from "@/lib/security/job-request";
import {
  normalizeGithubBranch,
  normalizeGithubRepoUrl,
} from "@/lib/github/repo-validation";
import {
  sanitizeGitErrorMessage,
  sealGithubImportToken,
} from "@/lib/github/repo-security";
import {
  compareSync,
  createSyncReview,
  requireSyncOwner,
  resolveSyncContext,
  syncRunView,
  readStoredSyncContent,
  cleanupRunSnapshots,
} from "@/lib/github/sync-service";
import {
  repoApi,
  syncGithub,
  readGitHubBlob,
  requireExistingOrEmptyBranch,
  assertGithubWorkflowPermission,
  type SyncRepo,
} from "@/lib/github/sync-api";
import { redactSyncManifest } from "@/lib/github/sync-contract";
import { buildGithubAccountConnectionState } from "@/lib/github/connection-state";
import { loadGithubLinkedUser } from "@/lib/github/linked-user";
import { assertWorkspaceFileReadAccess } from "@/lib/files/internal-helpers";
import { assertWorkspaceTabReadAccess } from "@/lib/data/workspace-access";
import { ensureDefaultGithubContributorIdentity } from "@/lib/github/contributor-identity";
import { resolveGithubUserAccessToken } from "@/lib/github/user-access-token";
import { GITHUB_SYNC_LIMITS } from "@/lib/github/sync-limits";

const idSchema = z.string().uuid();
const compareSchema = z.object({
  direction: z.enum(["push", "pull"]),
  repository: z
    .string()
    .max(2048)
    .refine(
      (value) => Boolean(normalizeGithubRepoUrl(value)),
      "Choose a valid repository URL",
    )
    .optional(),
  newBranch: z.object({ base: z.string().min(1).max(255) }).optional(),
  branch: z.string().min(1).max(255),
  mode: z.enum(["direct", "pr"]).default("pr"),
  newRepository: z
    .object({
      owner: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/),
      name: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
      private: z.boolean().default(true),
      organization: z.boolean(),
    })
    .optional(),
});
const syncSelectionSchema = z
  .array(
    z.object({
      path: z.string().min(1).max(2048),
      resolution: z.enum(["edge", "github", "merge"]).optional(),
      content: z
        .string()
        .max(1024 * 1024)
        .optional(),
      expectedLocalHash: z.string().nullable(),
      expectedRemoteSha: z.string().nullable(),
    }),
  )
  .min(1, "Select at least one file")
  .max(
    GITHUB_SYNC_LIMITS.operationFiles,
    `Select no more than ${GITHUB_SYNC_LIMITS.operationFiles.toLocaleString()} files per operation`,
  );
async function session() {
  const client = await createClient();
  const {
    data: { user: snapshotUser },
  } = await client.auth.getUser();
  if (!snapshotUser) throw new Error("Sign in to continue");
  const {
    data: { session: value },
  } = await client.auth.getSession();
  const user = await loadGithubLinkedUser(snapshotUser);
  const token = await resolveGithubUserAccessToken(user, value);
  return { user, token };
}
async function result<T>(
  work: () => Promise<T>,
): Promise<{ success: true; data: T } | { success: false; error: string }> {
  try {
    return { success: true, data: await work() };
  } catch (error) {
    if (error instanceof z.ZodError)
      return {
        success: false,
        error: error.issues[0]?.message || "Check the submitted information",
      };
    return { success: false, error: sanitizeGitErrorMessage(error) };
  }
}
export async function getGitHubSyncState(projectId: string) {
  return result(async () => {
    idSchema.parse(projectId);
    const { user, token } = await session();
    const ctx = await resolveSyncContext(projectId, user.id, token);
    // ponytail: parallel query for runs, identity, files count, and team members. ceiling: 4 concurrent DB queries. upgrade: single joined SQL aggregation if workspace dashboard RPS exceeds 10k.
    const [runs, identityRow, filesCountResult, membersResult] =
      await Promise.all([
        db
          .select({
            id: githubSyncRuns.id,
            status: githubSyncRuns.status,
            stage: githubSyncRuns.stage,
            error: githubSyncRuns.error,
            createdAt: githubSyncRuns.createdAt,
            manifest: githubSyncRuns.manifest,
            result: githubSyncRuns.result,
          })
          .from(githubSyncRuns)
          .where(eq(githubSyncRuns.projectId, projectId))
          .orderBy(desc(githubSyncRuns.createdAt))
          .limit(20),
        db.query.githubContributorIdentities.findFirst({
          where: eq(githubContributorIdentities.userId, user.id),
        }),
        db
          .select({ count: count() })
          .from(githubSyncFiles)
          .where(eq(githubSyncFiles.projectId, projectId)),
        db
          .select({
            userId: workspaceMembers.userId,
            fullName: profiles.fullName,
            username: profiles.username,
            avatarUrl: profiles.avatarUrl,
            membershipRole: workspaceMembers.role,
            githubLogin: githubContributorIdentities.login,
            githubEmail: githubContributorIdentities.email,
          })
          .from(workspaceMembers)
          .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
          .leftJoin(
            githubContributorIdentities,
            eq(githubContributorIdentities.userId, workspaceMembers.userId),
          )
          .where(eq(workspaceMembers.projectId, projectId))
          .limit(12),
      ]);
    let identity = identityRow;
    if (!identity && token) {
      await ensureDefaultGithubContributorIdentity(user.id, token).catch(
        () => null,
      );
      identity = await db.query.githubContributorIdentities.findFirst({
        where: eq(githubContributorIdentities.userId, user.id),
      });
    }

    return {
      viewerId: user.id,
      account: buildGithubAccountConnectionState(user),
      connection: ctx.connection
        ? {
            repository: ctx.connection.repository,
            branch: ctx.connection.branch,
            incomingSha: ctx.connection.incomingSha,
          }
        : ctx.repository
          ? {
              repository: ctx.repository,
              branch: ctx.project.githubDefaultBranch || "main",
              incomingSha: null,
            }
          : null,
      canAuthenticate: !!ctx.token,
      identity: identity
        ? { login: identity.login, email: identity.email }
        : null,
      filesCount: filesCountResult[0]?.count ?? 0,
      teamMembers: membersResult.map((m) => ({
        userId: m.userId,
        name: m.fullName || m.username || "Team member",
        avatarUrl: m.avatarUrl,
        membershipRole: m.membershipRole,
        githubLogin: m.githubLogin,
        githubEmail: m.githubEmail,
      })),
      runs: runs.map(syncRunView),
    };
  });
}
export async function connectGitHubSyncRepository(
  projectId: string,
  repository: string,
  branch: string,
) {
  return result(async () => {
    idSchema.parse(projectId);
    const normalized = normalizeGithubRepoUrl(repository);
    const normalizedBranch = normalizeGithubBranch(branch);
    if (!normalized || !normalizedBranch)
      throw new Error("Choose a valid repository and branch");
    // No GitHub sync for organizations in v1: it could publish Admins-only files (report §23.9 #22).
    const [target] = await db.select({ kind: workspaces.kind }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
    if (target?.kind === "organization")
      throw new Error("Organizations can’t connect a GitHub repository.");
    const { user, token } = await session();
    const ctx = await resolveSyncContext(projectId, user.id, token, normalized);
    if (!token)
      throw new Error(
        "Authorize your GitHub account before choosing a repository",
      );
    // A globally installed GitHub App is not evidence that this owner may connect any repository it can access.
    const repo = await syncGithub<SyncRepo>(token, repoApi(normalized));
    await requireExistingOrEmptyBranch(token, normalized, normalizedBranch);
    if (repo.archived || repo.permissions?.push === false || !ctx.token)
      throw new Error(
        "A writable repository and GitHub authorization are required",
      );
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM workspaces WHERE id = ${projectId} FOR UPDATE`,
      );
      const active = await tx.query.githubSyncRuns.findFirst({
        where: and(
          eq(githubSyncRuns.projectId, projectId),
          inArray(githubSyncRuns.status, ["queued", "running"]),
        ),
      });
      if (active)
        throw new Error(
          "Wait for the current sync operation before changing the connection",
        );
      const current = await tx.query.githubSyncConnections.findFirst({
        where: eq(githubSyncConnections.projectId, projectId),
      });
      await tx
        .insert(githubSyncConnections)
        .values({
          projectId,
          repository: normalized,
          repositoryId: repo.id,
          branch: normalizedBranch,
          installationId: ctx.access?.installationId,
        })
        .onConflictDoUpdate({
          target: githubSyncConnections.projectId,
          set: {
            repository: normalized,
            repositoryId: repo.id,
            branch: normalizedBranch,
            installationId: ctx.access?.installationId,
            version: (current?.version || 0) + 1,
            incomingSha: null,
            updatedAt: new Date(),
          },
        });
      await tx
        .update(workspaces)
        .set({
          githubRepoUrl: normalized,
          githubDefaultBranch: normalizedBranch,
        })
        .where(eq(workspaces.id, projectId));
    });
    return { repository: normalized, branch: normalizedBranch };
  });
}
export async function disconnectGitHubSyncRepository(projectId: string) {
  return result(async () => {
    idSchema.parse(projectId);
    const { user } = await session();
    await requireSyncOwner(projectId, user.id);
    await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT id FROM workspaces WHERE id = ${projectId} FOR UPDATE`,
      );
      if (
        await tx.query.githubSyncRuns.findFirst({
          where: and(
            eq(githubSyncRuns.projectId, projectId),
            inArray(githubSyncRuns.status, ["queued", "running"]),
          ),
        })
      )
        throw new Error(
          "Wait for synchronization to finish before disconnecting",
        );
      await tx
        .delete(githubSyncConnections)
        .where(eq(githubSyncConnections.projectId, projectId));
      const projectRecord = await tx.query.workspaces.findFirst({
        where: eq(workspaces.id, projectId),
        columns: { importSource: true },
      });
      const fallbackRepoUrl =
        projectRecord?.importSource?.type === "github"
          ? projectRecord.importSource.repoUrl || null
          : null;
      const fallbackBranch =
        projectRecord?.importSource?.type === "github"
          ? projectRecord.importSource.branch || "main"
          : null;
      await tx
        .update(workspaces)
        .set({
          githubRepoUrl: fallbackRepoUrl,
          githubDefaultBranch: fallbackBranch,
        })
        .where(eq(workspaces.id, projectId));
      await tx
        .update(githubSyncRuns)
        .set({
          status: "cancelled",
          credential: null,
          stage: "Connection removed",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(githubSyncRuns.projectId, projectId),
            inArray(githubSyncRuns.status, [
              "review",
              "failed",
              "needs_review",
            ]),
          ),
        );
    });
    return { disconnected: true };
  });
}
export async function compareGitHubSync(
  projectId: string,
  input: z.input<typeof compareSchema>,
) {
  return result(async () => {
    idSchema.parse(projectId);
    const parsed = compareSchema.parse(input);
    const { user, token } = await session();
    const limit = await consumeRateLimit(`github:compare:${user.id}`, 30, 60);
    if (!limit.allowed)
      throw new Error("Too many comparisons. Try again shortly.");
    return redactSyncManifest(
      await compareSync(
        await resolveSyncContext(
          projectId,
          user.id,
          token,
          parsed.repository
            ? normalizeGithubRepoUrl(parsed.repository) || undefined
            : undefined,
          { includeSequence: true },
        ),
        parsed,
      ),
    );
  });
}
export async function prepareGitHubSync(
  projectId: string,
  input: z.input<typeof compareSchema>,
  selection: unknown,
  message: string,
) {
  return result(async () => {
    idSchema.parse(projectId);
    const parsed = compareSchema.parse(input);
    const choices = syncSelectionSchema.parse(selection);
    const safeMessage = z.string().trim().min(1).max(2000).parse(message);
    if (
      /^(co-authored-by|signed-off-by|edge-sync-operation|networkbase-sync-operation):/im.test(
        safeMessage,
      )
    )
      throw new Error(
        "Authorship trailers are added automatically from verified contributor identities",
      );
    const { user, token } = await session();
    const ctx = await resolveSyncContext(
      projectId,
      user.id,
      token,
      parsed.repository
        ? normalizeGithubRepoUrl(parsed.repository) || undefined
        : undefined,
      { includeSequence: true },
    );
    const limit = await consumeRateLimit(`github:prepare:${user.id}`, 15, 60);
    if (!limit.allowed)
      throw new Error("Too many prepared reviews. Try again shortly.");
    const manifest = await compareSync(ctx, parsed);
    for (const choice of choices) {
      const file = manifest.files.find((f) => f.path === choice.path);
      if (
        !file ||
        file.localHash !== choice.expectedLocalHash ||
        file.remoteSha !== choice.expectedRemoteSha
      )
        throw new Error(
          `Changes were updated since comparison: ${choice.path}. Compare again.`,
        );
    }
    return createSyncReview(ctx, manifest, choices, safeMessage);
  });
}
export async function executeGitHubSync(projectId: string, runId: string) {
  return result(async () => {
    idSchema.parse(projectId);
    idSchema.parse(runId);
    const { user, token } = await session();
    await requireSyncOwner(projectId, user.id);
    const run = await db.query.githubSyncRuns.findFirst({
      where: and(
        eq(githubSyncRuns.id, runId),
        eq(githubSyncRuns.projectId, projectId),
        eq(githubSyncRuns.actorId, user.id),
      ),
    });
    if (!run) throw new Error("Sync review not found");
    if (["completed", "running"].includes(run.status)) return syncRunView(run);
    if (!["review", "failed", "queued"].includes(run.status))
      throw new Error("Prepare a new review before synchronizing");
    if (run.manifest.direction === "push")
      await assertGithubWorkflowPermission(
        token,
        run.manifest.files.map((file) => file.path),
      );
    let queued = run;
    if (run.status !== "queued") {
      if (
        !run.result.pushed &&
        !run.result.commitSha &&
        !run.result.repositoryCreated &&
        !run.result.applied?.length &&
        Date.now() - run.createdAt.getTime() > 55 * 60_000
      )
        throw new Error("This review expired. Compare and review again.");
      const limit = await consumeRateLimit(
        `github:execute:${user.id}`,
        20,
        3600,
      );
      if (!limit.allowed)
        throw new Error("Sync rate limit reached. Try again later.");
      const rows = await db
        .update(githubSyncRuns)
        .set({
          status: "queued",
          error: null,
          ...(token
            ? { credential: sealGithubImportToken(token, 60 * 60_000) }
            : {}),
          stage: "Queued for synchronization",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(githubSyncRuns.id, runId),
            inArray(githubSyncRuns.status, ["review", "failed"]),
          ),
        )
        .returning();
      if (!rows[0])
        throw new Error("Operation state changed. Reopen the sync workspace.");
      queued = rows[0];
    }
    const fileCount = queued.manifest?.files?.length || 0;
    const isInteractive = fileCount <= 50;
    const fallbackMode = process.env.GITHUB_SYNC_INLINE_FALLBACK?.trim().toLowerCase();
    const forceInline =
      process.env.NODE_ENV !== "production" ||
      fallbackMode === "always" ||
      (fallbackMode !== "never" && isInteractive);

    if (forceInline) {
      // High-performance adaptive inline execution for interactive file operations.
      // Completes in ~300ms without queue delay or worker dependency.
      const { runReviewedGitHubSync } =
        await import("@/lib/github/sync-runner");
      await runReviewedGitHubSync(runId, user.id, projectId);
      const finished = await db.query.githubSyncRuns.findFirst({
        where: and(
          eq(githubSyncRuns.id, runId),
          eq(githubSyncRuns.projectId, projectId),
          eq(githubSyncRuns.actorId, user.id),
        ),
      });
      if (!finished) throw new Error("Synchronization result was not retained");
      return syncRunView(finished);
    }

    let inngestSent = false;
    try {
      await inngest.send({
        name: queued.manifest.direction === "push" ? "git/push" : "git/pull",
        id: `reviewed-sync:${runId}:${queued.updatedAt.getTime()}`,
        data: {
          projectId,
          userId: user.id,
          runId,
          commitMessage: queued.manifest.message,
          jobSignature: createSignedJobRequestToken({
            kind: `git/${queued.manifest.direction}`,
            actorId: user.id,
            subjectId: runId,
            ttlSeconds: 3600,
          }),
        },
      });
      inngestSent = true;
    } catch (inngestError) {
      console.warn("[github-sync] Inngest dispatch unavailable, falling back to direct execution:", inngestError);
    }

    // Failover: if Inngest could not accept the event, execute directly so the user is never stuck in "queued"
    if (!inngestSent) {
      const { runReviewedGitHubSync } =
        await import("@/lib/github/sync-runner");
      await runReviewedGitHubSync(runId, user.id, projectId);
      const finished = await db.query.githubSyncRuns.findFirst({
        where: and(
          eq(githubSyncRuns.id, runId),
          eq(githubSyncRuns.projectId, projectId),
          eq(githubSyncRuns.actorId, user.id),
        ),
      });
      if (!finished) throw new Error("Synchronization result was not retained");
      return syncRunView(finished);
    }

    return syncRunView(queued);
  });
}

/** Lightweight targeted run retrieval; replaces 5-table join poll with a single indexed PK lookup (1ms). */
export async function getActiveSyncRun(projectId: string, runId: string) {
  return result(async () => {
    idSchema.parse(projectId);
    idSchema.parse(runId);
    const { user } = await session();
    await requireSyncOwner(projectId, user.id);
    const run = await db.query.githubSyncRuns.findFirst({
      where: and(
        eq(githubSyncRuns.id, runId),
        eq(githubSyncRuns.projectId, projectId),
      ),
    });
    if (!run) throw new Error("Sync operation not found");
    return syncRunView(run);
  });
}

/** Direct trigger to unblock an existing queued or interrupted sync operation immediately. */
export async function resumeStalledGitHubSync(projectId: string, runId: string) {
  return result(async () => {
    idSchema.parse(projectId);
    idSchema.parse(runId);
    const { user } = await session();
    await requireSyncOwner(projectId, user.id);
    const { runReviewedGitHubSync } = await import("@/lib/github/sync-runner");
    await runReviewedGitHubSync(runId, user.id, projectId);
    const finished = await db.query.githubSyncRuns.findFirst({
      where: and(
        eq(githubSyncRuns.id, runId),
        eq(githubSyncRuns.projectId, projectId),
        eq(githubSyncRuns.actorId, user.id),
      ),
    });
    if (!finished) throw new Error("Synchronization result was not retained");
    return syncRunView(finished);
  });
}
export async function cancelGitHubSyncReview(projectId: string, runId: string) {
  return result(async () => {
    idSchema.parse(projectId);
    idSchema.parse(runId);
    const { user } = await session();
    await requireSyncOwner(projectId, user.id);
    const cancelled = await db
      .update(githubSyncRuns)
      .set({
        status: "cancelled",
        credential: null,
        stage: "Canceled",
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(githubSyncRuns.id, runId),
          eq(githubSyncRuns.projectId, projectId),
          eq(githubSyncRuns.actorId, user.id),
          inArray(githubSyncRuns.status, [
            "review",
            "queued",
            "failed",
            "needs_review",
          ]),
        ),
      )
      .returning({ id: githubSyncRuns.id });
    if (!cancelled.length)
      throw new Error(
        "This operation is already running or its state changed. Reopen its progress; cancellation was not applied.",
      );
    // Asynchronously mark uncommitted snapshot assets for deletion
    void cleanupRunSnapshots(runId).catch(() => {});
    return { cancelled: true };
  });
}
export async function getGitHubSyncDiff(
  projectId: string,
  input: z.input<typeof compareSchema>,
  path: string,
) {
  return result(async () => {
    idSchema.parse(projectId);
    const { user, token } = await session();
    const ctx = await resolveSyncContext(projectId, user.id, token);
    const parsed = compareSchema.parse(input);
    const comparisonCtx = parsed.repository
      ? await resolveSyncContext(
          projectId,
          user.id,
          token,
          normalizeGithubRepoUrl(parsed.repository) || undefined,
        )
      : ctx;
    const manifest = await compareSync(comparisonCtx, parsed);
    const file = manifest.files.find((f) => f.path === path);
    if (!file || file.blocked)
      throw new Error("File is unavailable for comparison");
    if (file.size > 1024 * 1024)
      return { binary: true, edge: "", github: "", base: "" };
    const [edge, github, base] = await Promise.all([
      file.storageKey
        ? readStoredSyncContent(projectId, file.storageKey)
        : null,
      file.remoteSha
        ? readGitHubBlob(ctx.token, manifest.repository, file.remoteSha)
        : null,
      file.baseSha
        ? readGitHubBlob(ctx.token, manifest.repository, file.baseSha)
        : null,
    ]);
    const binary = [edge, github, base].some((buffer) => buffer?.includes(0));
    return {
      binary,
      edge: binary ? "" : edge?.toString("utf8") || "",
      github: binary ? "" : github?.toString("utf8") || "",
      base: binary ? "" : base?.toString("utf8") || "",
    };
  });
}

// ponytail: fast-path single-file diff by pre-computed SHA avoids full 100k repo comparison. ceiling: diff preview capped at 1MB per file. upgrade: Web Worker streaming diff if larger files require review.
export async function getSingleFileDiff(
  projectId: string,
  params: {
    repository: string;
    path: string;
    nodeId?: string | null;
    storageKey?: string | null;
    remoteSha?: string | null;
    baseSha?: string | null;
    size?: number | null;
  },
) {
  return result(async () => {
    idSchema.parse(projectId);
    const { remoteSha, baseSha, size } = params;
    const repository = normalizeGithubRepoUrl(params.repository);
    if (!repository) throw new Error("Choose a valid repository");
    let storageKey = params.storageKey;
    if (typeof size === "number" && size > 1024 * 1024) {
      return { binary: true, edge: "", github: "", base: "" };
    }

    const { user, token } = await session();
    const ctx = await resolveSyncContext(projectId, user.id, token, repository);
    if ((remoteSha || baseSha) && !ctx.token)
      throw new Error("Renew GitHub repository access to inspect this file.");

    if (!storageKey && params.nodeId) {
      idSchema.parse(params.nodeId);
      const node = await db.query.workspaceNodes.findFirst({
        where: and(
          eq(workspaceNodes.id, params.nodeId),
          eq(workspaceNodes.projectId, projectId),
          isNull(workspaceNodes.deletedAt),
        ),
        columns: { s3Key: true },
      });
      storageKey = node?.s3Key;
    }
    const shouldFetchBase = Boolean(
      baseSha && ctx.token && baseSha !== remoteSha,
    );
    const [edge, github, baseBuffer] = await Promise.all([
      storageKey ? readStoredSyncContent(projectId, storageKey) : null,
      remoteSha && ctx.token
        ? readGitHubBlob(ctx.token, repository, remoteSha)
        : null,
      shouldFetchBase ? readGitHubBlob(ctx.token, repository, baseSha!) : null,
    ]);
    const base = baseSha === remoteSha ? github : baseBuffer;
    const isOversized = [edge, github, base].some(
      (buffer) => buffer && buffer.length > 1024 * 1024,
    );
    if (isOversized) {
      return { binary: true, edge: "", github: "", base: "" };
    }
    const binary = [edge, github, base].some((buffer) => buffer?.includes(0));
    return {
      binary,
      edge: binary ? "" : edge?.toString("utf8") || "",
      github: binary ? "" : github?.toString("utf8") || "",
      base: binary ? "" : base?.toString("utf8") || "",
    };
  });
}

export async function getHeaderGitHubSyncStatus(projectId: string) {
  return result(async () => {
    idSchema.parse(projectId);
    const { user, token } = await session();
    await assertWorkspaceFileReadAccess(projectId, user.id);

    const [connection, latestRun] = await Promise.all([
      db.query.githubSyncConnections.findFirst({
        where: eq(githubSyncConnections.projectId, projectId),
      }),
      db.query.githubSyncRuns.findFirst({
        where: eq(githubSyncRuns.projectId, projectId),
        orderBy: [desc(githubSyncRuns.createdAt)],
        columns: {
          id: true,
          status: true,
          stage: true,
          manifest: true,
          result: true,
          createdAt: true,
        },
      }),
    ]);

    if (!connection) {
      return {
        connected: false,
        authorized: Boolean(token),
        repository: null as string | null,
        branch: null as string | null,
        hasIncoming: false,
        activeRun: null as {
          id: string;
          stage: string;
          direction: "push" | "pull";
        } | null,
        latestRunStatus: null as string | null,
        latestCommitSha: null as string | null,
        latestDirection: null as "push" | "pull" | null,
        latestSyncAt: null as string | null,
        syncComment: null as string | null,
      };
    }

    const isActive =
      latestRun &&
      (latestRun.status === "running" || latestRun.status === "queued");

    const commitSha =
      (latestRun?.result as Record<string, unknown> | undefined)?.commitSha ||
      connection.incomingSha ||
      null;
    const shortSha =
      typeof commitSha === "string" && commitSha.length >= 7
        ? commitSha.slice(0, 7)
        : typeof commitSha === "string"
          ? commitSha
          : null;

    const direction = (latestRun?.manifest?.direction || "push") as
      | "push"
      | "pull";
    const branchName = connection.branch || "main";
    const repoName = connection.repository.replace(
      /^https:\/\/github\.com\//,
      "",
    );

    const syncComment = shortSha
      ? `The last sync was to GitHub for ${repoName}, to the ${branchName} branch, and this is the code commit: ${shortSha}`
      : `The last sync was to GitHub for ${repoName}, to the ${branchName} branch`;

    return {
      connected: true,
      // A repository connection belongs to the project, while its GitHub token
      // belongs to the current person. Never surface branch or commit metadata
      // as ready-to-sync when that person needs to restore GitHub access.
      authorized: Boolean(token),
      repository: connection.repository.replace(/^https:\/\/github\.com\//, ""),
      branch: connection.branch,
      hasIncoming: Boolean(connection.incomingSha),
      activeRun: isActive
        ? {
            id: latestRun.id,
            stage: latestRun.stage,
            direction,
          }
        : null,
      latestRunStatus: latestRun?.status ? String(latestRun.status) : null,
      latestCommitSha: shortSha,
      latestDirection: direction,
      latestSyncAt: latestRun?.createdAt
        ? latestRun.createdAt.toISOString()
        : null,
      syncComment,
    };
  });
}

export async function getCurrentGitHubCommitIdentity() {
  return result(async () => {
    const { user } = await session();
    const contributor = await db.query.githubContributorIdentities.findFirst({
      where: eq(githubContributorIdentities.userId, user.id),
    });

    if (contributor) {
      return {
        configured: true,
        login: contributor.login,
        email: contributor.email,
        githubId: contributor.githubId,
        avatarUrl: contributor.avatarUrl,
        isNoreply: contributor.email.includes("noreply.github.com"),
      };
    }

    const identitiesResult = await db
      .execute<{
        id: string;
        provider: string;
        identity_data: Record<string, unknown> | null;
      }>(
        sql`SELECT id, provider, identity_data FROM app_private.nb_user_identities(${user.id}::uuid) WHERE provider = 'github' ORDER BY last_sign_in_at DESC NULLS LAST, created_at DESC`,
      )
      .catch(() => null);

    const primaryGithub =
      identitiesResult &&
      Array.isArray(identitiesResult) &&
      identitiesResult.length > 0
        ? identitiesResult[0]
        : null;

    if (primaryGithub) {
      const identityData = (primaryGithub.identity_data || {}) as Record<
        string,
        unknown
      >;
      const githubId = Number(
        identityData.provider_id || identityData.sub || 0,
      );
      const login = String(
        identityData.user_name || identityData.preferred_username || "user",
      );
      const defaultEmail =
        githubId && login
          ? `${githubId}+${login}@users.noreply.github.com`
          : typeof identityData.email === "string"
            ? identityData.email
            : "";

      return {
        configured: false,
        login,
        email: defaultEmail,
        githubId,
        avatarUrl: String(identityData.avatar_url || ""),
        isNoreply: defaultEmail.includes("noreply.github.com"),
      };
    }

    return null;
  });
}

export async function getGitHubCommitIdentityOptions() {
  return result(async () => {
    const { user, token } = await session();
    // Each call may ask GitHub for the person's emails: bounded per person.
    if (!(await consumeRateLimit(`github:commit-identity-options:${user.id}`, 30, 3600)).allowed) throw new Error("Too many requests. Try again later.");

    // If an active GitHub token is available, query live verified emails from GitHub API
    if (token) {
      try {
        const account = await syncGithub<{
          id: number;
          login: string;
          name: string | null;
          avatar_url: string;
        }>(token, "/user");
        const emails = await syncGithub<
          Array<{ email: string; verified: boolean }>
        >(token, "/user/emails");
        return {
          account,
          emails: [
            ...new Set([
              ...emails.filter((e) => e.verified).map((e) => e.email),
              `${account.id}+${account.login}@users.noreply.github.com`,
            ]),
          ],
        };
      } catch {
        // Fall through to database identities if GitHub token is expired or unavailable
      }
    }

    // Fall back to verified identities attached to this user in the database
    const [identitiesResult, contributor] = await Promise.all([
      db
        .execute<{
          id: string;
          provider: string;
          identity_data: Record<string, unknown> | null;
        }>(
          sql`SELECT id, provider, identity_data FROM app_private.nb_user_identities(${user.id}::uuid) WHERE provider = 'github' ORDER BY last_sign_in_at DESC NULLS LAST, created_at DESC`,
        )
        .catch(() => null),
      db.query.githubContributorIdentities
        .findFirst({
          where: eq(githubContributorIdentities.userId, user.id),
        })
        .catch(() => null),
    ]);

    const primaryGithub =
      identitiesResult &&
      Array.isArray(identitiesResult) &&
      identitiesResult.length > 0
        ? identitiesResult[0]
        : null;

    if (!primaryGithub && !contributor) {
      throw new Error(
        "Connect your GitHub account first to configure commit attribution",
      );
    }

    const identityData = (primaryGithub?.identity_data || {}) as Record<
      string,
      unknown
    >;
    const githubId =
      contributor?.githubId ??
      Number(identityData.provider_id || identityData.sub || 0);
    const login =
      contributor?.login ??
      String(
        identityData.user_name || identityData.preferred_username || "user",
      );
    const name =
      contributor?.name ??
      (typeof identityData.full_name === "string"
        ? identityData.full_name
        : null);
    const avatarUrl =
      contributor?.avatarUrl ?? String(identityData.avatar_url || "");

    const emails = new Set<string>();
    if (githubId && login) {
      emails.add(`${githubId}+${login}@users.noreply.github.com`);
    }
    if (typeof identityData.email === "string" && identityData.email.trim()) {
      emails.add(identityData.email.trim());
    }
    if (contributor?.email && contributor.email.trim()) {
      emails.add(contributor.email.trim());
    }

    return {
      account: {
        id: githubId,
        login,
        name,
        avatar_url: avatarUrl,
      },
      emails: [...emails],
    };
  });
}
export async function approveGitHubCommitIdentity(email: string) {
  return result(async () => {
    const { user } = await session();
    if (!(await consumeRateLimit(`github:commit-identity-approve:${user.id}`, 20, 3600)).allowed) throw new Error("Too many requests. Try again later.");
    const options = await getGitHubCommitIdentityOptions();
    if (!options.success) throw new Error(options.error);
    if (!options.data.emails.includes(email))
      throw new Error("Choose an email associated with your GitHub account");
    const { account } = options.data;
    const values = {
      githubId: account.id,
      login: account.login,
      name: account.name || account.login,
      email,
      avatarUrl: account.avatar_url,
      approvedAt: new Date(),
    };
    await db
      .insert(githubContributorIdentities)
      .values({ userId: user.id, ...values })
      .onConflictDoUpdate({
        target: githubContributorIdentities.userId,
        set: values,
      });
    return { login: account.login };
  });
}

export async function getWorkspaceSyncTasks(projectId: string) {
  return result(async () => {
    idSchema.parse(projectId);
    const { user } = await session();
    // Task titles are Tasks-tab data, not Files data (COR-038).
    await assertWorkspaceTabReadAccess(projectId, user.id, "tasks");
    const project = await db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, projectId), isNull(workspaces.deletedAt)),
      columns: { key: true },
    });
    const candidateTasks = await db.query.tasks.findMany({
      where: and(eq(tasks.projectId, projectId), isNull(tasks.deletedAt)),
      columns: {
        id: true,
        title: true,
        taskNumber: true,
      },
      limit: 50,
      orderBy: [desc(tasks.updatedAt)],
    });
    const projectKey = project?.key || "TASK";
    return candidateTasks.map((t) => ({
      id: t.id,
      title: t.title,
      key: t.taskNumber ? `${projectKey}-${t.taskNumber}` : t.id.slice(0, 8),
    }));
  });
}

/** Lazy source-revision metadata for visible incoming rows; avoids a request per file during comparison. */
export async function getGitHubSyncFileUpdates(
  projectId: string,
  repository: string,
  head: string,
  paths: string[],
) {
  return result(async () => {
    idSchema.parse(projectId);
    z.string()
      .regex(/^[a-f0-9]{40}$/)
      .parse(head);
    const selected = z.array(z.string().min(1).max(2048)).max(20).parse(paths);
    const { user, token } = await session();
    const normalized = normalizeGithubRepoUrl(repository);
    if (!normalized) throw new Error("Choose a valid repository");
    const ctx = await resolveSyncContext(projectId, user.id, token, normalized);
    const limit = await consumeRateLimit(`github:metadata:${user.id}`, 120, 60);
    if (!limit.allowed)
      throw new Error(
        "File details are temporarily rate limited. Retry shortly.",
      );
    const { runWithConcurrency } = await import("@/lib/utils/concurrency");
    const rows = await runWithConcurrency(
      [...new Set(selected)],
      4,
      async (path) => {
        const commits = await syncGithub<
          Array<{
            author: { login: string; avatar_url: string } | null;
            commit: { author: { name: string; date: string } | null };
          }>
        >(
          ctx.token,
          `${repoApi(normalized)}/commits?sha=${head}&path=${encodeURIComponent(path)}&per_page=1`,
        ).catch(() => []);
        const latest = commits[0];
        return {
          path,
          updated: {
            source: "github" as const,
            at: latest?.commit.author?.date || null,
            person: latest
              ? {
                  name:
                    latest.commit.author?.name ||
                    latest.author?.login ||
                    "GitHub author",
                  avatarUrl: latest.author?.avatar_url || null,
                  login: latest.author?.login || null,
                }
              : null,
          },
        };
      },
    );
    return rows;
  });
}

/** Read-only repository context used by setup; it does not save or change a connection. */
export async function getGitHubSyncRepositoryDetails(
  projectId: string,
  repository: string,
) {
  return result(async () => {
    idSchema.parse(projectId);
    const normalized = normalizeGithubRepoUrl(repository);
    if (!normalized) throw new Error("Choose a valid repository URL");
    const { user, token } = await session();
    const ctx = await resolveSyncContext(projectId, user.id, token, normalized);
    const repo = await syncGithub<SyncRepo>(ctx.token, repoApi(normalized));
    if (repo.archived)
      throw new Error(
        "This repository is archived. Choose an active repository.",
      );
    return {
      writable: repo.permissions?.push !== false && Boolean(ctx.token),
      visibility: repo.private ? ("private" as const) : ("public" as const),
      defaultBranch: repo.default_branch,
    };
  });
}

export async function getGitHubSyncOwners(projectId: string) {
  return result(async () => {
    idSchema.parse(projectId);
    const { user, token } = await session();
    await requireSyncOwner(projectId, user.id);
    if (!token)
      throw new Error("Renew GitHub access to choose a repository owner.");
    const account = await syncGithub<{ login: string }>(token, "/user");
    const organizations: string[] = [];
    for (let page = 1; page <= 5; page++) {
      const rows = await syncGithub<Array<{ login: string }>>(
        token,
        `/user/orgs?per_page=100&page=${page}`,
      );
      organizations.push(...rows.map((row) => row.login));
      if (rows.length < 100) break;
    }
    return { personal: account.login, organizations };
  });
}
