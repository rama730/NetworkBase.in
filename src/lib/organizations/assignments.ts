import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, inArray, isNotNull, isNull, ne, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { classSectionMembers, taskActivityEvents, workspaceMembers, workspaceSprints, workspaceWorkflowColumns, workspaces, sprintTaskMemberships, taskSubtasks, taskTeamMembers, tasks } from "@/lib/db/schema";
import type { WorkspaceAccess } from "@/lib/data/workspace-access";
import { assignmentWriteBlock, autoStartLine, copyState, reviewDeadlock, lateAfterMs, type AssignmentSettings, type AssignmentTarget, type AssignmentWrite, type CopyState, type StartTrigger } from "@/lib/organizations/assignment-rules";
import { orgCan, orgRoleOf, type OrgRole } from "@/lib/organizations/permissions";

// Assignments (report §16, §16.11): a master task on the org and one copy per person, team or child project.

type Executor = typeof db | Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CopyRecipient = { projectId: string; assigneeId: string; teamName?: string; members?: string[] };

/** The rule below for SQL written by hand that names the viewer (chat cards, the extension, comments): 0042. */
export const orgTaskVisibleToSql = (taskId: SQL, viewer: string | null | SQL) => sql`app_private.nb_org_task_visible_to(${taskId}, ${viewer}::uuid)`;

/**
 * Decision-19 read rule for task lists in an organization, mirroring app_private.nb_org_task_visible_to (0042):
 * members and guests see the published masters, their own copies and their team's copies; owners and admins see
 * all, with copies kept off their board (they live in the roster and the Review queue).
 */
export function orgTaskReadFilter(access: WorkspaceAccess, viewerId: string | null, scope: string = "all"): SQL | undefined {
  // Report 38.12 (A5.1 security review) and 38.13 call 5: goals and ideas are for members only, never public: they stay out
  // of every task read for anyone outside the workspace (visitors of a public Tasks tab, outside tokens).
  // Security review (A5.4): rows of a members-only or leaders-only document (an off-site's checklists, a private meeting's
  // action items) stay out too.
  if (access.project?.kind !== "organization") return access.isOwner || access.isMember ? undefined : sql`(coalesce(${tasks.itemType}, 'task') NOT IN ('objective', 'key_result', 'idea')
    AND (${tasks.sourceDocId} IS NULL OR NOT EXISTS (SELECT 1 FROM workspace_documents d WHERE d.id = ${tasks.sourceDocId} AND d.settings->>'visibilityOverride' IN ('members_only', 'leaders_only'))))`;
  const isAdmin = access.isOwner || access.memberRole === "admin";
  // Mine shows an admin their own copies too (an assignment given to admins); the scope itself narrows to theirs.
  if (isAdmin) return scope === "review" || scope === "mine" ? undefined : isNull(tasks.assignmentId);
  const master = and(eq(tasks.kind, "assignment"), isNull(tasks.assignmentId), sql`${tasks.assignmentSettings}->>'publishedAt' IS NOT NULL`);
  if (!viewerId) return master;
  const own = or(
    eq(tasks.assigneeId, viewerId),
    sql`EXISTS (SELECT 1 FROM ${taskTeamMembers} tm WHERE tm.task_id = ${tasks.id} AND tm.user_id = ${viewerId})`,
  );
  // Decision 15: a member's board holds their own copy, never the main assignment too. The main one stays readable
  // (scope "review") so class questions open from the copy. Viewers have no copies and see the main ones.
  // ponytail: the one temporary switch (decisions 113, 166) while real classes run: NB_ORG_BOARD_CLASSIC=true gives
  // members the main assignment back on their board. Remove it after the pilot.
  if (access.memberRole === "member" && scope !== "review" && process.env.NB_ORG_BOARD_CLASSIC !== "true") return own;
  return or(master, own);
}

/**
 * Where an assignment card sits and what it says (report §16.1, decision 14): To do while it's a draft or nobody
 * has started, Completed once everyone is done or excused or it's closed, In progress otherwise.
 */
export function assignmentColumn(p: { draft: boolean; closed: boolean; started: number; done: number; total: number }): "todo" | "in_progress" | "done" {
  if (p.draft) return "todo";
  if (p.closed || (p.total > 0 && p.done >= p.total)) return "done";
  return p.started > 0 ? "in_progress" : "todo";
}

/** Class progress for main assignments, from their copies in one query (the board card and the sprint list). */
export async function readMasterProgress(masterIds: string[]) {
  if (masterIds.length === 0) return new Map<string, { total: number; started: number; done: number; to_review: number; excused: number; stuck: number }>();
  const rows = await db.execute<{ master_id: string; total: number; started: number; done: number; to_review: number; excused: number; stuck: number }>(sql`
    SELECT c.assignment_id AS master_id,
           count(*) FILTER (WHERE c.excused_at IS NULL)::int AS total,
           count(*) FILTER (WHERE c.excused_at IS NULL AND (c.status <> 'todo' OR c.submission IS NOT NULL))::int AS started,
           count(*) FILTER (WHERE c.excused_at IS NULL AND c.status = 'done' AND c.review_status <> 'pending')::int AS done,
           count(*) FILTER (WHERE c.excused_at IS NULL AND c.review_status = 'pending')::int AS to_review,
           count(*) FILTER (WHERE c.excused_at IS NOT NULL)::int AS excused,
           -- Assignment flow decision 6: copies in Blocked, so the main card can say who's stuck.
           count(*) FILTER (WHERE c.excused_at IS NULL AND c.status = 'blocked' AND c.review_status <> 'pending')::int AS stuck
    FROM tasks c WHERE c.assignment_id IN (${sql.join(masterIds.map((id) => sql`${id}::uuid`), sql`, `)}) AND c.deleted_at IS NULL
    GROUP BY c.assignment_id`);
  return new Map(Array.from(rows).map((r) => [r.master_id, r]));
}

const STAGES: CopyState[] = ["not_started", "in_progress", "submitted", "returned", "done", "missing", "excused"];
export type AssignmentStages = { counts: Record<CopyState, number>; names: Record<CopyState, string[]>; total: number; reviewRequired: boolean; teams: boolean;
  /** Assignment flow decision 6: copies in Blocked (counted inside In progress or Returned too). */ stuck: number;
  /** Copies still to hand in (Not started, Missing), for Remind. */ remind: { not_started: string[]; missing: string[] } };
export type CopyStage = { state: CopyState; late: boolean; since: string | null; reason: string | null; fixBy: string | null; version: number | null; reviewRequired: boolean; handIn: { link: string | null; text: string | null } | null;
  /** Assignment flow decision 6: the copy sits in Blocked. */ stuck?: boolean };
const NAMES_PER_STAGE = 5;

/**
 * Sprint cleanup §4: where everyone is on each main assignment — the roster's own rule (copyState), so the sprint list
 * and the Assignment tab never disagree — with up to five names per stage (teams by their team name). And, for copies,
 * where that one person is: their stage, since when, the return reason and Fix by.
 */
export async function readAssignmentStages(masterIds: string[], copyIds: string[] = []) {
  const stages = new Map<string, AssignmentStages>();
  const copies = new Map<string, CopyStage>();
  if (!masterIds.length && !copyIds.length) return { stages, copies };
  const ids = (list: string[]) => sql.join(list.map((id) => sql`${id}::uuid`), sql`, `);
  const rows = await db.execute<{ id: string; master_id: string; status: string; review_status: string; due_date: string | null; submitted_at: string | null; completed_at: string | null;
    excused_at: string | null; submit_until: string | null; updated_at: string; who: string; is_team: boolean; hand_link: string | null; hand_text: string | null; settings: AssignmentSettings | null; reason: string | null; version: number | null }>(sql`
    SELECT c.id, c.assignment_id AS master_id, c.status, c.review_status, c.due_date::text, c.review_submitted_at::text AS submitted_at, c.completed_at::text, c.excused_at::text,
           c.submit_until::text, c.updated_at::text, m.assignment_settings AS settings, c.team_name IS NOT NULL AS is_team, (c.submission->>'version')::int AS version, c.submission->>'link' AS hand_link, c.submission->>'text' AS hand_text,
           coalesce(c.team_name, (SELECT w.title FROM workspaces w WHERE w.id = c.workspace_id AND w.id <> m.workspace_id),
                    (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = c.assignee_id), 'Member') AS who,
           CASE WHEN c.review_status = 'rejected' THEN (SELECT e.payload->>'reason' FROM task_activity_events e WHERE e.task_id = c.id AND e.event_type = 'changes_requested' ORDER BY e.created_at DESC LIMIT 1) END AS reason
    FROM tasks c JOIN tasks m ON m.id = c.assignment_id
    WHERE c.deleted_at IS NULL AND (${masterIds.length ? sql`c.assignment_id IN (${ids(masterIds)})` : sql`false`} OR ${copyIds.length ? sql`c.id IN (${ids(copyIds)})` : sql`false`})
    ORDER BY who`);
  const now = new Date();
  const date = (v: string | null) => (v ? new Date(v) : null);
  for (const r of rows) {
    const { state, late } = copyState({ status: r.status, reviewStatus: r.review_status, dueDate: date(r.due_date), submittedAt: date(r.submitted_at), completedAt: date(r.completed_at), excusedAt: date(r.excused_at) }, now, lateAfterMs(r.settings));
    if (copyIds.includes(r.id)) {
      const since = state === "submitted" ? r.submitted_at : state === "done" ? r.completed_at ?? r.submitted_at : state === "excused" ? r.excused_at : state === "returned" ? r.updated_at : null;
      copies.set(r.id, { state, late, since: since ? new Date(since).toISOString() : null, reason: r.reason, fixBy: r.submit_until ? new Date(r.submit_until).toISOString() : null, version: r.version, reviewRequired: r.settings?.reviewRequired !== false,
        handIn: r.hand_link || r.hand_text ? { link: r.hand_link, text: r.hand_text } : null, stuck: r.status === "blocked" && r.review_status !== "pending" });
    }
    if (!masterIds.includes(r.master_id)) continue;
    const entry = stages.get(r.master_id) ?? { counts: Object.fromEntries(STAGES.map((k) => [k, 0])) as Record<CopyState, number>, names: Object.fromEntries(STAGES.map((k) => [k, []])) as unknown as Record<CopyState, string[]>,
      total: 0, reviewRequired: r.settings?.reviewRequired !== false, teams: false, remind: { not_started: [], missing: [] }, stuck: 0 };
    entry.counts[state] += 1;
    if (r.status === "blocked" && (state === "in_progress" || state === "returned")) entry.stuck += 1;
    if (r.is_team) entry.teams = true;
    if (state === "not_started" || state === "missing") entry.remind[state].push(r.id);
    if (state !== "excused") entry.total += 1;
    if (entry.names[state].length < NAMES_PER_STAGE) entry.names[state].push(r.who + (late ? " (late)" : ""));
    stages.set(r.master_id, entry);
  }
  return { stages, copies };
}

/**
 * Assignment flow decision 1: the first real work on a copy (a file, a ticked step, a started answer) moves it from To
 * do to In progress. Only a copy, only from To do, never once handed in or excused; one guarded UPDATE, so two at once
 * move it once. Returns whether it moved. Opening, reading and asking questions never call this.
 */
export async function startCopyOnWork(executor: Executor, taskId: string, actorId: string, trigger: StartTrigger): Promise<boolean> {
  const [moved] = await executor.execute<{ id: string; workspace_id: string; sprint_id: string | null; title: string; task_number: number | null }>(sql`
    UPDATE tasks t SET status = 'in_progress', updated_at = now(),
           workflow_column_id = coalesce((SELECT c.id FROM workspace_workflow_columns c WHERE c.workspace_id = t.workspace_id AND c.status = 'in_progress' AND c.is_default LIMIT 1), t.workflow_column_id)
    WHERE t.id = ${taskId}::uuid AND t.assignment_id IS NOT NULL AND t.status = 'todo' AND t.review_status = 'none'
      AND t.excused_at IS NULL AND t.deleted_at IS NULL
    RETURNING t.id, t.workspace_id, t.sprint_id, t.title, t.task_number`);
  if (!moved) return false;
  await executor.insert(taskActivityEvents).values({
    taskId, projectId: moved.workspace_id, sprintId: moved.sprint_id, actorId, eventType: "status_changed",
    payload: { version: 1, source: "auto_start", trigger: trigger.kind, name: trigger.name ?? null, taskTitle: moved.title, taskNumber: moved.task_number, taskStatus: "in_progress", from: "todo", to: "in_progress" },
  });
  return true;
}

/** Best effort after the work itself saved: a failed start never fails the upload, tick or draft. */
export async function startCopyQuietly(taskId: string | null | undefined, actorId: string, trigger: StartTrigger) {
  if (!taskId) return;
  try { await startCopyOnWork(db, taskId, actorId, trigger); } catch { /* the work is saved; the card can still be dragged */ }
}

/**
 * Assignment flow card lines: why a copy last moved (an auto start, or a teammate's move), and the Blocked note while
 * it's stuck. The viewer's own moves say nothing; the card hides the line once its person has opened it (client).
 */
export async function readCopyMoves(copyIds: string[], viewerId: string | null) {
  const moves = new Map<string, { text: string; at: string }>();
  const stuck = new Map<string, string>();
  if (!copyIds.length) return { moves, stuck };
  const rows = await db.execute<{ task_id: string; actor_id: string | null; payload: Record<string, unknown> | null; created_at: string; who: string | null; status: string }>(sql`
    SELECT DISTINCT ON (e.task_id) e.task_id, e.actor_id, e.payload, e.created_at::text, coalesce(p.full_name, p.username) AS who, t.status
    FROM task_activity_events e JOIN tasks t ON t.id = e.task_id LEFT JOIN profiles p ON p.id = e.actor_id
    WHERE e.task_id IN (${sql.join(copyIds.map((id) => sql`${id}::uuid`), sql`, `)}) AND e.event_type = 'status_changed'
    ORDER BY e.task_id, e.created_at DESC`);
  const COLUMN: Record<string, string> = { todo: "To do", in_progress: "In progress", blocked: "Blocked", done: "Completed" };
  for (const r of rows) {
    const p = r.payload ?? {};
    const at = new Date(r.created_at).toISOString();
    const mine = Boolean(viewerId && r.actor_id === viewerId);
    if (r.status === "blocked" && typeof p.note === "string" && p.note.trim()) stuck.set(r.task_id, p.note.trim());
    if (p.source === "auto_start") {
      const line = autoStartLine({ kind: (p.trigger as StartTrigger["kind"]) ?? "file", name: (p.name as string | null) ?? null }, mine);
      moves.set(r.task_id, { text: mine || !r.who ? line : line.replace("someone", r.who), at });
    } else if (!mine && r.who && typeof p.to === "string" && COLUMN[p.to] && p.to !== "done") {
      moves.set(r.task_id, { text: `Moved to ${COLUMN[p.to]} by ${r.who}`, at });
    }
  }
  return { moves, stuck };
}

/** Whether one task passes the same rule (task detail, sprint rows, the extension). */
export async function canSeeOrgTask(access: WorkspaceAccess, viewerId: string | null, taskId: string) {
  const filter = orgTaskReadFilter(access, viewerId, "review");
  if (!filter) return true;
  const [row] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, taskId), filter)).limit(1);
  return Boolean(row);
}

/** Assignment flow decision 8: publishing would leave nobody able to review its copies. */
export class NoReviewerError extends Error {}

/** Everyone in the org who could review, by role (the owner counted once), for reviewDeadlock. */
export async function reviewerRolesOf(executor: Executor, orgId: string): Promise<OrgRole[]> {
  const rows = await executor.select({ role: workspaceMembers.role }).from(workspaceMembers).where(eq(workspaceMembers.projectId, orgId));
  const [owner] = await executor.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
  const roles = rows.map((r) => orgRoleOf(r.role));
  return owner?.ownerId && !roles.includes("owner") ? [...roles, orgRoleOf("owner")] : roles;
}

/** Throws NoReviewerError when an assignment with these settings can't be reviewed by anyone in the org. */
export async function assertSomeoneReviews(executor: Executor, orgId: string, settings: Pick<AssignmentSettings, "target" | "reviewRequired">) {
  const deadlock = reviewDeadlock(settings.target, settings.reviewRequired, await reviewerRolesOf(executor, orgId));
  if (deadlock) throw new NoReviewerError(deadlock);
}

/** Who gets a copy (report §16.2): people in the org, teams, or each (or some) child project's lead. */
/** Some of a draft's chosen people have left (report §42.10 problem 15); publish again with dropMissing for the rest. */
export class PeopleLeftError extends Error {
  constructor(readonly left: number, readonly rest: number) {
    super(`${left === 1 ? "1 person has" : `${left} people have`} left. Publish to the other ${rest}?`);
  }
}

export async function resolveRecipients(executor: Executor, orgId: string, target: AssignmentTarget, options: { dropMissing?: boolean } = {}): Promise<CopyRecipient[]> {
  const members = await executor
    .select({ userId: workspaceMembers.userId, role: workspaceMembers.role })
    .from(workspaceMembers)
    .where(eq(workspaceMembers.projectId, orgId));
  const roleOf = new Map(members.map((m) => [m.userId, m.role]));
  // Guests never get copies; owners and admins only when picked by name or by the admin role.
  const assignable = (userId: string) => roleOf.has(userId) && roleOf.get(userId) !== "viewer";

  if (target.mode === "everyone") return members.filter((m) => m.role === "member").map((m) => ({ projectId: orgId, assigneeId: m.userId }));
  if (target.mode === "role") return members.filter((m) => m.role === target.role || (target.role === "admin" && m.role === "owner")).map((m) => ({ projectId: orgId, assigneeId: m.userId }));
  // B1.3b (report 30.9 call 5): the students now in the picked sections (one copy each, even in two picked sections).
  if (target.mode === "sections") {
    const rows = target.sectionIds.length ? await executor.select({ userId: classSectionMembers.userId }).from(classSectionMembers)
      .where(and(eq(classSectionMembers.projectId, orgId), inArray(classSectionMembers.sectionId, target.sectionIds), eq(classSectionMembers.role, "student"))) : [];
    const ids = [...new Set(rows.map((r) => r.userId))].filter((id) => roleOf.get(id) === "member");
    if (ids.length === 0) throw new Error("Those sections have no students yet.");
    return ids.map((assigneeId) => ({ projectId: orgId, assigneeId }));
  }
  // People who left since the draft was saved: asked about first, then left out (problem 15).
  const named = target.mode === "people" ? target.userIds : target.mode === "teams" ? [...target.teams.flatMap((t) => t.userIds), ...target.individuals] : [];
  const left = [...new Set(named)].filter((id) => !assignable(id));
  if (left.length && !options.dropMissing) {
    if (left.length === new Set(named).size) throw new Error("Pick people who are members of the organization.");
    throw new PeopleLeftError(left.length, new Set(named).size - left.length);
  }
  if (target.mode === "people") {
    const ids = [...new Set(target.userIds)].filter(assignable);
    if (ids.length === 0) throw new Error("Pick people who are members of the organization.");
    return ids.map((assigneeId) => ({ projectId: orgId, assigneeId }));
  }
  if (target.mode === "teams" && left.length) {
    const teams = target.teams.map((t) => ({ ...t, userIds: t.userIds.filter(assignable) })).filter((t) => t.userIds.length > 0);
    return resolveRecipients(executor, orgId, { mode: "teams", teams, individuals: target.individuals.filter(assignable) });
  }
  if (target.mode === "teams") {
    const everyone = [...target.teams.flatMap((t) => t.userIds), ...target.individuals];
    if (new Set(everyone).size !== everyone.length) throw new Error("A person can be in one team per assignment.");
    if (everyone.some((id) => !assignable(id))) throw new Error("Pick people who are members of the organization.");
    if (target.teams.some((t) => t.userIds.length === 0)) throw new Error("Every team needs at least one person.");
    const names = target.teams.map((t) => t.name.trim().toLowerCase());
    if (names.some((n) => !n) || new Set(names).size !== names.length) throw new Error("Give each team its own name.");
    return [
      ...target.teams.map((team) => {
        const lead = team.leadId && team.userIds.includes(team.leadId) ? team.leadId : team.userIds[0]!;
        return { projectId: orgId, assigneeId: lead, teamName: team.name.trim().slice(0, 60), members: team.userIds };
      }),
      ...target.individuals.map((assigneeId) => ({ projectId: orgId, assigneeId })),
    ];
  }
  const children = await executor
    .select({ id: workspaces.id, ownerId: workspaces.ownerId })
    .from(workspaces)
    .where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt), ne(workspaces.status, "archived")));
  const picked = target.mode === "children" ? children.filter((c) => target.projectIds.includes(c.id)) : children;
  if (picked.length === 0) throw new Error("Create workspaces in the organization first.");
  return picked.map((child) => ({ projectId: child.id, assigneeId: child.ownerId }));
}

/** Inserts one task the way createTaskAction does: next task number, top of the To do column. */
export async function insertTask(executor: Executor, values: {
  projectId: string;
  title: string;
  description: string | null;
  dueDate: Date | null;
  sprintId: string | null;
  assigneeId: string | null;
  creatorId: string;
  kind: "task" | "assignment";
  assignmentId: string | null;
  assignmentSettings: AssignmentSettings | null;
  teamName: string | null;
}) {
  const [counter] = await executor.execute<{ current_task_number: number }>(sql`
    UPDATE ${workspaces} SET current_task_number = COALESCE(current_task_number, 0) + 1 WHERE id = ${values.projectId} RETURNING current_task_number`);
  const [column] = await executor
    .select({ id: workspaceWorkflowColumns.id })
    .from(workspaceWorkflowColumns)
    .where(and(eq(workspaceWorkflowColumns.projectId, values.projectId), eq(workspaceWorkflowColumns.status, "todo"), eq(workspaceWorkflowColumns.isDefault, true)))
    .limit(1);
  const [row] = await executor
    .insert(tasks)
    .values({
      ...values,
      status: "todo",
      workflowColumnId: column?.id ?? null,
      position: column ? sql`(SELECT COALESCE(MAX(position), 0) + 1024 FROM ${tasks} WHERE workflow_column_id = ${column.id} AND deleted_at IS NULL)` : null,
      timelineOriginSprintId: values.sprintId,
      timelineOriginAt: values.sprintId ? new Date() : null,
      taskNumber: counter?.current_task_number ?? null,
    })
    .returning({ id: tasks.id });
  return row!.id;
}

export async function createMasterTask(executor: Executor, input: {
  orgId: string; title: string; description: string | null; dueDate: Date; sprintId: string | null; creatorId: string; settings: AssignmentSettings; steps: string[];
}) {
  const id = await insertTask(executor, {
    projectId: input.orgId, title: input.title, description: input.description, dueDate: input.dueDate, sprintId: input.sprintId,
    assigneeId: null, creatorId: input.creatorId, kind: "assignment", assignmentId: null, assignmentSettings: input.settings, teamName: null,
  });
  if (input.steps.length > 0) {
    await executor.insert(taskSubtasks).values(input.steps.map((title, position) => ({ taskId: id, title, position })));
  }
  // The master shows on the org sprint's timeline; person copies never do (they are private, decision 19).
  if (input.sprintId) await executor.insert(sprintTaskMemberships).values({ projectId: input.orgId, sprintId: input.sprintId, taskId: id, addedBy: input.creatorId });
  return id;
}

/**
 * One copy per recipient, with the master's steps (report §16.3). Group copies go into the child project's
 * sprint linked to the master's sprint, or its backlog. Copies are written in bulk, one task-number bump and one
 * column lookup per project, so 2,000 copies are a handful of statements. ponytail: inline up to
 * ORG_LIMITS.copiesCreatedInline (the member cap); a background job only if that cap is ever raised.
 */
export async function createCopies(executor: Executor, masterId: string, recipients: CopyRecipient[], creatorId: string) {
  const [master] = await executor.select().from(tasks).where(eq(tasks.id, masterId)).limit(1);
  if (!master) throw new Error("Assignment not found");
  const steps = await executor.select({ title: taskSubtasks.title, position: taskSubtasks.position }).from(taskSubtasks).where(eq(taskSubtasks.taskId, masterId));

  // A group copy sits in the child project's sprint linked to the master's sprint (report §16.6).
  const childSprint = new Map<string, string | null>();
  const children = [...new Set(recipients.map((r) => r.projectId).filter((id) => id !== master.projectId))];
  if (master.sprintId && children.length) {
    const linked = await executor.select({ id: workspaceSprints.id, projectId: workspaceSprints.projectId }).from(workspaceSprints)
      .where(and(inArray(workspaceSprints.projectId, children), eq(workspaceSprints.parentSprintId, master.sprintId), inArray(workspaceSprints.status, ["planning", "active"])));
    for (const row of linked) if (!childSprint.has(row.projectId)) childSprint.set(row.projectId, row.id);
  }

  const byProject = new Map<string, Array<CopyRecipient & { id: string; sprintId: string | null }>>();
  for (const recipient of recipients) {
    const sprintId = recipient.projectId === master.projectId ? master.sprintId : childSprint.get(recipient.projectId) ?? null;
    byProject.set(recipient.projectId, [...(byProject.get(recipient.projectId) ?? []), { ...recipient, id: randomUUID(), sprintId }]);
  }

  const now = new Date();
  for (const [projectId, copies] of byProject) {
    // Same numbering and column as createTaskAction: next task numbers, appended to the default To do column.
    const [counter] = await executor.execute<{ current_task_number: number }>(sql`
      UPDATE ${workspaces} SET current_task_number = COALESCE(current_task_number, 0) + ${copies.length} WHERE id = ${projectId} RETURNING current_task_number`);
    const first = (counter?.current_task_number ?? copies.length) - copies.length + 1;
    const [column] = await executor.select({ id: workspaceWorkflowColumns.id }).from(workspaceWorkflowColumns)
      .where(and(eq(workspaceWorkflowColumns.projectId, projectId), eq(workspaceWorkflowColumns.status, "todo"), eq(workspaceWorkflowColumns.isDefault, true))).limit(1);
    const [top] = column ? await executor.execute<{ position: number }>(sql`
      SELECT COALESCE(MAX(position), 0)::float8 AS position FROM ${tasks} WHERE workflow_column_id = ${column.id} AND deleted_at IS NULL`) : [];
    for (let i = 0; i < copies.length; i += 500) {
      await executor.insert(tasks).values(copies.slice(i, i + 500).map((copy, j) => ({
        id: copy.id, projectId, title: master.title, description: master.description, dueDate: master.dueDate, sprintId: copy.sprintId,
        assigneeId: copy.assigneeId, creatorId, kind: "task" as const, assignmentId: masterId, assignmentSettings: null, teamName: copy.teamName ?? null,
        status: "todo" as const, workflowColumnId: column?.id ?? null, position: column ? Number(top?.position ?? 0) + 1024 * (i + j + 1) : null,
        timelineOriginSprintId: copy.sprintId, timelineOriginAt: copy.sprintId ? now : null, taskNumber: counter ? first + i + j : null,
      })));
    }
  }

  const all = [...byProject.values()].flat();
  const subtasks = all.flatMap((copy) => steps.map((step) => ({ taskId: copy.id, title: step.title, position: step.position })));
  for (let i = 0; i < subtasks.length; i += 1000) await executor.insert(taskSubtasks).values(subtasks.slice(i, i + 1000));
  const sprintRows = all.filter((c) => c.sprintId && c.projectId !== master.projectId).map((c) => ({ projectId: c.projectId, sprintId: c.sprintId!, taskId: c.id, addedBy: creatorId }));
  if (sprintRows.length) await executor.insert(sprintTaskMemberships).values(sprintRows);
  const teamRows = all.flatMap((c) => (c.members ?? []).map((userId) => ({ taskId: c.id, userId, isLead: userId === c.assigneeId })));
  for (let i = 0; i < teamRows.length; i += 1000) await executor.insert(taskTeamMembers).values(teamRows.slice(i, i + 1000));
  // Away (report §33.5): someone marked away over the due date gets their own copy already excused.
  if (master.dueDate) {
    const own = all.filter((c) => !c.members?.length && c.assigneeId && c.projectId === master.projectId).map((c) => c.id);
    for (let i = 0; i < own.length; i += 1000) {
      await executor.execute(sql`
        UPDATE ${tasks} c SET excused_at = now(), excused_reason = coalesce('Away: ' || a.reason, 'Away')
        FROM org_member_away a WHERE c.id IN ${own.slice(i, i + 1000)} AND a.org_id = ${master.projectId} AND a.user_id = c.assignee_id
          AND ${master.dueDate.toISOString()}::timestamptz BETWEEN a.starts_at AND a.ends_at`);
    }
  }
}

/** Late joiners get copies of open assignments that aren't past due; teams mode excepted (report §16.9, §16.11). */
export async function createCopiesForNewMember(executor: Executor, orgId: string, userId: string) {
  const masters = await executor
    .select({ id: tasks.id, settings: tasks.assignmentSettings, dueDate: tasks.dueDate, creatorId: tasks.creatorId, sprintId: tasks.sprintId })
    .from(tasks)
    .where(and(eq(tasks.projectId, orgId), eq(tasks.kind, "assignment"), isNull(tasks.assignmentId), isNull(tasks.deletedAt)));
  const now = Date.now();
  const { isPathModuleAssignment } = await import("@/lib/workflows/path-server");
  for (const master of masters) {
    // B2.2b: a self-paced module's assignments wait for the learner to open it.
    if (await isPathModuleAssignment(executor, orgId, master.sprintId)) continue;
    const s = master.settings;
    if (!s?.publishedAt || s.closedAt || (master.dueDate && master.dueDate.getTime() < now)) continue;
    if (!(s.target.mode === "everyone" || (s.target.mode === "role" && s.target.role === "member"))) continue;
    // A copy removed when they left doesn't count: someone who comes back gets the open work again (decision 50).
    const [existing] = await executor.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, master.id), eq(tasks.assigneeId, userId), isNull(tasks.deletedAt))).limit(1);
    if (!existing) await createCopies(executor, master.id, [{ projectId: orgId, assigneeId: userId }], master.creatorId ?? userId);
  }
}

/**
 * Copies for someone who just joined, in their own transaction after the join commits (audit N67, N68): the join
 * holds the organization's lock only as long as the membership needs it. A failure here never undoes the join.
 */
export async function createCopiesAfterJoin(orgId: string, userIds: string[]) {
  for (const userId of userIds) {
    await db.transaction((tx) => createCopiesForNewMember(tx, orgId, userId))
      .catch((error: unknown) => console.error("Creating assignment copies after a join failed:", error));
  }
}

/** A new child project gets a group copy of each open "each project" assignment that isn't overdue (report §14.3 Phase 5). */
export async function createCopiesForNewChild(executor: Executor, orgId: string, childId: string, leadId: string) {
  const masters = await executor
    .select({ id: tasks.id, settings: tasks.assignmentSettings, dueDate: tasks.dueDate, creatorId: tasks.creatorId })
    .from(tasks)
    .where(and(eq(tasks.projectId, orgId), eq(tasks.kind, "assignment"), isNull(tasks.assignmentId), isNull(tasks.deletedAt)));
  const now = Date.now();
  for (const master of masters) {
    const s = master.settings;
    if (!s?.publishedAt || s.closedAt || s.target.mode !== "each_child" || (master.dueDate && master.dueDate.getTime() < now)) continue;
    const [existing] = await executor.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, master.id), eq(tasks.projectId, childId))).limit(1);
    if (!existing) await createCopies(executor, master.id, [{ projectId: childId, assigneeId: leadId }], master.creatorId ?? leadId);
  }
}

/** Someone leaving: their unfinished copies go (submitted work stays); a team's lead passes on (report §16.9, §16.11). */
export async function releaseCopiesOnLeave(executor: Executor, orgId: string, userId: string) {
  await executor.update(tasks).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(
    eq(tasks.projectId, orgId), eq(tasks.assigneeId, userId), isNotNull(tasks.assignmentId), isNull(tasks.deletedAt),
    // Anything handed in stays, Returned work included (decision 143).
    sql`NOT ${handedInSql}`,
    sql`NOT EXISTS (SELECT 1 FROM ${taskTeamMembers} tm WHERE tm.task_id = ${tasks.id} AND tm.user_id <> ${userId})`,
  ));
  const teamCopies = await executor.select({ taskId: taskTeamMembers.taskId, isLead: taskTeamMembers.isLead }).from(taskTeamMembers)
    .innerJoin(tasks, eq(tasks.id, taskTeamMembers.taskId))
    .where(and(eq(taskTeamMembers.userId, userId), eq(tasks.projectId, orgId)));
  for (const { taskId, isLead } of teamCopies) {
    await executor.delete(taskTeamMembers).where(and(eq(taskTeamMembers.taskId, taskId), eq(taskTeamMembers.userId, userId)));
    // Only a leaving lead passes the lead on, so a team never ends up with two (report §42.2 smaller bug 3).
    const [next] = isLead ? await executor.select({ userId: taskTeamMembers.userId }).from(taskTeamMembers).where(eq(taskTeamMembers.taskId, taskId)).limit(1) : [];
    if (next) {
      await executor.update(taskTeamMembers).set({ isLead: true }).where(and(eq(taskTeamMembers.taskId, taskId), eq(taskTeamMembers.userId, next.userId)));
      await executor.update(tasks).set({ assigneeId: next.userId, updatedAt: new Date() }).where(and(eq(tasks.id, taskId), eq(tasks.assigneeId, userId)));
    }
  }
}

/** Detaching a child project turns its group copies into ordinary tasks (report §16.9). */
/** "When something was handed in" (report §42.4): waiting for review, done, or submitted at least once. */
export const handedInSql = sql`(${tasks.reviewStatus} = 'pending' OR ${tasks.status} = 'done' OR ${tasks.reviewSubmittedAt} IS NOT NULL)`;

/**
 * Detaching (decision 130): handed-in group work stays linked, so the teacher's roster keeps it as "Detached";
 * only unsubmitted work is released to the workspace as its own tasks.
 */
export async function releaseGroupCopies(executor: Executor, childProjectId: string) {
  await executor.update(tasks).set({ assignmentId: null, updatedAt: new Date() })
    .where(and(eq(tasks.projectId, childProjectId), isNotNull(tasks.assignmentId), sql`NOT ${handedInSql}`));
}

/**
 * "When a lead changes" (report §42.4, decision 129): a workspace's group work is held by whoever leads it, however
 * the lead changed. An organization's own copies belong to their people and never move.
 */
export async function moveGroupWorkToLead(executor: Executor, workspaceId: string, leadId: string) {
  await executor.update(tasks).set({ assigneeId: leadId, updatedAt: new Date() }).where(and(
    eq(tasks.projectId, workspaceId), isNotNull(tasks.assignmentId), isNull(tasks.deletedAt),
    sql`EXISTS (SELECT 1 FROM workspaces w WHERE w.id = ${workspaceId}::uuid AND w.kind <> 'organization')`,
  ));
}

/** What assignmentWriteBlock needs about one task, read inside the write's transaction (report §19.3). */
export async function assignmentWriteContext(executor: Executor, taskId: string) {
  const rows = await executor.execute<{ master: boolean; copy: boolean; handed_in: boolean; approved: boolean; group_copy: boolean; org_title: string | null; org_id: string | null }>(sql`
    SELECT t.kind = 'assignment' AND t.assignment_id IS NULL AS master,
           t.assignment_id IS NOT NULL AS copy,
           CASE WHEN t.assignment_id IS NULL
             THEN EXISTS (SELECT 1 FROM tasks c WHERE c.assignment_id = t.id AND c.deleted_at IS NULL
               AND (c.review_status = 'pending' OR c.status = 'done' OR c.review_submitted_at IS NOT NULL))
             ELSE (t.review_status = 'pending' OR t.status = 'done' OR t.review_submitted_at IS NOT NULL) END AS handed_in,
           t.status = 'done' AND t.review_status <> 'pending' AS approved,
           p.kind <> 'organization' AS group_copy,
           (SELECT o.title FROM tasks m JOIN workspaces o ON o.id = m.workspace_id WHERE m.id = coalesce(t.assignment_id, t.id)) AS org_title,
           (SELECT m.workspace_id FROM tasks m WHERE m.id = coalesce(t.assignment_id, t.id)) AS org_id
    FROM tasks t JOIN workspaces p ON p.id = t.workspace_id WHERE t.id = ${taskId}::uuid`);
  const row = Array.from(rows)[0];
  if (!row || (!row.master && !row.copy)) return null;
  return { isMaster: row.master, isCopy: row.copy, handedIn: row.handed_in, approved: row.approved, groupCopy: row.group_copy, orgTitle: row.org_title ?? "the organization", orgId: row.org_id };
}

/**
 * Throws the plain reason when the write isn't allowed (report §19.3, decisions 33 and 109): assignment work follows
 * assignmentWriteBlock; an ordinary task on an organization's board follows update_assigned_task ("own" for
 * members). Tasks in ordinary workspaces pass.
 */
export async function assertAssignmentWrite(executor: Executor, taskId: string, actor: { role: OrgRole; isHolder: boolean; onOrgBoard: boolean }, write: AssignmentWrite) {
  const context = await assignmentWriteContext(executor, taskId);
  const blocked = context ? assignmentWriteBlock({ ...context, actorRole: actor.role, actorIsHolder: actor.isHolder }, write)
    : actor.onOrgBoard && !orgCan(actor.role, "update_assigned_task", actor.isHolder) ? "You can change only your own work." : null;
  if (blocked) throw new Error(blocked);
  return context;
}

/** The workspace a copy lives in, as a path for assignmentHref: the organization's, or its group workspace's by id. */
export async function copyWorkspacePath(copyId: string): Promise<string | null> {
  const rows = await db.execute<{ kind: string; slug: string | null; id: string }>(sql`
    SELECT p.kind, p.slug, p.id FROM tasks t JOIN workspaces p ON p.id = t.workspace_id
    WHERE t.id = ${copyId}::uuid AND t.assignment_id IS NOT NULL AND t.deleted_at IS NULL`);
  const row = Array.from(rows)[0];
  if (!row) return null;
  // A workspace goes by id, so a copy id never reveals a private workspace's name; its page redirects to the slug.
  return row.kind === "organization" ? `/org/${encodeURIComponent(row.slug ?? row.id)}` : `/workspaces/${row.id}`;
}
