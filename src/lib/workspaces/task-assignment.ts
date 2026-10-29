import { sql } from "drizzle-orm";
import type { db } from "@/lib/db";
import { taskActivityEvents } from "@/lib/db/schema";
import { queueEmail } from "@/lib/email/outbox";
import type { EnqueueWorkspaceNotificationEventInput } from "@/lib/notifications/workspace-events";

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];
type Snapshot = { fullName: string | null; avatarUrl: string | null };
type Assignment = {
  taskId: string; projectId: string; sprintId: string | null;
  title: string; taskNumber: number | null; status: string;
  actorId: string; actorName: string | null; actorAvatarUrl: string | null;
  previousAssigneeId: string | null; previousAssignee: Snapshot | null;
  assigneeId: string | null; assignee: Snapshot | null;
};

/** Call after the assignment write, inside its transaction, for a changed assignee. */
export async function recordTaskAssignment(tx: Executor, input: Assignment) {
  const [event] = await tx.insert(taskActivityEvents).values({
    taskId: input.taskId, projectId: input.projectId, sprintId: input.sprintId,
    actorId: input.actorId, eventType: "assigned",
    // Timestamp after the task lock, not transaction start: concurrent assignments stay ordered.
    createdAt: sql`clock_timestamp()`,
    payload: {
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
