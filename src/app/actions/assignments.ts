'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';
import { profiles, workspaces, workspaceSprints, workspaceWorkflowColumns, taskActivityEvents, taskTeamMembers, tasks } from '@/lib/db/schema';
import { getWorkspaceAccessById, writeBlockedMessage } from '@/lib/data/workspace-access';
import { createClient } from '@/lib/supabase/server';
import { canStillSubmit, copyState, type AssignmentSettings, type AssignmentTarget, type CopyState } from '@/lib/organizations/assignment-rules';
import { createCopies, createMasterTask, resolveRecipients } from '@/lib/organizations/assignments';
import { shareToOrgGeneral } from '@/lib/organizations/org-chat';
import { postOrgAnnouncement } from '@/lib/organizations/org-updates';
import { ORG_LIMITS } from '@/lib/organizations/config';
import { readOrgWork } from '@/lib/organizations/settings';
import { notifyAssignmentDueChanged, notifyAssignmentPublished, notifyAssignmentReviewed, notifyAssignmentSubmitted } from '@/lib/organizations/assignment-notify';

// Assignments (report §16, §16.11). Owners and admins create, review and manage; recipients submit.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don’t have permission to do this." };

async function viewerId() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
}

/** The viewer and their role in the org that owns `orgId` (null outside it, or when it isn't an org). */
async function orgRole(orgId: string, mode: 'read' | 'write' = 'write') {
    const userId = await viewerId();
    if (!userId) return null;
    const access = await getWorkspaceAccessById(orgId, userId);
    if (mode === 'write' && access.writeBlocked) return null;
    if (access.project?.kind !== 'organization') return null;
    const role = access.isOwner ? 'owner' : access.memberRole;
    return role ? { userId, role, isAdmin: role === 'owner' || role === 'admin', slug: access.project.slug ?? null } : null;
}

const touch = (slug: string | null, id: string) => revalidatePath(`/org/${slug ?? id}`);

const targetSchema: z.ZodType<AssignmentTarget> = z.union([
    z.object({ mode: z.literal('everyone') }),
    z.object({ mode: z.literal('role'), role: z.enum(['member', 'admin']) }),
    z.object({ mode: z.literal('people'), userIds: z.array(z.string().uuid()).min(1).max(2000) }),
    z.object({
        mode: z.literal('teams'),
        teams: z.array(z.object({ name: z.string().trim().min(1).max(60), userIds: z.array(z.string().uuid()).max(100), leadId: z.string().uuid().nullable().optional() })).max(500),
        individuals: z.array(z.string().uuid()).max(2000),
    }),
    z.object({ mode: z.literal('each_child') }),
    z.object({ mode: z.literal('children'), projectIds: z.array(z.string().uuid()).min(1).max(200) }),
]);

const createSchema = z.object({
    projectId: z.string().uuid(),
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(10000).optional(),
    dueDate: z.string().datetime({ offset: true }),
    sprintId: z.string().uuid().nullable().optional(),
    publish: z.boolean(),
    submissionType: z.enum(['none', 'file', 'link', 'text']),
    reviewRequired: z.boolean().optional(),
    lateRule: z.enum(['none', 'until', 'always']),
    lateUntil: z.string().datetime({ offset: true }).nullable().optional(),
    target: targetSchema,
    steps: z.array(z.string().trim().min(1).max(200)).max(50),
    /** Also share in #general (report §25.5), off by default; only when published. */
    shareToGeneral: z.boolean().optional(),
    /** "Also post an announcement" (report §17.2), off by default; only when published. */
    announcement: z.string().trim().max(5000).optional(),
});

/** New assignment: a master, and copies when published (report §16.2). Drafts make no copies. */
export async function createAssignmentAction(input: z.input<typeof createSchema>): Promise<{ success: true; masterId: string; copies: number } | Failure> {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Check the assignment details.' };
    const data = parsed.data;
    const viewer = await orgRole(data.projectId);
    if (!viewer?.isAdmin) return DENIED;
    try {
        const result = await db.transaction(async (tx) => {
            await tx.execute(sql`SELECT id FROM ${workspaces} WHERE id = ${data.projectId} FOR UPDATE`);
            if (data.sprintId) {
                const [sprint] = await tx.select({ status: workspaceSprints.status }).from(workspaceSprints).where(and(eq(workspaceSprints.id, data.sprintId), eq(workspaceSprints.projectId, data.projectId))).limit(1);
                if (!sprint || (sprint.status !== 'planning' && sprint.status !== 'active')) throw new Error('Pick a planned or active sprint.');
            }
            const [org] = await tx.select({ reviewDefault: workspaces.taskReviewRequired }).from(workspaces).where(eq(workspaces.id, data.projectId)).limit(1);
            const recipients = data.publish ? await resolveRecipients(tx, data.projectId, data.target) : [];
            const settings: AssignmentSettings = {
                version: 1,
                submissionType: data.submissionType,
                reviewRequired: data.reviewRequired ?? org?.reviewDefault ?? false,
                lateRule: data.lateRule,
                lateUntil: data.lateRule === 'until' ? data.lateUntil ?? null : null,
                target: data.target,
                publishedAt: data.publish ? new Date().toISOString() : null,
                closedAt: null,
            };
            const masterId = await createMasterTask(tx, {
                orgId: data.projectId, title: data.title, description: data.description || null, dueDate: new Date(data.dueDate),
                sprintId: data.sprintId ?? null, creatorId: viewer.userId, settings, steps: data.steps,
            });
            if (recipients.length > 0) await createCopies(tx, masterId, recipients, viewer.userId);
            return { masterId, copies: recipients.length };
        });
        touch(viewer.slug, data.projectId);
        if (data.publish && data.shareToGeneral) await shareToOrgGeneral(data.projectId, viewer.userId, { kind: 'assignment', ref_id: result.masterId });
        if (data.publish && data.announcement) await postOrgAnnouncement(data.projectId, viewer.userId, data.announcement);
        if (data.publish) await notifyAssignmentPublished(result.masterId, viewer.userId);
        return { success: true, ...result };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Couldn’t create the assignment.' };
    }
}

async function loadMaster(masterId: string) {
    const [master] = await db.select().from(tasks).where(and(eq(tasks.id, masterId), eq(tasks.kind, 'assignment'), isNull(tasks.deletedAt))).limit(1);
    return master?.assignmentSettings ? { ...master, settings: master.assignmentSettings } : null;
}

async function adminOfMaster(masterId: string) {
    const master = await loadMaster(masterId);
    if (!master) return null;
    const viewer = await orgRole(master.projectId);
    return viewer?.isAdmin ? { master, viewer } : null;
}

/** Publish a draft: copies are made now. */
export async function publishAssignmentAction(masterId: string): Promise<{ success: true; copies: number } | Failure> {
    const ctx = await adminOfMaster(masterId);
    if (!ctx) return DENIED;
    if (ctx.master.settings.publishedAt) return { success: false, error: 'Already published.' };
    try {
        const copies = await db.transaction(async (tx) => {
            const recipients = await resolveRecipients(tx, ctx.master.projectId, ctx.master.settings.target);
            await tx.update(tasks).set({ assignmentSettings: { ...ctx.master.settings, publishedAt: new Date().toISOString() }, updatedAt: new Date() }).where(eq(tasks.id, masterId));
            await createCopies(tx, masterId, recipients, ctx.viewer.userId);
            return recipients.length;
        });
        touch(ctx.viewer.slug, ctx.master.projectId);
        await notifyAssignmentPublished(masterId, ctx.viewer.userId);
        return { success: true, copies };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Couldn’t publish.' };
    }
}

const updateSchema = z.object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(10000).nullable().optional(),
    dueDate: z.string().datetime({ offset: true }).optional(),
}).strict();

/** Editing the master updates every copy; a moved due date moves copies that weren't extended (report §16.3). */
export async function updateAssignmentAction(masterId: string, patch: z.input<typeof updateSchema>): Promise<{ success: true } | Failure> {
    const parsed = updateSchema.safeParse(patch);
    if (!parsed.success) return { success: false, error: 'Check the changes.' };
    const ctx = await adminOfMaster(masterId);
    if (!ctx) return DENIED;
    const { title, description, dueDate } = parsed.data;
    const now = new Date();
    await db.transaction(async (tx) => {
        const shared = { ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}), updatedAt: now };
        await tx.update(tasks).set({ ...shared, ...(dueDate ? { dueDate: new Date(dueDate) } : {}) }).where(eq(tasks.id, masterId));
        await tx.update(tasks).set(shared).where(eq(tasks.assignmentId, masterId));
        if (dueDate && ctx.master.dueDate) {
            await tx.update(tasks).set({ dueDate: new Date(dueDate) }).where(and(eq(tasks.assignmentId, masterId), eq(tasks.dueDate, ctx.master.dueDate)));
        }
    });
    touch(ctx.viewer.slug, ctx.master.projectId);
    // A due-date move reaches the people whose copy moved with it (report §16.3, "Due date moved to Mon").
    if (dueDate && ctx.master.dueDate && new Date(dueDate).getTime() !== ctx.master.dueDate.getTime()) {
        const moved = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, masterId), isNull(tasks.deletedAt), eq(tasks.dueDate, new Date(dueDate))));
        const when = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(dueDate));
        for (const { id } of moved) await notifyAssignmentDueChanged(id, ctx.viewer.userId, (t) => `${t}: due date moved to ${when}`, `${id}:moved:${dueDate}`);
    }
    return { success: true };
}

const handedIn = sql`(${tasks.reviewStatus} = 'pending' OR ${tasks.status} = 'done' OR ${tasks.submission} IS NOT NULL)`;

/** Delete only while nobody has submitted; afterwards, Close only (report §16.3). */
export async function deleteAssignmentAction(masterId: string): Promise<{ success: true } | Failure> {
    const ctx = await adminOfMaster(masterId);
    if (!ctx) return DENIED;
    const [submitted] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, masterId), isNull(tasks.deletedAt), handedIn)).limit(1);
    if (submitted) return { success: false, error: 'Someone already handed this in. Close it instead.' };
    const now = new Date();
    await db.update(tasks).set({ deletedAt: now, updatedAt: now }).where(sql`${tasks.id} = ${masterId} OR ${tasks.assignmentId} = ${masterId}`);
    touch(ctx.viewer.slug, ctx.master.projectId);
    return { success: true };
}

/** No more submissions; Missing stays in history. */
export async function closeAssignmentAction(masterId: string): Promise<{ success: true } | Failure> {
    const ctx = await adminOfMaster(masterId);
    if (!ctx) return DENIED;
    await db.update(tasks).set({ assignmentSettings: { ...ctx.master.settings, closedAt: new Date().toISOString() }, updatedAt: new Date() }).where(eq(tasks.id, masterId));
    touch(ctx.viewer.slug, ctx.master.projectId);
    return { success: true };
}

async function loadCopy(copyId: string) {
    const [copy] = await db.select().from(tasks).where(and(eq(tasks.id, copyId), isNull(tasks.deletedAt))).limit(1);
    if (!copy?.assignmentId) return null;
    const master = await loadMaster(copy.assignmentId);
    return master ? { copy, master } : null;
}

async function columnFor(projectId: string, status: 'in_progress' | 'done') {
    const [column] = await db.select({ id: workspaceWorkflowColumns.id }).from(workspaceWorkflowColumns)
        .where(and(eq(workspaceWorkflowColumns.projectId, projectId), eq(workspaceWorkflowColumns.status, status), eq(workspaceWorkflowColumns.isDefault, true))).limit(1);
    return column?.id ?? null;
}

const submitSchema = z.object({ link: z.string().trim().url().max(2000).optional(), text: z.string().trim().max(10000).optional() }).strict();

/** Hand in a copy: its assignee or any teammate (report §16.4, §16.11). Review on → Submitted; off → Done. */
export async function submitAssignmentAction(copyId: string, input: z.input<typeof submitSchema>): Promise<{ success: true } | Failure> {
    const userId = await viewerId();
    const parsed = submitSchema.safeParse(input);
    if (!userId || !parsed.success) return parsed.success ? DENIED : { success: false, error: 'Enter a valid link.' };
    const loaded = await loadCopy(copyId);
    if (!loaded) return DENIED;
    const { copy, master } = loaded;
    const [teammate] = await db.select({ userId: taskTeamMembers.userId }).from(taskTeamMembers).where(and(eq(taskTeamMembers.taskId, copyId), eq(taskTeamMembers.userId, userId))).limit(1);
    if (copy.assigneeId !== userId && !teammate) return DENIED;
    if (copy.excusedAt) return { success: false, error: "You’re excused from this one." };
    const copyAccess = await getWorkspaceAccessById(copy.projectId, userId);
    if (copyAccess.writeBlocked) return { success: false, error: writeBlockedMessage(copyAccess.writeBlocked) };
    if (!canStillSubmit(master.settings, copy.dueDate)) return { success: false, error: master.settings.closedAt ? 'This assignment is closed.' : 'Late submissions are not accepted.' };
    const { link, text } = parsed.data;
    const type = master.settings.submissionType;
    if (type === 'link' && !link) return { success: false, error: 'Add the link to your work.' };
    if (type === 'text' && !text) return { success: false, error: 'Write your answer first.' };
    if (type === 'file') {
        const [file] = await db.execute<{ id: string }>(sql`
            SELECT id FROM workspace_nodes WHERE task_id = ${copyId} AND deleted_at IS NULL AND type = 'file'
            UNION ALL SELECT node_id FROM task_node_links WHERE task_id = ${copyId} LIMIT 1`);
        if (!file) return { success: false, error: 'Attach your file to this task first.' };
    }
    const now = new Date();
    const review = master.settings.reviewRequired;
    await db.transaction(async (tx) => {
        await tx.update(tasks).set({
            status: 'done',
            workflowColumnId: await columnFor(copy.projectId, 'done'),
            reviewStatus: review ? 'pending' : 'none',
            reviewSubmittedAt: now,
            completedAt: review ? null : now,
            completedBy: review ? null : userId,
            completionSource: review ? null : 'direct',
            submission: { link: link ?? null, text: text ?? null, by: userId, at: now.toISOString(), version: (copy.submission?.version ?? 0) + 1 },
            updatedAt: now,
        }).where(eq(tasks.id, copyId));
        await tx.insert(taskActivityEvents).values({
            taskId: copyId, projectId: copy.projectId, sprintId: copy.sprintId, actorId: userId,
            eventType: review ? 'review_submitted' : 'status_changed',
            payload: { version: 1, source: 'assignment_submit', taskTitle: copy.title, taskStatus: 'done', teamName: copy.teamName },
        });
    });
    revalidatePath(`/workspaces/${copy.projectId}`);
    await notifyAssignmentSubmitted(copyId, userId);
    return { success: true };
}

/** Decision 95: the copy's own person, or anyone on its team, never reviews it. */
const ownWork = (copyId: string, userId: string) => sql`(${tasks.assigneeId} = ${userId} OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = ${copyId}::uuid AND tm.user_id = ${userId}))`;

async function reviewOne(copyId: string, reviewerId: string, decision: 'approve' | 'return', reason?: string) {
    const now = new Date();
    const [copy] = await db.select({ projectId: tasks.projectId, sprintId: tasks.sprintId, title: tasks.title }).from(tasks).where(eq(tasks.id, copyId)).limit(1);
    if (!copy) return;
    await db.transaction(async (tx) => {
        await tx.update(tasks).set(decision === 'approve'
            ? { reviewStatus: 'none', status: 'done', completedAt: now, completedBy: reviewerId, completionSource: 'review', updatedAt: now }
            : { reviewStatus: 'rejected', status: 'in_progress', workflowColumnId: await columnFor(copy.projectId, 'in_progress'), completedAt: null, completedBy: null, completionSource: null, updatedAt: now },
        ).where(and(eq(tasks.id, copyId), eq(tasks.reviewStatus, 'pending')));
        await tx.insert(taskActivityEvents).values({
            taskId: copyId, projectId: copy.projectId, sprintId: copy.sprintId, actorId: reviewerId,
            eventType: decision === 'approve' ? 'review_approved' : 'changes_requested',
            payload: { version: 1, source: 'assignment_review', taskTitle: copy.title, reason: reason ?? null },
        });
    });
    await notifyAssignmentReviewed(copyId, reviewerId, decision, reason ?? null);
}

/** Approve, or Return with a reason, one submitted copy (org admins; report §16.4). */
export async function reviewAssignmentCopyAction(copyId: string, decision: 'approve' | 'return', reason?: string): Promise<{ success: true } | Failure> {
    const loaded = await loadCopy(copyId);
    if (!loaded) return DENIED;
    const viewer = await orgRole(loaded.master.projectId);
    if (!viewer?.isAdmin) return DENIED;
    if (loaded.copy.reviewStatus !== 'pending') return { success: false, error: 'Nothing is waiting for review.' };
    if (decision === 'return' && !reason?.trim()) return { success: false, error: 'Say what to change.' };
    const [own] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, copyId), ownWork(copyId, viewer.userId))).limit(1);
    if (own) return { success: false, error: "You can’t review your own work. Ask another admin." };
    await reviewOne(copyId, viewer.userId, decision, reason?.trim().slice(0, 1000));
    touch(viewer.slug, loaded.master.projectId);
    return { success: true };
}

export async function approveAllSubmittedAction(masterId: string): Promise<{ success: true; approved: number } | Failure> {
    const ctx = await adminOfMaster(masterId);
    if (!ctx) return DENIED;
    const pending = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, masterId), eq(tasks.reviewStatus, 'pending'), isNull(tasks.deletedAt), isNull(tasks.excusedAt),
        sql`NOT (${tasks.assigneeId} IS NOT DISTINCT FROM ${ctx.viewer.userId}::uuid OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = ${tasks.id} AND tm.user_id = ${ctx.viewer.userId}::uuid))`));
    for (const { id } of pending) await reviewOne(id, ctx.viewer.userId, 'approve');
    touch(ctx.viewer.slug, ctx.master.projectId);
    return { success: true, approved: pending.length };
}

async function adminOfCopy(copyId: string) {
    const loaded = await loadCopy(copyId);
    if (!loaded) return null;
    const viewer = await orgRole(loaded.master.projectId);
    return viewer?.isAdmin ? { ...loaded, viewer } : null;
}

/** One person's (or team's) own due date. */
export async function extendCopyAction(copyId: string, dueDate: string): Promise<{ success: true } | Failure> {
    if (!z.string().datetime({ offset: true }).safeParse(dueDate).success) return { success: false, error: 'Pick a date.' };
    const ctx = await adminOfCopy(copyId);
    if (!ctx) return DENIED;
    await db.update(tasks).set({ dueDate: new Date(dueDate), updatedAt: new Date() }).where(eq(tasks.id, copyId));
    touch(ctx.viewer.slug, ctx.master.projectId);
    await notifyAssignmentDueChanged(copyId, ctx.viewer.userId, (title) => `Your due date for ${title} changed`, `${copyId}:due:${dueDate}`);
    return { success: true };
}

/** Not required for this person: out of the counts, with a reason; null reason clears it. */
export async function excuseCopyAction(copyId: string, reason: string | null): Promise<{ success: true } | Failure> {
    const ctx = await adminOfCopy(copyId);
    if (!ctx) return DENIED;
    await db.update(tasks).set(reason === null
        ? { excusedAt: null, excusedReason: null, updatedAt: new Date() }
        : { excusedAt: new Date(), excusedReason: reason.trim().slice(0, 500) || 'Excused', updatedAt: new Date() },
    ).where(eq(tasks.id, copyId));
    touch(ctx.viewer.slug, ctx.master.projectId);
    if (reason !== null) await notifyAssignmentDueChanged(copyId, ctx.viewer.userId, (title) => `You’re excused from ${title}`, `${copyId}:excused:${Date.now()}`);
    return { success: true };
}

export type AssignmentRow = {
    masterId: string;
    title: string;
    dueDate: string | null;
    status: 'draft' | 'open' | 'closed';
    submissionType: string;
    reviewRequired: boolean;
    teams: boolean;
    counts: Record<CopyState, number> & { total: number };
    /** Teams mode: people done out of everyone placed ("7 of 11 people", report §16.11). */
    people?: { done: number; total: number };
    /** Members: their own copy (or their team's). */
    mine: { copyId: string; state: CopyState; late: boolean; teamName: string | null; submission: unknown; projectId: string; returnedReason?: string | null } | null;
};

const emptyCounts = (): AssignmentRow['counts'] => ({ not_started: 0, in_progress: 0, submitted: 0, returned: 0, done: 0, missing: 0, excused: 0, total: 0 });

/** The Assignments view (report §16.5): admins and guests get counts per master; members get their own copy. */
export async function listAssignmentsAction(orgId: string): Promise<{ success: true; isAdmin: boolean; rows: AssignmentRow[]; timeZone: string | null } | Failure> {
    const viewer = await orgRole(orgId, 'read');
    if (!viewer) return DENIED;
    const masters = await db.select().from(tasks)
        .where(and(eq(tasks.projectId, orgId), eq(tasks.kind, 'assignment'), isNull(tasks.assignmentId), isNull(tasks.deletedAt)))
        .orderBy(asc(tasks.dueDate));
    const visible = masters.filter((m) => viewer.isAdmin || m.assignmentSettings?.publishedAt);
    const ids = visible.map((m) => m.id);
    const copies = ids.length === 0 ? [] : await db.select().from(tasks).where(and(inArray(tasks.assignmentId, ids), isNull(tasks.deletedAt)));
    const myTeams = new Set((await db.select({ taskId: taskTeamMembers.taskId }).from(taskTeamMembers).where(eq(taskTeamMembers.userId, viewer.userId))).map((r) => r.taskId));
    const teamSizes = new Map(copies.length === 0 ? [] : (await db.select({ taskId: taskTeamMembers.taskId, n: sql<number>`count(*)::int` }).from(taskTeamMembers)
        .where(inArray(taskTeamMembers.taskId, copies.map((c) => c.id))).groupBy(taskTeamMembers.taskId)).map((r) => [r.taskId, r.n]));
    const now = new Date();
    const rows: AssignmentRow[] = visible.map((m) => {
        const settings = m.assignmentSettings!;
        const counts = emptyCounts();
        let mine: AssignmentRow['mine'] = null;
        for (const c of copies.filter((c) => c.assignmentId === m.id)) {
            const s = copyState({ status: c.status, reviewStatus: c.reviewStatus, dueDate: c.dueDate, submittedAt: c.reviewSubmittedAt, completedAt: c.completedAt, excusedAt: c.excusedAt }, now);
            counts[s.state] += 1;
            if (s.state !== 'excused') counts.total += 1;
            if (c.assigneeId === viewer.userId || myTeams.has(c.id)) mine = { copyId: c.id, ...s, teamName: c.teamName, submission: c.submission, projectId: c.projectId };
        }
        const teamPeople = settings.target.mode === 'teams' ? copies.filter((c) => c.assignmentId === m.id).reduce((acc, c) => {
            const size = Math.max(1, teamSizes.get(c.id) ?? 0);
            const s = copyState({ status: c.status, reviewStatus: c.reviewStatus, dueDate: c.dueDate, submittedAt: c.reviewSubmittedAt, completedAt: c.completedAt, excusedAt: c.excusedAt }, now);
            return s.state === 'excused' ? acc : { done: acc.done + (s.state === 'done' ? size : 0), total: acc.total + size };
        }, { done: 0, total: 0 }) : undefined;
        return {
            masterId: m.id, title: m.title, dueDate: m.dueDate?.toISOString() ?? null,
            status: !settings.publishedAt ? 'draft' : settings.closedAt ? 'closed' : 'open',
            submissionType: settings.submissionType, reviewRequired: settings.reviewRequired, teams: settings.target.mode === 'teams',
            counts, mine, ...(teamPeople ? { people: teamPeople } : {}),
        };
    });
    // A member's feedback when work comes back (report §16.5): the latest Return reason on their copy.
    const returned = rows.filter((r) => r.mine?.state === 'returned').map((r) => r.mine!.copyId);
    if (returned.length) {
        const reasons = await db.execute<{ task_id: string; reason: string | null }>(sql`
            SELECT DISTINCT ON (task_id) task_id, payload->>'reason' AS reason FROM task_activity_events
            WHERE task_id IN (${sql.join(returned.map((id) => sql`${id}::uuid`), sql`, `)}) AND event_type = 'changes_requested'
            ORDER BY task_id, created_at DESC`);
        const byCopy = new Map(reasons.map((r) => [r.task_id, r.reason]));
        for (const row of rows) if (row.mine && byCopy.has(row.mine.copyId)) row.mine.returnedReason = byCopy.get(row.mine.copyId) ?? null;
    }
    const [org] = await db.select({ timeZone: workspaces.timeZone }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    return { success: true, isAdmin: viewer.isAdmin, rows: viewer.isAdmin || viewer.role === 'viewer' ? rows : rows.filter((r) => r.mine), timeZone: org?.timeZone ?? null };
}

export type RosterRow = {
    copyId: string; label: string; members: string[]; state: CopyState; late: boolean; projectId: string; dueDate: string | null; submission: unknown; excusedReason: string | null;
    /** Team copies (report §16.11): who is on it (★ lead) and who handed in for the team. */
    people?: Array<{ id: string; name: string; lead: boolean }>; submittedBy?: string | null;
};

/** The roster for one assignment (report §16.5): admins see names; guests see counts without names. */
export async function readAssignmentRosterAction(masterId: string): Promise<{ success: true; rows: RosterRow[]; counts: AssignmentRow['counts'] } | Failure> {
    const master = await loadMaster(masterId);
    if (!master) return DENIED;
    const viewer = await orgRole(master.projectId, 'read');
    if (!viewer || (!viewer.isAdmin && viewer.role !== 'viewer')) return DENIED;
    const copies = await db.select({
        id: tasks.id, projectId: tasks.projectId, assigneeId: tasks.assigneeId, teamName: tasks.teamName, status: tasks.status, reviewStatus: tasks.reviewStatus,
        dueDate: tasks.dueDate, reviewSubmittedAt: tasks.reviewSubmittedAt, completedAt: tasks.completedAt, excusedAt: tasks.excusedAt, excusedReason: tasks.excusedReason,
        submission: tasks.submission, projectTitle: workspaces.title, projectParent: workspaces.parentId,
    }).from(tasks).innerJoin(workspaces, eq(workspaces.id, tasks.projectId))
        .where(and(eq(tasks.assignmentId, masterId), isNull(tasks.deletedAt)));
    const counts = emptyCounts();
    const now = new Date();
    const states = copies.map((c) => {
        const s = copyState({ status: c.status, reviewStatus: c.reviewStatus, dueDate: c.dueDate, submittedAt: c.reviewSubmittedAt, completedAt: c.completedAt, excusedAt: c.excusedAt }, now);
        counts[s.state] += 1;
        if (s.state !== 'excused') counts.total += 1;
        return s;
    });
    if (!viewer.isAdmin) return { success: true, rows: [], counts };
    const people = copies.length === 0 ? [] : await db.select({ copyId: taskTeamMembers.taskId, userId: taskTeamMembers.userId, isLead: taskTeamMembers.isLead, name: profiles.fullName, username: profiles.username })
        .from(taskTeamMembers).innerJoin(profiles, eq(profiles.id, taskTeamMembers.userId))
        .where(inArray(taskTeamMembers.taskId, copies.map((c) => c.id)));
    const submitterIds = copies.map((c) => (c.submission as { by?: string } | null)?.by).filter((id): id is string => Boolean(id));
    const assigneeIds = [...copies.map((c) => c.assigneeId).filter((id): id is string => Boolean(id)), ...submitterIds];
    const names = new Map((assigneeIds.length ? await db.select({ id: profiles.id, name: profiles.fullName, username: profiles.username }).from(profiles).where(inArray(profiles.id, assigneeIds)) : [])
        .map((p) => [p.id, p.name || p.username || 'Member']));
    const rows = copies.map((c, i) => {
        const members = people.filter((p) => p.copyId === c.id).map((p) => p.name || p.username || 'Member');
        // A group copy whose project left the org stays on the roster as "Detached" (report §14.7).
        const label = c.teamName ?? (c.projectParent === master.projectId ? c.projectTitle
            : c.projectId !== master.projectId ? `${c.projectTitle} · Detached` : names.get(c.assigneeId ?? '') ?? 'Member');
        const team = people.filter((p) => p.copyId === c.id).map((p) => ({ id: p.userId, name: p.name || p.username || 'Member', lead: p.isLead }));
        const by = (c.submission as { by?: string } | null)?.by;
        return { copyId: c.id, label, members, ...states[i]!, projectId: c.projectId, dueDate: c.dueDate?.toISOString() ?? null, submission: c.submission, excusedReason: c.excusedReason,
            ...(c.teamName ? { people: team, submittedBy: by ? names.get(by) ?? null : null } : {}) };
    });
    return { success: true, rows, counts };
}

/** Composer pickers: the org's child projects and its planned or active sprints. */
export async function readAssignmentComposerOptionsAction(orgId: string) {
    const viewer = await orgRole(orgId, 'read');
    if (!viewer?.isAdmin) return { success: false as const, error: DENIED.error };
    const [children, sprints, teamAssignments, [org]] = await Promise.all([
        db.select({ id: workspaces.id, title: workspaces.title }).from(workspaces).where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt))).orderBy(asc(workspaces.title)),
        db.select({ id: workspaceSprints.id, name: workspaceSprints.name, status: workspaceSprints.status }).from(workspaceSprints)
            .where(and(eq(workspaceSprints.projectId, orgId), inArray(workspaceSprints.status, ['planning', 'active']))).orderBy(asc(workspaceSprints.startDate)),
        // "Copy teams from" (report §16.11): earlier team assignments, newest first.
        db.select({ id: tasks.id, title: tasks.title }).from(tasks)
            .where(and(eq(tasks.projectId, orgId), eq(tasks.kind, 'assignment'), isNull(tasks.deletedAt), sql`${tasks.assignmentSettings}->'target'->>'mode' = 'teams'`))
            .orderBy(sql`${tasks.createdAt} DESC`).limit(30),
        db.select({ settings: workspaces.orgSettings, type: workspaces.orgType }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1),
    ]);
    // Settings → Work defaults (report §21.2 #5); the composer can still change them per assignment.
    const work = readOrgWork(org?.settings, org?.type);
    return { success: true as const, children, sprints, teamAssignments, defaults: { reviewRequired: work.reviewRequired, lateRule: work.lateRule } };
}

export type GroupCopyRow = { copyId: string; title: string; orgTitle: string; dueDate: string | null; state: CopyState; late: boolean; submissionType: string; canSubmit: boolean };

/** A child project's group assignment copies, "From CSE-3A" (report §16.6), with Submit for whoever holds them. */
export async function listWorkspaceGroupCopiesAction(projectId: string): Promise<{ success: true; rows: GroupCopyRow[] } | Failure> {
    const userId = await viewerId();
    const access = await getWorkspaceAccessById(projectId, userId);
    if (!access.project?.parentId || !(access.isOwner || access.isMember || access.isInheritedAdmin)) return { success: true, rows: [] };
    const copies = await db.select({
        id: tasks.id, assigneeId: tasks.assigneeId, status: tasks.status, reviewStatus: tasks.reviewStatus, dueDate: tasks.dueDate,
        reviewSubmittedAt: tasks.reviewSubmittedAt, completedAt: tasks.completedAt, excusedAt: tasks.excusedAt, title: tasks.title,
        settings: sql<AssignmentSettings>`(SELECT m.assignment_settings FROM ${tasks} m WHERE m.id = ${tasks.assignmentId})`,
        orgTitle: sql<string>`(SELECT p.title FROM ${tasks} m JOIN ${workspaces} p ON p.id = m.workspace_id WHERE m.id = ${tasks.assignmentId})`,
    }).from(tasks).where(and(eq(tasks.projectId, projectId), sql`${tasks.assignmentId} IS NOT NULL`, isNull(tasks.deletedAt))).orderBy(asc(tasks.dueDate));
    const now = new Date();
    return {
        success: true,
        rows: copies.map((c) => ({
            copyId: c.id, title: c.title, orgTitle: c.orgTitle, dueDate: c.dueDate?.toISOString() ?? null,
            ...copyState({ status: c.status, reviewStatus: c.reviewStatus, dueDate: c.dueDate, submittedAt: c.reviewSubmittedAt, completedAt: c.completedAt, excusedAt: c.excusedAt }, now),
            submissionType: c.settings?.submissionType ?? 'none',
            canSubmit: c.assigneeId === userId,
        })),
    };
}

// --- After publishing (report §16.3, §16.11) ---

/** A step added after publish reaches every copy; ticks already made stay. */
export async function addAssignmentStepAction(masterId: string, title: string): Promise<{ success: true } | Failure> {
    const ctx = await adminOfMaster(masterId);
    const step = title.trim().slice(0, 200);
    if (!ctx) return DENIED;
    if (!step) return { success: false, error: 'Write the step first.' };
    await db.execute(sql`
        INSERT INTO task_subtasks (task_id, title, position)
        SELECT t.id, ${step}, coalesce((SELECT max(s.position) + 1 FROM task_subtasks s WHERE s.task_id = t.id), 0)
        FROM tasks t WHERE (t.id = ${masterId} OR t.assignment_id = ${masterId}) AND t.deleted_at IS NULL`);
    touch(ctx.viewer.slug, ctx.master.projectId);
    return { success: true };
}

/** Remind one copy, or everyone not done (report §16.3); a person is reminded at most once per 12 hours. */
export async function remindCopiesAction(masterId: string, copyIds?: string[]): Promise<{ success: true; reminded: number } | Failure> {
    const ctx = await adminOfMaster(masterId);
    if (!ctx) return DENIED;
    const open = await db.select({ id: tasks.id }).from(tasks).where(and(
        eq(tasks.assignmentId, masterId), isNull(tasks.deletedAt), isNull(tasks.excusedAt), sql`NOT ${handedIn}`,
        ...(copyIds?.length ? [inArray(tasks.id, copyIds.slice(0, 2000))] : []),
    ));
    const window = Math.floor(Date.now() / (ORG_LIMITS.remindSamePersonHours * 3_600_000));
    const due = ctx.master.dueDate ? new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric' }).format(ctx.master.dueDate) : null;
    for (const { id } of open) {
        await notifyAssignmentDueChanged(id, ctx.viewer.userId, (t) => `Reminder: ${t}${due ? ` is due ${due}` : ' is waiting for you'}`, `remind:${id}:${window}`);
    }
    return { success: true, reminded: open.length };
}

/** Teams of an earlier teams assignment, for "Copy teams from" (report §16.11). */
export async function readAssignmentTeamsAction(masterId: string): Promise<{ success: true; teams: Array<{ name: string; userIds: string[]; leadId: string | null }> } | Failure> {
    const ctx = await adminOfMaster(masterId);
    if (!ctx) return DENIED;
    const rows = await db.select({ copyId: tasks.id, name: tasks.teamName, userId: taskTeamMembers.userId, isLead: taskTeamMembers.isLead }).from(tasks)
        .innerJoin(taskTeamMembers, eq(taskTeamMembers.taskId, tasks.id))
        .where(and(eq(tasks.assignmentId, masterId), isNull(tasks.deletedAt), sql`${tasks.teamName} IS NOT NULL`));
    const teams = new Map<string, { name: string; userIds: string[]; leadId: string | null }>();
    for (const r of rows) {
        const team = teams.get(r.copyId) ?? { name: r.name ?? 'Team', userIds: [], leadId: null };
        team.userIds.push(r.userId);
        if (r.isLead) team.leadId = r.userId;
        teams.set(r.copyId, team);
    }
    return { success: true, teams: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

/**
 * Changing teams after publish (report §16.11): move a person into another team copy, out to their own copy, or
 * (a late joiner) into a team at all. Only while neither team has handed in. The person hears where they are now.
 */
export async function moveTeamMemberAction(masterId: string, userId: string, toCopyId: string | null): Promise<{ success: true } | Failure> {
    const ctx = await adminOfMaster(masterId);
    if (!ctx) return DENIED;
    if (ctx.master.settings.target.mode !== 'teams') return { success: false, error: 'Only team assignments have teams.' };
    let title = '';
    try {
        title = await db.transaction(async (tx) => {
            const copies = await tx.select().from(tasks).where(and(eq(tasks.assignmentId, masterId), isNull(tasks.deletedAt))).for('update');
            const members = await tx.select().from(taskTeamMembers).where(inArray(taskTeamMembers.taskId, copies.map((c) => c.id)));
            const locked = (c: (typeof copies)[number]) => c.reviewStatus === 'pending' || c.status === 'done' || c.submission !== null;
            const from = copies.find((c) => members.some((m) => m.taskId === c.id && m.userId === userId) || (c.assigneeId === userId && !c.teamName));
            const to = toCopyId ? copies.find((c) => c.id === toCopyId && c.teamName) : null;
            if (toCopyId && !to) throw new Error('That team is gone.');
            if (from && to && from.id === to.id) return to.teamName ?? '';
            if ((from && locked(from)) || (to && locked(to))) throw new Error('That team already submitted, so it is locked.');
            if (from?.teamName) {
                await tx.delete(taskTeamMembers).where(and(eq(taskTeamMembers.taskId, from.id), eq(taskTeamMembers.userId, userId)));
                const left = members.filter((m) => m.taskId === from.id && m.userId !== userId);
                if (left.length === 0) await tx.update(tasks).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, from.id));
                else if (from.assigneeId === userId) {
                    await tx.update(taskTeamMembers).set({ isLead: true }).where(and(eq(taskTeamMembers.taskId, from.id), eq(taskTeamMembers.userId, left[0]!.userId)));
                    await tx.update(tasks).set({ assigneeId: left[0]!.userId, updatedAt: new Date() }).where(eq(tasks.id, from.id));
                }
            } else if (from) {
                await tx.update(tasks).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(tasks.id, from.id));
            }
            if (to) {
                await tx.insert(taskTeamMembers).values({ taskId: to.id, userId, isLead: false }).onConflictDoNothing();
                return to.teamName ?? 'a team';
            }
            await createCopies(tx, masterId, [{ projectId: ctx.master.projectId, assigneeId: userId }], ctx.viewer.userId);
            return '';
        });
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Couldn’t move them.' };
    }
    touch(ctx.viewer.slug, ctx.master.projectId);
    const [copy] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, masterId), isNull(tasks.deletedAt),
        toCopyId ? eq(tasks.id, toCopyId) : eq(tasks.assigneeId, userId))).limit(1);
    if (copy) await notifyAssignmentDueChanged(copy.id, ctx.viewer.userId, (t) => (title ? `You moved to ${title} for ${t}` : `You now have your own assignment of ${t}`), `team-move:${masterId}:${userId}:${Date.now()}`);
    return { success: true };
}

/** Excuse one person on a team (report §16.11): the team carries on; that person leaves the counts with an excused copy. */
export async function excuseTeamMemberAction(copyId: string, userId: string, reason: string): Promise<{ success: true } | Failure> {
    const ctx = await adminOfCopy(copyId);
    if (!ctx) return DENIED;
    if (!ctx.copy.teamName) return excuseCopyAction(copyId, reason);
    const [member] = await db.select({ userId: taskTeamMembers.userId }).from(taskTeamMembers).where(and(eq(taskTeamMembers.taskId, copyId), eq(taskTeamMembers.userId, userId))).limit(1);
    if (!member) return { success: false, error: "They’re not on this team." };
    const moved = await moveTeamMemberAction(ctx.master.id, userId, null);
    if (!moved.success) return moved;
    const [own] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, ctx.master.id), eq(tasks.assigneeId, userId), isNull(tasks.teamName), isNull(tasks.deletedAt))).limit(1);
    return own ? excuseCopyAction(own.id, reason) : { success: true };
}

export type ReviewQueueRow = { copyId: string; masterId: string; title: string; who: string; submittedBy: string | null; submittedAt: string; late: boolean };

/** The marking inbox across every assignment (report §16.4–16.5): oldest first, with who handed in. */
export async function readReviewQueueAction(orgId: string): Promise<{ success: true; rows: ReviewQueueRow[] } | Failure> {
    const viewer = await orgRole(orgId, 'read');
    if (!viewer?.isAdmin) return DENIED;
    const rows = await db.execute<{ copy_id: string; master_id: string; title: string; team_name: string | null; assignee: string | null; project: string | null; submitted_by: string | null; submitted_at: string; due_date: string | null }>(sql`
        SELECT c.id AS copy_id, m.id AS master_id, m.title, c.team_name,
               (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = c.assignee_id) AS assignee,
               (SELECT pr.title FROM workspaces pr WHERE pr.id = c.workspace_id AND pr.id <> m.workspace_id) AS project,
               (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = (c.submission->>'by')::uuid) AS submitted_by,
               c.review_submitted_at::text AS submitted_at, c.due_date::text AS due_date
        FROM tasks c JOIN tasks m ON m.id = c.assignment_id
        WHERE m.workspace_id = ${orgId} AND m.deleted_at IS NULL AND c.deleted_at IS NULL AND c.excused_at IS NULL AND c.review_status = 'pending'
        ORDER BY c.review_submitted_at ASC NULLS LAST LIMIT 200`);
    return { success: true, rows: rows.map((r) => ({
        copyId: r.copy_id, masterId: r.master_id, title: r.title,
        who: r.team_name ?? r.project ?? r.assignee ?? 'Member', submittedBy: r.team_name ? r.submitted_by : null,
        submittedAt: r.submitted_at, late: Boolean(r.due_date && new Date(r.submitted_at) > new Date(r.due_date)),
    })) };
}

export type OrgTabBadges = { tasks: number; updates: boolean; members: number };

/** Org tab badges (report §18.3): admins see submissions to review and join requests; members see work due
 *  within 2 days. Everyone gets a dot for announcements they haven't seen. */
export async function readOrgTabBadgesAction(orgId: string): Promise<OrgTabBadges | null> {
    const viewer = await orgRole(orgId, 'read');
    if (!viewer) return null;
    const [row] = await db.execute<{ tasks: number; updates: boolean; members: number }>(sql`
        SELECT
          ${viewer.isAdmin
            ? sql`(SELECT count(*)::int FROM tasks c JOIN tasks m ON m.id = c.assignment_id
                   WHERE m.workspace_id = ${orgId} AND m.deleted_at IS NULL AND c.deleted_at IS NULL AND c.excused_at IS NULL AND c.review_status = 'pending')`
            : sql`(SELECT count(DISTINCT c.id)::int FROM tasks c JOIN tasks m ON m.id = c.assignment_id
                   LEFT JOIN task_team_members tm ON tm.task_id = c.id AND tm.user_id = ${viewer.userId}
                   WHERE m.workspace_id = ${orgId} AND m.deleted_at IS NULL AND m.assignment_settings->>'closedAt' IS NULL
                     AND c.deleted_at IS NULL AND c.excused_at IS NULL AND (c.assignee_id = ${viewer.userId} OR tm.user_id IS NOT NULL)
                     AND c.due_date BETWEEN now() AND now() + interval '2 days'
                     AND NOT (c.review_status IN ('pending', 'approved') OR c.status = 'done' OR c.submission IS NOT NULL))`} AS tasks,
          EXISTS (SELECT 1 FROM workspace_updates u
                  WHERE u.workspace_id = ${orgId} AND u.update_type = 'announcement' AND u.deleted_at IS NULL AND u.author_id IS DISTINCT FROM ${viewer.userId}
                    AND u.created_at > coalesce((SELECT last_seen_updates_at FROM workspace_members WHERE workspace_id = ${orgId} AND user_id = ${viewer.userId}), '-infinity'::timestamptz)
                    AND (${viewer.isAdmin} OR u.audience = '{}'::jsonb OR u.audience->'roles' @> to_jsonb(${viewer.role}::text)
                      OR EXISTS (SELECT 1 FROM workspace_members c JOIN workspaces p ON p.id = c.workspace_id
                                 WHERE c.user_id = ${viewer.userId} AND p.parent_id = ${orgId} AND u.audience->'projectIds' @> to_jsonb(p.id::text)))) AS updates,
          ${viewer.isAdmin
            ? sql`(SELECT count(*)::int FROM role_applications WHERE workspace_id = ${orgId} AND role_id IS NULL AND status = 'pending')`
            : sql`0`} AS members`);
    return row ? { tasks: row.tasks, updates: row.updates, members: row.members } : null;
}
