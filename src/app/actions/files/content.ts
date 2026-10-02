"use server";

import { db } from "@/lib/db";
import { projectNodes, storageAssets } from "@/lib/db/schema";
import { eq, and, } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { runInFlightDeduped } from "@/lib/utils/inflight-dedupe";
import { parseProjectFileKey } from "@/lib/storage/project-file-key";
import { logger } from "@/lib/logger";
import { readBoundedStorageText } from "@/lib/storage/bounded-object-read";
import {
    assertProjectFileReadAccess,
    assertProjectReadAccess,
    assertTaskFileNodeVisible,
} from "@/lib/files/internal-helpers";

const MAX_INLINE_BYTES = 2 * 1024 * 1024;
const MAX_GITHUB_BLOB_RESPONSE_BYTES = 3 * 1024 * 1024;

class FileContentUnavailableError extends Error {
    readonly code = "FILE_CONTENT_UNAVAILABLE";

    constructor(message = "File content is unavailable. It has not been replaced with an empty file.") {
        super(message);
        this.name = "FileContentUnavailableError";
    }
}

export async function getProjectFileContent(
    projectId: string,
    nodeId: string,
    options?: { skipFileTabCheck?: boolean },
) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    return await runInFlightDeduped(`files:content:${projectId}:${nodeId}:${!!options?.skipFileTabCheck}:${actorId ?? "anon"}`, async () => {
        // Verify read access (works for public projects too)
        // When called from the doc system for linked-node content, skip the
        // Files-tab visibility gate — the doc layer already verified doc-level
        // permissions so we only need basic project read access here.
        const access = options?.skipFileTabCheck
            ? await assertProjectReadAccess(projectId, actorId)
            : await assertProjectFileReadAccess(projectId, actorId);

        const node = await db.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
            columns: { s3Key: true, assetId: true, size: true, gitHash: true, path: true, taskId: true, deletedAt: true }
        });

        if (!node) {
            throw new Error("File not found");
        }
        assertTaskFileNodeVisible(access, node);

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
            throw new Error("File key does not belong to this project");
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
    });
}

export async function getProjectFileSignedUrl(projectId: string, nodeId: string, ttlSeconds: number = 300, download: boolean = false) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    const clampedTtl = Math.max(30, Math.min(3600, ttlSeconds));
    return await runInFlightDeduped(`files:signed-url:${projectId}:${nodeId}:${clampedTtl}:${download}:${actorId ?? "anon"}`, async () => {
        // Verify read access (works for public projects too)
        const access = await assertProjectFileReadAccess(projectId, actorId);

        const node = await db.query.projectNodes.findFirst({
            where: and(eq(projectNodes.id, nodeId), eq(projectNodes.projectId, projectId)),
            columns: { s3Key: true, path: true, taskId: true, deletedAt: true }
        });

        if (!node) {
            throw new Error("File not found");
        }

        const currentS3Key = node.s3Key;
        assertTaskFileNodeVisible(access, node);
        if (!currentS3Key) {
            throw new FileContentUnavailableError();
        }
        const parsedKey = parseProjectFileKey(currentS3Key);
        if (!parsedKey || parsedKey.projectId !== projectId) {
            throw new Error("File key does not belong to this project");
        }

        const now = Date.now();
        const query = download ? "?download=1" : "";
        return {
            url: `/api/v1/projects/${projectId}/files/${nodeId}/preview${query}`,
            expiresAt: now + Math.min(clampedTtl, 240) * 1000,
        };
    });
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

async function tryRecoverFromGitHub(projectId: string, gitBlobSha: string): Promise<string | null> {
    if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(gitBlobSha)) return null;
    try {
        const { projects } = await import("@/lib/db/schema");
        const project = await db.query.projects.findFirst({
            where: eq(projects.id, projectId),
            columns: { importSource: true }
        });
        const importSource = project?.importSource as any;
        if (importSource && importSource.type === "github" && importSource.repoUrl) {
            const urlParts = importSource.repoUrl.replace(/\/$/, '').split('/');
            const repoName = urlParts.pop();
            const ownerName = urlParts.pop();
            if (!ownerName || !repoName) return null;
            const apiUrl = `https://api.github.com/repos/${encodeURIComponent(ownerName)}/${encodeURIComponent(repoName)}/git/blobs/${encodeURIComponent(gitBlobSha)}`;

            const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
            const token = importSource.metadata?.importAuth || importSource.metadata?.githubToken;
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch(apiUrl, { headers, signal: AbortSignal.timeout(10_000) });
            if (res.ok) {
                const data = await readBoundedJson(res);
                if (data?.content) {
                    const content = data.encoding === 'base64'
                        ? Buffer.from(data.content, 'base64')
                        : Buffer.from(data.content, 'utf8');
                    if (content.byteLength > MAX_INLINE_BYTES) return null;
                    if (data.encoding === 'base64') {
                        return content.toString('utf8');
                    }
                    return content.toString('utf8');
                }
            }
        }
    } catch (err) {
        logger.warn("files.content.git_recovery_failed", {
            module: "files",
            projectId,
            error: err instanceof Error ? err.message : String(err),
        });
    }
    return null;
}
