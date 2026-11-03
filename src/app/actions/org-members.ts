'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, eq, gt, inArray, isNotNull, isNull, or, sql } from 'drizzle-orm';
import { z } from 'zod';
import { UUID_RE } from '@/lib/validations/uuid';

import { db } from '@/lib/db';
import { applicationEvents, orgEmailInvites, orgJoinBlocks, profiles, workspaceMembers, workspaceOpenRoles, workspaces, roleApplications, taskTeamMembers, tasks, userBlocks } from '@/lib/db/schema';
import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { notifyNewCopies } from '@/lib/organizations/assignment-notify';
import { copyState } from '@/lib/organizations/assignment-rules';
import { createCopiesForNewMember, handedInSql, releaseCopiesOnLeave } from '@/lib/organizations/assignments';
import { ORG_LIMITS, orgRoleNames } from '@/lib/organizations/config';
import { buildOrgEmail } from '@/lib/email/org-templates';
import { orgMemberCap } from '@/lib/organizations/join-rules';
import { acceptOrgInvite, AccountOrgLimitError, accountOrgLimit, createOrgEmailInvites, INVITE_DAYS, ledChildWorkspaces, notifyInvites, notifySeatsReopened, openInvitesFor, removeFromOrg, type ReopenedSeat } from '@/lib/organizations/members';
import { memberChangeBlock, memberStatus, parseInviteEmails, workSummary, type OrgMemberRole, type RosterRow } from '@/lib/organizations/member-rules';
import { addWorkspaceMemberInternal, changeWorkspaceMemberRoleInternal, removeWorkspaceMemberInternal } from '@/lib/workspaces/collaborator-lifecycle';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { namesOf, notifyJoined, notifyOrg, orgEmailBase, orgHref, orgLabel, queueOrgInviteSignupEmails, remindedRecently } from '@/lib/organizations/notify';
import { orgGrant, type OrgAction, type OrgRole } from '@/lib/organizations/permissions';
import { invitesLeftToday, orgLimitBlock } from '@/lib/organizations/limits';

// Org Members (report §20): the admin roster, join requests, email invites, roles and titles, removal,
// and adding people to child projects. Each change notifies the person it is about (report §26.3 A, B).

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don’t have permission to do this." };

/** Owners and admins of the org (the Members tab is theirs alone in v1, report §20.8). */
/**
 * The viewer, when the permissions table gives their role this action (report §21.3, decisions 33 and 109). Every
 * Members action names its row, and a test keeps that true. All of them are owners and admins only.
 */
async function orgManager(orgId: string, action: OrgAction, mode: 'read' | 'write' = 'write'): Promise<{ userId: string; role: 'owner' | 'admin'; slug: string | null; ownerId: string } | null> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const access = await getWorkspaceAccessById(orgId, userId);
    if (mode === 'write' && access.writeBlocked) return null;
    if (access.project?.kind !== 'organization') return null;
    const role: OrgRole = access.isOwner ? 'owner' : access.memberRole === 'admin' ? 'admin' : access.memberRole === 'member' ? 'member' : access.memberRole === 'viewer' ? 'guest' : 'visitor';
    if (orgGrant(role, action) !== 'yes' || (role !== 'owner' && role !== 'admin')) return null;
    return { userId, role, slug: access.project.slug ?? null, ownerId: access.project.ownerId };
}

const touch = (slug: string | null, id: string) => revalidatePath(`/org/${slug ?? id}`);

/** Email invites sent today, in the organization's own calendar day (report §21.4: 1,000 a day). */
async function invitesSentToday(orgId: string) {
    const [row] = await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM org_email_invites i JOIN workspaces w ON w.id = i.org_id
        WHERE i.org_id = ${orgId} AND i.created_at >= (date_trunc('day', now() AT TIME ZONE coalesce(w.time_zone, 'UTC')) AT TIME ZONE coalesce(w.time_zone, 'UTC'))`);
    return row?.n ?? 0;
}

async function rolesOf(orgId: string, ownerId: string, userIds: string[]) {
    const rows = await db.select({ userId: workspaceMembers.userId, role: workspaceMembers.role }).from(workspaceMembers)
        .where(and(eq(workspaceMembers.projectId, orgId), inArray(workspaceMembers.userId, userIds)));
    return new Map<string, OrgMemberRole>(rows.map((r) => [r.userId, r.userId === ownerId ? 'owner' : (r.role as OrgMemberRole)]));
}

export type OrgMembersData = {
    success: true;
    viewerRole: 'owner' | 'admin';
    joinCode: string | null;
    /** blockedByMe: the viewer's own personal block, shown only to them (Blocking B51). */
    rows: Array<RosterRow & { avatarUrl: string | null; username: string | null; blockedByMe: boolean; verified: boolean }>;
    requests: Array<{ id: string; userId: string; name: string; note: string | null; createdAt: string }>;
    invites: Array<{ id: string; email: string; role: string; title: string | null; expiresAt: string; expired: boolean }>;
    children: Array<{ id: string; title: string; units: Array<{ id: string; title: string }> }>;
    /** People in child projects who aren't in the org (report §20.2 Status: Outside people). */
    outside: Array<{ userId: string; name: string; username: string | null; projects: Array<{ id: string; title: string }> }>;
    summary: { members: number; admins: number; guests: number; behind: number; notInProject: number; inactive: number };
    /** "412 left today" (report §21.4). */
    invitesLeft: number;
    /** Ask to change team (report §25.5, decision 46): Move or Dismiss. */
    teamChanges: Array<{ userId: string; name: string; workspaceId: string; workspace: string; at: string }>;
};

type TeamChangeRequest = { userId: string; workspaceId: string; at: string };

/** The roster, requests, open invites and summary lines (report §20.2). Filtering happens in the browser. */
export async function readOrgMembersAction(orgId: string): Promise<OrgMembersData | Failure> {
    const viewer = await orgManager(orgId, 'members_tab', 'read');
    if (!viewer) return DENIED;
    // ponytail: one roster read per open, sized for ORG_LIMITS.membersPerOrg (2,000). Upgrade: server paging.
    const [people, childRows, units, copies, teamCopies, requests, invites, [org], myBlocks] = await Promise.all([
        db.select({ userId: workspaceMembers.userId, role: workspaceMembers.role, title: workspaceMembers.title, joinedAt: workspaceMembers.joinedAt, name: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl, lastActiveAt: workspaceMembers.lastActiveHereAt })
            .from(workspaceMembers).innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
                // Memberships are hidden while an account deletion is pending (report §30.7); back on cancel.
                .where(and(eq(workspaceMembers.projectId, orgId), isNull(profiles.deletedAt))),
        db.select({ projectId: workspaces.id, title: workspaces.title, userId: workspaceMembers.userId, unit: sql<string | null>`coalesce(${workspaceOpenRoles.title}, ${workspaceOpenRoles.role})` })
            .from(workspaces).innerJoin(workspaceMembers, eq(workspaceMembers.projectId, workspaces.id)).leftJoin(workspaceOpenRoles, eq(workspaceOpenRoles.id, workspaceMembers.unitId))
            .where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt))),
        db.select({ id: workspaceOpenRoles.id, projectId: workspaceOpenRoles.projectId, title: sql<string>`coalesce(${workspaceOpenRoles.title}, ${workspaceOpenRoles.role})` })
            .from(workspaceOpenRoles).innerJoin(workspaces, eq(workspaces.id, workspaceOpenRoles.projectId)).where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt))),
        db.select({ id: tasks.id, assigneeId: tasks.assigneeId, status: tasks.status, reviewStatus: tasks.reviewStatus, dueDate: tasks.dueDate, reviewSubmittedAt: tasks.reviewSubmittedAt, completedAt: tasks.completedAt, excusedAt: tasks.excusedAt })
            .from(tasks).where(and(eq(tasks.projectId, orgId), isNotNull(tasks.assignmentId), isNull(tasks.deletedAt))),
        db.select({ taskId: taskTeamMembers.taskId, userId: taskTeamMembers.userId }).from(taskTeamMembers)
            .innerJoin(tasks, eq(tasks.id, taskTeamMembers.taskId)).where(and(eq(tasks.projectId, orgId), isNull(tasks.deletedAt))),
        db.select({ id: roleApplications.id, userId: roleApplications.applicantId, note: roleApplications.message, createdAt: roleApplications.createdAt, name: profiles.fullName, username: profiles.username })
            .from(roleApplications).innerJoin(profiles, eq(profiles.id, roleApplications.applicantId))
            .where(and(eq(roleApplications.projectId, orgId), isNull(roleApplications.roleId), eq(roleApplications.status, 'pending'),
                // A join request goes to an admin who isn't in a block with the person, when there is one (Blocking B37, D4).
                sql`NOT app_private.review_hidden_by_block(${viewer.userId}::uuid, ${roleApplications.applicantId}, ${orgId}::uuid)`)).orderBy(asc(roleApplications.createdAt)),
        db.select({ id: orgEmailInvites.id, email: orgEmailInvites.email, role: orgEmailInvites.role, title: orgEmailInvites.title, expiresAt: orgEmailInvites.expiresAt })
            // Report §26.3: expired invites stay listed, marked, with Resend, so nobody disappears silently.
            .from(orgEmailInvites).where(and(eq(orgEmailInvites.orgId, orgId), isNull(orgEmailInvites.acceptedAt))).orderBy(asc(orgEmailInvites.email)),
        db.select({ joinCode: workspaces.joinCode, joinCodeEnabled: workspaces.joinCodeEnabled, teamChangeRequests: sql<TeamChangeRequest[] | null>`${workspaces.orgSettings}->'teamChangeRequests'` }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1),
        db.select({ id: userBlocks.blockedId }).from(userBlocks).where(eq(userBlocks.blockerId, viewer.userId)),
    ]);
    const blockedByMe = new Set(myBlocks.map((b) => b.id));
    // Contribution credit (report §31.4): a ✓ on the row, and the Verified filter.
    const verified = new Set((await db.execute<{ id: string }>(sql`
        SELECT profile_id AS id FROM profile_contributions WHERE workspace_id = ${orgId} AND verified_at IS NOT NULL AND deleted_at IS NULL`)).map((r) => r.id));

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
        // Last active here only, never account-wide (decision 62).
        const status = memberStatus({ missing: work.missing, lastActiveAt: p.lastActiveAt, joinedAt: p.joinedAt, now });
        return {
            userId: p.userId,
            name: p.name || p.username || 'Member',
            username: p.username,
            avatarUrl: p.avatarUrl,
            blockedByMe: blockedByMe.has(p.userId),
            verified: verified.has(p.userId),
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
    const emptyChildren = await db.select({ id: workspaces.id, title: workspaces.title }).from(workspaces)
        .where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt)));
    for (const child of emptyChildren) if (!children.some((c) => c.id === child.id)) children.push({ id: child.id, title: child.title, units: units.filter((u) => u.projectId === child.id).map((u) => ({ id: u.id, title: u.title })) });
    const outside = await db.execute<{ user_id: string; name: string | null; username: string | null; projects: Array<{ id: string; title: string }> }>(sql`
        SELECT m.user_id, coalesce(pr.full_name, pr.username) AS name, pr.username, json_agg(json_build_object('id', p.id, 'title', p.title) ORDER BY p.title) AS projects
        FROM workspace_members m JOIN workspaces p ON p.id = m.workspace_id AND p.parent_id = ${orgId} AND p.deleted_at IS NULL
        JOIN profiles pr ON pr.id = m.user_id
        WHERE NOT EXISTS (SELECT 1 FROM workspace_members o WHERE o.workspace_id = ${orgId} AND o.user_id = m.user_id) AND m.user_id <> ${viewer.ownerId}
        GROUP BY m.user_id, pr.full_name, pr.username ORDER BY 2 LIMIT 500`);
    // Still waiting only while they're in that workspace.
    const titles = new Map(children.map((c) => [c.id, c.title]));
    const teamChanges = (org?.teamChangeRequests ?? []).flatMap((r) => {
        const person = rows.find((p) => p.userId === r.userId);
        return person && titles.has(r.workspaceId) && person.projects.some((x) => x.id === r.workspaceId)
            ? [{ userId: r.userId, name: person.name, workspaceId: r.workspaceId, workspace: titles.get(r.workspaceId)!, at: r.at }] : [];
    });

    return {
        success: true,
        viewerRole: viewer.role,
        joinCode: org?.joinCodeEnabled ? org.joinCode : null,
        rows,
        requests: requests.map((r) => ({ id: r.id, userId: r.userId, name: r.name || r.username || 'Someone', note: r.note, createdAt: r.createdAt.toISOString() })),
        invites: invites.map((i) => ({ ...i, expiresAt: i.expiresAt.toISOString(), expired: i.expiresAt.getTime() <= now.getTime() })),
        children: children.sort((a, b) => a.title.localeCompare(b.title)),
        outside: outside.map((o) => ({ userId: o.user_id, name: o.name || 'Someone', username: o.username, projects: o.projects })),
        summary: {
            members: rows.length,
            admins: rows.filter((r) => r.role === 'owner' || r.role === 'admin').length,
            guests: rows.filter((r) => r.role === 'viewer').length,
            behind: rows.filter((r) => r.behind).length,
            notInProject: rows.filter((r) => r.projects.length === 0).length,
            inactive: rows.filter((r) => r.inactive).length,
        },
        invitesLeft: invitesLeftToday(await invitesSentToday(orgId)),
        teamChanges,
    };
}

/** Dismiss a change-team request (report §25.5): nobody is told. */
export async function dismissTeamChangeAction(orgId: string, userId: string, workspaceId: string): Promise<{ success: true } | Failure> {
    const viewer = await orgManager(orgId, 'handle_team_change');
    if (!viewer) return DENIED;
    await dropTeamChange(orgId, userId, workspaceId);
    touch(viewer.slug, orgId);
    return { success: true };
}

async function dropTeamChange(orgId: string, userId: string, workspaceId: string) {
    await db.execute(sql`
        UPDATE workspaces SET org_settings = jsonb_set(org_settings, '{teamChangeRequests}', coalesce(
            (SELECT jsonb_agg(r) FROM jsonb_array_elements(org_settings->'teamChangeRequests') r WHERE NOT (r->>'userId' = ${userId} AND r->>'workspaceId' = ${workspaceId})), '[]'::jsonb))
        WHERE id = ${orgId} AND org_settings ? 'teamChangeRequests'`);
}

/** Seats left in a team for these people, or the message refusing them (report §25.6). */
async function seatBlock(executor: Pick<typeof db, 'select'>, unitId: string, userIds: string[]) {
    const [unit] = await executor.select({ title: sql<string>`coalesce(${workspaceOpenRoles.title}, ${workspaceOpenRoles.role})`, count: workspaceOpenRoles.count, filled: workspaceOpenRoles.filled })
        .from(workspaceOpenRoles).where(eq(workspaceOpenRoles.id, unitId)).limit(1);
    if (!unit) return 'That team is no longer in the workspace.';
    const already = userIds.length ? await executor.select({ id: workspaceMembers.userId }).from(workspaceMembers).where(and(eq(workspaceMembers.unitId, unitId), inArray(workspaceMembers.userId, userIds))) : [];
    const open = Math.max(0, unit.count - unit.filled);
    const coming = userIds.length - already.length;
    if (coming <= open) return null;
    return `${unit.title} has ${open} open seat${open === 1 ? '' : 's'}. Add seats first, or choose fewer people.`;
}

/**
 * Move to another workspace (report §25.5): organization admins only. They leave the old one with its open tasks
 * unassigned; the old lead hears only that a seat opened, never where they went. They're told where they are now.
 */
export async function moveMemberToWorkspaceAction(orgId: string, userId: string, fromChildId: string, toChildId: string, unitId: string | null): Promise<{ success: true } | Failure> {
    const viewer = await orgManager(orgId, 'move_member_workspace');
    if (!viewer) return DENIED;
    if (fromChildId === toChildId) return { success: false, error: 'Pick a different workspace.' };
    const kids = await db.select({ id: workspaces.id, ownerId: workspaces.ownerId, title: workspaces.title, slug: workspaces.slug }).from(workspaces)
        .where(and(inArray(workspaces.id, [fromChildId, toChildId]), eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt)));
    const from = kids.find((k) => k.id === fromChildId);
    const to = kids.find((k) => k.id === toChildId);
    if (!from || !to) return { success: false, error: 'That workspace is no longer in this organization.' };
    if (userId === from.ownerId) return { success: false, error: 'They’re its workspace lead. They hand it over first.' };
    if (!(await rolesOf(orgId, viewer.ownerId, [userId])).has(userId)) return { success: false, error: 'Only organization members can be moved.' };
    if (unitId) {
        const [unit] = await db.select({ id: workspaceOpenRoles.id }).from(workspaceOpenRoles).where(and(eq(workspaceOpenRoles.id, unitId), eq(workspaceOpenRoles.projectId, to.id))).limit(1);
        if (!unit) return { success: false, error: 'That team is no longer in the workspace.' };
        const full = await seatBlock(db, unitId, [userId]);
        if (full) return { success: false, error: full };
    }
    let seat: string | null = null;
    try {
        await db.transaction(async (tx) => {
            const [member] = await tx.select({ unit: sql<string | null>`(SELECT coalesce(r.title, r.role) FROM workspace_open_roles r WHERE r.id = ${workspaceMembers.unitId})` })
                .from(workspaceMembers).where(and(eq(workspaceMembers.projectId, from.id), eq(workspaceMembers.userId, userId))).limit(1);
            if (!member) throw new Error('They’re no longer in that workspace.');
            seat = member.unit ?? from.title;
            // Org admins act with the lead's powers in child projects (report §29.4).
            await removeWorkspaceMemberInternal(tx, { projectId: from.id, actorId: from.ownerId, targetUserId: userId, mode: 'unassign_active_tasks' });
            await addWorkspaceMemberInternal(tx, { projectId: to.id, userId, role: 'member', actorId: to.ownerId, source: 'manual', roleId: unitId });
        });
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Couldn’t move them.' };
    }
    await dropTeamChange(orgId, userId, from.id);
    touch(viewer.slug, orgId);
    await notifyOrg({ orgId, eventKey: 'org.child_notice', to: [from.ownerId], title: `1 seat open in ${seat}`,
        href: `/workspaces/${encodeURIComponent(from.slug ?? from.id)}?tab=settings`, sourceEventId: `seat:${from.id}:${userId}:${Date.now()}`, refs: { projectId: from.id } });
    await notifyOrg({ orgId, eventKey: 'org.child_added', actorId: viewer.userId, to: [userId], title: `You were moved to ${to.title}`,
        href: `/workspaces/${encodeURIComponent(to.slug ?? to.id)}`, sourceEventId: `child:${to.id}:${userId}:${Date.now()}`, refs: { projectId: to.id } });
    return { success: true };
}

/** Approve one request or several ("Approve all"); Max members blocks approvals when full (report §20.5). */
export async function approveJoinRequestsAction(orgId: string, applicationIds: string[]): Promise<{ success: true; approved: number; atLimit: number } | Failure> {
    const viewer = await orgManager(orgId, 'review_join_requests');
    if (!viewer) return DENIED;
    const result = await db.transaction(async (tx) => {
        const [org] = await tx.select({ max: workspaces.maxCollaborators }).from(workspaces).where(eq(workspaces.id, orgId)).for('update').limit(1);
        const pending = await tx.select({ id: roleApplications.id, userId: roleApplications.applicantId }).from(roleApplications)
            .where(and(eq(roleApplications.projectId, orgId), isNull(roleApplications.roleId), eq(roleApplications.status, 'pending'), inArray(roleApplications.id, applicationIds.slice(0, 500))));
        const [{ n } = { n: 0 }] = await tx.select({ n: sql<number>`count(*)::int` }).from(workspaceMembers).where(eq(workspaceMembers.projectId, orgId));
        const max = orgMemberCap(org?.max ?? null);
        if (n + pending.length > max) return { success: false as const, error: `This organization is full (${max} members). Raise Max members in Settings first.` };
        const now = new Date();
        const added: typeof pending = [];
        for (const request of pending) {
            // Someone already in 50 organizations stays waiting (report §26.11), and isn't told they're in.
            if (await accountOrgLimit(tx, request.userId, 'join')) continue;
            added.push(request);
            await addWorkspaceMemberInternal(tx, { projectId: orgId, userId: request.userId, role: 'member', actorId: viewer.userId, source: 'application_accept', applicationId: request.id });
            await createCopiesForNewMember(tx, orgId, request.userId);
            await tx.update(roleApplications).set({ status: 'accepted', decisionAt: now, decisionBy: viewer.userId, updatedAt: now }).where(eq(roleApplications.id, request.id));
            await tx.insert(applicationEvents).values({ applicationId: request.id, actorId: viewer.userId, kind: 'accepted', fromStatus: 'pending', toStatus: 'accepted', metadata: { source: 'org_request' } });
        }
        touch(viewer.slug, orgId);
        return { success: true as const, approved: added.length, atLimit: pending.length - added.length, pending: added };
    });
    if (!result.success) return result;
    const org = await orgLabel(orgId);
    if (org) {
        for (const request of result.pending) {
            await notifyOrg({
                orgId, eventKey: 'org.join_decided', actorId: viewer.userId, to: [request.userId], title: `You’re in ${org.title}`,
                href: orgHref(org), sourceEventId: `${request.id}:accepted`, email: { kind: 'org_welcome', data: { note: org.welcomeNote } },
            });
            await notifyNewCopies(orgId, { userId: request.userId });
        }
    }
    return { success: true, approved: result.approved, atLimit: result.atLimit };
}

/** Decline with an optional reason; they may ask again after the cool-down (report §20.5). */
export async function declineJoinRequestAction(orgId: string, applicationId: string, reason?: string | null): Promise<{ success: true } | Failure> {
    const viewer = await orgManager(orgId, 'review_join_requests');
    if (!viewer) return DENIED;
    const now = new Date();
    const declined = await db.update(roleApplications)
        .set({ status: 'rejected', decisionAt: now, decisionBy: viewer.userId, decisionReasonText: reason?.trim().slice(0, 500) || null, updatedAt: now })
        .where(and(eq(roleApplications.id, applicationId), eq(roleApplications.projectId, orgId), isNull(roleApplications.roleId), eq(roleApplications.status, 'pending')))
        .returning({ id: roleApplications.id, userId: roleApplications.applicantId, reason: roleApplications.decisionReasonText });
    if (!declined.length) return { success: false, error: 'That request is no longer waiting.' };
    await db.insert(applicationEvents).values({ applicationId, actorId: viewer.userId, kind: 'rejected', fromStatus: 'pending', toStatus: 'rejected', metadata: { source: 'org_request' } });
    touch(viewer.slug, orgId);
    const org = await orgLabel(orgId);
    if (org) {
        await notifyOrg({
            orgId, eventKey: 'org.join_decided', actorId: viewer.userId, to: [declined[0]!.userId],
            title: `Your request to join ${org.title} was declined${declined[0]!.reason ? `: ${declined[0]!.reason}` : ''}`,
            href: orgHref(org), sourceEventId: `${applicationId}:declined`,
        });
    }
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
    const viewer = await orgManager(orgId, 'invite_members_guests');
    if (!viewer) return DENIED;
    const parsed = inviteSchema.safeParse(input);
    if (!parsed.success) return { success: false, error: 'Check the invite details.' };
    if (parsed.data.role === 'admin' && viewer.role !== 'owner') return { success: false, error: 'Only the owner invites admins.' };
    const { valid, invalid } = parseInviteEmails(parsed.data.emails);
    if (valid.length === 0) return { success: false, error: 'Add at least one email address.' };
    if (valid.length > ORG_LIMITS.emailInvitesPerPaste) return { success: false, error: `You pasted ${valid.length}. Up to ${ORG_LIMITS.emailInvitesPerPaste} at a time.` };
    // Report §21.4: 1,000 a day, checked before anything is sent so nothing goes half out.
    const left = invitesLeftToday(await invitesSentToday(orgId));
    if (valid.length > left) return { success: false, error: left === 0 ? 'No invites left today. Try again tomorrow.' : `${left} ${left === 1 ? 'invite' : 'invites'} left today. Send fewer at once.` };
    let unitId = parsed.data.unitId ?? null;
    if (parsed.data.childProjectId) {
        const [child] = await db.select({ id: workspaces.id }).from(workspaces).where(and(eq(workspaces.id, parsed.data.childProjectId), eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt))).limit(1);
        if (!child) return { success: false, error: 'That workspace is no longer in this organization.' };
        if (unitId) {
            const [unit] = await db.select({ id: workspaceOpenRoles.id }).from(workspaceOpenRoles).where(and(eq(workspaceOpenRoles.id, unitId), eq(workspaceOpenRoles.projectId, child.id))).limit(1);
            unitId = unit?.id ?? null;
        }
    } else unitId = null;
    const sent = await createOrgEmailInvites(orgId, viewer.userId, { emails: valid, role: parsed.data.role, title: parsed.data.title || null, childProjectId: parsed.data.childProjectId ?? null, unitId });
    touch(viewer.slug, orgId);
    return { success: true, invited: sent.invited, existing: sent.existing, invalid };
}

/** Resend: another 14 days (the email itself goes out with P14). */
export async function resendOrgInviteAction(orgId: string, inviteId: string): Promise<{ success: true } | Failure> {
    const viewer = await orgManager(orgId, 'invite_members_guests');
    if (!viewer) return DENIED;
    const expiresAt = new Date(Date.now() + INVITE_DAYS * 86_400_000);
    const updated = await db.update(orgEmailInvites).set({ expiresAt })
        .where(and(eq(orgEmailInvites.id, inviteId), eq(orgEmailInvites.orgId, orgId), isNull(orgEmailInvites.acceptedAt)))
        .returning({ id: orgEmailInvites.id, email: orgEmailInvites.email, role: orgEmailInvites.role, title: orgEmailInvites.title });
    if (!updated.length) return { success: false, error: 'That invite is no longer open.' };
    const invite = updated[0]!;
    const accounts = await db.select({ id: profiles.id, email: profiles.email }).from(profiles).where(eq(profiles.email, invite.email));
    // A resend is a new event: its own key, so the email goes out again.
    await notifyInvites(orgId, viewer.userId, [invite], accounts, { role: invite.role, title: invite.title, expiresAt }, `:resend:${expiresAt.getTime()}`);
    return { success: true };
}

export async function cancelOrgInviteAction(orgId: string, inviteId: string): Promise<{ success: true } | Failure> {
    const viewer = await orgManager(orgId, 'invite_members_guests');
    if (!viewer) return DENIED;
    await db.delete(orgEmailInvites).where(and(eq(orgEmailInvites.id, inviteId), eq(orgEmailInvites.orgId, orgId), isNull(orgEmailInvites.acceptedAt)));
    touch(viewer.slug, orgId);
    return { success: true };
}

/** Invites waiting for the signed-in person (exact address match). */
export async function listMyOrgInvitesAction() {
    const { userId } = await getViewerAuthContext();
    return userId ? openInvitesFor(userId) : [];
}

export async function acceptOrgInviteAction(inviteId: string): Promise<{ success: true; orgId: string } | Failure> {
    const { userId } = await getViewerAuthContext();
    if (!userId) return DENIED;
    const mine = (await openInvitesFor(userId)).some((i) => i.id === inviteId);
    // Only the account-limit sentence is shown; anything else stays a redacted server error.
    const accepted = mine ? await acceptOrgInvite(userId, inviteId).catch((error: unknown) => { if (error instanceof AccountOrgLimitError) return error; throw error }) : null;
    if (accepted instanceof AccountOrgLimitError) return { success: false, error: accepted.message };
    if (accepted && 'full' in accepted) return { success: false, error: 'This organization is full. Ask an admin to raise Max members.' };
    if (!accepted) return { success: false, error: 'That invite is no longer open.' };
    const { orgId } = accepted;
    revalidatePath(`/workspaces/${orgId}`);
    await notifyJoined(orgId, userId, `${inviteId}:accepted`);
    return { success: true, orgId };
}

export async function declineOrgInviteAction(inviteId: string): Promise<{ success: true } | Failure> {
    const { userId } = await getViewerAuthContext();
    if (!userId || !(await openInvitesFor(userId)).some((i) => i.id === inviteId)) return DENIED;
    await db.delete(orgEmailInvites).where(and(eq(orgEmailInvites.id, inviteId), isNull(orgEmailInvites.acceptedAt)));
    return { success: true };
}

/** Change role for one or many (report §20.4, §20.6). Only the owner manages admins; nobody changes the owner here. */
export async function changeMemberRoleAction(orgId: string, userIds: string[], role: 'admin' | 'member' | 'viewer'): Promise<{ success: true; changed: number } | Failure> {
    const viewer = await orgManager(orgId, 'change_member_viewer_role');
    if (!viewer || !['admin', 'member', 'viewer'].includes(role)) return DENIED;
    if (userIds.includes(viewer.userId)) return { success: false, error: 'You can’t change your own role. Use Leave instead.' };
    const roles = await rolesOf(orgId, viewer.ownerId, userIds);
    for (const id of userIds) {
        const block = roles.has(id) ? memberChangeBlock(viewer.role, roles.get(id)!, role) : 'That person is no longer a member.';
        if (block) return { success: false, error: block };
        // Viewers can't be on a workspace, so a lead transfers first (report §36.2).
        const led = role === 'viewer' ? await ledChildWorkspaces(db, orgId, id) : [];
        if (led[0]) return { success: false, error: `Transfer ${led[0].title} first.` };
    }
    if (role === 'admin') {
        // Report §21.4: 20 admins, checked before anyone changes.
        const [{ n } = { n: 0 }] = await db.select({ n: sql<number>`count(*)::int` }).from(workspaceMembers).where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.role, 'admin')));
        const adding = userIds.filter((id) => roles.get(id) !== 'admin').length;
        const org = adding ? await orgLabel(orgId) : null;
        const block = adding ? orgLimitBlock('admins', n + adding - 1, { org: org?.title ?? 'This organization', isAdmin: true }) : null;
        if (block) return { success: false, error: block };
    }
    const seats = await db.transaction(async (tx) => {
        const opened: ReopenedSeat[] = [];
        for (const id of userIds) {
            const before = roles.get(id);
            if (before === role) continue;
            // The lifecycle helper checks ranks against the project's own members; the owner acts for admin changes.
            await changeWorkspaceMemberRoleInternal(tx, { projectId: orgId, actorId: viewer.ownerId, targetUserId: id, nextRole: role });
            // Report §36.2: admins and viewers hold no copies (handed-in work stays); becoming Member brings open ones.
            if (before === 'member') await releaseCopiesOnLeave(tx, orgId, id);
            if (role === 'member') await createCopiesForNewMember(tx, orgId, id);
            if (role === 'viewer') opened.push(...await leaveChildWorkspaces(tx, orgId, id));
        }
        return opened;
    });
    touch(viewer.slug, orgId);
    const org = await orgLabel(orgId);
    const changed = userIds.filter((id) => roles.get(id) !== role);
    if (org && changed.length) {
        await notifyOrg({
            orgId, eventKey: 'org.role_changed', actorId: viewer.userId, to: changed, title: `Your role in ${org.title} is now ${org.roleNames[role]}`, body: ROLE_CHANGE_NOTE[role],
            href: orgHref(org), sourceEventId: `role:${role}:${Date.now()}`,
        });
        if (role === 'member') for (const id of changed) await notifyNewCopies(orgId, { userId: id });
    }
    await notifySeatsReopened(orgId, seats);
    return { success: true, changed: userIds.length };
}

/** What the new role means, in the notice (report §36.2 "Told"). */
const ROLE_CHANGE_NOTE: Record<'admin' | 'member' | 'viewer', string> = {
    admin: 'You can now review work, except your own. Your open assignments were removed; handed-in work stays in your record.',
    member: 'Open assignments are now on your list.',
    viewer: 'You can read here, without posting or handing in work. Your open assignments were removed; handed-in work stays.',
};

/** Out of every workspace here, open tasks unassigned (a Viewer, report §36.2); returns the team seats it opened. */
async function leaveChildWorkspaces(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], orgId: string, userId: string): Promise<ReopenedSeat[]> {
    const rows = await tx.select({ projectId: workspaceMembers.projectId, leadId: workspaces.ownerId, slug: workspaces.slug, unit: sql<string | null>`(SELECT coalesce(r.title, r.role) FROM workspace_open_roles r WHERE r.id = ${workspaceMembers.unitId})` })
        .from(workspaceMembers).innerJoin(workspaces, eq(workspaces.id, workspaceMembers.projectId))
        .where(and(eq(workspaces.parentId, orgId), eq(workspaceMembers.userId, userId), isNull(workspaces.deletedAt)));
    for (const r of rows) await removeWorkspaceMemberInternal(tx, { projectId: r.projectId, actorId: r.leadId, targetUserId: userId, mode: 'unassign_active_tasks' });
    return rows.flatMap((r) => (r.unit ? [{ projectId: r.projectId, slug: r.slug, leadId: r.leadId, unit: r.unit }] : []));
}

/** Open copies a person holds, and handed-in ones, for the role and Remove dialogs (report §36.2, §36.5). */
async function copyCounts(orgId: string, userIds: string[]) {
    if (!userIds.length) return { open: 0, handedIn: 0 };
    const [row] = await db.select({
        open: sql<number>`count(*) FILTER (WHERE NOT ${handedInSql})::int`,
        handedIn: sql<number>`count(*) FILTER (WHERE ${handedInSql})::int`,
    }).from(tasks).where(and(eq(tasks.projectId, orgId), inArray(tasks.assigneeId, userIds), isNotNull(tasks.assignmentId), isNull(tasks.deletedAt)));
    return { open: row?.open ?? 0, handedIn: row?.handedIn ?? 0 };
}

/** Workspaces each person leads here, by name: they transfer those first. */
async function leadsOf(orgId: string, userIds: string[]) {
    const rows = userIds.length ? await db.select({ userId: workspaces.ownerId, title: workspaces.title, slug: workspaces.slug, id: workspaces.id }).from(workspaces)
        .where(and(eq(workspaces.parentId, orgId), inArray(workspaces.ownerId, userIds), isNull(workspaces.deletedAt))) : [];
    const names = await namesOf([...new Set(rows.map((r) => r.userId))]);
    return rows.map((r) => ({ userId: r.userId, name: names.get(r.userId) ?? 'Someone', workspace: r.title, workspaceId: r.id, slug: r.slug }));
}

type RoleChangePreview = { success: true; people: number; openRemoved: number; submittedKept: number; gainsOpen: number; leads: Awaited<ReturnType<typeof leadsOf>> };

/**
 * The role dialog's list (report §36.2): open copies removed and handed-in ones kept (Member to Admin or Viewer),
 * open assignments gained (to Member), and leads refused before Viewer.
 */
export async function readRoleChangePreviewAction(orgId: string, userIds: string[], role: 'admin' | 'member' | 'viewer'): Promise<RoleChangePreview | Failure> {
    const viewer = await orgManager(orgId, 'change_member_viewer_role', 'read');
    if (!viewer) return DENIED;
    const roles = await rolesOf(orgId, viewer.ownerId, userIds);
    const changing = userIds.filter((id) => roles.has(id) && roles.get(id) !== role);
    const losing = role === 'member' ? [] : changing.filter((id) => roles.get(id) === 'member');
    const counts = await copyCounts(orgId, losing);
    const [gains] = role === 'member' && changing.length ? await db.execute<{ n: number }>(sql`
        SELECT count(*)::int AS n FROM tasks WHERE workspace_id = ${orgId} AND kind = 'assignment' AND assignment_id IS NULL AND deleted_at IS NULL
          AND assignment_settings->>'publishedAt' IS NOT NULL AND assignment_settings->>'closedAt' IS NULL AND (due_date IS NULL OR due_date > now())
          AND (assignment_settings->'target'->>'mode' = 'everyone' OR (assignment_settings->'target'->>'mode' = 'role' AND assignment_settings->'target'->>'role' = 'member'))`) : [];
    return {
        success: true, people: changing.length, openRemoved: counts.open, submittedKept: counts.handedIn, gainsOpen: gains?.n ?? 0,
        leads: role === 'viewer' ? await leadsOf(orgId, changing) : [],
    };
}

type RemovalPreview = {
    success: true; people: number; workspaces: number; seats: number; openRemoved: number; submittedKept: number; tasks: number;
    skipped: Array<{ userId: string; name: string; workspaces: string[] }>;
};

/**
 * The Remove dialog's list (report §36.5): totals for everyone it can remove; workspace leads are listed and left out.
 */
export async function readRemovalPreviewAction(orgId: string, userIds: string[]): Promise<RemovalPreview | Failure> {
    const viewer = await orgManager(orgId, 'remove_members_guests', 'read');
    if (!viewer) return DENIED;
    const roles = await rolesOf(orgId, viewer.ownerId, userIds);
    const leads = await leadsOf(orgId, userIds);
    const leading = new Set(leads.map((l) => l.userId));
    const going = userIds.filter((id) => roles.has(id) && !leading.has(id) && !memberChangeBlock(viewer.role, roles.get(id)!, null) && id !== viewer.userId);
    const counts = await copyCounts(orgId, going);
    const [places] = going.length ? await db.execute<{ workspaces: number; seats: number; tasks: number }>(sql`
        SELECT count(DISTINCT m.workspace_id)::int AS workspaces, count(m.unit_id)::int AS seats,
          (SELECT count(*)::int FROM tasks t JOIN workspaces c ON c.id = t.workspace_id AND (c.id = ${orgId} OR c.parent_id = ${orgId})
           WHERE t.assignee_id IN ${going} AND t.assignment_id IS NULL AND t.deleted_at IS NULL AND t.kind <> 'assignment' AND t.status <> 'done') AS tasks
        FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id AND w.parent_id = ${orgId} AND w.deleted_at IS NULL
        WHERE m.user_id IN ${going}`) : [];
    return {
        success: true, people: going.length, workspaces: places?.workspaces ?? 0, seats: places?.seats ?? 0, openRemoved: counts.open, submittedKept: counts.handedIn, tasks: places?.tasks ?? 0,
        skipped: [...new Set(leads.map((l) => l.userId))].map((id) => ({ userId: id, name: leads.find((l) => l.userId === id)!.name, workspaces: leads.filter((l) => l.userId === id).map((l) => l.workspace) })),
    };
}

export type FormerMember = { userId: string; name: string; how: 'left' | 'removed' | 'term_ended' | 'org_deleted'; at: string; by: string | null; note: string | null; blocked: boolean; done: number; total: number };

/** Members → Status → Former (report §36.4): how it ended, when, who, the reason written, and what they did. Admins only. */
export async function readFormerMembersAction(orgId: string): Promise<{ success: true; rows: FormerMember[] } | Failure> {
    const viewer = await orgManager(orgId, 'see_former', 'read');
    if (!viewer) return DENIED;
    const rows = await db.execute<{ user_id: string; name: string | null; gone: boolean; end_reason: FormerMember['how'] | null; ended_at: Date | string; by_name: string | null; end_note: string | null; blocked: boolean; done: number; total: number }>(sql`
        SELECT c.profile_id AS user_id, coalesce(p.full_name, p.username) AS name, p.deleted_at IS NOT NULL AS gone, c.end_reason, c.ended_at, c.end_note,
               coalesce(b.full_name, b.username) AS by_name,
               EXISTS (SELECT 1 FROM org_join_blocks j WHERE j.org_id = ${orgId} AND j.user_id = c.profile_id) AS blocked,
               (SELECT count(*) FILTER (WHERE t.status = 'done')::int FROM tasks t WHERE t.workspace_id = ${orgId} AND t.assignee_id = c.profile_id AND t.assignment_id IS NOT NULL AND t.deleted_at IS NULL) AS done,
               (SELECT count(*)::int FROM tasks t WHERE t.workspace_id = ${orgId} AND t.assignee_id = c.profile_id AND t.assignment_id IS NOT NULL AND t.deleted_at IS NULL) AS total
        FROM profile_contributions c LEFT JOIN profiles p ON p.id = c.profile_id LEFT JOIN profiles b ON b.id = c.ended_by
        WHERE c.workspace_id = ${orgId} AND c.ended_at IS NOT NULL AND c.deleted_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM workspace_members m WHERE m.workspace_id = ${orgId} AND m.user_id = c.profile_id)
        ORDER BY c.ended_at DESC LIMIT 500`);
    return {
        success: true,
        rows: rows.map((r) => ({
            userId: r.user_id, name: r.gone ? 'Deleted user' : r.name || 'Someone', how: r.end_reason ?? 'left', at: new Date(r.ended_at).toISOString(),
            by: r.end_reason === 'removed' ? r.by_name : null, note: r.end_note, blocked: r.blocked, done: r.done, total: r.total,
        })),
    };
}

/** Invite back from Former (report §36.4): an invitation to their account's address; a blocked person is unblocked first. */
export async function inviteFormerMemberAction(orgId: string, userId: string): Promise<{ success: true } | Failure> {
    const viewer = await orgManager(orgId, 'invite_back_unblock');
    if (!viewer) return DENIED;
    if ((await rolesOf(orgId, viewer.ownerId, [userId])).has(userId)) return { success: false, error: 'They’re already a member.' };
    const [blocked] = await db.select({ id: orgJoinBlocks.userId }).from(orgJoinBlocks).where(and(eq(orgJoinBlocks.orgId, orgId), eq(orgJoinBlocks.userId, userId))).limit(1);
    if (blocked) return { success: false, error: 'Unblock them first.' };
    const [person] = await db.select({ email: profiles.email }).from(profiles).where(and(eq(profiles.id, userId), isNull(profiles.deletedAt))).limit(1);
    if (!person?.email) return { success: false, error: 'This account no longer exists.' };
    await createOrgEmailInvites(orgId, viewer.userId, { emails: [person.email], role: 'member', title: null, childProjectId: null, unitId: null });
    touch(viewer.slug, orgId);
    return { success: true };
}

/** Outside people (report §36.3): an admin removes one from a workspace here; its lead is told. */
export async function removeOutsidePersonAction(orgId: string, userId: string, workspaceId: string): Promise<{ success: true } | Failure> {
    const viewer = await orgManager(orgId, 'remove_outside_person');
    if (!viewer) return DENIED;
    if ((await rolesOf(orgId, viewer.ownerId, [userId])).has(userId)) return { success: false, error: 'They’re a member of this organization. Use Remove instead.' };
    const [child] = await db.select({ id: workspaces.id, ownerId: workspaces.ownerId, title: workspaces.title, slug: workspaces.slug }).from(workspaces)
        .where(and(eq(workspaces.id, workspaceId), eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt))).limit(1);
    if (!child) return { success: false, error: 'That workspace is no longer in this organization.' };
    if (child.ownerId === userId) return { success: false, error: 'They’re its workspace lead.' };
    try {
        await db.transaction((tx) => removeWorkspaceMemberInternal(tx, { projectId: child.id, actorId: child.ownerId, targetUserId: userId, mode: 'unassign_active_tasks' }));
    } catch {
        return { success: false, error: 'They’re no longer in that workspace.' };
    }
    touch(viewer.slug, orgId);
    const name = (await namesOf([userId])).get(userId) ?? 'Someone';
    const stamp = Date.now();
    await notifyOrg({ orgId, eventKey: 'org.child_notice', actorId: viewer.userId, to: [child.ownerId], title: `${name} was removed from ${child.title} by an organization admin`,
        href: `/workspaces/${encodeURIComponent(child.slug ?? child.id)}?tab=settings`, sourceEventId: `outside-removed:${child.id}:${userId}:${stamp}`, refs: { projectId: child.id } });
    await notifyOrg({ orgId, eventKey: 'org.removed', actorId: viewer.userId, to: [userId], title: `You were removed from ${child.title}`,
        href: '/workspaces', sourceEventId: `outside-removed-you:${child.id}:${userId}:${stamp}` });
    return { success: true };
}

/** Admins edit anyone's title ("Section B", "TA · Lab 2"); members edit their own in Settings (report §20.4). */
export async function setMemberTitleAction(orgId: string, userId: string, title: string | null): Promise<{ success: true } | Failure> {
    const viewer = await orgManager(orgId, 'members_tab');
    if (!viewer) return DENIED;
    const clean = title?.trim().slice(0, 60) || null;
    const updated = await db.update(workspaceMembers).set({ title: clean })
        .where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, userId))).returning({ id: workspaceMembers.id });
    if (!updated.length) return { success: false, error: 'That person is no longer a member.' };
    touch(viewer.slug, orgId);
    return { success: true };
}

/**
 * Remove (report §20.7): out of the org and its child projects, unfinished copies released, handed-in work
 * kept. "Block from rejoining" stops the join code. Project leads transfer or detach their projects first.
 */
export async function removeMembersAction(orgId: string, userIds: string[], options: { block: boolean; reason?: string | null }): Promise<{ success: true; removed: number; skipped: number } | Failure> {
    const viewer = await orgManager(orgId, 'remove_members_guests');
    if (!viewer) return DENIED;
    const roles = await rolesOf(orgId, viewer.ownerId, userIds);
    for (const id of userIds) {
        if (id === viewer.userId) return { success: false, error: 'Use Leave organization to remove yourself.' };
        const block = roles.has(id) ? memberChangeBlock(viewer.role, roles.get(id)!, null) : 'That person is no longer a member.';
        if (block) return { success: false, error: block };
    }
    // Report §36.5 "Remove 11, skip 1": workspace leads transfer first, so they're left out.
    const leads = await leadsOf(orgId, userIds);
    const all = userIds.length;
    userIds = userIds.filter((id) => !leads.some((l) => l.userId === id));
    if (!userIds.length) return { success: false, error: `${leads[0]!.name} leads ${leads[0]!.workspace}. Transfer it first.` };
    const seats = await db.transaction(async (tx) => {
        const opened = [];
        for (const id of userIds) {
            // Admins can't remove admins, so the owner acts when an admin is removed.
            opened.push(...await removeFromOrg(tx, orgId, id, roles.get(id) === 'admin' ? viewer.ownerId : viewer.userId, { by: viewer.userId, note: options.reason ?? null }));
            if (options.block) await tx.insert(orgJoinBlocks).values({ orgId, userId: id, blockedBy: viewer.userId }).onConflictDoNothing();
        }
        return opened;
    });
    await notifySeatsReopened(orgId, seats);
    touch(viewer.slug, orgId);
    // E12 is always sent; the reason goes out as written. Being blocked is never mentioned (report §26.3 A).
    const org = await orgLabel(orgId);
    const reason = options.reason?.trim().slice(0, 500) || null;
    if (org) {
        await notifyOrg({
            orgId, eventKey: 'org.removed', actorId: viewer.userId, to: userIds, title: `You were removed from ${org.title}`, body: reason,
            href: '/workspaces', sourceEventId: `removed:${Date.now()}`, email: { kind: 'org_removed', data: { reason } },
        });
    }
    return { success: true, removed: userIds.length, skipped: all - userIds.length };
}

/** Add to child project (report §20.6): admins add people directly, into a unit when one is picked. */
export async function addMembersToChildAction(orgId: string, childProjectId: string, userIds: string[], unitId: string | null): Promise<{ success: true; added: number } | Failure> {
    const viewer = await orgManager(orgId, 'move_member_workspace');
    if (!viewer) return DENIED;
    const [child] = await db.select({ id: workspaces.id, ownerId: workspaces.ownerId, title: workspaces.title, slug: workspaces.slug }).from(workspaces)
        .where(and(eq(workspaces.id, childProjectId), eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt))).limit(1);
    if (!child) return { success: false, error: 'That workspace is no longer in this organization.' };
    if (unitId) {
        const [unit] = await db.select({ id: workspaceOpenRoles.id }).from(workspaceOpenRoles).where(and(eq(workspaceOpenRoles.id, unitId), eq(workspaceOpenRoles.projectId, child.id))).limit(1);
        if (!unit) return { success: false, error: 'That team is no longer in the workspace.' };
    }
    const inOrg = await rolesOf(orgId, viewer.ownerId, userIds);
    const people = userIds.filter((id) => inOrg.has(id));
    if (unitId) {
        const full = await seatBlock(db, unitId, people);
        if (full) return { success: false, error: full };
    }
    await db.transaction(async (tx) => {
        for (const id of people) await addWorkspaceMemberInternal(tx, { projectId: child.id, userId: id, role: 'member', actorId: child.ownerId, source: 'manual', roleId: unitId });
    });
    touch(viewer.slug, orgId);
    if (people.length) {
        await notifyOrg({
            orgId, eventKey: 'org.child_added', actorId: viewer.userId, to: people, title: `You were added to ${child.title}`,
            href: `/workspaces/${encodeURIComponent(child.slug ?? child.id)}`, sourceEventId: `child:${child.id}:${unitId ?? ''}:${Date.now()}`,
        });
    }
    return { success: true, added: people.length };
}

export type MemberWorkRow = { copyId: string; title: string; dueDate: string | null; state: string; late: boolean };

/** The member drawer's Work list: their assignment copies with status (report §20.3). */
export type MemberActivityRow = { at: string; what: string; task: string; project: string };

/** Remind about missing work (report §20.6): one notice per person with what's still open, at most every 12 hours. */
export async function remindMembersAction(orgId: string, userIds: string[]): Promise<{ success: true; reminded: number; skipped: number } | Failure> {
    const viewer = await orgManager(orgId, 'extend_excuse_remind');
    if (!viewer) return DENIED;
    const [org] = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    userIds = userIds.filter((id) => UUID_RE.test(id));
    if (!org || userIds.length === 0) return { success: true, reminded: 0, skipped: 0 };
    const open = await db.execute<{ user_id: string; n: number }>(sql`
        SELECT u.user_id, count(DISTINCT c.id)::int AS n
        FROM tasks c JOIN tasks m ON m.id = c.assignment_id
        CROSS JOIN LATERAL (SELECT c.assignee_id AS user_id UNION SELECT tm.user_id FROM task_team_members tm WHERE tm.task_id = c.id) u
        WHERE m.workspace_id = ${orgId} AND m.deleted_at IS NULL AND m.assignment_settings->>'publishedAt' IS NOT NULL AND m.assignment_settings->>'closedAt' IS NULL
          AND c.deleted_at IS NULL AND c.excused_at IS NULL AND c.due_date IS NOT NULL
          AND NOT (c.review_status IN ('pending', 'approved') OR c.status = 'done' OR c.submission IS NOT NULL)
          AND u.user_id IN ${userIds.slice(0, ORG_LIMITS.membersPerOrg)}
        GROUP BY u.user_id`);
    // Decision 60: people reminded in the last 12 hours are skipped and counted, not silently dropped.
    const recent = await remindedRecently(orgId, 'remind-member', open.map((r) => r.user_id));
    const send = open.filter((r) => !recent.has(r.user_id));
    const minute = Math.floor(Date.now() / 60_000);
    for (const row of send) {
        await notifyOrg({
            orgId, eventKey: 'assignments.reminded', actorId: viewer.userId, to: [row.user_id],
            title: `Reminder: ${row.n} ${row.n === 1 ? 'piece of work is' : 'pieces of work are'} still open in ${org.title}`,
            href: orgHref(org, '?tab=tasks'), sourceEventId: `remind-member:${row.user_id}:${minute}`,
        });
    }
    return { success: true, reminded: send.length, skipped: open.length - send.length };
}

/** The drawer's Recent activity (report §20.3): their last 10 task events across the org and its child projects. */
/** An admin reading the activity or work of someone they're in a block with: a duty, so allowed, and recorded for trust and safety only (Blocking B45, rule 7). */
async function recordViewAcrossBlock(orgId: string, viewerId: string, userId: string, what: string) {
    await db.execute(sql`
        INSERT INTO moderation_events (actor_id, kind, data)
        SELECT ${viewerId}::uuid, 'admin_view_across_block', jsonb_build_object('subjectId', ${userId}::uuid, 'workspaceId', ${orgId}::uuid, 'view', ${what}::text)
        WHERE app_private.blocked_between(${viewerId}::uuid, ${userId}::uuid)`);
}

export async function readMemberActivityAction(orgId: string, userId: string): Promise<{ success: true; activity: MemberActivityRow[] } | Failure> {
    const viewer = await orgManager(orgId, 'members_tab', 'read');
    if (!viewer || !UUID_RE.test(userId)) return DENIED;
    await recordViewAcrossBlock(orgId, viewer.userId, userId, 'activity');
    const rows = await db.execute<{ at: string; event_type: string; task: string; project: string }>(sql`
        SELECT e.created_at::text AS at, e.event_type, t.title AS task, p.title AS project
        FROM task_activity_events e JOIN tasks t ON t.id = e.task_id JOIN workspaces p ON p.id = e.workspace_id
        WHERE e.actor_id = ${userId} AND (p.id = ${orgId} OR p.parent_id = ${orgId}) AND p.deleted_at IS NULL
        ORDER BY e.created_at DESC LIMIT 10`);
    return { success: true, activity: rows.map((r) => ({ at: r.at, what: r.event_type.replace(/_/g, ' '), task: r.task, project: r.project })) };
}

export async function readMemberWorkAction(orgId: string, userId: string): Promise<{ success: true; work: MemberWorkRow[] } | Failure> {
    const viewer = await orgManager(orgId, 'members_tab', 'read');
    if (!viewer || !UUID_RE.test(userId)) return DENIED;
    await recordViewAcrossBlock(orgId, viewer.userId, userId, 'work');
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


export type OrgInvitePanelData = {
    joinCode: string | null;
    codeEnabled: boolean;
    joinMode: 'instant' | 'approval';
    invitesLeft: number;
    viewerRole: 'owner' | 'admin';
    roleNames: { owner: string; admin: string; member: string; viewer: string };
    children: Array<{ id: string; title: string; units: Array<{ id: string; title: string }> }>;
};

/** The one invite panel's data (report §5.5, §7.11, §10.2): one read for the header, About and Members. */
export async function readOrgInvitePanelAction(orgId: string): Promise<{ success: true; data: OrgInvitePanelData } | Failure> {
    const viewer = await orgManager(orgId, 'invite_members_guests', 'read');
    if (!viewer) return DENIED;
    const [[org], children, units] = await Promise.all([
        db.select({ joinCode: workspaces.joinCode, enabled: workspaces.joinCodeEnabled, settings: workspaces.orgSettings, orgType: workspaces.orgType }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1),
        db.select({ id: workspaces.id, title: workspaces.title }).from(workspaces).where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt))).orderBy(asc(workspaces.title)),
        db.select({ id: workspaceOpenRoles.id, projectId: workspaceOpenRoles.projectId, title: sql<string>`coalesce(${workspaceOpenRoles.title}, ${workspaceOpenRoles.role})` })
            .from(workspaceOpenRoles).innerJoin(workspaces, eq(workspaces.id, workspaceOpenRoles.projectId)).where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt))),
    ]);
    return {
        success: true,
        data: {
            joinCode: org?.enabled ? org.joinCode : null,
            codeEnabled: Boolean(org?.enabled),
            joinMode: (org?.settings as { joinMode?: string } | null)?.joinMode === 'approval' ? 'approval' : 'instant',
            invitesLeft: invitesLeftToday(await invitesSentToday(orgId)),
            viewerRole: viewer.role,
            roleNames: orgRoleNames(org?.orgType, org?.settings),
            children: children.map((c) => ({ id: c.id, title: c.title ?? 'Workspace', units: units.filter((u) => u.projectId === c.id).map((u) => ({ id: u.id, title: u.title })) })),
        },
    };
}

/** The email an invite sends, rendered with the real template so the preview can't drift (report §7.11). */
export async function previewOrgInviteEmailAction(orgId: string, input: { role: 'admin' | 'member' | 'viewer'; title?: string | null }): Promise<{ success: true; subject: string; html: string } | Failure> {
    const viewer = await orgManager(orgId, 'invite_members_guests', 'read');
    if (!viewer) return DENIED;
    const base = await orgEmailBase(orgId, viewer.userId);
    if (!base) return DENIED;
    const [org] = await db.select({ orgType: workspaces.orgType, settings: workspaces.orgSettings }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    const names = orgRoleNames(org?.orgType, org?.settings);
    const role = input.role === 'admin' ? names.admin : input.role === 'viewer' ? names.viewer : names.member;
    const email = buildOrgEmail('org_invite', { ...base, role, memberTitle: input.title?.trim().slice(0, 60) || null, expiresAt: new Date(Date.now() + INVITE_DAYS * 86_400_000).toISOString() } as Parameters<typeof buildOrgEmail>[1], { email: 'preview@networkbase.in' });
    return { success: true, subject: email.subject, html: email.html };
}
