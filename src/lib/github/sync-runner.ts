import "server-only";
import { saveContext } from "@/lib/domain/save-context";
import { lockTaskForWrite, transitionTaskTx, afterTaskTransition } from "@/lib/workspaces/task-transition-service";
import { logger } from "@/lib/logger";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  workspaces,
  workspaceNodes,
  fileVersions,
  tasks,
  workspaceUpdates,
  githubSyncRuns,
  githubSyncConnections,
  githubSyncFiles,
  githubContributorIdentities,
  githubSyncSnapshotAssets,
  storageAssets,
} from "@/lib/db/schema";
import {
  resolveSyncContext,
  requireSyncOwner,
  readStoredSyncContent,
  validateReviewedLocalFiles,
  linkGithubBranch,
} from "./sync-service";
import {
  readGitHubHead,
  repoApi,
  syncGithub,
  SyncGithubError,
  type SyncRepo,
} from "./sync-api";
import {
  openGithubImportToken,
  sanitizeGitErrorMessage,
} from "./repo-security";
import { publishGitSnapshot } from "./sync-git";
import {
  type SyncFile,
  type SyncManifest,
  type SyncContributor,
  type SyncResult,
} from "./sync-contract";
import { applyFileRevision } from "@/lib/files/apply-file-revision";
import {
  withTransientFileLease,
  assertOwnedFileLease,
} from "@/lib/files/file-lock-service";
import {
  recordNodeEvent,
  assertWorkspaceWriteAccessTx,
} from "@/lib/files/internal-helpers";
import { orgRepositoryBlock } from "@/lib/organizations/children";

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
async function ensureIncomingParent(
  tx: Transaction,
  projectId: string,
  path: string,
  actorId: string,
) {
  const segments = path.split("/").slice(0, -1);
  if (segments.length === 0) return null;
  const prefixes = segments.map(
    (_, index) => `/${segments.slice(0, index + 1).join("/")}`,
  );
  const existingByPath = new Map(
    (
      await tx.query.workspaceNodes.findMany({
        where: and(
          eq(workspaceNodes.projectId, projectId),
          inArray(workspaceNodes.path, prefixes),
          isNull(workspaceNodes.taskId),
          isNull(workspaceNodes.deletedAt),
        ),
        columns: { id: true, path: true, type: true },
      })
    ).map((node) => [node.path, node]),
  );
  let parentId: string | null = null;
  for (const [index, segment] of segments.entries()) {
    const prefix = prefixes[index]!;
    const existing = existingByPath.get(prefix);
    if (existing && existing.type !== "folder")
      throw new Error("Incoming folder collides with a file");
    if (existing) parentId = existing.id;
    else {
      const created: Array<{ id: string }> = await tx
        .insert(workspaceNodes)
        .values({
          projectId,
          parentId,
          path: prefix,
          type: "folder",
          name: segment,
          createdBy: actorId,
        })
        .returning({ id: workspaceNodes.id });
      if (!created[0]) throw new Error("Couldn’t create folder");
      parentId = created[0].id;
    }
  }
  return parentId;
}
async function saveBaseline(
  tx: Transaction,
  projectId: string,
  manifest: SyncManifest,
  file: SyncFile,
  nodeId: string | null,
  commitSha: string,
  sequence: number,
) {
  const values = {
    nodeId,
    blobSha:
      manifest.direction === "pull"
        ? file.remoteSha
        : file.resultBlobSha || null,
    localHash:
      manifest.direction === "pull" ? file.resultHash || null : file.localHash,
    localBlobSha:
      manifest.direction === "pull"
        ? file.resultBlobSha || null
        : file.localBlobSha,
    commitSha,
    sequence,
  };
  await tx
    .insert(githubSyncFiles)
    .values({
      projectId,
      repositoryId: manifest.repositoryId!,
      branch: manifest.branch,
      path: file.path,
      ...values,
    })
    .onConflictDoUpdate({
      target: [
        githubSyncFiles.projectId,
        githubSyncFiles.repositoryId,
        githubSyncFiles.branch,
        githubSyncFiles.path,
      ],
      set: values,
    });
}
async function remoteAuthors(
  token: string | null,
  manifest: SyncManifest,
  file: SyncFile,
  deltaCache: Map<string, Promise<Set<string>>>,
  identityCache?: Map<number, Promise<any>>,
): Promise<SyncContributor[]> {
  let delta: Set<string> | null = null;
  if (file.baseCommit) {
    if (!deltaCache.has(file.baseCommit))
      deltaCache.set(
        file.baseCommit,
        (async () => {
          const shas = new Set<string>();
          for (let page = 1; page <= 20; page++) {
            const comparison = await syncGithub<{
              total_commits: number;
              commits: Array<{ sha: string }>;
            }>(
              token,
              `${repoApi(manifest.repository)}/compare/${file.baseCommit}...${manifest.headSha}?per_page=100&page=${page}`,
            );
            if (comparison.total_commits > 2000)
              throw new Error(
                "Incoming history exceeds the 2,000-commit safe attribution limit",
              );
            for (const commit of comparison.commits) shas.add(commit.sha);
            if (
              shas.size >= comparison.total_commits ||
              !comparison.commits.length
            )
              break;
          }
          return shas;
        })(),
      );
    delta = await deltaCache.get(file.baseCommit)!;
  }
  const commits = await syncGithub<
    Array<{
      sha: string;
      author: { id: number; login: string; avatar_url: string } | null;
      commit: { author: { name: string; email: string } };
    }>
  >(
    token,
    `${repoApi(manifest.repository)}/commits?sha=${manifest.headSha}&path=${encodeURIComponent(file.path)}&per_page=100`,
  );
  const result: SyncContributor[] = [];
  // ponytail: batch inArray query resolves up to 100 contributor identities in 1 SQL round-trip. ceiling: 100 authors per file history. upgrade: chunked inArray if git history pagination exceeds 100.
  const authorIds = Array.from(
    new Set(
      (commits ?? [])
        .map((c) => c.author?.id)
        .filter((id): id is number => typeof id === "number"),
    ),
  );
  const authorRows =
    authorIds.length > 0
      ? await db.query.githubContributorIdentities.findMany({
          where: inArray(githubContributorIdentities.githubId, authorIds),
        })
      : [];
  const authorMap = new Map(authorRows.map((r) => [r.githubId, r]));

  for (const commit of commits ?? []) {
    if (commit.sha === file.baseCommit) break;
    if (delta && !delta.has(commit.sha)) continue;
    const author = commit.author;
    const authorName =
      commit.commit?.author?.name || author?.login || "Unknown";
    if (
      result.some((item) =>
        author ? item.githubId === author.id : item.name === authorName,
      )
    )
      continue;
    const linked = author ? (authorMap.get(author.id) ?? null) : null;
    result.push({
      userId: linked?.userId || null,
      name: authorName,
      username: null,
      avatarUrl: author?.avatar_url || null,
      githubLogin: author?.login || null,
      githubId: author?.id || null,
      source: "github",
    });
    if (!file.baseCommit) break; // Initial import records latest attributable author, not fabricated complete history.
  }
  return result;
}

/** Verified asset registered for a reviewed snapshot key; null for legacy unregistered snapshots (COR-004). */
async function snapshotAssetId(
  runId: string,
  snapshotKey: string,
): Promise<string | null> {
  const [row] = await db
    .select({ assetId: githubSyncSnapshotAssets.assetId })
    .from(githubSyncSnapshotAssets)
    .innerJoin(
      storageAssets,
      eq(storageAssets.id, githubSyncSnapshotAssets.assetId),
    )
    .where(
      and(
        eq(githubSyncSnapshotAssets.runId, runId),
        eq(storageAssets.storageKey, snapshotKey),
        eq(storageAssets.state, "verified"),
      ),
    )
    .limit(1);
  return row?.assetId ?? null;
}

/**
 * A reviewed pull into a NetworkBase branch (report H6, phase H-5): the branch is made from main when it's new, the
 * files land as one save "From GitHub owner/repo@sha" (kind sync), then the baselines and the run's progress.
 * ponytail: commit authors aren't carried onto branch saves (main's per-file pull keeps them); add when asked.
 */
export async function pullIntoBranch(manifest: SyncManifest, runId: string, leaseId: string, projectId: string, actorId: string, result: SyncResult): Promise<SyncResult> {
  const local = manifest.local!;
  const paths = manifest.files.map((f) => f.path);
  if (paths.every((p) => result.applied?.includes(p))) return result;
  const { createBranch, writeBranch } = await import("@/lib/domain/branches");
  const actor = { user: { id: actorId }, tokenKind: null, tokenScopes: null };
  let branchId = local.branchId;
  let expectedHead = local.headSaveId;
  if (!branchId) {
    const made = await createBranch(actor, projectId, { name: local.name });
    branchId = made.branch.id;
    expectedHead = null;
  }
  const changes: Array<{ op: "add" | "change" | "delete" | "rename"; path: string; fromPath?: string; contentHash?: string | null; assetId?: string | null; size?: number | null; mimeType?: string | null }> = [];
  for (const file of manifest.files) {
    const content = file.snapshotKey
      ? { contentHash: file.resultHash ?? null, assetId: await snapshotAssetId(runId, file.snapshotKey), size: file.size, mimeType: file.mimeType }
      : {};
    if (file.renamedFrom) changes.push({ op: "rename", fromPath: `/${file.renamedFrom}`, path: `/${file.path}`, ...content });
    else if (file.snapshotKey) changes.push({ op: file.localHash ? "change" : "add", path: `/${file.path}`, ...content });
    else if (file.localHash) changes.push({ op: "delete", path: `/${file.path}` });
  }
  const repoName = manifest.repository.replace(/^https:\/\/github\.com\//, "");
  await writeBranch(branchId, { changes, expectedHead, kind: "sync", message: `From GitHub ${repoName}@${(manifest.headSha ?? "").slice(0, 7)}`, authorId: actorId });
  const next = { ...result, applied: paths, commitSha: manifest.headSha ?? undefined };
  await db.transaction(async (tx) => {
    const locked = await tx.execute(sql`SELECT id FROM github_sync_runs WHERE id=${runId} AND lease_id=${leaseId} AND status='running' FOR UPDATE`);
    if (!locked.length) throw new Error("Synchronization lease was lost");
    for (const file of manifest.files) await saveBaseline(tx, projectId, manifest, file, null, manifest.headSha!, manifest.sequence);
    await tx.update(githubSyncRuns).set({ result: next, updatedAt: new Date() }).where(eq(githubSyncRuns.id, runId));
  });
  return next;
}

export async function runReviewedGitHubSync(
  runId: string,
  actorId: string,
  projectId: string,
) {
  const leaseId = randomUUID();
  const [run] = await db
    .update(githubSyncRuns)
    .set({
      status: "running",
      leaseId,
      leaseExpiresAt: new Date(Date.now() + 30 * 60_000),
      stage: "Validating reviewed changes",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(githubSyncRuns.id, runId),
        eq(githubSyncRuns.projectId, projectId),
        eq(githubSyncRuns.actorId, actorId),
        eq(githubSyncRuns.status, "queued"),
      ),
    )
    .returning();
  if (!run) return { skipped: true };
  let manifest = run.manifest;
  let result = run.result;
  const update = async (
    values: Partial<typeof githubSyncRuns.$inferInsert>,
  ) => {
    const rows = await db
      .update(githubSyncRuns)
      .set({
        ...values,
        updatedAt: new Date(),
        leaseExpiresAt: new Date(Date.now() + 30 * 60_000),
      })
      .where(
        and(
          eq(githubSyncRuns.id, runId),
          eq(githubSyncRuns.leaseId, leaseId),
          eq(githubSyncRuns.status, "running"),
        ),
      )
      .returning({ id: githubSyncRuns.id });
    if (!rows.length) throw new Error("Synchronization lease was lost");
  };
  try {
    const ctx = await resolveSyncContext(
      projectId,
      actorId,
      openGithubImportToken(run.credential),
      manifest.repository,
    );
    if (!ctx.token)
      throw new Error(
        "GitHub authorization expired. Reconnect and prepare a fresh review.",
      );
    if (
      (ctx.connection?.version || 0) !== manifest.connectionVersion &&
      !result.repositoryCreated
    )
      throw new Error("Connection changed after review");
    if (
      result.repositoryCreated &&
      ctx.connection &&
      (ctx.connection.repositoryId !== manifest.repositoryId ||
        ctx.connection.version !== manifest.connectionVersion + 1)
    )
      throw new Error("Connection changed after repository creation");
    if (!result.pushed && !result.commitSha)
      await validateReviewedLocalFiles(projectId, manifest, result.applied);
    if (manifest.newRepository && !result.repositoryCreated) {
      await update({ stage: "Creating repository" });
      const spec = manifest.newRepository;
      const repoBlock = await orgRepositoryBlock(projectId, spec.private === true, "connect");
      if (repoBlock) throw new Error(repoBlock);
      const marker = `NetworkBase synchronization ${runId}`;
      if (!spec.organization) {
        const account = await syncGithub<{ login: string }>(ctx.token, "/user");
        if (account.login.toLowerCase() !== spec.owner.toLowerCase())
          throw new Error(
            "Choose your authenticated GitHub account as the personal repository owner",
          );
      }
      let repo: SyncRepo;
      try {
        const existing = await syncGithub<SyncRepo>(
          ctx.token,
          repoApi(manifest.repository),
        );
        if (existing.description !== marker)
          throw new Error(
            "A repository with this name already exists. Choose it explicitly instead.",
          );
        repo = existing;
      } catch (error) {
        if (!(error instanceof SyncGithubError) || error.status !== 404)
          throw error;
        repo = await syncGithub<SyncRepo>(
          ctx.token,
          spec.organization
            ? `/orgs/${encodeURIComponent(spec.owner)}/repos`
            : "/user/repos",
          "POST",
          {
            name: spec.name,
            private: spec.private,
            auto_init: false,
            description: marker,
          },
        );
      }
      if (
        repo.full_name.toLowerCase() !==
        `${spec.owner}/${spec.name}`.toLowerCase()
      )
        throw new Error(
          "Created repository owner does not match the reviewed destination",
        );
      result = { ...result, repositoryCreated: true, repositoryId: repo.id };
      manifest = { ...manifest, repositoryId: repo.id };
      await update({ manifest, result });
    }
    if (result.repositoryCreated) {
      await db
        .insert(githubSyncConnections)
        .values({
          projectId,
          repository: manifest.repository,
          repositoryId: manifest.repositoryId!,
          branch: manifest.branch,
          version: manifest.connectionVersion + 1,
        })
        .onConflictDoUpdate({
          target: githubSyncConnections.projectId,
          set: {
            repository: manifest.repository,
            repositoryId: manifest.repositoryId!,
            branch: manifest.branch,
            installationId: null,
            version: manifest.connectionVersion + 1,
            updatedAt: new Date(),
          },
        });
      await db
        .update(workspaces)
        .set({
          githubRepoUrl: manifest.repository,
          githubDefaultBranch: manifest.branch,
        })
        .where(eq(workspaces.id, projectId));
    }
    const repo = await syncGithub<SyncRepo>(
      ctx.token,
      repoApi(manifest.repository),
    );
    if (repo.id !== manifest.repositoryId || repo.archived)
      throw new Error("Repository identity or availability changed");
    if (manifest.direction === "push") {
      if (repo.permissions?.push === false)
        throw new Error("GitHub write permission was removed");
      const repoBlock = await orgRepositoryBlock(projectId, repo.private === true, "push");
      if (repoBlock) throw new Error(repoBlock);
      if (!result.pushed && result.commitSha && result.branch) {
        if (
          (await readGitHubHead(
            ctx.token,
            manifest.repository,
            result.branch,
          )) === result.commitSha
        ) {
          result = { ...result, pushed: true };
          await update({ result });
        }
      }
      if (!result.pushed) {
        if (
          (await readGitHubHead(
            ctx.token,
            manifest.repository,
            manifest.newBranch?.base || manifest.branch,
          )) !== manifest.headSha
        )
          throw new Error("GitHub changed after review. Compare again.");
        if (
          manifest.newBranch &&
          (await readGitHubHead(
            ctx.token,
            manifest.repository,
            manifest.branch,
          ))
        )
          throw new Error(
            "The new branch already exists. Compare again with a different name.",
          );
        await update({ stage: "Preparing and publishing commit" });
        result = {
          ...result,
          ...(await publishGitSnapshot({
            manifest,
            runId,
            createdAt: run.createdAt,
            token: ctx.token,
            readContent: (key) => readStoredSyncContent(projectId, key),
            onStage: (stage) => update({ stage }),
            beforePush: async (commitSha, branch) => {
              await requireSyncOwner(projectId, actorId);
              // Content was verified while materializing the commit; only the
              // current node identities need a final race check before push.
              await validateReviewedLocalFiles(projectId, manifest, [], false);
              result = { ...result, commitSha, branch };
              await update({
                result,
                stage: "Pushing reviewed changes to GitHub",
              });
            },
          })),
        };
        await update({ result, stage: "Remote commit verified" });
      }
      if (manifest.mode === "pr") {
        await update({ stage: "Opening pull request" });
        const head = `${repo.full_name.split("/")[0]}:${result.branch}`;
        const existing = await syncGithub<
          Array<{ html_url: string; number: number }>
        >(
          ctx.token,
          `${repoApi(manifest.repository)}/pulls?head=${encodeURIComponent(head)}&base=${encodeURIComponent(manifest.newBranch?.base || manifest.branch)}&state=all`,
        );
        const pr =
          existing[0] ||
          (await syncGithub<{ html_url: string; number: number }>(
            ctx.token,
            `${repoApi(manifest.repository)}/pulls`,
            "POST",
            {
              title: (
                manifest.message.split("\n")[0] || "Update from NetworkBase"
              ).slice(0, 200),
              head: result.branch,
              base: manifest.newBranch?.base || manifest.branch,
              body: `Reviewed publication from NetworkBase.\n\nOperation: ${runId}\n\n${manifest.files.length} selected file(s).${manifest.message?.trim() ? `\n\n${manifest.message.trim()}` : ""}`,
            },
          ));
        result = {
          ...result,
          pullRequestUrl: pr.html_url,
          pullRequestNumber: pr.number,
          merged: false,
        };
      }
      // A PR branch is published but is not a baseline for the configured destination branch.
      if (manifest.mode === "direct")
        await db.transaction(async (tx) => {
          await assertWorkspaceWriteAccessTx(tx, projectId, actorId);
          const locked = await tx.execute(
            sql`SELECT id FROM github_sync_runs WHERE id=${runId} AND lease_id=${leaseId} AND status='running' FOR UPDATE`,
          );
          if (!locked.length) throw new Error("Synchronization lease was lost");
          for (const file of manifest.files)
            await saveBaseline(
              tx,
              projectId,
              manifest,
              file,
              file.nodeId,
              result.commitSha!,
              manifest.sequence,
            );
        });
    } else {
      if (
        !manifest.headSha ||
        (await readGitHubHead(
          ctx.token,
          manifest.repository,
          manifest.branch,
        )) !== manifest.headSha
      )
        throw new Error(
          "GitHub changed after review. Compare incoming changes again.",
        );
      // GitHub feature-x pulls into NetworkBase feature-x (H6, H-5): one save on the branch, main untouched.
      if (manifest.local) {
        await update({ stage: `Saving on ${manifest.local.name}` });
        result = await pullIntoBranch(manifest, runId, leaseId, projectId, actorId, result);
      }
      const deltaCache = new Map<string, Promise<Set<string>>>();
      const identityCache = new Map<number, Promise<any>>();
      let lastStageUpdate = 0;
      for (const file of manifest.local ? [] : manifest.files) {
        if (result.applied?.includes(file.path)) continue;
        const now = Date.now();
        // ponytail: 2s throttle on stage update ceiling avoids saturating Postgres with per-file updates. ceiling: 2s throttle. upgrade: Redis pub/sub if realtime per-file progress is required.
        if (now - lastStageUpdate > 2000) {
          lastStageUpdate = now;
          await update({ stage: `Applying ${file.path}` });
        }
        const authors = await remoteAuthors(
          ctx.token,
          manifest,
          file,
          deltaCache,
          identityCache,
        );
        const isRemote = !file.resolution || file.resolution === "github";
        const attribution = {
          source: isRemote ? "github" : "edge",
          repositoryId: manifest.repositoryId,
          commitSha: manifest.headSha,
          contributors: authors,
          importedBy: actorId,
          historyComplete: false,
          operationId: runId,
        };
        const nextApplied = [...(result.applied || []), file.path];
        const finish = async (tx: Transaction, nodeId: string | null) => {
          // History (report H3): a pull's files are saves "from GitHub".
          // ponytail: one save per pulled file (each file has its own transaction); one per pull needs one transaction.
          await saveContext(tx, { kind: "sync", message: `From GitHub ${manifest.repository}@${(manifest.headSha ?? "").slice(0, 7)}`, authorId: actorId });
          if (file.renamedFrom && nodeId) {
            const collision = await tx.query.workspaceNodes.findFirst({
              where: and(
                eq(workspaceNodes.projectId, projectId),
                eq(workspaceNodes.path, `/${file.path}`),
                isNull(workspaceNodes.taskId),
                isNull(workspaceNodes.deletedAt),
              ),
            });
            if (collision)
              throw new Error("Rename destination appeared after review");
            const parentId = await ensureIncomingParent(
              tx,
              projectId,
              file.path,
              actorId,
            );
            await tx
              .update(workspaceNodes)
              .set({
                parentId,
                path: `/${file.path}`,
                name: file.path.split("/").at(-1)!,
                updatedAt: new Date(),
              })
              .where(eq(workspaceNodes.id, nodeId));
            await saveBaseline(
              tx,
              projectId,
              manifest,
              {
                ...file,
                path: file.renamedFrom,
                remoteSha: null,
                resultHash: undefined,
                resultBlobSha: undefined,
              },
              null,
              manifest.headSha!,
              manifest.sequence,
            );
            await recordNodeEvent(
              projectId,
              actorId,
              nodeId,
              "github_file_moved",
              { operationId: runId, from: file.renamedFrom, to: file.path },
              tx,
            );
          }
          await saveBaseline(
            tx,
            projectId,
            manifest,
            file,
            nodeId,
            manifest.headSha!,
            manifest.sequence,
          );
          const saved = await tx
            .update(githubSyncRuns)
            .set({
              result: { ...result, applied: nextApplied },
              updatedAt: new Date(),
            })
            .where(
              and(
                eq(githubSyncRuns.id, runId),
                eq(githubSyncRuns.leaseId, leaseId),
                eq(githubSyncRuns.status, "running"),
              ),
            )
            .returning({ id: githubSyncRuns.id });
          if (!saved.length) throw new Error("Synchronization lease was lost");
        };
        if (file.nodeId && file.storageKey) {
          await withTransientFileLease(
            { projectId, nodeId: file.nodeId, userId: actorId },
            async (lease) => {
              await validateReviewedLocalFiles(projectId, {
                ...manifest,
                files: [file],
              });
              if (file.snapshotKey) {
                await applyFileRevision({
                  projectId,
                  nodeId: file.nodeId!,
                  actorUserId: actorId,
                  contentAuthorId: isRemote
                    ? authors[0]?.userId || null
                    : actorId,
                  attribution,
                  storageKey: file.snapshotKey,
                  assetId: await snapshotAssetId(runId, file.snapshotKey),
                  size: file.size,
                  mimeType: file.mimeType,
                  contentHash: file.resultHash || null,
                  mode: "new_revision",
                  baseVersion: file.version,
                  baseHash: file.localHash,
                  baseStorageKey: file.storageKey!,
                  basePath: `/${file.renamedFrom || file.path}`,
                  lease,
                  accessRequirement: "write",
                  eventType: "github_file_imported",
                  eventMetadata: { operationId: runId, contributors: authors },
                  afterMutationTx: (tx) => finish(tx, file.nodeId),
                });
              } else
                await db.transaction(async (tx) => {
                  await assertWorkspaceWriteAccessTx(tx, projectId, actorId);
                  await assertOwnedFileLease(tx, {
                    projectId,
                    nodeId: file.nodeId!,
                    userId: actorId,
                    credentials: lease,
                  });
                  const current = await tx.query.workspaceNodes.findFirst({
                    where: eq(workspaceNodes.id, file.nodeId!),
                  });
                  if (
                    !current ||
                    current.deletedAt ||
                    current.s3Key !== file.storageKey ||
                    current.path !== `/${file.path}` ||
                    current.currentVersion !== file.version
                  )
                    throw new Error("File changed after review");
                  await tx
                    .update(workspaceNodes)
                    .set({ deletedAt: new Date(), deletedBy: actorId })
                    .where(
                      and(
                        eq(workspaceNodes.id, file.nodeId!),
                        eq(workspaceNodes.projectId, projectId),
                      ),
                    );
                  await recordNodeEvent(
                    projectId,
                    actorId,
                    file.nodeId,
                    "github_file_deleted",
                    { operationId: runId },
                    tx,
                  );
                  await finish(tx, file.nodeId);
                });
            },
          );
        } else if (file.snapshotKey) {
          const incomingAssetId = await snapshotAssetId(
            runId,
            file.snapshotKey,
          );
          await db.transaction(async (tx) => {
            await assertWorkspaceWriteAccessTx(tx, projectId, actorId);
            const collision = await tx.query.workspaceNodes.findFirst({
              where: and(
                eq(workspaceNodes.projectId, projectId),
                eq(workspaceNodes.path, `/${file.path}`),
                isNull(workspaceNodes.taskId),
                isNull(workspaceNodes.deletedAt),
              ),
            });
            if (collision)
              throw new Error("An incoming file appeared after review");
            const parts = file.path.split("/");
            const parentId = await ensureIncomingParent(
              tx,
              projectId,
              file.path,
              actorId,
            );
            const [node] = await tx
              .insert(workspaceNodes)
              .values({
                projectId,
                parentId,
                path: `/${file.path}`,
                type: "file",
                name: parts.at(-1)!,
                createdBy: isRemote ? authors[0]?.userId || null : actorId,
                s3Key: file.snapshotKey,
                assetId: incomingAssetId,
                size: file.size,
                mimeType: file.mimeType,
              })
              .returning();
            if (!node) throw new Error("Couldn’t create incoming file");
            await tx.insert(fileVersions).values({
              nodeId: node.id,
              version: 1,
              s3Key: file.snapshotKey!,
              assetId: incomingAssetId,
              size: file.size,
              mimeType: file.mimeType,
              contentHash: file.resultHash,
              uploadedBy: isRemote ? authors[0]?.userId || null : actorId,
              attribution,
            });
            await recordNodeEvent(
              projectId,
              actorId,
              node.id,
              "github_file_imported",
              { operationId: runId, contributors: authors },
              tx,
            );
            await finish(tx, node.id);
          });
        } else await db.transaction((tx) => finish(tx, file.nodeId));
        result = {
          ...result,
          applied: nextApplied,
          commitSha: manifest.headSha,
        };
      }
    }
    await update({ result, stage: "Recording synchronization result" });
    const taskCompletion = await db.transaction(async (tx) => {
      let completion: { taskId: string; locked: Awaited<ReturnType<typeof lockTaskForWrite>>; result: Awaited<ReturnType<typeof transitionTaskTx>> } | null = null;
      await assertWorkspaceWriteAccessTx(tx, projectId, actorId);
      const locked = await tx.execute(
        sql`SELECT id FROM github_sync_runs WHERE id=${runId} AND lease_id=${leaseId} AND status='running' FOR UPDATE`,
      );
      if (!locked.length) throw new Error("Synchronization lease was lost");
      const connectedBranch =
        manifest.mode === "pr"
          ? manifest.newBranch?.base || manifest.branch
          : manifest.branch;
      // A NetworkBase branch's sync (H-5) leaves main's link (its branch and last commit) as it is.
      if (manifest.local) {
        await tx.update(workspaces).set({ githubLastSyncAt: new Date() }).where(eq(workspaces.id, projectId));
        // The branch remembers which GitHub branch it syncs with, so renaming it keeps the link (H24).
        await linkGithubBranch(tx, projectId, manifest.local, manifest.branch);
      } else if (
        !ctx.connection ||
        ctx.connection.repository !== manifest.repository ||
        ctx.connection.branch !== connectedBranch
      ) {
        await tx
          .insert(githubSyncConnections)
          .values({
            projectId,
            repository: manifest.repository,
            repositoryId: manifest.repositoryId!,
            branch: connectedBranch,
            version: manifest.connectionVersion + 1,
          })
          .onConflictDoUpdate({
            target: githubSyncConnections.projectId,
            set: {
              repository: manifest.repository,
              repositoryId: manifest.repositoryId!,
              branch: connectedBranch,
              version: manifest.connectionVersion + 1,
              updatedAt: new Date(),
            },
          });
      }
      if (!manifest.local) await tx
        .update(workspaces)
        .set({
          githubRepoUrl: manifest.repository,
          githubDefaultBranch: connectedBranch,
          githubLastSyncAt: new Date(),
          ...(manifest.mode === "direct" || manifest.direction === "pull"
            ? { githubLastCommitSha: result.commitSha }
            : {}),
        })
        .where(eq(workspaces.id, projectId));
      await recordNodeEvent(
        projectId,
        actorId,
        null,
        manifest.direction === "push" ? "git_push" : "git_pull",
        { operationId: runId, ...result, fileCount: manifest.files.length },
        tx,
      );

      // An explicit closing directive uses the same completion policy as the board.
      // Opening a PR or importing files does not complete a task before a merge.
      if (manifest.direction === "push" && result.pushed && !result.pullRequestUrl && manifest.message) {
        const directive = manifest.message.match(/\b(?:closes?|fix(?:es)?|resolv(?:es?))\s+#?([A-Za-z0-9_-]+)/i)?.[1];
        const number = directive?.match(/(\d+)$/)?.[1];
        const matchesProject = directive && (/^\d+$/.test(directive) || directive.toLowerCase() === `${ctx.project.key}-${number}`.toLowerCase());
        if (number && matchesProject) {
          const task = await tx.query.tasks.findFirst({ where: and(eq(tasks.projectId, projectId), eq(tasks.taskNumber, Number(number)), isNull(tasks.deletedAt)), columns: { id: true } });
          if (task) {
            const lockedTask = await lockTaskForWrite(tx, task.id, actorId);
            if (lockedTask.currentStatus !== "done") {
              const transition = await transitionTaskTx(tx, lockedTask, { taskId: task.id, userId: actorId, status: "done" });
              completion = { taskId: task.id, locked: lockedTask, result: transition };
            }
          }
        }
      }

      // Automated Ecosystem Broadcast to Project Updates
      if (manifest.direction === "push") {
        const commitShort = result.commitSha
          ? result.commitSha.slice(0, 7)
          : "";
        const updateContent = result.pullRequestUrl
          ? `Opened Pull Request #${result.pullRequestNumber || ""} on branch \`${manifest.branch}\` with ${manifest.files.length} files.`
          : `Synchronized ${manifest.files.length} ${manifest.files.length === 1 ? "file" : "files"} to \`${manifest.branch}\` on GitHub${commitShort ? ` (commit \`${commitShort}\`)` : ""}.`;

        await tx
          .insert(workspaceUpdates)
          .values({
            projectId,
            authorId: actorId,
            content: updateContent,
            updateType: "progress",
            visibility: "members",
            replyPolicy: "members",
            metadata: {
              source: "github_sync",
              commitSha: result.commitSha,
              pullRequestUrl: result.pullRequestUrl,
              branch: manifest.branch,
              fileCount: manifest.files.length,
            },
          })
          .catch(() => null);
      }
      if (manifest.direction === "pull")
        await tx
          .update(githubSyncConnections)
          .set({ incomingSha: null })
          .where(
            and(
              eq(githubSyncConnections.projectId, projectId),
              eq(githubSyncConnections.incomingSha, manifest.headSha!),
            ),
          );
      await tx
        .update(githubSyncRuns)
        .set({
          status: "completed",
          stage: result.pullRequestUrl
            ? "Published — pull request awaiting merge"
            : "Synchronization complete",
          result,
          credential: null,
          leaseId: null,
          leaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(githubSyncRuns.id, runId),
            eq(githubSyncRuns.leaseId, leaseId),
          ),
        );
      return completion;
    });
    if (taskCompletion) {
      await afterTaskTransition({ id: actorId }, taskCompletion.locked, taskCompletion.taskId, taskCompletion.result).catch(error => logger.error("github.task_completion_effects_failed", { projectId, taskId: taskCompletion.taskId, error: String(error) }));
    }
    return result;
  } catch (error) {
    const message = sanitizeGitErrorMessage(error);
    const needsReview =
      /after review|changed|expired|collid|conflict|lease was lost/i.test(
        message,
      ) && !result.pushed;
    await db
      .update(githubSyncRuns)
      .set({
        status: needsReview ? "needs_review" : "failed",
        error: message,
        stage: result.pushed
          ? "Published to GitHub; follow-up needs attention"
          : result.repositoryCreated
            ? "Repository created; publication needs attention"
            : "Synchronization needs attention",
        result,
        leaseId: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(eq(githubSyncRuns.id, runId), eq(githubSyncRuns.leaseId, leaseId)),
      );
    throw error;
  }
}
