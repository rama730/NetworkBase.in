'use server';

import { and, asc, count, eq, isNull, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { profiles, workspaceMembers, workspaceOpenRoles, workspaces } from '@/lib/db/schema';
import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { notifyOrg, notifyTeamsWithoutLead } from '@/lib/organizations/notify';
import { insertTask } from '@/lib/organizations/assignments';
import { enqueueWorkspaceNotificationEvent } from '@/lib/notifications/workspace-events';
import { taskTeamMembers } from '@/lib/db/schema';
import { getViewerAuthContext } from '@/lib/server/viewer-context';
import { closePendingApplications } from '@/lib/applications/closing';
import { notifyClosedApplications } from '@/lib/applications/notifications';
import { ORG_LIMITS } from '@/lib/organizations/config';
import { childGrant, type ChildAction, type ChildRole } from '@/lib/organizations/permissions';

// Units after creation (report §14.4, §21 "Units & open seats"): the lead, a project admin or an inherited org admin
// renames units, changes seats, picks the unit lead ★ and moves people between units.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don’t have permission to change this." };
const UNIT_SEATS = 10;

export type ChildUnit = { id: string; title: string; count: number; filled: number; leadUserId: string | null; members: Array<{ userId: string; name: string }> };
export type ChildUnits = { success: true; units: ChildUnit[]; unplaced: Array<{ userId: string; name: string }> };

/** A lead, workspace admin or inherited admin, checked against the workspace row named (decisions 33, 109). */
async function manager(projectId: string, action: ChildAction = 'manage_members_units') {
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const access = await getWorkspaceAccessById(projectId, userId);
    if (!access.project?.parentId || access.writeBlocked) return null;
    const role: ChildRole = access.isOwner ? 'lead' : access.memberRole === 'admin' ? 'project_admin' : access.isInheritedAdmin ? 'inherited_admin' : access.isMember ? 'unit_member' : 'visitor';
    return childGrant(role, action) === 'yes' ? { userId, project: access.project } : null;
}

export async function readChildUnitsAction(projectId: string): Promise<ChildUnits | Failure> {
    if (!(await manager(projectId))) return DENIED;
    const [units, people] = await Promise.all([
        db.select({ id: workspaceOpenRoles.id, role: workspaceOpenRoles.role, title: workspaceOpenRoles.title, count: workspaceOpenRoles.count, filled: workspaceOpenRoles.filled, leadUserId: workspaceOpenRoles.leadUserId })
            .from(workspaceOpenRoles).where(eq(workspaceOpenRoles.projectId, projectId)).orderBy(asc(workspaceOpenRoles.createdAt)),
        db.select({ userId: workspaceMembers.userId, unitId: workspaceMembers.unitId, role: workspaceMembers.role, name: sql<string>`coalesce(${profiles.fullName}, ${profiles.username}, 'Member')` })
            .from(workspaceMembers).innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
            .where(and(eq(workspaceMembers.projectId, projectId), ne(workspaceMembers.role, 'owner'))).orderBy(asc(profiles.fullName)),
    ]);
    return {
        success: true,
        units: units.map((u) => ({ id: u.id, title: u.title || u.role, count: u.count, filled: u.filled, leadUserId: u.leadUserId,
            members: people.filter((p) => p.unitId === u.id).map((p) => ({ userId: p.userId, name: p.name })) })),
        unplaced: people.filter((p) => !p.unitId && p.role !== 'viewer').map((p) => ({ userId: p.userId, name: p.name })),
    };
}

/** Rename, change seats (never below the people in it), or pick the unit lead from its members. */
export async function updateUnitAction(projectId: string, unitId: string, patch: { title?: string; count?: number; leadUserId?: string | null }): Promise<{ success: true } | Failure> {
    const m = await manager(projectId);
    if (!m) return DENIED;
    const [unit] = await db.select().from(workspaceOpenRoles).where(and(eq(workspaceOpenRoles.id, unitId), eq(workspaceOpenRoles.projectId, projectId))).limit(1);
    if (!unit) return { success: false, error: 'That team is gone.' };
    const set: Partial<typeof workspaceOpenRoles.$inferInsert> = { updatedAt: new Date() };
    if (patch.title !== undefined) {
        const title = patch.title.trim().slice(0, 100);
        if (!title) return { success: false, error: 'A team needs a name.' };
        const [clash] = await db.select({ id: workspaceOpenRoles.id }).from(workspaceOpenRoles)
            .where(and(eq(workspaceOpenRoles.projectId, projectId), ne(workspaceOpenRoles.id, unitId), sql`lower(coalesce(${workspaceOpenRoles.title}, ${workspaceOpenRoles.role})) = lower(${title})`)).limit(1);
        if (clash) return { success: false, error: 'Another team already has that name.' };
        set.role = title;
        set.title = title;
    }
    if (patch.count !== undefined) {
        const count = Math.trunc(patch.count);
        if (count < Math.max(1, unit.filled) || count > UNIT_SEATS) return { success: false, error: `Number of people goes from ${Math.max(1, unit.filled)} (the people in it) to ${UNIT_SEATS}.` };
        set.count = count;
    }
    let newLead: string | null = null;
    if (patch.leadUserId !== undefined) {
        if (patch.leadUserId) {
            const [member] = await db.select({ id: workspaceMembers.id }).from(workspaceMembers)
                .where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.userId, patch.leadUserId), eq(workspaceMembers.unitId, unitId))).limit(1);
            if (!member) return { success: false, error: 'The team lead must be in the team.' };
            if (patch.leadUserId !== unit.leadUserId) newLead = patch.leadUserId;
        }
        set.leadUserId = patch.leadUserId;
    }
    await db.update(workspaceOpenRoles).set(set).where(eq(workspaceOpenRoles.id, unitId));
    if (newLead && m.project.parentId) {
        await notifyOrg({ orgId: m.project.parentId, eventKey: 'org.role_changed', actorId: m.userId, to: [newLead], title: `You’re team lead of ${set.title ?? unit.title ?? unit.role}`,
            href: `/workspaces/${encodeURIComponent(m.project.slug ?? projectId)}`, sourceEventId: `unit-lead:${projectId}:${unitId}:${newLead}:${Date.now()}`, refs: { projectId } });
    }
    return { success: true };
}

const unitName = (u: { title: string | null; role: string }) => u.title || u.role;

/** Add team (report §25.3, decision 45): lead, workspace admins and organization admins; up to 20; names unique here. */
export async function createUnitAction(projectId: string, input: { title: string; count: number; description?: string | null }): Promise<{ success: true; id: string } | Failure> {
    const m = await manager(projectId);
    if (!m) return DENIED;
    const title = input.title.trim().slice(0, 100);
    const seats = Math.trunc(input.count);
    if (!title) return { success: false, error: 'A team needs a name.' };
    if (!(seats >= 1 && seats <= UNIT_SEATS)) return { success: false, error: `A team has 1 to ${UNIT_SEATS} seats.` };
    const [{ n } = { n: 0 }] = await db.select({ n: count() }).from(workspaceOpenRoles).where(eq(workspaceOpenRoles.projectId, projectId));
    if (n >= ORG_LIMITS.unitsPerChildProject) return { success: false, error: `A workspace has up to ${ORG_LIMITS.unitsPerChildProject} teams.` };
    const [clash] = await db.select({ id: workspaceOpenRoles.id }).from(workspaceOpenRoles)
        .where(and(eq(workspaceOpenRoles.projectId, projectId), sql`lower(coalesce(${workspaceOpenRoles.title}, ${workspaceOpenRoles.role})) = lower(${title})`)).limit(1);
    if (clash) return { success: false, error: 'Another team already has that name.' };
    const [row] = await db.insert(workspaceOpenRoles).values({ projectId, role: title, title, count: seats, filled: 0, description: input.description?.trim().slice(0, 2000) || null })
        .returning({ id: workspaceOpenRoles.id });
    return { success: true, id: row!.id };
}

/** Remove a team (report §25.3): its people stay in the workspace, not in a team; waiting applications close and are told. */
export async function removeUnitAction(projectId: string, unitId: string): Promise<{ success: true; people: number } | Failure> {
    const m = await manager(projectId);
    if (!m) return DENIED;
    const result = await db.transaction(async (tx) => {
        const [unit] = await tx.select({ id: workspaceOpenRoles.id }).from(workspaceOpenRoles).where(and(eq(workspaceOpenRoles.id, unitId), eq(workspaceOpenRoles.projectId, projectId))).limit(1);
        if (!unit) return null;
        const moved = await tx.update(workspaceMembers).set({ unitId: null }).where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.unitId, unitId))).returning({ id: workspaceMembers.id });
        const closed = await closePendingApplications(tx, { projectId, actorId: m.userId, reason: 'role_removed', roleIds: [unitId], source: 'team_removed' });
        await tx.delete(workspaceOpenRoles).where(eq(workspaceOpenRoles.id, unitId));
        return { people: moved.length, closed };
    });
    if (!result) return { success: false, error: 'That team is gone.' };
    if (result.closed.length) await notifyClosedApplications(result.closed, { reason: 'role_removed', projectId, projectSlug: m.project.slug ?? null, projectTitle: '', actorUserId: m.userId, traceId: `team_removed_${unitId.slice(0, 8)}` }).catch(() => undefined);
    return { success: true, people: result.people };
}

/** Open team tasks a move would carry over (report §42.10, decision 138): their old team's, not handed in. */
async function openTeamTasks(projectId: string, userId: string, teamName: string) {
    return db.execute<{ id: string }>(sql`
        SELECT t.id FROM tasks t JOIN task_team_members tm ON tm.task_id = t.id AND tm.user_id = ${userId}
        WHERE t.workspace_id = ${projectId} AND t.deleted_at IS NULL AND t.team_name = ${teamName} AND t.status <> 'done'
          AND t.assignment_id IS NULL AND t.review_status IS DISTINCT FROM 'pending'`);
}

/** "Also move them on 2 open team tasks?" before a move. */
export async function readTeamMovePreviewAction(projectId: string, userId: string, unitId: string | null): Promise<{ success: true; openTasks: number } | Failure> {
    if (!(await manager(projectId))) return DENIED;
    const [member] = await db.select({ unitId: workspaceMembers.unitId }).from(workspaceMembers).where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.userId, userId))).limit(1);
    const [from] = member?.unitId ? await db.select({ title: workspaceOpenRoles.title, role: workspaceOpenRoles.role }).from(workspaceOpenRoles).where(eq(workspaceOpenRoles.id, member.unitId)).limit(1) : [];
    if (!from || member?.unitId === unitId) return { success: true, openTasks: 0 };
    return { success: true, openTasks: (await openTeamTasks(projectId, userId, unitName(from))).length };
}

/**
 * Move one person into a unit (a free seat) or out of every unit; seat counts follow, and a unit lead who moves stops
 * leading it. With `moveTasks` (on by default, report §42.10, decision 138) they leave the old team's open tasks and
 * join the new team's; handed-in tasks stay as they are. They're told (report §25.1 #4).
 */
export async function moveMemberToUnitAction(projectId: string, userId: string, unitId: string | null, moveTasks = true): Promise<{ success: true } | Failure> {
    const m = await manager(projectId);
    if (!m) return DENIED;
    let names: { from: string | null; to: string | null } = { from: null, to: null };
    let leftLeadless = false
    try {
        await db.transaction(async (tx) => {
            const [member] = await tx.select({ unitId: workspaceMembers.unitId }).from(workspaceMembers)
                .where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.userId, userId))).for('update').limit(1);
            if (!member) throw new Error('That person is no longer in the workspace.');
            if (member.unitId === unitId) return;
            if (unitId) {
                const [target] = await tx.select({ filled: workspaceOpenRoles.filled, count: workspaceOpenRoles.count }).from(workspaceOpenRoles)
                    .where(and(eq(workspaceOpenRoles.id, unitId), eq(workspaceOpenRoles.projectId, projectId))).for('update').limit(1);
                if (!target) throw new Error('That team is gone.');
                if (target.filled >= target.count) throw new Error('That team is full. Add a seat first.');
                await tx.update(workspaceOpenRoles).set({ filled: sql`${workspaceOpenRoles.filled} + 1`, updatedAt: new Date() }).where(eq(workspaceOpenRoles.id, unitId));
            }
            if (member.unitId) {
                const [old] = await tx.select({ leadUserId: workspaceOpenRoles.leadUserId }).from(workspaceOpenRoles).where(eq(workspaceOpenRoles.id, member.unitId)).limit(1);
                leftLeadless = old?.leadUserId === userId;
                await tx.update(workspaceOpenRoles).set({
                    filled: sql`GREATEST(0, ${workspaceOpenRoles.filled} - 1)`,
                    leadUserId: sql`CASE WHEN ${workspaceOpenRoles.leadUserId} = ${userId}::uuid THEN NULL ELSE ${workspaceOpenRoles.leadUserId} END`,
                    updatedAt: new Date(),
                }).where(eq(workspaceOpenRoles.id, member.unitId));
            }
            await tx.update(workspaceMembers).set({ unitId }).where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.userId, userId)));
            const named = async (id: string | null) => {
                if (!id) return null;
                const [u] = await tx.select({ title: workspaceOpenRoles.title, role: workspaceOpenRoles.role }).from(workspaceOpenRoles).where(eq(workspaceOpenRoles.id, id)).limit(1);
                return u ? unitName(u) : null;
            };
            names = { from: await named(member.unitId), to: await named(unitId) };
        });
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Couldn’t move them.' };
    }
    if (leftLeadless && names.from) await notifyTeamsWithoutLead(projectId, m.userId, [names.from]).catch(() => undefined)
    if (moveTasks && names.from) {
        const leaving = (await openTeamTasks(projectId, userId, names.from)).map((r) => r.id);
        if (leaving.length) await db.execute(sql`DELETE FROM task_team_members WHERE user_id = ${userId} AND task_id IN ${leaving}`);
        if (names.to) {
            await db.execute(sql`
                INSERT INTO task_team_members (task_id, user_id)
                SELECT t.id, ${userId}::uuid FROM tasks t WHERE t.workspace_id = ${projectId} AND t.deleted_at IS NULL AND t.team_name = ${names.to}
                  AND t.status <> 'done' AND t.assignment_id IS NULL AND t.review_status IS DISTINCT FROM 'pending'
                ON CONFLICT DO NOTHING`);
        }
    }
    if (m.project.parentId && names.to !== names.from) {
        await notifyOrg({ orgId: m.project.parentId, eventKey: 'org.team_changed', actorId: m.userId, to: [userId],
            title: names.to ? `You were moved to ${names.to}` : `You’re no longer in ${names.from}`, href: `/workspaces/${encodeURIComponent(m.project.slug ?? projectId)}`,
            sourceEventId: `team-move:${projectId}:${userId}:${Date.now()}`, refs: { projectId } });
    }
    return { success: true };
}

/** Unit names for the Tasks board's Unit filter and @unit mentions (report §14.4): anyone who can read the project. */
export async function readWorkspaceUnitsAction(projectId: string): Promise<Array<{ id: string; title: string; memberIds: string[]; leadUserId: string | null; count: number; filled: number }>> {
    const { userId } = await getViewerAuthContext();
    const access = await getWorkspaceAccessById(projectId, userId);
    if (!access.canRead || !access.project?.parentId) return [];
    const [units, members] = await Promise.all([
        db.select({ id: workspaceOpenRoles.id, role: workspaceOpenRoles.role, title: workspaceOpenRoles.title, leadUserId: workspaceOpenRoles.leadUserId, count: workspaceOpenRoles.count, filled: workspaceOpenRoles.filled }).from(workspaceOpenRoles)
            .where(eq(workspaceOpenRoles.projectId, projectId)).orderBy(asc(workspaceOpenRoles.createdAt)),
        db.select({ userId: workspaceMembers.userId, unitId: workspaceMembers.unitId }).from(workspaceMembers)
            .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.projectId))
            .where(and(eq(workspaceMembers.projectId, projectId), isNull(workspaces.deletedAt))),
    ]);
    return units.map((u) => ({ id: u.id, title: u.title || u.role, memberIds: members.filter((m) => m.unitId === u.id).map((m) => m.userId), leadUserId: u.leadUserId, count: u.count, filled: u.filled }));
}

/**
 * Team tasks in a child project (report §16.11): one shared task per team or per unit, worked and moved by any
 * teammate; the team lead (or unit lead) is the assignee. Review follows the project's own policy.
 */
export async function createTeamTasksAction(projectId: string, input: {
    title: string; description?: string | null; dueDate?: string | null;
    mode: 'teams' | 'units'; teams?: Array<{ name: string; userIds: string[]; leadId?: string | null }>;
}): Promise<{ success: true; created: number } | Failure> {
    const m = await manager(projectId, 'team_tasks');
    if (!m) return DENIED;
    const title = input.title.trim().slice(0, 200);
    if (!title) return { success: false, error: 'Give the task a title.' };
    const due = input.dueDate ? new Date(input.dueDate) : null;
    if (due && !Number.isFinite(due.getTime())) return { success: false, error: 'Pick a valid due date.' };

    const members = await db.select({ userId: workspaceMembers.userId, unitId: workspaceMembers.unitId }).from(workspaceMembers).where(eq(workspaceMembers.projectId, projectId));
    const inProject = new Set([...members.map((x) => x.userId), m.project.ownerId]);
    let teams: Array<{ name: string; userIds: string[]; leadId: string }>;
    if (input.mode === 'units') {
        const units = await db.select({ id: workspaceOpenRoles.id, role: workspaceOpenRoles.role, title: workspaceOpenRoles.title, leadUserId: workspaceOpenRoles.leadUserId })
            .from(workspaceOpenRoles).where(eq(workspaceOpenRoles.projectId, projectId)).orderBy(asc(workspaceOpenRoles.createdAt));
        teams = units.flatMap((u) => {
            const people = members.filter((x) => x.unitId === u.id).map((x) => x.userId);
            return people.length ? [{ name: u.title || u.role, userIds: people, leadId: u.leadUserId && people.includes(u.leadUserId) ? u.leadUserId : people[0]! }] : [];
        });
        if (teams.length === 0) return { success: false, error: 'No team has people in it yet.' };
    } else {
        const seen = new Set<string>();
        teams = [];
        for (const t of input.teams ?? []) {
            const people = [...new Set(t.userIds)].filter((id) => inProject.has(id));
            if (people.length === 0) return { success: false, error: 'Every team needs at least one person from the workspace.' };
            if (people.some((id) => seen.has(id))) return { success: false, error: 'A person can be in one team only.' };
            people.forEach((id) => seen.add(id));
            teams.push({ name: t.name.trim().slice(0, 60) || `Team ${String.fromCharCode(65 + teams.length)}`, userIds: people, leadId: t.leadId && people.includes(t.leadId) ? t.leadId : people[0]! });
        }
        if (teams.length === 0) return { success: false, error: 'Add at least one team.' };
    }

    const created = await db.transaction(async (tx) => {
        const ids: Array<{ id: string; team: (typeof teams)[number] }> = [];
        for (const team of teams) {
            const id = await insertTask(tx, { projectId, title, description: input.description?.trim() || null, dueDate: due, sprintId: null, assigneeId: team.leadId,
                creatorId: m.userId, kind: 'task', assignmentId: null, assignmentSettings: null, teamName: team.name });
            await tx.insert(taskTeamMembers).values(team.userIds.map((userId) => ({ taskId: id, userId, isLead: userId === team.leadId })));
            ids.push({ id, team });
        }
        return ids;
    });
    for (const { id, team } of created) {
        await enqueueWorkspaceNotificationEvent({ projectId, eventKey: 'tasks.assigned', actorUserId: m.userId, directRecipientIds: team.userIds,
            title: `You’re in ${team.name} for ${title}`, sourceEventId: `team-task:${id}`, entityRefs: { taskId: id } }).catch(() => undefined);
    }
    return { success: true, created: created.length };
}

export type TeamApplication = { id: string; name: string; username: string | null; team: string; message: string | null; createdAt: string };

/** Open applications to a workspace's teams (step 11 gap): for its lead, its admins and the organization's admins. */
export async function readTeamApplicationsAction(projectId: string): Promise<{ success: true; applications: TeamApplication[] } | Failure> {
    if (!(await manager(projectId, 'decide_applications'))) return DENIED;
    const rows = await db.execute<{ id: string; name: string | null; username: string | null; team: string | null; message: string | null; created_at: string }>(sql`
        SELECT a.id, p.full_name AS name, p.username, coalesce(r.title, r.role) AS team, a.message, a.created_at::text
        FROM role_applications a JOIN profiles p ON p.id = a.applicant_id LEFT JOIN workspace_open_roles r ON r.id = a.role_id
        WHERE a.workspace_id = ${projectId} AND a.role_id IS NOT NULL AND a.status = 'pending' AND p.deleted_at IS NULL
        ORDER BY a.created_at LIMIT 100`);
    return { success: true, applications: Array.from(rows).map((r) => ({ id: r.id, name: r.name || r.username || 'Someone', username: r.username, team: r.team ?? 'a team', message: r.message, createdAt: r.created_at })) };
}
