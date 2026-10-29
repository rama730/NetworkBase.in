"use server";

import { and, asc, eq, ilike, inArray, isNull, ne, notExists, or, sql } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db } from "@/lib/db";
import {
    connections,
    profiles,
    projectGuidanceAppointments,
    projectInvitations,
    projectMembers,
    projects,
    roleApplications,
} from "@/lib/db/schema";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { createNotification } from "@/lib/notifications/service";
import { resolvePrivacyRelationships } from "@/lib/privacy/resolver";
import { getGuidanceCapacityState } from "@/lib/projects/guidance-capacity";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
    createProjectInvitation,
    projectInvitationDisplayRole,
    resolveProjectInvitationInternal,
    type ProjectInvitationKind,
} from "@/lib/projects/project-invitations";
import { postInviteCard } from "@/lib/messaging/integrations";
import { conversationHref } from "@/lib/messaging/routes";

type CreateInvitationActionInput = {
    projectId: string;
    candidateId: string;
    kind: ProjectInvitationKind;
    roleId?: string | null;
    note?: string | null;
    guidanceLabel?: string | null;
    reviewAt?: string | null;
    idempotencyKey?: string | null;
};

function parseReviewAt(value: string | null | undefined) {
    if (!value?.trim()) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

export async function createProjectInvitationAction(input: CreateInvitationActionInput) {
    const user = await getAuthUser();
    if (!user) return { success: false as const, error: "Sign in to continue" };
    const reviewAt = parseReviewAt(input.reviewAt);
    if (input.reviewAt?.trim() && !reviewAt) return { success: false as const, error: "Invalid review date" };

    try {
        const created = await createProjectInvitation({
            actorId: user.id,
            candidateId: input.candidateId,
            projectId: input.projectId,
            kind: input.kind,
            roleId: input.roleId ?? null,
            note: input.note ?? null,
            guidanceLabel: input.guidanceLabel ?? null,
            reviewAt,
            idempotencyKey: input.idempotencyKey ?? null,
        });
        const invitation = created.invitation;
        const roleTitle = projectInvitationDisplayRole(invitation);

        // The invite card goes into the inviter↔candidate DM. A blocked pair
        // has no DM; the invitation stays in the inbox either way.
        const chatChannelId = created.created
            ? await postInviteCard({
                invitationId: invitation.id,
                inviterId: user.id,
                candidateId: input.candidateId,
                note: invitation.note,
            }).catch(() => null)
            : null;

        if (created.created) {
            // The invitation inbox item is durable whether a direct message is allowed or not.
            await createNotification({
                recipientUserId: input.candidateId,
                actorUserId: user.id,
                kind: "chat_invite",
                category: "workflows",
                importance: "important",
                title: `${user.user_metadata?.full_name || user.user_metadata?.username || "The owner"} invited you to ${invitation.projectTitle}`,
                body: `Role: ${roleTitle}`,
                href: chatChannelId ? conversationHref(chatChannelId) : "/messages",
                entityRefs: {
                    projectId: invitation.projectId,
                    projectSlug: created.projectSlug,
                    invitationId: invitation.id,
                    targetUserId: input.candidateId,
                },
                preview: {
                    contextLabel: invitation.projectTitle,
                    contextKind: "workflow",
                    secondaryText: invitation.kind === "guidance_appointment" ? "Mentor invitation" : "Project invitation",
                },
                dedupeKey: `project-invitation:${invitation.id}:created`,
            });
        }

        return {
            success: true as const,
            invitationId: invitation.id,
            messageDelivered: Boolean(chatChannelId),
            capacityWarning: Boolean(created.capacityWarning),
        };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t create invitation" };
    }
}

/** Small, Lead-only preview for the shared recruitment composer. Final checks stay in createProjectInvitation. */
export async function getProjectGuidancePreflightAction(input: { projectId: string; candidateId: string }) {
    const user = await getAuthUser();
    if (!user) return { success: false as const, error: "Sign in to continue" };
    const [project] = await db
        .select({ ownerId: projects.ownerId })
        .from(projects)
        .where(and(eq(projects.id, input.projectId), isNull(projects.deletedAt)))
        .limit(1);
    if (!project || project.ownerId !== user.id) return { success: false as const, error: "Only the owner can invite a mentor" };

    const [[active], [capacity]] = await Promise.all([
        db.select({
            label: projectGuidanceAppointments.label,
            fullName: profiles.fullName,
            username: profiles.username,
        })
            .from(projectGuidanceAppointments)
            .innerJoin(profiles, eq(profiles.id, projectGuidanceAppointments.guideUserId))
            .where(and(
                eq(projectGuidanceAppointments.projectId, input.projectId),
                eq(projectGuidanceAppointments.status, "active"),
            ))
            .limit(1),
        db.select({ count: sql<number>`count(*)::int` })
            .from(projectGuidanceAppointments)
            .where(and(
                eq(projectGuidanceAppointments.guideUserId, input.candidateId),
                eq(projectGuidanceAppointments.status, "active"),
            )),
    ]);
    return {
        success: true as const,
        activeGuide: active ? {
            label: active.label,
            name: active.fullName || active.username || "A member",
        } : null,
        capacity: getGuidanceCapacityState(capacity?.count ?? 0),
    };
}

export async function resolveProjectInvitationAction(input: {
    invitationId: string;
    action: "accept" | "decline" | "cancel";
}) {
    const user = await getAuthUser();
    if (!user) return { success: false as const, error: "Sign in to continue" };
    const { allowed } = await consumeRateLimit(`project-invitation-resolve:${user.id}`, 60, 60);
    if (!allowed) return { success: false as const, error: "Too many requests. Try again later." };
    try {
        const result = await db.transaction((tx) => resolveProjectInvitationInternal(tx, {
            invitationId: input.invitationId,
            actorId: user.id,
            action: input.action,
        }));
        const project = result.lifecycle?.project;
        if (project) revalidatePath(`/projects/${project.slug || project.id}`);
        return { success: true as const, projectId: result.invitation.projectId };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t resolve invitation" };
    }
}

export async function getMyPendingProjectInvitationsAction() {
    const user = await getAuthUser();
    if (!user) return { success: false as const, error: "Sign in to continue", invitations: [] };
    const now = new Date();
    await db.update(projectInvitations)
        .set({ status: "expired", resolvedAt: now, updatedAt: now })
        .where(and(
            eq(projectInvitations.candidateId, user.id),
            eq(projectInvitations.status, "pending"),
            // PostgreSQL evaluates this against the durable timestamp; no client clock is trusted.
            // ponytail: expire on inbox read and acceptance. ceiling: expired invitations stay until someone reads them. upgrade: a scheduled sweep when stale invitations show up in metrics.
            sql`${projectInvitations.expiresAt} <= now()`,
        ));
    const invitations = await db
        .select({
            id: projectInvitations.id,
            projectTitle: projectInvitations.projectTitle,
            kind: projectInvitations.kind,
            roleTitle: projectInvitations.roleTitle,
            guidanceLabel: projectInvitations.guidanceLabel,
            note: projectInvitations.note,
            reviewAt: projectInvitations.reviewAt,
            expiresAt: projectInvitations.expiresAt,
            inviterName: profiles.fullName,
            inviterUsername: profiles.username,
        })
        .from(projectInvitations)
        .innerJoin(profiles, eq(profiles.id, projectInvitations.inviterId))
        .where(and(
            eq(projectInvitations.candidateId, user.id),
            eq(projectInvitations.status, "pending"),
            sql`${projectInvitations.expiresAt} > now()`,
        ))
        .orderBy(asc(projectInvitations.expiresAt));
    return { success: true as const, invitations };
}

export async function searchProjectInviteCandidatesAction(input: { projectId: string; query?: string | null }) {
    const user = await getAuthUser();
    if (!user) return { success: false as const, error: "Sign in to continue", items: [] };
    const query = input.query?.trim().replace(/^@/, "") ?? "";
    if (query && query.length < 2) return { success: true as const, items: [] };
    const rate = await consumeRateLimit(`project-invite-search:${user.id}`, 60, 60);
    if (!rate.allowed) return { success: false as const, error: "Wait before searching again", items: [] };

    const [project] = await db
        .select({ ownerId: projects.ownerId })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);
    if (!project) return { success: false as const, error: "Project not found", items: [] };
    if (project.ownerId !== user.id) {
        const [membership] = await db
            .select({ role: projectMembers.role })
            .from(projectMembers)
            .where(and(eq(projectMembers.projectId, input.projectId), eq(projectMembers.userId, user.id)))
            .limit(1);
        if (membership?.role !== "admin") return { success: false as const, error: "You don’t have access to this", items: [] };
    }

    const pattern = `%${query.replace(/[%_\\]/g, "\\$&")}%`;
    // Let the existing project-member index exclude members; never copy an entire team into application memory for a 20-row search.
    const isNotProjectMember = notExists(db
        .select({ id: projectMembers.id })
        .from(projectMembers)
        .where(and(
            eq(projectMembers.projectId, input.projectId),
            eq(projectMembers.userId, profiles.id),
        )));
    const candidateRows = query
        ? await db
            .select({ id: profiles.id, username: profiles.username, fullName: profiles.fullName, avatarUrl: profiles.avatarUrl, headline: profiles.headline })
            .from(profiles)
            .where(and(
                ne(profiles.id, user.id),
                ne(profiles.id, project.ownerId),
                eq(profiles.onboardingStatus, "completed"),
                eq(profiles.visibility, "public"),
                isNotProjectMember,
                or(ilike(profiles.username, pattern), ilike(profiles.fullName, pattern)),
            ))
            .orderBy(
                sql`CASE
                    WHEN lower(coalesce(${profiles.username}, '')) = lower(${query}) THEN 0
                    WHEN lower(coalesce(${profiles.username}, '')) LIKE lower(${`${query}%`}) THEN 1
                    WHEN lower(coalesce(${profiles.fullName}, '')) LIKE lower(${`${query}%`}) THEN 2
                    ELSE 3
                END`,
                asc(profiles.fullName),
                asc(profiles.id),
            )
            .limit(20)
        : await db
            .select({ id: profiles.id, username: profiles.username, fullName: profiles.fullName, avatarUrl: profiles.avatarUrl, headline: profiles.headline })
            .from(connections)
            .innerJoin(profiles, or(
                and(eq(connections.requesterId, user.id), eq(connections.addresseeId, profiles.id)),
                and(eq(connections.addresseeId, user.id), eq(connections.requesterId, profiles.id)),
            ))
            .where(and(
                eq(connections.status, "accepted"),
                ne(profiles.id, user.id),
                ne(profiles.id, project.ownerId),
                eq(profiles.onboardingStatus, "completed"),
                isNotProjectMember,
            ))
            .orderBy(asc(profiles.fullName), asc(profiles.id))
            .limit(20);

    const relationships = await resolvePrivacyRelationships(user.id, candidateRows.map((row) => row.id));
    const candidateIds = candidateRows
        .filter((row) => {
            const relationship = relationships.get(row.id);
            return Boolean(relationship?.canViewProfile && !relationship.shouldHideFromDiscovery);
        })
        .map((row) => row.id);
    if (!candidateIds.length) return { success: true as const, items: [] };
    const [pendingInvites, pendingApplications] = await Promise.all([
        db.select({ candidateId: projectInvitations.candidateId, kind: projectInvitations.kind })
            .from(projectInvitations)
            .where(and(
                eq(projectInvitations.projectId, input.projectId),
                eq(projectInvitations.status, "pending"),
                inArray(projectInvitations.candidateId, candidateIds),
            )),
        db.select({ applicantId: roleApplications.applicantId })
            .from(roleApplications)
            .where(and(
                eq(roleApplications.projectId, input.projectId),
                eq(roleApplications.status, "pending"),
                inArray(roleApplications.applicantId, candidateIds),
            )),
    ]);
    const inviteByCandidate = new Map(pendingInvites.map((row) => [row.candidateId, row.kind]));
    const applicationIds = new Set(pendingApplications.map((row) => row.applicantId));
    return {
        success: true as const,
        items: candidateRows
            .filter((row) => candidateIds.includes(row.id))
            .map((row) => ({
                ...row,
                state: inviteByCandidate.has(row.id)
                    ? "invitation_pending"
                    : applicationIds.has(row.id)
                        ? "application_pending"
                        : "eligible",
            })),
    };
}
