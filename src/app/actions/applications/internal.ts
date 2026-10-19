'use server';

import { readPersonCardDetails } from '@/lib/network/person-card-read';
import type { PersonCardDetails } from '@/lib/network/person-card';
import { logger } from '@/lib/logger';
import { ensureApplicationChannel, postApplicationUpdate } from '@/lib/messaging/integrations';
import { db } from '@/lib/db';
import {
    roleApplications,
    projectOpenRoles,
    projects,
    projectMembers,
    connections,
    chatChannels,
    chatChannelMembers,
    profiles,
    projectInvitations,
    applicationEvents,
} from '@/lib/db/schema';
import { eq, and, sql, or, inArray, desc, lt, exists, isNull, ne, notExists, asc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { resolveProjectInvitationAction } from '@/app/actions/project/guidance';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { runInFlightDeduped } from '@/lib/utils/inflight-dedupe';
import { toIsoString as toISODate } from '@/lib/utils/date';
import {
    APPLICATION_DECISION_REASON_TEMPLATES,
    normalizeApplicationDecisionReason,
    type ApplicationDecisionReasonCode,
} from '@/lib/applications/reasons';
import {
    calculateCooldown,
    normalizeApplicationMessageText,
    resolveLifecycleStatus,
} from '@/lib/applications/utils';
import type { ApplicationCoreStatus } from '@/lib/applications/status';
import { isApplicationReviewerRole } from '@/lib/applications/authorization';
import { enqueueProjectNotificationEvent } from '@/lib/notifications/project-events';
import type {
    ApplicationActionOptions,
    ApplicationActionResult,
    ApplicationCursorPaginationInput,
    ApplicationRequestHistoryItem,
    ApplicationStatusResult,
    ApplicationActionErrorCode,
} from './types';
import { refreshWorkspaceCountersForUsers } from '@/lib/workspace/profile-counters';
import { addProjectMemberInternal } from '@/lib/projects/collaborator-lifecycle';
import { computeProjectReadAccess } from '@/lib/data/project-access';
import { isUuid } from '@/lib/validations/uuid';
import { conversationHref } from '@/lib/messaging/routes';

// ============================================================================
// TYPES
// ============================================================================
type ApplicationDecisionStatus = 'accepted' | 'rejected' | 'withdrawn' | 'proposed';

// ============================================================================
// COOLDOWN HELPER (24 hours)
// ============================================================================
const APPLICATION_EDIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const APPLICATION_REOPEN_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const APPLICATION_PENDING_CAP_PER_USER = 20;
const APPLICATION_APPLY_COOLDOWN_PER_PROJECT_SECONDS = 60;
const APPLICATION_APPLY_COOLDOWN_GLOBAL_SECONDS = 8;
const APPLICATION_LIST_DEFAULT_LIMIT = 20;
const APPLICATION_LIST_MAX_LIMIT = 100;
const APPLICATION_LIST_MAX_OFFSET = 100_000;


function normalizeApplicationListPagination(limit: unknown, offset: unknown) {
    const rawLimit = typeof limit === 'number' ? limit : Number(limit);
    const normalizedLimit = Number.isFinite(rawLimit)
        ? Math.trunc(rawLimit)
        : APPLICATION_LIST_DEFAULT_LIMIT;
    const safeLimit = Math.min(Math.max(normalizedLimit, 1), APPLICATION_LIST_MAX_LIMIT);

    const rawOffset = typeof offset === 'number' ? offset : Number(offset);
    const normalizedOffset = Number.isFinite(rawOffset)
        ? Math.trunc(rawOffset)
        : 0;
    const safeOffset = Math.min(Math.max(normalizedOffset, 0), APPLICATION_LIST_MAX_OFFSET);

    return { safeLimit, safeOffset };
}

function normalizeCursorPaginationInput(
    input?: ApplicationCursorPaginationInput
): { safeLimit: number; cursor: { createdAt: Date; id: string } | null } {
    const rawLimit = typeof input?.limit === 'number' ? input.limit : Number(input?.limit);
    const normalizedLimit = Number.isFinite(rawLimit)
        ? Math.trunc(rawLimit)
        : APPLICATION_LIST_DEFAULT_LIMIT;
    const safeLimit = Math.min(Math.max(normalizedLimit, 1), APPLICATION_LIST_MAX_LIMIT);

    const rawCursor = typeof input?.cursor === 'string' ? input.cursor.trim() : '';
    if (!rawCursor) {
        return { safeLimit, cursor: null };
    }

    try {
        const decoded = Buffer.from(rawCursor, 'base64').toString('utf8');
        const [iso, id] = decoded.split(':::');
        if (!iso || !id) {
            return { safeLimit, cursor: null };
        }
        const createdAt = new Date(iso);
        if (Number.isNaN(createdAt.getTime())) {
            return { safeLimit, cursor: null };
        }
        return { safeLimit, cursor: { createdAt, id } };
    } catch {
        return { safeLimit, cursor: null };
    }
}

interface CompoundCursor {
    source: 'app' | 'invite';
    createdAt: Date;
    id: string;
}

function parseCompoundCursor(rawCursor?: string | null): CompoundCursor | null {
    if (!rawCursor) return null;
    try {
        const decoded = Buffer.from(rawCursor, 'base64').toString('utf8');
        const [source, iso, id] = decoded.split(':::');
        if ((source !== 'app' && source !== 'invite') || !iso || !id) {
            return null;
        }
        const createdAt = new Date(iso);
        if (Number.isNaN(createdAt.getTime())) {
            return null;
        }
        return { source: source as 'app' | 'invite', createdAt, id };
    } catch {
        return null;
    }
}

function encodeCompoundCursor(source: 'app' | 'invite', createdAt: Date, id: string): string {
    return Buffer.from(`${source}:::${createdAt.toISOString()}:::${id}`, 'utf8').toString('base64');
}

function resolveApplicationTraceId(
    action: string,
    userId: string,
    targetId: string,
    options?: ApplicationActionOptions
): string {
    const supplied = options?.applicationTraceId?.trim();
    if (supplied) return supplied;
    const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    return `app_${action}_${userId.slice(0, 8)}_${targetId.slice(0, 8)}_${suffix}`;
}

function normalizeDecisionReasonCode(reason: unknown): ApplicationDecisionReasonCode {
    return normalizeApplicationDecisionReason(reason, 'other');
}

function toApplicationFailure(
    traceId: string,
    errorCode: ApplicationActionErrorCode,
    message: string
): ApplicationActionResult {
    return {
        success: false,
        error: message,
        errorCode,
        applicationTraceId: traceId,
    };
}

function toApplicationSuccess(
    traceId: string,
    payload?: Partial<ApplicationActionResult>
): ApplicationActionResult {
    return {
        success: true,
        applicationTraceId: traceId,
        ...payload,
    };
}


function buildApplicationMessageContent(projectTitle: string, roleTitle: string, normalizedMessage: string) {
    return `${projectTitle} / ${roleTitle}\n\n${normalizedMessage}`.trim();
}

function buildApplicationClientMessageId(applicationId: string) {
    return `application:${applicationId}`;
}

function buildApplicationDecisionClientMessageId(applicationId: string, status: ApplicationDecisionStatus) {
    return `application:decision:${applicationId}:${status}`;
}

function buildApplicationReopenClientMessageId(applicationId: string) {
    return `application:decision:${applicationId}:reopened`;
}

function appendTimelineEvent(
    metadata: Record<string, unknown> | null | undefined,
    event: Record<string, unknown>
) {
    const prev = metadata && typeof metadata === 'object' ? metadata : {};
    const timeline = Array.isArray((prev as any).timeline)
        ? ([...(prev as any).timeline] as Record<string, unknown>[])
        : [];
    timeline.push(event);
    return { ...prev, timeline };
}

function resolveDecisionMessage(
    status: ApplicationDecisionStatus,
    customMessage?: string,
    reason?: string
) {
    const trimmedCustom = (customMessage || '').trim();
    if (trimmedCustom) return trimmedCustom;
    if (status === 'accepted') {
        return 'Welcome to the project.';
    }
    if (status === 'withdrawn') {
        return 'Application withdrawn by applicant';
    }
    if (status === 'proposed') {
        return 'Role change proposed by project lead';
    }
    const reasonKey = normalizeDecisionReasonCode(reason);
    return APPLICATION_DECISION_REASON_TEMPLATES[reasonKey];
}

function applicationActorSnapshot(user: { user_metadata?: Record<string, unknown> | null }) {
    return {
        actorName: (user.user_metadata?.full_name as string | undefined) ?? (user.user_metadata?.username as string | undefined) ?? null,
        actorAvatarUrl: (user.user_metadata?.avatar_url as string | undefined) ?? null,
    };
}

async function enqueueApplicationReceivedBestEffort(params: {
    applicationId: string;
    channelId?: string | null;
    projectId: string;
    projectSlug?: string | null;
    projectTitle?: string | null;
    roleId?: string | null;
    roleTitle?: string | null;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    traceId: string;
}) {
    try {
        await enqueueProjectNotificationEvent({
            projectId: params.projectId,
            actorUserId: params.actorUserId,
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl ?? null,
            eventKey: "applications.received",
            title: `${params.actorName || "Someone"} applied to ${params.projectTitle || "your project"}`,
            body: params.roleTitle ? `Role: ${params.roleTitle}` : params.projectTitle ? `Project: ${params.projectTitle}` : "New application received",
            href: `/network?tab=requests&applicationId=${encodeURIComponent(params.applicationId)}`,
            entityRefs: {
                applicationId: params.applicationId,
                channelId: params.channelId ?? null,
                projectId: params.projectId,
                projectSlug: params.projectSlug ?? null,
                roleId: params.roleId ?? null,
            },
            preview: {
                actorName: params.actorName,
                actorAvatarUrl: params.actorAvatarUrl ?? null,
                contextLabel: params.projectTitle ?? "Application",
                contextKind: "application",
                secondaryText: params.roleTitle ?? "Application received",
            },
            sourceEventId: params.applicationId,
        });
    } catch (notificationError) {
        console.error('[applications] Failed to enqueue application received notification', {
            applicationId: params.applicationId,
            actorUserId: params.actorUserId,
            projectId: params.projectId,
            projectSlug: params.projectSlug ?? null,
            projectTitle: params.projectTitle ?? null,
            traceId: params.traceId,
            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
        });
    }
}

async function enqueueApplicationDecisionBestEffort(params: {
    applicationId: string;
    status: "accepted" | "rejected" | "reopened";
    channelId?: string | null;
    projectId: string;
    projectSlug?: string | null;
    projectTitle?: string | null;
    roleId?: string | null;
    applicantId: string;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    traceId: string;
}) {
    try {
        await enqueueProjectNotificationEvent({
            projectId: params.projectId,
            actorUserId: params.actorUserId,
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl ?? null,
            eventKey: "applications.decision",
            applicantId: params.applicantId,
            title: `${params.actorName || "Someone"} ${params.status === "accepted" ? "accepted" : params.status === "rejected" ? "updated" : "reopened"} your application`,
            body: params.projectTitle ? `Project: ${params.projectTitle}` : null,
            href: params.channelId
                ? conversationHref(params.channelId)
                : `/network?tab=requests&applicationId=${encodeURIComponent(params.applicationId)}`,
            entityRefs: {
                applicationId: params.applicationId,
                channelId: params.channelId ?? null,
                projectId: params.projectId,
                projectSlug: params.projectSlug ?? null,
                roleId: params.roleId ?? null,
            },
            preview: {
                actorName: params.actorName,
                actorAvatarUrl: params.actorAvatarUrl ?? null,
                contextLabel: params.projectTitle ?? "Application",
                contextKind: "application",
                secondaryText: params.status,
            },
            sourceEventId: `${params.applicationId}:${params.status}`,
        });
    } catch (notificationError) {
        console.error('[applications] Failed to enqueue application decision notification', {
            applicationId: params.applicationId,
            status: params.status,
            actorUserId: params.actorUserId,
            recipientUserId: params.applicantId,
            traceId: params.traceId,
            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
        });
    }
}

async function enqueueApplicationWithdrawnBestEffort(params: {
    applicationId: string;
    projectId: string;
    projectSlug?: string | null;
    projectTitle?: string | null;
    roleId?: string | null;
    roleTitle?: string | null;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    traceId: string;
}) {
    try {
        await enqueueProjectNotificationEvent({
            projectId: params.projectId,
            actorUserId: params.actorUserId,
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl ?? null,
            eventKey: "applications.withdrawn",
            title: `${params.actorName || "Someone"} withdrew an application`,
            body: params.roleTitle ? `Role: ${params.roleTitle}` : params.projectTitle ? `Project: ${params.projectTitle}` : "Application withdrawn",
            href: `/network?tab=requests&applicationId=${encodeURIComponent(params.applicationId)}`,
            entityRefs: {
                applicationId: params.applicationId,
                projectId: params.projectId,
                projectSlug: params.projectSlug ?? null,
                roleId: params.roleId ?? null,
            },
            preview: {
                actorName: params.actorName,
                actorAvatarUrl: params.actorAvatarUrl ?? null,
                contextLabel: params.projectTitle ?? "Application",
                contextKind: "application",
                secondaryText: "Withdrawn",
            },
            sourceEventId: `${params.applicationId}:withdrawn`,
        });
    } catch (notificationError) {
        console.error('[applications] Failed to enqueue application withdrawn notification', {
            applicationId: params.applicationId,
            actorUserId: params.actorUserId,
            projectId: params.projectId,
            traceId: params.traceId,
            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
        });
    }
}

async function enqueueMemberJoinedBestEffort(params: {
    projectId: string;
    projectSlug?: string | null;
    projectTitle?: string | null;
    applicationId?: string | null;
    roleId?: string | null;
    targetUserId: string;
    targetName: string;
    targetAvatarUrl?: string | null;
    actorUserId: string;
    actorName: string | null;
    actorAvatarUrl?: string | null;
    sourceEventId?: string | null;
    traceId: string;
}) {
    try {
        await enqueueProjectNotificationEvent({
            projectId: params.projectId,
            actorUserId: params.actorUserId,
            actorName: params.actorName,
            actorAvatarUrl: params.actorAvatarUrl ?? null,
            eventKey: "members.joined",
            title: `${params.targetName} joined ${params.projectTitle || "the project"}`,
            body: "A new member joined the project.",
            href: `/projects/${encodeURIComponent(params.projectSlug || params.projectId)}?tab=settings&settings=collaborators`,
            entityRefs: {
                projectId: params.projectId,
                projectSlug: params.projectSlug ?? null,
                applicationId: params.applicationId ?? null,
                roleId: params.roleId ?? null,
                targetUserId: params.targetUserId,
            },
            preview: {
                actorName: params.targetName,
                actorAvatarUrl: params.targetAvatarUrl ?? null,
                contextLabel: params.projectTitle ?? "Project",
                contextKind: "project",
                secondaryText: "New project member",
            },
            sourceEventId: params.sourceEventId ?? `${params.targetUserId}:member-joined`,
        });
    } catch (notificationError) {
        console.error('[applications] Failed to enqueue member joined notification', {
            projectId: params.projectId,
            targetUserId: params.targetUserId,
            actorUserId: params.actorUserId,
            traceId: params.traceId,
            error: notificationError instanceof Error ? notificationError.message : String(notificationError),
        });
    }
}

async function canReviewProjectApplicationInternal(
    txOrDb: typeof db | any,
    projectId: string,
    userId: string,
    ownerId?: string | null
) {
    if (ownerId && ownerId === userId) return true;
    const membership = await txOrDb.query.projectMembers.findFirst({
        where: and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, userId)),
        columns: { role: true },
    });
    return isApplicationReviewerRole(membership?.role);
}

async function getDecisionMetadataMap(applicationIds: string[]) {
    const normalizedIds = Array.from(new Set(applicationIds.filter(Boolean)));
    if (normalizedIds.length === 0) {
        return new Map<string, { reasonCode: string | null; decisionAt: string | null }>();
    }

    const CHUNK_SIZE = 200;
    const map = new Map<string, { reasonCode: string | null; decisionAt: string | null }>();

    for (let i = 0; i < normalizedIds.length; i += CHUNK_SIZE) {
        const chunk = normalizedIds.slice(i, i + CHUNK_SIZE);
        const rows = await db
            .select({
                applicationId: roleApplications.id,
                reasonCode: roleApplications.decisionReasonCode,
                decisionAt: roleApplications.decisionAt,
            })
            .from(roleApplications)
            .where(inArray(roleApplications.id, chunk));

        for (const row of rows) {
            map.set(row.applicationId, {
                reasonCode: row.reasonCode,
                decisionAt: row.decisionAt?.toISOString() ?? null,
            });
        }
    }
    return map;
}

function sortConnectionPair(a: string, b: string): [string, string] {
    return a < b ? [a, b] : [b, a];
}

async function applyConnectionsCountDelta(tx: any, userIds: string[], delta: number) {
    if (userIds.length === 0 || delta === 0) return;
    await tx
        .update(profiles)
        .set({
            connectionsCount: sql`GREATEST(0, ${profiles.connectionsCount} + ${delta})`,
            updatedAt: new Date(),
        })
        .where(inArray(profiles.id, userIds));
}

async function ensureAcceptedConnectionInternal(tx: any, userA: string, userB: string) {
    const [low, high] = sortConnectionPair(userA, userB);
    // PURE OPTIMIZATION (Item 94): Upgrade 32-bit hashtext advisory lock to 64-bit hashtextextended.
    await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
            hashtextextended('connection-pair:' || ${low} || ':' || ${high}, 0)
        )
    `);

    const existing = await tx
        .select({
            id: connections.id,
            status: connections.status,
        })
        .from(connections)
        .where(
            or(
                and(eq(connections.requesterId, userA), eq(connections.addresseeId, userB)),
                and(eq(connections.requesterId, userB), eq(connections.addresseeId, userA))
            )
        )
        .orderBy(desc(connections.updatedAt))
        .limit(1);

    if (existing.length > 0) {
        const row = existing[0];
        if (row.status === 'accepted') return;
        if (row.status === 'blocked') return;

        await tx
            .update(connections)
            .set({ status: 'accepted', updatedAt: new Date() })
            .where(eq(connections.id, row.id));

        await applyConnectionsCountDelta(tx, [userA, userB], 1);
        if (row.status === 'pending') {
            await refreshWorkspaceCountersForUsers(tx, [userA, userB]);
        }
        return;
    }

    await tx.insert(connections).values({
        requesterId: userA,
        addresseeId: userB,
        status: 'accepted',
    });

    await applyConnectionsCountDelta(tx, [userA, userB], 1);
}

// ============================================================================
// INTERNAL HELPER: Send status update message to chat
// ============================================================================
async function transitionApplicationDecisionInternal(
    tx: any,
    params: {
        applicationId: string;
        status: ApplicationDecisionStatus;
        decisionBy: string;
        acceptedRoleTitle?: string | null;
        reasonCode?: string | null;
        reasonText?: string | null;
    }
) {
    const {
        applicationId,
        status,
        decisionBy,
        acceptedRoleTitle,
        reasonCode = null,
        reasonText = null,
    } = params;
    const now = new Date();

    const transitioned = await tx
        .update(roleApplications)
        .set({
            status,
            updatedAt: now,
            decisionAt: now,
            decisionBy,
            decisionReasonCode: reasonCode,
            decisionReasonText: reasonText,
            acceptedRoleTitle: status === 'accepted' ? acceptedRoleTitle || null : null,
        })
        .where(and(eq(roleApplications.id, applicationId), eq(roleApplications.status, 'pending')))
        .returning({ id: roleApplications.id });
    if (transitioned.length > 0) {
        await tx.insert(applicationEvents).values({
            applicationId,
            actorId: decisionBy,
            kind: status,
            fromStatus: 'pending',
            toStatus: status,
            reasonCode,
            reasonText,
        });
    }
    return transitioned.length > 0;
}

async function transitionApplicationToPendingInternal(
    tx: any,
    applicationId: string,
    actorId: string,
    reasonCode: string,
) {
    const [candidate] = await tx
        .select({ applicantId: roleApplications.applicantId })
        .from(roleApplications)
        .where(and(eq(roleApplications.id, applicationId), eq(roleApplications.status, 'rejected')))
        .limit(1);
    // COR-033: already reopened (or decided otherwise) by a concurrent request: a conflict, not a crash.
    if (!candidate) return false;
    // PURE OPTIMIZATION (Item 94): Upgrade 32-bit hashtext to 64-bit hashtextextended advisory lock.
    await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended('application-pending-cap:' || ${candidate.applicantId}, 0))
    `);
    const [pending] = await tx
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(roleApplications)
        .where(and(
            eq(roleApplications.applicantId, candidate.applicantId),
            eq(roleApplications.status, 'pending'),
        ));
    if ((pending?.count ?? 0) >= APPLICATION_PENDING_CAP_PER_USER) return false;

    const now = new Date();
    const transitioned = await tx
        .update(roleApplications)
        .set({
            status: 'pending',
            updatedAt: now,
            decisionAt: null,
            decisionBy: null,
            decisionReasonCode: null,
            decisionReasonText: null,
            acceptedRoleTitle: null,
        })
        .where(and(eq(roleApplications.id, applicationId), eq(roleApplications.status, 'rejected')))
        .returning({ id: roleApplications.id });

    if (transitioned.length > 0) {
        await tx.insert(applicationEvents).values({
            applicationId,
            actorId,
            kind: 'reopened',
            fromStatus: 'rejected',
            toStatus: 'pending',
            reasonCode,
        });
    }
    return transitioned.length > 0;
}

type InvitationRole = 'inviter' | 'candidate';

/** Invitations from the canonical table, newest first, with the other party and project. */
async function listInvitationsInternal(params: {
    userId: string;
    as: InvitationRole;
    pendingOnly?: boolean;
    cursorDate?: Date;
    cursorId?: string;
    limit: number;
}) {
    const other = alias(profiles, 'invitation_other_party');
    const mine = params.as === 'inviter' ? projectInvitations.inviterId : projectInvitations.candidateId;
    const theirs = params.as === 'inviter' ? projectInvitations.candidateId : projectInvitations.inviterId;
    return db
        .select({
            id: projectInvitations.id,
            projectId: projectInvitations.projectId,
            status: projectInvitations.status,
            roleTitle: projectInvitations.roleTitle,
            guidanceLabel: projectInvitations.guidanceLabel,
            note: projectInvitations.note,
            projectTitle: projectInvitations.projectTitle,
            createdAt: projectInvitations.createdAt,
            updatedAt: projectInvitations.updatedAt,
            projectSlug: projects.slug,
            projectCover: projects.coverImage,
            other: {
                id: other.id,
                username: other.username,
                fullName: other.fullName,
                avatarUrl: other.avatarUrl,
                skills: other.skills,
                headline: other.headline,
            },
        })
        .from(projectInvitations)
        .leftJoin(projects, eq(projects.id, projectInvitations.projectId))
        .leftJoin(other, eq(other.id, theirs))
        .where(and(
            eq(mine, params.userId),
            isNull(projects.deletedAt),
            isNull(other.deletedAt),
            params.pendingOnly ? eq(projectInvitations.status, 'pending') : undefined,
            params.cursorDate && params.cursorId
                ? or(
                    lt(projectInvitations.createdAt, params.cursorDate),
                    and(eq(projectInvitations.createdAt, params.cursorDate), lt(projectInvitations.id, params.cursorId)),
                )
                : undefined,
        ))
        .orderBy(desc(projectInvitations.createdAt), desc(projectInvitations.id))
        .limit(params.limit);
}

function invitationLifecycle(status: string): { status: 'pending' | 'accepted' | 'rejected' | 'withdrawn'; decisionReason: string | null } {
    if (status === 'declined') return { status: 'rejected', decisionReason: null };
    if (status === 'cancelled') return { status: 'withdrawn', decisionReason: null };
    if (status === 'expired') return { status: 'rejected', decisionReason: 'role_filled' };
    if (status === 'accepted') return { status: 'accepted', decisionReason: null };
    return { status: 'pending', decisionReason: null };
}

/**
 * The application's private thread. Status changes show on its live card; a
 * reviewer's or applicant's note is posted as a line in the thread.
 */
async function applicationThread(tx: Parameters<typeof ensureApplicationChannel>[0], applicationId: string, actorId: string, note?: string | null) {
    const text = (note || '').trim();
    return text ? postApplicationUpdate(tx, applicationId, actorId, text) : ensureApplicationChannel(tx, applicationId);
}

// ============================================================================
// GET APPLICATION STATUS (for project page)
// ============================================================================
export async function getApplicationStatusAction(projectId: string): Promise<ApplicationStatusResult> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { status: 'none' };
        }

        // This durable record is canonical for regular and guidance invites.
        // Guidance has no open-role ID, so workflow-only lookup hides it from
        // the Open Roles card and fails when direct-message delivery is off.
        const durableInvitation = await db.query.projectInvitations.findFirst({
            where: and(
                eq(projectInvitations.projectId, projectId),
                eq(projectInvitations.candidateId, user.id),
                eq(projectInvitations.status, 'pending'),
                sql`${projectInvitations.expiresAt} > now()`,
            ),
            orderBy: desc(projectInvitations.createdAt),
            columns: {
                id: true,
                kind: true,
                roleId: true,
                roleTitle: true,
                guidanceLabel: true,
                updatedAt: true,
            },
        });

        if (durableInvitation) {
            const invitationTitle = durableInvitation.kind === 'guidance_appointment'
                ? durableInvitation.guidanceLabel || 'Guide'
                : durableInvitation.roleTitle || 'Collaborator';
            return {
                status: 'proposed',
                roleId: durableInvitation.roleId || undefined,
                roleTitle: invitationTitle,
                invitationKind: durableInvitation.kind,
                invitationId: durableInvitation.id,
                proposedRoleId: durableInvitation.roleId || undefined,
                proposedRoleTitle: invitationTitle,
                updatedAt: durableInvitation.updatedAt,
            };
        }

        const application = await db.query.roleApplications.findFirst({
            where: and(
                eq(roleApplications.projectId, projectId),
                eq(roleApplications.applicantId, user.id)
            ),
            with: {
                role: {
                    columns: { role: true, title: true }
                }
            },
            columns: { id: true, status: true, roleId: true, proposedRoleId: true, updatedAt: true, decisionBy: true }
        });

        if (application) {
            if (application.status === 'proposed') {
                const proposedRole = application.proposedRoleId
                    ? await db.query.projectOpenRoles.findFirst({
                        where: eq(projectOpenRoles.id, application.proposedRoleId),
                        columns: { role: true, title: true }
                    })
                    : null;
                const proposedRoleTitle = proposedRole?.title || proposedRole?.role || 'Unknown Role';
                return {
                    status: 'proposed',
                    roleId: application.proposedRoleId || undefined,
                    roleTitle: proposedRoleTitle,
                    applicationId: application.id,
                    proposedRoleId: application.proposedRoleId || undefined,
                    proposedRoleTitle,
                    updatedAt: application.updatedAt,
                };
            }

            const roleTitle = application.role?.title || application.role?.role || 'Unknown Role';
            const decisionMap = await getDecisionMetadataMap([application.id]);
            const decisionReasonRaw = decisionMap.get(application.id)?.reasonCode || null;
            const decisionReason = decisionReasonRaw
                ? normalizeApplicationDecisionReason(decisionReasonRaw, 'other')
                : null;
            const lifecycleStatus = resolveLifecycleStatus(application.status, decisionReason);

            if (application.status === 'rejected') {
                if (application.decisionBy === user.id) {
                    return {
                        status: 'rejected',
                        roleId: application.roleId || undefined,
                        roleTitle,
                        decisionReason,
                        lifecycleStatus,
                        canReapply: true,
                        updatedAt: application.updatedAt,
                    };
                }
                const { canApply, waitTime } = calculateCooldown(application.updatedAt);
                return {
                    status: 'rejected',
                    roleId: application.roleId || undefined,
                    roleTitle,
                    decisionReason,
                    lifecycleStatus,
                    canReapply: canApply,
                    waitTime,
                    updatedAt: application.updatedAt
                };
            }

            const activeMembership = application.status === 'accepted'
                ? await db.query.projectMembers.findFirst({
                    where: and(
                        eq(projectMembers.projectId, projectId),
                        eq(projectMembers.userId, user.id),
                    ),
                    columns: { id: true },
                })
                : null;

            return {
                status: application.status as ApplicationCoreStatus,
                roleId: application.roleId || undefined,
                roleTitle,
                decisionReason,
                lifecycleStatus,
                updatedAt: application.updatedAt,
                membershipEnded: application.status === 'accepted' && !activeMembership,
                applicationId: application.id,
            };
        }

        return { status: 'none' };
    } catch (error) {
        console.error('Failed to get application status:', error);
        return { status: 'none' };
    }
}

// ============================================================================
// APPLY TO ROLE ACTION
// ============================================================================
export async function applyToRoleAction(
    projectId: string,
    roleId: string,
    message: string,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('apply', 'anon', projectId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'You must be logged in to apply');
        }

        const trimmedMessage = normalizeApplicationMessageText(message);
        if (!trimmedMessage) {
            return toApplicationFailure(traceId, 'INVALID_INPUT', 'Please add a short application message');
        }
        const dedupeKey = `applications:apply:${user.id}:${projectId}:${roleId}:${options?.idempotencyKey?.trim() || trimmedMessage.slice(0, 120)}`;
        return await runInFlightDeduped(dedupeKey, async () => {
            const applyRate = await consumeRateLimit(`applications:apply:${user.id}`, 30, APPLICATION_APPLY_COOLDOWN_GLOBAL_SECONDS);
            if (!applyRate.allowed) {
                return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many application attempts. Please wait a moment.');
            }
            const projectApplyRate = await consumeRateLimit(
                `applications:apply:${user.id}:${projectId}`,
                6,
                APPLICATION_APPLY_COOLDOWN_PER_PROJECT_SECONDS
            );
            if (!projectApplyRate.allowed) {
                return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many attempts for this project. Please retry shortly.');
            }

            const [project, role, existingMember, existingApp] = await Promise.all([
                db.query.projects.findFirst({
                    where: eq(projects.id, projectId),
                    columns: { id: true, ownerId: true, slug: true, title: true, visibility: true, status: true }
                }),
                db.query.projectOpenRoles.findFirst({
                    where: and(
                        eq(projectOpenRoles.id, roleId),
                        eq(projectOpenRoles.projectId, projectId)
                    ),
                    columns: { id: true, role: true, title: true, count: true, filled: true }
                }),
                db.query.projectMembers.findFirst({
                    where: and(
                        eq(projectMembers.projectId, projectId),
                        eq(projectMembers.userId, user.id)
                    ),
                    columns: { id: true }
                }),
                db.query.roleApplications.findFirst({
                    where: and(
                        eq(roleApplications.projectId, projectId),
                        eq(roleApplications.applicantId, user.id)
                    ),
                    columns: { id: true, status: true, updatedAt: true, decisionBy: true }
                })
            ]);

            if (!project) {
                return toApplicationFailure(traceId, 'PROJECT_NOT_FOUND', 'Project not found');
            }
            if (project.ownerId === user.id) {
                return toApplicationFailure(traceId, 'FORBIDDEN', 'You cannot apply to your own project');
            }
            if (!role) {
                return toApplicationFailure(traceId, 'ROLE_NOT_FOUND', 'Role not found');
            }
            if (role.filled >= role.count) {
                return toApplicationFailure(traceId, 'ROLE_FULL', 'This role has no available spots');
            }
            if (existingMember) {
                return toApplicationFailure(traceId, 'ALREADY_MEMBER', 'You are already a team member');
            }
            const canReadProject = computeProjectReadAccess(
                project.visibility,
                project.status,
                project.ownerId === user.id,
                Boolean(existingMember),
            );
            if (!canReadProject && (!existingApp || existingApp.status === 'rejected')) {
                return toApplicationFailure(traceId, 'FORBIDDEN', 'This project is private.');
            }

            const roleTitleText = role?.title || role?.role || 'Unknown Role';

            if (existingApp) {
                if (existingApp.status === 'pending') {
                    return toApplicationSuccess(traceId, {
                        applicationId: existingApp.id,
                        idempotent: true,
                    });
                }
                if (existingApp.status === 'accepted') {
                    return toApplicationFailure(traceId, 'INVALID_STATE', 'Your application was already accepted');
                }
                if (existingApp.status === 'rejected') {
                    const canSkipCooldown = existingApp.decisionBy === user.id;
                    const { canApply, waitTime } = canSkipCooldown
                        ? { canApply: true, waitTime: undefined as string | undefined }
                        : calculateCooldown(existingApp.updatedAt);
                    if (!canApply) {
                        return toApplicationFailure(traceId, 'COOLDOWN_ACTIVE', `You can reapply in ${waitTime}`);
                    }

                    const { channelId } = await db.transaction(async (tx) => {
                        const reopened = await transitionApplicationToPendingInternal(
                            tx,
                            existingApp.id,
                            user.id,
                            'reapplied_by_applicant',
                        );
                        if (!reopened) {
                            throw new Error('Application is not eligible for reapply');
                        }

                        await tx
                            .update(roleApplications)
                            .set({
                                roleId,
                                message: trimmedMessage,
                                applyingProjectId: options?.applyingProjectId || null,
                                applyingProjectRole: options?.applyingProjectRole || null,
                                updatedAt: new Date(),
                            })
                            .where(eq(roleApplications.id, existingApp.id));

                        // The application card in its private thread shows the new message and status live.
                        return { channelId: await postApplicationUpdate(tx, existingApp.id, user.id, 'reapplied') };
                    });

                    revalidatePath(`/projects/${project.slug || projectId}`);
                    logger.metric('applications.apply_submitted', {
                        module: 'applications',
                        applicationId: existingApp.id,
                        projectId,
                        roleId,
                        actorId: user.id,
                        source: 'project',
                        applicationTraceId: traceId,
                    });
                    await enqueueApplicationReceivedBestEffort({
                        applicationId: existingApp.id,
                        channelId,
                        projectId,
                        projectSlug: project.slug ?? null,
                        projectTitle: project.title ?? null,
                        roleId,
                        roleTitle: roleTitleText,
                        actorUserId: user.id,
                        ...applicationActorSnapshot(user),
                        traceId,
                    });
                    return toApplicationSuccess(traceId, {
                        applicationId: existingApp.id,
                        channelId,
                        idempotent: true,
                    });
                }
            }

            const createdApplication = await db.transaction(async (tx) => {
                // PURE OPTIMIZATION (Item 94): Upgrade 32-bit hashtext to 64-bit hashtextextended advisory lock.
                await tx.execute(sql`
                    SELECT pg_advisory_xact_lock(hashtextextended('application-pending-cap:' || ${user.id}, 0))
                `);
                const [pending] = await tx
                    .select({ count: sql<number>`COUNT(*)::int` })
                    .from(roleApplications)
                    .where(and(
                        eq(roleApplications.applicantId, user.id),
                        eq(roleApplications.status, 'pending'),
                    ));
                if ((pending?.count ?? 0) >= APPLICATION_PENDING_CAP_PER_USER) return null;

                const [newApp] = await tx.insert(roleApplications)
                    .values({
                        projectId,
                        roleId,
                        applicantId: user.id,
                        creatorId: project.ownerId,
                        message: trimmedMessage,
                        applyingProjectId: options?.applyingProjectId || null,
                        applyingProjectRole: options?.applyingProjectRole || null,
                        status: 'pending'
                    })
                    .returning({ id: roleApplications.id });
                await tx.insert(applicationEvents).values({
                    applicationId: newApp!.id,
                    actorId: user.id,
                    kind: 'created',
                    fromStatus: null,
                    toStatus: 'pending',
                    metadata: { applicationTraceId: traceId },
                });

                // A private thread for applicant and reviewers, opened by the application card.
                const channelId = await ensureApplicationChannel(tx, newApp!.id);
                return { applicationId: newApp!.id, channelId };
            });
            if (!createdApplication) {
                return toApplicationFailure(traceId, 'INVALID_STATE', 'You already have too many pending applications. Please wait for decisions.');
            }
            const { applicationId: newApplicationId, channelId } = createdApplication;

            revalidatePath(`/projects/${project.slug || projectId}`);
            logger.metric('applications.apply_submitted', {
                module: 'applications',
                applicationId: newApplicationId,
                projectId,
                roleId,
                actorId: user.id,
                source: 'project',
                applicationTraceId: traceId,
            });
            await enqueueApplicationReceivedBestEffort({
                applicationId: newApplicationId,
                channelId,
                projectId,
                projectSlug: project.slug ?? null,
                projectTitle: project.title ?? null,
                roleId,
                roleTitle: roleTitleText,
                actorUserId: user.id,
                ...applicationActorSnapshot(user),
                traceId,
            });

            return toApplicationSuccess(traceId, {
                applicationId: newApplicationId,
                channelId,
            });
        });
    } catch (error) {
        console.error('Failed to apply to role:', error);
        if (error instanceof Error && error.message === 'Application is not eligible for reapply') {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'This application cannot be reopened right now');
        }
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to submit application');
    }
}

// ============================================================================
// ACCEPT APPLICATION ACTION (Creator only)
// ============================================================================
export async function acceptApplicationAction(
    applicationId: string,
    message?: string,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('accept', 'anon', applicationId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'Unauthorized');
        }
        const dedupeKey = `applications:accept:${user.id}:${applicationId}:${options?.idempotencyKey?.trim() || 'default'}`;
        return await runInFlightDeduped(dedupeKey, async () => {
            const acceptRate = await consumeRateLimit(`applications:accept:${user.id}`, 40, 60);
            if (!acceptRate.allowed) {
                return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many decisions. Please wait a moment.');
            }

            const application = await db.query.roleApplications.findFirst({
                where: eq(roleApplications.id, applicationId),
                with: {
                    project: { columns: { id: true, title: true, slug: true, ownerId: true } },
                    role: { columns: { id: true, role: true, title: true, filled: true, count: true, projectId: true } }
                }
            });

            if (!application) {
                return toApplicationFailure(traceId, 'NOT_FOUND', 'Application not found');
            }
            if (application.applicantId === user.id) {
                return toApplicationFailure(traceId, 'FORBIDDEN', 'You cannot review your own application');
            }

            const canReview = await canReviewProjectApplicationInternal(
                db,
                application.projectId,
                user.id,
                application.project?.ownerId
            );
            if (!canReview) {
                return toApplicationFailure(traceId, 'FORBIDDEN', 'Only the project owner or admins can accept applications');
            }

            if (application.status === 'accepted') {
                return toApplicationSuccess(traceId, { idempotent: true, applicationId });
            }
            if (application.status === 'rejected') {
                return toApplicationFailure(traceId, 'INVALID_STATE', 'This application has already been rejected');
            }

            if (!application.role || application.role.projectId !== application.projectId) {
                return toApplicationFailure(traceId, 'INVALID_STATE', 'Invalid application role mapping');
            }

            if (application.role && application.role.filled >= application.role.count) {
                return toApplicationFailure(traceId, 'ROLE_FULL', 'This role is now full');
            }

            const memberLifecycle = await db.transaction(async (tx) => {
                const roleTitleForMember =
                    application.role?.title || application.role?.role || 'Team Member';

                const transitioned = await transitionApplicationDecisionInternal(tx, {
                    applicationId,
                    status: 'accepted',
                    decisionBy: user.id,
                    acceptedRoleTitle: roleTitleForMember,
                });

                if (!transitioned) {
                    throw new Error('Application already processed');
                }

                const existingMember = await tx.query.projectMembers.findFirst({
                    where: and(
                        eq(projectMembers.projectId, application.projectId),
                        eq(projectMembers.userId, application.applicantId)
                    ),
                    columns: { id: true, role: true }
                });

                const lifecycle = await addProjectMemberInternal(tx, {
                    projectId: application.projectId,
                    userId: application.applicantId,
                    role: 'member',
                    actorId: user.id,
                    source: 'application_accept',
                    applicationId,
                    roleId: application.roleId,
                    incrementRoleCapacity: !existingMember || existingMember.role === 'viewer',
                });

                await ensureAcceptedConnectionInternal(tx, user.id, application.applicantId);
                const channelId = await applicationThread(tx, applicationId, user.id, message);
                return { ...lifecycle, channelId };
            });

            const slugOrId = application.project?.slug || application.projectId;
            revalidatePath(`/projects/${slugOrId}`);
            logger.metric('applications.apply_accepted', {
                module: 'applications',
                applicationId,
                projectId: application.projectId,
                roleId: application.roleId || undefined,
                actorId: user.id,
                source: 'requests',
                applicationTraceId: traceId,
            });
            if (memberLifecycle.changed) {
                const memberName = memberLifecycle.target?.fullName || memberLifecycle.target?.username || "A member";
                await enqueueMemberJoinedBestEffort({
                    projectId: application.projectId,
                    projectSlug: application.project?.slug ?? null,
                    projectTitle: application.project?.title ?? null,
                    applicationId,
                    roleId: application.roleId,
                    targetUserId: application.applicantId,
                    targetName: memberName,
                    targetAvatarUrl: memberLifecycle.target?.avatarUrl ?? null,
                    actorUserId: user.id,
                    ...applicationActorSnapshot(user),
                    sourceEventId: memberLifecycle.eventId ?? `${applicationId}:member-joined`,
                    traceId,
                });
            }
            await enqueueApplicationDecisionBestEffort({
                applicationId,
                status: 'accepted',
                channelId: memberLifecycle.channelId,
                projectId: application.projectId,
                projectSlug: application.project?.slug ?? null,
                projectTitle: application.project?.title ?? null,
                roleId: application.roleId,
                applicantId: application.applicantId,
                actorUserId: user.id,
                ...applicationActorSnapshot(user),
                traceId,
            });

            return toApplicationSuccess(traceId, { applicationId });
        });
    } catch (error) {
        console.error('Failed to accept application:', error);
        if (error instanceof Error && error.message === 'Application already processed') {
            return toApplicationFailure(traceId, 'ALREADY_PROCESSED', 'This application has already been processed');
        }
        if (error instanceof Error && error.message === 'Role is full') {
            return toApplicationFailure(traceId, 'ROLE_FULL', 'This role is now full');
        }
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to accept application');
    }
}

// ============================================================================
// REJECT APPLICATION ACTION (Creator only)
// ============================================================================
export async function rejectApplicationAction(
    applicationId: string,
    message?: string,
    reason?: string,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('reject', 'anon', applicationId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'Unauthorized');
        }
        const dedupeKey = `applications:reject:${user.id}:${applicationId}:${options?.idempotencyKey?.trim() || 'default'}`;
        return await runInFlightDeduped(dedupeKey, async () => {
            const rejectRate = await consumeRateLimit(`applications:reject:${user.id}`, 50, 60);
            if (!rejectRate.allowed) {
                return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many decisions. Please wait a moment.');
            }

            const application = await db.query.roleApplications.findFirst({
                where: eq(roleApplications.id, applicationId),
                with: {
                    project: { columns: { title: true, slug: true, ownerId: true } },
                    role: { columns: { title: true, role: true } }
                },
                columns: { id: true, applicantId: true, creatorId: true, projectId: true, roleId: true, status: true }
            });

            if (!application) {
                return toApplicationFailure(traceId, 'NOT_FOUND', 'Application not found');
            }
            if (application.applicantId === user.id) {
                return toApplicationFailure(traceId, 'FORBIDDEN', 'You cannot review your own application');
            }

            const canReview = await canReviewProjectApplicationInternal(
                db,
                application.projectId,
                user.id,
                application.project?.ownerId || application.creatorId
            );
            if (!canReview) {
                return toApplicationFailure(traceId, 'FORBIDDEN', 'Only the project owner or admins can reject applications');
            }

            if (application.status === 'rejected') {
                return toApplicationSuccess(traceId, { idempotent: true, applicationId });
            }
            if (application.status === 'accepted') {
                return toApplicationFailure(traceId, 'INVALID_STATE', 'This application has already been accepted');
            }

            const normalizedReason = normalizeDecisionReasonCode(reason || 'other');

            let channelId: string | null = null;
            await db.transaction(async (tx) => {
                const transitioned = await transitionApplicationDecisionInternal(tx, {
                    applicationId,
                    status: 'rejected',
                    decisionBy: user.id,
                    reasonCode: normalizedReason,
                    reasonText: (message || '').trim()
                        || APPLICATION_DECISION_REASON_TEMPLATES[normalizedReason],
                });

                if (!transitioned) {
                    throw new Error('Application already processed');
                }

                channelId = await applicationThread(tx, applicationId, user.id, message);
            });

            const slugOrId = application.project?.slug || application.projectId;
            revalidatePath(`/projects/${slugOrId}`);
            logger.metric('applications.apply_rejected', {
                module: 'applications',
                applicationId,
                projectId: application.projectId,
                roleId: application.roleId || undefined,
                actorId: user.id,
                reasonCode: normalizedReason || null,
                source: 'requests',
                applicationTraceId: traceId,
            });
            await enqueueApplicationDecisionBestEffort({
                applicationId,
                status: 'rejected',
                channelId,
                projectId: application.projectId,
                projectSlug: application.project?.slug ?? null,
                projectTitle: application.project?.title ?? null,
                roleId: application.roleId,
                applicantId: application.applicantId,
                actorUserId: user.id,
                ...applicationActorSnapshot(user),
                traceId,
            });

            return toApplicationSuccess(traceId, { applicationId });
        });
    } catch (error) {
        console.error('Failed to reject application:', error);
        if (error instanceof Error && error.message === 'Application already processed') {
            return toApplicationFailure(traceId, 'ALREADY_PROCESSED', 'This application has already been processed');
        }
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to reject application');
    }
}

// ============================================================================
// EDIT PENDING APPLICATION (Applicant only, short window)
// ============================================================================
export async function editPendingApplicationAction(
    applicationId: string,
    message: string,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('edit', 'anon', applicationId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'Unauthorized');
        }

        const editRate = await consumeRateLimit(`applications:edit:${user.id}`, 20, 60);
        if (!editRate.allowed) {
            return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many edits. Please wait a moment.');
        }

        const normalizedMessage = normalizeApplicationMessageText(message);
        if (!normalizedMessage) {
            return toApplicationFailure(traceId, 'INVALID_INPUT', 'Application message cannot be empty');
        }

        const application = await db.query.roleApplications.findFirst({
            where: eq(roleApplications.id, applicationId),
            with: {
                project: { columns: { id: true, title: true, slug: true, ownerId: true } },
                role: { columns: { id: true, role: true, title: true } },
            },
            columns: {
                id: true,
                applicantId: true,
                creatorId: true,
                projectId: true,
                roleId: true,
                status: true,
                message: true,
                createdAt: true,
            },
        });

        if (!application) return toApplicationFailure(traceId, 'NOT_FOUND', 'Application not found');
        if (application.applicantId !== user.id) return toApplicationFailure(traceId, 'FORBIDDEN', 'Only the applicant can edit this application');
        if (application.status !== 'pending') return toApplicationFailure(traceId, 'INVALID_STATE', 'Only pending applications can be edited');

        const ageMs = Date.now() - new Date(application.createdAt).getTime();
        if (ageMs > APPLICATION_EDIT_WINDOW_MS) {
            return toApplicationFailure(traceId, 'EDIT_WINDOW_EXPIRED', 'Edit window expired');
        }

        if ((application.message || '').trim() === normalizedMessage) {
            return toApplicationSuccess(traceId, {
                applicationId: application.id,
                idempotent: true,
            });
        }

        const channelId = await db.transaction(async (tx) => {
            // COR-033: the edit is fenced on applicant, pending state and window in the UPDATE itself,
            // so a decision that lands after the checks above wins.
            const edited = await tx
                .update(roleApplications)
                .set({ message: normalizedMessage, updatedAt: new Date() })
                .where(and(
                    eq(roleApplications.id, application.id),
                    eq(roleApplications.applicantId, user.id),
                    eq(roleApplications.status, 'pending'),
                    sql`${roleApplications.createdAt} > now() - make_interval(secs => ${APPLICATION_EDIT_WINDOW_MS / 1000})`,
                ))
                .returning({ id: roleApplications.id });
            if (edited.length !== 1) return null;
            await tx.insert(applicationEvents).values({
                applicationId: application.id,
                actorId: user.id,
                kind: 'edited',
                fromStatus: 'pending',
                toStatus: 'pending',
                metadata: { applicationTraceId: traceId },
            });
            // The application card shows the edited message live.
            return postApplicationUpdate(tx, application.id, user.id, 'edited the application');
        });
        if (channelId === null) {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'This application was decided or its edit window closed. Refresh to see it.');
        }

        const slugOrId = application.project?.slug || application.projectId;
        revalidatePath(`/projects/${slugOrId}`);
        logger.metric('applications.apply_edited', {
            module: 'applications',
            applicationId: application.id,
            projectId: application.projectId,
            roleId: application.roleId || undefined,
            actorId: user.id,
            source: 'messages',
            applicationTraceId: traceId,
        });

        return toApplicationSuccess(traceId, {
            applicationId: application.id,
            channelId,
        });
    } catch (error) {
        console.error('Failed to edit pending application:', error);
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to edit application');
    }
}

// ============================================================================
// WITHDRAW PENDING APPLICATION (Applicant only)
// ============================================================================
export async function withdrawApplicationAction(
    applicationId: string,
    message?: string,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('withdraw', 'anon', applicationId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'Unauthorized');
        }

        const withdrawRate = await consumeRateLimit(`applications:withdraw:${user.id}`, 20, 60);
        if (!withdrawRate.allowed) {
            return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many requests. Please wait a moment.');
        }

        const application = await db.query.roleApplications.findFirst({
            where: eq(roleApplications.id, applicationId),
            with: {
                project: { columns: { title: true, slug: true } },
                role: { columns: { title: true, role: true } },
            },
            columns: {
                id: true,
                applicantId: true,
                projectId: true,
                roleId: true,
                status: true,
            },
        });

        if (!application) return toApplicationFailure(traceId, 'NOT_FOUND', 'Application not found');
        if (application.applicantId !== user.id) return toApplicationFailure(traceId, 'FORBIDDEN', 'Only the applicant can withdraw this application');
        if (application.status === 'accepted') return toApplicationFailure(traceId, 'INVALID_STATE', 'Accepted applications cannot be withdrawn');
        if (application.status === 'withdrawn' || application.status === 'rejected') {
            return toApplicationSuccess(traceId, { applicationId, idempotent: true });
        }

        let channelId: string | null = null;
        await db.transaction(async (tx) => {
            const transitioned = await transitionApplicationDecisionInternal(tx, {
                applicationId,
                status: 'withdrawn',
                decisionBy: user.id,
                reasonCode: 'withdrawn_by_applicant',
                reasonText: APPLICATION_DECISION_REASON_TEMPLATES.withdrawn_by_applicant,
            });

            if (!transitioned) {
                throw new Error('Application already processed');
            }

            channelId = await applicationThread(tx, applicationId, user.id, (message || '').trim() || 'Application withdrawn by applicant');
        });

        const slugOrId = application.project?.slug || application.projectId;
        revalidatePath(`/projects/${slugOrId}`);
        logger.metric('applications.apply_withdrawn', {
            module: 'applications',
            applicationId,
            projectId: application.projectId,
            roleId: application.roleId || undefined,
            actorId: user.id,
            reasonCode: 'withdrawn_by_applicant',
            source: 'messages',
            applicationTraceId: traceId,
        });
        await enqueueApplicationWithdrawnBestEffort({
            applicationId,
            projectId: application.projectId,
            projectSlug: application.project?.slug ?? null,
            projectTitle: application.project?.title ?? null,
            roleId: application.roleId,
            roleTitle: application.role?.title || application.role?.role || null,
            actorUserId: user.id,
            ...applicationActorSnapshot(user),
            traceId,
        });

        return toApplicationSuccess(traceId, { applicationId });
    } catch (error) {
        console.error('Failed to withdraw application:', error);
        if (error instanceof Error && error.message === 'Application already processed') {
            return toApplicationFailure(traceId, 'ALREADY_PROCESSED', 'This application has already been processed');
        }
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to withdraw application');
    }
}

// ============================================================================
// REOPEN REJECTED APPLICATION (Reviewer only, short window)
// ============================================================================
export async function reopenApplicationAction(
    applicationId: string,
    message?: string,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('reopen', 'anon', applicationId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'Unauthorized');
        }

        const reopenRate = await consumeRateLimit(`applications:reopen:${user.id}`, 20, 60);
        if (!reopenRate.allowed) {
            return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many reopen requests. Please wait a moment.');
        }

        const application = await db.query.roleApplications.findFirst({
            where: eq(roleApplications.id, applicationId),
            with: {
                project: { columns: { title: true, slug: true, ownerId: true } },
                role: { columns: { title: true, role: true } },
            },
            columns: {
                id: true,
                applicantId: true,
                projectId: true,
                roleId: true,
                status: true,
                creatorId: true,
                decisionAt: true,
                updatedAt: true,
            },
        });

        if (!application) return toApplicationFailure(traceId, 'NOT_FOUND', 'Application not found');
        if (application.applicantId === user.id) {
            return toApplicationFailure(traceId, 'FORBIDDEN', 'You cannot review your own application');
        }

        const canReview = await canReviewProjectApplicationInternal(
            db,
            application.projectId,
            user.id,
            application.project?.ownerId || application.creatorId
        );
        if (!canReview) {
            return toApplicationFailure(traceId, 'FORBIDDEN', 'Only project owner or admins can reopen applications');
        }

        if (application.status === 'pending') {
            return toApplicationSuccess(traceId, { applicationId, idempotent: true });
        }
        if (application.status === 'accepted') {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'Accepted applications cannot be reopened');
        }
        if (application.status !== 'rejected') {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'Only rejected applications can be reopened');
        }

        const decisionTimestampSource = application.decisionAt ?? application.updatedAt;
        if (!decisionTimestampSource) {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'Cannot determine decision timestamp');
        }
        const decisionTimestamp = new Date(decisionTimestampSource).getTime();
        if (Number.isNaN(decisionTimestamp)) {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'Invalid decision timestamp');
        }
        if (Date.now() - decisionTimestamp > APPLICATION_REOPEN_WINDOW_MS) {
            return toApplicationFailure(traceId, 'REOPEN_WINDOW_EXPIRED', 'Reopen window expired');
        }

        let channelId: string | null = null;
        await db.transaction(async (tx) => {
            const reopened = await transitionApplicationToPendingInternal(
                tx,
                applicationId,
                user.id,
                'reopened_by_reviewer',
            );
            if (!reopened) throw new Error('Application already processed');

            channelId = await applicationThread(tx, applicationId, user.id, (message || '').trim() || 'Application reopened for review.');
        });

        const slugOrId = application.project?.slug || application.projectId;
        revalidatePath(`/projects/${slugOrId}`);
        logger.metric('applications.apply_reopened', {
            module: 'applications',
            applicationId,
            projectId: application.projectId,
            roleId: application.roleId || undefined,
            actorId: user.id,
            source: 'messages',
            applicationTraceId: traceId,
        });
        await enqueueApplicationDecisionBestEffort({
            applicationId,
            status: 'reopened',
            channelId,
            projectId: application.projectId,
            projectSlug: application.project?.slug ?? null,
            projectTitle: application.project?.title ?? null,
            roleId: application.roleId,
            applicantId: application.applicantId,
            actorUserId: user.id,
            ...applicationActorSnapshot(user),
            traceId,
        });

        return toApplicationSuccess(traceId, { applicationId });
    } catch (error) {
        console.error('Failed to reopen application:', error);
        if (error instanceof Error && error.message === 'Application already processed') {
            return toApplicationFailure(traceId, 'ALREADY_PROCESSED', 'This application cannot be reopened right now');
        }
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to reopen application');
    }
}

// ============================================================================
// GET USER'S APPLICATIONS (for Connections > Requests tab)
// ============================================================================
export async function getMyApplicationsAction(
    pagination: ApplicationCursorPaginationInput = {}
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return {
                success: false,
                errorCode: 'UNAUTHORIZED' as const,
                error: 'Unauthorized',
                applications: [],
                hasMore: false,
                nextCursor: null,
            };
        }

        const compCursor = parseCompoundCursor(pagination.cursor);
        const oldCursorResult = normalizeCursorPaginationInput(pagination);
        const safeLimit = oldCursorResult.safeLimit;
        const cursorDate = compCursor ? compCursor.createdAt : oldCursorResult.cursor?.createdAt;
        const cursorId = compCursor ? compCursor.id : oldCursorResult.cursor?.id;

        const appWhere = cursorDate && cursorId
            ? and(
                eq(roleApplications.applicantId, user.id),
                or(
                    lt(roleApplications.createdAt, cursorDate),
                    and(eq(roleApplications.createdAt, cursorDate), lt(roleApplications.id, cursorId))
                )
            )
            : eq(roleApplications.applicantId, user.id);

        const roleApps = await db.query.roleApplications.findMany({
            where: appWhere,
            with: {
                project: {
                    columns: { id: true, title: true, slug: true, coverImage: true }
                },
                role: {
                    columns: { role: true, title: true }
                }
            },
            columns: {
                id: true,
                projectId: true,
                roleId: true,
                message: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                decisionBy: true,
            },
            orderBy: (apps, { desc }) => [desc(apps.createdAt), desc(apps.id)],
            limit: safeLimit + 1,
        });

        const invites = await listInvitationsInternal({ userId: user.id, as: 'inviter', cursorDate, cursorId, limit: safeLimit + 1 });

        const decisionMap = await getDecisionMetadataMap(roleApps.map((app) => app.id));

        const mappedApps = roleApps.map((app) => {
            const decisionMeta = decisionMap.get(app.id);
            const decisionReasonRaw = decisionMeta?.reasonCode || null;
            const decisionReason = decisionReasonRaw
                ? normalizeApplicationDecisionReason(decisionReasonRaw, 'other')
                : null;
            const lifecycleStatus = resolveLifecycleStatus(app.status, decisionReason);
            const canSkipCooldown = app.decisionBy === user.id;
            const cooldownMeta =
                app.status === 'rejected'
                    ? (canSkipCooldown ? { canApply: true } : calculateCooldown(app.updatedAt))
                    : {};
            return {
                id: app.id,
                projectId: app.projectId,
                projectTitle: app.project?.title || 'Unknown Project',
                projectSlug: app.project?.slug,
                projectCover: app.project?.coverImage,
                roleTitle: app.role?.title || app.role?.role || 'Unknown Role',
                message: app.message,
                status: app.status,
                lifecycleStatus,
                decisionReason,
                createdAt: app.createdAt,
                updatedAt: app.updatedAt,
                decisionAt: decisionMeta?.decisionAt || toISODate(app.updatedAt),
                canEdit:
                    app.status === 'pending' &&
                    Date.now() - new Date(app.createdAt).getTime() <= APPLICATION_EDIT_WINDOW_MS,
                ...cooldownMeta
            };
        });

        const mappedInvites = invites.map((invite) => {
            const { status, decisionReason } = invitationLifecycle(invite.status);
            return {
                id: invite.id,
                isInvitation: true,
                projectId: invite.projectId,
                projectTitle: invite.projectTitle || 'Unknown Project',
                projectSlug: invite.projectSlug,
                projectCover: invite.projectCover || null,
                roleTitle: invite.roleTitle || invite.guidanceLabel || 'Collaborator',
                message: invite.note,
                status,
                lifecycleStatus: resolveLifecycleStatus(status, decisionReason),
                decisionReason,
                createdAt: invite.createdAt,
                updatedAt: invite.updatedAt,
                decisionAt: toISODate(invite.updatedAt),
                canEdit: false,
            };
        });

        const combined = [
            ...mappedApps.map(item => ({ ...item, _source: 'app' as const })),
            ...mappedInvites.map(item => ({ ...item, _source: 'invite' as const }))
        ].sort((a, b) => {
            const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            if (timeDiff !== 0) return timeDiff;
            return b.id.localeCompare(a.id);
        });

        const hasMore = combined.length > safeLimit;
        const sliced = combined.slice(0, safeLimit);

        let nextCursor = null;
        if (hasMore && sliced.length > 0) {
            const lastItem = sliced[sliced.length - 1]!;
            nextCursor = encodeCompoundCursor(lastItem._source, lastItem.createdAt, lastItem.id);
        }

        return {
            success: true,
            applications: sliced.map(({ _source, ...rest }) => rest),
            hasMore,
            nextCursor,
        };
    } catch (error) {
        console.error('Failed to get applications:', error);
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR' as const,
            error: 'Failed to load applications',
            applications: [],
            hasMore: false,
            nextCursor: null,
        };
    }
}

// ============================================================================
// GET INCOMING APPLICATIONS (for Creator - Connections > Requests tab)
// ============================================================================
export async function getIncomingApplicationsAction(
    pagination: ApplicationCursorPaginationInput = { limit: APPLICATION_LIST_DEFAULT_LIMIT }
) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return {
                success: false,
                errorCode: 'UNAUTHORIZED' as const,
                error: 'Unauthorized',
                applications: [],
                hasMore: false,
                nextCursor: null,
            };
        }

        const { safeLimit } = normalizeApplicationListPagination(pagination.limit, 0);

        let cursorDate: Date | undefined;
        let cursorId: string | undefined;

        const compCursor = parseCompoundCursor(pagination.cursor);
        if (compCursor) {
            cursorDate = compCursor.createdAt;
            cursorId = compCursor.id;
        } else {
            const oldCursorResult = normalizeCursorPaginationInput(pagination);
            if (oldCursorResult.cursor) {
                cursorDate = oldCursorResult.cursor.createdAt;
                cursorId = oldCursorResult.cursor.id;
            }
        }

        const appWhere = cursorDate && cursorId
            ? and(
                eq(roleApplications.creatorId, user.id),
                eq(roleApplications.status, 'pending'),
                or(
                    lt(roleApplications.createdAt, cursorDate),
                    and(eq(roleApplications.createdAt, cursorDate), lt(roleApplications.id, cursorId))
                )
            )
            : and(
                eq(roleApplications.creatorId, user.id),
                eq(roleApplications.status, 'pending')
            );

        const roleApps = await db.query.roleApplications.findMany({
            where: appWhere,
            with: {
                project: {
                    columns: { id: true, title: true, slug: true }
                },
                role: {
                    columns: { role: true, title: true }
                },
                applicant: {
                    columns: { id: true, username: true, fullName: true, avatarUrl: true, skills: true, headline: true }
                }
            },
            columns: { id: true, projectId: true, status: true, createdAt: true },
            orderBy: (apps, { desc }) => [desc(apps.createdAt), desc(apps.id)],
            limit: safeLimit + 1,
        });

        const invites = await listInvitationsInternal({ userId: user.id, as: 'candidate', pendingOnly: true, cursorDate, cursorId, limit: safeLimit + 1 });

        const mappedApps = roleApps
            .filter((app) => Boolean(app.applicant?.id) && Boolean(app.project?.id))
            .map((app) => {
            const actor = {
                id: app.applicant?.id,
                username: app.applicant?.username,
                fullName: app.applicant?.fullName,
                avatarUrl: app.applicant?.avatarUrl,
                skills: app.applicant?.skills ?? [],
                headline: app.applicant?.headline ?? null,
            };
            return {
            id: app.id,
            projectId: app.projectId,
            projectTitle: app.project?.title || 'Unknown Project',
            projectSlug: app.project?.slug,
            roleTitle: app.role?.title || app.role?.role || 'Unknown Role',
            // `applicant` remains for existing consumers; new UI reads the
            // neutral actor field so invitation senders are not mislabeled.
            actor,
            applicant: actor,
            status: app.status as 'pending' | 'accepted' | 'rejected' | 'withdrawn',
            createdAt: app.createdAt,
            isInvitation: false,
            };
        });

        const mappedInvites = invites
            .filter((invite) => Boolean(invite.other?.id))
            .map((invite) => {
            const actor = {
                id: invite.other?.id,
                username: invite.other?.username,
                fullName: invite.other?.fullName,
                avatarUrl: invite.other?.avatarUrl,
                skills: invite.other?.skills ?? [],
                headline: invite.other?.headline ?? null,
            };
            return {
                id: invite.id,
                projectId: invite.projectId,
                projectTitle: invite.projectTitle || 'Unknown Project',
                projectSlug: invite.projectSlug,
                roleTitle: invite.roleTitle || invite.guidanceLabel || 'Collaborator',
                actor,
                applicant: actor,
                status: invitationLifecycle(invite.status).status,
                createdAt: invite.createdAt,
                isInvitation: true,
            };
        });

        const combined = [
            ...mappedApps.map(item => ({ ...item, _source: 'app' as const })),
            ...mappedInvites.map(item => ({ ...item, _source: 'invite' as const }))
        ].sort((a, b) => {
            const timeDiff = new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
            if (timeDiff !== 0) return timeDiff;
            if (a._source !== b._source) return a._source.localeCompare(b._source);
            return b.id.localeCompare(a.id);
        });

        const sliced = combined.slice(0, safeLimit);
        const hasMore = combined.length > safeLimit;

        let nextCursor = null;
        if (hasMore && sliced.length > 0) {
            const lastItem = sliced[sliced.length - 1]!;
            nextCursor = encodeCompoundCursor(lastItem._source, lastItem.createdAt, lastItem.id);
        }

        return {
            success: true,
            applications: await (async () => {
                const details = await readPersonCardDetails(user.id, sliced.map(item => item.actor.id).filter((id): id is string => !!id));
                return sliced.map(({ _source, ...rest }) => {
                    const actor = { ...rest.actor, ...details[rest.actor.id ?? ''] };
                    return { ...rest, actor, applicant: actor };
                }).filter(item => !item.actor.isUnavailable);
            })(),
            hasMore,
            nextCursor,
        };
    } catch (error) {
        console.error('Failed to get incoming applications:', error);
        return {
            success: false,
            errorCode: 'INTERNAL_ERROR' as const,
            error: 'Failed to load incoming applications',
            applications: [],
            hasMore: false,
            nextCursor: null,
        };
    }
}

// ============================================================================
// GET INBOX APPLICATIONS (Unified Incoming + Outgoing)
// ============================================================================
export async function getInboxApplicationsAction(
    limit: number = APPLICATION_LIST_DEFAULT_LIMIT,
    cursor?: string | null,
    options: {
        status?: 'all' | 'pending' | 'accepted' | 'rejected';
        sort?: 'newest' | 'status' | 'unread';
    } = {},
) {
    try {
        const startedAtMs = Date.now();
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return { success: false, applications: [], hasMore: false };
        }
        const { safeLimit } = normalizeApplicationListPagination(limit, 0);
        const statusFilter = options.status ?? 'all';
        const sort = options.sort ?? 'newest';
        let decodedCursor: {
            eventAt: Date;
            source: 'application' | 'invite';
            id: string;
            sortValue: number;
        } | null = null;
        if (cursor) {
            try {
                const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as {
                    eventAt?: unknown;
                    source?: unknown;
                    id?: unknown;
                    sortValue?: unknown;
                };
                const eventAt = typeof parsed.eventAt === 'string' ? new Date(parsed.eventAt) : null;
                if (
                    !eventAt
                    || Number.isNaN(eventAt.getTime())
                    || (parsed.source !== 'application' && parsed.source !== 'invite')
                    || typeof parsed.id !== 'string'
                    || !isUuid(parsed.id)
                    || typeof parsed.sortValue !== 'number'
                    || !Number.isFinite(parsed.sortValue)
                ) {
                    return { success: false, error: 'Invalid applications cursor', applications: [], hasMore: false };
                }
                decodedCursor = {
                    eventAt,
                    source: parsed.source,
                    id: parsed.id,
                    sortValue: parsed.sortValue,
                };
            } catch {
                return { success: false, error: 'Invalid applications cursor', applications: [], hasMore: false };
            }
        }

        const candidateRows = await db.execute<{
            id: string;
            source: 'application' | 'invite';
            event_at: Date;
            sort_value: number;
        }>(sql`
            WITH inbox_items AS (
                SELECT
                    application.id,
                    'application'::text AS source,
                    CASE
                        WHEN application.status = 'pending' THEN application.created_at
                        ELSE COALESCE(application.decision_at, application.updated_at, application.created_at)
                    END AS event_at
                    ,
                    CASE application.status
                        WHEN 'pending' THEN 0
                        WHEN 'proposed' THEN 0
                        WHEN 'accepted' THEN 1
                        WHEN 'rejected' THEN 2
                        ELSE 3
                    END AS status_rank,
                    application.status::text AS normalized_status,
                    COALESCE((
                        SELECT CASE WHEN c.last_top_seq > m.last_read_seq THEN c.last_seq - m.last_read_seq ELSE 0 END
                        FROM ${chatChannels} c
                        JOIN ${chatChannelMembers} m ON m.channel_id = c.id AND m.user_id = ${user.id}
                        WHERE c.application_id = application.id
                    ), 0)::int AS unread_count
                FROM ${roleApplications} application
                WHERE (
                    application.creator_id = ${user.id}
                    AND application.status = 'pending'
                )
                OR application.applicant_id = ${user.id}

                UNION ALL

                SELECT
                    invite.id,
                    'invite'::text AS source,
                    CASE
                        WHEN invite.status = 'pending' THEN invite.created_at
                        ELSE COALESCE(invite.resolved_at, invite.updated_at, invite.created_at)
                    END AS event_at
                    ,
                    CASE invite.status
                        WHEN 'pending' THEN 0
                        WHEN 'accepted' THEN 1
                        WHEN 'declined' THEN 2
                        WHEN 'expired' THEN 2
                        ELSE 3
                    END AS status_rank,
                    CASE
                        WHEN invite.status = 'declined' OR invite.status = 'expired' THEN 'rejected'
                        WHEN invite.status = 'cancelled' THEN 'withdrawn'
                        ELSE invite.status
                    END AS normalized_status,
                    0 AS unread_count
                FROM ${projectInvitations} invite
                WHERE invite.candidate_id = ${user.id}
                   OR invite.inviter_id = ${user.id}
            )
            SELECT
                id,
                source,
                event_at,
                CASE
                    WHEN ${sort} = 'status' THEN status_rank
                    WHEN ${sort} = 'unread' THEN unread_count
                    ELSE 0
                END::int AS sort_value
            FROM inbox_items
            WHERE (${statusFilter} = 'all' OR normalized_status = ${statusFilter})
            ${decodedCursor
                ? sort === 'status'
                    ? sql`AND (
                        status_rank > ${decodedCursor.sortValue}
                        OR (
                            status_rank = ${decodedCursor.sortValue}
                            AND (event_at, source, id) < (
                                ${decodedCursor.eventAt},
                                ${decodedCursor.source},
                                ${decodedCursor.id}::uuid
                            )
                        )
                    )`
                    : sort === 'unread'
                        ? sql`AND (
                            unread_count < ${decodedCursor.sortValue}
                            OR (
                                unread_count = ${decodedCursor.sortValue}
                                AND (event_at, source, id) < (
                                    ${decodedCursor.eventAt},
                                    ${decodedCursor.source},
                                    ${decodedCursor.id}::uuid
                                )
                            )
                        )`
                        : sql`AND (event_at, source, id) < (
                            ${decodedCursor.eventAt},
                            ${decodedCursor.source},
                            ${decodedCursor.id}::uuid
                        )`
                : sql``}
            ORDER BY
                ${sort === 'status' ? sql`status_rank ASC,` : sql``}
                ${sort === 'unread' ? sql`unread_count DESC,` : sql``}
                event_at DESC,
                source DESC,
                id DESC
            LIMIT ${safeLimit + 1}
        `);
        const candidates = Array.from(candidateRows);
        const pageCandidates = candidates.slice(0, safeLimit);
        const hasMore = candidates.length > safeLimit;
        if (pageCandidates.length === 0) {
            return { success: true, applications: [], hasMore: false, nextCursor: null };
        }
        const applicationIds = pageCandidates
            .filter((candidate) => candidate.source === 'application')
            .map((candidate) => candidate.id);
        const inviteIds = pageCandidates
            .filter((candidate) => candidate.source === 'invite')
            .map((candidate) => candidate.id);

        const roleApps = applicationIds.length > 0
            ? await db.query.roleApplications.findMany({
            where: inArray(roleApplications.id, applicationIds),
            with: {
                project: {
                    columns: { id: true, title: true, slug: true, ownerId: true }
                },
                role: {
                    columns: { role: true, title: true }
                },
                applicant: {
                    columns: { id: true, username: true, fullName: true, avatarUrl: true }
                }
            },
            columns: {
                id: true,
                projectId: true,
                creatorId: true,
                applicantId: true,
                message: true,
                status: true,
                createdAt: true,
                updatedAt: true,
            },
        })
            : [];

        // 2. Project invitations where the user is the inviter (outgoing) or candidate (incoming).
        const inviter = alias(profiles, 'inbox_inviter');
        const candidate = alias(profiles, 'inbox_candidate');
        const invites = inviteIds.length > 0
            ? await db
                .select({
                    id: projectInvitations.id,
                    projectId: projectInvitations.projectId,
                    inviterId: projectInvitations.inviterId,
                    candidateId: projectInvitations.candidateId,
                    status: projectInvitations.status,
                    roleTitle: projectInvitations.roleTitle,
                    guidanceLabel: projectInvitations.guidanceLabel,
                    note: projectInvitations.note,
                    projectTitle: projectInvitations.projectTitle,
                    projectSlug: projects.slug,
                    createdAt: projectInvitations.createdAt,
                    updatedAt: projectInvitations.updatedAt,
                    inviter: { id: inviter.id, username: inviter.username, fullName: inviter.fullName, avatarUrl: inviter.avatarUrl },
                    candidate: { id: candidate.id, username: candidate.username, fullName: candidate.fullName, avatarUrl: candidate.avatarUrl },
                })
                .from(projectInvitations)
                .leftJoin(projects, eq(projects.id, projectInvitations.projectId))
                .leftJoin(inviter, eq(inviter.id, projectInvitations.inviterId))
                .leftJoin(candidate, eq(candidate.id, projectInvitations.candidateId))
                .where(inArray(projectInvitations.id, inviteIds))
            : [];

        const decisionMap = await getDecisionMetadataMap(roleApps.map((app) => app.id));
        // Each application has a private chat thread; its unread count comes from the viewer's cursor.
        const threads = roleApps.length > 0
            ? await db
                .select({
                    applicationId: chatChannels.applicationId,
                    channelId: chatChannels.id,
                    unreadCount: sql<number>`CASE WHEN ${chatChannels.lastTopSeq} > ${chatChannelMembers.lastReadSeq} THEN (${chatChannels.lastSeq} - ${chatChannelMembers.lastReadSeq})::int ELSE 0 END`,
                })
                .from(chatChannels)
                .innerJoin(chatChannelMembers, and(eq(chatChannelMembers.channelId, chatChannels.id), eq(chatChannelMembers.userId, user.id)))
                .where(inArray(chatChannels.applicationId, roleApps.map((app) => app.id)))
            : [];
        const threadByApplicationId = new Map(threads.map((thread) => [thread.applicationId, thread]));

        // Fetch creator profiles for outgoing applications
        const creatorIds = roleApps
            .filter(app => app.applicantId === user.id) // Outgoing
            .map(app => app.project?.ownerId || app.creatorId)
            .filter(Boolean) as string[];

        const uniqueCreatorIds = [...new Set(creatorIds)];

        let creatorsMap = new Map<string, { fullName: string | null; username: string | null; avatarUrl: string | null }>();

        if (uniqueCreatorIds.length > 0) {
            const creators = await db.query.profiles.findMany({
                where: inArray(profiles.id, uniqueCreatorIds),
                columns: { id: true, fullName: true, username: true, avatarUrl: true }
            });
            creatorsMap = new Map(creators.map(c => [c.id, c]));
        }

        // Map applications
        const mappedApps = roleApps.map((app) => {
            const isIncoming = app.creatorId === user.id;
            const decisionMeta = decisionMap.get(app.id);
            const decisionReasonRaw = decisionMeta?.reasonCode || null;
            const decisionReason = decisionReasonRaw
                ? normalizeApplicationDecisionReason(decisionReasonRaw, 'other')
                : null;
            const lifecycleStatus = resolveLifecycleStatus(app.status, decisionReason);

            let displayUser: {
                id?: string;
                username?: string | null;
                fullName?: string | null;
                avatarUrl?: string | null;
                type: 'applicant' | 'creator';
            };

            if (isIncoming) {
                displayUser = {
                    id: app.applicant?.id,
                    username: app.applicant?.username,
                    fullName: app.applicant?.fullName,
                    avatarUrl: app.applicant?.avatarUrl,
                    type: 'applicant',
                };
            } else {
                const creatorId = app.project?.ownerId || app.creatorId;
                const creator = creatorsMap.get(creatorId);
                displayUser = {
                    id: creatorId,
                    username: creator?.username,
                    fullName: creator?.fullName,
                    avatarUrl: creator?.avatarUrl,
                    type: 'creator',
                };
            }

            return {
                id: app.id,
                isInvitation: false,
                type: isIncoming ? 'incoming' : 'outgoing',
                projectId: app.projectId,
                projectTitle: app.project?.title || 'Unknown Project',
                projectSlug: app.project?.slug,
                roleTitle: app.role?.title || app.role?.role || 'Unknown Role',
                displayUser,
                status: app.status,
                lifecycleStatus,
                decisionReason,
                decisionAt: decisionMeta?.decisionAt || toISODate(app.updatedAt),
                createdAt: app.createdAt,
                channelId: threadByApplicationId.get(app.id)?.channelId ?? null,
                coverLetter: app.message,
                unreadCount: Number(threadByApplicationId.get(app.id)?.unreadCount ?? 0),
            };
        });

        // Map invitations
        const mappedInvites = invites.map((invite) => {
            const isIncoming = invite.candidateId === user.id;
            const { status, decisionReason } = invitationLifecycle(invite.status);
            const other = isIncoming ? invite.inviter : invite.candidate;
            const displayUser: {
                id?: string;
                username?: string | null;
                fullName?: string | null;
                avatarUrl?: string | null;
                type: 'applicant' | 'creator';
            } = {
                id: other?.id,
                username: other?.username,
                fullName: other?.fullName,
                avatarUrl: other?.avatarUrl,
                type: isIncoming ? 'creator' : 'applicant',
            };
            return {
                id: invite.id,
                isInvitation: true,
                type: isIncoming ? 'incoming' : 'outgoing',
                projectId: invite.projectId,
                projectTitle: invite.projectTitle || 'Unknown Project',
                projectSlug: invite.projectSlug,
                roleTitle: invite.roleTitle || invite.guidanceLabel || 'Collaborator',
                displayUser,
                status,
                lifecycleStatus: resolveLifecycleStatus(status, decisionReason),
                decisionReason,
                decisionAt: toISODate(invite.updatedAt),
                createdAt: invite.createdAt,
                channelId: null,
                coverLetter: invite.note,
                unreadCount: 0,
            };
        });

        const combinedByKey = new Map<
            string,
            (typeof mappedApps)[number] | (typeof mappedInvites)[number]
        >();
        for (const application of mappedApps) {
            combinedByKey.set(`application:${application.id}`, application);
        }
        for (const invite of mappedInvites) {
            combinedByKey.set(`invite:${invite.id}`, invite);
        }
        const sliced = pageCandidates
            .map((candidate) => combinedByKey.get(`${candidate.source}:${candidate.id}`))
            .filter((application): application is NonNullable<typeof application> => Boolean(application));
        const lastCandidate = pageCandidates.at(-1);
        const nextCursor = hasMore && lastCandidate
            ? Buffer.from(JSON.stringify({
                eventAt: lastCandidate.event_at.toISOString(),
                source: lastCandidate.source,
                id: lastCandidate.id,
                sortValue: lastCandidate.sort_value,
            }), 'utf8').toString('base64url')
            : null;

        const payload = {
            success: true,
            applications: sliced,
            hasMore,
            nextCursor,
        };
        const elapsedMs = Date.now() - startedAtMs;
        if (elapsedMs > 300) {
            console.info('[applications] getInboxApplicationsAction slow-path', {
                limit,
                cursor: Boolean(cursor),
                count: payload.applications.length,
                elapsedMs,
            });
        }
        return payload;
    } catch (error) {
        console.error('Failed to get inbox applications:', error);
        return { success: false, applications: [], hasMore: false };
    }
}

export async function getApplicationRequestHistory(limit: number = 80, cursor?: string): Promise<{
    success: boolean;
    items: ApplicationRequestHistoryItem[];
    hasMore: boolean;
    nextCursor: string | null;
    error?: string;
}> {
    try {
        const supabase = await createClient();
        const {
            data: { user },
        } = await supabase.auth.getUser();

        if (!user) return { success: false, items: [], hasMore: false, nextCursor: null, error: 'Not authenticated' };

        const parsedLimit = typeof limit === 'number' ? limit : Number(limit);
        const effectiveLimit = Number.isFinite(parsedLimit)
            ? Math.max(1, Math.min(Math.trunc(parsedLimit), 200))
            : 80;
        const cursorSeparator = cursor?.lastIndexOf('|') ?? -1;
        const cursorDate = cursorSeparator > 0 ? new Date(cursor!.slice(0, cursorSeparator)) : null;
        const cursorId = cursorSeparator > 0 ? cursor!.slice(cursorSeparator + 1) : null;
        const validCursor = cursorDate && !Number.isNaN(cursorDate.getTime()) && cursorId && isUuid(cursorId)
            ? { eventAt: cursorDate, id: cursorId }
            : null;
        const applicationEventAt = sql<Date>`CASE
            WHEN ${roleApplications.status} = 'pending' THEN ${roleApplications.createdAt}
            ELSE COALESCE(${roleApplications.decisionAt}, ${roleApplications.updatedAt})
        END`;

        const applicationPage = await db.query.roleApplications.findMany({
            where: and(
                or(eq(roleApplications.applicantId, user.id), eq(roleApplications.creatorId, user.id)),
                validCursor
                    ? sql`(${applicationEventAt}, ${roleApplications.id}) < (${validCursor.eventAt}, ${validCursor.id}::uuid)`
                    : undefined,
            ),
            with: {
                project: {
                    columns: { id: true, title: true, slug: true, ownerId: true },
                },
                role: {
                    columns: { role: true, title: true },
                },
                applicant: {
                    columns: { id: true, username: true, fullName: true, avatarUrl: true },
                },
            },
            columns: {
                id: true,
                applicantId: true,
                creatorId: true,
                status: true,
                createdAt: true,
                updatedAt: true,
                projectId: true,
            },
            orderBy: (apps, { desc }) => [desc(applicationEventAt), desc(apps.id)],
            limit: effectiveLimit + 1,
        });
        const hasMore = applicationPage.length > effectiveLimit;
        const applications = applicationPage.slice(0, effectiveLimit);

        if (applications.length === 0) return { success: true, items: [], hasMore: false, nextCursor: null };

        const decisionMap = await getDecisionMetadataMap(applications.map((app) => app.id));

        const creatorIds = [
            ...new Set(
                applications
                    .filter((app) => app.applicantId === user.id)
                    .map((app) => app.project?.ownerId || app.creatorId)
                    .filter((id): id is string => !!id),
            ),
        ];

        const creatorRows =
            creatorIds.length > 0
                ? await db.query.profiles.findMany({
                    where: inArray(profiles.id, creatorIds),
                    columns: { id: true, username: true, fullName: true, avatarUrl: true },
                })
                : [];

        const creatorsById = new Map(
            creatorRows.map((row) => [
                row.id,
                {
                    id: row.id,
                    username: row.username,
                    fullName: row.fullName,
                    avatarUrl: row.avatarUrl,
                },
            ]),
        );

        const items = applications
            .map<ApplicationRequestHistoryItem>((app) => {
                const isIncoming = app.creatorId === user.id && app.applicantId !== user.id;
                const decisionMeta = decisionMap.get(app.id);
                const decisionReasonRaw = decisionMeta?.reasonCode || null;
                const decisionReason = decisionReasonRaw
                    ? normalizeApplicationDecisionReason(decisionReasonRaw, 'other')
                    : null;
                const lifecycleStatus = resolveLifecycleStatus(app.status, decisionReason);
                const decisionTimestamp = decisionMeta?.decisionAt
                    ? new Date(decisionMeta.decisionAt)
                    : app.updatedAt;
                const roleTitle = app.role?.title || app.role?.role || 'Unknown Role';

                const counterpart = isIncoming
                    ? {
                        id: app.applicant?.id || app.applicantId,
                        username: app.applicant?.username || null,
                        fullName: app.applicant?.fullName || null,
                        avatarUrl: app.applicant?.avatarUrl || null,
                    }
                    : creatorsById.get(app.project?.ownerId || app.creatorId) || null;

                return {
                    id: app.id,
                    kind: 'application',
                    direction: isIncoming ? 'incoming' : 'outgoing',
                    status: lifecycleStatus,
                    decisionReason,
                    eventAt: (lifecycleStatus === 'pending' ? app.createdAt : decisionTimestamp).toISOString(),
                    createdAt: app.createdAt.toISOString(),
                    project: {
                        id: app.projectId,
                        title: app.project?.title || 'Unknown Project',
                        slug: app.project?.slug || null,
                    },
                    roleTitle,
                    user: counterpart,
                };
            })
            .sort((a, b) => {
                const byEvent = new Date(b.eventAt).getTime() - new Date(a.eventAt).getTime();
                return byEvent !== 0 ? byEvent : b.id.localeCompare(a.id);
            });

        const last = items.at(-1);
        return {
            success: true,
            items,
            hasMore,
            nextCursor: hasMore && last ? `${last.eventAt}|${last.id}` : null,
        };
    } catch (error) {
        console.error('Failed to load application request history:', error);
        return { success: false, items: [], hasMore: false, nextCursor: null, error: 'Failed to load history' };
    }
}

// ============================================================================
// ACCEPT PROPOSED ROLE CHANGE (Applicant only)
// ============================================================================
export async function acceptProposedRoleAction(
    applicationId: string,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('accept_proposed', 'anon', applicationId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'Unauthorized');
        }

        const acceptProposedRate = await consumeRateLimit(`applications:accept_proposed:${user.id}`, 20, 60);
        if (!acceptProposedRate.allowed) {
            return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many requests. Please wait a moment.');
        }

        const application = await db.query.roleApplications.findFirst({
            where: eq(roleApplications.id, applicationId),
            with: {
                project: { columns: { title: true, slug: true } },
                role: { columns: { title: true, role: true } },
            },
            columns: {
                id: true,
                applicantId: true,
                projectId: true,
                roleId: true,
                proposedRoleId: true,
                status: true,
                decisionBy: true,
            },
        });

        if (!application) return toApplicationFailure(traceId, 'NOT_FOUND', 'Application not found');

        if (application.applicantId !== user.id) {
            return toApplicationFailure(traceId, 'FORBIDDEN', 'Only the applicant can accept a proposed role change');
        }

        if (application.status !== 'proposed') {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'This application does not have a proposed role change to accept');
        }

        if (!application.proposedRoleId) {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'No proposed role found on this application');
        }

        // Verify if user is already a member of the project:
        const isMember = await db.query.projectMembers.findFirst({
            where: and(
                eq(projectMembers.projectId, application.projectId),
                eq(projectMembers.userId, user.id)
            ),
        });
        if (isMember) {
            return toApplicationFailure(traceId, 'ALREADY_MEMBER', 'You are already a member of this project');
        }

        const updatedProposedRoleId = application.proposedRoleId;
        let pRoleTitle = '';
        let channelId: string | null = null;
        await db.transaction(async (tx) => {
            await tx.execute(sql`
                SELECT id
                FROM ${projects}
                WHERE id = ${application.projectId}
                  AND deleted_at IS NULL
                FOR UPDATE
            `);
            const [proposedRole] = await tx
                .select()
                .from(projectOpenRoles)
                .where(eq(projectOpenRoles.id, updatedProposedRoleId))
                .for('update');

            if (!proposedRole) {
                throw new Error('Proposed role not found');
            }

            pRoleTitle = proposedRole.title || proposedRole.role || 'Role';

            if (proposedRole.filled >= proposedRole.count) {
                throw new Error('Proposed role is already full');
            }

            // Update application
            const transitioned = await tx
                .update(roleApplications)
                .set({
                    status: 'accepted',
                    roleId: updatedProposedRoleId,
                    proposedRoleId: null,
                    decisionAt: new Date(),
                    decisionBy: application.decisionBy || user.id,
                    decisionReasonCode: 'proposal_accepted_by_applicant',
                    decisionReasonText: 'Proposed role accepted by applicant.',
                    updatedAt: new Date(),
                })
                .where(and(
                    eq(roleApplications.id, applicationId),
                    eq(roleApplications.status, 'proposed'),
                ))
                .returning({ id: roleApplications.id });
            if (transitioned.length !== 1) {
                throw new Error('Application already processed');
            }
            await tx.insert(applicationEvents).values({
                applicationId,
                actorId: user.id,
                kind: 'proposal_accepted',
                fromStatus: 'proposed',
                toStatus: 'accepted',
                reasonCode: 'proposal_accepted_by_applicant',
                reasonText: 'Proposed role accepted by applicant.',
                metadata: { roleId: updatedProposedRoleId, applicationTraceId: traceId },
            });

            // Add project member
            await addProjectMemberInternal(tx, {
                projectId: application.projectId,
                userId: user.id,
                role: 'member',
                actorId: user.id,
                source: 'application_accept',
                roleId: updatedProposedRoleId,
                incrementRoleCapacity: true,
            });

            channelId = await applicationThread(tx, applicationId, user.id, 'Proposed role accepted by applicant.');
        });

        const slugOrId = application.project?.slug || application.projectId;
        revalidatePath(`/projects/${slugOrId}`);

        logger.metric('applications.apply_accepted', {
            module: 'applications',
            applicationId,
            projectId: application.projectId,
            roleId: updatedProposedRoleId,
            actorId: user.id,
            reasonCode: 'proposal_accepted_by_applicant',
            source: 'messages',
            applicationTraceId: traceId,
        });

        return toApplicationSuccess(traceId, { applicationId });
    } catch (error) {
        console.error('Failed to accept proposed role change:', error);
        if (error instanceof Error && error.message === 'Proposed role is already full') {
            return toApplicationFailure(traceId, 'ROLE_FULL', 'The proposed role has already been filled');
        }
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to accept proposed role change');
    }
}

// ============================================================================
// DECLINE PROPOSED ROLE CHANGE (Applicant only)
// ============================================================================
export async function declineProposedRoleAction(
    applicationId: string,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('decline_proposed', 'anon', applicationId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'Unauthorized');
        }

        const declineProposedRate = await consumeRateLimit(`applications:decline_proposed:${user.id}`, 20, 60);
        if (!declineProposedRate.allowed) {
            return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many requests. Please wait a moment.');
        }

        const application = await db.query.roleApplications.findFirst({
            where: eq(roleApplications.id, applicationId),
            with: {
                project: { columns: { title: true, slug: true } },
                role: { columns: { title: true, role: true } },
            },
            columns: {
                id: true,
                applicantId: true,
                projectId: true,
                roleId: true,
                status: true,
            },
        });

        if (!application) return toApplicationFailure(traceId, 'NOT_FOUND', 'Application not found');

        if (application.applicantId !== user.id) {
            return toApplicationFailure(traceId, 'FORBIDDEN', 'Only the applicant can decline a proposed role change');
        }

        if (application.status !== 'proposed') {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'This application does not have a proposed role change to decline');
        }

        let channelId: string | null = null;
        await db.transaction(async (tx) => {
            // Revert back to pending, clear proposedRoleId
            const transitioned = await tx
                .update(roleApplications)
                .set({
                    status: 'pending',
                    proposedRoleId: null,
                    decisionBy: null,
                    decisionAt: null,
                    decisionReasonCode: null,
                    decisionReasonText: null,
                    updatedAt: new Date(),
                })
                .where(and(
                    eq(roleApplications.id, applicationId),
                    eq(roleApplications.status, 'proposed'),
                ))
                .returning({ id: roleApplications.id });
            if (transitioned.length !== 1) {
                throw new Error('Application already processed');
            }
            await tx.insert(applicationEvents).values({
                applicationId,
                actorId: user.id,
                kind: 'proposal_declined',
                fromStatus: 'proposed',
                toStatus: 'pending',
                reasonCode: 'proposal_declined_by_applicant',
                reasonText: 'Applicant declined the proposed role change.',
                metadata: { applicationTraceId: traceId },
            });

            channelId = await applicationThread(tx, applicationId, user.id, 'Applicant declined the proposed role change. Reverted to original role application.');
        });

        const slugOrId = application.project?.slug || application.projectId;
        revalidatePath(`/projects/${slugOrId}`);

        logger.metric('applications.apply_reopened', {
            module: 'applications',
            applicationId,
            projectId: application.projectId,
            roleId: application.roleId || undefined,
            actorId: user.id,
            source: 'messages',
            applicationTraceId: traceId,
        });

        return toApplicationSuccess(traceId, { applicationId });
    } catch (error) {
        console.error('Failed to decline proposed role change:', error);
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to decline proposed role change');
    }
}

// ============================================================================
// GET PROJECT INVITE OPTIONS (For Lead Invite Modal)
// ============================================================================
export async function getProjectInviteOptionsAction(projectId: string): Promise<{
    success: boolean;
    error?: string;
    connections: {
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
        headline: string | null;
        pendingApplicationId: string | null;
        pendingApplicationRoleId: string | null;
        pendingApplicationRoleTitle: string | null;
        pendingInvitations: { id: string; roleId: string | null; roleTitle: string | null }[];
    }[];
    openRoles: {
        id: string;
        title: string;
        role: string;
        filled: number;
        count: number;
    }[];
}> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return { success: false, error: 'Unauthorized', connections: [], openRoles: [] };

        const [project] = await db
            .select({ ownerId: projects.ownerId })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);
        if (!project) return { success: false, error: 'Project not found', connections: [], openRoles: [] };
        if (project.ownerId !== user.id) {
            const [membership] = await db
                .select({ role: projectMembers.role })
                .from(projectMembers)
                .where(and(eq(projectMembers.projectId, projectId), eq(projectMembers.userId, user.id)))
                .limit(1);
            if (membership?.role !== 'admin') return { success: false, error: 'Forbidden', connections: [], openRoles: [] };
        }

        // 1. Fetch project open roles that are not fully filled
        const openRoles = await db.query.projectOpenRoles.findMany({
            where: and(
                eq(projectOpenRoles.projectId, projectId),
                sql`${projectOpenRoles.filled} < ${projectOpenRoles.count}`
            ),
            columns: { id: true, title: true, role: true, filled: true, count: true },
            orderBy: [asc(projectOpenRoles.title), asc(projectOpenRoles.id)],
            limit: 50,
        });

        // 4. Fetch accepted connections, excluding existing members in SQL rather than copying the team into memory.
        const connectionRows = await db
            .select({
                id: connections.id,
                requesterId: connections.requesterId,
                addresseeId: connections.addresseeId,
                profileId: profiles.id,
                username: profiles.username,
                fullName: profiles.fullName,
                avatarUrl: profiles.avatarUrl,
                headline: profiles.headline,
            })
            .from(connections)
            .innerJoin(
                profiles,
                or(
                    and(
                        eq(connections.requesterId, user.id),
                        eq(connections.addresseeId, profiles.id)
                    ),
                    and(
                        eq(connections.addresseeId, user.id),
                        eq(connections.requesterId, profiles.id)
                    )
                )
            )
            .where(
                and(
                    eq(connections.status, 'accepted'),
                    or(eq(connections.requesterId, user.id), eq(connections.addresseeId, user.id)),
                    ne(profiles.id, project.ownerId),
                    notExists(db
                        .select({ id: projectMembers.id })
                        .from(projectMembers)
                        .where(and(
                            eq(projectMembers.projectId, projectId),
                            eq(projectMembers.userId, profiles.id),
                        )))
                )
            )
            .orderBy(asc(profiles.fullName), asc(profiles.id))
            .limit(20);

        const candidateIds = connectionRows.map((row) => row.profileId);
        const [pendingApps, pendingInvites] = candidateIds.length > 0
            ? await Promise.all([
                db.select({
                    id: roleApplications.id,
                    applicantId: roleApplications.applicantId,
                    roleId: roleApplications.roleId,
                    roleTitle: projectOpenRoles.title,
                })
                    .from(roleApplications)
                    .leftJoin(projectOpenRoles, eq(projectOpenRoles.id, roleApplications.roleId))
                    .where(and(
                        eq(roleApplications.projectId, projectId),
                        eq(roleApplications.status, 'pending'),
                        inArray(roleApplications.applicantId, candidateIds),
                    )),
                db.select({
                    id: projectInvitations.id,
                    assigneeUserId: projectInvitations.candidateId,
                    roleId: projectInvitations.roleId,
                    roleTitle: projectInvitations.roleTitle,
                })
                    .from(projectInvitations)
                    .where(and(
                        eq(projectInvitations.projectId, projectId),
                        eq(projectInvitations.status, 'pending'),
                        inArray(projectInvitations.candidateId, candidateIds),
                    )),
            ])
            : [[], []];
        const pendingAppsByApplicant = new Map(pendingApps.map((app) => [app.applicantId, app]));
        const pendingInvitesByAssignee = new Map<string, Array<{ id: string; roleId: string | null; roleTitle: string | null }>>();
        for (const invite of pendingInvites) {
            if (!invite.assigneeUserId) continue;
            const list = pendingInvitesByAssignee.get(invite.assigneeUserId) ?? [];
            list.push({ id: invite.id, roleId: invite.roleId, roleTitle: invite.roleTitle });
            pendingInvitesByAssignee.set(invite.assigneeUserId, list);
        }

        // Map the already-filtered candidates.
        const filteredConnections = connectionRows
            .map((row) => {
                const pendingApp = pendingAppsByApplicant.get(row.profileId);
                const connectionPendingInvites = pendingInvitesByAssignee.get(row.profileId) || [];
                return {
                    id: row.profileId,
                    username: row.username,
                    fullName: row.fullName,
                    avatarUrl: row.avatarUrl,
                    headline: row.headline,
                    pendingApplicationId: pendingApp?.id || null,
                    pendingApplicationRoleId: pendingApp?.roleId || null,
                    pendingApplicationRoleTitle: pendingApp?.roleTitle || null,
                    pendingInvitations: connectionPendingInvites,
                };
            });

        return {
            success: true,
            connections: filteredConnections,
            openRoles: openRoles.map((r) => ({
                id: r.id,
                title: r.title || r.role || 'Role',
                role: r.role || 'member',
                filled: r.filled || 0,
                count: r.count || 0,
            })),
        };
    } catch (error) {
        console.error('Failed to fetch project invite options:', error);
        return { success: false, error: 'Internal server error', connections: [], openRoles: [] };
    }
}

export interface SentProjectInvitationItem {
    id: string;
    invitationId?: string | null;
    projectId: string;
    projectTitle: string;
    projectSlug?: string | null;
    roleTitle: string;
    candidate: PersonCardDetails & {
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
        headline?: string | null;
    };
    note?: string | null;
    status: 'pending';
    createdAt: Date;
    expiresAt?: Date | null;
}

export async function getSentProjectInvitationsAction(options?: { limit?: number }) {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return {
                success: false as const,
                error: 'Unauthorized',
                invitations: [] as SentProjectInvitationItem[],
            };
        }

        const limit = Math.max(1, Math.min(options?.limit ?? 50, 100));

        // Pending invitations this user sent (canonical table).
        const directItems = await db
            .select({
                id: projectInvitations.id,
                projectId: projectInvitations.projectId,
                roleTitle: projectInvitations.roleTitle,
                guidanceLabel: projectInvitations.guidanceLabel,
                note: projectInvitations.note,
                createdAt: projectInvitations.createdAt,
                expiresAt: projectInvitations.expiresAt,
                candidateId: profiles.id,
                candidateUsername: profiles.username,
                candidateFullName: profiles.fullName,
                candidateAvatarUrl: profiles.avatarUrl,
                candidateHeadline: profiles.headline,
                projectTitle: projects.title,
                projectSlug: projects.slug,
            })
            .from(projectInvitations)
            .innerJoin(profiles, eq(profiles.id, projectInvitations.candidateId))
            .innerJoin(projects, eq(projects.id, projectInvitations.projectId))
            .where(
                and(
                    eq(projectInvitations.inviterId, user.id),
                    eq(projectInvitations.status, 'pending'),
                    sql`${projectInvitations.expiresAt} > now()`,
                    isNull(projects.deletedAt),
                    isNull(profiles.deletedAt),
                )
            )
            .orderBy(desc(projectInvitations.createdAt))
            .limit(limit);

        const items: SentProjectInvitationItem[] = [];
        for (const direct of directItems) {
            items.push({
                id: direct.id,
                invitationId: direct.id,
                projectId: direct.projectId,
                projectTitle: direct.projectTitle,
                projectSlug: direct.projectSlug,
                roleTitle: direct.roleTitle || direct.guidanceLabel || 'Collaborator',
                candidate: {
                    id: direct.candidateId,
                    username: direct.candidateUsername,
                    fullName: direct.candidateFullName,
                    avatarUrl: direct.candidateAvatarUrl,
                    headline: direct.candidateHeadline,
                },
                note: direct.note,
                status: 'pending',
                createdAt: direct.createdAt,
                expiresAt: direct.expiresAt,
            });
        }

        items.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

        return {
            success: true as const,
            invitations: await (async () => {
                const page = items.slice(0, limit);
                const details = await readPersonCardDetails(user.id, page.map(item => item.candidate.id));
                return page.map(item => ({ ...item, candidate: { ...item.candidate, ...details[item.candidate.id] } })).filter(item => !item.candidate.isUnavailable);
            })(),
        };
    } catch (error) {
        console.error('Failed to fetch sent project invitations:', error);
        return {
            success: false as const,
            error: error instanceof Error ? error.message : 'Internal server error',
            invitations: [] as SentProjectInvitationItem[],
        };
    }
}

export async function cancelSentProjectInvitationAction(input: {
    invitationId?: string | null;
}) {
    const supabase = await createClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return { success: false as const, error: 'Unauthorized' };

    const { allowed } = await consumeRateLimit(`project-invitation-cancel:${user.id}`, 60, 60);
    if (!allowed) return { success: false as const, error: 'Too many requests. Please try again later.' };

    try {
        let didCancel = false;
        let cancelError: string | undefined;
        if (input.invitationId) {
            const res = await resolveProjectInvitationAction({
                invitationId: input.invitationId,
                action: 'cancel',
            });
            didCancel = res.success;
            if (!res.success) cancelError = res.error;
        }

        if (!didCancel) {
            return { success: false as const, error: cancelError || 'Failed to cancel project invitation' };
        }

        return { success: true as const };
    } catch (error) {
        return { success: false as const, error: error instanceof Error ? error.message : 'Failed to cancel project invitation' };
    }
}
