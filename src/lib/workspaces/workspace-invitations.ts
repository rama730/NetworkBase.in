import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
    projectGuidanceAppointments,
    projectInvitations,
    projectNodeEvents,
    projectOpenRoles,
    projects,
} from "@/lib/db/schema";
import { resolvePrivacyRelationship } from "@/lib/privacy/resolver";
import { getGuidanceCapacityState } from "@/lib/workspaces/guidance-capacity";
import {
    addProjectMemberInternal,
    type ProjectCollaboratorExecutor,
} from "@/lib/workspaces/collaborator-lifecycle";

const INVITATION_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export type ProjectInvitationKind = "ordinary_role" | "guidance_appointment";

export type CreateProjectInvitationInput = {
    actorId: string;
    candidateId: string;
    projectId: string;
    kind: ProjectInvitationKind;
    roleId?: string | null;
    note?: string | null;
    guidanceLabel?: string | null;
    reviewAt?: Date | null;
    idempotencyKey?: string | null;
};

type InvitationExecutor = ProjectCollaboratorExecutor;

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
        FROM ${projects}
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
        .from(projectGuidanceAppointments)
        .where(and(
            eq(projectGuidanceAppointments.guideUserId, guideUserId),
            eq(projectGuidanceAppointments.status, "active"),
        ));
    return row?.count ?? 0;
}

export async function createProjectInvitation(input: CreateProjectInvitationInput) {
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
                    id: projectInvitations.id,
                    inviterId: projectInvitations.inviterId,
                    idempotencyKey: projectInvitations.idempotencyKey,
                    candidateId: projectInvitations.candidateId,
                    projectId: projectInvitations.projectId,
                    roleId: projectInvitations.roleId,
                    roleTitle: projectInvitations.roleTitle,
                    projectTitle: projectInvitations.projectTitle,
                    kind: projectInvitations.kind,
                    guidanceLabel: projectInvitations.guidanceLabel,
                    status: projectInvitations.status,
                    expiresAt: projectInvitations.expiresAt,
                    reviewAt: projectInvitations.reviewAt,
                    note: projectInvitations.note,
                    createdAt: projectInvitations.createdAt,
                    updatedAt: projectInvitations.updatedAt,
                })
                .from(projectInvitations)
                .where(and(
                    eq(projectInvitations.inviterId, input.actorId),
                    eq(projectInvitations.idempotencyKey, idempotencyKey),
                ))
                .limit(1);
            if (existing) return { invitation: existing as unknown as typeof projectInvitations.$inferSelect, created: false, projectSlug: null };
        }

        const project = await lockProject(tx, input.projectId);
        if (!project || project.status === "archived") throw new Error("Workspace is unavailable");

        await tx.update(projectInvitations)
            .set({ status: "expired", resolvedAt: now, updatedAt: now })
            .where(and(
                eq(projectInvitations.projectId, input.projectId),
                eq(projectInvitations.status, "pending"),
                // Keep this comparison in PostgreSQL. Raw SQL interpolation does not
                // encode JavaScript Date values for the postgres driver, which would
                // otherwise prevent every new invitation from being created.
                sql`${projectInvitations.expiresAt} <= now()`,
            ));

        const preflightRows = (await tx.execute(sql`
            SELECT 
                pm_actor.role AS actor_role,
                EXISTS(SELECT 1 FROM profiles WHERE id = ${input.candidateId}::uuid) AS candidate_exists,
                EXISTS(SELECT 1 FROM project_members WHERE project_id = ${input.projectId}::uuid AND user_id = ${input.candidateId}::uuid) AS candidate_is_member,
                EXISTS(SELECT 1 FROM role_applications WHERE project_id = ${input.projectId}::uuid AND applicant_id = ${input.candidateId}::uuid AND status = 'pending') AS has_pending_app
            FROM (SELECT 1) _
            LEFT JOIN project_members pm_actor ON pm_actor.project_id = ${input.projectId}::uuid AND pm_actor.user_id = ${input.actorId}::uuid
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
                .select({ id: projectOpenRoles.id, title: projectOpenRoles.title, role: projectOpenRoles.role, filled: projectOpenRoles.filled, count: projectOpenRoles.count })
                .from(projectOpenRoles)
                .where(and(eq(projectOpenRoles.id, input.roleId), eq(projectOpenRoles.projectId, input.projectId)))
                .limit(1);
            if (!role || (role.filled ?? 0) >= (role.count ?? 0)) throw new Error("This workspace role is no longer available");
            roleId = role.id;
            roleTitle = cleanOptionalText(role.title || role.role || "Member", 160) || "Member";

            const [pending] = await tx
                .select({ id: projectInvitations.id })
                .from(projectInvitations)
                .where(and(
                    eq(projectInvitations.projectId, input.projectId),
                    eq(projectInvitations.candidateId, input.candidateId),
                    eq(projectInvitations.kind, "ordinary_role"),
                    eq(projectInvitations.status, "pending"),
                ))
                .limit(1);
            if (pending) throw new Error("An invitation for this workspace is already pending");
        } else {
            guidanceLabel = cleanGuidanceLabel(input.guidanceLabel);
            if (!guidanceLabel) throw new Error("Enter a mentor focus");

            const [pending] = await tx
                .select({ id: projectInvitations.id })
                .from(projectInvitations)
                .where(and(
                    eq(projectInvitations.projectId, input.projectId),
                    eq(projectInvitations.kind, "guidance_appointment"),
                    eq(projectInvitations.status, "pending"),
                ))
                .limit(1);
            const [active] = await tx
                .select({ id: projectGuidanceAppointments.id })
                .from(projectGuidanceAppointments)
                .where(and(
                    eq(projectGuidanceAppointments.projectId, input.projectId),
                    eq(projectGuidanceAppointments.status, "active"),
                ))
                .limit(1);
            if (pending || active) throw new Error("This workspace already has a pending or active guidance appointment");

            const count = await activeGuidanceCount(tx, input.candidateId);
            if (getGuidanceCapacityState(count) === "blocked") throw new Error("This person has reached the active guidance appointment limit");
        }

        const [invitation] = await tx
            .insert(projectInvitations)
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

export async function resolveProjectInvitationInternal(
    executor: InvitationExecutor,
    input: { invitationId: string; actorId: string; action: "accept" | "decline" | "cancel" },
) {
    const [target] = await executor
        .select({ id: projectInvitations.id, projectId: projectInvitations.projectId })
        .from(projectInvitations)
        .where(eq(projectInvitations.id, input.invitationId))
        .limit(1);
    if (!target) throw new Error("Invitation not found");

    const project = await lockProject(executor, target.projectId);
    if (!project) throw new Error("Workspace is unavailable");
    if (project.status === "archived" && input.action !== "cancel") throw new Error("Workspace is unavailable");

    const [invitation] = await executor
        .select()
        .from(projectInvitations)
        .where(eq(projectInvitations.id, input.invitationId))
        .for("update")
        .limit(1);
    if (!invitation) throw new Error("Invitation not found");
    if (invitation.status !== "pending") throw new Error("This invitation has already been resolved");

    const now = new Date();
    if (invitation.expiresAt <= now) {
        await executor.update(projectInvitations)
            .set({ status: "expired", resolvedAt: now, updatedAt: now })
            .where(eq(projectInvitations.id, invitation.id));
        throw new Error("This invitation has expired");
    }

    const isCandidate = invitation.candidateId === input.actorId;
    const isLead = project.owner_id === input.actorId;
    if (input.action === "cancel") {
        if (!isLead && invitation.inviterId !== input.actorId) throw new Error("Only the person who invited them or the owner can cancel this invitation");
        await executor.update(projectInvitations)
            .set({ status: "cancelled", resolvedAt: now, resolvedBy: input.actorId, updatedAt: now })
            .where(eq(projectInvitations.id, invitation.id));
        return { invitation, lifecycle: null, appointment: null };
    }
    if (!isCandidate) throw new Error("Only the invited person can resolve this invitation");
    if (input.action === "decline") {
        await executor.update(projectInvitations)
            .set({ status: "declined", resolvedAt: now, resolvedBy: input.actorId, updatedAt: now })
            .where(eq(projectInvitations.id, invitation.id));
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

    let appointment: typeof projectGuidanceAppointments.$inferSelect | null = null;
    if (invitation.kind === "guidance_appointment") {
        const [active] = await executor
            .select({ id: projectGuidanceAppointments.id })
            .from(projectGuidanceAppointments)
            .where(and(
                eq(projectGuidanceAppointments.projectId, invitation.projectId),
                eq(projectGuidanceAppointments.status, "active"),
            ))
            .limit(1);
        if (active) throw new Error("This workspace already has an active guidance appointment");
        await lockGuidanceCapacity(executor, invitation.candidateId);
        const count = await activeGuidanceCount(executor, invitation.candidateId);
        if (getGuidanceCapacityState(count) === "blocked") throw new Error("This person has reached the active guidance appointment limit");
    }

    const lifecycle = await addProjectMemberInternal(executor, {
        projectId: invitation.projectId,
        userId: invitation.candidateId,
        role: invitation.kind === "guidance_appointment" ? "admin" : "member",
        actorId: input.actorId,
        source: "project_invite",
        roleId: invitation.kind === "ordinary_role" ? invitation.roleId : null,
        incrementRoleCapacity: invitation.kind === "ordinary_role" && Boolean(invitation.roleId),
    });

    if (invitation.kind === "guidance_appointment") {
        const [createdAppointment] = await executor
            .insert(projectGuidanceAppointments)
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
        await executor.insert(projectNodeEvents).values({
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

    await executor.update(projectInvitations)
        .set({ status: "accepted", resolvedAt: now, resolvedBy: input.actorId, updatedAt: now })
        .where(eq(projectInvitations.id, invitation.id));

    return { invitation, lifecycle, appointment };
}

export function projectInvitationDisplayRole(invitation: typeof projectInvitations.$inferSelect) {
    return invitation.kind === "guidance_appointment"
        ? invitation.guidanceLabel || "Mentor"
        : invitation.roleTitle || "Member";
}


/** Pending, unexpired invitations addressed to a user (the canonical record; used by inbox badges). */
export async function countPendingInvitationsForCandidate(userId: string): Promise<number> {
    const [row] = await db
        .select({ value: sql<number>`count(*)::int` })
        .from(projectInvitations)
        .innerJoin(projects, eq(projects.id, projectInvitations.projectId))
        .where(and(
            eq(projectInvitations.candidateId, userId),
            eq(projectInvitations.status, "pending"),
            sql`${projectInvitations.expiresAt} > now()`,
            sql`${projects.deletedAt} IS NULL`,
        ));
    return Number(row?.value ?? 0);
}
