"use server";

import { db } from "@/lib/db";
import { projectNodes } from "@/lib/db/schema";
import { eq, and, } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { runInFlightDeduped } from "@/lib/utils/inflight-dedupe";
import { parseProjectFileKey } from "@/lib/storage/project-file-key";
import {
    assertProjectFileReadAccess,
    assertTaskFileNodeVisible,
} from "@/lib/files/internal-helpers";
import { FileContentUnavailableError, readProjectFileText } from "@/lib/files/content-reader";

/** Files-tab read: the caller must be allowed to see this project's Files (COR-002). */
export async function getProjectFileContent(projectId: string, nodeId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    return await runInFlightDeduped(`files:content:${projectId}:${nodeId}:${actorId ?? "anon"}`, async () => {
        const access = await assertProjectFileReadAccess(projectId, actorId);
        return readProjectFileText(access, projectId, nodeId);
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
