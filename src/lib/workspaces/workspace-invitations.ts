import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
    workspaceMentors,
    workspaceInvitations,
    workspaceNodeEvents,
    workspaceOpenRoles,
    workspaces,
} from "@/lib/db/schema";
import { resolvePrivacyRelationship } from "@/lib/privacy/resolver";
import { getGuidanceCapacityState } from "@/lib/workspaces/guidance-capacity";
import {
    addWorkspaceMemberInternal,
    type WorkspaceCollaboratorExecutor,
} from "@/lib/workspaces/collaborator-lifecycle";

const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type WorkspaceInvitationKind = "ordinary_role" | "guidance_appointment";

export type CreateWorkspaceInvitationInput = {
    actorId: string;
    candidateId: string;
    projectId: string;
    kind: WorkspaceInvitationKind;
    roleId?: string | null;
    note?: string | null;
    guidanceLabel?: string | null;
    reviewAt?: Date | null;
    idempotencyKey?: string | null;
};

type InvitationExecutor = WorkspaceCollaboratorExecutor;

function cleanOptionalText(value: string | null | undefined, limit: number) {
    const cleaned = value?.trim().replace(/\s+/g, " ") ?? "";
    return cleaned ? cleaned.slice(0, limit) : null;
}

function cleanGuidanceLabel(value: string | null | undefined) {
    return cleanOptionalText(value, 60);
}

async function lockProject(executor: InvitationExecutor, projectId: string) {
    const rows = await executor.execute<{
        id: string;
        owner_id: string;
        title: string | null;
        slug: string | null;
        status: string | null;
    }>(sql`
        SELECT id, owner_id, title, slug, status
        FROM ${workspaces}
        WHERE id = ${projectId} AND deleted_at IS NULL
        FOR UPDATE
    `);
    return Array.from(rows)[0] ?? null;
}

/**
 * Serializes guidance admission for one person (COR-051). The count below spans every project the
 * guide serves, but only the current project is locked, so two acceptances on different projects
 * could both read 11 and insert. Take the guide's capacity lock first. Lock order is always
 * project row, then guide capacity, so no two admissions can wait on each other.
 */
async function lockGuidanceCapacity(executor: InvitationExecutor, guideUserId: string) {
    await executor.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`guidance-capacity:${guideUserId}`}, 0))`);
}

async function activeGuidanceCount(executor: InvitationExecutor, guideUserId: string) {
    const [row] = await executor
        .select({ count: sql<number>`count(*)::int` })
        .from(workspaceMentors)
        .where(and(
            eq(workspaceMentors.guideUserId, guideUserId),
            eq(workspaceMentors.status, "active"),
        ));
    return row?.count ?? 0;
}

export async function createWorkspaceInvitation(input: CreateWorkspaceInvitationInput) {
    const now = new Date();
    const idempotencyKey = cleanOptionalText(input.idempotencyKey, 160);
    const privacy = await resolvePrivacyRelationship(input.actorId, input.candidateId);
    if (!privacy?.canViewProfile || privacy.blockedByViewer || privacy.blockedByTarget) {
        throw new Error("This person is not eligible for an invitation");
    }

    return db.transaction(async (tx) => {
        if (input.actorId === input.candidateId) throw new Error("Choose someone else to invite");

        if (idempotencyKey) {
            const [existing] = await tx
                .select({
                    id: workspaceInvitations.id,
                    inviterId: workspaceInvitations.inviterId,
                    idempotencyKey: workspaceInvitations.idempotencyKey,
                    candidateId: workspaceInvitations.candidateId,
                    projectId: workspaceInvitations.projectId,
                    roleId: workspaceInvitations.roleId,
                    roleTitle: workspaceInvitations.roleTitle,
                    projectTitle: workspaceInvitations.projectTitle,
                    kind: workspaceInvitations.kind,
                    guidanceLabel: workspaceInvitations.guidanceLabel,
                    status: workspaceInvitations.status,
                    expiresAt: workspaceInvitations.expiresAt,
                    reviewAt: workspaceInvitations.reviewAt,
                    note: workspaceInvitations.note,
                    createdAt: workspaceInvitations.createdAt,
                    updatedAt: workspaceInvitations.updatedAt,
                })
                .from(workspaceInvitations)
                .where(and(
                    eq(workspaceInvitations.inviterId, input.actorId),
                    eq(workspaceInvitations.idempotencyKey, idempotencyKey),
                ))
                .limit(1);
            if (existing) return { invitation: existing as unknown as typeof workspaceInvitations.$inferSelect, created: false, projectSlug: null };
        }

        const project = await lockProject(tx, input.projectId);
        if (!project || project.status === "archived") throw new Error("Workspace is unavailable");
        // Restricted by NetworkBase (trust and safety §7.2): private only, no new invites.
        const [restricted] = await tx.select({ at: workspaces.restrictedAt }).from(workspaces).where(eq(workspaces.id, input.projectId)).limit(1);
        if (restricted?.at) throw new Error("This workspace is restricted for now, so it can’t invite anyone");

        await tx.update(workspaceInvitations)
            .set({ status: "expired", resolvedAt: now, updatedAt: now })
            .where(and(
                eq(workspaceInvitations.projectId, input.projectId),
                eq(workspaceInvitations.status, "pending"),
                // Keep this comparison in PostgreSQL. Raw SQL interpolation does not
                // encode JavaScript Date values for the postgres driver, which would
                // otherwise prevent every new invitation from being created.
                sql`${workspaceInvitations.expiresAt} <= now()`,
            ));

        const preflightRows = (await tx.execute(sql`
            SELECT 
                pm_actor.role AS actor_role,
                EXISTS(SELECT 1 FROM profiles WHERE id = ${input.candidateId}::uuid) AS candidate_exists,
                EXISTS(SELECT 1 FROM workspace_members WHERE workspace_id = ${input.projectId}::uuid AND user_id = ${input.candidateId}::uuid) AS candidate_is_member,
                EXISTS(SELECT 1 FROM role_applications WHERE workspace_id = ${input.projectId}::uuid AND applicant_id = ${input.candidateId}::uuid AND status = 'pending') AS has_pending_app
            FROM (SELECT 1) _
            LEFT JOIN workspace_members pm_actor ON pm_actor.workspace_id = ${input.projectId}::uuid AND pm_actor.user_id = ${input.actorId}::uuid
        `)) as unknown as Array<{
            actor_role: string | null;
            candidate_exists: boolean;
            candidate_is_member: boolean;
            has_pending_app: boolean;
        }>;

        const preflight = preflightRows[0];
        const managerRole = input.actorId === project.owner_id ? "owner" as const : (preflight?.actor_role === "admin" ? "admin" as const : null);
        if (!managerRole) throw new Error("You can only invite to workspaces you manage");
        if (input.kind === "guidance_appointment" && managerRole !== "owner") {
            throw new Error("Only the owner can invite a mentor");
        }

        if (!preflight?.candidate_exists) throw new Error("Candidate not found");
        if (input.candidateId === project.owner_id) throw new Error("The owner can’t also be a mentor");
        if (preflight.candidate_is_member) throw new Error("User is already a member of this workspace");
        if (preflight.has_pending_app) throw new Error("Review the existing application before sending an invitation");

        let roleId: string | null = null;
        let roleTitle: string | null = null;
        let guidanceLabel: string | null = null;

        if (input.kind === "ordinary_role") {
            if (!input.roleId) throw new Error("Select an available role");
            const [role] = await tx
                .select({ id: workspaceOpenRoles.id, title: workspaceOpenRoles.title, role: workspaceOpenRoles.role, filled: workspaceOpenRoles.filled, count: workspaceOpenRoles.count })
                .from(workspaceOpenRoles)
                .where(and(eq(workspaceOpenRoles.id, input.roleId), eq(workspaceOpenRoles.projectId, input.projectId)))
                .limit(1);
            if (!role || (role.filled ?? 0) >= (role.count ?? 0)) throw new Error("This workspace role is no longer available");
            roleId = role.id;
            roleTitle = cleanOptionalText(role.title || role.role || "Member", 160) || "Member";

            const [pending] = await tx
                .select({ id: workspaceInvitations.id })
                .from(workspaceInvitations)
                .where(and(
                    eq(workspaceInvitations.projectId, input.projectId),
                    eq(workspaceInvitations.candidateId, input.candidateId),
                    eq(workspaceInvitations.kind, "ordinary_role"),
                    eq(workspaceInvitations.status, "pending"),
                ))
                .limit(1);
            if (pending) throw new Error("An invitation for this workspace is already pending");
        } else {
            guidanceLabel = cleanGuidanceLabel(input.guidanceLabel);
            if (!guidanceLabel) throw new Error("Enter a mentor focus");

            const [pending] = await tx
                .select({ id: workspaceInvitations.id })
                .from(workspaceInvitations)
                .where(and(
                    eq(workspaceInvitations.projectId, input.projectId),
                    eq(workspaceInvitations.kind, "guidance_appointment"),
                    eq(workspaceInvitations.status, "pending"),
                ))
                .limit(1);
            const [active] = await tx
                .select({ id: workspaceMentors.id })
                .from(workspaceMentors)
                .where(and(
                    eq(workspaceMentors.projectId, input.projectId),
                    eq(workspaceMentors.status, "active"),
                ))
                .limit(1);
            if (pending || active) throw new Error("This workspace already has a pending or active guidance appointment");

            const count = await activeGuidanceCount(tx, input.candidateId);
            if (getGuidanceCapacityState(count) === "blocked") throw new Error("This person has reached the active guidance appointment limit");
        }

        const [invitation] = await tx
            .insert(workspaceInvitations)
            .values({
                projectId: input.projectId,
                inviterId: input.actorId,
                candidateId: input.candidateId,
                kind: input.kind,
                roleId,
                roleTitle,
                guidanceLabel,
                note: cleanOptionalText(input.note, 500),
                projectTitle: cleanOptionalText(project.title, 200) || "Workspace",
                status: "pending",
                expiresAt: new Date(now.getTime() + INVITATION_TTL_MS),
                reviewAt: input.reviewAt ?? null,
                idempotencyKey,
                createdAt: now,
                updatedAt: now,
            })
            .returning();

        if (!invitation) throw new Error("Couldn’t create invitation");
        return {
            invitation,
            created: true,
            projectSlug: project.slug,
            capacityWarning: input.kind === "guidance_appointment" && getGuidanceCapacityState(await activeGuidanceCount(tx, input.candidateId)) === "warning",
        };
    });
}

export async function resolveWorkspaceInvitationInternal(
    executor: InvitationExecutor,
    input: { invitationId: string; actorId: string; action: "accept" | "decline" | "cancel" },
) {
    const [target] = await executor
        .select({ id: workspaceInvitations.id, projectId: workspaceInvitations.projectId })
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.id, input.invitationId))
        .limit(1);
    if (!target) throw new Error("Invitation not found");

    const project = await lockProject(executor, target.projectId);
    if (!project) throw new Error("Workspace is unavailable");
    if (project.status === "archived" && input.action !== "cancel") throw new Error("Workspace is unavailable");

    const [invitation] = await executor
        .select()
        .from(workspaceInvitations)
        .where(eq(workspaceInvitations.id, input.invitationId))
        .for("update")
        .limit(1);
    if (!invitation) throw new Error("Invitation not found");
    if (invitation.status !== "pending") throw new Error("This invitation has already been resolved");

    const now = new Date();
    if (invitation.expiresAt <= now) {
        await executor.update(workspaceInvitations)
            .set({ status: "expired", resolvedAt: now, updatedAt: now })
            .where(eq(workspaceInvitations.id, invitation.id));
        throw new Error("This invitation has expired");
    }

    const isCandidate = invitation.candidateId === input.actorId;
    const isLead = project.owner_id === input.actorId;
    if (input.action === "cancel") {
        if (!isLead && invitation.inviterId !== input.actorId) throw new Error("Only the person who invited them or the owner can cancel this invitation");
        await executor.update(workspaceInvitations)
            .set({ status: "cancelled", resolvedAt: now, resolvedBy: input.actorId, updatedAt: now })
            .where(eq(workspaceInvitations.id, invitation.id));
        return { invitation, lifecycle: null, appointment: null };
    }
    if (!isCandidate) throw new Error("Only the invited person can resolve this invitation");
    if (input.action === "decline") {
        await executor.update(workspaceInvitations)
            .set({ status: "declined", resolvedAt: now, resolvedBy: input.actorId, updatedAt: now })
            .where(eq(workspaceInvitations.id, invitation.id));
        return { invitation, lifecycle: null, appointment: null };
    }

    const privacyWithOwner = await resolvePrivacyRelationship(invitation.candidateId, project.owner_id);
    if (!privacyWithOwner?.canViewProfile || privacyWithOwner.blockedByViewer || privacyWithOwner.blockedByTarget) {
        throw new Error("Cannot accept invitation due to privacy restrictions");
    }
    if (invitation.inviterId && invitation.inviterId !== project.owner_id) {
        const privacyWithInviter = await resolvePrivacyRelationship(invitation.candidateId, invitation.inviterId);
        if (privacyWithInviter?.blockedByViewer || privacyWithInviter?.blockedByTarget) {
            throw new Error("Cannot accept invitation due to privacy restrictions");
        }
    }

    if (invitation.candidateId === project.owner_id) throw new Error("The owner can’t also be a mentor");

    let appointment: typeof workspaceMentors.$inferSelect | null = null;
    if (invitation.kind === "guidance_appointment") {
        const [active] = await executor
            .select({ id: workspaceMentors.id })
            .from(workspaceMentors)
            .where(and(
                eq(workspaceMentors.projectId, invitation.projectId),
                eq(workspaceMentors.status, "active"),
            ))
            .limit(1);
        if (active) throw new Error("This workspace already has an active guidance appointment");
        await lockGuidanceCapacity(executor, invitation.candidateId);
        const count = await activeGuidanceCount(executor, invitation.candidateId);
        if (getGuidanceCapacityState(count) === "blocked") throw new Error("This person has reached the active guidance appointment limit");
    }

    const lifecycle = await addWorkspaceMemberInternal(executor, {
        projectId: invitation.projectId,
        userId: invitation.candidateId,
        role: invitation.kind === "guidance_appointment" ? "admin" : "member",
        actorId: input.actorId,
        source: "workspace_invite",
        roleId: invitation.kind === "ordinary_role" ? invitation.roleId : null,
        incrementRoleCapacity: invitation.kind === "ordinary_role" && Boolean(invitation.roleId),
    });

    if (invitation.kind === "guidance_appointment") {
        const [createdAppointment] = await executor
            .insert(workspaceMentors)
            .values({
                projectId: invitation.projectId,
                guideUserId: invitation.candidateId,
                invitationId: invitation.id,
                label: invitation.guidanceLabel || "Mentor",
                status: "active",
                reviewAt: invitation.reviewAt,
                previousMembershipRole: lifecycle.previousRole,
                acceptedAt: now,
                createdAt: now,
                updatedAt: now,
            })
            .returning();
        appointment = createdAppointment ?? null;
        await executor.insert(workspaceNodeEvents).values({
            projectId: invitation.projectId,
            actorId: input.actorId,
            nodeId: null,
            type: "project_guidance.activated",
            metadata: {
                invitationId: invitation.id,
                guideUserId: invitation.candidateId,
                label: invitation.guidanceLabel,
                previousMembershipRole: lifecycle.previousRole,
            },
            createdAt: now,
        });
    }

    await executor.update(workspaceInvitations)
        .set({ status: "accepted", resolvedAt: now, resolvedBy: input.actorId, updatedAt: now })
        .where(eq(workspaceInvitations.id, invitation.id));

    return { invitation, lifecycle, appointment };
}

export function projectInvitationDisplayRole(invitation: typeof workspaceInvitations.$inferSelect) {
    return invitation.kind === "guidance_appointment"
        ? invitation.guidanceLabel || "Mentor"
        : invitation.roleTitle || "Member";
}


/** Pending, unexpired invitations addressed to a user (the canonical record; used by inbox badges). */
export async function countPendingInvitationsForCandidate(userId: string): Promise<number> {
    const [row] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(workspaceInvitations)
        .innerJoin(workspaces, eq(workspaces.id, workspaceInvitations.projectId))
        .where(and(
            eq(workspaceInvitations.candidateId, userId),
            eq(workspaceInvitations.status, "pending"),
            sql`${workspaceInvitations.expiresAt} > now()`,
            sql`${workspaces.deletedAt} IS NULL`,
        ));
    return Number(row?.value ?? 0);
}
