import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { autoStage } from "@/lib/workflows/roadmap";

/**
 * Report 38.9 W5 and call 3 (plan A2.10): when a work task starts, its roadmap item (Part of) moves from Backlog or
 * Planned to In progress by itself, recorded as the person who started the work, with their own checks.
 */
export async function startParentItem(user: { id: string; user_metadata?: Record<string, unknown> | null }, workTaskId: string) {
  try {
    const [p] = Array.from(await db.execute<{ id: string; stage: string | null }>(sql`
      SELECT i.id, i.stage FROM tasks w JOIN tasks i ON i.id = w.part_of_id
      WHERE w.id = ${workTaskId}::uuid AND i.item_type = 'roadmap_item' AND i.deleted_at IS NULL`));
    const next = p ? autoStage(p.stage, "work_started") : null;
    if (!p || !next) return;
    const { afterTaskTransition, lockTaskForWrite, transitionTaskTx } = await import("@/lib/workspaces/task-transition-service");
    const { locked, result } = await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, p.id, user.id);
      if (autoStage(locked.stage, "work_started") !== next) return { locked, result: null };
      return { locked, result: await transitionTaskTx(tx, locked, { taskId: p.id, userId: user.id, stage: next, allowAnyMover: true }) };
    });
    if (result) await afterTaskTransition(user as never, locked, p.id, result);
  } catch (error) {
    logger.error("roadmap.auto_start_failed", { module: "tasks", workTaskId, error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Report 38.9 part 8 (A2.10): Launched tells the assignee (Normal) and the people who asked the requests that are
 * Part of it (Summary: "Shipped: …"); Won't do tells the assignee. Never the person who moved it.
 */
export async function onRoadmapTransition(taskId: string, fromStage: string | null, actorId: string) {
  try {
    const [t] = Array.from(await db.execute<{ title: string; stage: string | null; assignee_id: string | null; task_number: number | null; workspace_id: string; slug: string | null; key: string | null }>(sql`
      SELECT t.title, t.stage, t.assignee_id, t.task_number, t.workspace_id, w.slug, w.key FROM tasks t JOIN workspaces w ON w.id = t.workspace_id WHERE t.id = ${taskId}::uuid`));
    if (!t || t.stage === fromStage || (t.stage !== "launched" && t.stage !== "wont_do")) return;
    const { createNotification } = await import("@/lib/notifications/service");
    const { projectTaskHref } = await import("@/lib/workspaces/task-presentation");
    const base = (to: string, title: string, importance: "important" | "more") => createNotification({
      recipientUserId: to, actorUserId: actorId, kind: "project_task_activity", category: "tasks", importance, title,
      href: projectTaskHref(t.slug || t.workspace_id, taskId), entityRefs: { projectId: t.workspace_id, projectSlug: t.slug, taskId },
      preview: { contextLabel: t.task_number && t.key ? `${t.key}-${t.task_number}` : "Roadmap", contextKind: "task", secondaryText: "Roadmap" },
      dedupeKey: `roadmap-${t.stage}:${taskId}:${to}`,
    }).catch(() => undefined);
    if (t.assignee_id && t.assignee_id !== actorId) await base(t.assignee_id, `${t.stage === "launched" ? "Launched" : "Won’t do"}: ${t.title}`, "important");
    if (t.stage !== "launched") return;
    // Askers of the requests that are Part of it, who are still in the workspace.
    const askers = Array.from(await db.execute<{ id: string }>(sql`
      SELECT DISTINCT r.creator_id AS id FROM tasks r JOIN workspaces w ON w.id = r.workspace_id
      WHERE r.part_of_id = ${taskId}::uuid AND r.item_type = 'request' AND r.deleted_at IS NULL AND r.creator_id IS NOT NULL
        AND r.creator_id <> ${actorId}::uuid AND r.creator_id IS DISTINCT FROM ${t.assignee_id}::uuid
        AND (w.owner_id = r.creator_id OR EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = w.id AND m.user_id = r.creator_id))`));
    for (const a of askers) await base(a.id, `Shipped: ${t.title}`, "more");
  } catch (error) {
    logger.error("roadmap.notify_failed", { module: "tasks", taskId, error: error instanceof Error ? error.message : String(error) });
  }
}
