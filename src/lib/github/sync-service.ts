import "server-only";
import { reusableBlobSha } from "@/lib/github/blob-reuse";
import { childGrant } from "@/lib/organizations/permissions";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, isNotNull, inArray, desc, ne, sql } from "drizzle-orm";
import { mapLocalSide } from "@/lib/github/branch-mapping";
import { db } from "@/lib/db";
import { scheduleAssetDeletionIfUnreferenced } from "@/lib/storage/asset-deletion";
import {
  branches,
  workspaces,
  workspaceNodes,
  workspaceEventCounters,
  workspaceNodeEvents,
  fileVersions,
  profiles,
  githubSyncConnections,
  githubSyncFiles,
  githubSyncRuns,
  githubSyncSnapshotAssets,
  githubContributorIdentities,
  storageAssets,
} from "@/lib/db/schema";
import { createAdminClient } from "@/lib/supabase/server";
import { readBoundedStorageBytes } from "@/lib/storage/bounded-object-read";
import { resolveGithubRepoAccess } from "./auth-resolver";
import {
  sanitizeGitErrorMessage,
  sealGithubImportToken,
} from "./repo-security";
import {
  normalizeGithubBranch,
  normalizeGithubRepoUrl,
} from "./repo-validation";
import {
  SyncGithubError,
  requireExistingOrEmptyBranch,
  readGitHubHead,
  readGitHubTree,
  readGitHubBlob,
  repoApi,
  syncGithub,
  type SyncRepo,
} from "./sync-api";
import {
  contentHashes,
  detectIncomingRenames,
  detectOutgoingRenames,
  classifySyncFile,
  excludedSyncPath,
  assertSafeSyncContent,
  validateSyncPath,
  SYNC_LIMITS,
  redactSyncManifest,
  type SyncManifest,
  type SyncFile,
  type SyncContributor,
  type SyncRunView,
} from "./sync-contract";
import { runWithConcurrency } from "@/lib/utils/concurrency";
import {
  createUploadIntent,
  finalizeUploadIntent,
} from "@/lib/upload/upload-intents";
import {
  buildWorkspaceFileKey,
  parseWorkspaceIdFromWorkspaceFileKey,
} from "@/lib/storage/workspace-file-key";

interface CachedBlobMeta {
  blobSha: string;
  isSafe: boolean;
  safeError?: string;
  expiresAt?: number;
}

const GIT_BLOB_CACHE_MAX_ENTRIES = 1000;
const GIT_BLOB_CACHE_TTL_MS = 30 * 60 * 1000;
// ponytail: 1,000-entry, 30-minute TTL in-memory LRU cache of Git blob SHA and safety metadata keyed by SHA-256 hash. ceiling: 1,000 entries (~200KB RAM). upgrade: Redis key-value cache if multi-instance worker fleet requires shared blob cache across processes.
const gitBlobCache = new Map<string, CachedBlobMeta>();

function getCachedBlobMeta(hash: string): CachedBlobMeta | undefined {
  const cached = gitBlobCache.get(hash);
  if (!cached) return undefined;
  if (cached.expiresAt !== undefined && cached.expiresAt <= Date.now()) {
    gitBlobCache.delete(hash);
    return undefined;
  }
  gitBlobCache.delete(hash);
  gitBlobCache.set(hash, cached);
  return cached;
}

function cacheBlobMeta(hash: string, meta: CachedBlobMeta) {
  gitBlobCache.delete(hash);
  if (gitBlobCache.size >= GIT_BLOB_CACHE_MAX_ENTRIES) {
    const now = Date.now();
    for (const [key, entry] of gitBlobCache) {
      if (entry.expiresAt !== undefined && entry.expiresAt <= now) {
        gitBlobCache.delete(key);
      }
    }
    if (gitBlobCache.size >= GIT_BLOB_CACHE_MAX_ENTRIES) {
      const oldest = gitBlobCache.keys().next().value;
      if (oldest !== undefined) gitBlobCache.delete(oldest);
    }
  }
  gitBlobCache.set(hash, {
    ...meta,
    expiresAt: Date.now() + GIT_BLOB_CACHE_TTL_MS,
  });
}

export async function requireSyncOwner(
  projectId: string,
  userId: string,
  options?: { includeSequence?: boolean },
) {
  const needsSequence = options?.includeSequence ?? false;
  const [project, counter] = await Promise.all([
    db.query.workspaces.findFirst({
      where: and(eq(workspaces.id, projectId), isNull(workspaces.deletedAt)),
    }),
    needsSequence
      ? db.query.workspaceEventCounters.findFirst({
          where: eq(workspaceEventCounters.projectId, projectId),
          columns: { nextSequence: true },
        })
      : Promise.resolve(null),
  ]);
  // A workspace in an organization follows the permissions table: connecting and pushing are its lead's alone.
  if (!project || project.ownerId !== userId || (project.parentId && childGrant("lead", "github_connect_push") !== "yes"))
    throw new Error(
      "Only the owner can manage repository sync.",
    );
  return {
    ...project,
    currentSequenceNumber:
      counter?.nextSequence ?? project.currentSequenceNumber,
  };
}
export async function resolveSyncContext(
  projectId: string,
  userId: string,
  oauthToken?: string | null,
  repositoryOverride?: string,
  options?: { includeSequence?: boolean },
) {
  // ponytail: parallel owner validation and sync connection queries. ceiling: 2 concurrent DB queries. upgrade: single joined SQL query if connection volume exceeds 10k RPS.
  const [project, connection] = await Promise.all([
    requireSyncOwner(projectId, userId, options),
    db.query.githubSyncConnections.findFirst({
      where: eq(githubSyncConnections.projectId, projectId),
    }),
  ]);
  const repository =
    repositoryOverride || connection?.repository || project.githubRepoUrl;
  const metadata = project.importSource?.metadata as
    | Record<string, unknown>
    | undefined;
  const access = repository
    ? await resolveGithubRepoAccess({
        repoUrl: repository,
        oauthToken,
        sealedImportToken: metadata?.importAuth,
        preferredInstallationId: connection?.installationId,
      })
    : null;
  return {
    project,
    connection,
    repository,
    token: oauthToken || access?.token || null,
    userToken: oauthToken || null,
    access,
  };
}
export type SyncContext = Awaited<ReturnType<typeof resolveSyncContext>>;

export async function readStoredSyncContent(
  projectId: string,
  key: string,
  storageOverride?: any,
) {
  if (parseWorkspaceIdFromWorkspaceFileKey(key) !== projectId)
    throw new Error("File content is outside this workspace");
  const storage =
    storageOverride ||
    (await createAdminClient()).storage.from("project-files");
  if (!storageOverride) {
    const bytes = await readBoundedStorageBytes({
      bucket: "project-files",
      storageKey: key,
      maxBytes: SYNC_LIMITS.fileBytes,
    });
    return Buffer.from(bytes);
  }
  const { data, error } = await storage.download(key);
  if (error || !data)
    throw new Error("Couldn’t read file content. Retry.");
  if (data.size > SYNC_LIMITS.fileBytes)
    throw new Error("File exceeds the 10 MB sync limit");
  return Buffer.from(await data.arrayBuffer());
}

export async function readSyncContributors(
  projectId: string,
  nodeIds: string[],
) {
  if (!nodeIds.length)
    return new Map<string, Array<SyncContributor & { sequence: number }>>();
  const rows = await db
    .select({
      nodeId: workspaceNodeEvents.nodeId,
      actorId: workspaceNodeEvents.actorId,
      sequence: workspaceNodeEvents.sequenceNumber,
      name: profiles.fullName,
      username: profiles.username,
      avatarUrl: profiles.avatarUrl,
      githubId: githubContributorIdentities.githubId,
      githubLogin: githubContributorIdentities.login,
      email: githubContributorIdentities.email,
    })
    .from(workspaceNodeEvents)
    .innerJoin(profiles, eq(profiles.id, workspaceNodeEvents.actorId))
    .leftJoin(
      githubContributorIdentities,
      eq(githubContributorIdentities.userId, profiles.id),
    )
    .where(
      and(
        eq(workspaceNodeEvents.projectId, projectId),
        inArray(workspaceNodeEvents.nodeId, nodeIds),
        inArray(workspaceNodeEvents.type, [
          "file_content_contributed",
          "create_file",
        ]),
        sql`${workspaceNodeEvents.metadata}->>'source' = 'edge' OR ${workspaceNodeEvents.type} = 'create_file'`,
        isNull(profiles.deletedAt),
      ),
    )
    .orderBy(desc(workspaceNodeEvents.sequenceNumber))
    .limit(20_001);
  if (rows.length > 20_000)
    throw new Error(
      "Too much contribution history for one comparison. Select a smaller publication scope.",
    );
  const result = new Map<
    string,
    Array<SyncContributor & { sequence: number }>
  >();
  for (const row of rows) {
    if (!row.nodeId) continue;
    const authors = result.get(row.nodeId) || [];
    if (!authors.some((author) => author.userId === row.actorId))
      authors.push({
        userId: row.actorId,
        name: row.name || row.username || "Contributor",
        username: row.username,
        avatarUrl: row.avatarUrl,
        githubId: row.githubId,
        githubLogin: row.githubLogin,
        email: row.email,
        sequence: row.sequence,
        source: "edge",
      });
    result.set(row.nodeId, authors);
  }
  // Local file versions and direct node creators are evidence; imported GitHub versions are not evidence about the importer.
  const legacy = await db.execute<{
    node_id: string;
    user_id: string;
    name: string;
    username: string | null;
    avatar_url: string | null;
    github_id: number | null;
    login: string | null;
    email: string | null;
  }>(sql`
    SELECT DISTINCT node.id AS node_id, p.id AS user_id, COALESCE(p.full_name, p.username, 'Contributor') AS name,
      p.username, p.avatar_url, identity.github_id, identity.login, identity.email
    FROM workspace_nodes node
    JOIN profiles p ON p.id = node.created_by AND p.deleted_at IS NULL
    LEFT JOIN github_contributor_identities identity ON identity.user_id = p.id
    WHERE node.workspace_id = ${projectId} AND ${inArray(sql`node.id`, nodeIds)}
      AND node.git_blob_hash IS NULL AND node.created_by IS NOT NULL
    UNION
    SELECT DISTINCT version.node_id, p.id AS user_id, COALESCE(p.full_name, p.username, 'Contributor') AS name,
      p.username, p.avatar_url, identity.github_id, identity.login, identity.email
    FROM file_versions version JOIN workspace_nodes node ON node.id = version.node_id
    JOIN profiles p ON p.id = version.uploaded_by AND p.deleted_at IS NULL
    LEFT JOIN github_contributor_identities identity ON identity.user_id = p.id
    WHERE node.workspace_id = ${projectId} AND ${inArray(sql`node.id`, nodeIds)}
      AND node.git_blob_hash IS NULL AND version.attribution = '{}'::jsonb
    LIMIT 20001
  `);
  if (legacy.length > 20000)
    throw new Error(
      "Contribution history exceeds the supported comparison limit",
    );
  for (const row of legacy) {
    const authors = result.get(row.node_id) || [];
    if (!authors.some((author) => author.userId === row.user_id))
      authors.push({
        userId: row.user_id,
        name: row.name,
        username: row.username,
        avatarUrl: row.avatar_url,
        githubId: row.github_id,
        githubLogin: row.login,
        email: row.email,
        source: "edge",
        sequence: 0,
      });
    result.set(row.node_id, authors);
  }
  return result;
}

/**
 * A branch's files as compare's local rows (H-5): the content the branch has (its own, or main's where it hasn't
 * changed them), keyed by path without the leading slash. No node ids: a branch file belongs to the branch.
 */
async function branchSyncRows(branch: typeof branches.$inferSelect) {
  const { filesUnder } = await import("@/lib/domain/branches");
  const { mainBranch } = await import("@/lib/domain/saves");
  const main = await mainBranch(branch.workspaceId);
  const entries = await filesUnder(branch, main.id, null);
  if (entries.length > SYNC_LIMITS.comparisonFiles)
    throw new Error(`Repository exceeds the ${SYNC_LIMITS.comparisonFiles.toLocaleString()}-entry comparison limit`);
  return new Map(entries.map((e) => [e.path.replace(/^\//, ""), {
    node: { id: null, type: "file", s3Key: e.storageKey, size: e.size ?? 0, mimeType: e.mimeType, gitHash: null, currentVersion: e.version ?? e.revision },
    version: { contentHash: e.contentHash, uploadedAt: null },
    updater: null,
  }]));
}

export async function compareSync(
  ctx: SyncContext,
  input: Pick<
    SyncManifest,
    "direction" | "branch" | "mode" | "newRepository" | "newBranch"
  >,
): Promise<SyncManifest> {
  const branch = normalizeGithubBranch(input.branch);
  if (!branch) throw new Error("Choose a valid GitHub branch");
  const repository = input.newRepository
    ? `https://github.com/${input.newRepository.owner}/${input.newRepository.name}`
    : ctx.repository;
  if (input.newRepository && !ctx.userToken)
    throw new Error(
      "Reconnect your GitHub account to authorize repository creation",
    );
  if (input.newRepository && input.direction !== "push")
    throw new Error("A new repository can only receive an initial push");
  if (!repository || !normalizeGithubRepoUrl(repository))
    throw new Error("Choose a repository first");
  let repo: SyncRepo | null = null;
  if (input.newRepository) {
    const spec = input.newRepository;
    if (spec.organization) {
      const membership = await syncGithub<{ state: string }>(
        ctx.userToken,
        `/user/memberships/orgs/${encodeURIComponent(spec.owner)}`,
      );
      if (membership.state !== "active")
        throw new Error(
          "Organization membership or approval is required to create this repository.",
        );
    } else {
      const account = await syncGithub<{ login: string }>(
        ctx.userToken,
        "/user",
      );
      if (account.login.toLowerCase() !== spec.owner.toLowerCase())
        throw new Error(
          "Choose your authenticated GitHub account as the personal repository owner",
        );
    }
    try {
      await syncGithub<SyncRepo>(ctx.userToken, repoApi(repository));
      throw new Error(
        "This owner already has a repository with that name. Connect it explicitly or choose another name.",
      );
    } catch (error) {
      if (!(error instanceof SyncGithubError) || error.status !== 404)
        throw error;
    }
  }
  if (!input.newRepository) {
    repo = await syncGithub<SyncRepo>(ctx.token, repoApi(repository));
    if (repo.archived) throw new Error("This repository is archived");
    if (
      ctx.connection &&
      ctx.connection.repository === repository &&
      repo.id !== ctx.connection.repositoryId
    )
      throw new Error(
        "Repository identity changed. Reconnect and review the destination.",
      );
    if (
      input.direction === "push" &&
      (!ctx.token || repo.permissions?.push === false)
    )
      throw new Error("GitHub write access is required");
  }
  const baseBranch = input.newBranch
    ? normalizeGithubBranch(input.newBranch.base)
    : branch;
  if (
    input.newBranch &&
    (!repo ||
      input.direction !== "push" ||
      !baseBranch ||
      baseBranch === branch)
  )
    throw new Error(
      "Choose a different new branch and an existing starting branch for a push",
    );
  if (input.newBranch && (await readGitHubHead(ctx.token, repository, branch)))
    throw new Error(
      "This branch already exists. Choose an existing branch or a different name.",
    );
  const headSha = repo
    ? await requireExistingOrEmptyBranch(ctx.token, repository, baseBranch!)
    : null;
  if (input.newBranch && !headSha)
    throw new Error("A new branch needs an existing starting commit");
  // Which NetworkBase side (report H6): main for the default branch, else the branch of the same name (H-5).
  const [settings] = await db.select({ on: workspaces.branchesEnabled }).from(workspaces).where(eq(workspaces.id, ctx.project.id)).limit(1);
  const twin = settings?.on && repo && !input.newBranch && branch !== repo.default_branch ? await githubTwin(ctx.project.id, branch) : null;
  const side = mapLocalSide({
    branchesOn: Boolean(settings?.on), direction: input.direction, githubBranch: branch, defaultBranch: repo?.default_branch ?? null,
    newBranch: Boolean(input.newBranch), nbBranch: twin ? { id: twin.id, status: twin.status } : null,
  });
  const onBranch = side.kind === "branch" ? twin! : null;
  const branchRows = onBranch ? await branchSyncRows(onBranch) : null;
  const [tree, rows, baselines, knownBlobs] = await Promise.all([
    readGitHubTree(ctx.token, repository, headSha),
    branchRows ? Promise.resolve([]) : db
      .select({
        node: workspaceNodes,
        version: fileVersions,
        updater: {
          name: profiles.fullName,
          username: profiles.username,
          avatarUrl: profiles.avatarUrl,
        },
      })
      .from(workspaceNodes)
      .leftJoin(
        fileVersions,
        and(
          eq(fileVersions.nodeId, workspaceNodes.id),
          eq(fileVersions.version, workspaceNodes.currentVersion),
        ),
      )
      .leftJoin(
        profiles,
        and(
          eq(profiles.id, fileVersions.uploadedBy),
          isNull(profiles.deletedAt),
        ),
      )
      .where(
        and(
          eq(workspaceNodes.projectId, ctx.project.id),
          isNull(workspaceNodes.taskId),
        ),
      )
      .limit(SYNC_LIMITS.comparisonFiles + 1),
    repo
      ? db
          .select({
            path: githubSyncFiles.path,
            localBlobSha: githubSyncFiles.localBlobSha,
            nodeId: githubSyncFiles.nodeId,
            localHash: githubSyncFiles.localHash,
            blobSha: githubSyncFiles.blobSha,
            commitSha: githubSyncFiles.commitSha,
            sequence: githubSyncFiles.sequence,
          })
          .from(githubSyncFiles)
          .where(
            and(
              eq(githubSyncFiles.projectId, ctx.project.id),
              eq(githubSyncFiles.repositoryId, repo.id),
              eq(githubSyncFiles.branch, baseBranch!),
            ),
          )
          .limit(SYNC_LIMITS.comparisonFiles)
      : Promise.resolve([]),
    // ponytail: batch known content hashes query across project to eliminate S3 downloads. ceiling: comparisonFiles rows, enforced by the limit below (PERF-009). upgrade: resolve only the hashes of the selected nodes if projects outgrow it.
    db
      .select({
        nodeId: githubSyncFiles.nodeId,
        path: githubSyncFiles.path,
        localHash: githubSyncFiles.localHash,
        localBlobSha: githubSyncFiles.localBlobSha,
      })
      .from(githubSyncFiles)
      .where(
        and(
          eq(githubSyncFiles.projectId, ctx.project.id),
          isNotNull(githubSyncFiles.localBlobSha),
        ),
      )
      .limit(SYNC_LIMITS.comparisonFiles),
  ]);
  if (
    rows.length > SYNC_LIMITS.comparisonFiles ||
    tree.length > SYNC_LIMITS.comparisonFiles
  )
    throw new Error(
      `Repository exceeds the ${SYNC_LIMITS.comparisonFiles.toLocaleString()}-entry comparison limit`,
    );
  const knownBlobMap = new Map<string, string>();
  const knownByNodeId = new Map<
    string,
    { localHash: string | null; localBlobSha: string }
  >();
  const knownByPath = new Map<
    string,
    { localHash: string | null; localBlobSha: string }
  >();
  for (const b of knownBlobs) {
    if (b.localBlobSha) {
      if (b.localHash) {
        knownBlobMap.set(b.localHash, b.localBlobSha);
        if (!getCachedBlobMeta(b.localHash)) {
          cacheBlobMeta(b.localHash, { blobSha: b.localBlobSha, isSafe: true });
        }
      }
      if (b.nodeId && !knownByNodeId.has(b.nodeId)) {
        knownByNodeId.set(b.nodeId, {
          localHash: b.localHash,
          localBlobSha: b.localBlobSha,
        });
      }
      if (b.path && !knownByPath.has(b.path)) {
        knownByPath.set(b.path, {
          localHash: b.localHash,
          localBlobSha: b.localBlobSha,
        });
      }
    }
  }
  const nodes = new Map(rows.map((row) => [row.node.id, row.node]));
  const pathFor = (id: string): string => {
    const parts: string[] = [];
    const visited = new Set<string>();
    let cursor: string | null = id;
    while (cursor) {
      if (visited.has(cursor) || visited.size >= 256)
        throw new Error("Invalid file hierarchy");
      visited.add(cursor);
      const node = nodes.get(cursor);
      if (!node) throw new Error("Missing parent folder");
      if (node.deletedAt) return "";
      parts.unshift(node.name);
      cursor = node.parentId;
    }
    return parts.join("/");
  };
  const local = new Map<string, (typeof rows)[number]>();
  for (const row of rows)
    if (row.node.type === "file") {
      const path = pathFor(row.node.id);
      if (path) local.set(path, row);
    }
  // A branch's files have no node of their own: content is by hash and asset (H-2), so no node ids reach the review.
  if (branchRows) for (const [path, row] of branchRows) local.set(path, row as unknown as (typeof rows)[number]);
  const remote = new Map(tree.map((entry) => [entry.path, entry]));
  const base = new Map(baselines.map((entry) => [entry.path, entry]));
  const paths = [
    ...new Set([...local.keys(), ...remote.keys(), ...base.keys()]),
  ].sort();
  if (paths.length > SYNC_LIMITS.comparisonFiles)
    throw new Error(
      `This sync supports ${SYNC_LIMITS.comparisonFiles.toLocaleString()} files per repository comparison.`,
    );
  const authorMap = await readSyncContributors(
    ctx.project.id,
    paths.flatMap((path) => {
      const id = local.get(path)?.node.id;
      return id ? [id] : [];
    }),
  );
  let sharedStorage: any = null;
  const getSharedStorage = async () => {
    if (!sharedStorage) {
      sharedStorage = (await createAdminClient()).storage.from("project-files");
    }
    return sharedStorage;
  };
  const files = await runWithConcurrency(
    paths,
    // ponytail: 24 concurrent storage downloads keeps worst-case memory bounded while avoiding serial I/O. ceiling: 24 concurrent streams (~120MB heap peak). upgrade: stream pipelining directly to crypto hashers without in-memory buffering.
    24,
    async (path): Promise<SyncFile> => {
      const row = local.get(path);
      const entry = remote.get(path);
      const previous = base.get(path);
      let blocked = excludedSyncPath(path);
      if (entry && !["100644", "100755"].includes(entry.mode))
        blocked = "Symbolic links and submodules require a Git client";
      const size = Math.max(Number(row?.node.size || 0), entry?.size || 0);
      if (size > SYNC_LIMITS.fileBytes)
        blocked = "File exceeds the 10 MB sync limit";
      let localHash: string | null = row?.version?.contentHash || null;
      let localBlobSha: string | null = null;
      let cachedMeta: CachedBlobMeta | undefined;
      if (row && !row.node.s3Key) blocked = "File content is not available";
      if (row?.node.s3Key && !blocked) {
        // Fast path 1: the baseline for this branch recorded this exact content (identity is the hash, never the node or version).
        const crossBranchBlobSha =
          reusableBlobSha(knownByNodeId.get(row.node.id), localHash) ??
          reusableBlobSha(knownByPath.get(path), localHash);
        const baselineBlobSha =
          previous &&
          (previous.nodeId === row.node.id || previous.path === path)
            ? reusableBlobSha(previous, localHash)
            : null;
        if (baselineBlobSha) {
          localBlobSha = baselineBlobSha;
          cacheBlobMeta(localHash!, { blobSha: localBlobSha, isSafe: true });
        }
        // Fast path 2: node already has gitHash (git_blob_hash) on projectNodes (e.g. from GitHub import)
        else if (
          row.node.gitHash &&
          /^[a-f0-9]{40}$/.test(row.node.gitHash) &&
          row.node.currentVersion === 1
        ) {
          localBlobSha = row.node.gitHash;
          if (!localHash && previous?.localHash) localHash = previous.localHash;
          if (localHash)
            cacheBlobMeta(localHash, { blobSha: localBlobSha, isSafe: true });
        }
        // Fast paths 3 and 4: another branch's record for this node or path, reused only when its content hash matches.
        else if (crossBranchBlobSha) {
          localBlobSha = crossBranchBlobSha;
          cacheBlobMeta(localHash!, { blobSha: localBlobSha, isSafe: true });
        }
        // Fast path 5: in-memory Git blob SHA cache (by contentHash)
        else if (localHash && (cachedMeta = getCachedBlobMeta(localHash))) {
          localBlobSha = cachedMeta.blobSha;
          if (input.direction === "push" && !cachedMeta.isSafe) {
            blocked = cachedMeta.safeError || "File content is blocked";
          }
        }
        // Fast path 6: project-level known blob cache (by contentHash)
        else if (localHash && knownBlobMap.has(localHash)) {
          localBlobSha = knownBlobMap.get(localHash)!;
          cacheBlobMeta(localHash, { blobSha: localBlobSha, isSafe: true });
        }
        // Fallback slow path: cold file with no known hash/sha anywhere
        else {
          const storage = await getSharedStorage();
          const content = await readStoredSyncContent(
            ctx.project.id,
            row.node.s3Key,
            storage,
          );
          const hashes = contentHashes(content);
          localHash = hashes.hash;
          localBlobSha = hashes.blobSha;
          let isSafe = true;
          let safeError: string | undefined;
          if (input.direction === "push") {
            try {
              assertSafeSyncContent(content);
            } catch (error) {
              isSafe = false;
              safeError = (error as Error).message;
              blocked = safeError;
            }
          }
          if (localHash) {
            cacheBlobMeta(localHash, {
              blobSha: localBlobSha,
              isSafe,
              safeError,
            });
          }
        }
      }
      const contributors = (authorMap.get(row?.node.id || "") || []).filter(
        (author) => !previous || author.sequence > previous.sequence,
      );
      return {
        path,
        updated:
          input.direction === "push"
            ? {
                source: "project",
                at: row?.version?.uploadedAt?.toISOString() || null,
                person:
                  row?.updater && (row.updater.name || row.updater.username)
                    ? {
                        name: row.updater.name || row.updater.username!,
                        avatarUrl: row.updater.avatarUrl,
                      }
                    : null,
              }
            : undefined,
        nodeId: side.kind === "main" ? row?.node.id || previous?.nodeId || null : null,
        version: row?.node.currentVersion ?? null,
        storageKey: row?.node.s3Key || null,
        localHash,
        localBlobSha,
        remoteSha: entry?.sha || null,
        baseSha: previous?.blobSha ?? null,
        baseCommit: previous?.commitSha || null,
        baseSequence: previous?.sequence || 0,
        size,
        mimeType: row?.node.mimeType || "application/octet-stream",
        mode: entry?.mode || "100644",
        blocked,
        contributors,
        change: classifySyncFile(
          input.direction,
          localBlobSha,
          entry?.sha || null,
          previous ? previous.blobSha : undefined,
        ),
      };
    },
  );
  const latest = await requireSyncOwner(ctx.project.id, ctx.project.ownerId, {
    includeSequence: true,
  });
  if (latest.currentSequenceNumber !== ctx.project.currentSequenceNumber)
    throw new Error("Workspace files changed during comparison. Compare again.");
  // Matching content is authoritative baseline evidence, including a pull request merged outside NetworkBase.
  const matching = files.filter(
    (file) =>
      !file.blocked &&
      file.localBlobSha &&
      file.localBlobSha === file.remoteSha,
  );
  if (repo && headSha && matching.length && !input.newBranch)
    await db.transaction(async (tx) => {
      await tx
        .insert(workspaceEventCounters)
        .values({
          projectId: ctx.project.id,
          nextSequence: latest.currentSequenceNumber,
        })
        .onConflictDoNothing();
      const locked = await tx.execute<{ next_sequence: number }>(
        sql`SELECT next_sequence FROM workspace_event_counters WHERE workspace_id=${ctx.project.id} FOR UPDATE`,
      );
      if (Number(locked[0]?.next_sequence) !== latest.currentSequenceNumber)
        throw new Error("Files changed during comparison. Compare again.");
      await tx
        .insert(githubSyncFiles)
        .values(
          matching.map((file) => ({
            projectId: ctx.project.id,
            repositoryId: repo!.id,
            branch,
            path: file.path,
            nodeId: file.nodeId,
            blobSha: file.remoteSha,
            localHash: file.localHash,
            localBlobSha: file.localBlobSha,
            commitSha: headSha,
            sequence: latest.currentSequenceNumber,
          })),
        )
        .onConflictDoUpdate({
          target: [
            githubSyncFiles.projectId,
            githubSyncFiles.repositoryId,
            githubSyncFiles.branch,
            githubSyncFiles.path,
          ],
          set: {
            nodeId: sql`excluded.node_id`,
            blobSha: sql`excluded.blob_sha`,
            localHash: sql`excluded.local_hash`,
            localBlobSha: sql`excluded.local_blob_sha`,
            commitSha: sql`excluded.commit_sha`,
            sequence: sql`excluded.sequence`,
          },
        });
    });
  return {
    repository,
    repositoryId: repo?.id || null,
    branch,
    headSha,
    connectionVersion: ctx.connection?.version || 0,
    sequence: latest.currentSequenceNumber,
    direction: input.direction,
    mode: headSha ? input.mode : "direct",
    message: "",
    files:
      input.direction === "pull"
        ? detectIncomingRenames(files)
        : detectOutgoingRenames(files),
    ...(input.newRepository ? { newRepository: input.newRepository } : {}),
    ...(input.newBranch ? { newBranch: { base: baseBranch! } } : {}),
    ...(side.kind === "branch" ? { local: { branchId: onBranch!.id, name: onBranch!.name, headSaveId: onBranch!.headSaveId } } : {}),
    ...(side.kind === "create" ? { local: { branchId: null, name: branch, headSaveId: null } } : {}),
    visibility: input.newRepository
      ? input.newRepository.private
        ? "private"
        : "public"
      : repo?.private
        ? "private"
        : "public",
  };
}

export async function createSyncReview(
  ctx: SyncContext,
  manifest: SyncManifest,
  choices: Array<{
    path: string;
    resolution?: "edge" | "github" | "merge";
    content?: string;
  }>,
  message: string,
) {
  if (!choices.length) throw new Error("Select at least one file");
  if (choices.length > SYNC_LIMITS.operationFiles)
    throw new Error(
      `Select no more than ${SYNC_LIMITS.operationFiles.toLocaleString()} files per operation`,
    );
  if (new Set(choices.map((choice) => choice.path)).size !== choices.length)
    throw new Error("Duplicate file selection");
  const selected: SyncFile[] = [];
  const manifestFiles = new Map(
    manifest.files.map((file) => [file.path, file] as const),
  );
  let total = 0;
  const id = randomUUID();
  const credential = ctx.token
    ? sealGithubImportToken(ctx.token, 60 * 60_000)
    : null;
  if (ctx.token && !credential && ctx.access?.source !== "app")
    throw new Error(
      "Configure GITHUB_IMPORT_TOKEN_ENCRYPTION_KEY or a GitHub App before queuing sync",
    );
  const storage = (await createAdminClient()).storage.from("project-files");
  const snapshotRefs: Array<{ path: string; assetId: string }> = [];
  const resolver = choices.some((choice) => choice.resolution === "merge")
    ? await db.query.profiles.findFirst({
        where: eq(profiles.id, ctx.project.ownerId),
      })
    : null;
  const resolverIdentity = resolver
    ? await db.query.githubContributorIdentities.findFirst({
        where: eq(githubContributorIdentities.userId, resolver.id),
      })
    : null;
  try {
    // Bound memory to at most six per-file buffers while avoiding a serial
    // download/upload round trip for every selected path.
    const batchSize = 6;
    for (let offset = 0; offset < choices.length; offset += batchSize) {
      const batch = choices.slice(offset, offset + batchSize);
      const prepared = await Promise.all(
        batch.map(async (choice, batchIndex) => {
          const file = manifestFiles.get(choice.path);
          if (!file || file.blocked || file.change === "unchanged")
            throw new Error(`Cannot synchronize ${choice.path}`);
          if (file.change === "conflict" && !choice.resolution)
            throw new Error(`Resolve the conflict in ${choice.path}`);
          const source =
            choice.resolution ||
            (manifest.direction === "push" ? "edge" : "github");
          if (
            choice.resolution ===
            (manifest.direction === "push" ? "github" : "edge")
          )
            throw new Error(
              `Keeping the destination makes no change to ${file.path}. Unselect it, or use the opposite sync direction to update the other copy.`,
            );
          let content: Buffer | null = null;
          if (source === "merge") {
            if (choice.content === undefined || choice.content.includes("\0"))
              throw new Error("Provide resolved text content");
            content = Buffer.from(choice.content, "utf8");
          } else if (source === "github" && file.remoteSha)
            content = await readGitHubBlob(
              ctx.token,
              manifest.repository,
              file.remoteSha,
            );
          const item = { ...file, resolution: choice.resolution };
          if (
            source === "merge" &&
            resolver &&
            !item.contributors.some((author) => author.userId === resolver.id)
          ) {
            item.contributors = [
              ...item.contributors,
              {
                userId: resolver.id,
                name: resolver.fullName || resolver.username || "Contributor",
                username: resolver.username,
                avatarUrl: resolver.avatarUrl,
                githubId: resolverIdentity?.githubId || null,
                githubLogin: resolverIdentity?.login || null,
                email: resolverIdentity?.email || null,
                source: "edge",
              },
            ];
          }
          let snapshotBytes = 0;
          if (source === "edge" && file.storageKey) {
            // ponytail: reuse immutable project revision storageKey instead of duplicating file snapshots. ceiling: immutable version S3 keys. upgrade: write-on-copy COW snapshots if version immutability contract changes.
            if (!file.localHash || !file.localBlobSha)
              throw new Error(`Cannot verify ${file.path}. Compare again.`);
            item.snapshotKey = file.storageKey;
            item.resultHash = file.localHash;
            item.resultBlobSha = file.localBlobSha;
            snapshotBytes = file.size;
          } else if (content) {
            assertSafeSyncContent(content);
            const { hash, blobSha } = contentHashes(content);
            item.snapshotKey = buildWorkspaceFileKey(
              ctx.project.id,
              `sync-snapshots/${id}/${offset + batchIndex}`,
            );
            item.resultHash = hash;
            item.resultBlobSha = blobSha;
            item.size = content.length;
            snapshotBytes = content.length;
          }
          return { item, content, snapshotBytes };
        }),
      );
      total += prepared.reduce((sum, item) => sum + item.snapshotBytes, 0);
      if (total > SYNC_LIMITS.operationBytes)
        throw new Error(
          `Selected files exceed the ${Math.floor(SYNC_LIMITS.operationBytes / (1024 * 1024))} MB operation limit`,
        );
      const uploads = await Promise.allSettled(
        prepared.map(async ({ item, content }) => {
          if (!item.snapshotKey) return null;
          if (!content) {
            const [asset] = await db
              .select({ id: storageAssets.id })
              .from(storageAssets)
              .where(
                and(
                  eq(storageAssets.bucket, "project-files"),
                  eq(storageAssets.storageKey, item.snapshotKey),
                  eq(storageAssets.state, "verified"),
                ),
              )
              .limit(1);
            if (!asset)
              throw new Error(
                `Storage registration is pending for ${item.path}`,
              );
            return { path: item.path, assetId: asset.id };
          }
          const intent = await createUploadIntent({
            userId: ctx.project.ownerId,
            projectId: ctx.project.id,
            bucket: "project-files",
            storageKey: item.snapshotKey,
            scope: "sync_snapshot",
            kind: "snapshot",
            expectedMimeType: "application/octet-stream",
            expectedSize: content.byteLength,
            idempotencyKey: `github-sync:${id}:${item.path}`,
            metadata: {
              runId: id,
              path: item.path,
              source: "reviewed_github_sync",
            },
          });
          if (intent.status === "pending") {
            const { error } = await storage.upload(intent.storageKey, content, {
              contentType: "application/octet-stream",
              cacheControl: "31536000",
              upsert: false,
            });
            if (error) {
              const { data: existingObject } = await storage.info(
                intent.storageKey,
              );
              if (!existingObject) {
                throw new Error(
                  `Couldn’t retain reviewed content for ${item.path}. Retry.`,
                );
              }
            }
          }
          const verified = await finalizeUploadIntent({
            intentId: intent.id,
            bucket: intent.bucket,
            storageKey: intent.storageKey,
            userId: ctx.project.ownerId,
            projectId: ctx.project.id,
            expectedScope: "sync_snapshot",
            expectedKind: "snapshot",
          });
          if (!verified.assetId)
            throw new Error(`Snapshot verification failed for ${item.path}`);
          const [asset] = await db
            .select({
              id: storageAssets.id,
              contentHash: storageAssets.contentHash,
            })
            .from(storageAssets)
            .where(
              and(
                eq(storageAssets.id, verified.assetId),
                eq(storageAssets.state, "verified"),
              ),
            )
            .limit(1);
          if (!asset || asset.contentHash !== item.resultHash) {
            throw new Error(
              `Snapshot content changed for ${item.path}. Compare again.`,
            );
          }
          return { path: item.path, assetId: asset.id };
        }),
      );
      for (const upload of uploads)
        if (upload.status === "fulfilled" && upload.value)
          snapshotRefs.push(upload.value);
      const failed = uploads.find((upload) => upload.status === "rejected");
      if (failed?.status === "rejected") throw failed.reason;
      selected.push(...prepared.map(({ item }) => item));
    }
    const run = await db.transaction(async (tx) => {
      const [created] = await tx
        .insert(githubSyncRuns)
        .values({
          id,
          projectId: ctx.project.id,
          actorId: ctx.project.ownerId,
          manifest: { ...manifest, message, files: selected },
          credential,
        })
        .returning();
      if (!created) return null;
      if (snapshotRefs.length > 0) {
        await tx.insert(githubSyncSnapshotAssets).values(
          snapshotRefs.map((ref) => ({
            runId: id,
            assetId: ref.assetId,
            path: ref.path,
          })),
        );
        await tx
          .update(storageAssets)
          .set({
            backupState: sql`CASE WHEN ${storageAssets.backupState} = 'verified' THEN 'verified' ELSE 'pending' END`,
            updatedAt: new Date(),
          })
          .where(
            inArray(
              storageAssets.id,
              snapshotRefs.map((ref) => ref.assetId),
            ),
          );
      }
      return created;
    });
    if (!run) throw new Error("Couldn’t persist sync review");
    return syncRunView(run);
  } catch (error) {
    if (snapshotRefs.length > 0) {
      // Promptly mark uncommitted snapshot assets for deletion; remaining unattached assets
      // are safely reclaimed by the canonical abandoned-asset worker.
      void db
        .transaction((tx) =>
          scheduleAssetDeletionIfUnreferenced(tx, snapshotRefs.map((ref) => ref.assetId), { lastErrorCode: "SYNC_REVIEW_FAILED" }),
        )
        .catch(() => {});
    }
    throw error;
  }
}

export async function cleanupReviewedSyncSnapshots() {
  const runs = await db
    .select({
      id: githubSyncRuns.id,
      projectId: githubSyncRuns.projectId,
      manifest: githubSyncRuns.manifest,
      result: githubSyncRuns.result,
    })
    .from(githubSyncRuns)
    .where(
      and(
        inArray(githubSyncRuns.status, ["completed", "cancelled"]),
        sql`${githubSyncRuns.updatedAt} < now() - interval '7 days'`,
        sql`COALESCE(${githubSyncRuns.result}->>'snapshotsCleaned','false') <> 'true'`,
      ),
    )
    .limit(25);
  const storage = (await createAdminClient()).storage.from("project-files");
  for (const run of runs) {
    const registeredRefs = await db
      .select({
        assetId: githubSyncSnapshotAssets.assetId,
        purpose: storageAssets.purpose,
      })
      .from(githubSyncSnapshotAssets)
      .innerJoin(
        storageAssets,
        eq(storageAssets.id, githubSyncSnapshotAssets.assetId),
      )
      .where(eq(githubSyncSnapshotAssets.runId, run.id));
    const keys = run.manifest.files.flatMap((file) =>
      file.snapshotKey ? [file.snapshotKey] : [],
    );
    // Compatibility cleanup for reviews created before snapshot assets were
    // normalized. Current reviews are detached and deleted by asset ID below.
    if (keys.length && registeredRefs.length === 0) {
      const versions = await db
        .select({ key: fileVersions.s3Key })
        .from(fileVersions)
        .where(inArray(fileVersions.s3Key, keys));
      const nodes = await db
        .select({ key: workspaceNodes.s3Key })
        .from(workspaceNodes)
        .where(inArray(workspaceNodes.s3Key, keys));
      const retained = new Set([...versions, ...nodes].map((row) => row.key));
      const removable = keys.filter(
        (key) =>
          !retained.has(key) &&
          key.startsWith(`${run.projectId}/sync-snapshots/${run.id}/`),
      );
      if (removable.length) {
        const { error } = await storage.remove(removable);
        if (error) throw new Error("Snapshot cleanup could not finish");
      }
    }
    await db.transaction(async (tx) => {
      if (registeredRefs.length > 0) {
        await tx
          .delete(githubSyncSnapshotAssets)
          .where(eq(githubSyncSnapshotAssets.runId, run.id));
        const ownedSnapshotIds = registeredRefs
          .filter((ref) => ref.purpose === "sync_snapshot:snapshot")
          .map((ref) => ref.assetId);
        // Snapshot bytes a node or version still points at stay verified (COR-045).
        await scheduleAssetDeletionIfUnreferenced(tx, ownedSnapshotIds, {
          lastErrorCode: "SYNC_SNAPSHOT_EXPIRED",
        });
      }
      await tx
        .update(githubSyncRuns)
        .set({ result: { ...run.result, snapshotsCleaned: true } })
        .where(eq(githubSyncRuns.id, run.id));
    });
  }
  return runs.length;
}

export async function cleanupRunSnapshots(runId: string) {
  const registeredRefs = await db
    .select({
      assetId: githubSyncSnapshotAssets.assetId,
      purpose: storageAssets.purpose,
    })
    .from(githubSyncSnapshotAssets)
    .innerJoin(
      storageAssets,
      eq(storageAssets.id, githubSyncSnapshotAssets.assetId),
    )
    .where(eq(githubSyncSnapshotAssets.runId, runId));

  if (registeredRefs.length > 0) {
    await db.transaction(async (tx) => {
      await tx
        .delete(githubSyncSnapshotAssets)
        .where(eq(githubSyncSnapshotAssets.runId, runId));
      const ownedSnapshotIds = registeredRefs
        .filter((ref) => ref.purpose === "sync_snapshot:snapshot")
        .map((ref) => ref.assetId);
      if (ownedSnapshotIds.length > 0) {
        await scheduleAssetDeletionIfUnreferenced(tx, ownedSnapshotIds, {
          lastErrorCode: "SYNC_SNAPSHOT_CANCELLED",
        });
      }
      await tx
        .update(githubSyncRuns)
        .set({
          result: sql`jsonb_set(COALESCE(${githubSyncRuns.result}, '{}'::jsonb), '{snapshotsCleaned}', 'true'::jsonb)`,
        })
        .where(eq(githubSyncRuns.id, runId));
    });
  }
}
export function syncRunView(
  run: Pick<
    typeof githubSyncRuns.$inferSelect,
    "id" | "status" | "stage" | "error" | "createdAt" | "manifest" | "result"
  >,
): SyncRunView {
  return {
    id: run.id,
    status: run.status,
    stage: run.stage,
    error: run.error ? sanitizeGitErrorMessage(run.error) : null,
    createdAt: run.createdAt.toISOString(),
    direction: run.manifest.direction,
    manifest: redactSyncManifest(run.manifest),
    result: run.result,
  };
}

/**
 * The NetworkBase branch for a GitHub branch (H-5, H24): the one linked to it by an earlier sync (so a rename keeps the
 * link), else the one of the same name that isn't linked elsewhere.
 */
export async function githubTwin(projectId: string, githubBranch: string) {
  const [twin] = await db.select().from(branches).where(and(eq(branches.workspaceId, projectId), ne(branches.status, "deleted"), eq(branches.isDefault, false),
    sql`(lower(${branches.githubBranch}) = lower(${githubBranch}) OR (${branches.githubBranch} IS NULL AND lower(${branches.name}) = lower(${githubBranch})))`))
    .orderBy(sql`${branches.githubBranch} IS NULL`).limit(1);
  return twin ?? null;
}

/** After a branch's sync, it remembers its GitHub branch (H24). `tx` is the run's transaction. */
export async function linkGithubBranch(tx: { execute: typeof db.execute }, projectId: string, local: { branchId: string | null; name: string }, githubBranch: string) {
  await tx.execute(sql`UPDATE branches SET github_branch = coalesce(github_branch, ${githubBranch})
    WHERE workspace_id = ${projectId} AND NOT is_default AND status = 'active'
      AND (id = ${local.branchId ?? null}::uuid OR (${local.branchId ?? null}::uuid IS NULL AND lower(name) = lower(${local.name})))`);
}

/** The NetworkBase branch a review used is still as it was (or, for one a pull creates, still doesn't exist). */
export async function validateBranchSide(projectId: string, local: NonNullable<SyncManifest["local"]>) {
  if (local.branchId) {
    const [branch] = await db.select({ status: branches.status, head: branches.headSaveId }).from(branches)
      .where(and(eq(branches.id, local.branchId), eq(branches.workspaceId, projectId))).limit(1);
    if (!branch || branch.status !== "active" || (branch.head ?? null) !== (local.headSaveId ?? null))
      throw new Error(`The branch ${local.name} changed after review. Compare again.`);
    return;
  }
  const [taken] = await db.select({ id: branches.id }).from(branches)
    .where(and(eq(branches.workspaceId, projectId), sql`lower(${branches.name}) = lower(${local.name})`, ne(branches.status, "deleted"))).limit(1);
  if (taken) throw new Error(`A branch named ${local.name} appeared after review. Compare again.`);
}

export async function validateReviewedLocalFiles(
  projectId: string,
  manifest: SyncManifest,
  applied: string[] = [],
  verifyContent = true,
) {
  const appliedPaths = new Set(applied);
  const files = manifest.files.filter((file) => !appliedPaths.has(file.path));
  for (const file of files) validateSyncPath(file.path);
  // A branch's side (H-5): its content is by hash, so the branch not having moved since review is the whole check.
  if (manifest.local) {
    if (files.length) await validateBranchSide(projectId, manifest.local);
    return;
  }
  const nodeIds = files.flatMap((file) => (file.nodeId ? [file.nodeId] : []));
  const collisionPaths = files.flatMap((file) =>
    !file.nodeId || !file.storageKey ? [`/${file.path}`] : [],
  );
  const [nodes, collisions] = await Promise.all([
    nodeIds.length
      ? db
          .select({
            node: {
              id: workspaceNodes.id,
              currentVersion: workspaceNodes.currentVersion,
              s3Key: workspaceNodes.s3Key,
              path: workspaceNodes.path,
              mimeType: workspaceNodes.mimeType,
            },
            version: {
              contentHash: fileVersions.contentHash,
            },
          })
          .from(workspaceNodes)
          .leftJoin(
            fileVersions,
            and(
              eq(fileVersions.nodeId, workspaceNodes.id),
              eq(fileVersions.version, workspaceNodes.currentVersion),
            ),
          )
          .where(
            and(
              eq(workspaceNodes.projectId, projectId),
              inArray(workspaceNodes.id, nodeIds),
              isNull(workspaceNodes.deletedAt),
            ),
          )
      : [],
    collisionPaths.length
      ? db
          .select({ path: workspaceNodes.path })
          .from(workspaceNodes)
          .where(
            and(
              eq(workspaceNodes.projectId, projectId),
              inArray(workspaceNodes.path, collisionPaths),
              isNull(workspaceNodes.deletedAt),
              isNull(workspaceNodes.taskId),
            ),
          )
      : [],
  ]);
  const nodesById = new Map(nodes.map((row) => [row.node.id, row]));
  const occupiedPaths = new Set(collisions.map((node) => node.path));
  let sharedStorage: any = null;
  const getSharedStorage = async () => {
    if (!sharedStorage) {
      sharedStorage = (await createAdminClient()).storage.from("project-files");
    }
    return sharedStorage;
  };
  await runWithConcurrency(files, 24, async (file) => {
    if (!file.nodeId || !file.storageKey) {
      if (occupiedPaths.has(`/${file.path}`))
        throw new Error(`File appeared after review: ${file.path}`);
      return;
    }
    const row = nodesById.get(file.nodeId);
    const node = row?.node;
    if (
      !node ||
      node.currentVersion !== file.version ||
      node.s3Key !== file.storageKey ||
      node.path.replace(/^\//, "") !==
        (manifest.direction === "pull"
          ? file.renamedFrom || file.path
          : file.path)
    )
      throw new Error(`File changed after review: ${file.path}`);
    if (verifyContent) {
      // ponytail: database contentHash validation (0 network round-trips). ceiling: database-backed contentHash. upgrade: S3 byte-range ETags if database contentHash is missing.
      if (row.version?.contentHash) {
        if (row.version.contentHash !== file.localHash) {
          throw new Error(`Content changed after review: ${file.path}`);
        }
      } else {
        const storage = await getSharedStorage();
        if (
          contentHashes(
            await readStoredSyncContent(projectId, node.s3Key!, storage),
          ).hash !== file.localHash
        )
          throw new Error(`Content changed after review: ${file.path}`);
      }
    }
  });
}
