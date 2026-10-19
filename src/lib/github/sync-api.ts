import "server-only";
import { parseGithubRepo } from "./repo-preview";
import { sanitizeGitErrorMessage } from "./repo-security";
import {
  contentHashes,
  GITHUB_WORKFLOW_PERMISSION_ERROR,
  includesGithubWorkflowFiles,
} from "./sync-contract";

export class SyncGithubError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
// Fixed host, bounded requests, and no automatic replay of external mutations.
export async function syncGithub<T>(
  token: string | null,
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  if (!path.startsWith("/") || path.startsWith("//") || /[\r\n]/.test(path))
    throw new Error("Invalid GitHub API path");
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(body ? { "Content-Type": "application/json" } : {}),
  };
  const executeFetch = () =>
    fetch(`https://api.github.com${path}`, {
      method,
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(20_000),
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
    });

  let response = await executeFetch();

  // ponytail: single backoff retry on secondary rate limit for idempotent GET. ceiling: 1 retry, max 5s backoff. upgrade: exponential backoff queue with jitter if hitting sustained GitHub org rate limits.
  if (
    method === "GET" &&
    (response.status === 429 ||
      (response.status === 403 &&
        (response.headers.has("retry-after") ||
          response.headers.get("x-ratelimit-remaining") === "0")))
  ) {
    const retryAfter = parseInt(response.headers.get("retry-after") || "1", 10);
    const delayMs =
      Math.min(Math.max(0, isNaN(retryAfter) ? 1 : retryAfter), 5) * 1000;
    if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs));
    response = await executeFetch();
  }

  if (response.status === 204) return undefined as T;
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  if (reader)
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 24 * 1024 * 1024) {
          await reader.cancel();
          throw new Error("GitHub response exceeds the safe sync limit");
        }
        chunks.push(value);
      }
    } finally {
      reader.releaseLock();
    }
  const text = Buffer.concat(chunks).toString("utf8");
  const data = text ? JSON.parse(text) : null;
  if (!response.ok)
    throw new SyncGithubError(
      response.status,
      sanitizeGitErrorMessage(
        `GitHub ${response.status}: ${data?.message || "Request failed"}`,
      ),
    );
  return data as T;
}

export async function assertGithubWorkflowPermission(
  token: string | null,
  paths: Iterable<string>,
) {
  if (!token || !includesGithubWorkflowFiles(paths)) return;
  const response = await fetch("https://api.github.com/user", {
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(20_000),
    headers: {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
    },
  });
  await response.body?.cancel();
  if (!response.ok)
    throw new SyncGithubError(
      response.status,
      `GitHub ${response.status}: Unable to verify workflow permission`,
    );
  const granted = response.headers.get("x-oauth-scopes");
  // GitHub App and fine-grained tokens do not expose OAuth scopes here; their
  // repository permissions remain the source of truth at push time.
  if (
    granted !== null &&
    !granted
      .split(",")
      .map((scope) => scope.trim().toLowerCase())
      .includes("workflow")
  )
    throw new Error(GITHUB_WORKFLOW_PERMISSION_ERROR);
}
export function repoApi(repository: string) {
  const parsed = parseGithubRepo(repository);
  if (!parsed) throw new Error("Invalid GitHub repository URL");
  return `/repos/${encodeURIComponent(parsed.owner)}/${encodeURIComponent(parsed.repo)}`;
}
export interface SyncRepo {
  id: number;
  full_name: string;
  html_url: string;
  default_branch: string;
  private: boolean;
  archived: boolean;
  permissions?: { push?: boolean; pull?: boolean };
  description?: string;
}
export interface SyncTreeEntry {
  path: string;
  type: string;
  sha: string;
  size?: number;
  mode: string;
}
export async function readGitHubHead(
  token: string | null,
  repository: string,
  branch: string,
) {
  try {
    const ref = await syncGithub<{ object: { sha: string } }>(
      token,
      `${repoApi(repository)}/git/ref/heads/${encodeURIComponent(branch)}`,
    );
    return ref.object.sha;
  } catch (error) {
    if (
      error instanceof SyncGithubError &&
      (error.status === 404 || error.status === 409)
    )
      return null;
    throw error;
  }
}
export async function readGitHubTree(
  token: string | null,
  repository: string,
  head: string | null,
): Promise<SyncTreeEntry[]> {
  if (!head) return [];
  const result = await syncGithub<{
    truncated: boolean;
    tree: SyncTreeEntry[];
  }>(token, `${repoApi(repository)}/git/trees/${head}?recursive=1`);
  if (!result?.truncated) {
    return (result?.tree ?? []).filter((entry) => entry && entry.type !== "tree");
  }

  // A truncated recursive tree is rebuilt one directory level at a time. Every piece must arrive
  // complete: a manifest with missing entries would read as remote deletions (COR-005), so any gap
  // fails the operation instead of returning a partial list.
  // ponytail: one level of subtrees. ceiling: a single directory over GitHub's tree limit fails closed. upgrade: recurse into truncated subtrees.
  const rootResult = await syncGithub<{
    truncated: boolean;
    tree: SyncTreeEntry[];
  }>(token, `${repoApi(repository)}/git/trees/${head}`);
  if (rootResult?.truncated) {
    throw new SyncGithubError(422, "The repository tree is too large to compare completely.");
  }

  const allBlobs: SyncTreeEntry[] = [];
  const subTreesToFetch: Array<{ sha: string; prefix: string }> = [];
  for (const entry of rootResult?.tree ?? []) {
    if (!entry) continue;
    if (entry.type === "tree") subTreesToFetch.push({ sha: entry.sha, prefix: entry.path });
    else allBlobs.push(entry);
  }

  const BATCH_SIZE = 5;
  for (let i = 0; i < subTreesToFetch.length; i += BATCH_SIZE) {
    const chunk = subTreesToFetch.slice(i, i + BATCH_SIZE);
    const subResults = await Promise.all(
      chunk.map(async ({ sha, prefix }) => {
        const sub = await syncGithub<{
          truncated: boolean;
          tree: SyncTreeEntry[];
        }>(token, `${repoApi(repository)}/git/trees/${sha}?recursive=1`);
        if (sub?.truncated) {
          throw new SyncGithubError(422, `The directory "${prefix}" is too large to compare completely.`);
        }
        return (sub?.tree ?? [])
          .filter((e) => e && e.type !== "tree")
          .map((e) => ({ ...e, path: `${prefix}/${e.path}` }));
      }),
    );
    for (const subBlobs of subResults) allBlobs.push(...subBlobs);
  }
  return allBlobs;
}
// A missing branch in a populated repository is not an empty repository.
export async function requireExistingOrEmptyBranch(
  token: string | null,
  repository: string,
  branch: string,
) {
  const head = await readGitHubHead(token, repository, branch);
  if (head) return head;
  const branches = await syncGithub<Array<{ name: string }>>(
    token,
    `${repoApi(repository)}/branches?per_page=1`,
  );
  if (branches.length)
    throw new Error(
      "This branch does not exist. Choose an existing branch before comparing changes.",
    );
  return null;
}
export async function readGitHubBlob(
  token: string | null,
  repository: string,
  sha: string,
) {
  if (!/^[a-f0-9]{40}$/.test(sha))
    throw new Error("Invalid GitHub blob identity");
  const blob = await syncGithub<{
    encoding: string;
    content: string;
    size: number;
  }>(token, `${repoApi(repository)}/git/blobs/${sha}`);
  if (blob.encoding !== "base64" || blob.size > 10 * 1024 * 1024)
    throw new Error("Unsupported or oversized GitHub content");
  const bytes = Buffer.from(blob.content, "base64");
  if (bytes.length !== blob.size)
    throw new Error("Incomplete GitHub file content");
  if (contentHashes(bytes).blobSha !== sha)
    throw new Error("GitHub file content failed its integrity check");
  return bytes;
}
