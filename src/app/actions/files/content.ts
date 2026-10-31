"use server";

import { db } from "@/lib/db";
import { workspaceNodes } from "@/lib/db/schema";
import { eq, and, } from "drizzle-orm";
import { createClient } from "@/lib/supabase/server";
import { runInFlightDeduped } from "@/lib/utils/inflight-dedupe";
import { parseWorkspaceFileKey } from "@/lib/storage/workspace-file-key";
import {
    assertWorkspaceFileReadAccess,
    assertFileNodeVisible,
} from "@/lib/files/internal-helpers";
import { FileContentUnavailableError, readWorkspaceFileText } from "@/lib/files/content-reader";

/** Files-tab read: the caller must be allowed to see this project's Files (COR-002). */
export async function getWorkspaceFileContent(projectId: string, nodeId: string) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    return await runInFlightDeduped(`files:content:${projectId}:${nodeId}:${actorId ?? "anon"}`, async () => {
        const access = await assertWorkspaceFileReadAccess(projectId, actorId);
        return readWorkspaceFileText(access, projectId, nodeId);
    });
}

/**
 * The preview route URL for a file. It is an ordinary authorized endpoint (access is checked when it
 * is requested), so it carries no expiry; this action only confirms the caller may see the file now.
 */
export async function getFilePreviewUrl(projectId: string, nodeId: string, download: boolean = false) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    const actorId = user?.id ?? null;
    return await runInFlightDeduped(`files:preview-url:${projectId}:${nodeId}:${download}:${actorId ?? "anon"}`, async () => {
        // Verify read access (works for public projects too)
        const access = await assertWorkspaceFileReadAccess(projectId, actorId);

        const node = await db.query.workspaceNodes.findFirst({
            where: and(eq(workspaceNodes.id, nodeId), eq(workspaceNodes.projectId, projectId)),
            columns: { s3Key: true, path: true, taskId: true, deletedAt: true }
        });

        if (!node) {
            throw new Error("File not found");
        }

        const currentS3Key = node.s3Key;
        await assertFileNodeVisible(access, node);
        if (!currentS3Key) {
            throw new FileContentUnavailableError();
        }
        const parsedKey = parseWorkspaceFileKey(currentS3Key);
        if (!parsedKey || parsedKey.projectId !== projectId) {
            throw new Error("File key does not belong to this workspace");
        }

        const query = download ? "?download=1" : "";
        return { url: `/api/v1/workspaces/${projectId}/files/${nodeId}/preview${query}` };
    });
}
