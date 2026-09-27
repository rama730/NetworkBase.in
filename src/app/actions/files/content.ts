"use server";

import { db } from "@/lib/db";
import { projectNodes, } from "@/lib/db/schema";
import { eq, and, } from "drizzle-orm";
import { createClient, createAdminClient } from "@/lib/supabase/server";
import { runInFlightDeduped } from "@/lib/utils/inflight-dedupe";
import { parseProjectFileKey } from "@/lib/storage/project-file-key";
import {
    assertProjectFileReadAccess,
    assertProjectReadAccess,
    assertTaskFileNodeVisible,
} from "@/lib/files/internal-helpers";

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
            columns: { s3Key: true, size: true, gitHash: true, path: true, taskId: true, deletedAt: true }
        });

        if (!node) {
            throw new Error("File not found");
        }
        assertTaskFileNodeVisible(access, node);

        // --- VIRTUAL FS LAZY LOADING ---
        if (!node.s3Key && node.gitHash) {
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
                const apiUrl = `https://api.github.com/repos/${ownerName}/${repoName}/git/blobs/${node.gitHash}`;

                const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
                const token = importSource.metadata?.importAuth || importSource.metadata?.githubToken;
                if (token) headers['Authorization'] = `Bearer ${token}`;

                const res = await fetch(apiUrl, { headers });
                if (res.ok) {
                    const data = await res.json();
                    if (data.encoding === 'base64') {
                        return Buffer.from(data.content, 'base64').toString('utf8');
                    }
                    return data.content;
                }
            }
        }

        if (!node.s3Key) {
            throw new Error("File content not available yet");
        }
        const parsedKey = parseProjectFileKey(node.s3Key);
        if (!parsedKey || parsedKey.projectId !== projectId) {
            throw new Error("File key does not belong to this project");
        }

        const MAX_INLINE_BYTES = 2 * 1024 * 1024; // 2MB safety cap
        const nodeSize =
            typeof node.size === "number" && Number.isFinite(node.size) && node.size >= 0 ? node.size : null;
        const hasKnownSize = nodeSize !== null;
        if (nodeSize !== null && nodeSize > MAX_INLINE_BYTES) {
            throw new Error("File too large for inline download. Use a signed URL instead.");
        }

        let fileData: Blob;
        try {
            const adminClient = await createAdminClient();
            const { data, error } = await adminClient.storage.from("project-files").download(node.s3Key);
            if (error) throw error;
            if (!data) throw new Error("No data returned from storage");
            fileData = data;
        } catch (downloadError) {
            console.error(`[getProjectFileContent] S3 download failed for key ${node.s3Key}:`, downloadError);
            
            // Try to recover from GitHub contents by path
            const recoveredText = await tryRecoverFromGitHub(projectId, node.path);
            if (recoveredText !== null) {
                return recoveredText;
            }
            
            throw new FileContentUnavailableError();
        }

        const actualSize =
            fileData && typeof fileData.size === "number" && Number.isFinite(fileData.size) ? fileData.size : null;
        if ((actualSize !== null && actualSize > MAX_INLINE_BYTES) || (!hasKnownSize && actualSize === null)) {
            throw new Error("File too large for inline download. Use a signed URL instead.");
        }
        return await fileData.text();
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

        // Use admin client to bypass storage policy edge-cases (public viewers).
        const adminClient = await createAdminClient();
        const { data, error } = await adminClient.storage
            .from("project-files")
            .createSignedUrl(currentS3Key, clampedTtl, { download });

        if (error) throw error;
        if (!data?.signedUrl) throw new Error("Failed to create signed URL");

        const now = Date.now();
        return { url: data.signedUrl, expiresAt: now + clampedTtl * 1000 };
    });
}

async function tryRecoverFromGitHub(projectId: string, nodePath: string | null): Promise<string | null> {
    if (!nodePath) return null;
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
            const branch = importSource.branch || "main";
            const cleanPath = nodePath.startsWith("/") ? nodePath.slice(1) : nodePath;
            const apiUrl = `https://api.github.com/repos/${ownerName}/${repoName}/contents/${encodeURIComponent(cleanPath)}?ref=${branch}`;

            const headers: Record<string, string> = { 'Accept': 'application/vnd.github.v3+json' };
            const token = importSource.metadata?.importAuth || importSource.metadata?.githubToken;
            if (token) headers['Authorization'] = `Bearer ${token}`;

            const res = await fetch(apiUrl, { headers });
            if (res.ok) {
                const data = await res.json();
                if (data.content) {
                    if (data.encoding === 'base64') {
                        return Buffer.from(data.content, 'base64').toString('utf8');
                    }
                    return data.content;
                }
            }
        }
    } catch (err) {
        console.error(`[tryRecoverFromGitHub] Recovery failed for path ${nodePath}:`, err);
    }
    return null;
}
