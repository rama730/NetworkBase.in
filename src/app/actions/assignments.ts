'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';
import { profiles, projects, projectSprints, projectWorkflowColumns, taskActivityEvents, taskTeamMembers, tasks } from '@/lib/db/schema';
import { getProjectAccessById, writeBlockedMessage } from '@/lib/data/project-access';
import { createClient } from '@/lib/supabase/server';
import { canStillSubmit, copyState, type AssignmentSettings, type AssignmentTarget, type CopyState } from '@/lib/organizations/assignment-rules';
import { createCopies, createMasterTask, resolveRecipients } from '@/lib/organizations/assignments';
import { shareToOrgGeneral } from '@/lib/organizations/org-chat';
import { notifyAssignmentDueChanged, notifyAssignmentPublished, notifyAssignmentReviewed, notifyAssignmentSubmitted } from '@/lib/organizations/assignment-notify';

// Assignments (report §16, §16.11). Owners and admins create, review and manage; recipients submit.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don't have permission to do this." };

async function viewerId() {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    return user?.id ?? null;
}

/** The viewer and their role in the org that owns `orgId` (null outside it, or when it isn't an org). */
async function orgRole(orgId: string, mode: 'read' | 'write' = 'write') {
    const userId = await viewerId();
    if (!userId) return null;
    const access = await getProjectAccessById(orgId, userId);
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
            await tx.execute(sql`SELECT id FROM ${projects} WHERE id = ${data.projectId} FOR UPDATE`);
            if (data.sprintId) {
                const [sprint] = await tx.select({ status: projectSprints.status }).from(projectSprints).where(and(eq(projectSprints.id, data.sprintId), eq(projectSprints.projectId, data.projectId))).limit(1);
                if (!sprint || (sprint.status !== 'planning' && sprint.status !== 'active')) throw new Error('Pick a planned or active sprint.');
            }
            const [org] = await tx.select({ reviewDefault: projects.taskReviewRequired }).from(projects).where(eq(projects.id, data.projectId)).limit(1);
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
        if (data.publish) await notifyAssignmentPublished(result.masterId, viewer.userId);
        return { success: true, ...result };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Could not create the assignment.' };
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
        return { success: false, error: error instanceof Error ? error.message : 'Could not publish.' };
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
    const [column] = await db.select({ id: projectWorkflowColumns.id }).from(projectWorkflowColumns)
        .where(and(eq(projectWorkflowColumns.projectId, projectId), eq(projectWorkflowColumns.status, status), eq(projectWorkflowColumns.isDefault, true))).limit(1);
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
    if (copy.excusedAt) return { success: false, error: "You're excused from this one." };
    const copyAccess = await getProjectAccessById(copy.projectId, userId);
    if (copyAccess.writeBlocked) return { success: false, error: writeBlockedMessage(copyAccess.writeBlocked) };
    if (!canStillSubmit(master.settings, copy.dueDate)) return { success: false, error: master.settings.closedAt ? 'This assignment is closed.' : 'Late submissions are not accepted.' };
    const { link, text } = parsed.data;
    const type = master.settings.submissionType;
    if (type === 'link' && !link) return { success: false, error: 'Add the link to your work.' };
    if (type === 'text' && !text) return { success: false, error: 'Write your answer first.' };
    if (type === 'file') {
        const [file] = await db.execute<{ id: string }>(sql`
            SELECT id FROM project_nodes WHERE task_id = ${copyId} AND deleted_at IS NULL AND type = 'file'
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
    revalidatePath(`/projects/${copy.projectId}`);
    await notifyAssignmentSubmitted(copyId, userId);
    return { success: true };
}

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
    await reviewOne(copyId, viewer.userId, decision, reason?.trim().slice(0, 1000));
    touch(viewer.slug, loaded.master.projectId);
    return { success: true };
}

export async function approveAllSubmittedAction(masterId: string): Promise<{ success: true; approved: number } | Failure> {
    const ctx = await adminOfMaster(masterId);
    if (!ctx) return DENIED;
    const pending = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, masterId), eq(tasks.reviewStatus, 'pending'), isNull(tasks.deletedAt)));
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
    if (reason !== null) await notifyAssignmentDueChanged(copyId, ctx.viewer.userId, (title) => `You're excused from ${title}`, `${copyId}:excused:${Date.now()}`);
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
    /** Members: their own copy (or their team's). */
    mine: { copyId: string; state: CopyState; late: boolean; teamName: string | null; submission: unknown; projectId: string } | null;
};

const emptyCounts = (): AssignmentRow['counts'] => ({ not_started: 0, in_progress: 0, submitted: 0, returned: 0, done: 0, missing: 0, excused: 0, total: 0 });

/** The Assignments view (report §16.5): admins and guests get counts per master; members get their own copy. */
export async function listAssignmentsAction(orgId: string): Promise<{ success: true; isAdmin: boolean; rows: AssignmentRow[] } | Failure> {
    const viewer = await orgRole(orgId, 'read');
    if (!viewer) return DENIED;
    const masters = await db.select().from(tasks)
        .where(and(eq(tasks.projectId, orgId), eq(tasks.kind, 'assignment'), isNull(tasks.assignmentId), isNull(tasks.deletedAt)))
        .orderBy(asc(tasks.dueDate));
    const visible = masters.filter((m) => viewer.isAdmin || m.assignmentSettings?.publishedAt);
    const ids = visible.map((m) => m.id);
    const copies = ids.length === 0 ? [] : await db.select().from(tasks).where(and(inArray(tasks.assignmentId, ids), isNull(tasks.deletedAt)));
    const myTeams = new Set((await db.select({ taskId: taskTeamMembers.taskId }).from(taskTeamMembers).where(eq(taskTeamMembers.userId, viewer.userId))).map((r) => r.taskId));
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
        return {
            masterId: m.id, title: m.title, dueDate: m.dueDate?.toISOString() ?? null,
            status: !settings.publishedAt ? 'draft' : settings.closedAt ? 'closed' : 'open',
            submissionType: settings.submissionType, reviewRequired: settings.reviewRequired, teams: settings.target.mode === 'teams',
            counts, mine,
        };
    });
    return { success: true, isAdmin: viewer.isAdmin, rows: viewer.isAdmin || viewer.role === 'viewer' ? rows : rows.filter((r) => r.mine) };
}

export type RosterRow = { copyId: string; label: string; members: string[]; state: CopyState; late: boolean; projectId: string; dueDate: string | null; submission: unknown; excusedReason: string | null };

/** The roster for one assignment (report §16.5): admins see names; guests see counts without names. */
export async function readAssignmentRosterAction(masterId: string): Promise<{ success: true; rows: RosterRow[]; counts: AssignmentRow['counts'] } | Failure> {
    const master = await loadMaster(masterId);
    if (!master) return DENIED;
    const viewer = await orgRole(master.projectId, 'read');
    if (!viewer || (!viewer.isAdmin && viewer.role !== 'viewer')) return DENIED;
    const copies = await db.select({
        id: tasks.id, projectId: tasks.projectId, assigneeId: tasks.assigneeId, teamName: tasks.teamName, status: tasks.status, reviewStatus: tasks.reviewStatus,
        dueDate: tasks.dueDate, reviewSubmittedAt: tasks.reviewSubmittedAt, completedAt: tasks.completedAt, excusedAt: tasks.excusedAt, excusedReason: tasks.excusedReason,
        submission: tasks.submission, projectTitle: projects.title, projectParent: projects.parentId,
    }).from(tasks).innerJoin(projects, eq(projects.id, tasks.projectId))
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
    const people = copies.length === 0 ? [] : await db.select({ copyId: taskTeamMembers.taskId, name: profiles.fullName, username: profiles.username })
        .from(taskTeamMembers).innerJoin(profiles, eq(profiles.id, taskTeamMembers.userId))
        .where(inArray(taskTeamMembers.taskId, copies.map((c) => c.id)));
    const assigneeIds = copies.map((c) => c.assigneeId).filter((id): id is string => Boolean(id));
    const names = new Map((assigneeIds.length ? await db.select({ id: profiles.id, name: profiles.fullName, username: profiles.username }).from(profiles).where(inArray(profiles.id, assigneeIds)) : [])
        .map((p) => [p.id, p.name || p.username || 'Member']));
    const rows = copies.map((c, i) => {
        const members = people.filter((p) => p.copyId === c.id).map((p) => p.name || p.username || 'Member');
        // A group copy whose project left the org stays on the roster as "Detached" (report §14.7).
        const label = c.teamName ?? (c.projectParent === master.projectId ? c.projectTitle
            : c.projectId !== master.projectId ? `${c.projectTitle} · Detached` : names.get(c.assigneeId ?? '') ?? 'Member');
        return { copyId: c.id, label, members, ...states[i]!, projectId: c.projectId, dueDate: c.dueDate?.toISOString() ?? null, submission: c.submission, excusedReason: c.excusedReason };
    });
    return { success: true, rows, counts };
}

/** Composer pickers: the org's child projects and its planned or active sprints. */
export async function readAssignmentComposerOptionsAction(orgId: string) {
    const viewer = await orgRole(orgId, 'read');
    if (!viewer?.isAdmin) return { success: false as const, error: DENIED.error };
    const [children, sprints] = await Promise.all([
        db.select({ id: projects.id, title: projects.title }).from(projects).where(and(eq(projects.parentId, orgId), isNull(projects.deletedAt))).orderBy(asc(projects.title)),
        db.select({ id: projectSprints.id, name: projectSprints.name, status: projectSprints.status }).from(projectSprints)
            .where(and(eq(projectSprints.projectId, orgId), inArray(projectSprints.status, ['planning', 'active']))).orderBy(asc(projectSprints.startDate)),
    ]);
    return { success: true as const, children, sprints };
}

export type GroupCopyRow = { copyId: string; title: string; orgTitle: string; dueDate: string | null; state: CopyState; late: boolean; submissionType: string; canSubmit: boolean };

/** A child project's group assignment copies, "From CSE-3A" (report §16.6), with Submit for whoever holds them. */
export async function listProjectGroupCopiesAction(projectId: string): Promise<{ success: true; rows: GroupCopyRow[] } | Failure> {
    const userId = await viewerId();
    const access = await getProjectAccessById(projectId, userId);
    if (!access.project?.parentId || !(access.isOwner || access.isMember || access.isInheritedAdmin)) return { success: true, rows: [] };
    const copies = await db.select({
        id: tasks.id, assigneeId: tasks.assigneeId, status: tasks.status, reviewStatus: tasks.reviewStatus, dueDate: tasks.dueDate,
        reviewSubmittedAt: tasks.reviewSubmittedAt, completedAt: tasks.completedAt, excusedAt: tasks.excusedAt, title: tasks.title,
        settings: sql<AssignmentSettings>`(SELECT m.assignment_settings FROM ${tasks} m WHERE m.id = ${tasks.assignmentId})`,
        orgTitle: sql<string>`(SELECT p.title FROM ${tasks} m JOIN ${projects} p ON p.id = m.project_id WHERE m.id = ${tasks.assignmentId})`,
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
