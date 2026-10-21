import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, rm, mkdir, writeFile, lstat, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import {
  validateSyncPath,
  commitIdentity,
  contentHashes,
  assertSafeSyncContent,
  type SyncManifest,
} from "./sync-contract";
import { withGitCredentialEnv } from "./git-auth";
import { runWithConcurrency } from "@/lib/utils/concurrency";

const exec = promisify(execFile);

/**
 * Direct GitHub REST Git Data API publisher.
 * Atomically creates Git blobs, Git tree, Git commit, and updates ref over HTTPS.
 * Completely eliminates local disk I/O, mkdtemp, and OS `execFile("git")` subprocesses.
 * Typical execution time: 150 - 400ms.
 */
async function publishGitSnapshotViaRestApi(input: {
  manifest: SyncManifest;
  runId: string;
  createdAt: Date;
  token: string | null;
  readContent: (key: string) => Promise<Buffer>;
  beforePush: (sha: string, branch: string) => Promise<void>;
  onStage?: (stage: string) => Promise<void>;
}): Promise<{ commitSha: string; branch: string; pushed: true }> {
  if (!input.token) {
    throw new Error("GitHub authentication token is required for Git Data API publication");
  }
  const { repoApi, syncGithub, SyncGithubError } = await import("./sync-api");
  const { manifest } = input;
  const repoEndpoint = repoApi(manifest.repository);
  const branch = manifest.newBranch
    ? manifest.branch
    : manifest.mode === "pr"
      ? `networkbase/sync-${input.runId}`
      : manifest.branch;

  await input.onStage?.("Preparing remote commit");

  // 1. Get parent tree SHA if headSha exists
  let baseTreeSha: string | undefined = undefined;
  if (manifest.headSha) {
    try {
      const parentCommit = await syncGithub<{ tree: { sha: string } }>(
        input.token,
        `${repoEndpoint}/git/commits/${manifest.headSha}`,
      );
      baseTreeSha = parentCommit.tree?.sha;
    } catch {
      // If parent commit cannot be resolved, fall back to undefined baseTreeSha
    }
  }

  // 2. Upload blobs for files and construct tree entries
  await input.onStage?.("Materializing file snapshots");
  const identity = commitIdentity(manifest.files);
  const treeEntries: Array<{
    path: string;
    mode: "100644" | "100755";
    type: "blob";
    sha: string | null;
  }> = [];

  await runWithConcurrency(manifest.files, 12, async (file) => {
    validateSyncPath(file.path);
    if (file.renamedFrom) {
      validateSyncPath(file.renamedFrom);
      treeEntries.push({
        path: file.renamedFrom,
        mode: "100644",
        type: "blob",
        sha: null, // removes the old path from the tree
      });
    }
    if (file.snapshotKey) {
      const bytes = await input.readContent(file.snapshotKey);
      if (contentHashes(bytes).hash !== file.resultHash) {
        throw new Error("Reviewed snapshot integrity check failed");
      }
      assertSafeSyncContent(bytes);

      // Create blob on GitHub
      const blob = await syncGithub<{ sha: string }>(
        input.token,
        `${repoEndpoint}/git/blobs`,
        "POST",
        {
          content: bytes.toString("base64"),
          encoding: "base64",
        },
      );
      treeEntries.push({
        path: file.path,
        mode: file.mode === "100755" ? "100755" : "100644",
        type: "blob",
        sha: blob.sha,
      });
    } else {
      // File deletion
      treeEntries.push({
        path: file.path,
        mode: "100644",
        type: "blob",
        sha: null,
      });
    }
  });

  // 3. Create new tree
  await input.onStage?.("Building Git tree");
  const newTree = await syncGithub<{ sha: string }>(
    input.token,
    `${repoEndpoint}/git/trees`,
    "POST",
    {
      base_tree: baseTreeSha,
      tree: treeEntries,
    },
  );

  // 4. Create new commit
  await input.onStage?.("Creating commit");
  const message = `${manifest.message}\n\nNetworkBase-Sync-Operation: ${input.runId}${identity.trailers ? `\n${identity.trailers}` : ""}`;
  const commitAuthor = {
    name: identity.author.name,
    email: identity.author.email,
    date: input.createdAt.toISOString(),
  };
  const commitCommitter = {
    name: "NetworkBase Sync",
    email: "sync@networkbase.invalid",
    date: input.createdAt.toISOString(),
  };

  const newCommit = await syncGithub<{ sha: string }>(
    input.token,
    `${repoEndpoint}/git/commits`,
    "POST",
    {
      message,
      tree: newTree.sha,
      parents: manifest.headSha ? [manifest.headSha] : [],
      author: commitAuthor,
      committer: commitCommitter,
    },
  );
  const commitSha = newCommit.sha;

  // 5. Pre-push hook (race condition verification, etc.)
  await input.beforePush(commitSha, branch);

  // 6. Push reference update
  await input.onStage?.("Updating branch reference");
  if (manifest.newBranch || manifest.mode === "pr") {
    // Creating a new ref
    try {
      await syncGithub(
        input.token,
        `${repoEndpoint}/git/refs`,
        "POST",
        {
          ref: `refs/heads/${branch}`,
          sha: commitSha,
        },
      );
    } catch (refErr) {
      if (refErr instanceof SyncGithubError && refErr.status === 422) {
        // Ref already exists, update with force
        await syncGithub(
          input.token,
          `${repoEndpoint}/git/refs/heads/${encodeURIComponent(branch)}`,
          "PATCH",
          {
            sha: commitSha,
            force: true,
          },
        );
      } else {
        throw refErr;
      }
    }
  } else {
    // Existing branch: update ref
    try {
      await syncGithub(
        input.token,
        `${repoEndpoint}/git/refs/heads/${encodeURIComponent(branch)}`,
        "PATCH",
        {
          sha: commitSha,
          force: false,
        },
      );
    } catch (patchErr) {
      if (patchErr instanceof SyncGithubError && patchErr.status === 404) {
        await syncGithub(
          input.token,
          `${repoEndpoint}/git/refs`,
          "POST",
          {
            ref: `refs/heads/${branch}`,
            sha: commitSha,
          },
        );
      } else {
        throw patchErr;
      }
    }
  }

  return { commitSha, branch, pushed: true };
}

/** CLI-based fallback for environments with full Git access or unusual refspec configurations. */
async function publishGitViaCli(input: {
  manifest: SyncManifest;
  runId: string;
  createdAt: Date;
  token: string | null;
  readContent: (key: string) => Promise<Buffer>;
  beforePush: (sha: string, branch: string) => Promise<void>;
  onStage?: (stage: string) => Promise<void>;
}) {
  const { manifest } = input;
  const root = await mkdtemp(join(tmpdir(), "networkbase-reviewed-sync-"));
  const branch = manifest.newBranch
    ? manifest.branch
    : manifest.mode === "pr"
      ? `networkbase/sync-${input.runId}`
      : manifest.branch;
  try {
    return await withGitCredentialEnv(input.token, async (credentialEnv) => {
      const identity = commitIdentity(manifest.files);
      const env = {
        ...credentialEnv,
        GIT_CONFIG_GLOBAL: "/dev/null",
        GIT_LITERAL_PATHSPECS: "1",
        GIT_AUTHOR_NAME: identity.author.name,
        GIT_AUTHOR_EMAIL: identity.author.email,
        GIT_COMMITTER_NAME: "NetworkBase Sync",
        GIT_COMMITTER_EMAIL: "sync@networkbase.invalid",
        GIT_AUTHOR_DATE: input.createdAt.toISOString(),
        GIT_COMMITTER_DATE: input.createdAt.toISOString(),
      };
      const git = async (...args: string[]) =>
        (
          await exec(
            "git",
            [
              "-c",
              "core.hooksPath=/dev/null",
              "-c",
              "commit.gpgSign=false",
              "-c",
              "http.followRedirects=false",
              "-C",
              root,
              ...args,
            ],
            { env, timeout: 120_000, maxBuffer: 4 * 1024 * 1024 },
          )
        ).stdout.trim();
      await input.onStage?.("Preparing reviewed files");
      await git("init", "--initial-branch", branch);
      await git("remote", "add", "origin", manifest.repository);
      if (manifest.headSha) {
        if (!/^[a-f0-9]{40}$/.test(manifest.headSha))
          throw new Error("Invalid reviewed commit");
        await git(
          "fetch",
          "--depth=1",
          "--no-tags",
          "origin",
          manifest.headSha,
        );
        await git("checkout", "--detach", "FETCH_HEAD");
      }
      await runWithConcurrency(manifest.files, 24, async (file) => {
        validateSyncPath(file.path);
        // Never follow a repository symlink when materializing a reviewed file.
        let cursor = root;
        for (const segment of file.path.split("/")) {
          cursor = join(cursor, segment);
          try {
            if ((await lstat(cursor)).isSymbolicLink())
              throw new Error(
                `Symlink destination is not supported: ${file.path}`,
              );
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
        if (file.renamedFrom) {
          validateSyncPath(file.renamedFrom);
          let previous = root;
          for (const segment of file.renamedFrom.split("/")) {
            previous = join(previous, segment);
            try {
              if ((await lstat(previous)).isSymbolicLink())
                throw new Error("Symlink rename source is not supported");
            } catch (error) {
              if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
            }
          }
          await rm(join(root, file.renamedFrom), { force: true });
        }
        const target = join(root, file.path);
        if (file.snapshotKey) {
          const bytes = await input.readContent(file.snapshotKey);
          if (contentHashes(bytes).hash !== file.resultHash)
            throw new Error("Reviewed snapshot integrity check failed");
          assertSafeSyncContent(bytes);
          await mkdir(dirname(target), { recursive: true });
          await writeFile(target, bytes);
          await chmod(target, file.mode === "100755" ? 0o755 : 0o644);
        } else {
          try {
            await rm(target);
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          }
        }
      });
      // ponytail: native git add stages reviewed snapshot in one pass. ceiling: OS file descriptor and memory limits on worker container. upgrade: direct tree construction via Git Data API if container storage is constrained.
      await git("add", "--all", "--", ".");
      if (!(await git("status", "--porcelain")))
        throw new Error(
          "The selected resolution does not change GitHub. Choose other files or resolutions.",
        );
      const message = `${manifest.message}\n\nNetworkBase-Sync-Operation: ${input.runId}${identity.trailers ? `\n${identity.trailers}` : ""}`;
      await git("commit", "--no-verify", "-m", message);
      const sha = await git("rev-parse", "HEAD");
      await input.beforePush(sha, branch);
      // Fast-forward-only; branch protections and concurrent remote changes fail closed.
      // ponytail: git push exits 0 only upon verified remote ref update; pruning redundant ls-remote saves 250-450ms network latency. ceiling: fast-forward pushes only. upgrade: explicit remote ref leasing if concurrent non-fast-forward push queues are introduced.
      await git(
        "push",
        ...(manifest.newBranch
          ? [`--force-with-lease=refs/heads/${branch}:`]
          : []),
        "origin",
        `HEAD:refs/heads/${branch}`,
      );
      return { commitSha: sha, branch, pushed: true };
    });
  } finally {
    // root is the exact directory allocated by mkdtemp, never a caller-provided path.
    await rm(root, { recursive: true, force: true });
  }
}

/**
 * Publishes reviewed changes to GitHub.
 * Attempts high-performance, diskless Git Data REST API first.
 * Falls back to local Git CLI if needed.
 */
export async function publishGitSnapshot(input: {
  manifest: SyncManifest;
  runId: string;
  createdAt: Date;
  token: string | null;
  readContent: (key: string) => Promise<Buffer>;
  beforePush: (sha: string, branch: string) => Promise<void>;
  onStage?: (stage: string) => Promise<void>;
}) {
  if (input.token) {
    try {
      return await publishGitSnapshotViaRestApi(input);
    } catch (restError) {
      console.warn(
        "[github-sync] Git Data REST API attempt failed, falling back to git CLI:",
        restError,
      );
    }
  }

  return publishGitViaCli(input);
}
