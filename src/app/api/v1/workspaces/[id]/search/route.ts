import { and, asc, desc, eq, ilike, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { listWorkspaceDocsAction } from "@/app/actions/workspace/doc";
import { db } from "@/lib/db";
import { profiles, taskComments, tasks, workspaceMembers } from "@/lib/db/schema";
import { canReadWorkspaceTab, getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { orgTaskReadFilter } from "@/lib/organizations/assignments";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = ["tasks", "comments", "docs", "people"] as const;
const querySchema = z.object({ q: z.string().trim().min(2).max(120), in: z.string().max(60).optional() });

/**
 * `nb search` beyond files (report C2, C15): tasks, comments, docs and people in one workspace, 10 of each, with the
 * same read rules as the Tasks tab (an organization's copies stay their owners'). Files keep their own search.
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const { id } = await context.params;
    const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!z.string().uuid().safeParse(id).success || !parsed.success) return jsonError("Search for at least 2 characters", 400, "BAD_REQUEST");
    const userId = auth.user.id;
    const access = await getWorkspaceAccessById(id, userId);
    // People inside the workspace only, like the members list: visitors of a public workspace browse it on the web.
    if (!access.project || (!access.isOwner && !access.isMember)) return jsonError("You don’t have access to this", 403, "FORBIDDEN");
    const want = new Set((parsed.data.in ?? KINDS.join(",")).split(",").map((k) => k.trim()).filter((k) => (KINDS as readonly string[]).includes(k)));
    const like = `%${parsed.data.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    const canTasks = canReadWorkspaceTab(access, "tasks");
    const visibleTask = and(eq(tasks.projectId, id), isNull(tasks.deletedAt), orgTaskReadFilter(access, userId));

    const [taskRows, commentRows, docs, people] = await Promise.all([
      want.has("tasks") && canTasks
        ? db.select({ id: tasks.id, number: tasks.taskNumber, title: tasks.title, status: tasks.status }).from(tasks)
            .where(and(visibleTask, or(ilike(tasks.title, like), ilike(tasks.description, like)))).orderBy(desc(tasks.updatedAt)).limit(10)
        : [],
      want.has("comments") && canTasks
        ? db.select({ id: taskComments.id, taskId: tasks.id, number: tasks.taskNumber, taskTitle: tasks.title, text: taskComments.content, by: profiles.username, at: taskComments.createdAt })
            .from(taskComments).innerJoin(tasks, eq(tasks.id, taskComments.taskId)).leftJoin(profiles, eq(profiles.id, taskComments.userId))
            .where(and(visibleTask, isNull(taskComments.deletedAt), ilike(taskComments.content, like))).orderBy(desc(taskComments.createdAt)).limit(10)
        : [],
      want.has("docs") ? listWorkspaceDocsAction(id).then((r) => (r.success ? r.docs : []), () => []) : [],
      want.has("people")
        ? db.select({ id: profiles.id, username: profiles.username, name: profiles.fullName, role: workspaceMembers.role }).from(workspaceMembers)
            .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
            .where(and(eq(workspaceMembers.projectId, id), or(ilike(profiles.username, like), ilike(profiles.fullName, like)))).orderBy(asc(profiles.username)).limit(10)
        : [],
    ]);
    const q = parsed.data.q.toLowerCase();
    return jsonSuccess({
      tasks: taskRows,
      comments: commentRows.map((c) => ({ ...c, text: c.text.length > 200 ? `${c.text.slice(0, 200)}…` : c.text })),
      docs: (docs as Array<{ slug: string; title?: string; filename?: string | null; nodePath?: string | null }>).filter((d) => [d.slug, d.title, d.filename].some((v) => String(v ?? "").toLowerCase().includes(q))).slice(0, 10).map((d) => ({ slug: d.slug, title: d.title ?? d.slug, path: d.nodePath ?? null })),
      people,
    }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/workspaces/search", fallback: "Couldn’t search" });
  }
}
