import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { taskActivityEvents } from "@/lib/db/schema";
import { queueEmail } from "@/lib/email/outbox";
import type { EnqueueWorkspaceNotificationEventInput } from "@/lib/notifications/workspace-events";
import { viaPayload } from "@/lib/server/request-via";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type Snapshot = { fullName: string | null; avatarUrl: string | null };
type Assignment = {
  taskId: string; projectId: string; sprintId: string | null;
  title: string; taskNumber: number | null; status: string;
  actorId: string; actorName: string | null; actorAvatarUrl: string | null;
  previousAssigneeId: string | null; previousAssignee: Snapshot | null;
  assigneeId: string | null; assignee: Snapshot | null;
};

/** Peer-to-peer assignment across a block is refused; owners and admins still assign, delivered from the place (Blocking B46, D7). */
export async function refusePeerAssignmentAcrossBlock(executor: Executor, projectId: string, actorId: string, assigneeId: string | null) {
  if (!assigneeId || assigneeId === actorId) return;
  const [row] = await executor.execute(sql`
    SELECT app_private.blocked_between(${actorId}::uuid, ${assigneeId}::uuid)
       AND NOT EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ${projectId}::uuid AND w.owner_id = ${actorId}::uuid)
       AND NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = ${projectId}::uuid AND m.user_id = ${actorId}::uuid AND m.role IN ('owner', 'admin')) AS refused
  `) as unknown as Array<{ refused: boolean }>;
  if (row?.refused) throw new Error("You can’t assign this task to them.");
}

/** Call after the assignment write, inside its transaction, for a changed assignee. */
export async function recordTaskAssignment(tx: Executor, input: Assignment) {
  const [event] = await tx.insert(taskActivityEvents).values({
    taskId: input.taskId, projectId: input.projectId, sprintId: input.sprintId,
    actorId: input.actorId, eventType: "assigned",
    // Timestamp after the task lock, not transaction start: concurrent assignments stay ordered.
    createdAt: sql`clock_timestamp()`,
    payload: { ...(await viaPayload()),
      version: 2, taskTitle: input.title, taskNumber: input.taskNumber,
      taskStatus: input.status, sprintId: input.sprintId,
      actorName: input.actorName, actorAvatarUrl: input.actorAvatarUrl,
      previousAssigneeId: input.previousAssigneeId,
      previousAssigneeName: input.previousAssignee?.fullName ?? null,
      previousAssigneeAvatarUrl: input.previousAssignee?.avatarUrl ?? null,
      assigneeId: input.assigneeId, assigneeName: input.assignee?.fullName ?? null,
      assigneeAvatarUrl: input.assignee?.avatarUrl ?? null,
    },
  }).returning({ id: taskActivityEvents.id });
  if (!event) throw new Error("Assignment activity was not saved");
  if (input.assigneeId && input.assigneeId !== input.actorId) {
    await queueEmail(tx, {
      kind: "task_assignment", eventId: event.id, userId: input.assigneeId,
      actorId: input.actorId, taskId: input.taskId, projectId: input.projectId,
    });
  }
  return event.id;
}

export function taskAssignmentNotification(input: {
  taskId: string; projectId: string; projectSlug: string | null;
  projectKey: string | null; taskNumber: number | null; title: string;
  actorId: string; actorName: string | null; actorAvatarUrl: string | null;
  assigneeId: string; eventId: string;
}): EnqueueWorkspaceNotificationEventInput {
  return {
    projectId: input.projectId, actorUserId: input.actorId,
    actorName: input.actorName, actorAvatarUrl: input.actorAvatarUrl,
    eventKey: "tasks.assigned", assigneeId: input.assigneeId,
    title: `${input.actorName || "Someone"} assigned you a task`, body: input.title,
    href: `/workspaces/${encodeURIComponent(input.projectSlug || input.projectId)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(input.taskId)}`,
    entityRefs: { projectId: input.projectId, projectSlug: input.projectSlug, taskId: input.taskId },
    preview: {
      actorName: input.actorName, actorAvatarUrl: input.actorAvatarUrl,
      contextLabel: input.projectKey && input.taskNumber ? `${input.projectKey}-${input.taskNumber}` : "Task",
      contextKind: "task", secondaryText: input.title,
    },
    sourceEventId: input.eventId,
  };
}
