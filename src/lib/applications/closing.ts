import { and, eq, inArray, notInArray, sql } from 'drizzle-orm';

import { applicationEvents, roleApplications } from '@/lib/db/schema';
import { postApplicationUpdate } from '@/lib/messaging/integrations';
import { APPLICATION_DECISION_REASON_TEMPLATES } from '@/lib/applications/reasons';

type Executor = any; // a drizzle db or transaction

export type ClosedApplication = { id: string; applicantId: string; roleId: string | null };
export type ClosingReason = 'project_closed' | 'role_removed' | 'role_filled';

const CLOSING_LINE: Record<ClosingReason, string> = {
    project_closed: 'closed this application: the project is no longer taking applications',
    role_removed: 'closed this application: the role was removed',
    role_filled: 'closed this application: the role was filled',
};

/**
 * Closes pending applications because of something that happened to the project, never to the applicant: the project
 * stopped taking applications, a role was removed, or a role filled up. Each one is declined with a system reason,
 * gets a line in its thread, and leaves the 20-pending cap. The caller notifies the applicants after it commits.
 */
export async function closePendingApplications(
    executor: Executor,
    params: {
        projectId: string;
        actorId: string;
        reason: ClosingReason;
        /** Only applications for these roles. */
        roleIds?: string[];
        /** Application IDs to exclude from closing (e.g. the one being accepted right now). */
        excludeApplicationIds?: string[];
        /** Only applications for roles that have no spots left (their count was lowered to what is filled). */
        filledRolesOnly?: boolean;
        source: string;
    },
): Promise<ClosedApplication[]> {
    if (params.roleIds && params.roleIds.length === 0) return [];
    const text = APPLICATION_DECISION_REASON_TEMPLATES[params.reason];
    const now = new Date();
    const closed = await executor
        .update(roleApplications)
        .set({ status: 'rejected', decisionAt: now, decisionBy: params.actorId, decisionReasonCode: params.reason, decisionReasonText: text, updatedAt: now })
        .where(and(
            eq(roleApplications.projectId, params.projectId),
            eq(roleApplications.status, 'pending'),
            params.roleIds ? inArray(roleApplications.roleId, params.roleIds) : undefined,
            params.excludeApplicationIds && params.excludeApplicationIds.length > 0
                ? notInArray(roleApplications.id, params.excludeApplicationIds)
                : undefined,
            params.filledRolesOnly
                ? sql`${roleApplications.roleId} IN (SELECT r.id FROM project_open_roles r WHERE r.project_id = ${params.projectId}::uuid AND r.filled >= r.count)`
                : undefined,
        ))
        .returning({ id: roleApplications.id, applicantId: roleApplications.applicantId, roleId: roleApplications.roleId });
    if (closed.length === 0) return [];
    await executor.insert(applicationEvents).values(
        closed.map((application: ClosedApplication) => ({
            applicationId: application.id,
            actorId: params.actorId,
            kind: 'rejected' as const,
            fromStatus: 'pending',
            toStatus: 'rejected',
            reasonCode: params.reason,
            reasonText: text,
            metadata: { source: params.source, roleId: application.roleId },
        })),
    );
    // Each applicant is told in their own thread (the card chip already flips live).
    for (const application of closed as ClosedApplication[]) {
        await postApplicationUpdate(executor, application.id, params.actorId, CLOSING_LINE[params.reason]);
    }
    return closed;
}

/**
 * Someone who joins the project another way (an invitation, being added) no longer needs their pending application:
 * it is closed as accepted, with a line saying so. The accept path itself is not affected (its application is already
 * decided by the time the member is added).
 */
export async function resolveApplicationsOnJoin(executor: Executor, params: { projectId: string; userId: string; actorId: string }) {
    const now = new Date();
    const resolved = await executor
        .update(roleApplications)
        .set({ status: 'accepted', decisionAt: now, decisionBy: params.actorId, decisionReasonCode: null, decisionReasonText: null, updatedAt: now })
        .where(and(
            eq(roleApplications.projectId, params.projectId),
            eq(roleApplications.applicantId, params.userId),
            eq(roleApplications.status, 'pending'),
        ))
        .returning({ id: roleApplications.id });
    for (const application of resolved as { id: string }[]) {
        await executor.insert(applicationEvents).values({
            applicationId: application.id,
            actorId: params.actorId,
            kind: 'accepted' as const,
            fromStatus: 'pending',
            toStatus: 'accepted',
            metadata: { source: 'joined_another_way' },
        });
        await postApplicationUpdate(executor, application.id, params.actorId, 'joined the project, so this application is closed');
    }
    return resolved.length;
}
