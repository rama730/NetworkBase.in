'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';
import { applicationEvents, orgEmailInvites, orgJoinBlocks, profiles, projectMembers, projectOpenRoles, projects, roleApplications, taskTeamMembers, tasks } from '@/lib/db/schema';
import { getProjectAccessById } from '@/lib/data/project-access';
import { copyState } from '@/lib/organizations/assignment-rules';
import { createCopiesForNewMember } from '@/lib/organizations/assignments';
import { ORG_LIMITS, organizationsEnabled } from '@/lib/organizations/config';
import { acceptOrgInvite, ledChildProjects, openInvitesFor, removeFromOrg } from '@/lib/organizations/members';
import { memberChangeBlock, memberStatus, parseInviteEmails, workSummary, type OrgMemberRole, type RosterRow } from '@/lib/organizations/member-rules';
import { addProjectMemberInternal, changeProjectMemberRoleInternal } from '@/lib/projects/collaborator-lifecycle';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

// Org Members (report §20): the admin roster, join requests, email invites, roles and titles, removal,
// and adding people to child projects. Notifications for all of these arrive with P14.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don't have permission to do this." };
const INVITE_DAYS = 14;

/** Owners and admins of the org (the Members tab is theirs alone in v1, report §20.8). */
async function orgManager(orgId: string): Promise<{ userId: string; role: 'owner' | 'admin'; slug: string | null; ownerId: string } | null> {
    if (!organizationsEnabled()) return null;
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const access = await getProjectAccessById(orgId, userId);
    if (access.project?.kind !== 'organization') return null;
    const role = access.isOwner ? 'owner' : access.memberRole === 'admin' ? 'admin' : null;
    return role ? { userId, role, slug: access.project.slug ?? null, ownerId: access.project.ownerId } : null;
}

const touch = (slug: string | null, id: string) => revalidatePath(`/org/${slug ?? id}`);

function parseMax(value: string | null) {
    const n = value ? Number.parseInt(value, 10) : NaN;
    return Number.isFinite(n) && n > 0 ? n : null;
}

async function rolesOf(orgId: string, ownerId: string, userIds: string[]) {
    const rows = await db.select({ userId: projectMembers.userId, role: projectMembers.role }).from(projectMembers)
        .where(and(eq(projectMembers.projectId, orgId), inArray(projectMembers.userId, userIds)));
    return new Map<string, OrgMemberRole>(rows.map((r) => [r.userId, r.userId === ownerId ? 'owner' : (r.role as OrgMemberRole)]));
}

export type OrgMembersData = {
    success: true;
    viewerRole: 'owner' | 'admin';
    joinCode: string | null;
    rows: Array<RosterRow & { avatarUrl: string | null; username: string | null }>;
    requests: Array<{ id: string; userId: string; name: string; note: string | null; createdAt: string }>;
    invites: Array<{ id: string; email: string; role: string; title: string | null; expiresAt: string }>;
    children: Array<{ id: string; title: string; units: Array<{ id: string; title: string }> }>;
    summary: { members: number; admins: number; guests: number; behind: number; notInProject: number; inactive: number };
};

/** The roster, requests, open invites and summary lines (report §20.2). Filtering happens in the browser. */
export async function readOrgMembersAction(orgId: string): Promise<OrgMembersData | Failure> {
    const viewer = await orgManager(orgId);
    if (!viewer) return DENIED;
    // ponytail: one roster read per open, sized for ORG_LIMITS.membersPerOrg (2,000). Upgrade: server paging.
    const [people, childRows, units, copies, teamCopies, requests, invites, [org]] = await Promise.all([
        db.select({ userId: projectMembers.userId, role: projectMembers.role, title: projectMembers.title, joinedAt: projectMembers.joinedAt, name: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl, lastActiveAt: profiles.lastActiveAt })
            .from(projectMembers).innerJoin(profiles, eq(profiles.id, projectMembers.userId)).where(eq(projectMembers.projectId, orgId)),
        db.select({ projectId: projects.id, title: projects.title, userId: projectMembers.userId, unit: sql<string | null>`coalesce(${projectOpenRoles.title}, ${projectOpenRoles.role})` })
            .from(projects).innerJoin(projectMembers, eq(projectMembers.projectId, projects.id)).leftJoin(projectOpenRoles, eq(projectOpenRoles.id, projectMembers.unitId))
            .where(and(eq(projects.parentId, orgId), isNull(projects.deletedAt))),
        db.select({ id: projectOpenRoles.id, projectId: projectOpenRoles.projectId, title: sql<string>`coalesce(${projectOpenRoles.title}, ${projectOpenRoles.role})` })
            .from(projectOpenRoles).innerJoin(projects, eq(projects.id, projectOpenRoles.projectId)).where(and(eq(projects.parentId, orgId), isNull(projects.deletedAt))),
        db.select({ id: tasks.id, assigneeId: tasks.assigneeId, status: tasks.status, reviewStatus: tasks.reviewStatus, dueDate: tasks.dueDate, reviewSubmittedAt: tasks.reviewSubmittedAt, completedAt: tasks.completedAt, excusedAt: tasks.excusedAt })
            .from(tasks).where(and(eq(tasks.projectId, orgId), isNotNull(tasks.assignmentId), isNull(tasks.deletedAt))),
        db.select({ taskId: taskTeamMembers.taskId, userId: taskTeamMembers.userId }).from(taskTeamMembers)
            .innerJoin(tasks, eq(tasks.id, taskTeamMembers.taskId)).where(and(eq(tasks.projectId, orgId), isNull(tasks.deletedAt))),
        db.select({ id: roleApplications.id, userId: roleApplications.applicantId, note: roleApplications.message, createdAt: roleApplications.createdAt, name: profiles.fullName, username: profiles.username })
            .from(roleApplications).innerJoin(profiles, eq(profiles.id, roleApplications.applicantId))
            .where(and(eq(roleApplications.projectId, orgId), isNull(roleApplications.roleId), eq(roleApplications.status, 'pending'))).orderBy(asc(roleApplications.createdAt)),
        db.select({ id: orgEmailInvites.id, email: orgEmailInvites.email, role: orgEmailInvites.role, title: orgEmailInvites.title, expiresAt: orgEmailInvites.expiresAt })
            .from(orgEmailInvites).where(and(eq(orgEmailInvites.orgId, orgId), isNull(orgEmailInvites.acceptedAt), gt(orgEmailInvites.expiresAt, sql`now()`))).orderBy(asc(orgEmailInvites.email)),
        db.select({ joinCode: projects.joinCode, joinCodeEnabled: projects.joinCodeEnabled }).from(projects).where(eq(projects.id, orgId)).limit(1),
    ]);

    const now = new Date();
    const stateByCopy = new Map(copies.map((c) => [c.id, copyState({ status: c.status, reviewStatus: c.reviewStatus, dueDate: c.dueDate, submittedAt: c.reviewSubmittedAt, completedAt: c.completedAt, excusedAt: c.excusedAt }, now).state]));
    const copiesByUser = new Map<string, Set<string>>();
    const addCopy = (userId: string | null, copyId: string) => {
        if (!userId) return;
        copiesByUser.set(userId, (copiesByUser.get(userId) ?? new Set()).add(copyId));
    };
    copies.forEach((c) => addCopy(c.assigneeId, c.id));
    teamCopies.forEach((t) => addCopy(t.userId, t.taskId));

    const rows = people.map((p) => {
        const role: OrgMemberRole = p.userId === viewer.ownerId ? 'owner' : (p.role as OrgMemberRole);
        const work = workSummary([...(copiesByUser.get(p.userId) ?? [])].map((id) => stateByCopy.get(id)!).filter(Boolean));
        const status = memberStatus({ missing: work.missing, lastActiveAt: p.lastActiveAt, now });
        return {
            userId: p.userId,
            name: p.name || p.username || 'Member',
            username: p.username,
            avatarUrl: p.avatarUrl,
            role,
            title: p.title,
            projects: childRows.filter((c) => c.userId === p.userId).map((c) => ({ id: c.projectId, title: c.title, unit: c.unit })),
            work,
            lastActiveAt: p.lastActiveAt?.toISOString() ?? null,
            joinedAt: p.joinedAt?.toISOString() ?? null,
            ...status,
        };
    });
    const children = [...new Map(childRows.map((c) => [c.projectId, c.title])).entries()]
        .map(([id, title]) => ({ id, title, units: units.filter((u) => u.projectId === id).map((u) => ({ id: u.id, title: u.title })) }));
    // Child projects with nobody in them yet still belong in the pickers.
    const emptyChildren = await db.select({ id: projects.id, title: projects.title }).from(projects)
        .where(and(eq(projects.parentId, orgId), isNull(projects.deletedAt)));
    for (const child of emptyChildren) if (!children.some((c) => c.id === child.id)) children.push({ id: child.id, title: child.title, units: units.filter((u) => u.projectId === child.id).map((u) => ({ id: u.id, title: u.title })) });

    return {
        success: true,
        viewerRole: viewer.role,
        joinCode: org?.joinCodeEnabled ? org.joinCode : null,
        rows,
        requests: requests.map((r) => ({ id: r.id, userId: r.userId, name: r.name || r.username || 'Someone', note: r.note, createdAt: r.createdAt.toISOString() })),
        invites: invites.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString() })),
        children: children.sort((a, b) => a.title.localeCompare(b.title)),
        summary: {
            members: rows.length,
            admins: rows.filter((r) => r.role === 'owner' || r.role === 'admin').length,
            guests: rows.filter((r) => r.role === 'viewer').length,
            behind: rows.filter((r) => r.behind).length,
            notInProject: rows.filter((r) => r.projects.length === 0).length,
            inactive: rows.filter((r) => r.inactive).length,
        },
    };
}

/** Approve one request or several ("Approve all"); Max members blocks approvals when full (report §20.5). */
export async function approveJoinRequestsAction(orgId: string, applicationIds: string[]): Promise<{ success: true; approved: number } | Failure> {
    const viewer = await orgManager(orgId);
    if (!viewer) return DENIED;
    return db.transaction(async (tx) => {
        const [org] = await tx.select({ max: projects.maxCollaborators }).from(projects).where(eq(projects.id, orgId)).for('update').limit(1);
        const pending = await tx.select({ id: roleApplications.id, userId: roleApplications.applicantId }).from(roleApplications)
            .where(and(eq(roleApplications.projectId, orgId), isNull(roleApplications.roleId), eq(roleApplications.status, 'pending'), inArray(roleApplications.id, applicationIds.slice(0, 500))));
        const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(projectMembers).where(eq(projectMembers.projectId, orgId));
        const max = parseMax(org?.max ?? null);
        if (max !== null && n + pending.length > max) return { success: false as const, error: `This organization is full (${max} members). Raise Max members in Settings first.` };
        const now = new Date();
        for (const request of pending) {
            await addProjectMemberInternal(tx, { projectId: orgId, userId: request.userId, role: 'member', actorId: viewer.userId, source: 'application_accept', applicationId: request.id });
            await createCopiesForNewMember(tx, orgId, request.userId);
            await tx.update(roleApplications).set({ status: 'accepted', decisionAt: now, decisionBy: viewer.userId, updatedAt: now }).where(eq(roleApplications.id, request.id));
            await tx.insert(applicationEvents).values({ applicationId: request.id, actorId: viewer.userId, kind: 'accepted', fromStatus: 'pending', toStatus: 'accepted', metadata: { source: 'org_request' } });
        }
        touch(viewer.slug, orgId);
        return { success: true as const, approved: pending.length };
    });
}

/** Decline with an optional reason; they may ask again after the cool-down (report §20.5). */
export async function declineJoinRequestAction(orgId: string, applicationId: string, reason?: string | null): Promise<{ success: true } | Failure> {
    const viewer = await orgManager(orgId);
    if (!viewer) return DENIED;
    const now = new Date();
    const declined = await db.update(roleApplications)
        .set({ status: 'rejected', decisionAt: now, decisionBy: viewer.userId, decisionReasonText: reason?.trim().slice(0, 500) || null, updatedAt: now })
        .where(and(eq(roleApplications.id, applicationId), eq(roleApplications.projectId, orgId), isNull(roleApplications.roleId), eq(roleApplications.status, 'pending')))
        .returning({ id: roleApplications.id });
    if (!declined.length) return { success: false, error: 'That request is no longer waiting.' };
    await db.insert(applicationEvents).values({ applicationId, actorId: viewer.userId, kind: 'rejected', fromStatus: 'pending', toStatus: 'rejected', metadata: { source: 'org_request' } });
    touch(viewer.slug, orgId);
    return { success: true };
}

const inviteSchema = z.object({
    emails: z.string().max(20_000),
    role: z.enum(['member', 'admin', 'viewer']),
    title: z.string().trim().max(60).nullable().optional(),
    childProjectId: z.string().uuid().nullable().optional(),
    unitId: z.string().uuid().nullable().optional(),
}).strict();

/**
 * Invite by email (report §20.5): Member, Admin (owner only) or Guest, an optional title, child project
 * and unit. Existing accounts accept in-app; others accept when they sign up with that address.
 */
export async function inviteByEmailAction(orgId: string, input: z.input<typeof inviteSchema>): Promise<{ success: true; invited: number; existing: number; invalid: string[] } | Failure> {
    const viewer = await orgManager(orgId);
    if (!viewer) return DENIED;
    const parsed = inviteSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Check the invite details.' };
    if (parsed.data.role === 'admin' && viewer.role !== 'owner') return { success: false, error: 'Only the owner invites admins.' };
    const { valid, invalid } = parseInviteEmails(parsed.data.emails);
    if (valid.length === 0) return { success: false, error: 'Add at least one email address.' };
    if (valid.length > ORG_LIMITS.emailInvitesPerPaste) return { success: false, error: `Up to ${ORG_LIMITS.emailInvitesPerPaste} addresses at a time.` };
    let unitId = parsed.data.unitId ?? null;
    if (parsed.data.childProjectId) {
        const [child] = await db.select({ id: projects.id }).from(projects).where(and(eq(projects.id, parsed.data.childProjectId), eq(projects.parentId, orgId), isNull(projects.deletedAt))).limit(1);
        if (!child) return { success: false, error: 'That project is no longer in this organization.' };
        if (unitId) {
            const [unit] = await db.select({ id: projectOpenRoles.id }).from(projectOpenRoles).where(and(eq(projectOpenRoles.id, unitId), eq(projectOpenRoles.projectId, child.id))).limit(1);
            unitId = unit?.id ?? null;
        }
    } else unitId = null;
    // People already in the org are skipped.
    const already = new Set((await db.select({ email: profiles.email }).from(projectMembers).innerJoin(profiles, eq(profiles.id, projectMembers.userId))
        .where(and(eq(projectMembers.projectId, orgId), inArray(profiles.email, valid)))).map((r) => r.email.toLowerCase()));
    const toInvite = valid.filter((e) => !already.has(e));
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
    for (const email of toInvite) {
        await db.insert(orgEmailInvites).values({ orgId, email, role: parsed.data.role, title: parsed.data.title || null, childProjectId: parsed.data.childProjectId ?? null, unitId, invitedBy: viewer.userId, expiresAt })
            .onConflictDoUpdate({ target: [orgEmailInvites.orgId, orgEmailInvites.email], targetWhere: sql`${orgEmailInvites.acceptedAt} IS NULL`, set: { role: parsed.data.role, title: parsed.data.title || null, childProjectId: parsed.data.childProjectId ?? null, unitId, invitedBy: viewer.userId, expiresAt } });
    }
    const existing = toInvite.length === 0 ? 0 : (await db.select({ id: profiles.id }).from(profiles).where(inArray(profiles.email, toInvite))).length;
    touch(viewer.slug, orgId);
    return { success: true, invited: toInvite.length, existing, invalid };
}

/** Resend: another 14 days (the email itself goes out with P14). */
export async function resendOrgInviteAction(orgId: string, inviteId: string): Promise<{ success: true } | Failure> {
    const viewer = await orgManager(orgId);
    if (!viewer) return DENIED;
    const updated = await db.update(orgEmailInvites).set({ expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000) })
        .where(and(eq(orgEmailInvites.id, inviteId), eq(orgEmailInvites.orgId, orgId), isNull(orgEmailInvites.acceptedAt))).returning({ id: orgEmailInvites.id });
    return updated.length ? { success: true } : { success: false, error: 'That invite is no longer open.' };
}

export async function cancelOrgInviteAction(orgId: string, inviteId: string): Promise<{ success: true } | Failure> {
    const viewer = await orgManager(orgId);
    if (!viewer) return DENIED;
    await db.delete(orgEmailInvites).where(and(eq(orgEmailInvites.id, inviteId), eq(orgEmailInvites.orgId, orgId), isNull(orgEmailInvites.acceptedAt)));
    touch(viewer.slug, orgId);
    return { success: true };
}

/** Invites waiting for the signed-in person (exact address match). */
export async function listMyOrgInvitesAction() {
    if (!organizationsEnabled()) return [];
    const { userId } = await getViewerAuthContext();
    return userId ? openInvitesFor(userId) : [];
}

export async function acceptOrgInviteAction(inviteId: string): Promise<{ success: true; orgId: string } | Failure> {
    if (!organizationsEnabled()) return DENIED;
    const { userId } = await getViewerAuthContext();
    if (!userId) return DENIED;
    const mine = (await openInvitesFor(userId)).some((i) => i.id === inviteId);
    const orgId = mine ? await acceptOrgInvite(userId, inviteId) : null;
    if (!orgId) return { success: false, error: 'That invite is no longer open.' };
    revalidatePath(`/projects/${orgId}`);
    return { success: true, orgId };
}

export async function declineOrgInviteAction(inviteId: string): Promise<{ success: true } | Failure> {
    if (!organizationsEnabled()) return DENIED;
    const { userId } = await getViewerAuthContext();
    if (!userId || !(await openInvitesFor(userId)).some((i) => i.id === inviteId)) return DENIED;
    await db.delete(orgEmailInvites).where(and(eq(orgEmailInvites.id, inviteId), isNull(orgEmailInvites.acceptedAt)));
    return { success: true };
}

/** Change role for one or many (report §20.4, §20.6). Only the owner manages admins; nobody changes the owner here. */
export async function changeMemberRoleAction(orgId: string, userIds: string[], role: 'admin' | 'member' | 'viewer'): Promise<{ success: true; changed: number } | Failure> {
    const viewer = await orgManager(orgId);
    if (!viewer || !['admin', 'member', 'viewer'].includes(role)) return DENIED;
    const roles = await rolesOf(orgId, viewer.ownerId, userIds);
    for (const id of userIds) {
        const block = roles.has(id) ? memberChangeBlock(viewer.role, roles.get(id)!, role) : 'That person is no longer a member.';
        if (block) return { success: false, error: block };
    }
    await db.transaction(async (tx) => {
        for (const id of userIds) {
            if (roles.get(id) === role) continue;
            // The lifecycle helper checks ranks against the project's own members; the owner acts for admin changes.
            await changeProjectMemberRoleInternal(tx, { projectId: orgId, actorId: viewer.ownerId, targetUserId: id, nextRole: role });
        }
    });
    touch(viewer.slug, orgId);
    return { success: true, changed: userIds.length };
}

/** Admins edit anyone's title ("Section B", "TA · Lab 2"); members edit their own in Settings (report §20.4). */
export async function setMemberTitleAction(orgId: string, userId: string, title: string | null): Promise<{ success: true } | Failure> {
    const viewer = await orgManager(orgId);
    if (!viewer) return DENIED;
    const clean = title?.trim().slice(0, 60) || null;
    const updated = await db.update(projectMembers).set({ title: clean })
        .where(and(eq(projectMembers.projectId, orgId), eq(projectMembers.userId, userId))).returning({ id: projectMembers.id });
    if (!updated.length) return { success: false, error: 'That person is no longer a member.' };
    touch(viewer.slug, orgId);
    return { success: true };
}

/**
 * Remove (report §20.7): out of the org and its child projects, unfinished copies released, handed-in work
 * kept. "Block from rejoining" stops the join code. Project leads transfer or detach their projects first.
 */
export async function removeMembersAction(orgId: string, userIds: string[], options: { block: boolean; reason?: string | null }): Promise<{ success: true; removed: number } | Failure> {
    const viewer = await orgManager(orgId);
    if (!viewer) return DENIED;
    const roles = await rolesOf(orgId, viewer.ownerId, userIds);
    for (const id of userIds) {
        if (id === viewer.userId) return { success: false, error: 'Use Leave organization to remove yourself.' };
        const block = roles.has(id) ? memberChangeBlock(viewer.role, roles.get(id)!, null) : 'That person is no longer a member.';
        if (block) return { success: false, error: block };
        if ((await ledChildProjects(db, orgId, id)).length > 0) return { success: false, error: 'This person leads a project here. Transfer or detach it first.' };
    }
    await db.transaction(async (tx) => {
        for (const id of userIds) {
            // Admins can't remove admins, so the owner acts when an admin is removed.
            await removeFromOrg(tx, orgId, id, roles.get(id) === 'admin' ? viewer.ownerId : viewer.userId);
            if (options.block) await tx.insert(orgJoinBlocks).values({ orgId, userId: id, blockedBy: viewer.userId }).onConflictDoNothing();
        }
    });
    touch(viewer.slug, orgId);
    return { success: true, removed: userIds.length };
}

/** Add to child project (report §20.6): admins add people directly, into a unit when one is picked. */
export async function addMembersToChildAction(orgId: string, childProjectId: string, userIds: string[], unitId: string | null): Promise<{ success: true; added: number } | Failure> {
    const viewer = await orgManager(orgId);
    if (!viewer) return DENIED;
    const [child] = await db.select({ id: projects.id, ownerId: projects.ownerId }).from(projects)
        .where(and(eq(projects.id, childProjectId), eq(projects.parentId, orgId), isNull(projects.deletedAt))).limit(1);
    if (!child) return { success: false, error: 'That project is no longer in this organization.' };
    if (unitId) {
        const [unit] = await db.select({ id: projectOpenRoles.id }).from(projectOpenRoles).where(and(eq(projectOpenRoles.id, unitId), eq(projectOpenRoles.projectId, child.id))).limit(1);
        if (!unit) return { success: false, error: 'That unit is no longer in the project.' };
    }
    const inOrg = await rolesOf(orgId, viewer.ownerId, userIds);
    const people = userIds.filter((id) => inOrg.has(id));
    await db.transaction(async (tx) => {
        for (const id of people) await addProjectMemberInternal(tx, { projectId: child.id, userId: id, role: 'member', actorId: child.ownerId, source: 'manual', roleId: unitId });
    });
    touch(viewer.slug, orgId);
    return { success: true, added: people.length };
}

export type MemberWorkRow = { copyId: string; title: string; dueDate: string | null; state: string; late: boolean };

/** The member drawer's Work list: their assignment copies with status (report §20.3). */
export async function readMemberWorkAction(orgId: string, userId: string): Promise<{ success: true; work: MemberWorkRow[] } | Failure> {
    const viewer = await orgManager(orgId);
    if (!viewer) return DENIED;
    const rows = await db.select({ id: tasks.id, title: tasks.title, status: tasks.status, reviewStatus: tasks.reviewStatus, dueDate: tasks.dueDate, reviewSubmittedAt: tasks.reviewSubmittedAt, completedAt: tasks.completedAt, excusedAt: tasks.excusedAt })
        .from(tasks).where(and(eq(tasks.projectId, orgId), isNotNull(tasks.assignmentId), isNull(tasks.deletedAt), or(
            eq(tasks.assigneeId, userId),
            sql`EXISTS (SELECT 1 FROM ${taskTeamMembers} tm WHERE tm.task_id = ${tasks.id} AND tm.user_id = ${userId})`,
        ))).orderBy(asc(tasks.dueDate)).limit(100);
    const now = new Date();
    return {
        success: true,
        work: rows.map((r) => ({ copyId: r.id, title: r.title, dueDate: r.dueDate?.toISOString() ?? null, ...copyState({ status: r.status, reviewStatus: r.reviewStatus, dueDate: r.dueDate, submittedAt: r.reviewSubmittedAt, completedAt: r.completedAt, excusedAt: r.excusedAt }, now) })),
    };
}
