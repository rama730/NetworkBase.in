'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { logger } from '@/lib/logger';
import { z } from 'zod';

import { db } from '@/lib/db';
import { assignmentSubmissions, profiles, taskNodeLinks, workspaceMembers, workspaceNodes, workspaces, workspaceSprints, workspaceWorkflowColumns, taskActivityEvents, taskTeamMembers, tasks } from '@/lib/db/schema';
import { getWorkspaceAccessById, writeBlockedMessage } from '@/lib/data/workspace-access';
import { createClient } from '@/lib/supabase/server';
import { assignmentHref, canStillSubmit, copyState, splitIntoTeams, webLink, LATE_AFTER_DEFAULT_MINUTES, lateAfterMs, lateRuleBlock, lateWorkLabel, type AssignmentSettings, type AssignmentTarget, type CopyState, weeklyRepeats } from '@/lib/organizations/assignment-rules';
import { createCopies, createMasterTask, handedInSql, PeopleLeftError, resolveRecipients } from '@/lib/organizations/assignments';
import { publishMaster } from '@/lib/organizations/assignment-publish';
import { orgFileAccessSql } from '@/lib/files/internal-helpers';
import { shareToOrgGeneral } from '@/lib/organizations/org-chat';
import { postOrgAnnouncement } from '@/lib/organizations/org-updates';
import { ORG_LIMITS } from '@/lib/organizations/config';
import { readOrgWork } from '@/lib/organizations/settings';
import { orgCan, orgGrant, orgRoleOf, type OrgAction } from '@/lib/organizations/permissions';
import { assignmentPeopleOf, notifyAssignmentDueChanged, notifyAssignmentPublished, notifyNewCopies, notifyAssignmentRemoved, notifyAssignmentReopened, notifyAssignmentReviewed, notifyAssignmentSubmitted, notifyTeamMoved } from '@/lib/organizations/assignment-notify';
import { notifyOrg, orgHref, orgLabel, remindedRecently } from '@/lib/organizations/notify';
import { taskReviewSnapshot } from '@/lib/workspaces/task-review-snapshot';
import { ASSIGNMENT_STATE_LABELS } from '@/lib/copy/terms';

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
        teams: z.array(z.object({ name: z.string().trim().min(1).max(60), userIds: z.array(z.string().uuid()).max(100), leadId: z.string().uuid().nullable().optional() })).max(ORG_LIMITS.teamsPerAssignment, `An assignment can go to up to ${ORG_LIMITS.teamsPerAssignment} teams.`),
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
    /** Late after (report §45.3, decision 171): minutes past the due time, 0 to 60. */
    lateAfterMinutes: z.number().int().min(0, 'Late after is 0 to 60 minutes.').max(60, 'Late after is 0 to 60 minutes.').optional(),
    /** Publish timing for a draft (decision 125): On a date, or When the sprint starts. */
    schedule: z.union([z.object({ at: z.string().datetime({ offset: true }) }), z.object({ sprintStart: z.literal(true) })]).nullable().optional(),
    /** Materials (decision 128): this organization's files, read only on every copy. */
    materials: z.array(z.string().uuid()).max(20, 'Up to 20 materials.').optional(),
    /** Repeat weekly until (report §33.5): one draft per later week, each checked before it's published. */
    repeatWeeklyUntil: z.string().datetime({ offset: true }).nullable().optional(),
});

const scheduleSchema = z.union([z.object({ at: z.string().datetime({ offset: true }) }), z.object({ sprintStart: z.literal(true) })]);

/** The settings a schedule writes, or why it can't (a time in the past, or a sprint to wait for). */
function scheduleFields(schedule: z.infer<typeof scheduleSchema> | null | undefined, sprintId: string | null) {
    if (!schedule) return { fields: { publishAt: null, publishOnSprintStart: false } };
    if ('at' in schedule) {
        if (new Date(schedule.at).getTime() <= Date.now()) return { error: 'Pick a time after now, or publish now.' };
        return { fields: { publishAt: new Date(schedule.at).toISOString(), publishOnSprintStart: false } };
    }
    if (!sprintId) return { error: 'Pick the sprint it starts with.' };
    return { fields: { publishAt: null, publishOnSprintStart: true } };
}

/** New assignment: a master, and copies when published (report §16.2). Drafts make no copies. */
export async function createAssignmentAction(input: z.input<typeof createSchema>): Promise<{ success: true; masterId: string; copies: number; drafts?: number } | Failure> {
    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: parsed.error.issues[0]?.message ?? 'Check the assignment details.' };
    const data = parsed.data;
    const viewer = await orgRole(data.projectId);
    if (!viewer || !orgCan(orgRoleOf(viewer.role), 'create_assignments')) return DENIED;
    const lateBlock = lateRuleBlock(data, new Date(data.dueDate));
    if (lateBlock) return { success: false, error: lateBlock };
    const scheduled = data.publish ? { fields: {} } : scheduleFields(data.schedule, data.sprintId ?? null);
    if ('error' in scheduled) return { success: false, error: scheduled.error! };
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
                lateAfterMinutes: data.lateAfterMinutes ?? LATE_AFTER_DEFAULT_MINUTES,
                ...scheduled.fields,
            };
            const masterId = await createMasterTask(tx, {
                orgId: data.projectId, title: data.title, description: data.description || null, dueDate: new Date(data.dueDate),
                sprintId: data.sprintId ?? null, creatorId: viewer.userId, settings, steps: data.steps,
            });
            if (data.materials?.length) {
                // Only this organization's own files, never task files (decision 128).
                const files = await tx.select({ id: workspaceNodes.id }).from(workspaceNodes).where(and(inArray(workspaceNodes.id, data.materials), eq(workspaceNodes.projectId, data.projectId),
                    eq(workspaceNodes.type, 'file'), isNull(workspaceNodes.deletedAt), isNull(workspaceNodes.taskId)));
                if (files.length) await tx.insert(taskNodeLinks).values(files.map((f) => ({ taskId: masterId, nodeId: f.id, createdBy: viewer.userId }))).onConflictDoNothing();
            }
            if (recipients.length > 0) await createCopies(tx, masterId, recipients, viewer.userId);
            // Repeat weekly (report §33.5): later weeks wait as drafts with their own due dates, to be checked first.
            const repeats = data.repeatWeeklyUntil ? weeklyRepeats(data.title, new Date(data.dueDate), new Date(data.repeatWeeklyUntil)) : [];
            for (const week of repeats) {
                const draftId = await createMasterTask(tx, {
                    orgId: data.projectId, title: week.title, description: data.description || null, dueDate: week.dueDate, sprintId: null, creatorId: viewer.userId,
                    settings: { ...settings, publishedAt: null, publishAt: null, publishOnSprintStart: false }, steps: data.steps,
                });
                if (data.materials?.length) {
                    const files = await tx.select({ id: taskNodeLinks.nodeId }).from(taskNodeLinks).where(eq(taskNodeLinks.taskId, masterId));
                    if (files.length) await tx.insert(taskNodeLinks).values(files.map((f) => ({ taskId: draftId, nodeId: f.id, createdBy: viewer.userId }))).onConflictDoNothing();
                }
            }
            return { masterId, copies: recipients.length, drafts: repeats.length };
        });
        touch(viewer.slug, data.projectId);
        // Saved is saved: a failed share, announcement or notice is logged, never reported as a failed publish,
        // or a retry would make a second assignment with a second set of copies (report §42.2 smaller bug 6).
        const afterSave = async (step: string, run: () => Promise<unknown>) => {
            try { await run(); } catch (error) { logger.warn('assignments.after_save_failed', { module: 'assignments', step, masterId: result.masterId, error: error instanceof Error ? error.message : String(error) }); }
        };
        if (data.publish && data.shareToGeneral) await afterSave('share', () => shareToOrgGeneral(data.projectId, viewer.userId, { kind: 'assignment', ref_id: result.masterId }));
        if (data.publish && data.announcement) await afterSave('announcement', () => postOrgAnnouncement(data.projectId, viewer.userId, data.announcement!));
        if (data.publish) await afterSave('notify', () => notifyAssignmentPublished(result.masterId, viewer.userId));
        return { success: true, ...result };
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Couldn’t create the assignment.' };
    }
}

async function loadMaster(masterId: string) {
    const [master] = await db.select().from(tasks).where(and(eq(tasks.id, masterId), eq(tasks.kind, 'assignment'), isNull(tasks.deletedAt))).limit(1);
    return master?.assignmentSettings ? { ...master, settings: master.assignmentSettings } : null;
}

/** The main assignment, when the viewer's row in the permissions table allows this action (decisions 33, 109). */
async function adminOfMaster(masterId: string, action: OrgAction) {
    const master = await loadMaster(masterId);
    if (!master) return null;
    const viewer = await orgRole(master.projectId);
    return viewer && orgCan(orgRoleOf(viewer.role), action) ? { master, viewer } : null;
}

/** Publish a draft: copies are made now. */
export async function publishAssignmentAction(masterId: string, options: { dropMissing?: boolean } = {}): Promise<{ success: true; copies: number } | (Failure & { left?: number })> {
    const ctx = await adminOfMaster(masterId, 'create_assignments');
    if (!ctx) return DENIED;
    if (ctx.master.settings.publishedAt) return { success: false, error: 'Already published.' };
    try {
        const copies = await publishMaster(masterId, ctx.viewer.userId, options);
        if (copies === null) return { success: false, error: 'Already published.' };
        touch(ctx.viewer.slug, ctx.master.projectId);
        return { success: true, copies };
    } catch (error) {
        if (error instanceof PeopleLeftError) return { success: false, error: error.message, left: error.left };
        return { success: false, error: error instanceof Error ? error.message : 'Couldn’t publish.' };
    }
}

/** Schedule a draft, or Back to draft with null (decision 125). */
export async function scheduleAssignmentAction(masterId: string, schedule: z.input<typeof scheduleSchema> | null): Promise<{ success: true } | Failure> {
    const parsed = schedule === null ? { success: true as const, data: null } : scheduleSchema.safeParse(schedule);
    if (!parsed.success) return { success: false, error: 'Pick when to publish.' };
    const ctx = await adminOfMaster(masterId, 'create_assignments');
    if (!ctx) return DENIED;
    if (ctx.master.settings.publishedAt) return { success: false, error: 'Already published.' };
    const fields = scheduleFields(parsed.data, ctx.master.sprintId);
    if ('error' in fields) return { success: false, error: fields.error! };
    await db.update(tasks).set({ assignmentSettings: { ...ctx.master.settings, ...fields.fields }, updatedAt: new Date() }).where(eq(tasks.id, masterId));
    touch(ctx.viewer.slug, ctx.master.projectId);
    return { success: true };
}

export type HandIn = {
    holder: boolean; submissionType: string; reviewRequired: boolean; dueDate: string | null; lateLabel: string | null; from: string;
    state: CopyState; late: boolean; canSubmit: boolean; closed: boolean; approved: boolean; excusedReason: string | null;
    returned: { reason: string | null; fixBy: string | null } | null;
    latest: { version: number; at: string; by: string; link: string | null; text: string | null; note: string | null; files: Array<{ nodeId: string; name: string }> } | null;
    files: Array<{ nodeId: string; name: string }>;
    materials: Array<{ nodeId: string; name: string }>;
};

/**
 * The task panel's Hand in section (report §34.4, decision 85): what's asked, the state with its reason or date,
 * the latest version handed in, and whether Submit is open. Its people get the form; org admins read it.
 */
export async function readHandInAction(copyId: string): Promise<{ success: true; handIn: HandIn } | Failure> {
    const userId = await viewerId();
    const loaded = await loadCopy(copyId);
    if (!userId || !loaded) return DENIED;
    const { copy, master } = loaded;
    const [teammate] = await db.select({ userId: taskTeamMembers.userId }).from(taskTeamMembers).where(and(eq(taskTeamMembers.taskId, copyId), eq(taskTeamMembers.userId, userId))).limit(1);
    const holder = copy.assigneeId === userId || Boolean(teammate);
    const orgAccess = await getWorkspaceAccessById(master.projectId, userId);
    if (!holder && !(orgAccess.isOwner || orgAccess.memberRole === 'admin')) return DENIED;
    const now = new Date();
    const s = copyState({ status: copy.status, reviewStatus: copy.reviewStatus, dueDate: copy.dueDate, submittedAt: copy.reviewSubmittedAt, completedAt: copy.completedAt, excusedAt: copy.excusedAt }, now, lateAfterMs(master.settings));
    const approved = copy.status === 'done' && copy.completionSource === 'review';
    const [latest] = await db.select().from(assignmentSubmissions).where(eq(assignmentSubmissions.copyId, copyId)).orderBy(desc(assignmentSubmissions.version)).limit(1);
    const [returnedEvent] = s.state === 'returned' ? await db.execute<{ reason: string | null; fix_by: string | null }>(sql`
        SELECT payload->>'reason' AS reason, payload->>'fixBy' AS fix_by FROM task_activity_events WHERE task_id = ${copyId} AND event_type = 'changes_requested' ORDER BY created_at DESC LIMIT 1`) : [];
    const files = await db.execute<{ node_id: string; name: string }>(sql`
        SELECT n.id AS node_id, n.name FROM workspace_nodes n WHERE n.deleted_at IS NULL AND n.type = 'file' AND (n.task_id = ${copyId} OR n.id IN (SELECT node_id FROM task_node_links WHERE task_id = ${copyId})) ORDER BY n.name`);
    const materials = await readAssignmentMaterialsAction(copyId);
    const byName = latest?.submittedBy ? (await db.select({ name: sql<string>`coalesce(${profiles.fullName}, ${profiles.username}, 'Someone')` }).from(profiles).where(eq(profiles.id, latest.submittedBy)).limit(1))[0]?.name : null;
    const [org] = await db.select({ title: workspaces.title }).from(workspaces).where(eq(workspaces.id, master.projectId)).limit(1);
    // Submit is open per the same rules the server checks on Submit.
    const replaceLocked = approved || (copy.status === 'done' && copy.reviewStatus === 'none' && copy.dueDate && now.getTime() > copy.dueDate.getTime() + lateAfterMs(master.settings) && !(copy.submitUntil && now <= copy.submitUntil));
    const canSubmit = holder && !copy.excusedAt && !replaceLocked && canStillSubmit(master.settings, copy.dueDate, now, copy.submitUntil);
    return { success: true, handIn: {
        holder, submissionType: master.settings.submissionType, reviewRequired: master.settings.reviewRequired, dueDate: copy.dueDate?.toISOString() ?? null,
        lateLabel: lateWorkLabel(master.settings), from: org?.title ?? 'the organization', state: s.state, late: s.late, canSubmit, closed: Boolean(master.settings.closedAt), approved,
        excusedReason: copy.excusedReason, returned: s.state === 'returned' ? { reason: returnedEvent?.reason ?? null, fixBy: returnedEvent?.fix_by ?? copy.submitUntil?.toISOString() ?? null } : null,
        latest: latest ? { version: latest.version, at: latest.submittedAt.toISOString(), by: byName ?? 'Someone', link: latest.link, text: latest.body, note: latest.note, files: latest.files.map((f) => ({ nodeId: f.nodeId, name: f.name })) } : null,
        files: files.map((f) => ({ nodeId: f.node_id, name: f.name })), materials: materials.success ? materials.materials : [],
    } };
}

export type MySubmission = { copyId: string; title: string; org: string; projectId: string; version: number; at: string; state: 'waiting' | 'approved' | 'returned' | 'done'; link: string | null; files: Array<{ nodeId: string; name: string }> };

/**
 * My work → Submitted (report §30.7, decision 68): the viewer's handed-in work, latest version each, with its files to
 * download; it stays listed while an organization is being deleted.
 */
export async function readMySubmissionsAction(): Promise<{ success: true; rows: MySubmission[] } | Failure> {
    const userId = await viewerId();
    if (!userId) return DENIED;
    const rows = await db.execute<{ copy_id: string; title: string; org: string; project_id: string; version: number; at: string; status: string; review_status: string; completion_source: string | null; link: string | null; files: Array<{ nodeId: string; name: string }> }>(sql`
        SELECT DISTINCT ON (c.id) c.id AS copy_id, m.title, o.title AS org, c.workspace_id AS project_id, s.version, s.submitted_at::text AS at, c.status, c.review_status, c.completion_source, s.link, s.files
        FROM tasks c JOIN tasks m ON m.id = c.assignment_id JOIN workspaces o ON o.id = m.workspace_id
        JOIN assignment_submissions s ON s.copy_id = c.id
        WHERE c.deleted_at IS NULL AND (c.assignee_id = ${userId} OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = c.id AND tm.user_id = ${userId}))
        ORDER BY c.id, s.version DESC LIMIT 200`);
    return { success: true, rows: rows.map((r) => ({
        copyId: r.copy_id, title: r.title, org: r.org, projectId: r.project_id, version: r.version, at: new Date(r.at).toISOString(), link: r.link, files: r.files ?? [],
        state: (r.review_status === 'pending' ? 'waiting' : r.review_status === 'rejected' ? 'returned' : r.completion_source === 'review' ? 'approved' : 'done') as MySubmission['state'],
    })).sort((a, b) => b.at.localeCompare(a.at)) };
}

/** The composer's Materials picker (decision 128): this organization's files by name, Admins-only ones marked (137). */
export async function searchAssignmentMaterialsAction(orgId: string, query: string): Promise<{ success: true; files: Array<{ id: string; name: string; adminsOnly: boolean }> } | Failure> {
    const viewer = await orgRole(orgId, 'read');
    if (!viewer || !orgCan(orgRoleOf(viewer.role), 'create_assignments')) return DENIED;
    const pattern = `%${query.trim().slice(0, 80).replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const files = await db.select({ id: workspaceNodes.id, name: workspaceNodes.name,
        adminsOnly: sql<boolean>`EXISTS (SELECT 1 FROM workspace_nodes f WHERE f.workspace_id = workspace_nodes.workspace_id AND f.type = 'folder' AND f.deleted_at IS NULL AND f.metadata->>'access' = 'admins' AND starts_with(workspace_nodes.path, f.path || '/'))` })
        .from(workspaceNodes).where(and(eq(workspaceNodes.projectId, orgId), eq(workspaceNodes.type, 'file'), isNull(workspaceNodes.deletedAt), isNull(workspaceNodes.taskId), sql`${workspaceNodes.name} ILIKE ${pattern}`))
        .orderBy(asc(workspaceNodes.name)).limit(20);
    return { success: true, files };
}

/**
 * Materials on the assignment (decision 128, problem 10): the main assignment's files, read only from each copy.
 * Admins-only files stay hidden from members, names included.
 */
export async function readAssignmentMaterialsAction(copyId: string): Promise<{ success: true; materials: Array<{ nodeId: string; name: string }> } | Failure> {
    const userId = await viewerId();
    const loaded = await loadCopy(copyId);
    if (!userId || !loaded) return DENIED;
    const access = await getWorkspaceAccessById(loaded.master.projectId, userId);
    const isAdmin = access.isOwner || access.memberRole === 'admin';
    const [mine] = isAdmin ? [true] : await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, copyId),
        sql`(${tasks.assigneeId} = ${userId} OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = ${copyId}::uuid AND tm.user_id = ${userId}))`)).limit(1);
    if (!mine) return DENIED;
    const masterId = loaded.master.id;
    const rows = await db.select({ nodeId: workspaceNodes.id, name: workspaceNodes.name }).from(workspaceNodes)
        .where(and(isNull(workspaceNodes.deletedAt), eq(workspaceNodes.type, 'file'),
            sql`(${workspaceNodes.taskId} = ${masterId} OR ${workspaceNodes.id} IN (SELECT node_id FROM task_node_links WHERE task_id = ${masterId}))`,
            orgFileAccessSql({ ...access, viewerId: userId })))
        .orderBy(asc(workspaceNodes.name));
    return { success: true, materials: rows };
}

const updateSchema = z.object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(10000).nullable().optional(),
    dueDate: z.string().datetime({ offset: true }).optional(),
    // Edit for everyone (report §23.3): field by field.
    lateRule: z.enum(['none', 'until', 'always']).optional(),
    lateUntil: z.string().datetime({ offset: true }).nullable().optional(),
    lateAfterMinutes: z.number().int().min(0).max(60).optional(),
    submissionType: z.enum(['none', 'file', 'link', 'text']).optional(),
    reviewRequired: z.boolean().optional(),
    sprintId: z.string().uuid().nullable().optional(),
    priority: z.enum(['low', 'medium', 'high', 'urgent']).optional(),
    storyPoints: z.number().int().min(0).max(100).nullable().optional(),
    /** "Tell everyone?" when the instructions change. */
    tellEveryone: z.boolean().optional(),
    /** Reviewers (report §33.5): admins of the organization; an empty list means everyone reviews. */
    reviewers: z.array(z.string().uuid()).max(20).optional(),
}).strict();

/**
 * Edit for everyone (report §16.3, §23.3, decision 39): the master and every copy follow; a moved due date moves
 * copies that weren't extended. The hand-in type locks at the first submission; a closed one reopens first for
 * instructions or the due date. Turning review off approves nothing already waiting.
 */
export async function updateAssignmentAction(masterId: string, patch: z.input<typeof updateSchema>): Promise<{ success: true } | Failure> {
    const parsed = updateSchema.safeParse(patch);
    if (!parsed.success) return { success: false, error: 'Check the changes.' };
    const ctx = await adminOfMaster(masterId, 'edit_for_everyone');
    if (!ctx) return DENIED;
    const { title, description, dueDate, sprintId, priority, storyPoints, tellEveryone } = parsed.data;
    const settings = ctx.master.settings;
    if (settings.closedAt && (description !== undefined || dueDate)) return { success: false, error: 'Reopen it to change the instructions or due date.' };
    if (parsed.data.submissionType && parsed.data.submissionType !== settings.submissionType) {
        const [handedIn] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, masterId), isNull(tasks.deletedAt), handedInSql)).limit(1);
        if (handedIn) return { success: false, error: 'Someone has handed this in, so the hand-in type is locked.' };
    }
    if (sprintId) {
        const [sprint] = await db.select({ status: workspaceSprints.status }).from(workspaceSprints).where(and(eq(workspaceSprints.id, sprintId), eq(workspaceSprints.projectId, ctx.master.projectId))).limit(1);
        if (!sprint || (sprint.status !== 'planning' && sprint.status !== 'active')) return { success: false, error: 'Pick a planned or active sprint.' };
    }
    let reviewers: string[] | undefined
    if (parsed.data.reviewers) {
        if (!orgCan(orgRoleOf(ctx.viewer.role), 'set_reviewers')) return DENIED;
        const admins = await db.execute<{ id: string }>(sql`
            SELECT owner_id AS id FROM workspaces WHERE id = ${ctx.master.projectId}
            UNION SELECT user_id FROM workspace_members WHERE workspace_id = ${ctx.master.projectId} AND role = 'admin'`);
        const allowed = new Set(admins.map((a) => a.id));
        reviewers = [...new Set(parsed.data.reviewers)].filter((id) => allowed.has(id));
        if (reviewers.length !== new Set(parsed.data.reviewers).size) return { success: false, error: 'Reviewers are the organization’s admins.' };
    }
    const nextSettings: AssignmentSettings = {
        ...settings,
        ...(reviewers ? { reviewers } : {}),
        ...(parsed.data.lateRule ? { lateRule: parsed.data.lateRule, lateUntil: parsed.data.lateRule === 'until' ? parsed.data.lateUntil ?? settings.lateUntil ?? null : null } : {}),
        ...(parsed.data.lateAfterMinutes !== undefined ? { lateAfterMinutes: parsed.data.lateAfterMinutes } : {}),
        ...(parsed.data.submissionType ? { submissionType: parsed.data.submissionType } : {}),
        ...(parsed.data.reviewRequired !== undefined ? { reviewRequired: parsed.data.reviewRequired } : {}),
        ...(description !== undefined && settings.publishedAt ? { instructionsUpdatedAt: new Date().toISOString() } : {}),
    };
    // A moved due date can't pass the late date (report §42.12 smaller bug 16).
    const lateBlock = lateRuleBlock(nextSettings, new Date(dueDate ?? ctx.master.dueDate ?? Date.now()));
    if (lateBlock) return { success: false, error: lateBlock };
    const now = new Date();
    await db.transaction(async (tx) => {
        const shared = { ...(title !== undefined ? { title } : {}), ...(description !== undefined ? { description } : {}),
            ...(priority ? { priority } : {}), ...(storyPoints !== undefined ? { storyPoints } : {}), updatedAt: now };
        await tx.update(tasks).set({ ...shared, assignmentSettings: nextSettings, ...(dueDate ? { dueDate: new Date(dueDate) } : {}), ...(sprintId !== undefined ? { sprintId } : {}) }).where(eq(tasks.id, masterId));
        await tx.update(tasks).set(shared).where(eq(tasks.assignmentId, masterId));
        // All of the organization's own copies move with it; group copies keep their workspace's linked sprint.
        if (sprintId !== undefined) await tx.update(tasks).set({ sprintId }).where(and(eq(tasks.assignmentId, masterId), eq(tasks.projectId, ctx.master.projectId)));
        if (dueDate && ctx.master.dueDate) {
            await tx.update(tasks).set({ dueDate: new Date(dueDate) }).where(and(eq(tasks.assignmentId, masterId), eq(tasks.dueDate, ctx.master.dueDate)));
        }
    });
    touch(ctx.viewer.slug, ctx.master.projectId);
    // A due-date move reaches the people whose copy moved with it (report §16.3, "Due date moved to Mon").
    if (dueDate && ctx.master.dueDate && new Date(dueDate).getTime() !== ctx.master.dueDate.getTime()) {
        // Only people still working on it hear about it (smaller bug 17).
        const moved = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, masterId), isNull(tasks.deletedAt), eq(tasks.dueDate, new Date(dueDate)), sql`NOT ${handedInSql}`));
        for (const { id } of moved) await notifyAssignmentDueChanged(id, ctx.viewer.userId, (t, day) => `${t}: due date moved to ${day(new Date(dueDate))}`, `${id}:moved:${dueDate}`);
    }
    // "Tell everyone?" (report §23.3): one notice for the change, to everyone who has it.
    if (tellEveryone && description !== undefined && settings.publishedAt) {
        const org = await orgLabel(ctx.master.projectId);
        const people = await assignmentPeopleOf(db, masterId);
        if (org && people.length) await notifyOrg({ orgId: org.id, eventKey: 'assignments.due_changed', actorId: ctx.viewer.userId, to: people,
            title: `Instructions updated: ${title ?? ctx.master.title}`, href: orgHref(org, '?tab=tasks'), sourceEventId: `instructions:${masterId}:${now.getTime()}` })
            .catch((error) => logger.warn('assignments.after_save_failed', { module: 'assignments', step: 'instructions', masterId, error: error instanceof Error ? error.message : String(error) }));
    }
    return { success: true };
}

/** Roster Remove (report §34.6): only a copy nobody has started; they're told it was removed. */
export async function removeCopyAction(copyId: string): Promise<{ success: true } | Failure> {
    const ctx = await adminOfCopy(copyId, 'extend_excuse_remind');
    if (!ctx) return DENIED;
    const { copy } = ctx;
    if (copy.status !== 'todo' || copy.submission || copy.reviewSubmittedAt) return { success: false, error: 'They’ve started this, so it stays. Excuse them instead.' };
    const people = await assignmentPeopleOf(db, copyId);
    await db.update(tasks).set({ deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(tasks.id, copyId), eq(tasks.status, 'todo')));
    touch(ctx.viewer.slug, ctx.master.projectId);
    await notifyAssignmentRemoved(ctx.master.projectId, ctx.master.title, people, ctx.viewer.userId, `removed-copy:${copyId}`).catch(() => undefined);
    return { success: true };
}

/** Extend for the selected people (report §34.6): each is told. A closed assignment needs reopen for them. */
export async function extendCopiesAction(copyIds: string[], dueDate: string, options: { reopen?: boolean } = {}): Promise<{ success: true; extended: number } | Failure> {
    let extended = 0;
    for (const id of copyIds.slice(0, 500)) {
        const result = await extendCopyAction(id, dueDate, options);
        if (!result.success) return extended ? { success: true, extended } : result;
        extended += 1;
    }
    return { success: true, extended };
}

/** Return selected (report §23.2): one reason and Fix by for everyone selected; work that isn't waiting is skipped. */
export async function returnCopiesAction(copyIds: string[], reason: string, fixBy: string): Promise<{ success: true; returned: number; skipped: number } | Failure> {
    if (!reason.trim()) return { success: false, error: 'Say what to change.' };
    let returned = 0;
    let skipped = 0;
    for (const id of copyIds.slice(0, 500)) {
        const result = await reviewAssignmentCopyAction(id, 'return', reason, undefined, { fixBy });
        if (result.success) returned += 1;
        else if (result.error === DENIED.error) return result;
        else skipped += 1;
    }
    return { success: true, returned, skipped };
}

/** Export (report §33.5, decision 83): one assignment's roster as rows, statuses and dates only, never content. */
export async function readAssignmentExportAction(masterId: string): Promise<{ success: true; rows: string[][] } | Failure> {
    const roster = await readAssignmentRosterAction(masterId);
    if (!roster.success) return roster;
    const ctx = await adminOfMaster(masterId, 'export_progress');
    if (!ctx) return DENIED;
    const day = (iso: string | null | undefined) => (iso ? iso.slice(0, 10) : '');
    return {
        success: true,
        rows: [['Person', 'Status', 'Due', 'Handed in', 'Late', 'Version'], ...roster.rows.map((r) => {
            const sub = r.submission as { at?: string; version?: number } | null;
            return [r.people?.length ? `${r.label} (${r.people.map((p) => p.name).join(', ')})` : r.label, ASSIGNMENT_STATE_LABELS[r.state], day(r.dueDate), day(sub?.at), r.late ? 'Late' : '', sub?.version ? String(sub.version) : ''];
        })],
    };
}

/** Use again (report §33.5): the form filled from an earlier assignment, with new dates left to choose. */
export async function readAssignmentForReuseAction(masterId: string): Promise<{ success: true; form: {
    title: string; description: string; submissionType: string; reviewRequired: boolean; lateRule: string; lateAfterMinutes: number; steps: string[]; target: AssignmentTarget; materials: Array<{ id: string; name: string }>; dueDate: null;
    reviewers: string[];
} } | Failure> {
    const ctx = await adminOfMaster(masterId, 'edit_for_everyone');
    if (!ctx) return DENIED;
    const [steps, materials] = await Promise.all([
        db.execute<{ title: string }>(sql`SELECT title FROM task_subtasks WHERE task_id = ${masterId} ORDER BY position`),
        db.execute<{ id: string; name: string }>(sql`SELECT n.id, n.name FROM task_node_links l JOIN workspace_nodes n ON n.id = l.node_id AND n.deleted_at IS NULL WHERE l.task_id = ${masterId}`),
    ]);
    const s = ctx.master.settings;
    return { success: true, form: {
        title: ctx.master.title, description: ctx.master.description ?? '', submissionType: s.submissionType, reviewRequired: s.reviewRequired, lateRule: s.lateRule,
        lateAfterMinutes: s.lateAfterMinutes ?? LATE_AFTER_DEFAULT_MINUTES, steps: steps.map((r) => r.title), target: s.target, materials: [...materials], dueDate: null,
        reviewers: s.reviewers ?? [],
    } };
}


/** Delete only while nobody has submitted; afterwards, Close only (report §16.3). */
export async function deleteAssignmentAction(masterId: string): Promise<{ success: true } | Failure> {
    const ctx = await adminOfMaster(masterId, 'create_assignments');
    if (!ctx) return DENIED;
    const [submitted] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, masterId), isNull(tasks.deletedAt), handedInSql)).limit(1);
    if (submitted) return { success: false, error: 'Someone already handed this in. Close it instead.' };
    const now = new Date();
    const people = await assignmentPeopleOf(db, masterId);
    await db.update(tasks).set({ deletedAt: now, updatedAt: now }).where(sql`${tasks.id} = ${masterId} OR ${tasks.assignmentId} = ${masterId}`);
    touch(ctx.viewer.slug, ctx.master.projectId);
    await notifyAssignmentRemoved(ctx.master.projectId, ctx.master.title, people, ctx.viewer.userId, `removed:${masterId}`)
        .catch((error) => logger.warn('assignments.after_save_failed', { module: 'assignments', step: 'removed', masterId, error: error instanceof Error ? error.message : String(error) }));
    return { success: true };
}

/** Reopen (decision 40): submissions resume; instructions and the due date can change again. */
export async function reopenAssignmentAction(masterId: string): Promise<{ success: true } | Failure> {
    const ctx = await adminOfMaster(masterId, 'close_assignment');
    if (!ctx) return DENIED;
    if (!ctx.master.settings.closedAt) return { success: false, error: 'This assignment is open.' };
    await db.update(tasks).set({ assignmentSettings: { ...ctx.master.settings, closedAt: null }, updatedAt: new Date() }).where(eq(tasks.id, masterId));
    await notifyAssignmentReopened(masterId, ctx.viewer.userId).catch((error) => logger.warn('assignments.after_save_failed', { module: 'assignments', step: 'reopen', masterId, error: error instanceof Error ? error.message : String(error) }));
    touch(ctx.viewer.slug, ctx.master.projectId);
    return { success: true };
}

/** Give to (report §34.6, decisions 17 and 88): a copy for a member without one, with its own due date. They're told. */
export async function giveCopyAction(masterId: string, userId: string, dueDate: string): Promise<{ success: true } | Failure> {
    if (!z.string().datetime({ offset: true }).safeParse(dueDate).success) return { success: false, error: 'Pick a due date.' };
    const ctx = await adminOfMaster(masterId, 'extend_excuse_remind');
    if (!ctx) return DENIED;
    if (!ctx.master.settings.publishedAt) return { success: false, error: 'Publish it first.' };
    const [member] = await db.select({ role: workspaceMembers.role }).from(workspaceMembers).where(and(eq(workspaceMembers.projectId, ctx.master.projectId), eq(workspaceMembers.userId, userId))).limit(1);
    if (member?.role !== 'member') return { success: false, error: 'Only members get assignments.' };
    const [existing] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, masterId), isNull(tasks.deletedAt),
        sql`(${tasks.assigneeId} = ${userId} OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = ${tasks.id} AND tm.user_id = ${userId}))`)).limit(1);
    if (existing) return { success: false, error: 'They already have this one.' };
    const due = new Date(dueDate);
    await db.transaction(async (tx) => {
        await createCopies(tx, masterId, [{ projectId: ctx.master.projectId, assigneeId: userId }], ctx.viewer.userId);
        // Their own date, and open to them even if the assignment has closed since.
        await tx.update(tasks).set({ dueDate: due, ...(ctx.master.settings.closedAt ? { submitUntil: due } : {}) })
            .where(and(eq(tasks.assignmentId, masterId), eq(tasks.assigneeId, userId), isNull(tasks.deletedAt)));
    });
    touch(ctx.viewer.slug, ctx.master.projectId);
    await notifyNewCopies(ctx.master.projectId, { userId }).catch((error) => logger.warn('assignments.after_save_failed', { module: 'assignments', step: 'give', masterId, error: error instanceof Error ? error.message : String(error) }));
    return { success: true };
}

/** No more submissions; Missing stays in history. */
export async function closeAssignmentAction(masterId: string): Promise<{ success: true } | Failure> {
    const ctx = await adminOfMaster(masterId, 'close_assignment');
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

const submitSchema = z.object({
    // Web addresses only: a javascript: link would run for whoever opens it (security review).
    link: z.string().trim().url('Enter a valid link.').max(2000).refine((value) => webLink(value) !== null, 'Enter a link that starts with https://.').optional(),
    text: z.string().trim().max(10000, 'Up to 10,000 characters.').optional(),
    // Decision 85: an optional note with any hand-in.
    note: z.string().trim().max(500, 'Notes are up to 500 characters.').optional(),
}).strict();

/** Hand in a copy: its assignee or any teammate (report §16.4, §16.11). Review on → Submitted; off → Done. */
export async function submitAssignmentAction(copyId: string, input: z.input<typeof submitSchema>): Promise<{ success: true } | Failure> {
    const userId = await viewerId();
    const parsed = submitSchema.safeParse(input);
    if (!userId || !parsed.success) return parsed.success ? DENIED : { success: false, error: parsed.error.issues[0]?.message ?? 'Check what you’re handing in.' };
    const loaded = await loadCopy(copyId);
    if (!loaded) return DENIED;
    const { copy, master } = loaded;
    const [teammate] = await db.select({ userId: taskTeamMembers.userId }).from(taskTeamMembers).where(and(eq(taskTeamMembers.taskId, copyId), eq(taskTeamMembers.userId, userId))).limit(1);
    if (copy.assigneeId !== userId && !teammate) return DENIED;
    // Decisions 33 and 109: handing in is submit_ask_questions in the organization (Viewers read only).
    const submitter = await orgRole(master.projectId, 'read');
    if (copy.projectId === master.projectId && (!submitter || !orgCan(orgRoleOf(submitter.role), 'submit_ask_questions'))) return DENIED;
    if (copy.excusedAt) return { success: false, error: "You’re excused from this one." };
    const copyAccess = await getWorkspaceAccessById(copy.projectId, userId);
    if (copyAccess.writeBlocked) return { success: false, error: writeBlockedMessage(copyAccess.writeBlocked) };
    // Approved work is locked (decision 85); done work with no review can be replaced until it's due (34.4).
    if (copy.status === 'done' && copy.reviewStatus === 'none' && copy.completionSource === 'review') return { success: false, error: 'Approved work is locked.' };
    const now = new Date();
    if (copy.status === 'done' && copy.reviewStatus === 'none' && copy.dueDate && now.getTime() > copy.dueDate.getTime() + lateAfterMs(master.settings) && !(copy.submitUntil && now <= copy.submitUntil)) {
        return { success: false, error: 'The due date has passed, so this can’t be replaced.' };
    }
    if (!canStillSubmit(master.settings, copy.dueDate, now, copy.submitUntil)) return { success: false, error: master.settings.closedAt ? 'This assignment is closed.' : 'Late submissions are not accepted.' };
    const { link, text, note } = parsed.data;
    const type = master.settings.submissionType;
    if (type === 'link' && !link) return { success: false, error: 'Add the link to your work.' };
    if (type === 'text' && !text) return { success: false, error: 'Write your answer first.' };
    if (type === 'file') {
        const [file] = await db.execute<{ id: string }>(sql`
            SELECT id FROM workspace_nodes WHERE task_id = ${copyId} AND deleted_at IS NULL AND type = 'file'
            UNION ALL SELECT node_id FROM task_node_links WHERE task_id = ${copyId} LIMIT 1`);
        if (!file) return { success: false, error: 'Attach your file to this task first.' };
    }
    const review = master.settings.reviewRequired;
    // Late against the copy's own due date (Fix by moves it) plus Late after (decisions 126, 171).
    const late = Boolean(copy.dueDate && now.getTime() > copy.dueDate.getTime() + lateAfterMs(master.settings));
    await db.transaction(async (tx) => {
        // What was handed in, so the panel and Approve can tell whether it changed since (problems 21, 29).
        const reviewContentHash = review ? await taskReviewSnapshot(tx, copyId, true) : null;
        // The submission record (decision 127, problem 9): this version, its note and its files, kept for good.
        const [last] = await tx.select({ version: sql<number>`coalesce(max(${assignmentSubmissions.version}), 0)::int` }).from(assignmentSubmissions).where(eq(assignmentSubmissions.copyId, copyId));
        const version = Math.max(last?.version ?? 0, copy.submission?.version ?? 0) + 1;
        const files = type === 'file' ? await tx.execute<{ id: string; name: string; version: number | null }>(sql`
            SELECT n.id, n.name, n.current_version AS version FROM workspace_nodes n
            WHERE n.deleted_at IS NULL AND n.type = 'file' AND (n.task_id = ${copyId} OR n.id IN (SELECT node_id FROM task_node_links WHERE task_id = ${copyId}))`) : [];
        await tx.insert(assignmentSubmissions).values({ copyId, projectId: copy.projectId, version, submittedBy: userId, submittedAt: now, link: link ?? null, body: text ?? null, note: note || null,
            files: files.map((f) => ({ nodeId: f.id, name: f.name, version: f.version })), late });
        await tx.update(tasks).set({
            status: 'done',
            workflowColumnId: await columnFor(copy.projectId, 'done'),
            reviewStatus: review ? 'pending' : 'none',
            reviewContentHash,
            reviewSubmittedAt: now,
            completedAt: review ? null : now,
            completedBy: review ? null : userId,
            completionSource: review ? null : 'direct',
            submission: { link: link ?? null, text: text ?? null, by: userId, at: now.toISOString(), version, note: note || null, late },
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

/** Reviews one waiting copy; false when someone else got there first (report §42.12 smaller bug 15). */
async function reviewOne(copyId: string, reviewerId: string, decision: 'approve' | 'return', reason?: string, fixBy?: Date, change = false): Promise<boolean> {
    const now = new Date();
    const [copy] = await db.select({ projectId: tasks.projectId, sprintId: tasks.sprintId, title: tasks.title }).from(tasks).where(eq(tasks.id, copyId)).limit(1);
    if (!copy) return false;
    const reviewed = await db.transaction(async (tx) => {
        // Approve only what was handed in: files and steps can't have changed since (problems 21, 29). Submissions
        // from before Submit saved this have no value to compare and are taken as they are.
        if (decision === 'approve') {
            const [row] = await tx.execute<{ hash: string | null }>(sql`SELECT review_content_hash AS hash FROM tasks WHERE id = ${copyId}::uuid FOR UPDATE`);
            if (row?.hash && row.hash !== await taskReviewSnapshot(tx, copyId, true)) throw new Error('This changed after it was handed in. Ask them to resubmit.');
        }
        const updated = await tx.update(tasks).set(decision === 'approve'
            ? { reviewStatus: 'none', status: 'done', completedAt: now, completedBy: reviewerId, completionSource: 'review', updatedAt: now }
            // Return with Fix by (decision 126): the copy's own due date and its submit-until move there.
            : { reviewStatus: 'rejected', status: 'in_progress', workflowColumnId: await columnFor(copy.projectId, 'in_progress'), completedAt: null, completedBy: null, completionSource: null, updatedAt: now,
                ...(fixBy ? { submitUntil: fixBy, dueDate: sql`greatest(${tasks.dueDate}, ${fixBy.toISOString()}::timestamptz)` } : {}) },
        ).where(and(eq(tasks.id, copyId), decision === 'return'
            // Decision 40: an approved copy can be returned too, while the assignment is open (checked by the caller).
            ? sql`(${tasks.reviewStatus} = 'pending' OR (${tasks.status} = 'done' AND ${tasks.completionSource} = 'review' AND ${change}))`
            : eq(tasks.reviewStatus, 'pending'))).returning({ id: tasks.id });
        if (updated.length === 0) return false;
        await tx.insert(taskActivityEvents).values({
            taskId: copyId, projectId: copy.projectId, sprintId: copy.sprintId, actorId: reviewerId,
            eventType: decision === 'approve' ? 'review_approved' : 'changes_requested',
            payload: { version: 1, source: 'assignment_review', taskTitle: copy.title, reason: reason ?? null, fixBy: fixBy?.toISOString() ?? null },
        });
        return true;
    });
    if (reviewed) await notifyAssignmentReviewed(copyId, reviewerId, decision, reason ?? null);
    return reviewed;
}

/** "Already reviewed by Priya": who made the last review decision on a copy. */
async function lastReviewer(copyId: string) {
    const [row] = await db.select({ name: sql<string | null>`coalesce(${profiles.fullName}, ${profiles.username})` }).from(taskActivityEvents)
        .leftJoin(profiles, eq(profiles.id, taskActivityEvents.actorId))
        .where(and(eq(taskActivityEvents.taskId, copyId), inArray(taskActivityEvents.eventType, ['review_approved', 'changes_requested'])))
        .orderBy(desc(taskActivityEvents.createdAt)).limit(1);
    return row?.name ?? 'another admin';
}

/** Approve, or Return with a reason, one submitted copy (org admins; report §16.4). */
export async function reviewAssignmentCopyAction(copyId: string, decision: 'approve' | 'return', reason?: string, expected?: { projectId: string; updatedAt?: string }, options: { fixBy?: string; change?: boolean } = {}): Promise<{ success: true } | Failure> {
    const loaded = await loadCopy(copyId);
    if (!loaded) return DENIED;
    // From the task panel: the copy must be in that workspace, and the panel must be looking at its current version.
    if (expected && loaded.copy.projectId !== expected.projectId) return DENIED;
    if (expected?.updatedAt && loaded.copy.updatedAt.getTime() !== new Date(expected.updatedAt).getTime()) return { success: false, error: 'This changed. Reload before reviewing.' };
    const viewer = await orgRole(loaded.master.projectId);
    if (!viewer || !orgCan(orgRoleOf(viewer.role), 'approve_return')) return DENIED;
    const approved = loaded.copy.status === 'done' && loaded.copy.completionSource === 'review';
    // Decision 40: approved work can be returned while the assignment is open, as a deliberate change of decision;
    // a second admin reviewing at the same moment is still told it's done (smaller bug 15).
    if (decision === 'return' && approved && options.change) {
        if (loaded.master.settings.closedAt) return { success: false, error: 'Reopen the assignment to return approved work.' };
    } else if (loaded.copy.reviewStatus !== 'pending') return { success: false, error: `Already reviewed by ${await lastReviewer(copyId)}.` };
    if (decision === 'return' && !reason?.trim()) return { success: false, error: 'Say what to change.' };
    // Fix by (decision 126): 3 days from now by default, never in the past.
    const fixBy = decision === 'return' ? new Date(options.fixBy ?? Date.now() + 3 * 86_400_000) : undefined;
    if (fixBy && !(fixBy.getTime() > Date.now())) return { success: false, error: 'Pick a Fix by date after now.' };
    const [own] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.id, copyId), ownWork(copyId, viewer.userId))).limit(1);
    if (own) return { success: false, error: "You can’t review your own work. Ask another admin." };
    const reviewed = await reviewOne(copyId, viewer.userId, decision, reason?.trim().slice(0, 1000), fixBy, Boolean(options.change && approved)).catch((error: Error) => error);
    if (reviewed instanceof Error) return { success: false, error: reviewed.message };
    if (!reviewed) {
        return { success: false, error: `Already reviewed by ${await lastReviewer(copyId)}.` };
    }
    touch(viewer.slug, loaded.master.projectId);
    return { success: true };
}

export async function approveAllSubmittedAction(masterId: string): Promise<{ success: true; approved: number } | Failure> {
    const ctx = await adminOfMaster(masterId, 'approve_return');
    if (!ctx) return DENIED;
    const pending = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, masterId), eq(tasks.reviewStatus, 'pending'), isNull(tasks.deletedAt), isNull(tasks.excusedAt),
        sql`NOT (${tasks.assigneeId} IS NOT DISTINCT FROM ${ctx.viewer.userId}::uuid OR EXISTS (SELECT 1 FROM task_team_members tm WHERE tm.task_id = ${tasks.id} AND tm.user_id = ${ctx.viewer.userId}::uuid))`));
    let approved = 0;
    for (const { id } of pending) if (await reviewOne(id, ctx.viewer.userId, 'approve')) approved += 1;
    touch(ctx.viewer.slug, ctx.master.projectId);
    return { success: true, approved };
}

async function adminOfCopy(copyId: string, action: OrgAction) {
    const loaded = await loadCopy(copyId);
    if (!loaded) return null;
    const viewer = await orgRole(loaded.master.projectId);
    return viewer && orgCan(orgRoleOf(viewer.role), action) ? { ...loaded, viewer } : null;
}

/**
 * One person's (or team's) own due date. On a closed assignment it also reopens it for them, when asked
 * ("Reopen it for Asha?", smaller bug 18), so the new date means they can hand it in.
 */
export async function extendCopyAction(copyId: string, dueDate: string, options: { reopen?: boolean } = {}): Promise<{ success: true } | Failure> {
    if (!z.string().datetime({ offset: true }).safeParse(dueDate).success) return { success: false, error: 'Pick a date.' };
    const ctx = await adminOfCopy(copyId, 'extend_excuse_remind');
    if (!ctx) return DENIED;
    const closed = Boolean(ctx.master.settings.closedAt);
    if (closed && !options.reopen) return { success: false, error: 'This assignment is closed. Reopen it for this person to give them a new date.' };
    await db.update(tasks).set({ dueDate: new Date(dueDate), ...(closed ? { submitUntil: new Date(dueDate) } : {}), updatedAt: new Date() }).where(eq(tasks.id, copyId));
    touch(ctx.viewer.slug, ctx.master.projectId);
    await notifyAssignmentDueChanged(copyId, ctx.viewer.userId, (title) => `Your due date for ${title} changed`, `${copyId}:due:${dueDate}`);
    return { success: true };
}

/** Not required for this person: out of the counts, with a reason; null reason clears it. */
export async function excuseCopyAction(copyId: string, reason: string | null): Promise<{ success: true } | Failure> {
    const ctx = await adminOfCopy(copyId, 'extend_excuse_remind');
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
    status: 'draft' | 'scheduled' | 'open' | 'closed';
    /** "From Ms. Rao", or the organization once they're no longer an admin; "Draft by" on drafts (decision 98). */
    from: string;
    /** Scheduled: when, or with its sprint (decision 125). */
    publishAt?: string | null;
    publishOnSprintStart?: boolean;
    /** A draft Duplicate changed: what to check before publishing (problem 15). */
    note?: string | null;
    /** "Late work closed" on old assignments with no late date (problem 13). */
    lateNote: string | null;
    submissionType: string;
    reviewRequired: boolean;
    teams: boolean;
    counts: Record<CopyState, number> & { total: number };
    /** Teams mode: people done out of everyone placed ("7 of 11 people", report §16.11). */
    people?: { done: number; total: number };
    /** Members: their own copy (or their team's). */
    mine: { copyId: string; state: CopyState; late: boolean; teamName: string | null; submission: unknown; projectId: string; returnedReason?: string | null; dueDate: string | null; extended: boolean } | null;
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
    // Decision 98: nothing depends on the person who made it; "From" falls back to the organization.
    const creatorIds = [...new Set(visible.map((m) => m.creatorId).filter((id): id is string => Boolean(id)))];
    const [org] = await db.select({ title: workspaces.title, ownerId: workspaces.ownerId, timeZone: workspaces.timeZone }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    const admins = new Set(creatorIds.length ? (await db.select({ id: workspaceMembers.userId }).from(workspaceMembers)
        .where(and(eq(workspaceMembers.projectId, orgId), inArray(workspaceMembers.userId, creatorIds), eq(workspaceMembers.role, 'admin')))).map((r) => r.id) : []);
    if (org) admins.add(org.ownerId);
    const creatorNames = new Map(creatorIds.length ? (await db.select({ id: profiles.id, name: sql<string>`coalesce(${profiles.fullName}, ${profiles.username}, 'Someone')` }).from(profiles).where(inArray(profiles.id, creatorIds))).map((p) => [p.id, p.name]) : []);
    const rows: AssignmentRow[] = visible.map((m) => {
        const settings = m.assignmentSettings!;
        const counts = emptyCounts();
        let mine: AssignmentRow['mine'] = null;
        for (const c of copies.filter((c) => c.assignmentId === m.id)) {
            const s = copyState({ status: c.status, reviewStatus: c.reviewStatus, dueDate: c.dueDate, submittedAt: c.reviewSubmittedAt, completedAt: c.completedAt, excusedAt: c.excusedAt }, now);
            counts[s.state] += 1;
            if (s.state !== 'excused') counts.total += 1;
            // Their own date, marked Extended when it isn't the assignment's (report §42.10 problem 14).
            if (c.assigneeId === viewer.userId || myTeams.has(c.id)) mine = { copyId: c.id, ...s, teamName: c.teamName, submission: c.submission, projectId: c.projectId,
                dueDate: c.dueDate?.toISOString() ?? null, extended: Boolean(c.dueDate && m.dueDate && c.dueDate.getTime() !== m.dueDate.getTime()) };
        }
        const teamPeople = settings.target.mode === 'teams' ? copies.filter((c) => c.assignmentId === m.id).reduce((acc, c) => {
            const size = Math.max(1, teamSizes.get(c.id) ?? 0);
            const s = copyState({ status: c.status, reviewStatus: c.reviewStatus, dueDate: c.dueDate, submittedAt: c.reviewSubmittedAt, completedAt: c.completedAt, excusedAt: c.excusedAt }, now);
            return s.state === 'excused' ? acc : { done: acc.done + (s.state === 'done' ? size : 0), total: acc.total + size };
        }, { done: 0, total: 0 }) : undefined;
        return {
            masterId: m.id, title: m.title, dueDate: m.dueDate?.toISOString() ?? null, note: viewer.isAdmin ? settings.note ?? null : null, lateNote: lateWorkLabel(settings),
            status: !settings.publishedAt ? (settings.publishAt || settings.publishOnSprintStart ? 'scheduled' : 'draft') : settings.closedAt ? 'closed' : 'open',
            from: (() => {
                const name = m.creatorId && admins.has(m.creatorId) ? creatorNames.get(m.creatorId) ?? null : null;
                return !settings.publishedAt ? (name ? `Draft by ${name}` : 'Draft') : `From ${name ?? org?.title ?? 'the organization'}`;
            })(),
            ...(viewer.isAdmin && !settings.publishedAt ? { publishAt: settings.publishAt ?? null, publishOnSprintStart: Boolean(settings.publishOnSprintStart) } : {}),
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
    return { success: true, isAdmin: viewer.isAdmin, rows: viewer.isAdmin || viewer.role === 'viewer' ? rows : rows.filter((r) => r.mine), timeZone: org?.timeZone ?? null };
}

export type RosterRow = {
    copyId: string; label: string; members: string[]; state: CopyState; late: boolean; projectId: string; dueDate: string | null; submission: unknown; excusedReason: string | null;
    /** Team copies (report §16.11): who is on it (★ lead) and who handed in for the team. */
    people?: Array<{ id: string; name: string; lead: boolean }>; submittedBy?: string | null;
    /** Approved by a reviewer: Change decision can still return it while open (decision 40). */
    approved?: boolean;
};

/** The roster for one assignment (report §16.5): admins see names; guests see counts without names. */
export async function readAssignmentRosterAction(masterId: string): Promise<{ success: true; rows: RosterRow[]; counts: AssignmentRow['counts']; withoutCopy: Array<{ userId: string; name: string }>; closed: boolean } | Failure> {
    const master = await loadMaster(masterId);
    if (!master) return DENIED;
    const viewer = await orgRole(master.projectId, 'read');
    // see_roster: names for "yes", counts for "counts"; a member's "own" row is on their board, never here (7.13).
    const grant = viewer ? orgGrant(orgRoleOf(viewer.role), 'see_roster') : 'no';
    if (!viewer || (grant !== 'yes' && grant !== 'counts')) return DENIED;
    const copies = await db.select({
        id: tasks.id, projectId: tasks.projectId, assigneeId: tasks.assigneeId, teamName: tasks.teamName, status: tasks.status, reviewStatus: tasks.reviewStatus,
        dueDate: tasks.dueDate, reviewSubmittedAt: tasks.reviewSubmittedAt, completedAt: tasks.completedAt, excusedAt: tasks.excusedAt, excusedReason: tasks.excusedReason,
        submission: tasks.submission, projectTitle: workspaces.title, projectParent: workspaces.parentId, completionSource: tasks.completionSource,
    }).from(tasks).innerJoin(workspaces, eq(workspaces.id, tasks.projectId))
        .where(and(eq(tasks.assignmentId, masterId), isNull(tasks.deletedAt)));
    const counts = emptyCounts();
    const now = new Date();
    const states = copies.map((c) => {
        const s = copyState({ status: c.status, reviewStatus: c.reviewStatus, dueDate: c.dueDate, submittedAt: c.reviewSubmittedAt, completedAt: c.completedAt, excusedAt: c.excusedAt }, now, lateAfterMs(master.settings));
        counts[s.state] += 1;
        if (s.state !== 'excused') counts.total += 1;
        return s;
    });
    const closed = Boolean(master.settings.closedAt);
    if (!viewer.isAdmin) return { success: true, rows: [], counts, withoutCopy: [], closed };
    const memberRows = db.select({ userId: workspaceMembers.userId, name: sql<string>`coalesce(${profiles.fullName}, ${profiles.username}, 'Member')` })
        .from(workspaceMembers).innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
        .where(and(eq(workspaceMembers.projectId, master.projectId), eq(workspaceMembers.role, 'member'), isNull(profiles.deletedAt)))
        .orderBy(asc(profiles.fullName));
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
            approved: c.status === 'done' && c.completionSource === 'review',
            ...(c.teamName ? { people: team, submittedBy: by ? names.get(by) ?? null : null } : {}) };
    });
    // Give to (decision 88): members with no copy, late joiners included.
    const holders = new Set([...copies.map((c) => c.assigneeId), ...people.map((p) => p.userId)]);
    const withoutCopy = (await memberRows).filter((m) => !holders.has(m.userId)).slice(0, 500);
    return { success: true, rows, counts, withoutCopy, closed };
}

/** Composer pickers: the org's child projects and its planned or active sprints. */
export async function readAssignmentComposerOptionsAction(orgId: string) {
    const viewer = await orgRole(orgId, 'read');
    if (!viewer || !orgCan(orgRoleOf(viewer.role), 'create_assignments')) return { success: false as const, error: DENIED.error };
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
    // Reviewers (report §33.5): the owner and admins who can be picked.
    const admins = await db.execute<{ id: string; name: string }>(sql`
        SELECT p.id, coalesce(p.full_name, p.username, 'Admin') AS name FROM profiles p
        WHERE p.id IN (SELECT owner_id FROM workspaces WHERE id = ${orgId} UNION SELECT user_id FROM workspace_members WHERE workspace_id = ${orgId} AND role = 'admin')
        ORDER BY 2`);
    return { success: true as const, children, sprints, teamAssignments, defaults: { reviewRequired: work.reviewRequired, lateRule: work.lateRule }, admins: [...admins] };
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
    const ctx = await adminOfMaster(masterId, 'edit_for_everyone');
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
export async function remindCopiesAction(masterId: string, copyIds?: string[]): Promise<{ success: true; reminded: number; skipped: number } | Failure> {
    const ctx = await adminOfMaster(masterId, 'extend_excuse_remind');
    if (!ctx) return DENIED;
    const open = await db.select({ id: tasks.id }).from(tasks).where(and(
        eq(tasks.assignmentId, masterId), isNull(tasks.deletedAt), isNull(tasks.excusedAt), sql`NOT ${handedInSql}`,
        ...(copyIds?.length ? [inArray(tasks.id, copyIds.slice(0, 2000))] : []),
    ));
    // Decision 60: skip copies reminded in the last 12 hours, and say so; the minute in the id stops a double click.
    const recent = await remindedRecently(ctx.master.projectId, 'remind', await assignmentPeopleOf(db, masterId));
    const send = open.filter((c) => !recent.has(c.id));
    const minute = Math.floor(Date.now() / 60_000);
    const due = ctx.master.dueDate;
    for (const { id } of send) {
        await notifyAssignmentDueChanged(id, ctx.viewer.userId, (t, day) => `Reminder: ${t}${due ? ` is due ${day(due)}` : ' is waiting for you'}`, `remind:${id}:${minute}`, 'assignments.reminded');
    }
    return { success: true, reminded: send.length, skipped: open.length - send.length };
}

/** Teams of an earlier teams assignment, for "Copy teams from" (report §16.11). */
export async function readAssignmentTeamsAction(masterId: string): Promise<{ success: true; teams: Array<{ name: string; userIds: string[]; leadId: string | null }> } | Failure> {
    const ctx = await adminOfMaster(masterId, 'edit_for_everyone');
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
    const ctx = await adminOfMaster(masterId, 'edit_for_everyone');
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
    if (copy) await notifyTeamMoved(copy.id, userId, ctx.viewer.userId, title, `team-move:${masterId}:${userId}:${Date.now()}`);
    return { success: true };
}

/**
 * Auto-make groups (report §25.7, §29.3, decision 64): a random split that quietly keeps blocked pairs apart. Blocks
 * are private, so this runs here and the composer only gets the groups back.
 */
export async function autoMakeGroupsAction(orgId: string, userIds: string[], size: number): Promise<{ success: true; groups: string[][] } | Failure> {
    const viewer = await orgRole(orgId, 'read');
    const parsed = z.array(z.string().uuid()).max(2000).safeParse(userIds);
    if (!viewer || !orgCan(orgRoleOf(viewer.role), 'create_assignments') || !parsed.success) return DENIED;
    // Only this organization's members: the block graph of anyone else is never read (no cross-org probing).
    const ids = parsed.data.length ? (await db.select({ id: workspaceMembers.userId }).from(workspaceMembers)
        .where(and(eq(workspaceMembers.projectId, orgId), inArray(workspaceMembers.userId, [...new Set(parsed.data)]), eq(workspaceMembers.role, 'member')))).map((r) => r.id) : [];
    const blocks = ids.length ? await db.execute<{ a: string; b: string }>(sql`
        SELECT blocker_id AS a, blocked_id AS b FROM user_blocks WHERE blocker_id IN ${ids} AND blocked_id IN ${ids}`) : [];
    const blocked = new Set(blocks.map((r) => [r.a, r.b].sort().join('|')));
    const groups = splitIntoTeams(ids, Math.max(1, Math.trunc(size)), Math.random, (a, b) => blocked.has([a, b].sort().join('|')));
    return { success: true, groups };
}

/** Excuse one person on a team (report §16.11): the team carries on; that person leaves the counts with an excused copy. */
export async function excuseTeamMemberAction(copyId: string, userId: string, reason: string): Promise<{ success: true } | Failure> {
    const ctx = await adminOfCopy(copyId, 'extend_excuse_remind');
    if (!ctx) return DENIED;
    if (!ctx.copy.teamName) return excuseCopyAction(copyId, reason);
    const [member] = await db.select({ userId: taskTeamMembers.userId }).from(taskTeamMembers).where(and(eq(taskTeamMembers.taskId, copyId), eq(taskTeamMembers.userId, userId))).limit(1);
    if (!member) return { success: false, error: "They’re not on this team." };
    const moved = await moveTeamMemberAction(ctx.master.id, userId, null);
    if (!moved.success) return moved;
    const [own] = await db.select({ id: tasks.id }).from(tasks).where(and(eq(tasks.assignmentId, ctx.master.id), eq(tasks.assigneeId, userId), isNull(tasks.teamName), isNull(tasks.deletedAt))).limit(1);
    return own ? excuseCopyAction(own.id, reason) : { success: true };
}

export type ReviewQueueRow = {
    /** Problem 33: the queue reads the same list as In review, so ordinary board tasks waiting come too ("task"). */
    kind: 'copy' | 'task';
    /** Reviewers (report §33.5): the viewer is one of them, or none are set. Drives the queue's Mine. */
    mine: boolean;
    copyId: string; masterId: string; title: string; who: string; submittedBy: string | null; submittedAt: string; late: boolean; href: string;
    /** The review panel (report §23.2): what was handed in, its version, steps and the private conversation. */
    projectId: string; updatedAt: string; version: number | null; link: string | null; text: string | null; note: string | null; files: string[];
    steps: { done: number; total: number }; comments: number; left: boolean;
};

/** The marking inbox across every assignment (report §16.4–16.5): oldest first, with who handed in. */
export async function readReviewQueueAction(orgId: string): Promise<{ success: true; rows: ReviewQueueRow[]; total: number } | Failure> {
    const viewer = await orgRole(orgId, 'read');
    if (!viewer || !orgCan(orgRoleOf(viewer.role), 'approve_return')) return DENIED;
    const rows = await db.execute<{ copy_id: string; master_id: string; title: string; team_name: string | null; assignee: string | null; project: string | null; submitted_by: string | null; submitted_at: string; due_date: string | null; in_org: boolean; workspace_id: string;
        updated_at: string; submission: { version?: number; link?: string | null; text?: string | null; note?: string | null } | null; files: string[] | null; steps_done: number; steps_total: number; comments: number; left_org: boolean; late_after: number | null; total: number; mine: boolean }>(sql`
        SELECT c.id AS copy_id, m.id AS master_id, m.title, c.team_name, c.updated_at::text AS updated_at, c.submission,
               (coalesce(jsonb_array_length(m.assignment_settings->'reviewers'), 0) = 0 OR m.assignment_settings->'reviewers' ? ${viewer.userId}) AS mine,
               (SELECT array_agg(f->>'name') FROM assignment_submissions s, jsonb_array_elements(s.files) f WHERE s.copy_id = c.id AND s.version = (c.submission->>'version')::int) AS files,
               (SELECT count(*) FILTER (WHERE st.completed)::int FROM task_subtasks st WHERE st.task_id = c.id) AS steps_done,
               (SELECT count(*)::int FROM task_subtasks st WHERE st.task_id = c.id) AS steps_total,
               (SELECT count(*)::int FROM task_comments tc WHERE tc.task_id = c.id AND tc.deleted_at IS NULL) AS comments,
               (c.assignee_id IS NOT NULL AND c.team_name IS NULL AND c.workspace_id = m.workspace_id
                 AND NOT EXISTS (SELECT 1 FROM workspace_members wm WHERE wm.workspace_id = m.workspace_id AND wm.user_id = c.assignee_id)) AS left_org,
               (m.assignment_settings->>'lateAfterMinutes')::int AS late_after,
               count(*) OVER ()::int AS total,
               (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = c.assignee_id) AS assignee,
               (SELECT pr.title FROM workspaces pr WHERE pr.id = c.workspace_id AND pr.id <> m.workspace_id) AS project,
               (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = (c.submission->>'by')::uuid) AS submitted_by,
               c.review_submitted_at::text AS submitted_at, c.due_date::text AS due_date,
               (SELECT pr.kind = 'organization' FROM workspaces pr WHERE pr.id = c.workspace_id) AS in_org, c.workspace_id AS workspace_id
        FROM tasks c JOIN tasks m ON m.id = c.assignment_id
        WHERE m.workspace_id = ${orgId} AND m.deleted_at IS NULL AND c.deleted_at IS NULL AND c.excused_at IS NULL AND c.review_status = 'pending'
        ORDER BY c.review_submitted_at ASC NULLS LAST LIMIT 200`);
    const tasksWaiting = await db.execute<{ id: string; title: string; assignee: string | null; submitted_at: string | null; due_date: string | null; updated_at: string; comments: number; steps_done: number; steps_total: number }>(sql`
        SELECT t.id, t.title, (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = t.assignee_id) AS assignee,
               t.review_submitted_at::text AS submitted_at, t.due_date::text AS due_date, t.updated_at::text AS updated_at,
               (SELECT count(*)::int FROM task_comments tc WHERE tc.task_id = t.id AND tc.deleted_at IS NULL) AS comments,
               (SELECT count(*) FILTER (WHERE st.completed)::int FROM task_subtasks st WHERE st.task_id = t.id) AS steps_done,
               (SELECT count(*)::int FROM task_subtasks st WHERE st.task_id = t.id) AS steps_total
        FROM tasks t WHERE t.workspace_id = ${orgId} AND t.assignment_id IS NULL AND t.kind <> 'assignment' AND t.deleted_at IS NULL AND t.review_status = 'pending'
        ORDER BY t.review_submitted_at ASC NULLS LAST LIMIT 100`);
    const taskRows: ReviewQueueRow[] = tasksWaiting.map((t) => ({
        kind: 'task', mine: true, copyId: t.id, masterId: 'tasks', title: t.title, who: t.assignee ?? 'Unassigned', submittedBy: null, submittedAt: t.submitted_at ?? t.updated_at,
        late: Boolean(t.due_date && t.submitted_at && new Date(t.submitted_at).getTime() > new Date(t.due_date).getTime()), href: assignmentHref('', t.id),
        projectId: orgId, updatedAt: new Date(t.updated_at).toISOString(), version: null, link: null, text: null, note: null, files: [],
        steps: { done: t.steps_done, total: t.steps_total }, comments: t.comments, left: false,
    }));
    return { success: true, rows: [...rows.map((r): ReviewQueueRow => ({
        kind: 'copy', mine: r.mine, copyId: r.copy_id, masterId: r.master_id, title: r.title,
        who: r.team_name ?? r.project ?? r.assignee ?? 'Member', submittedBy: r.team_name ? r.submitted_by : null,
        submittedAt: r.submitted_at, late: Boolean(r.due_date && new Date(r.submitted_at).getTime() > new Date(r.due_date).getTime() + (r.late_after ?? LATE_AFTER_DEFAULT_MINUTES) * 60_000),
        // Group work opens in its own workspace (report §42.14 problem 35, decision 133).
        href: r.in_org ? assignmentHref('', r.copy_id) : assignmentHref(`/workspaces/${r.workspace_id}`, r.copy_id),
        projectId: r.workspace_id, updatedAt: new Date(r.updated_at).toISOString(), version: r.submission?.version ?? null, link: r.submission?.link ?? null, text: r.submission?.text ?? null,
        note: r.submission?.note ?? null, files: r.files ?? [], steps: { done: r.steps_done, total: r.steps_total }, comments: r.comments, left: r.left_org,
    })), ...taskRows], total: (rows[0]?.total ?? 0) + taskRows.length };
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
