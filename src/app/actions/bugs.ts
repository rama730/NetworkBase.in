"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { assignTaskAction, setTaskStageAction } from "@/app/actions/task";
import { db } from "@/lib/db";
import { profiles, taskWatchers, tasks, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { assertAssignmentWrite } from "@/lib/organizations/assignments";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { bugFieldsSchema, mergeOnDuplicate, priorityForSeverity, resolveDuplicateTarget, type Severity } from "@/lib/workflows/bugs";
import { lockTaskForWrite } from "@/lib/workspaces/task-transition-service";

/**
 * Report 38.6 part 6 (plan A2.1): reading bugs, Similar open bugs, I see this too, Confirm, and the bug's fields.
 * Members and viewers report and say they see it too; members (not viewers) triage. Never public (B11).
 */
const id = z.string().uuid();
const fail = (error: unknown, fallback: string) => ({ success: false as const, error: error instanceof Error ? error.message : fallback });

async function insider(projectId: string) {
  const { user } = await requireAuthenticatedUser();
  if (!user) throw new Error("Sign in to continue");
  const access = await getWorkspaceAccessById(projectId, user.id);
  if (!access.project || access.project.kind !== "workspace" || !(access.isOwner || access.isMember)) throw new Error("Not found");
  return { user, access, canTriage: access.isOwner || (access.isMember && access.memberRole !== "viewer") };
}

export type BugRow = {
  id: string; taskNumber: number | null; title: string; stage: string | null; status: string; priority: string; sprintId: string | null;
  assigneeId: string | null; assigneeName: string | null; creatorId: string | null; creatorName: string | null; createdAt: string; updatedAt: string;
  typeFields: Record<string, unknown>;
  /** A2.3: the first pull request linked to the bug (task_links kind pull_request), for the card's chip. */
  pr: { url: string; title: string | null } | null;
};

/** Every bug in the workspace (up to 1,000; the strip and the views are worked out from them). */
export async function readBugsAction(projectId: string) {
  try {
    id.parse(projectId);
    const { canTriage, user } = await insider(projectId);
    const [ws] = await db.select({ key: workspaces.key }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
    const rows = Array.from(await db.execute<{ id: string; task_number: number | null; title: string; stage: string | null; status: string; priority: string; sprint_id: string | null;
      assignee_id: string | null; assignee_name: string | null; creator_id: string | null; creator_name: string | null; created_at: Date; updated_at: Date; type_fields: Record<string, unknown> | null; pr_url: string | null; pr_title: string | null }>(sql`
      SELECT t.id, t.task_number, t.title, t.stage, t.status, t.priority, t.sprint_id, t.assignee_id, a.full_name AS assignee_name,
        t.creator_id, c.full_name AS creator_name, t.created_at, t.updated_at, t.type_fields, pr.url AS pr_url, pr.title AS pr_title
      FROM tasks t LEFT JOIN profiles a ON a.id = t.assignee_id LEFT JOIN profiles c ON c.id = t.creator_id
      LEFT JOIN LATERAL (SELECT l.url, l.title FROM task_links l WHERE l.task_id = t.id AND l.kind = 'pull_request' ORDER BY l.created_at LIMIT 1) pr ON true
      WHERE t.workspace_id = ${projectId}::uuid AND t.item_type = 'bug' AND t.deleted_at IS NULL
      ORDER BY t.created_at DESC LIMIT 1000`));
    const bugs: BugRow[] = rows.map((r) => ({
      id: r.id, taskNumber: r.task_number, title: r.title, stage: r.stage, status: r.status, priority: r.priority, sprintId: r.sprint_id,
      assigneeId: r.assignee_id, assigneeName: r.assignee_name, creatorId: r.creator_id, creatorName: r.creator_name,
      createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(), typeFields: r.type_fields ?? {},
      pr: r.pr_url ? { url: r.pr_url, title: r.pr_title } : null,
    }));
    return { success: true as const, projectKey: ws?.key ?? null, bugs, canTriage, viewerId: user.id };
  } catch (error) {
    return fail(error, "Couldn’t load bugs");
  }
}

/** S6: up to 5 open bugs (New, Confirmed, Fixing) whose titles hold every word typed; never closed ones. */
export async function similarBugsAction(input: { projectId: string; title: string }) {
  try {
    const projectId = id.parse(input.projectId);
    // Live check: every word was too strict ("Payment fails" missed "Payment gateway is down"); any word of 3+
    // letters matches, more matching words first.
    const words = String(input.title ?? "").trim().split(/\s+/).filter((w) => w.length >= 3).slice(0, 6);
    if (String(input.title ?? "").trim().length < 4 || !words.length) return { success: true as const, bugs: [] };
    const { user } = await insider(projectId);
    const rows = Array.from(await db.execute<{ id: string; task_number: number | null; title: string; stage: string; seen: number; mine: boolean }>(sql`
      SELECT id, task_number, title, stage, jsonb_array_length(coalesce(type_fields->'alsoSeen', '[]'::jsonb))::int AS seen,
        (creator_id = ${user.id}::uuid OR coalesce(type_fields->'alsoSeen', '[]'::jsonb) ? ${user.id}) AS mine
      FROM tasks WHERE workspace_id = ${projectId}::uuid AND item_type = 'bug' AND deleted_at IS NULL AND stage IN ('new', 'confirmed', 'fixing')
        AND (${sql.join(words.map((w) => sql`title ILIKE ${"%" + w.replace(/[%_\\]/g, (c) => "\\" + c) + "%"}`), sql` OR `)})
      ORDER BY (${sql.join(words.map((w) => sql`(title ILIKE ${"%" + w.replace(/[%_\\]/g, (c) => "\\" + c) + "%"})::int`), sql` + `)}) DESC, updated_at DESC LIMIT 5`));
    return { success: true as const, bugs: rows.map((r) => ({ id: r.id, taskNumber: r.task_number, title: r.title, stage: r.stage, seen: r.seen, mine: r.mine })) };
  } catch (error) {
    return fail(error, "Couldn’t look for similar bugs");
  }
}

/** W3: "That's my bug" / I see this too: adds (or removes) the viewer and makes them a watcher. Idempotent. */
export async function seeTooAction(input: { projectId: string; taskId: string; on: boolean }) {
  try {
    const projectId = id.parse(input.projectId), taskId = id.parse(input.taskId);
    const { user } = await insider(projectId);
    const { allowed } = await consumeRateLimit(`task:${user.id}`, 60, 60);
    if (!allowed) throw new Error("Too many attempts. Try again in a minute.");
    const updated = await db.transaction(async (tx) => {
      const [bug] = await tx.update(tasks).set({
        typeFields: input.on
          ? sql`jsonb_set(coalesce(${tasks.typeFields}, '{}'::jsonb), '{alsoSeen}', CASE WHEN coalesce(${tasks.typeFields}->'alsoSeen', '[]'::jsonb) ? ${user.id} OR jsonb_array_length(coalesce(${tasks.typeFields}->'alsoSeen', '[]'::jsonb)) >= 500
              THEN coalesce(${tasks.typeFields}->'alsoSeen', '[]'::jsonb) ELSE coalesce(${tasks.typeFields}->'alsoSeen', '[]'::jsonb) || to_jsonb(${user.id}::text) END)`
          : sql`jsonb_set(coalesce(${tasks.typeFields}, '{}'::jsonb), '{alsoSeen}', coalesce(${tasks.typeFields}->'alsoSeen', '[]'::jsonb) - ${user.id})`,
      }).where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), eq(tasks.itemType, "bug"), isNull(tasks.deletedAt))).returning({ id: tasks.id, taskNumber: tasks.taskNumber });
      if (!bug) throw new Error("Not found");
      if (input.on) await tx.insert(taskWatchers).values({ taskId, userId: user.id }).onConflictDoNothing();
      return bug;
    });
    return { success: true as const, taskNumber: updated.taskNumber };
  } catch (error) {
    return fail(error, "Couldn’t change that");
  }
}

const fieldsInput = z.object({ projectId: id, taskId: id, fields: bugFieldsSchema });

/** S5: the bug's own fields from the panel; a severity change writes priority (call 3). Task edit rights. */
export async function setBugFieldsAction(input: z.infer<typeof fieldsInput>) {
  try {
    const { projectId, taskId, fields } = fieldsInput.parse(input);
    const { user, canTriage } = await insider(projectId);
    if (!canTriage) throw new Error("Viewers can’t change bugs");
    await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId || locked.itemType !== "bug") throw new Error("Not found");
      await assertAssignmentWrite(tx, taskId, { role: locked.orgRole, isHolder: locked.isHolder, onOrgBoard: locked.onOrgBoard }, "priority");
      const priority = "severity" in fields ? priorityForSeverity(fields.severity as Severity | null) : null;
      await tx.update(tasks).set({
        typeFields: sql`coalesce(${tasks.typeFields}, '{}'::jsonb) || ${JSON.stringify(fields)}::jsonb`,
        ...(priority ? { priority: priority as never } : {}),
        updatedAt: new Date(),
      }).where(eq(tasks.id, taskId));
    });
    return { success: true as const };
  } catch (error) {
    return fail(error, "Couldn’t change the bug");
  }
}

const confirmInput = z.object({ projectId: id, taskId: id, severity: z.enum(["urgent", "major", "minor"]), assigneeId: id.nullable().optional() });

/** W4: Confirm a New bug: severity (required here, call 4) sets priority; Assigned to is optional. Members only. */
export async function confirmBugAction(input: z.infer<typeof confirmInput>) {
  try {
    const parsed = confirmInput.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Pick a severity to confirm" };
    const { projectId, taskId, severity, assigneeId } = parsed.data;
    const { user, canTriage } = await insider(projectId);
    if (!canTriage) throw new Error("Viewers can’t triage bugs");
    const [bug] = await db.select({ stage: tasks.stage, title: tasks.title, taskNumber: tasks.taskNumber }).from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), eq(tasks.itemType, "bug"), isNull(tasks.deletedAt))).limit(1);
    if (!bug) throw new Error("Not found");
    if (bug.stage !== "new") throw new Error("Only a New bug is confirmed");
    const fields = await setBugFieldsAction({ projectId, taskId, fields: { severity } });
    if (!fields.success) return fields;
    const moved = await setTaskStageAction({ taskId, projectId, stage: "confirmed", toBacklog: true });
    if (!moved.success) return moved;
    if (assigneeId !== undefined && assigneeId !== null) {
      const assigned = await assignTaskAction(taskId, assigneeId, projectId);
      if (!assigned.success) return { success: false as const, error: assigned.error ?? "Couldn’t assign it" };
    }
    if (severity === "urgent") {
      const { notifyUrgentConfirmed } = await import("@/lib/workflows/bug-notify");
      await notifyUrgentConfirmed({ id: taskId, title: bug.title, taskNumber: bug.taskNumber, workspaceId: projectId }, user.id);
    }
    return { success: true as const };
  } catch (error) {
    return fail(error, "Couldn’t confirm the bug");
  }
}

/** S5: one bug's own fields for the panel, with whether the viewer sees it too and their right to change it. */
export async function readBugAction(projectId: string, taskId: string) {
  try {
    id.parse(projectId); id.parse(taskId);
    const { user, canTriage } = await insider(projectId);
    const [row] = await db.select({ typeFields: tasks.typeFields, creatorId: tasks.creatorId, stage: tasks.stage, title: tasks.title }).from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), eq(tasks.itemType, "bug"), isNull(tasks.deletedAt))).limit(1);
    if (!row) throw new Error("Not found");
    const fields = (row.typeFields ?? {}) as Record<string, unknown>;
    const alsoSeen = Array.isArray(fields.alsoSeen) ? (fields.alsoSeen as string[]) : [];
    // A2.2: a duplicate names its original (in this workspace only).
    const [original] = typeof fields.duplicateOf === "string" ? await db.select({ id: tasks.id, taskNumber: tasks.taskNumber, title: tasks.title, key: workspaces.key }).from(tasks)
      .innerJoin(workspaces, eq(workspaces.id, tasks.projectId))
      .where(and(eq(tasks.id, fields.duplicateOf), eq(tasks.projectId, projectId), isNull(tasks.deletedAt))).limit(1) : [];
    return { success: true as const, fields, stage: row.stage, title: row.title, duplicateOf: original ? { id: original.id, label: original.key && original.taskNumber ? `${original.key}-${original.taskNumber}` : original.title, title: original.title } : null,
      seeing: alsoSeen.includes(user.id), seenCount: alsoSeen.length, reporter: row.creatorId === user.id, canEdit: canTriage };
  } catch (error) {
    return fail(error, "Couldn’t load the bug");
  }
}

const CLOSE = ["wont_fix", "duplicate", "cant_reproduce"] as const;

/** A comment from the person acting, through the task comment rules (access, mentions and their notices). */
async function comment(userId: string, taskId: string, projectId: string, content: string) {
  const { createTaskCommentAs } = await import("@/lib/domain/task-comments");
  const [profile] = await db.select({ fullName: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl }).from(profiles).where(eq(profiles.id, userId)).limit(1);
  return createTaskCommentAs({ userId, profile: profile ?? null }, taskId, projectId, content);
}
const closeInput = z.object({
  projectId: id, taskId: id, reason: z.enum(CLOSE),
  duplicateOfId: id.optional(), message: z.string().trim().max(2000).optional(),
});

/**
 * Report 38.6 W5–W6 and S7 (plan A2.2): Close… with a reason. Duplicate points at the open original (the chain is
 * walked, loops refused) and moves the reporter and I see this too there; Can't reproduce needs a message, posted as
 * a comment that mentions the reporter (call 6: nothing closes or reopens on its own). Members only.
 */
export async function closeBugAction(input: z.infer<typeof closeInput>) {
  try {
    const parsed = closeInput.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Pick a reason" };
    const { projectId, taskId, reason, duplicateOfId, message } = parsed.data;
    if (reason === "duplicate" && !duplicateOfId) return { success: false as const, error: "Pick the bug it duplicates" };
    if (reason === "cant_reproduce" && !message) return { success: false as const, error: "Tell the reporter what you need" };
    const { user, canTriage } = await insider(projectId);
    if (!canTriage) throw new Error("Viewers can’t close bugs");
    const all = await db.select({ id: tasks.id, stage: tasks.stage, typeFields: tasks.typeFields, creatorId: tasks.creatorId, taskNumber: tasks.taskNumber, title: tasks.title })
      .from(tasks).where(and(eq(tasks.projectId, projectId), eq(tasks.itemType, "bug"), isNull(tasks.deletedAt)));
    const bug = all.find((b) => b.id === taskId);
    if (!bug) throw new Error("Not found");
    let target: (typeof all)[number] | null = null;
    if (reason === "duplicate") {
      const chain = new Map(all.map((b) => [b.id, { stage: b.stage, duplicateOf: ((b.typeFields ?? {}) as { duplicateOf?: string }).duplicateOf ?? null }]));
      const resolved = resolveDuplicateTarget(taskId, duplicateOfId!, chain);
      if ("error" in resolved) return { success: false as const, error: resolved.error };
      target = all.find((b) => b.id === resolved.id)!;
    }
    // Can't reproduce posts its message first: if that fails, nothing is closed.
    if (reason === "cant_reproduce") {
      const [reporter] = bug.creatorId ? await db.select({ name: profiles.fullName, username: profiles.username }).from(profiles).where(eq(profiles.id, bug.creatorId)).limit(1) : [];
      const mention = !bug.creatorId || bug.creatorId === user.id ? "" : `@{${bug.creatorId}|${reporter?.name ?? reporter?.username ?? "Reporter"}} `;
      const posted = await comment(user.id, taskId, projectId, `${mention}Details needed: ${message}`);
      if (!posted.success) return { success: false as const, error: posted.error ?? "Couldn’t add the comment" };
    }
    // The reason goes on first: the stage move only accepts a closing stage it can find there.
    await db.transaction(async (tx) => {
      const locked = await lockTaskForWrite(tx, taskId, user.id);
      if (locked.projectId !== projectId) throw new Error("Not found");
      await assertAssignmentWrite(tx, taskId, { role: locked.orgRole, isHolder: locked.isHolder, onOrgBoard: locked.onOrgBoard }, "status");
      await tx.update(tasks).set({ typeFields: sql`coalesce(${tasks.typeFields}, '{}'::jsonb) || ${JSON.stringify({ closeReason: reason, duplicateOf: target?.id ?? null })}::jsonb` }).where(eq(tasks.id, taskId));
    });
    const moved = await setTaskStageAction({ taskId, projectId, stage: reason, toBacklog: true });
    if (!moved.success) {
      await db.update(tasks).set({ typeFields: sql`${tasks.typeFields} - 'closeReason'` }).where(eq(tasks.id, taskId));
      return moved;
    }
    const { notifyBugClosed } = await import("@/lib/workflows/bug-notify");
    if (target) {
      const seenOf = (b: (typeof all)[number]) => (Array.isArray((b.typeFields as { alsoSeen?: unknown })?.alsoSeen) ? ((b.typeFields as { alsoSeen: string[] }).alsoSeen) : []);
      const merged = mergeOnDuplicate({ creatorId: bug.creatorId, alsoSeen: seenOf(bug) }, { creatorId: target.creatorId, alsoSeen: seenOf(target) });
      await db.transaction(async (tx) => {
        await tx.update(tasks).set({ typeFields: sql`jsonb_set(coalesce(${tasks.typeFields}, '{}'::jsonb), '{alsoSeen}', ${JSON.stringify(merged)}::jsonb)`, updatedAt: new Date() }).where(eq(tasks.id, target!.id));
        await tx.execute(sql`INSERT INTO task_watchers (task_id, user_id)
          SELECT ${target!.id}::uuid, u FROM (SELECT user_id AS u FROM task_watchers WHERE task_id = ${taskId}::uuid
            UNION SELECT unnest(${`{${merged.join(",")}}`}::uuid[])) people ON CONFLICT DO NOTHING`);
      });
      const [ws] = await db.select({ key: workspaces.key }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
      await notifyBugClosed(taskId, user.id, `Closed as a duplicate of ${ws?.key && target.taskNumber ? `${ws.key}-${target.taskNumber}` : target.title}`);
    } else if (reason === "wont_fix") {
      await notifyBugClosed(taskId, user.id, "Closed as Won’t fix");
    }
    return { success: true as const, duplicateOf: target ? { id: target.id, taskNumber: target.taskNumber, title: target.title } : null };
  } catch (error) {
    return fail(error, "Couldn’t close the bug");
  }
}

const reopenInput = z.object({ projectId: id, taskId: id, comment: z.string().trim().min(1).max(2000), details: z.boolean().optional() });

/**
 * W8.4 and W6.2 (call 7): Reopen a Fixed, Verified or closed bug to Confirmed with a comment (members); a reporter
 * adding details to a Can't reproduce bug sends it back to New.
 */
export async function reopenBugAction(input: z.infer<typeof reopenInput>) {
  try {
    const parsed = reopenInput.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Say why it’s open again" };
    const { projectId, taskId, comment: commentText, details } = parsed.data;
    const { user, canTriage } = await insider(projectId);
    const [bug] = await db.select({ stage: tasks.stage, creatorId: tasks.creatorId }).from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), eq(tasks.itemType, "bug"), isNull(tasks.deletedAt))).limit(1);
    if (!bug) throw new Error("Not found");
    if (!["fixed", "verified", ...CLOSE].includes(bug.stage ?? "")) throw new Error("This bug is open already");
    const withDetails = Boolean(details) && bug.stage === "cant_reproduce" && bug.creatorId === user.id;
    if (!withDetails && !canTriage) throw new Error("Viewers can’t reopen bugs");
    const posted = await comment(user.id, taskId, projectId, commentText);
    if (!posted.success) return { success: false as const, error: posted.error ?? "Couldn’t add the comment" };
    await db.update(tasks).set({ typeFields: sql`coalesce(${tasks.typeFields}, '{}'::jsonb) - 'closeReason' - 'duplicateOf'` }).where(eq(tasks.id, taskId));
    const moved = await setTaskStageAction({ taskId, projectId, stage: withDetails ? "new" : "confirmed", toBacklog: true });
    return moved.success ? { success: true as const, stage: withDetails ? "new" : "confirmed" } : moved;
  } catch (error) {
    return fail(error, "Couldn’t reopen the bug");
  }
}
