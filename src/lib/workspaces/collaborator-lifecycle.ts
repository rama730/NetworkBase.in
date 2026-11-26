import { and, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";

import { ForbiddenError, NotFoundError } from "@/lib/errors/domain";
import { db } from "@/lib/db";
import { afterCommit } from "@/lib/db/after-commit";
import {
    applicationEvents,
    chatChannelMembers,
    chatChannels,
    profiles,
    workspaceMembers,
    workspaceNodeEvents,
    workspaceOpenRoles,
    workspaces,
    roleApplications,
    taskNodeLinks,
    tasks,
    workspaceNodes,
    workspaceInvitations,
    workspaceMemberPeriods,
} from "@/lib/db/schema";
import { closePendingApplications, resolveApplicationsOnJoin } from "@/lib/applications/closing";
import { syncWorkspaceChat } from "@/lib/messaging/integrations";
import { recordTaskAssignment, taskAssignmentNotification } from "@/lib/workspaces/task-assignment";
import type { EnqueueWorkspaceNotificationEventInput } from "@/lib/notifications/workspace-events";
import {
    isEligibleWorkspaceMember,
    normalizeWorkspaceMemberRole,
    projectMemberCan,
    type WorkspaceMemberCapability,
    type WorkspaceMemberEligibility,
    type WorkspaceMemberRole,
} from "@/lib/workspaces/settings-policies";
import {
    endProfileWorkspaceContributionMembership, type MembershipEnding,
    markProfileCollaborationSummaryStale,
    upsertProfileWorkspaceContributionFromMembership,
} from "@/lib/profile/collaboration";
import { getWorkspaceAccessById, type WorkspaceAccess } from "@/lib/data/workspace-access";

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
export type WorkspaceCollaboratorExecutor = typeof db | DbTransaction;

export type WorkspaceCollaboratorSnapshot = {
    id: string;
    username: string | null;
    fullName: string | null;
    avatarUrl: string | null;
};

export type WorkspaceCollaboratorLifecycleResult = {
    eventId: string | null;
    changed: boolean;
    project: {
        id: string;
        ownerId: string;
        title: string | null;
        slug: string | null;
    };
    target: WorkspaceCollaboratorSnapshot | null;
    previousRole: WorkspaceMemberRole | null;
    nextRole: WorkspaceMemberRole | null;
    /** Pending applications closed because this member filled their role (the caller notifies them after commit). */
    closedApplications?: Array<{ id: string; applicantId: string; roleId: string }>;
    /** Candidates whose pending invitation expired because the role filled (the caller tells them after commit). */
    expiredInvitationCandidates?: string[];
};

function displayNameForSnapshot(snapshot: WorkspaceCollaboratorSnapshot | null) {
    return snapshot?.fullName || snapshot?.username || "Workspace member";
}

function roleRank(role: WorkspaceMemberRole | null) {
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

export async function readProjectForUpdate(executor: WorkspaceCollaboratorExecutor, projectId: string) {
    const rows = await executor.execute<{
        id: string;
        owner_id: string;
        title: string | null;
        slug: string | null;
        key: string | null;
        member_file_upload_default: boolean | null;
    }>(sql`
        SELECT id, owner_id, title, slug, member_file_upload_default, key
        FROM ${workspaces}
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

export async function readProfileSnapshot(executor: WorkspaceCollaboratorExecutor, userId: string): Promise<WorkspaceCollaboratorSnapshot | null> {
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

export async function readMembershipRole(
    executor: WorkspaceCollaboratorExecutor,
    projectId: string,
    userId: string,
    ownerId: string,
    lock = false,
) {
    if (userId === ownerId) return "owner" as WorkspaceMemberRole;
    if (lock) {
        const rows = await executor.execute<{ role: WorkspaceMemberRole }>(sql`
            SELECT role
            FROM ${workspaceMembers}
            WHERE workspace_id = ${projectId} AND user_id = ${userId}
            FOR UPDATE
        `);
        const row = Array.from(rows)[0];
        return row ? normalizeWorkspaceMemberRole(row.role) : null;
    }
    const [member] = await executor
        .select({ role: workspaceMembers.role })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.projectId, projectId), eq(workspaceMembers.userId, userId)))
        .limit(1);
    return member ? normalizeWorkspaceMemberRole(member.role) : null;
}

export function canWorkspaceRoleManageTarget(params: {
    actorRole: WorkspaceMemberRole | null;
    targetRole: WorkspaceMemberRole | null;
    nextRole?: WorkspaceMemberRole | null;
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

export function isWorkspaceMemberEligibleFor(role: unknown, eligibility: WorkspaceMemberEligibility) {
    return isEligibleWorkspaceMember(role, eligibility);
}

/** The capability check on an access record that is already loaded, so one read can serve several checks. */
/** What an organization admin not on the team may do in its workspace (decision 139): its tasks, as an admin would. */
const INHERITED_ADMIN_CAPABILITIES = new Set<WorkspaceMemberCapability>(["create_tasks", "assign_tasks", "manage_tasks", "comment"]);

export function capabilityFromAccess(access: WorkspaceAccess, capability: WorkspaceMemberCapability) {
    if (!access.project) throw new NotFoundError("Workspace not found");
    const role = access.isOwner ? "owner" : access.memberRole ?? (access.isInheritedAdmin && INHERITED_ADMIN_CAPABILITIES.has(capability) ? "admin" : null);
    if (!role || !projectMemberCan(role, capability)) {
        throw new ForbiddenError("You do not have permission to perform this workspace action");
    }
    return { project: access.project, role };
}

export async function requireWorkspaceCapability(
    projectId: string,
    userId: string,
    capability: WorkspaceMemberCapability,
    executor: WorkspaceCollaboratorExecutor = db,
) {
    if (executor === db) return capabilityFromAccess(await getWorkspaceAccessById(projectId, userId), capability);

    const [project] = await executor
        .select({ id: workspaces.id, ownerId: workspaces.ownerId })
        .from(workspaces)
        .where(and(eq(workspaces.id, projectId), isNull(workspaces.deletedAt)))
        .limit(1);
    if (!project) throw new NotFoundError("Workspace not found");
    const role = await readMembershipRole(executor, projectId, userId, project.ownerId, false);
    if (!role || !projectMemberCan(role, capability)) {
        throw new ForbiddenError("You do not have permission to perform this workspace action");
    }
    return { project, role };
}

export async function addWorkspaceMemberInternal(
    executor: WorkspaceCollaboratorExecutor,
    params: {
        projectId: string;
        userId: string;
        role?: Exclude<WorkspaceMemberRole, "owner">;
        actorId: string;
        /** Audit 3.1: an org admin adding someone with the lead's powers is recorded as themselves. */
        realActorId?: string;
        source: "application_accept" | "workspace_invite" | "manual" | "ownership_transfer" | "join_code" | "email_invite";
        applicationId?: string | null;
        roleId?: string | null;
        incrementRoleCapacity?: boolean;
    },
): Promise<WorkspaceCollaboratorLifecycleResult> {
    const project = await readProjectForUpdate(executor, params.projectId);
    if (!project) throw new NotFoundError("Workspace not found");
    const target = await readProfileSnapshot(executor, params.userId);
    const previousRole = await readMembershipRole(executor, params.projectId, params.userId, project.ownerId, true);
    const nextRole = params.userId === project.ownerId ? "owner" : normalizeWorkspaceMemberRole(params.role ?? "member", "member");
    let changed = false;
    let closedApplications: Array<{ id: string; applicantId: string; roleId: string }> = [];
    let expiredInvitationCandidates: string[] = [];

    if (!previousRole) {
        await executor.insert(workspaceMembers).values({
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
            .update(workspaceMembers)
            .set({ role: nextRole })
            .where(and(eq(workspaceMembers.projectId, params.projectId), eq(workspaceMembers.userId, params.userId)));
        changed = true;
    }

    // ponytail: atomic role capacity enforcement ensures open role vacancies are strictly verified and decremented under concurrency. ceiling: 1M concurrent members. upgrade: partition capacity counter if role vacancies exceed 500.
    const shouldIncrementCapacity = Boolean(params.roleId && (changed || params.source === "application_accept"));
    if (shouldIncrementCapacity && params.incrementRoleCapacity !== false && params.roleId) {
        const roleRows = await executor
            .select({ id: workspaceOpenRoles.id, filled: workspaceOpenRoles.filled, count: workspaceOpenRoles.count })
            .from(workspaceOpenRoles)
            .where(eq(workspaceOpenRoles.id, params.roleId))
            .for("update")
            .limit(1);
        const role = roleRows[0];
        if (!role) throw new NotFoundError("Role not found");
        if (role.filled >= role.count) throw new Error("Role is full");
        await executor
            .update(workspaceOpenRoles)
            .set({ filled: sql`${workspaceOpenRoles.filled} + 1`, updatedAt: new Date() })
            .where(eq(workspaceOpenRoles.id, params.roleId));

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
                    .select({ assigneeUserId: workspaceInvitations.candidateId })
                    .from(workspaceInvitations)
                    .where(and(
                        eq(workspaceInvitations.projectId, params.projectId),
                        eq(workspaceInvitations.roleId, params.roleId),
                        eq(workspaceInvitations.status, 'pending'),
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
                .update(workspaceInvitations)
                .set({ status: "expired", resolvedAt: new Date(), resolvedBy: params.actorId, updatedAt: new Date() })
                .where(and(
                    eq(workspaceInvitations.projectId, params.projectId),
                    eq(workspaceInvitations.roleId, params.roleId),
                    eq(workspaceInvitations.status, "pending"),
                ))
                .returning({ candidateId: workspaceInvitations.candidateId });
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
    await syncWorkspaceChat(executor, params.projectId, params.userId, "add");

    // Joining another way (an invitation, being added) closes a pending application of the same person.
    if (!previousRole && params.source !== "application_accept") {
        await resolveApplicationsOnJoin(executor, { projectId: params.projectId, userId: params.userId, actorId: params.actorId });
    }

    const [event] = await executor.insert(workspaceNodeEvents).values({
        projectId: params.projectId,
        actorId: params.realActorId ?? params.actorId,
        nodeId: null,
        type: "workspace_member.added",
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
    }).returning({ id: workspaceNodeEvents.id });

    if (changed) {
        await upsertProfileWorkspaceContributionFromMembership(executor, {
            profileId: params.userId,
            projectId: params.projectId,
            verifiedBy: params.realActorId ?? params.actorId,
            previousRole,
            nextRole,
            eventId: event?.id ?? null,
            source: params.source === "workspace_invite"
                ? "workspace_invite"
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

export async function changeWorkspaceMemberRoleInternal(
    executor: WorkspaceCollaboratorExecutor,
    params: {
        projectId: string;
        actorId: string;
        /** Audit 3.1: who really did it (an org admin acting with the owner's powers); recorded on the event. */
        realActorId?: string;
        targetUserId: string;
        nextRole: Exclude<WorkspaceMemberRole, "owner">;
    },
): Promise<WorkspaceCollaboratorLifecycleResult> {
    const project = await readProjectForUpdate(executor, params.projectId);
    if (!project) throw new NotFoundError("Workspace not found");
    const actorRole = await readMembershipRole(executor, params.projectId, params.actorId, project.ownerId, true);
    const previousRole = await readMembershipRole(executor, params.projectId, params.targetUserId, project.ownerId, true);
    if (!canWorkspaceRoleManageTarget({ actorRole, targetRole: previousRole, nextRole: params.nextRole })) {
        throw new ForbiddenError("You can’t manage this member");
    }
    // Member settings §3: a completed part keeps its dates; a role change would open a new stage behind their back.
    const [completed] = await executor.select({ at: workspaceMembers.completedAt }).from(workspaceMembers)
        .where(and(eq(workspaceMembers.projectId, params.projectId), eq(workspaceMembers.userId, params.targetUserId))).limit(1);
    if (completed?.at) throw new ForbiddenError("Their part here is completed. They reopen it first, then their role can change.");
    if (previousRole === params.nextRole) {
        return { eventId: null, changed: false, project, target: await readProfileSnapshot(executor, params.targetUserId), previousRole, nextRole: params.nextRole };
    }

    const target = await readProfileSnapshot(executor, params.targetUserId);
    await executor
        .update(workspaceMembers)
        .set(params.nextRole === "viewer"
            // B5.2 review: a community label (Moderator, Host, Helper) ends with the move to Viewer; it isn't back if they return.
            ? { role: params.nextRole, viewPrefs: sql`${workspaceMembers.viewPrefs} #- '{community,labels}'` as never }
            : { role: params.nextRole })
        .where(and(eq(workspaceMembers.projectId, params.projectId), eq(workspaceMembers.userId, params.targetUserId)));
    await syncWorkspaceChat(executor, params.projectId, params.targetUserId, "role");
    const [event] = await executor.insert(workspaceNodeEvents).values({
        projectId: params.projectId,
        actorId: params.realActorId ?? params.actorId,
        nodeId: null,
        type: "workspace_member.role_changed",
        metadata: {
            targetUserId: params.targetUserId,
            targetSnapshot: target,
            previousRole,
            nextRole: params.nextRole,
            targetDisplayName: displayNameForSnapshot(target),
        },
        createdAt: new Date(),
    }).returning({ id: workspaceNodeEvents.id });

    await upsertProfileWorkspaceContributionFromMembership(executor, {
        profileId: params.targetUserId,
        projectId: params.projectId,
        verifiedBy: params.realActorId ?? params.actorId,
        previousRole,
        nextRole: params.nextRole,
        eventId: event?.id ?? null,
        source: "role_change",
    });

    return { eventId: event?.id ?? null, changed: true, project, target, previousRole, nextRole: params.nextRole };
}

export async function readWorkspaceMemberRemovalImpact(
    executor: WorkspaceCollaboratorExecutor,
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
                nodeName: workspaceNodes.name,
                annotation: taskNodeLinks.annotation,
            })
            .from(taskNodeLinks)
            .innerJoin(tasks, eq(taskNodeLinks.taskId, tasks.id))
            .innerJoin(workspaceNodes, eq(taskNodeLinks.nodeId, workspaceNodes.id))
            .where(and(
                eq(tasks.projectId, projectId),
                isNull(tasks.deletedAt),
                isNull(workspaceNodes.deletedAt),
                eq(taskNodeLinks.createdBy, memberUserId),
                sql`lower(coalesce(${taskNodeLinks.annotation}, '')) like '%review%'`,
            ))
            .limit(8),
        executor
            .select({
                id: roleApplications.id,
                roleId: roleApplications.roleId,
                roleTitle: workspaceOpenRoles.title,
                roleName: workspaceOpenRoles.role,
            })
            .from(roleApplications)
            .leftJoin(workspaceOpenRoles, eq(workspaceOpenRoles.id, roleApplications.roleId))
            .where(and(eq(roleApplications.projectId, projectId), eq(roleApplications.applicantId, memberUserId), eq(roleApplications.status, "accepted")))
            .limit(8),
        executor
            .select({
                id: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                role: workspaceMembers.role,
            })
            .from(workspaceMembers)
            .innerJoin(profiles, eq(profiles.id, workspaceMembers.userId))
            .where(and(
                eq(workspaceMembers.projectId, projectId),
                inArray(workspaceMembers.role, ["owner", "admin", "member"]),
                sql`${workspaceMembers.userId} <> ${memberUserId}`,
            ))
            .orderBy(sql`CASE WHEN ${workspaceMembers.role} = 'owner' THEN 0 WHEN ${workspaceMembers.role} = 'admin' THEN 1 ELSE 2 END`, sql`${profiles.fullName} ASC NULLS LAST`)
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
        reassignmentCandidates: candidates.filter((candidate) => isEligibleWorkspaceMember(candidate.role, "assign")),
    };
}

async function readProjectMemberRemovalImpactCounts(
    executor: WorkspaceCollaboratorExecutor,
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
            .innerJoin(workspaceNodes, eq(taskNodeLinks.nodeId, workspaceNodes.id))
            .where(and(
                eq(tasks.projectId, projectId),
                isNull(tasks.deletedAt),
                isNull(workspaceNodes.deletedAt),
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

export async function removeWorkspaceMemberInternal(
    executor: WorkspaceCollaboratorExecutor,
    params: {
        projectId: string;
        actorId: string;
        targetUserId: string;
        mode: "preserve_history" | "unassign_active_tasks" | "reassign_active_tasks";
        reassignToUserId?: string | null;
        /** Leaving: the person removes themself. Only org leave uses it; the owner never leaves this way. */
        allowSelf?: boolean;
        /** How it ended, recorded on their profile entry (report §10.1). */
        ending?: MembershipEnding;
        /** Who really did it, when an organization admin acts with the lead's powers (`actorId` is then the lead). */
        realActorId?: string;
    },
): Promise<WorkspaceCollaboratorLifecycleResult & { assignmentNotifications: EnqueueWorkspaceNotificationEventInput[]; teamsWithoutLead?: string[] }> {
    const project = await readProjectForUpdate(executor, params.projectId);
    if (!project) throw new NotFoundError("Workspace not found");
    const actorRole = await readMembershipRole(executor, params.projectId, params.actorId, project.ownerId, true);
    const previousRole = await readMembershipRole(executor, params.projectId, params.targetUserId, project.ownerId, true);
    const isLeaving = params.allowSelf === true && params.actorId === params.targetUserId && previousRole !== null && previousRole !== "owner";
    if (!isLeaving && !canWorkspaceRoleManageTarget({ actorRole, targetRole: previousRole })) {
        throw new ForbiddenError("You can’t remove this member");
    }
    const target = await readProfileSnapshot(executor, params.targetUserId);
    // Member settings §3/§4: a completed part keeps its Completed dates; anyone else gets a finished period recorded.
    const [targetRow] = await executor.select({ completedAt: workspaceMembers.completedAt, joinedAt: workspaceMembers.joinedAt, role: workspaceMembers.role })
        .from(workspaceMembers).where(and(eq(workspaceMembers.projectId, params.projectId), eq(workspaceMembers.userId, params.targetUserId))).limit(1);
    const impact = await readWorkspaceMemberRemovalImpact(executor, params.projectId, params.targetUserId);
    const impactCounts = await readProjectMemberRemovalImpactCounts(executor, params.projectId, params.targetUserId);
    const assignmentNotifications: EnqueueWorkspaceNotificationEventInput[] = [];

    if (params.mode === "unassign_active_tasks") {
        await executor
            .update(tasks)
            .set({ assigneeId: null, updatedAt: new Date() })
            .where(and(eq(tasks.projectId, params.projectId), eq(tasks.assigneeId, params.targetUserId), isNull(tasks.deletedAt), sql`(${tasks.status} <> 'done' OR ${tasks.reviewStatus} = 'pending')`));
    } else if (params.mode === "reassign_active_tasks") {
        const replacementId = params.reassignToUserId;
        if (!replacementId || replacementId === params.targetUserId) throw new Error("Choose a valid replacement assignee");
        const replacementRole = await readMembershipRole(executor, params.projectId, replacementId, project.ownerId, true);
        if (!replacementRole || !isEligibleWorkspaceMember(replacementRole, "assign")) {
            throw new Error("New assignee must be an assignable workspace member");
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

    await syncWorkspaceChat(executor, params.projectId, params.targetUserId, "remove");
    await executor
        .delete(workspaceMembers)
        .where(and(eq(workspaceMembers.projectId, params.projectId), eq(workspaceMembers.userId, params.targetUserId)));
    // A team lead who leaves leaves the team without one, and the workspace's lead is told (report §30.4), once the
    // caller's transaction commits (`transactionThen`), so a rolled-back removal tells no one.
    const teamsWithoutLead = (await executor.update(workspaceOpenRoles)
        .set({ leadUserId: null, updatedAt: new Date() })
        .where(and(eq(workspaceOpenRoles.projectId, params.projectId), eq(workspaceOpenRoles.leadUserId, params.targetUserId)))
        .returning({ title: workspaceOpenRoles.title, role: workspaceOpenRoles.role })).map((t) => t.title || t.role);
    if (teamsWithoutLead.length) {
        afterCommit(executor, () => import("@/lib/organizations/notify").then(({ notifyTeamsWithoutLead }) => notifyTeamsWithoutLead(params.projectId, params.realActorId ?? params.actorId, teamsWithoutLead)));
    }

    const [capacityApplication] = await executor
        .select({ roleId: roleApplications.roleId })
        .from(roleApplications)
        .where(and(eq(roleApplications.projectId, params.projectId), eq(roleApplications.applicantId, params.targetUserId), eq(roleApplications.status, "accepted")))
        .orderBy(desc(roleApplications.updatedAt))
        .limit(1);
    if (capacityApplication?.roleId) {
        await executor
            .update(workspaceOpenRoles)
            .set({ filled: sql`greatest(${workspaceOpenRoles.filled} - 1, 0)`, updatedAt: new Date() })
            .where(eq(workspaceOpenRoles.id, capacityApplication.roleId));
    }

    const [event] = await executor.insert(workspaceNodeEvents).values({
        projectId: params.projectId,
        actorId: params.realActorId ?? params.actorId,
        nodeId: null,
        type: "workspace_member.removed",
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
    }).returning({ id: workspaceNodeEvents.id });

    if (!targetRow?.completedAt) {
        const endedAt = new Date();
        const { currentPeriodStart } = await import("@/lib/workspaces/member-periods");
        await executor.insert(workspaceMemberPeriods).values({
            projectId: params.projectId, userId: params.targetUserId, role: targetRow?.role ?? previousRole ?? "member",
            startedAt: await currentPeriodStart(executor, params.projectId, params.targetUserId, targetRow?.joinedAt ?? endedAt),
            endedAt, endReason: isLeaving || params.ending?.reason === "finished" ? "left" : "removed", endedBy: params.realActorId ?? params.actorId,
            note: params.ending?.note?.trim().slice(0, 280) || null,
        });
        await endProfileWorkspaceContributionMembership(executor, {
            profileId: params.targetUserId,
            projectId: params.projectId,
            verifiedBy: params.realActorId ?? params.actorId,
            eventId: event?.id ?? null,
            ending: params.ending,
        });
    }
    await markProfileCollaborationSummaryStale(project.ownerId, executor);

    return { eventId: event?.id ?? null, changed: true, project, target, previousRole, nextRole: null, assignmentNotifications, teamsWithoutLead };
}
