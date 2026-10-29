import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { ForbiddenError, NotFoundError } from "@/lib/errors/domain";
import { db } from "@/lib/db";
import {
    applicationEvents,
    chatChannelMembers,
    chatChannels,
    profiles,
    projectMembers,
    projectNodeEvents,
    projectOpenRoles,
    projects,
    roleApplications,
    taskNodeLinks,
    tasks,
    projectNodes,
    projectInvitations,
} from "@/lib/db/schema";
import { closePendingApplications, resolveApplicationsOnJoin } from "@/lib/applications/closing";
import { syncProjectChat } from "@/lib/messaging/integrations";
import { recordTaskAssignment, taskAssignmentNotification } from "@/lib/projects/task-assignment";
import type { EnqueueProjectNotificationEventInput } from "@/lib/notifications/project-events";
import {
    isEligibleProjectMember,
    normalizeProjectMemberRole,
    projectMemberCan,
    type ProjectMemberCapability,
    type ProjectMemberEligibility,
    type ProjectMemberRole,
} from "@/lib/projects/settings-policies";
import {
    endProfileProjectContributionMembership,
    markProfileCollaborationSummaryStale,
    upsertProfileProjectContributionFromMembership,
} from "@/lib/profile/collaboration";
import { getProjectAccessById, type ProjectAccess } from "@/lib/data/project-access";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type ProjectCollaboratorExecutor = typeof db | DbTransaction;

export type ProjectCollaboratorSnapshot = {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
};

export type ProjectCollaboratorLifecycleResult = {
    eventId: string | null;
    changed: boolean;
    project: {
        id: string;
        ownerId: string;
        title: string | null;
        slug: string | null;
    };
    target: ProjectCollaboratorSnapshot | null;
    previousRole: ProjectMemberRole | null;
    nextRole: ProjectMemberRole | null;
    /** Pending applications closed because this member filled their role (the caller notifies them after commit). */
    closedApplications?: Array<{ id: string; applicantId: string; roleId: string }>;
    /** Candidates whose pending invitation expired because the role filled (the caller tells them after commit). */
    expiredInvitationCandidates?: string[];
};

function displayNameForSnapshot(snapshot: ProjectCollaboratorSnapshot | null) {
    return snapshot?.fullName || snapshot?.username || "Project member";
}

function roleRank(role: ProjectMemberRole | null) {
    switch (role) {
        case "owner":
            return 4;
        case "admin":
            return 3;
        case "member":
            return 2;
        case "viewer":
            return 1;
        default:
            return 0;
    }
}

async function readProjectForUpdate(executor: ProjectCollaboratorExecutor, projectId: string) {
    const rows = await executor.execute<{
        id: string;
        owner_id: string;
        title: string | null;
        slug: string | null;
        key: string | null;
        member_file_upload_default: boolean | null;
    }>(sql`
        SELECT id, owner_id, title, slug, member_file_upload_default, key
        FROM ${projects}
        WHERE id = ${projectId} AND deleted_at IS NULL
        FOR UPDATE
    `);
    const row = Array.from(rows)[0];
    if (!row) return null;
    return {
        id: row.id,
        ownerId: row.owner_id,
        title: row.title,
        slug: row.slug,
        key: row.key,
        memberFileUploadDefault: row.member_file_upload_default !== false,
    };
}

async function readProfileSnapshot(executor: ProjectCollaboratorExecutor, userId: string): Promise<ProjectCollaboratorSnapshot | null> {
    const [profile] = await executor
        .select({
            id: profiles.id,
            username: profiles.username,
            fullName: profiles.fullName,
            avatarUrl: profiles.avatarUrl,
        })
        .from(profiles)
        .where(eq(profiles.id, userId))
        .limit(1);
    return profile ?? null;
}

async function readMembershipRole(
    executor: ProjectCollaboratorExecutor,
    projectId: string,
    userId: string,
    ownerId: string,
    lock = false,
) {
    if (userId === ownerId) return "owner" as ProjectMemberRole;
    if (lock) {
        const rows = await executor.execute<{ role: ProjectMemberRole }>(sql`
            SELECT role
            FROM ${projectMembers}
            WHERE project_id = ${projectId} AND user_id = ${userId}
            FOR UPDATE
        `);
        const row = Array.from(rows)[0];
        return row ? normalizeProjectMemberRole(row.role) : null;
    }
    const [member] = await executor
        .select({ role: projectMembers.role })
        .from(projectMembers)
        .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)))
        .limit(1);
    return member ? normalizeProjectMemberRole(member.role) : null;
}

export function canProjectRoleManageTarget(params: {
    actorRole: ProjectMemberRole | null;
    targetRole: ProjectMemberRole | null;
    nextRole?: ProjectMemberRole | null;
}) {
    const { actorRole, targetRole, nextRole = null } = params;
    if (!actorRole || !targetRole || targetRole === "owner") return false;
    if (actorRole === "owner") return true;
    if (actorRole !== "admin") return false;
    return (
        (targetRole === "member" || targetRole === "viewer") &&
        (!nextRole || nextRole === "member" || nextRole === "viewer")
    );
}

export function isProjectMemberEligibleFor(role: unknown, eligibility: ProjectMemberEligibility) {
    return isEligibleProjectMember(role, eligibility);
}

/** The capability check on an access record that is already loaded, so one read can serve several checks. */
export function capabilityFromAccess(access: ProjectAccess, capability: ProjectMemberCapability) {
    if (!access.project) throw new NotFoundError("Project not found");
    const role = access.isOwner ? "owner" : access.memberRole;
    if (!role || !projectMemberCan(role, capability)) {
        throw new ForbiddenError("You do not have permission to perform this project action");
    }
    return { project: access.project, role };
}

export async function requireProjectCapability(
    projectId: string,
    userId: string,
    capability: ProjectMemberCapability,
    executor: ProjectCollaboratorExecutor = db,
) {
    if (executor === db) return capabilityFromAccess(await getProjectAccessById(projectId, userId), capability);

    const [project] = await executor
        .select({ id: projects.id, ownerId: projects.ownerId })
        .from(projects)
        .where(and(eq(projects.id, projectId), isNull(projects.deletedAt)))
        .limit(1);
    if (!project) throw new NotFoundError("Project not found");
    const role = await readMembershipRole(executor, projectId, userId, project.ownerId, false);
    if (!role || !projectMemberCan(role, capability)) {
        throw new ForbiddenError("You do not have permission to perform this project action");
    }
    return { project, role };
}

export async function addProjectMemberInternal(
    executor: ProjectCollaboratorExecutor,
    params: {
        projectId: string;
        userId: string;
        role?: Exclude<ProjectMemberRole, "owner">;
        actorId: string;
        source: "application_accept" | "project_invite" | "manual" | "ownership_transfer" | "join_code" | "email_invite";
        applicationId?: string | null;
        roleId?: string | null;
        incrementRoleCapacity?: boolean;
    },
): Promise<ProjectCollaboratorLifecycleResult> {
    const project = await readProjectForUpdate(executor, params.projectId);
    if (!project) throw new NotFoundError("Project not found");
    const target = await readProfileSnapshot(executor, params.userId);
    const previousRole = await readMembershipRole(executor, params.projectId, params.userId, project.ownerId, true);
    const nextRole = params.userId === project.ownerId ? "owner" : normalizeProjectMemberRole(params.role ?? "member", "member");
    let changed = false;
    let closedApplications: Array<{ id: string; applicantId: string; roleId: string }> = [];
    let expiredInvitationCandidates: string[] = [];

    if (!previousRole) {
        await executor.insert(projectMembers).values({
            projectId: params.projectId,
            userId: params.userId,
            role: nextRole === "owner" ? "member" : nextRole,
            // New members start with the project's upload default (Settings or create step 4).
            fileUploadEnabled: project.memberFileUploadDefault,
            // Joining through a role box places the person in that unit (report §14.4).
            unitId: params.roleId ?? null,
        });
        changed = true;
    } else if (
        previousRole !== "owner" &&
        nextRole !== "owner" &&
        roleRank(nextRole) > roleRank(previousRole)
    ) {
        await executor
            .update(projectMembers)
            .set({ role: nextRole })
            .where(and(eq(projectMembers.projectId, params.projectId), eq(projectMembers.userId, params.userId)));
        changed = true;
    }

    // ponytail: atomic role capacity enforcement ensures open role vacancies are strictly verified and decremented under concurrency. ceiling: 1M concurrent members. upgrade: partition capacity counter if role vacancies exceed 500.
    const shouldIncrementCapacity = Boolean(params.roleId && (changed || params.source === "application_accept"));
    if (shouldIncrementCapacity && params.incrementRoleCapacity !== false && params.roleId) {
        const roleRows = await executor
            .select({ id: projectOpenRoles.id, filled: projectOpenRoles.filled, count: projectOpenRoles.count })
            .from(projectOpenRoles)
            .where(eq(projectOpenRoles.id, params.roleId))
            .for("update")
            .limit(1);
        const role = roleRows[0];
        if (!role) throw new NotFoundError("Role not found");
        if (role.filled >= role.count) throw new Error("Role is full");
        await executor
            .update(projectOpenRoles)
            .set({ filled: sql`${projectOpenRoles.filled} + 1`, updatedAt: new Date() })
            .where(eq(projectOpenRoles.id, params.roleId));

        if (role.filled + 1 >= role.count) {
            // Find user IDs to invalidate
            const [otherApps, otherInvites] = await Promise.all([
                executor
                    .select({ applicantId: roleApplications.applicantId })
                    .from(roleApplications)
                    .where(and(
                        eq(roleApplications.projectId, params.projectId),
                        eq(roleApplications.roleId, params.roleId),
                        eq(roleApplications.status, 'pending'),
                        params.applicationId ? ne(roleApplications.id, params.applicationId) : undefined,
                        params.userId ? ne(roleApplications.applicantId, params.userId) : undefined,
                    )),
                executor
                    .select({ assigneeUserId: projectInvitations.candidateId })
                    .from(projectInvitations)
                    .where(and(
                        eq(projectInvitations.projectId, params.projectId),
                        eq(projectInvitations.roleId, params.roleId),
                        eq(projectInvitations.status, 'pending'),
                    ))
            ]);

            const userIdsToInvalidate = new Set<string>();
            otherApps.forEach(a => userIdsToInvalidate.add(a.applicantId));
            otherInvites.forEach(i => {
                if (i.assigneeUserId) userIdsToInvalidate.add(i.assigneeUserId);
            });

            // The other applicants for this role are closed in the same transaction.
            const closed = await closePendingApplications(executor, {
                projectId: params.projectId,
                actorId: params.actorId,
                reason: 'role_filled',
                roleIds: [params.roleId],
                source: params.source,
                excludeApplicationIds: params.applicationId ? [params.applicationId] : undefined,
            });
            closedApplications = closed.map((application) => ({ ...application, roleId: params.roleId as string }));

            // Pending invitations for the filled role expire; their chat cards follow live.
            const expiredInvitations = await executor
                .update(projectInvitations)
                .set({ status: "expired", resolvedAt: new Date(), resolvedBy: params.actorId, updatedAt: new Date() })
                .where(and(
                    eq(projectInvitations.projectId, params.projectId),
                    eq(projectInvitations.roleId, params.roleId),
                    eq(projectInvitations.status, "pending"),
                ))
                .returning({ candidateId: projectInvitations.candidateId });
            expiredInvitations.forEach((invitation) => userIdsToInvalidate.add(invitation.candidateId));
            expiredInvitationCandidates = expiredInvitations.map((invitation) => invitation.candidateId);

            if (userIdsToInvalidate.size > 0) {
                // Invalidate caches (non-blocking)
                const { invalidateDiscoverCacheForUsers } = await import('@/lib/connections/internal-helpers');
                invalidateDiscoverCacheForUsers(userIdsToInvalidate).catch(console.error);
            }
        }
    }

    // Project members join the project's #general (report 7.1).
    await syncProjectChat(executor, params.projectId, params.userId, "add");

    // Joining another way (an invitation, being added) closes a pending application of the same person.
    if (!previousRole && params.source !== "application_accept") {
        await resolveApplicationsOnJoin(executor, { projectId: params.projectId, userId: params.userId, actorId: params.actorId });
    }

    const [event] = await executor.insert(projectNodeEvents).values({
        projectId: params.projectId,
        actorId: params.actorId,
        nodeId: null,
        type: "project_member.added",
        metadata: {
            targetUserId: params.userId,
            targetSnapshot: target,
            previousRole,
            nextRole,
            source: params.source,
            applicationId: params.applicationId ?? null,
            roleId: params.roleId ?? null,
            targetDisplayName: displayNameForSnapshot(target),
        },
        createdAt: new Date(),
    }).returning({ id: projectNodeEvents.id });

    if (changed) {
        await upsertProfileProjectContributionFromMembership(executor, {
            profileId: params.userId,
            projectId: params.projectId,
            verifiedBy: params.actorId,
            previousRole,
            nextRole,
            eventId: event?.id ?? null,
            source: params.source === "project_invite"
                ? "project_invite"
                : params.source === "application_accept"
                    ? "application"
                    : params.source === "ownership_transfer"
                        ? "ownership_transfer"
                        : "membership",
        });
        await markProfileCollaborationSummaryStale(project.ownerId, executor);
    }

    return { eventId: event?.id ?? null, changed, project, target, previousRole, nextRole, closedApplications, expiredInvitationCandidates };
}

export async function changeProjectMemberRoleInternal(
    executor: ProjectCollaboratorExecutor,
    params: {
        projectId: string;
        actorId: string;
        targetUserId: string;
        nextRole: Exclude<ProjectMemberRole, "owner">;
    },
): Promise<ProjectCollaboratorLifecycleResult> {
    const project = await readProjectForUpdate(executor, params.projectId);
    if (!project) throw new NotFoundError("Project not found");
    const actorRole = await readMembershipRole(executor, params.projectId, params.actorId, project.ownerId, true);
    const previousRole = await readMembershipRole(executor, params.projectId, params.targetUserId, project.ownerId, true);
    if (!canProjectRoleManageTarget({ actorRole, targetRole: previousRole, nextRole: params.nextRole })) {
        throw new ForbiddenError("You can’t manage this member");
    }
    if (previousRole === params.nextRole) {
        return { eventId: null, changed: false, project, target: await readProfileSnapshot(executor, params.targetUserId), previousRole, nextRole: params.nextRole };
    }

    const target = await readProfileSnapshot(executor, params.targetUserId);
    await executor
        .update(projectMembers)
        .set({ role: params.nextRole })
        .where(and(eq(projectMembers.projectId, params.projectId), eq(projectMembers.userId, params.targetUserId)));
    await syncProjectChat(executor, params.projectId, params.targetUserId, "role");
    const [event] = await executor.insert(projectNodeEvents).values({
        projectId: params.projectId,
        actorId: params.actorId,
        nodeId: null,
        type: "project_member.role_changed",
        metadata: {
            targetUserId: params.targetUserId,
            targetSnapshot: target,
            previousRole,
            nextRole: params.nextRole,
            targetDisplayName: displayNameForSnapshot(target),
        },
        createdAt: new Date(),
    }).returning({ id: projectNodeEvents.id });

    await upsertProfileProjectContributionFromMembership(executor, {
        profileId: params.targetUserId,
        projectId: params.projectId,
        verifiedBy: params.actorId,
        previousRole,
        nextRole: params.nextRole,
        eventId: event?.id ?? null,
        source: "role_change",
    });

    return { eventId: event?.id ?? null, changed: true, project, target, previousRole, nextRole: params.nextRole };
}

export async function readProjectMemberRemovalImpact(
    executor: ProjectCollaboratorExecutor,
    projectId: string,
    memberUserId: string,
) {
    const [assignedTasks, createdTasks, fileReviews, acceptedApplications, candidates, participantRows] = await Promise.all([
        executor
            .select({ id: tasks.id, title: tasks.title, taskNumber: tasks.taskNumber, status: tasks.status })
            .from(tasks)
            .where(and(eq(tasks.projectId, projectId), eq(tasks.assigneeId, memberUserId), isNull(tasks.deletedAt), sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`))
            .orderBy(sql`${tasks.updatedAt} DESC`)
            .limit(8),
        executor
            .select({ id: tasks.id, title: tasks.title, taskNumber: tasks.taskNumber, status: tasks.status })
            .from(tasks)
            .where(and(eq(tasks.projectId, projectId), eq(tasks.creatorId, memberUserId), isNull(tasks.deletedAt), sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`))
            .orderBy(sql`${tasks.updatedAt} DESC`)
            .limit(8),
        executor
            .select({
                id: taskNodeLinks.id,
                taskId: taskNodeLinks.taskId,
                taskTitle: tasks.title,
                nodeName: projectNodes.name,
                annotation: taskNodeLinks.annotation,
            })
            .from(taskNodeLinks)
            .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
            .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
            .where(and(
                eq(tasks.projectId, projectId),
                isNull(tasks.deletedAt),
                isNull(projectNodes.deletedAt),
                eq(taskNodeLinks.createdBy, memberUserId),
                sql`lower(coalesce(${taskNodeLinks.annotation}, '')) like '%review%'`,
            ))
            .limit(8),
        executor
            .select({
                id: roleApplications.id,
                roleId: roleApplications.roleId,
                roleTitle: projectOpenRoles.title,
                roleName: projectOpenRoles.role,
            })
            .from(roleApplications)
            .leftJoin(projectOpenRoles, eq(projectOpenRoles.id, roleApplications.roleId))
            .where(and(eq(roleApplications.projectId, projectId), eq(roleApplications.applicantId, memberUserId), eq(roleApplications.status, "accepted")))
            .limit(8),
        executor
            .select({
                id: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                role: projectMembers.role,
            })
            .from(projectMembers)
            .innerJoin(profiles, eq(profiles.id, projectMembers.userId))
            .where(and(
                eq(projectMembers.projectId, projectId),
                inArray(projectMembers.role, ["owner", "admin", "member"]),
                sql`${projectMembers.userId} <> ${memberUserId}`,
            ))
            .orderBy(sql`CASE WHEN ${projectMembers.role} = 'owner' THEN 0 WHEN ${projectMembers.role} = 'admin' THEN 1 ELSE 2 END`, sql`${profiles.fullName} ASC NULLS LAST`)
            .limit(20),
        // In the project's #general (report 7.1): removal also removes them from its channels.
        executor
            .select({ userId: chatChannelMembers.userId })
            .from(chatChannelMembers)
            .innerJoin(chatChannels, eq(chatChannels.id, chatChannelMembers.channelId))
            .where(and(
                eq(chatChannels.projectId, projectId),
                eq(chatChannels.isDefault, true),
                eq(chatChannelMembers.userId, memberUserId),
            ))
            .limit(1),
    ]);

    return {
        assignedTasks,
        createdTasks,
        fileReviews,
        acceptedApplications,
        projectGroupParticipant: participantRows.length > 0,
        reassignmentCandidates: candidates.filter((candidate) => isEligibleProjectMember(candidate.role, "assign")),
    };
}

async function readProjectMemberRemovalImpactCounts(
    executor: ProjectCollaboratorExecutor,
    projectId: string,
    memberUserId: string,
) {
    const [assignedTasks, createdTasks, fileReviews, acceptedApplications, participantRows] = await Promise.all([
        executor
            .select({ count: sql<number>`count(*)::int` })
            .from(tasks)
            .where(and(eq(tasks.projectId, projectId), eq(tasks.assigneeId, memberUserId), isNull(tasks.deletedAt), sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`))
            .limit(1),
        executor
            .select({ count: sql<number>`count(*)::int` })
            .from(tasks)
            .where(and(eq(tasks.projectId, projectId), eq(tasks.creatorId, memberUserId), isNull(tasks.deletedAt), sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`))
            .limit(1),
        executor
            .select({ count: sql<number>`count(*)::int` })
            .from(taskNodeLinks)
            .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
            .innerJoin(projectNodes, eq(taskNodeLinks.nodeId, projectNodes.id))
            .where(and(
                eq(tasks.projectId, projectId),
                isNull(tasks.deletedAt),
                isNull(projectNodes.deletedAt),
                eq(taskNodeLinks.createdBy, memberUserId),
                sql`lower(coalesce(${taskNodeLinks.annotation}, '')) like '%review%'`,
            ))
            .limit(1),
        executor
            .select({ count: sql<number>`count(*)::int` })
            .from(roleApplications)
            .where(and(eq(roleApplications.projectId, projectId), eq(roleApplications.applicantId, memberUserId), eq(roleApplications.status, "accepted")))
            .limit(1),
        // In the project's #general (report 7.1): removal also removes them from its channels.
        executor
            .select({ userId: chatChannelMembers.userId })
            .from(chatChannelMembers)
            .innerJoin(chatChannels, eq(chatChannels.id, chatChannelMembers.channelId))
            .where(and(
                eq(chatChannels.projectId, projectId),
                eq(chatChannels.isDefault, true),
                eq(chatChannelMembers.userId, memberUserId),
            ))
            .limit(1),
    ]);

    return {
        activeAssignedTasks: Number(assignedTasks[0]?.count ?? 0),
        activeCreatedTasks: Number(createdTasks[0]?.count ?? 0),
        fileReviews: Number(fileReviews[0]?.count ?? 0),
        acceptedApplications: Number(acceptedApplications[0]?.count ?? 0),
        projectGroupParticipant: participantRows.length > 0,
    };
}

export async function removeProjectMemberInternal(
    executor: ProjectCollaboratorExecutor,
    params: {
        projectId: string;
        actorId: string;
        targetUserId: string;
        mode: "preserve_history" | "unassign_active_tasks" | "reassign_active_tasks";
        reassignToUserId?: string | null;
        /** Leaving: the person removes themself. Only org leave uses it; the owner never leaves this way. */
        allowSelf?: boolean;
    },
): Promise<ProjectCollaboratorLifecycleResult & { assignmentNotifications: EnqueueProjectNotificationEventInput[] }> {
    const project = await readProjectForUpdate(executor, params.projectId);
    if (!project) throw new NotFoundError("Project not found");
    const actorRole = await readMembershipRole(executor, params.projectId, params.actorId, project.ownerId, true);
    const previousRole = await readMembershipRole(executor, params.projectId, params.targetUserId, project.ownerId, true);
    const isLeaving = params.allowSelf === true && params.actorId === params.targetUserId && previousRole !== null && previousRole !== "owner";
    if (!isLeaving && !canProjectRoleManageTarget({ actorRole, targetRole: previousRole })) {
        throw new ForbiddenError("You can’t remove this member");
    }
    const target = await readProfileSnapshot(executor, params.targetUserId);
    const impact = await readProjectMemberRemovalImpact(executor, params.projectId, params.targetUserId);
    const impactCounts = await readProjectMemberRemovalImpactCounts(executor, params.projectId, params.targetUserId);
    const assignmentNotifications: EnqueueProjectNotificationEventInput[] = [];

    if (params.mode === "unassign_active_tasks") {
        await executor
            .update(tasks)
            .set({ assigneeId: null, updatedAt: new Date() })
            .where(and(eq(tasks.projectId, params.projectId), eq(tasks.assigneeId, params.targetUserId), isNull(tasks.deletedAt), sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`));
    } else if (params.mode === "reassign_active_tasks") {
        const replacementId = params.reassignToUserId;
        if (!replacementId || replacementId === params.targetUserId) throw new Error("Choose a valid replacement assignee");
        const replacementRole = await readMembershipRole(executor, params.projectId, replacementId, project.ownerId, true);
        if (!replacementRole || !isEligibleProjectMember(replacementRole, "assign")) {
            throw new Error("Replacement assignee must be an assignable project member");
        }
        const actor = await readProfileSnapshot(executor, params.actorId);
        const replacement = await readProfileSnapshot(executor, replacementId);
        const reassignedTasks = await executor
            .update(tasks)
            .set({ assigneeId: replacementId, updatedAt: new Date() })
            .where(and(eq(tasks.projectId, params.projectId), eq(tasks.assigneeId, params.targetUserId), isNull(tasks.deletedAt), sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`))
            .returning({ id: tasks.id, title: tasks.title, taskNumber: tasks.taskNumber, status: tasks.status, sprintId: tasks.sprintId });
        for (const task of reassignedTasks) {
            const actorName = actor?.fullName || actor?.username || null;
            const actorAvatarUrl = actor?.avatarUrl ?? null;
            const eventId = await recordTaskAssignment(executor, {
                taskId: task.id, projectId: params.projectId, sprintId: task.sprintId,
                title: task.title, taskNumber: task.taskNumber, status: task.status,
                actorId: params.actorId, actorName, actorAvatarUrl,
                previousAssigneeId: params.targetUserId, previousAssignee: target,
                assigneeId: replacementId, assignee: replacement,
            });
            if (replacementId !== params.actorId) assignmentNotifications.push(taskAssignmentNotification({
                taskId: task.id, projectId: params.projectId, projectSlug: project.slug,
                projectKey: project.key, taskNumber: task.taskNumber, title: task.title,
                actorId: params.actorId, actorName, actorAvatarUrl, assigneeId: replacementId, eventId,
            }));
        }
    }

    await syncProjectChat(executor, params.projectId, params.targetUserId, "remove");
    await executor
        .delete(projectMembers)
        .where(and(eq(projectMembers.projectId, params.projectId), eq(projectMembers.userId, params.targetUserId)));

    const [capacityApplication] = await executor
        .select({ roleId: roleApplications.roleId })
        .from(roleApplications)
        .where(and(eq(roleApplications.projectId, params.projectId), eq(roleApplications.applicantId, params.targetUserId), eq(roleApplications.status, "accepted")))
        .orderBy(desc(roleApplications.updatedAt))
        .limit(1);
    if (capacityApplication?.roleId) {
        await executor
            .update(projectOpenRoles)
            .set({ filled: sql`greatest(${projectOpenRoles.filled} - 1, 0)`, updatedAt: new Date() })
            .where(eq(projectOpenRoles.id, capacityApplication.roleId));
    }

    const [event] = await executor.insert(projectNodeEvents).values({
        projectId: params.projectId,
        actorId: params.actorId,
        nodeId: null,
        type: "project_member.removed",
        metadata: {
            targetUserId: params.targetUserId,
            targetSnapshot: target,
            previousRole,
            removalMode: params.mode,
            reassignToUserId: params.reassignToUserId ?? null,
            targetDisplayName: displayNameForSnapshot(target),
            affectedCounts: {
                activeAssignedTasks: impactCounts.activeAssignedTasks,
                activeCreatedTasks: impactCounts.activeCreatedTasks,
                fileReviews: impactCounts.fileReviews,
                acceptedApplications: impactCounts.acceptedApplications,
                projectGroupParticipant: impactCounts.projectGroupParticipant,
            },
        },
        createdAt: new Date(),
    }).returning({ id: projectNodeEvents.id });

    await endProfileProjectContributionMembership(executor, {
        profileId: params.targetUserId,
        projectId: params.projectId,
        verifiedBy: params.actorId,
        eventId: event?.id ?? null,
    });
    await markProfileCollaborationSummaryStale(project.ownerId, executor);

    return { eventId: event?.id ?? null, changed: true, project, target, previousRole, nextRole: null, assignmentNotifications };
}
