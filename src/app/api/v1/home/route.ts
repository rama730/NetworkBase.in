import { getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { countMyOpenTasks } from "@/lib/domain/my-tasks";
import { countUnreadNotifications } from "@/lib/notifications/service";
import { listMyCopies } from "@/lib/organizations/my-assignments";
import { readTaskMeta } from "@/lib/domain/task-meta";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Tasks waiting for this person's review: review pending, in workspaces they own or are an admin of. */
async function reviewsWaiting(userId: string) {
  const rows = await db.execute<{ id: string; number: number | null; title: string; workspace_id: string; workspace_title: string; workspace_slug: string | null }>(sql`
    SELECT t.id, t.task_number AS number, t.title, w.id AS workspace_id, w.title AS workspace_title, w.slug AS workspace_slug
    FROM tasks t JOIN workspaces w ON w.id = t.workspace_id
    WHERE t.deleted_at IS NULL AND t.review_status = 'pending'
      AND (w.owner_id = ${userId} OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = ${userId} AND m.role = 'admin'))
    ORDER BY t.review_submitted_at NULLS LAST, t.task_number LIMIT 10`);
  return rows.map((r) => ({ id: r.id, number: r.number, title: r.title, workspaceId: r.workspace_id, workspaceTitle: r.workspace_title, workspaceSlug: r.workspace_slug }));
}

/**
 * The home screen for `nb` on its own and `nb next` (report C1, C2, C15), in one request: open tasks, unread inbox,
 * reviews waiting for you, and your assignments due in the next 7 days or late.
 * ponytail: hand-ins waiting for a teacher stay in nb review list; they join here with F1 (M7).
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const userId = auth.user.id;
    const weekAhead = Date.now() + 7 * 86_400_000;
    // The folder's current task (C15 "current task"), so a task deleted elsewhere stops being current there.
    const taskParam = new URL(request.url).searchParams.get("task");
    const currentTaskP = taskParam && /^[0-9a-f-]{36}$/i.test(taskParam)
      ? readTaskMeta(taskParam, userId).then(async () => {
          const [t] = await db.execute<{ id: string; number: number | null; title: string; status: string }>(sql`SELECT id, task_number AS number, title, status FROM tasks WHERE id = ${taskParam}::uuid`);
          return t ?? null;
        }, () => null)
      : Promise.resolve(undefined);
    const [tasks, unread, reviews, copies, currentTask] = await Promise.all([countMyOpenTasks(userId), countUnreadNotifications(userId), reviewsWaiting(userId), listMyCopies(userId), currentTaskP]);
    const assignments = copies
      .filter((c) => ["not_started", "in_progress", "returned", "missing"].includes(c.state) && (c.late || (c.due !== null && Date.parse(c.due) < weekAhead)))
      .slice(0, 10)
      .map((c) => ({ id: c.id, number: c.number, title: c.title, org: c.org, due: c.due, state: c.state, late: c.late }));
    return jsonSuccess({ tasks, unread: unread.total, reviews, assignments, ...(currentTask !== undefined ? { currentTask } : {}) }, undefined, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/home", fallback: "Couldn’t load your home screen" });
  }
}
