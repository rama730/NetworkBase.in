import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaceDocuments } from "@/lib/db/schema";

/**
 * Report 38.11 W6 (A4.9): approved board minutes refuse edits. File writes ask this with the file's node; it returns
 * the refusal to show, or null when the file can change. Server-only (not an action).
 */
export async function approvedMinutesRefusal(projectId: string, nodeId: string, executor: Pick<typeof db, "select"> = db) {
    const [row] = await executor.select({ approvedAt: sql<string | null>`${workspaceDocuments.settings}->>'approvedAt'` }).from(workspaceDocuments)
        .where(and(eq(workspaceDocuments.projectId, projectId), eq(workspaceDocuments.linkedNodeId, nodeId), sql`${workspaceDocuments.settings} ? 'approvedAt'`)).limit(1);
    if (!row?.approvedAt) return null;
    return `These minutes were approved on ${new Date(row.approvedAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })} and can’t be edited.`;
}

/** Throws the refusal inside a file write's transaction (applyFileRevision, activateFileVersion, deleting a version). */
export async function assertMinutesEditable(projectId: string, nodeId: string, executor: Pick<typeof db, "select"> = db) {
    const refusal = await approvedMinutesRefusal(projectId, nodeId, executor);
    if (refusal) throw new Error(refusal);
}
