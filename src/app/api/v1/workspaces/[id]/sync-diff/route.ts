import { NextRequest } from "next/server";
import {
    enforceRouteLimit,
    jsonError,
    jsonSuccess,
    requireAuthenticatedUser,
} from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { workspaceEventCounters, workspaceNodeEvents, workspaceNodes, workspaces, taskNodeLinks, tasks } from "@/lib/db/schema";
import { and, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { isLooseUuid } from "@/lib/validations/uuid";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const sinceSchema = z.coerce.number().int().min(0);
const limitSchema = z.coerce.number().int().min(1).max(500);
const DEFAULT_PAGE_SIZE = 200;

/**
 * GET /api/v1/workspaces/[id]/sync-diff
 * Returns events that have occurred in a project since a specific sequence version.
 * Query: ?since=123&limit=200
 * Returns one bounded page in sequence order. While `hasMore` is true, call again with
 * `since=lastDeliveredSequence`; `currentSequence` is the project's head, reported separately.
 */
export async function GET(
    request: NextRequest,
    context: { params: Promise<{ id: string }> }
) {
    const rlResponse = await enforceRouteLimit(
        request,
        "api:v1:projects:sync-diff:get",
        60,
        60
    );
    if (rlResponse) return rlResponse;

    const { user, response } = await requireAuthenticatedUser();
    if (response) return response;
    if (!user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");

    const { id: projectId } = await context.params;
    if (!isLooseUuid(projectId)) {
        return jsonError("Invalid workspace id", 400, "BAD_REQUEST");
    }

    const access = await getWorkspaceAccessById(projectId, user.id);
    if (!access.project) {
        return jsonError("Workspace not found", 404, "NOT_FOUND");
    }
    if (!access.canRead) {
        return jsonError("You don’t have access to this", 403, "FORBIDDEN");
    }

    const sinceStr = request.nextUrl.searchParams.get("since");
    if (!sinceStr) {
        return jsonError("Missing required since parameter", 400, "BAD_REQUEST");
    }

    const parsedSince = sinceSchema.safeParse(sinceStr);
    if (!parsedSince.success) {
        return jsonError("Invalid since parameter", 400, "BAD_REQUEST");
    }
    const since = parsedSince.data;
    const parsedLimit = limitSchema.safeParse(request.nextUrl.searchParams.get("limit") ?? DEFAULT_PAGE_SIZE);
    if (!parsedLimit.success) {
        return jsonError("Invalid limit parameter", 400, "BAD_REQUEST");
    }
    const limit = parsedLimit.data;

    const [projectSequence] = await db
        .select({
            currentSequence: sql<number>`coalesce(${workspaceEventCounters.nextSequence}, ${workspaces.currentSequenceNumber})`,
        })
        .from(workspaces)
        .leftJoin(workspaceEventCounters, eq(workspaceEventCounters.projectId, workspaces.id))
        .where(eq(workspaces.id, projectId))
        .limit(1);

    const rows = await db
        .select({
            id: workspaceNodeEvents.id,
            nodeId: workspaceNodeEvents.nodeId,
            actorId: workspaceNodeEvents.actorId,
            type: workspaceNodeEvents.type,
            sequenceNumber: workspaceNodeEvents.sequenceNumber,
            metadata: workspaceNodeEvents.metadata,
            createdAt: workspaceNodeEvents.createdAt,
            node: {
                id: workspaceNodes.id,
                parentId: workspaceNodes.parentId,
                name: workspaceNodes.name,
                type: workspaceNodes.type,
                path: workspaceNodes.path,
                size: workspaceNodes.size,
                mimeType: workspaceNodes.mimeType,
                currentVersion: workspaceNodes.currentVersion,
                syncStatus: workspaceNodes.syncStatus,
                updatedAt: workspaceNodes.updatedAt,
                deletedAt: workspaceNodes.deletedAt,
            },
        })
        .from(workspaceNodeEvents)
        .leftJoin(workspaceNodes, eq(workspaceNodeEvents.nodeId, workspaceNodes.id))
        .where(
            and(
                eq(workspaceNodeEvents.projectId, projectId),
                gt(workspaceNodeEvents.sequenceNumber, since)
            )
        )
        .orderBy(workspaceNodeEvents.sequenceNumber)
        .limit(limit + 1);

    const hasMore = rows.length > limit;
    if (hasMore) rows.length = limit;

    const nodeIds = Array.from(new Set(rows.map((row) => row.nodeId).filter((value): value is string => Boolean(value))));
    const linkedTaskRows = nodeIds.length
        ? await db
            .select({
                nodeId: taskNodeLinks.nodeId,
                taskId: taskNodeLinks.taskId,
                title: tasks.title,
                taskNumber: tasks.taskNumber,
            })
            .from(taskNodeLinks)
            .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
            .where(and(inArray(taskNodeLinks.nodeId, nodeIds), isNull(tasks.deletedAt)))
        : [];
    const linkedTasksByNodeId = new Map<string, Array<{ id: string; title: string | null; taskNumber: number | null }>>();
    for (const row of linkedTaskRows) {
        const list = linkedTasksByNodeId.get(row.nodeId) ?? [];
        list.push({ id: row.taskId, title: row.title, taskNumber: row.taskNumber });
        linkedTasksByNodeId.set(row.nodeId, list);
    }

    const events = rows.map((row) => ({
        id: row.id,
        nodeId: row.nodeId,
        actorId: row.actorId,
        type: row.type,
        sequenceNumber: row.sequenceNumber,
        metadata: row.metadata,
        createdAt: row.createdAt?.toISOString?.() ?? row.createdAt,
        node: row.node?.id ? {
            ...row.node,
            nodeId: row.node.id,
            linkedTasks: linkedTasksByNodeId.get(row.node.id) ?? [],
            updatedAt: row.node.updatedAt?.toISOString?.() ?? row.node.updatedAt,
            deletedAt: row.node.deletedAt?.toISOString?.() ?? row.node.deletedAt,
        } : null,
    }));

    return jsonSuccess({
        currentSequence: projectSequence?.currentSequence ?? since,
        lastDeliveredSequence: rows.at(-1)?.sequenceNumber ?? since,
        hasMore,
        events,
    });
}
