"use server";

import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { assignTaskAction, setTaskStageAction, updateTaskFieldAction } from "@/app/actions/task";
import { createTaskAction } from "@/app/actions/workspace";
import { db } from "@/lib/db";
import { taskSubtasks, tasks, workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { checklistFor, contentSettingsSchema, starterSettings, type Setup } from "@/lib/workflows/content";
import { readContentSettings, writeContentSettings } from "@/lib/workflows/content-store";
import { readWorkingHours } from "@/lib/workflows/request-clock-server";
import { zonedInstant } from "@/lib/workflows/request-clock";
import { canChangeWorkflows } from "@/lib/workflows/rules";

/**
 * Report 38.8 parts 5–6 (plan A2.7): Content's read, settings, ideas, and planning a piece onto a day. Members create,
 * write and plan; owners and admins set channels and types (call 6). Never public (B11).
 */
const id = z.string().uuid();
const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const fail = (error: unknown, fallback: string) => ({ success: false as const, error: error instanceof Error ? error.message : fallback });

async function insider(projectId: string) {
  const { user } = await requireAuthenticatedUser();
  if (!user) throw new Error("Sign in to continue");
  const access = await getWorkspaceAccessById(projectId, user.id);
  if (!access.project || access.project.kind !== "workspace" || !(access.isOwner || access.isMember)) throw new Error("Not found");
  return { user, canEdit: access.isOwner || (access.isMember && access.memberRole !== "viewer"), canManage: canChangeWorkflows(access) };
}

export type ContentRow = {
  id: string; taskNumber: number | null; title: string; stage: string | null; status: string; sprintId: string | null; dueDate: string | null;
  assigneeId: string | null; assigneeName: string | null; createdAt: string; typeFields: Record<string, unknown>;
};

/** The tab's read: settings, the time zone, and every live piece (ideas, planned, and the last 60 days published). */
export async function readContentAction(projectId: string) {
  try {
    id.parse(projectId);
    const { user, canEdit, canManage } = await insider(projectId);
    const [ws] = await db.select({ key: workspaces.key }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
    const rows = Array.from(await db.execute<{ id: string; task_number: number | null; title: string; stage: string | null; status: string; sprint_id: string | null; due_date: string | null;
      assignee_id: string | null; assignee_name: string | null; created_at: Date; type_fields: Record<string, unknown> | null }>(sql`
      SELECT t.id, t.task_number, t.title, t.stage, t.status, t.sprint_id, t.due_date::text AS due_date, t.assignee_id, a.full_name AS assignee_name, t.created_at, t.type_fields
      FROM tasks t LEFT JOIN profiles a ON a.id = t.assignee_id
      WHERE t.workspace_id = ${projectId}::uuid AND t.item_type = 'content' AND t.deleted_at IS NULL
        AND (t.stage <> 'published' OR t.updated_at > now() - interval '60 days')
      ORDER BY t.created_at DESC LIMIT 1000`));
    const items: ContentRow[] = rows.map((r) => ({
      id: r.id, taskNumber: r.task_number, title: r.title, stage: r.stage, status: r.status, sprintId: r.sprint_id, dueDate: r.due_date ? r.due_date.slice(0, 10) : null,
      assigneeId: r.assignee_id, assigneeName: r.assignee_name, createdAt: new Date(r.created_at).toISOString(), typeFields: r.type_fields ?? {},
    }));
    const { tz } = await readWorkingHours(projectId);
    // A2.8: who can edit pieces (Ready for edit's list): the owner and members who aren't viewers.
    const people = Array.from(await db.execute<{ id: string; name: string }>(sql`
      SELECT p.id, coalesce(p.full_name, p.username, 'Someone') AS name FROM profiles p
      WHERE p.id IN (SELECT owner_id FROM workspaces WHERE id = ${projectId}::uuid UNION SELECT user_id FROM workspace_members WHERE workspace_id = ${projectId}::uuid AND role <> 'viewer')
      ORDER BY p.full_name`));
    return { success: true as const, projectKey: ws?.key ?? null, settings: await readContentSettings(projectId), timeZone: tz, items, people, canEdit, canManage, viewerId: user.id };
  } catch (error) {
    return fail(error, "Couldn’t load content");
  }
}

const settingsInput = z.object({ projectId: id, settings: contentSettingsSchema });

/** W1 and S10: the first setup (Blog, Social, channels) and later changes; archiving a channel keeps its pieces. */
export async function saveContentSettingsAction(input: z.infer<typeof settingsInput>) {
  try {
    const parsed = settingsInput.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Check the channels, types and default time" };
    const { projectId, settings } = parsed.data;
    const { canManage } = await insider(projectId);
    if (!canManage) throw new Error("Only owners and admins set channels and types");
    const ids = (list: Array<{ id: string }>) => new Set(list.map((x) => x.id)).size === list.length;
    if (!ids(settings.channels) || !ids(settings.types)) throw new Error("Each channel and type needs its own name");
    if (!settings.channels.some((c) => !c.archived)) throw new Error("Keep at least one channel");
    await writeContentSettings(projectId, settings);
    return { success: true as const };
  } catch (error) {
    return fail(error, "Couldn’t save the channels");
  }
}

/** The starter settings for a setup choice, for the first-time sheet to show before saving. */
export async function starterContentSettingsAction(setups: Setup[]) {
  const picked = (Array.isArray(setups) ? setups : []).filter((s): s is Setup => s === "blog" || s === "social");
  return picked.length ? { success: true as const, settings: starterSettings(picked) } : { success: false as const, error: "Pick Blog, Social or both" };
}

/** W2: + Add idea in the rail: an Idea (off the board) with just its title. */
export async function addIdeaAction(input: { projectId: string; title: string }) {
  const title = String(input?.title ?? "").trim().slice(0, 200);
  if (!title) return { success: false as const, error: "Name the idea" };
  const r = await createTaskAction({ projectId: input.projectId, title, status: "todo", priority: "medium", itemType: "content", stage: "idea", typeFields: {} } as Parameters<typeof createTaskAction>[0]);
  return r.success && "task" in r && r.task ? { success: true as const, id: r.task.id } : { success: false as const, error: r.error ?? "Couldn’t add the idea" };
}

const planInput = z.object({ projectId: id, taskId: id, day, time: time.optional(), sprintId: id.nullable().optional() });

/**
 * W3 and W9: put a piece on a day. Its publish time is that day at the time given (the default time otherwise) and the
 * due date follows (call 7). An Idea becomes Drafting and joins the board (the sprint for owners and admins, else the
 * Backlog), takes the planner as writer when it has none, and gets its type's checklist (call 5).
 */
export async function planContentAction(input: z.infer<typeof planInput>) {
  try {
    const parsed = planInput.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Pick a day" };
    const { projectId, taskId, sprintId } = parsed.data;
    const { user, canEdit } = await insider(projectId);
    if (!canEdit) throw new Error("Viewers can’t plan content");
    const [piece] = await db.select({ stage: tasks.stage, typeFields: tasks.typeFields, assigneeId: tasks.assigneeId }).from(tasks)
      .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), eq(tasks.itemType, "content"), isNull(tasks.deletedAt))).limit(1);
    if (!piece) throw new Error("Not found");
    const settings = await readContentSettings(projectId);
    if (!settings) throw new Error("Set up Content’s channels first");
    const { tz } = await readWorkingHours(projectId);
    const publishAt = zonedInstant(parsed.data.day, parsed.data.time ?? settings.defaultTime, tz).toISOString();
    const dated = await updateTaskFieldAction(taskId, "dueDate", `${parsed.data.day}T00:00:00.000Z`, projectId);
    if (!dated.success) return { success: false as const, error: dated.error ?? "Couldn’t set the day" };
    await db.execute(sql`UPDATE tasks SET type_fields = coalesce(type_fields, '{}'::jsonb) || ${JSON.stringify({ publishAt })}::jsonb WHERE id = ${taskId}::uuid`);
    if (piece.stage === "idea") {
      if (!piece.assigneeId) {
        const assigned = await assignTaskAction(taskId, user.id, projectId);
        if (!assigned.success) return { success: false as const, error: assigned.error ?? "Couldn’t make you the writer" };
      }
      const moved = await setTaskStageAction({ taskId, projectId, stage: "drafting", ...(sprintId ? { sprintId } : { toBacklog: true }) });
      if (!moved.success) return moved;
      const type = settings.types.find((t) => t.id === (piece.typeFields as Record<string, unknown> | null)?.contentType);
      const steps = checklistFor(type);
      const [has] = await db.select({ n: sql<number>`count(*)::int` }).from(taskSubtasks).where(eq(taskSubtasks.taskId, taskId));
      if (steps.length && !has?.n) await db.insert(taskSubtasks).values(steps.map((title, position) => ({ taskId, title, position, createdBy: user.id })));
    }
    // W9.1: moving a piece moves its Publish now.
    await (await import("@/lib/workflows/content-reminders")).scheduleContentReminder(taskId);
    return { success: true as const, publishAt };
  } catch (error) {
    return fail(error, "Couldn’t plan the piece");
  }
}

// ---- A2.8: draft, edit, publish (report 38.8 W5–W7, calls 2–4) ----
const draftInput = z.object({ projectId: id, taskId: id, docId: id, slug: z.string().trim().min(1).max(200) });

async function contentPiece(projectId: string, taskId: string) {
  const [piece] = await db.select({ stage: tasks.stage, typeFields: tasks.typeFields, assigneeId: tasks.assigneeId, title: tasks.title }).from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.projectId, projectId), eq(tasks.itemType, "content"), isNull(tasks.deletedAt))).limit(1);
  if (!piece) throw new Error("Not found");
  return { ...piece, fields: (piece.typeFields ?? {}) as Record<string, unknown> };
}
const merge = (taskId: string, patch: Record<string, unknown>) =>
  db.execute(sql`UPDATE tasks SET type_fields = coalesce(type_fields, '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb, updated_at = now() WHERE id = ${taskId}::uuid`);
async function comment(userId: string, taskId: string, projectId: string, content: string) {
  const { createTaskCommentAs } = await import("@/lib/domain/task-comments");
  const { profiles } = await import("@/lib/db/schema");
  const [profile] = await db.select({ fullName: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl }).from(profiles).where(eq(profiles.id, userId)).limit(1);
  return createTaskCommentAs({ userId, profile: profile ?? null }, taskId, projectId, content);
}

/** W5.1: Write draft links the document the browser just made (in Docs) to the piece. */
export async function linkContentDraftAction(input: z.infer<typeof draftInput>) {
  try {
    const parsed = draftInput.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Couldn’t link the draft" };
    const { projectId, taskId, docId, slug } = parsed.data;
    const { canEdit } = await insider(projectId);
    if (!canEdit) throw new Error("Viewers can’t write drafts");
    await contentPiece(projectId, taskId);
    const { workspaceDocuments } = await import("@/lib/db/schema");
    const [doc] = await db.select({ id: workspaceDocuments.id }).from(workspaceDocuments).where(and(eq(workspaceDocuments.id, docId), eq(workspaceDocuments.projectId, projectId))).limit(1);
    if (!doc) throw new Error("That document isn’t in this workspace");
    await merge(taskId, { draftDocId: docId, draftSlug: slug });
    return { success: true as const };
  } catch (error) {
    return fail(error, "Couldn’t link the draft");
  }
}

const editInput = z.object({ projectId: id, taskId: id, editorId: id, note: z.string().trim().max(2000).optional() });

/**
 * W6.1: Ready for edit names the editor (not the writer, unless an owner or admin edits their own) and moves the piece
 * to Editing; the editor is told. Call 4 (A2.8): the editor's Approve is the piece's review.
 */
export async function readyForEditAction(input: z.infer<typeof editInput>) {
  try {
    const parsed = editInput.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Pick an editor" };
    const { projectId, taskId, editorId, note } = parsed.data;
    const { user, canEdit, canManage } = await insider(projectId);
    if (!canEdit) throw new Error("Viewers can’t send pieces for edit");
    const piece = await contentPiece(projectId, taskId);
    if (piece.stage !== "drafting") throw new Error("Only a piece in Drafting goes for edit");
    const access = await getWorkspaceAccessById(projectId, editorId);
    if (!(access.isOwner || (access.isMember && access.memberRole !== "viewer"))) throw new Error("Pick an editor who can edit here");
    if (editorId === piece.assigneeId && !(canManage && editorId === user.id)) throw new Error("Pick an editor other than the writer");
    const moved = await setTaskStageAction({ taskId, projectId, stage: "editing", toBacklog: true });
    if (!moved.success) return moved;
    await merge(taskId, { editorId });
    if (note) await comment(user.id, taskId, projectId, `Ready for edit: ${note}`);
    await notifyContentPerson(taskId, user.id, editorId, "Ready for edit");
    return { success: true as const };
  } catch (error) {
    return fail(error, "Couldn’t send it for edit");
  }
}

async function notifyContentPerson(taskId: string, actorId: string, to: string | null, words: string) {
  if (!to || to === actorId) return;
  const { createNotification } = await import("@/lib/notifications/service");
  const { projectTaskHref } = await import("@/lib/workspaces/task-presentation");
  const [t] = Array.from(await db.execute<{ title: string; task_number: number | null; workspace_id: string; slug: string | null; key: string | null }>(sql`
    SELECT t.title, t.task_number, t.workspace_id, w.slug, w.key FROM tasks t JOIN workspaces w ON w.id = t.workspace_id WHERE t.id = ${taskId}::uuid`));
  if (!t) return;
  const access = await getWorkspaceAccessById(t.workspace_id, to);
  if (!(access.isOwner || access.isMember)) return;
  await createNotification({
    recipientUserId: to, actorUserId: actorId, kind: "project_task_activity", category: "tasks", importance: "important", title: `${words}: ${t.title}`,
    href: projectTaskHref(t.slug || t.workspace_id, taskId), entityRefs: { projectId: t.workspace_id, projectSlug: t.slug, taskId },
    preview: { contextLabel: t.task_number && t.key ? `${t.key}-${t.task_number}` : "Content", contextKind: "task", secondaryText: "Content" },
    dedupeKey: `content-${words.toLowerCase().replace(/\W+/g, "-")}:${taskId}:${Date.now()}`,
  }).catch(() => undefined);
}

/**
 * The editor's move (Approve, Changes needed). A member editor may not move someone else's task, so the lock is taken as
 * the writer and the move recorded as the editor's (the caller checked they're its editor). Call 4: an owner's or
 * admin's approval is the review; a member editor's still waits for the workspace's review where it's on (security
 * review, A2.8), so naming an editor never skips the owners' check.
 */
async function editorMove(taskId: string, user: { id: string; user_metadata?: Record<string, unknown> | null }, canManage: boolean, writerId: string | null, stage: string) {
  const { afterTaskTransition, lockTaskForWrite, transitionTaskTx } = await import("@/lib/workspaces/task-transition-service");
  const lockAs = canManage || !writerId ? user.id : writerId;
  const { locked, result } = await db.transaction(async (tx) => {
    const locked = await lockTaskForWrite(tx, taskId, lockAs);
    return { locked, result: await transitionTaskTx(tx, { ...locked, reviewRequired: locked.reviewRequired && !canManage }, { taskId, userId: user.id, stage }) };
  });
  await afterTaskTransition(user, locked, taskId, result);
  return result;
}

/** W6.2: the editor (or an owner or admin) approves: Scheduled, Completed on the board; the writer is told. */
export async function approveContentAction(input: { projectId: string; taskId: string }) {
  try {
    const projectId = id.parse(input?.projectId), taskId = id.parse(input?.taskId);
    const { user, canEdit, canManage } = await insider(projectId);
    if (!canEdit) throw new Error("Only its editor approves this piece");
    const piece = await contentPiece(projectId, taskId);
    if (piece.stage !== "editing") throw new Error("Only a piece in Editing is approved");
    if (piece.fields.editorId !== user.id && !canManage) throw new Error("Only its editor approves this piece");
    const [ws] = await db.select({ on: workspaces.workflowsEnabled }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
    if (!ws?.on) throw new Error("Workflows aren’t on in this workspace.");
    // Call 4: an owner's or admin's approval is the review; a member editor's approval still waits for the workspace's
    // review where it's on (security review, A2.8), so naming an editor never skips the owners' check.
    const result = await editorMove(taskId, user, canManage, piece.assigneeId, "scheduled");
    // Waiting for the workspace's review isn't approved yet: the writer hears once it's Scheduled.
    if (result.outcome !== "submitted") await notifyContentPerson(taskId, user.id, piece.assigneeId, "Approved");
    return { success: true as const, outcome: result.outcome };
  } catch (error) {
    return fail(error, "Couldn’t approve the piece");
  }
}

/** W6.2: Changes needed (a note, required) goes back to Drafting with the note as a comment; the writer is told. */
export async function changesNeededAction(input: { projectId: string; taskId: string; note: string }) {
  try {
    const projectId = id.parse(input?.projectId), taskId = id.parse(input?.taskId);
    const note = String(input?.note ?? "").trim().slice(0, 2000);
    if (!note) return { success: false as const, error: "Say what needs changing" };
    const { user, canEdit, canManage } = await insider(projectId);
    if (!canEdit) throw new Error("Only its editor asks for changes");
    const piece = await contentPiece(projectId, taskId);
    if (piece.stage !== "editing") throw new Error("Only a piece in Editing gets changes");
    if (piece.fields.editorId !== user.id && !canManage) throw new Error("Only its editor asks for changes");
    const posted = await comment(user.id, taskId, projectId, `Changes needed: ${note}`);
    if (!posted.success) return { success: false as const, error: posted.error ?? "Couldn’t post the note" };
    await editorMove(taskId, user, canManage, piece.assigneeId, "drafting");
    await notifyContentPerson(taskId, user.id, piece.assigneeId, "Changes needed");
    return { success: true as const };
  } catch (error) {
    return fail(error, "Couldn’t send it back");
  }
}

const publishInput = z.object({
  projectId: id, taskId: id,
  links: z.record(z.string().regex(/^[a-z0-9-]{1,40}$/), z.union([z.object({ link: z.string().trim().max(2048) }).strict(), z.object({ updateId: id }).strict()])),
});

/**
 * W7.2–7.4 and call 2: Mark published takes a link per channel (http or https, never fetched) or, for a NetworkBase
 * Updates channel, the Update posted here. Published once every live channel has one; otherwise "Published on 1 of 2".
 */
export async function markPublishedAction(input: z.infer<typeof publishInput>) {
  try {
    const parsed = publishInput.safeParse(input);
    if (!parsed.success) return { success: false as const, error: "Check the links" };
    const { projectId, taskId, links } = parsed.data;
    const { canEdit } = await insider(projectId);
    if (!canEdit) throw new Error("Viewers can’t mark pieces published");
    const piece = await contentPiece(projectId, taskId);
    if (piece.stage !== "scheduled" && piece.stage !== "published") throw new Error("A piece is published once it’s Scheduled");
    const settings = await readContentSettings(projectId);
    const channels = Array.isArray(piece.fields.channels) ? (piece.fields.channels as string[]) : [];
    const published = { ...((piece.fields.published ?? {}) as Record<string, unknown>) };
    const at = new Date().toISOString();
    for (const [channel, value] of Object.entries(links)) {
      if (!channels.includes(channel)) throw new Error("That channel isn’t on this piece");
      if ("link" in value) {
        if (!/^https?:\/\/\S+$/i.test(value.link)) throw new Error("Links start with http:// or https://");
        published[channel] = { link: value.link, at };
      } else {
        const { workspaceUpdates } = await import("@/lib/db/schema");
        const [u] = await db.select({ id: workspaceUpdates.id }).from(workspaceUpdates).where(and(eq(workspaceUpdates.id, value.updateId), eq(workspaceUpdates.projectId, projectId), isNull(workspaceUpdates.deletedAt))).limit(1);
        if (!u) throw new Error("Pick an Update from this workspace");
        published[channel] = { updateId: value.updateId, at };
      }
    }
    await merge(taskId, { published });
    const { publishState } = await import("@/lib/workflows/content");
    const state = publishState(channels, published, settings?.channels ?? []);
    if (state === "all" && piece.stage !== "published") {
      const moved = await setTaskStageAction({ taskId, projectId, stage: "published" });
      if (!moved.success) return moved;
    }
    return { success: true as const, state };
  } catch (error) {
    return fail(error, "Couldn’t mark it published");
  }
}

/** The Update picker for a NetworkBase Updates channel: this workspace's last 20 Updates. */
export async function readRecentUpdatesAction(projectId: string) {
  try {
    id.parse(projectId);
    await insider(projectId);
    const rows = Array.from(await db.execute<{ id: string; content: string; created_at: Date }>(sql`
      SELECT id, content, created_at FROM workspace_updates WHERE workspace_id = ${projectId}::uuid AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`));
    return { success: true as const, updates: rows.map((r) => ({ id: r.id, text: r.content.replace(/\s+/g, " ").slice(0, 80), at: new Date(r.created_at).toISOString() })) };
  } catch (error) {
    return fail(error, "Couldn’t load Updates");
  }
}
