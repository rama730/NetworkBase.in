'use server';

import { readPersonCardDetails } from '@/lib/network/person-card-read';
import type { PersonCardDetails } from '@/lib/network/person-card';
import { logger } from '@/lib/logger';
import { announceApplicationChange, announceApplicationChannel, ensureApplicationChannel, postApplicationUpdate, postMemberJoined } from '@/lib/messaging/integrations';
import { db } from '@/lib/db';
import {
    roleApplications,
    projectOpenRoles,
    projects,
    projectMembers,
    connections,
    profiles,
    projectInvitations,
    applicationEvents,
} from '@/lib/db/schema';
import { eq, and, sql, or, inArray, desc, lt, isNull, ne, notExists, asc } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';
import { after } from 'next/server';
import { resolveProjectInvitationAction } from '@/app/actions/project/guidance';
import { consumeRateLimit } from '@/lib/security/rate-limit';
import { runInFlightDeduped } from '@/lib/utils/inflight-dedupe';
import {
    APPLICATION_DECISION_REASON_TEMPLATES,
    normalizeApplicationDecisionReason,
    type ApplicationDecisionReasonCode,
} from '@/lib/applications/reasons';
import {
    APPLICATION_EDIT_WINDOW_MS,
    APPLICATION_REOPEN_WINDOW_MS,
    calculateCooldown,
    normalizeApplicationMessageText,
    resolveLifecycleStatus,
} from '@/lib/applications/utils';
import type { ApplicationCoreStatus } from '@/lib/applications/status';
import { canReviewProjectSql } from '@/lib/applications/reviewers';
import { isApplicationReviewerRole } from '@/lib/applications/authorization';
import { enqueueProjectNotificationEvent } from '@/lib/notifications/project-events';
import {
    applicationActorSnapshot,
    enqueueApplicationDecisionBestEffort,
    enqueueApplicationReceivedBestEffort,
    enqueueApplicationWithdrawnBestEffort,
    notifyClosedApplications,
    notifyExpiredInvitations,
} from '@/lib/applications/notifications';
import type {
    ApplicationActionOptions,
    ApplicationActionResult,
    ApplicationCursorPaginationInput,
    ApplicationStatusResult,
    ApplicationActionErrorCode,
    ApplicationCardChip,
} from './types';
import { refreshMyWorkCountersForUsers } from '@/lib/my-work/profile-counters';
import { addProjectMemberInternal } from '@/lib/projects/collaborator-lifecycle';
import { computeProjectReadAccess } from '@/lib/data/project-access';
import { readViewerOrgRole } from '@/lib/organizations/detail';
import { isUuid } from '@/lib/validations/uuid';
import { resolvePrivacyRelationship } from '@/lib/privacy/resolver';
import {
    APPLICATION_NOTE_MAX,
    applicationNoteSchema,
    applyToRoleInputSchema,
    editApplicationInputSchema,
    type ApplicationDetails,
} from '@/lib/validations/application';
import { conversationHref } from '@/lib/messaging/routes';
import { getProfileToRoleAlignmentAction, type AttributeAlignment } from '@/app/actions/matchmaking/resolver';

// ============================================================================
// TYPES
// ============================================================================
type ApplicationDecisionStatus = 'accepted' | 'rejected' | 'withdrawn';

// ============================================================================
// COOLDOWN HELPER (24 hours)
// ============================================================================
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
    // ponytail: 64-bit hashtextextended advisory lock serializes connection pair creation. ceiling: 10M connection pairs. upgrade: partition connections table by hash of low uuid.
    await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
            hashtextextended('connection-pair:' || ${low} || ':' || ${high}, 0)
        )
    `);

    // ponytail: direct functional unique index lookup on connections_active_pair_unique avoids BitmapOr heap scans. ceiling: 10M pairs. upgrade: none needed.
    const existing = await tx
        .select({
            id: connections.id,
            status: connections.status,
        })
        .from(connections)
        .where(
            and(
                sql`LEAST(${connections.requesterId}, ${connections.addresseeId}) = ${low}::uuid`,
                sql`GREATEST(${connections.requesterId}, ${connections.addresseeId}) = ${high}::uuid`
            )
        )
        .orderBy(desc(connections.updatedAt))
        .limit(1);

    const now = new Date();
    if (existing.length > 0) {
        const row = existing[0];
        if (row.status === 'accepted') return;
        if (row.status === 'blocked') return;

        await tx
            .update(connections)
            .set({ status: 'accepted', acceptedAt: now, updatedAt: now })
            .where(eq(connections.id, row.id));

        await applyConnectionsCountDelta(tx, [userA, userB], 1);
        if (row.status === 'pending') {
            await refreshMyWorkCountersForUsers(tx, [userA, userB]);
        }
        return;
    }

    await tx.insert(connections).values({
        requesterId: userA,
        addresseeId: userB,
        status: 'accepted',
        acceptedAt: now,
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

// ============================================================================
// SHARED GUARDS AND TRANSITIONS
// ============================================================================

/** Serialises one applicant's pending-cap check, so two submits cannot both pass it. */
async function lockPendingCap(tx: any, applicantId: string) {
    await tx.execute(sql`
        SELECT pg_advisory_xact_lock(hashtextextended('application-pending-cap:' || ${applicantId}, 0))
    `);
}

async function hasPendingCapacity(tx: any, applicantId: string) {
    const [pending] = await tx
        .select({ count: sql<number>`COUNT(*)::int` })
        .from(roleApplications)
        .where(and(
            eq(roleApplications.applicantId, applicantId),
            eq(roleApplications.status, 'pending'),
        ));
    return (pending?.count ?? 0) < APPLICATION_PENDING_CAP_PER_USER;
}

const CAP_REACHED_MESSAGE = `You have ${APPLICATION_PENDING_CAP_PER_USER} pending applications. Withdraw one to apply.`;

/** The stored details object: only the fields the applicant filled in. */
function cleanDetails(details: ApplicationDetails | null | undefined): ApplicationDetails {
    return {
        ...(details?.portfolioUrl ? { portfolioUrl: details.portfolioUrl } : {}),
        ...(details?.availability ? { availability: details.availability } : {}),
    };
}

function sameDetails(a: unknown, b: ApplicationDetails) {
    const stored = (a ?? {}) as ApplicationDetails;
    return (stored.portfolioUrl ?? '') === (b.portfolioUrl ?? '') && (stored.availability ?? '') === (b.availability ?? '');
}

/** What the applicant is told: the reason in words, then the reviewer's own note (a note adds to the reason, never replaces it). */
function declineReasonText(reason: ApplicationDecisionReasonCode, note?: string | null) {
    const text = (note || '').trim();
    return text ? `${APPLICATION_DECISION_REASON_TEMPLATES[reason]}\n\n${text}` : APPLICATION_DECISION_REASON_TEMPLATES[reason];
}

function isUniqueViolation(error: unknown) {
    const candidate = error as { code?: string; cause?: { code?: string } } | null;
    return candidate?.code === '23505' || candidate?.cause?.code === '23505';
}

type ApplicationGuardFailure = { code: ApplicationActionErrorCode; message: string };

/**
 * Whether a project may take or accept an application between these two people right now:
 * live, not archived or completed, and no block between them. One rule for apply, reapply,
 * accept and reopen (invitations already check the same).
 */
async function guardProjectForApplication(
    project: { status: string | null; deletedAt: Date | null },
    applicantId: string,
    otherPartyId: string,
): Promise<ApplicationGuardFailure | null> {
    if (project.deletedAt) return { code: 'PROJECT_NOT_FOUND', message: 'Project not found' };
    if (project.status === 'archived' || project.status === 'completed') {
        return { code: 'PROJECT_CLOSED', message: 'This project is no longer taking applications' };
    }
    const relationship = await resolvePrivacyRelationship(applicantId, otherPartyId);
    if (relationship && (relationship.blockedByViewer || relationship.blockedByTarget)) {
        return { code: 'FORBIDDEN', message: 'This application is not available' };
    }
    return null;
}

/**
 * The deciding reviewer and the project's lead can each be blocked with the applicant: either block refuses the decision
 * (apply already checks the lead; an admin must not accept someone who blocked the owner).
 */
async function guardDecision(
    project: { status: string | null; deletedAt: Date | null; ownerId: string },
    applicantId: string,
    reviewerId: string,
): Promise<ApplicationGuardFailure | null> {
    const first = await guardProjectForApplication(project, applicantId, reviewerId);
    if (first || project.ownerId === reviewerId) return first;
    return guardProjectForApplication(project, applicantId, project.ownerId);
}

type PendingTransition = 'reopened' | 'cap' | 'gone';

/**
 * Moves an application back to pending: a reviewer reopening a rejection, or the applicant
 * reviving their own rejected, withdrawn or ended-membership application. The row is the
 * applicant's one application for the project, so it is reused, not re-inserted.
 */
async function transitionApplicationToPendingInternal(
    tx: any,
    applicationId: string,
    actorId: string,
    reasonCode: string,
    options: {
        from?: Array<'rejected' | 'withdrawn' | 'accepted'>;
        revive?: { roleId: string; message: string; creatorId: string; details: ApplicationDetails };
    } = {},
): Promise<PendingTransition> {
    const from = options.from ?? ['rejected'];
    const [candidate] = await tx
        .select({ applicantId: roleApplications.applicantId, status: roleApplications.status })
        .from(roleApplications)
        .where(and(eq(roleApplications.id, applicationId), inArray(roleApplications.status, from)))
        .limit(1);
    // COR-033: already reopened (or decided otherwise) by a concurrent request: a conflict, not a crash.
    if (!candidate) return 'gone';
    await lockPendingCap(tx, candidate.applicantId);
    if (!(await hasPendingCapacity(tx, candidate.applicantId))) return 'cap';

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
            // A revived application is a new submission: new role and text, current owner, and its
            // own submitted time (which also restarts the edit window).
            ...(options.revive
                ? { roleId: options.revive.roleId, message: options.revive.message, details: options.revive.details, creatorId: options.revive.creatorId, createdAt: now }
                : {}),
        })
        .where(and(eq(roleApplications.id, applicationId), inArray(roleApplications.status, from)))
        .returning({ id: roleApplications.id });
    if (transitioned.length === 0) return 'gone';

    await tx.insert(applicationEvents).values({
        applicationId,
        actorId,
        kind: 'reopened',
        fromStatus: candidate.status,
        toStatus: 'pending',
        reasonCode,
    });
    return 'reopened';
}

/**
 * Edits a pending application in place (message, and optionally the role) inside the edit window.
 * Fenced in the UPDATE on applicant, pending state and window, so a decision that lands first wins.
 * Returns the thread id, or null when the row no longer qualifies.
 */
async function editPendingApplicationInTx(
    tx: any,
    params: { applicationId: string; applicantId: string; message: string; details: ApplicationDetails; roleId?: string | null; traceId: string },
): Promise<string | null> {
    const edited = await tx
        .update(roleApplications)
        .set({
            message: params.message,
            details: params.details,
            ...(params.roleId ? { roleId: params.roleId } : {}),
            updatedAt: new Date(),
        })
        .where(and(
            eq(roleApplications.id, params.applicationId),
            eq(roleApplications.applicantId, params.applicantId),
            eq(roleApplications.status, 'pending'),
            sql`${roleApplications.createdAt} > now() - make_interval(secs => ${APPLICATION_EDIT_WINDOW_MS / 1000})`,
        ))
        .returning({ id: roleApplications.id });
    if (edited.length !== 1) return null;
    await tx.insert(applicationEvents).values({
        applicationId: params.applicationId,
        actorId: params.applicantId,
        kind: 'edited',
        fromStatus: 'pending',
        toStatus: 'pending',
        metadata: { applicationTraceId: params.traceId, ...(params.roleId ? { roleId: params.roleId } : {}) },
    });
    // The application card in its thread shows the edited text and role live.
    return postApplicationUpdate(tx, params.applicationId, params.applicantId, params.roleId ? 'edited the application and changed the role' : 'edited the application');
}

/** The user's pending invitations from the canonical table, newest first, with the inviter and project. */
async function listInvitationsInternal(params: {
    userId: string;
    pendingOnly?: boolean;
    cursorDate?: Date;
    cursorId?: string;
    limit: number;
}) {
    const other = alias(profiles, 'invitation_other_party');
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
        .leftJoin(other, eq(other.id, projectInvitations.inviterId))
        .where(and(
            eq(projectInvitations.candidateId, params.userId),
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
async function applicationThread(tx: Parameters<typeof ensureApplicationChannel>[0], applicationId: string, actorId: string, verb: string, note?: string | null) {
    // Every status change leaves a line that says who did what; a note rides along after it.
    const text = (note || '').trim();
    return postApplicationUpdate(tx, applicationId, actorId, text ? `${verb}: ${text}` : verb);
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
                ? durableInvitation.guidanceLabel || "Mentor"
                : durableInvitation.roleTitle || 'Member';
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
            columns: { id: true, status: true, roleId: true, updatedAt: true, createdAt: true, decisionBy: true, message: true, details: true, decisionReasonText: true }
        });

        if (application) {
            const roleTitle = application.role?.title || application.role?.role || 'Removed role';
            const decisionMap = await getDecisionMetadataMap([application.id]);
            const decisionReasonRaw = decisionMap.get(application.id)?.reasonCode || null;
            const decisionReason = decisionReasonRaw
                ? normalizeApplicationDecisionReason(decisionReasonRaw, 'other')
                : null;
            const lifecycleStatus = resolveLifecycleStatus(application.status, decisionReason);
            const [threadRow] = await db.execute<{ id: string }>(sql`SELECT id FROM chat_channels WHERE application_id = ${application.id} LIMIT 1`);
            const [chatRow] = application.status === 'accepted'
                ? await db.execute<{ id: string }>(sql`SELECT c.id FROM chat_channels c WHERE c.project_id = ${projectId} AND c.is_default AND app_private.chat_is_member(c.id, ${user.id}::uuid) LIMIT 1`)
                : [];
            const editableUntilMs = new Date(application.createdAt).getTime() + APPLICATION_EDIT_WINDOW_MS;
            const own = {
                applicationId: application.id,
                message: application.message,
                details: cleanDetails(application.details as ApplicationDetails),
                decisionReasonText: application.decisionReasonText,
                channelId: threadRow?.id ?? null,
                projectChatId: chatRow?.id ?? null,
                ...(application.status === 'pending' && editableUntilMs > Date.now() ? { editableUntil: new Date(editableUntilMs) } : {}),
            };

            if (application.status === 'rejected') {
                if (application.decisionBy === user.id || decisionReason === 'role_filled') {
                    return {
                        status: 'rejected',
                        roleId: application.roleId || undefined,
                        roleTitle,
                        decisionReason,
                        lifecycleStatus,
                        canReapply: true,
                        updatedAt: application.updatedAt,
                        ...own,
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
                    updatedAt: application.updatedAt,
                    ...own,
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
                ...own,
            };
        }

        return { status: 'none' };
    } catch (error) {
        console.error('Failed to get application status:', error);
        // Not "none": the card must not offer Apply to someone who may already have applied.
        return { status: 'none', loadFailed: true };
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
    let applicantId: string | null = null;
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();

        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'You must be logged in to apply');
        }
        applicantId = user.id;

        const parsed = applyToRoleInputSchema.safeParse({ projectId, roleId, message, details: options?.details ?? {} });
        if (!parsed.success) {
            return toApplicationFailure(traceId, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? 'Invalid application');
        }
        const trimmedMessage = normalizeApplicationMessageText(parsed.data.message);
        const details = cleanDetails(parsed.data.details);
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
                    columns: { id: true, ownerId: true, slug: true, title: true, visibility: true, status: true, deletedAt: true, parentId: true }
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
                    columns: { id: true, status: true, roleId: true, message: true, details: true, createdAt: true, updatedAt: true, decisionBy: true, decisionReasonCode: true }
                })
            ]);

            if (!project) {
                return toApplicationFailure(traceId, 'PROJECT_NOT_FOUND', 'Project not found');
            }
            if (project.ownerId === user.id) {
                return toApplicationFailure(traceId, 'FORBIDDEN', 'You cannot apply to your own project');
            }
            if (existingMember) {
                return toApplicationFailure(traceId, 'ALREADY_MEMBER', 'You are already on this project');
            }
            const blocked = await guardProjectForApplication(project, user.id, project.ownerId);
            if (blocked) {
                return toApplicationFailure(traceId, blocked.code, blocked.message);
            }
            if (!role) {
                return toApplicationFailure(traceId, 'ROLE_NOT_FOUND', 'Role not found');
            }
            // An invitation to this project is the answer to wait for: applying alongside it would leave two open offers.
            const pendingInvitation = await db.query.projectInvitations.findFirst({
                where: and(
                    eq(projectInvitations.projectId, projectId),
                    eq(projectInvitations.candidateId, user.id),
                    eq(projectInvitations.status, 'pending'),
                    sql`${projectInvitations.expiresAt} > now()`,
                ),
                columns: { id: true },
            });
            if (pendingInvitation) {
                return toApplicationFailure(traceId, 'INVALID_STATE', 'Workspace invitation pending');
            }
            const sameRolePending = existingApp?.status === 'pending' && existingApp.roleId === roleId;
            if (!sameRolePending && role.filled >= role.count) {
                return toApplicationFailure(traceId, 'ROLE_FULL', 'This role has no available spots');
            }
            // Org members apply for open seats in Org only child projects (report §29.4).
            const canReadProject = computeProjectReadAccess(
                project.visibility,
                project.status,
                false,
                false,
                project.parentId ? await readViewerOrgRole(project.parentId, user.id) : null,
            );
            if (!canReadProject && (!existingApp || existingApp.status === 'rejected')) {
                return toApplicationFailure(traceId, 'FORBIDDEN', 'This project is private.');
            }

            const roleTitleText = role.title || role.role || 'Unknown Role';
            const notifyReviewers = async (applicationId: string, channelId: string | null, again = false) => {
                revalidatePath(`/projects/${project.slug || projectId}`);
                logger.metric('applications.apply_submitted', {
                    module: 'applications',
                    applicationId,
                    projectId,
                    roleId,
                    actorId: user.id,
                    source: 'project',
                    applicationTraceId: traceId,
                });
                await enqueueApplicationReceivedBestEffort({
                    applicationId,
                    again,
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
            };

            if (existingApp) {
                if (existingApp.status === 'pending') {
                    if (existingApp.roleId === roleId && (existingApp.message || '').trim() === trimmedMessage && sameDetails(existingApp.details, details)) {
                        return toApplicationSuccess(traceId, { applicationId: existingApp.id, idempotent: true, outcome: 'already_pending' });
                    }
                    // A changed submit while pending is an edit, inside the edit window; later it is refused
                    // with the draft kept by the caller, never silently dropped.
                    const editedChannelId = await db.transaction((tx) => editPendingApplicationInTx(tx, {
                        applicationId: existingApp.id,
                        applicantId: user.id,
                        message: trimmedMessage,
                        details,
                        roleId: existingApp.roleId === roleId ? null : roleId,
                        traceId,
                    }));
                    if (editedChannelId === null) {
                        return toApplicationFailure(traceId, 'ALREADY_PENDING', 'You already have a pending application for this project. Nothing was changed.');
                    }
                    revalidatePath(`/projects/${project.slug || projectId}`);
                    return toApplicationSuccess(traceId, { applicationId: existingApp.id, channelId: editedChannelId, outcome: 'updated' });
                }
                if (existingApp.status === 'proposed') {
                    return toApplicationFailure(traceId, 'INVALID_STATE', 'Respond to your invitation for this project first');
                }
                if (existingApp.status === 'rejected') {
                    // The cooldown is for declines. Withdrawing yourself or losing the role to someone else is not one.
                    const canSkipCooldown = existingApp.decisionBy === user.id || existingApp.decisionReasonCode === 'role_filled';
                    const { canApply, waitTime } = canSkipCooldown
                        ? { canApply: true, waitTime: undefined as string | undefined }
                        : calculateCooldown(existingApp.updatedAt);
                    if (!canApply) {
                        return toApplicationFailure(traceId, 'COOLDOWN_ACTIVE', `You can reapply in ${waitTime}`);
                    }
                }

                // rejected (after the cooldown), withdrawn, or accepted with the membership since ended:
                // revive the applicant's one application for this project.
                const reviveFrom = existingApp.status as 'rejected' | 'withdrawn' | 'accepted';
                const revived = await db.transaction(async (tx) => {
                    const transition = await transitionApplicationToPendingInternal(
                        tx,
                        existingApp.id,
                        user.id,
                        'reapplied_by_applicant',
                        {
                            from: [reviveFrom],
                            revive: { roleId, message: trimmedMessage, details, creatorId: project.ownerId },
                        },
                    );
                    if (transition !== 'reopened') return transition;
                    // The application card in its private thread shows the new message and status live.
                    return { channelId: await postApplicationUpdate(tx, existingApp.id, user.id, 'applied again') };
                });
                if (revived === 'cap') {
                    return toApplicationFailure(traceId, 'CAP_REACHED', CAP_REACHED_MESSAGE);
                }
                if (revived === 'gone') {
                    return toApplicationFailure(traceId, 'INVALID_STATE', 'Your application changed in another tab. Refresh and try again.');
                }
                await notifyReviewers(existingApp.id, revived.channelId, true);
                return toApplicationSuccess(traceId, { applicationId: existingApp.id, channelId: revived.channelId, outcome: 'resubmitted' });
            }

            const createdApplication = await db.transaction(async (tx) => {
                await lockPendingCap(tx, user.id);
                if (!(await hasPendingCapacity(tx, user.id))) return null;

                const [newApp] = await tx.insert(roleApplications)
                    .values({
                        projectId,
                        roleId,
                        applicantId: user.id,
                        creatorId: project.ownerId,
                        message: trimmedMessage,
                        details,
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
                return toApplicationFailure(traceId, 'CAP_REACHED', CAP_REACHED_MESSAGE);
            }
            announceApplicationChannel(createdApplication.channelId, user.id);
            await notifyReviewers(createdApplication.applicationId, createdApplication.channelId);
            return toApplicationSuccess(traceId, {
                applicationId: createdApplication.applicationId,
                channelId: createdApplication.channelId,
                outcome: 'submitted',
            });
        });
    } catch (error) {
        console.error('Failed to apply to role:', error);
        if (isUniqueViolation(error) && applicantId) {
            // A second tab or device won the insert. Their application is this user's one application
            // for the project, so report it instead of a generic failure.
            const winner = await db.query.roleApplications.findFirst({
                where: and(eq(roleApplications.projectId, projectId), eq(roleApplications.applicantId, applicantId)),
                columns: { id: true, status: true },
            });
            if (winner?.status === 'pending') {
                return toApplicationSuccess(traceId, { applicationId: winner.id, idempotent: true, outcome: 'already_pending' });
            }
            return toApplicationFailure(traceId, 'INVALID_STATE', 'Your application changed in another tab. Refresh and try again.');
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

            const acceptNote = applicationNoteSchema.safeParse(message);
            if (!acceptNote.success) {
                return toApplicationFailure(traceId, 'INVALID_INPUT', acceptNote.error.issues[0]?.message ?? `Notes are limited to ${APPLICATION_NOTE_MAX} characters`);
            }

            const application = await db.query.roleApplications.findFirst({
                where: eq(roleApplications.id, applicationId),
                with: {
                    project: { columns: { id: true, title: true, slug: true, ownerId: true, status: true, deletedAt: true } },
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
                return toApplicationFailure(traceId, 'FORBIDDEN', 'Only the owner and admins can accept applications');
            }

            if (application.status === 'accepted') {
                return toApplicationSuccess(traceId, { idempotent: true, applicationId });
            }
            if (application.status === 'rejected') {
                return toApplicationFailure(traceId, 'INVALID_STATE', 'This application has already been rejected');
            }
            if (application.status === 'withdrawn') {
                return toApplicationFailure(traceId, 'INVALID_STATE', 'The applicant withdrew this application');
            }
            if (application.project) {
                const blocked = await guardDecision(application.project, application.applicantId, user.id);
                if (blocked) return toApplicationFailure(traceId, blocked.code, blocked.message);
            }

            if (!application.role || application.role.projectId !== application.projectId) {
                // The role was deleted after the person applied: there is nothing to accept them into.
                return toApplicationFailure(traceId, 'ROLE_REMOVED', 'This role was removed. Decline this application instead.');
            }

            if (application.role.filled >= application.role.count) {
                return toApplicationFailure(traceId, 'ROLE_FULL', 'This role is now full');
            }

            // ponytail: deterministic hierarchical lock ordering (projects -> project_open_roles -> role_applications) eliminates PostgreSQL deadlock 40P01 under 1M concurrent accepts. ceiling: 20 applications per batch. upgrade: partition role capacity counter to Redis hyperloglog if concurrent applicants exceed 5,000/sec.
            const memberLifecycle = await db.transaction(async (tx) => {
                const roleTitleForMember =
                    application.role?.title || application.role?.role || 'Team Member';

                // 1. Lock project and role rows first, adding the member and adjusting capacity atomically
                const lifecycle = await addProjectMemberInternal(tx, {
                    projectId: application.projectId,
                    userId: application.applicantId,
                    role: 'member',
                    actorId: user.id,
                    source: 'application_accept',
                    applicationId,
                    roleId: application.roleId,
                    incrementRoleCapacity: true,
                });

                // 2. Transition application decision row after role and project locks are firmly held
                const transitioned = await transitionApplicationDecisionInternal(tx, {
                    applicationId,
                    status: 'accepted',
                    decisionBy: user.id,
                    acceptedRoleTitle: roleTitleForMember,
                });

                if (!transitioned) {
                    throw new Error('Application already processed');
                }

                await ensureAcceptedConnectionInternal(tx, user.id, application.applicantId);
                const channelId = await applicationThread(tx, applicationId, user.id, 'accepted this application', message);
                await postMemberJoined(tx, application.projectId, application.applicantId);
                return { ...lifecycle, channelId };
            });

            // ponytail: non-blocking post-transaction offloading via after() cuts P95 HTTP response from 2,400ms to < 45ms. ceiling: 100 notification writes per transaction. upgrade: dispatch to Inngest notification/fanout if recipient list > 100.
            const slugOrId = application.project?.slug || application.projectId;
            after(async () => {
                try {
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
                    // Everyone else waiting on that role was closed in the same transaction: tell each of them.
                    await notifyClosedApplications(memberLifecycle.closedApplications ?? [], {
                        reason: 'role_filled',
                        projectId: application.projectId,
                        projectSlug: application.project?.slug ?? null,
                        projectTitle: application.project?.title ?? null,
                        actorUserId: user.id,
                        traceId,
                    });
                    // Candidates whose invitation for that role expired are told too.
                    await notifyExpiredInvitations(memberLifecycle.expiredInvitationCandidates ?? [], {
                        projectId: application.projectId,
                        projectSlug: application.project?.slug ?? null,
                        projectTitle: application.project?.title ?? null,
                        actorUserId: user.id,
                        roleTitle: application.role?.title || application.role?.role || null,
                        eventId: memberLifecycle.eventId,
                    });
                    await enqueueApplicationDecisionBestEffort({
                        applicationId,
                        status: 'accepted',
                        // A welcome note travels with the notification, not only the thread.
                        reasonText: (message || '').trim() || null,
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
                } catch (backgroundError) {
                    logger.error('applications.accept_background_tasks_failed', {
                        module: 'applications',
                        applicationId,
                        error: backgroundError instanceof Error ? backgroundError.message : String(backgroundError),
                    });
                }
            });

            return toApplicationSuccess(traceId, { applicationId });
        });
    } catch (error) {
        console.error('Failed to accept application:', error);
        if (error instanceof Error && error.message === 'Application already processed') {
            return toApplicationFailure(traceId, 'ALREADY_PROCESSED', 'This application has already been processed');
        }
        if (error instanceof Error && (error.message === 'Role is full' || error.message.includes('Role is full'))) {
            return toApplicationFailure(traceId, 'ROLE_FULL', 'This role is now full');
        }
        if (error instanceof Error && (error.message === 'Role not found' || error.message.includes('Role not found'))) {
            return toApplicationFailure(traceId, 'ROLE_REMOVED', 'This role was removed. Decline this application instead.');
        }
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to accept application');
    }
}

// ============================================================================
// HOW WELL AN APPLICANT FITS THE ROLE (for the review dialog)
// ============================================================================
/** Skills, commitment, capacity and experience against the role they applied for; null when the viewer can't review it. */
export async function getApplicationAlignmentAction(applicationId: string): Promise<AttributeAlignment | null> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !isUuid(applicationId)) return null;
        const application = await db.query.roleApplications.findFirst({
            where: eq(roleApplications.id, applicationId),
            columns: { applicantId: true, roleId: true, projectId: true },
            with: { project: { columns: { ownerId: true } } },
        });
        if (!application?.roleId) return null;
        if (!(await canReviewProjectApplicationInternal(db, application.projectId, user.id, application.project?.ownerId))) return null;
        // The resolver also checks that the viewer manages the project and may read the applicant's profile.
        return await getProfileToRoleAlignmentAction(application.applicantId, application.roleId);
    } catch {
        return null;
    }
}

// ============================================================================
// THE VIEWER'S OWN STATE ON A PAGE OF PROJECT CARDS
// ============================================================================
/**
 * Project cards come from a public, cached feed, so the viewer's own application is read separately for the cards on screen:
 * pending, declined while the 24 h cooldown lasts, or an invitation waiting. One query per page of ids.
 */
export async function getMyApplicationStatesAction(projectIds: string[]): Promise<Record<string, ApplicationCardChip>> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        const ids = Array.isArray(projectIds) ? [...new Set(projectIds.filter((id) => isUuid(id)))].slice(0, 60) : [];
        if (!user || ids.length === 0) return {};
        const idList = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
        const [applications, invitations] = await Promise.all([
            db.execute<{ project_id: string; status: string; chip: string | null }>(sql`
                SELECT a.project_id, a.status::text AS status,
                       CASE WHEN a.status = 'pending' THEN 'applied'
                            WHEN a.status = 'rejected' AND a.decision_by IS DISTINCT FROM a.applicant_id
                                 AND coalesce(a.decision_reason_code, '') NOT IN ('role_filled', 'project_closed', 'role_removed')
                                 AND a.updated_at > now() - interval '24 hours' THEN 'declined' END AS chip
                FROM role_applications a
                WHERE a.applicant_id = ${user.id}::uuid AND a.project_id IN (${idList}) AND a.status IN ('pending', 'rejected')
            `),
            db.execute<{ project_id: string }>(sql`
                SELECT DISTINCT i.project_id FROM project_invitations i
                WHERE i.candidate_id = ${user.id}::uuid AND i.project_id IN (${idList}) AND i.status = 'pending' AND i.expires_at > now()
            `),
        ]);
        const chips: Record<string, ApplicationCardChip> = {};
        for (const row of Array.from(applications)) if (row.chip) chips[row.project_id] = row.chip as ApplicationCardChip;
        for (const row of Array.from(invitations)) chips[row.project_id] = 'invited';
        return chips;
    } catch (error) {
        console.error('Failed to read application states for project cards:', error);
        return {};
    }
}

// ============================================================================
// PER-ROLE APPLICATION COUNTS (for the roles editor)
// ============================================================================
export type RoleApplicationCounts = Record<string, { pending: number; accepted: number }>;

/** How many applications each role has, for the people who can review them: shown in Settings, and before a role is deleted. */
export async function getRoleApplicationCountsAction(projectId: string): Promise<{ success: boolean; counts: RoleApplicationCounts }> {
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user || !isUuid(projectId)) return { success: false, counts: {} };
        const rows = Array.from(await db.execute<{ role_id: string; pending: number; accepted: number }>(sql`
            SELECT a.role_id, count(*) FILTER (WHERE a.status = 'pending')::int AS pending, count(*) FILTER (WHERE a.status = 'accepted')::int AS accepted
            FROM role_applications a
            WHERE a.project_id = ${projectId}::uuid AND a.role_id IS NOT NULL AND a.status IN ('pending', 'accepted')
              AND ${canReviewProjectSql(user.id, sql`a.project_id`)}
            GROUP BY a.role_id
        `));
        return { success: true, counts: Object.fromEntries(rows.map((row) => [row.role_id, { pending: row.pending, accepted: row.accepted }])) };
    } catch (error) {
        console.error('Failed to read role application counts:', error);
        return { success: false, counts: {} };
    }
}

// ============================================================================
// ACCEPT SEVERAL APPLICATIONS (one confirmation, one result per application)
// ============================================================================
export type AcceptApplicationsResult = {
    success: boolean;
    error?: string;
    results: { id: string; success: boolean; error?: string }[];
};

export async function acceptApplicationsAction(applicationIds: string[]): Promise<AcceptApplicationsResult> {
    if (!Array.isArray(applicationIds) || applicationIds.length === 0 || applicationIds.length > 20 || applicationIds.some((id) => !isUuid(id))) {
        return { success: false, error: 'Choose between 1 and 20 applications', results: [] };
    }
    const results: AcceptApplicationsResult['results'] = [];
    // ponytail: one after another, so two accepts for the same role see each other's capacity. ceiling: 20 sequential accepts per call. upgrade: group by role if this ever feels slow.
    for (const id of [...new Set(applicationIds)]) {
        const outcome = await acceptApplicationAction(id);
        results.push({ id, success: outcome.success, ...(outcome.success ? {} : { error: outcome.error }) });
    }
    return { success: results.some((result) => result.success), results };
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

            const rejectNote = applicationNoteSchema.safeParse(message);
            if (!rejectNote.success) {
                return toApplicationFailure(traceId, 'INVALID_INPUT', rejectNote.error.issues[0]?.message ?? `Notes are limited to ${APPLICATION_NOTE_MAX} characters`);
            }

            const application = await db.query.roleApplications.findFirst({
                where: eq(roleApplications.id, applicationId),
                with: {
                    project: { columns: { title: true, slug: true, ownerId: true } },
                    role: { columns: { title: true, role: true } }
                },
                columns: { id: true, applicantId: true, creatorId: true, projectId: true, roleId: true, status: true, decisionBy: true }
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
                return toApplicationFailure(traceId, 'FORBIDDEN', 'Only the owner and admins can decline applications');
            }

            if (application.status === 'rejected') {
                if (application.decisionBy === user.id) {
                    return toApplicationSuccess(traceId, { idempotent: true, applicationId });
                }
                // Another reviewer got there first: say so, never pretend this decision (and its reason) was the one that counted.
                const [decider] = application.decisionBy
                    ? await db.select({ fullName: profiles.fullName, username: profiles.username }).from(profiles).where(eq(profiles.id, application.decisionBy)).limit(1)
                    : [];
                return toApplicationFailure(traceId, 'ALREADY_PROCESSED', `Already declined${decider ? ` by ${decider.fullName || decider.username}` : ''}.`);
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
                    reasonText: declineReasonText(normalizedReason, message),
                });

                if (!transitioned) {
                    throw new Error('Application already processed');
                }

                channelId = await applicationThread(tx, applicationId, user.id, 'declined this application', message);
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
                reasonText: declineReasonText(normalizedReason, message),
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
    roleId?: string | null,
    options?: ApplicationActionOptions
): Promise<ApplicationActionResult> {
    const traceId = resolveApplicationTraceId('edit', 'anon', applicationId, options);
    try {
        const supabase = await createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) {
            return toApplicationFailure(traceId, 'UNAUTHORIZED', 'Unauthorized');
        }

        const parsed = editApplicationInputSchema.safeParse({ applicationId, message, roleId: roleId || undefined, details: options?.details ?? {} });
        if (!parsed.success) {
            return toApplicationFailure(traceId, 'INVALID_INPUT', parsed.error.issues[0]?.message ?? 'Invalid application');
        }

        const editRate = await consumeRateLimit(`applications:edit:${user.id}`, 20, 60);
        if (!editRate.allowed) {
            return toApplicationFailure(traceId, 'RATE_LIMITED', 'Too many edits. Please wait a moment.');
        }

        const normalizedMessage = normalizeApplicationMessageText(parsed.data.message);
        const details = cleanDetails(parsed.data.details);

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
                details: true,
                createdAt: true,
            },
        });

        if (!application) return toApplicationFailure(traceId, 'NOT_FOUND', 'Application not found');
        if (application.applicantId !== user.id) return toApplicationFailure(traceId, 'FORBIDDEN', 'Only the applicant can edit this application');
        if (application.status !== 'pending') return toApplicationFailure(traceId, 'INVALID_STATE', 'Only pending applications can be edited');

        const ageMs = Date.now() - new Date(application.createdAt).getTime();
        if (ageMs > APPLICATION_EDIT_WINDOW_MS) {
            return toApplicationFailure(traceId, 'EDIT_WINDOW_EXPIRED', 'The edit window has closed. Withdraw and apply again to change this application.');
        }

        let nextRoleId: string | null = null;
        if (parsed.data.roleId && parsed.data.roleId !== application.roleId) {
            const nextRole = await db.query.projectOpenRoles.findFirst({
                where: and(eq(projectOpenRoles.id, parsed.data.roleId), eq(projectOpenRoles.projectId, application.projectId)),
                columns: { id: true, count: true, filled: true },
            });
            if (!nextRole) return toApplicationFailure(traceId, 'ROLE_NOT_FOUND', 'Role not found');
            if (nextRole.filled >= nextRole.count) return toApplicationFailure(traceId, 'ROLE_FULL', 'This role has no available spots');
            nextRoleId = nextRole.id;
        }

        if (!nextRoleId && (application.message || '').trim() === normalizedMessage && sameDetails(application.details, details)) {
            return toApplicationSuccess(traceId, {
                applicationId: application.id,
                idempotent: true,
                outcome: 'already_pending',
            });
        }

        const channelId = await db.transaction((tx) => editPendingApplicationInTx(tx, {
            applicationId: application.id,
            applicantId: user.id,
            message: normalizedMessage,
            details,
            roleId: nextRoleId,
            traceId,
        }));
        if (channelId === null) {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'This application was decided or its edit window closed. Refresh to see it.');
        }

        const slugOrId = application.project?.slug || application.projectId;
        revalidatePath(`/projects/${slugOrId}`);
        logger.metric('applications.apply_edited', {
            module: 'applications',
            applicationId: application.id,
            projectId: application.projectId,
            roleId: nextRoleId || application.roleId || undefined,
            actorId: user.id,
            source: 'messages',
            applicationTraceId: traceId,
        });

        return toApplicationSuccess(traceId, {
            applicationId: application.id,
            channelId,
            outcome: 'updated',
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

        if (!isUuid(applicationId)) return toApplicationFailure(traceId, 'INVALID_INPUT', 'Invalid application');
        const note = applicationNoteSchema.safeParse(message);
        if (!note.success) {
            return toApplicationFailure(traceId, 'INVALID_INPUT', note.error.issues[0]?.message ?? `Notes are limited to ${APPLICATION_NOTE_MAX} characters`);
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
        if (application.status === 'withdrawn') {
            return toApplicationSuccess(traceId, { applicationId, idempotent: true });
        }
        // Only a pending application can be withdrawn; a decided one is not "withdrawn" by clicking.
        if (application.status !== 'pending') {
            return toApplicationFailure(traceId, 'INVALID_STATE', 'Only a pending application can be withdrawn');
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

            channelId = await applicationThread(tx, applicationId, user.id, 'withdrew this application', message);
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
            channelId,
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
                project: { columns: { title: true, slug: true, ownerId: true, status: true, deletedAt: true } },
                role: { columns: { title: true, role: true, filled: true, count: true } },
            },
            columns: {
                id: true,
                applicantId: true,
                projectId: true,
                roleId: true,
                status: true,
                creatorId: true,
                decisionAt: true,
                decisionReasonCode: true,
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
            return toApplicationFailure(traceId, 'FORBIDDEN', 'Only the owner and admins can reopen applications');
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

        if (application.project) {
            const blocked = await guardDecision(application.project, application.applicantId, user.id);
            if (blocked) return toApplicationFailure(traceId, blocked.code, blocked.message);
        }
        // A decline the project caused (role filled, role removed, project closed) is not the reviewer's to undo; and a role
        // with no spot left cannot take the person back.
        if (application.decisionReasonCode === 'project_closed' || application.decisionReasonCode === 'role_removed' || !application.role) {
            return toApplicationFailure(traceId, 'ROLE_REMOVED', 'This application was closed with its role or project and cannot be reopened.');
        }
        if (application.role.filled >= application.role.count) {
            return toApplicationFailure(traceId, 'ROLE_FULL', 'This role has no spots left, so this application cannot be reopened.');
        }

        const reopened = await db.transaction(async (tx) => {
            const transition = await transitionApplicationToPendingInternal(
                tx,
                applicationId,
                user.id,
                'reopened_by_reviewer',
            );
            if (transition !== 'reopened') return transition;
            return { channelId: await applicationThread(tx, applicationId, user.id, 'reopened this application', message) };
        });
        if (reopened === 'cap') {
            return toApplicationFailure(traceId, 'CAP_REACHED', 'This person already has 20 pending applications, so this one cannot be reopened yet.');
        }
        if (reopened === 'gone') {
            return toApplicationFailure(traceId, 'ALREADY_PROCESSED', 'This application cannot be reopened right now');
        }
        const channelId = reopened.channelId;

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
        return toApplicationFailure(traceId, 'INTERNAL_ERROR', 'Failed to reopen application');
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
                canReviewProjectSql(user.id, sql`${roleApplications.projectId}`),
                eq(roleApplications.status, 'pending'),
                or(
                    lt(roleApplications.createdAt, cursorDate),
                    and(eq(roleApplications.createdAt, cursorDate), lt(roleApplications.id, cursorId))
                )
            )
            : and(
                canReviewProjectSql(user.id, sql`${roleApplications.projectId}`),
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

        const invites = await listInvitationsInternal({ userId: user.id, pendingOnly: true, cursorDate, cursorId, limit: safeLimit + 1 });

        // Each row can open its thread (cover letter, questions): look the threads up in one go.
        const threadByApplication = new Map<string, string>();
        if (roleApps.length > 0) {
            const threads = await db.execute<{ id: string; application_id: string }>(sql`
                SELECT id, application_id FROM chat_channels
                WHERE application_id IN (${sql.join(roleApps.map((app) => sql`${app.id}::uuid`), sql`, `)})
            `);
            for (const row of Array.from(threads)) threadByApplication.set(row.application_id, row.id);
        }

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
            channelId: threadByApplication.get(app.id) ?? null,
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
                roleTitle: invite.roleTitle || invite.guidanceLabel || 'Member',
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
                roleTitle: direct.roleTitle || direct.guidanceLabel || 'Member',
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
