"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { projectNodes } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { assertWorkspaceFileReadAccess, canReadWorkspaceTaskFiles, orgFileAccessSql } from "@/lib/files/internal-helpers";
import { getFileAttributionByNodeId } from "@/lib/files/file-attribution";
import type { WorkspaceNodeWithAttribution } from "./nodes";
import { taskFileAssociationsSql as associations, taskFileEntriesSql } from "@/lib/files/task-file-collection-query";
import { UUID_RE } from "./_constants";
import { getApprovedTaskFileVersion, isApprovedTaskFileRevision } from "@/lib/workspaces/task-file-intelligence";

export type TaskCollectionRole = "reference" | "working" | "deliverable";
export type TaskCollectionEntry = {
    node: WorkspaceNodeWithAttribution;
    role: TaskCollectionRole;
    annotation?: string | null;
    approvedVersion: number | null;
    isCurrentRevisionApproved: boolean;
};
export type TaskFileGroup = {
    id: string;
    title: string;
    status: string;
    reviewStatus: "none" | "pending" | "rejected";
    references: number;
    working: number;
    deliverables: number;
    updatedAt: string | null;
    entries: TaskCollectionEntry[];
    nextFileCursor: string | null;
};

async function authorize(projectId: string) {
    if (!UUID_RE.test(projectId)) throw new Error("Invalid workspace");
    const client = await createClient();
    const { data: { user } } = await client.auth.getUser();
    const access = await assertWorkspaceFileReadAccess(projectId, user?.id ?? null);
    if (!canReadWorkspaceTaskFiles(access)) throw new Error("Task files are not available to this viewer.");
    return access;
}

async function loadEntries(access: Awaited<ReturnType<typeof authorize>>, projectId: string, taskIds: string[], deliverables: boolean, after?: string, query = "", role?: TaskCollectionRole) {
    if (!taskIds.length) return new Map<string, { entries: TaskCollectionEntry[]; nextFileCursor: string | null }>();
    const rows = await db.execute<{ task_id: string; node_id: string; role: TaskCollectionRole; tags: string[]; annotation?: string | null; position: number }>(taskFileEntriesSql(projectId, taskIds, deliverables, after, query, role));
    const nodeIds = rows.map(r => r.node_id);
    if (!nodeIds.length) return new Map(taskIds.map(taskId => [taskId, { entries: [], nextFileCursor: null }]));
    const nodes = await db.query.projectNodes.findMany({
        // No cap here: the selection is already bounded per group (COR-011), and a cap dropped files.
        where: and(eq(projectNodes.projectId, projectId), isNull(projectNodes.deletedAt), inArray(projectNodes.id, nodeIds), orgFileAccessSql(access)),
    });
    const attribution = await getFileAttributionByNodeId(nodes);
    const byId = new Map(nodes.map(node => [node.id, { ...node, ...attribution.get(node.id) } as WorkspaceNodeWithAttribution]));
    return new Map(taskIds.map(taskId => {
        const matching = rows.filter(row => row.task_id === taskId);
        const page = matching.slice(0, 50);
        return [taskId, {
            entries: page.flatMap(row => {
                const node = byId.get(row.node_id);
                return node ? [{
                    node: {
                        ...node,
                        annotation: row.annotation ?? (node as { annotation?: string | null }).annotation ?? null,
                    },
                    role: row.role,
                    annotation: row.annotation ?? null,
                    approvedVersion: getApprovedTaskFileVersion(row.tags),
                    isCurrentRevisionApproved: isApprovedTaskFileRevision(row.tags, node.currentVersion, node.versionUpdatedAt),
                }] : [];
            }),
            nextFileCursor: matching.length > 50 ? page.at(-1)!.node_id : null,
        }];
    }));
}

export async function getTaskFileGroups(projectId: string, options: { deliverables?: boolean; cursor?: string; fileCursor?: string; query?: string; taskId?: string; role?: TaskCollectionRole } = {}) {
    const access = await authorize(projectId);
    // In an organization, members see only their own copies' groups and no Admins-only files (report §23.5).
    const orgRule = orgFileAccessSql(access, { projectId: sql`n.project_id`, path: sql`n.path`, taskId: sql`t.id` });
    // Groups are newest activity first; the cursor is "<updated_at ISO>~<task id>".
    const [cursorAt, cursorId] = options.cursor?.split("~") ?? [];
    if (options.cursor && (!cursorId || !UUID_RE.test(cursorId) || !/^[0-9][0-9:. +\-]{9,39}$/.test(cursorAt ?? ""))) throw new Error("Invalid task cursor");
    if (options.taskId && !UUID_RE.test(options.taskId)) throw new Error("Invalid task");
    if (options.fileCursor && (!options.taskId || !UUID_RE.test(options.fileCursor))) throw new Error("Invalid file cursor");
    const query = options.query?.trim().slice(0, 200) ?? "";
    const rows = await db.execute<{ id: string; title: string; status: string; review_status: "none" | "pending" | "rejected"; references: number; working: number; deliverables: number; updated_at: string | null; cursor_at: string }>(sql`
        ${associations(projectId)}
        SELECT t.id, t.title, t.status, t.review_status,
            count(*) FILTER (WHERE a.role = 'reference')::int AS "references",
            count(*) FILTER (WHERE a.role = 'working')::int AS working,
            count(*) FILTER (WHERE a.role = 'deliverable')::int AS deliverables,
            max(coalesce(fv.uploaded_at, n.updated_at)) AS updated_at,
            max(coalesce(fv.uploaded_at, n.updated_at))::text AS cursor_at
        FROM tasks t JOIN attachments a ON a.task_id = t.id
        JOIN project_nodes n ON n.id = a.node_id
        LEFT JOIN file_versions fv ON fv.node_id = n.id AND fv.version = n.current_version
        WHERE ${options.deliverables ? sql`a.role = 'deliverable'` : sql`a.role IN ('deliverable', 'working', 'reference')`}
            ${options.role ? sql`AND a.role = ${options.role}` : sql``}
            ${options.taskId ? sql`AND t.id = ${options.taskId}::uuid` : sql``}
            ${orgRule ? sql`AND ${orgRule}` : sql``}
            GROUP BY t.id, t.title, t.status, t.review_status
        HAVING true
        ${query && !options.taskId ? sql`AND bool_or(strpos(lower(t.title), lower(${query})) > 0 OR strpos(lower(n.name), lower(${query})) > 0 OR strpos(lower(coalesce(a.annotation, '')), lower(${query})) > 0)` : sql``}
        ${options.cursor ? sql`AND (max(coalesce(fv.uploaded_at, n.updated_at)), t.id) < (${cursorAt}::timestamptz, ${cursorId}::uuid)` : sql``}
        ORDER BY max(coalesce(fv.uploaded_at, n.updated_at)) DESC, t.id DESC LIMIT 21
    `);
    const page = rows.slice(0, 20);
    const files = await loadEntries(access, projectId, page.map(task => task.id), !!options.deliverables, options.fileCursor, options.taskId ? query : "", options.taskId ? options.role : undefined);
    return {
        groups: page.map(({ cursor_at: _cursorAt, ...task }) => ({
            ...task, reviewStatus: task.review_status, updatedAt: task.updated_at,
            ...files.get(task.id)!,
        })) as TaskFileGroup[],
        // Exact database text, not a JS Date: microseconds matter to the keyset.
        nextCursor: rows.length > 20 ? `${page.at(-1)!.cursor_at}~${page.at(-1)!.id}` : null,
    };
}

