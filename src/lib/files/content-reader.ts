import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { githubSyncConnections, projectNodes, projects, storageAssets } from "@/lib/db/schema";
import type { ProjectAccess } from "@/lib/data/workspace-access";
import { assertFileNodeVisible } from "@/lib/files/internal-helpers";
import { resolveGithubRepoAccess } from "@/lib/github/auth-resolver";
import { logger } from "@/lib/logger";
import { readBoundedStorageText } from "@/lib/storage/bounded-object-read";
import { parseProjectFileKey } from "@/lib/storage/workspace-file-key";

const MAX_INLINE_BYTES = 2 * 1024 * 1024;
const MAX_GITHUB_BLOB_RESPONSE_BYTES = 3 * 1024 * 1024;

export class FileContentUnavailableError extends Error {
    readonly code = "FILE_CONTENT_UNAVAILABLE";

    constructor(message = "File content is unavailable. It has not been replaced with an empty file.") {
        super(message);
        this.name = "FileContentUnavailableError";
    }
}

/**
 * Reads a project file's text for a caller whose project access the caller
 * already resolved. Not a server action: only checked facades call it (COR-002).
 * Task-owned and /.system files still require Tasks visibility.
 */
export async function readProjectFileText(
    access: ProjectAccess & { project: NonNullable<ProjectAccess["project"]> },
    projectId: string,
    nodeId: string,
): Promise<string> {
    const node = await db.query.projectNodes.findFirst({
        where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
        columns: { s3Key: true, assetId: true, size: true, gitHash: true, path: true, taskId: true, deletedAt: true }
    });

    if (!node) {
        throw new Error("File not found");
    }
    await assertFileNodeVisible(access, node);

    const [asset] = node.s3Key && node.assetId
        ? await db.select({ size: storageAssets.verifiedSize })
            .from(storageAssets)
            .where(and(
                eq(storageAssets.id, node.assetId),
                eq(storageAssets.bucket, "project-files"),
                eq(storageAssets.storageKey, node.s3Key),
                eq(storageAssets.state, "verified"),
            ))
            .limit(1)
        : [];
    const nodeSize = asset?.size != null
        ? asset.size
        : typeof node.size === "number" && Number.isFinite(node.size) && node.size >= 0
            ? node.size
            : null;
    if (nodeSize !== null && nodeSize > MAX_INLINE_BYTES) {
        throw new Error("File too large for inline download. Use a signed URL instead.");
    }

    // --- VIRTUAL FS LAZY LOADING ---
    if (!node.s3Key && node.gitHash) {
        const recoveredText = await tryRecoverFromGitHub(projectId, node.gitHash);
        if (recoveredText !== null) return recoveredText;
    }

    if (!node.s3Key) {
        throw new Error("File content not available yet");
    }
    if (!asset) {
        const recoveredText = node.gitHash
            ? await tryRecoverFromGitHub(projectId, node.gitHash)
            : null;
        if (recoveredText !== null) return recoveredText;
        throw new FileContentUnavailableError();
    }
    const parsedKey = parseProjectFileKey(node.s3Key);
    if (!parsedKey || parsedKey.projectId !== projectId) {
        throw new Error("File key does not belong to this workspace");
    }

    try {
        return await readBoundedStorageText({
            bucket: "project-files",
            storageKey: node.s3Key,
            maxBytes: MAX_INLINE_BYTES,
        });
    } catch (downloadError) {
        if (downloadError instanceof Error && downloadError.message.includes("inline read limit")) {
            throw new Error("File too large for inline download. Use the preview route instead.");
        }
        logger.warn("files.content.storage_read_failed", {
            module: "files",
            projectId,
            nodeId,
            error: downloadError instanceof Error ? downloadError.message : String(downloadError),
        });

        const recoveredText = node.gitHash
            ? await tryRecoverFromGitHub(projectId, node.gitHash)
            : null;
        if (recoveredText !== null) {
            return recoveredText;
        }
        
        throw new FileContentUnavailableError();
    }
}

async function readBoundedJson(response: Response) {
    if (!response.body) return null;
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    try {
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            received += value.byteLength;
            if (received > MAX_GITHUB_BLOB_RESPONSE_BYTES) {
                await reader.cancel("Git blob response exceeds inline limit");
                return null;
            }
            chunks.push(value);
        }
    } finally {
        reader.releaseLock();
    }
    return JSON.parse(Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8")) as {
        content?: string;
        encoding?: string;
    };
}

/** Fallback for imported files whose bytes were never copied: the repository's blob, via the sealed credential resolver (COR-006). */
async function tryRecoverFromGitHub(projectId: string, gitBlobSha: string): Promise<string | null> {
    if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(gitBlobSha)) return null;
    try {
        const [project] = await db
            .select({ importSource: projects.importSource, installationId: githubSyncConnections.installationId })
            .from(projects)
            .leftJoin(githubSyncConnections, eq(githubSyncConnections.projectId, projects.id))
            .where(eq(projects.id, projectId))
            .limit(1);
        const importSource = project?.importSource as { type?: string; repoUrl?: string; metadata?: Record<string, unknown> } | null;
        if (importSource?.type !== "github" || !importSource.repoUrl) return null;
        const urlParts = importSource.repoUrl.replace(/\/$/, "").split("/");
        const repoName = urlParts.pop();
        const ownerName = urlParts.pop();
        if (!ownerName || !repoName) return null;
        const access = await resolveGithubRepoAccess({
            repoUrl: importSource.repoUrl,
            preferredInstallationId: project?.installationId ?? (importSource.metadata?.githubInstallationId as string | number | null | undefined) ?? null,
            sealedImportToken: importSource.metadata?.importAuth as string | undefined,
        });
        const headers: Record<string, string> = { Accept: "application/vnd.github.v3+json" };
        if (access.token) headers.Authorization = `Bearer ${access.token}`;

        const apiUrl = `https://api.github.com/repos/${encodeURIComponent(ownerName)}/${encodeURIComponent(repoName)}/git/blobs/${encodeURIComponent(gitBlobSha)}`;
        const res = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return null;
        const data = await readBoundedJson(res);
        if (!data?.content) return null;
        const content = Buffer.from(data.content, data.encoding === "base64" ? "base64" : "utf8");
        return content.byteLength > MAX_INLINE_BYTES ? null : content.toString("utf8");
    } catch (err) {
        logger.warn("files.content.git_recovery_failed", {
            module: "files",
            projectId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
    return null;
}
