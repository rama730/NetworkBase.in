'use server';

import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';

import { db } from '@/lib/db';
import { profiles, workspaceMembers, workspaceOpenRoles, workspaces } from '@/lib/db/schema';
import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { notifyOrg } from '@/lib/organizations/notify';
import { insertTask } from '@/lib/organizations/assignments';
import { enqueueWorkspaceNotificationEvent } from '@/lib/notifications/workspace-events';
import { taskTeamMembers } from '@/lib/db/schema';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

// Units after creation (report §14.4, §21 "Units & open seats"): the lead, a project admin or an inherited org admin
// renames units, changes seats, picks the unit lead ★ and moves people between units.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don’t have permission to change this." };
const UNIT_SEATS = 10;

export type ChildUnit = { id: string; title: string; count: number; filled: number; leadUserId: string | null; members: Array<{ userId: string; name: string }> };
export type ChildUnits = { success: true; units: ChildUnit[]; unplaced: Array<{ userId: string; name: string }> };

async function manager(projectId: string) {
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const access = await getWorkspaceAccessById(projectId, userId);
    if (!access.project?.parentId || access.writeBlocked) return null;
    const can = access.isOwner || access.memberRole === 'admin' || access.isInheritedAdmin;
    return can ? { userId, project: access.project } : null;
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

/** Move one person into a unit (a free seat) or out of every unit; seat counts follow, and a unit lead who moves stops leading it. */
export async function moveMemberToUnitAction(projectId: string, userId: string, unitId: string | null): Promise<{ success: true } | Failure> {
    if (!(await manager(projectId))) return DENIED;
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
                await tx.update(workspaceOpenRoles).set({
                    filled: sql`GREATEST(0, ${workspaceOpenRoles.filled} - 1)`,
                    leadUserId: sql`CASE WHEN ${workspaceOpenRoles.leadUserId} = ${userId}::uuid THEN NULL ELSE ${workspaceOpenRoles.leadUserId} END`,
                    updatedAt: new Date(),
                }).where(eq(workspaceOpenRoles.id, member.unitId));
            }
            await tx.update(workspaceMembers).set({ unitId }).where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.userId, userId)));
        });
    } catch (error) {
        return { success: false, error: error instanceof Error ? error.message : 'Couldn’t move them.' };
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
    const m = await manager(projectId);
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
