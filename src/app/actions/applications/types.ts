import type { ApplicationCoreStatus, ApplicationLifecycleStatus } from '@/lib/applications/status';
import type { ApplicationDecisionReasonCode } from '@/lib/applications/reasons';

export type ApplicationActionErrorCode =
    | 'UNAUTHORIZED'
    | 'INVALID_INPUT'
    | 'NOT_FOUND'
    | 'PROJECT_NOT_FOUND'
    | 'ROLE_NOT_FOUND'
    | 'ROLE_FULL'
    | 'ROLE_REMOVED'
    | 'PROJECT_CLOSED'
    | 'CAP_REACHED'
    | 'ALREADY_PENDING'
    | 'ALREADY_MEMBER'
    | 'ALREADY_PROCESSED'
    | 'INVALID_STATE'
    | 'COOLDOWN_ACTIVE'
    | 'RATE_LIMITED'
    | 'EDIT_WINDOW_EXPIRED'
    | 'REOPEN_WINDOW_EXPIRED'
    | 'FORBIDDEN'
    | 'INTERNAL_ERROR';

export type ApplicationActionOptions = {
    idempotencyKey?: string | null;
    applicationTraceId?: string | null;
    /** Apply and edit only: the form's portfolio link and availability. */
    details?: { portfolioUrl?: string; availability?: string } | null;
};

/** What a submit did: a new application, a revived one, an in-place edit, or nothing (already pending). */
export type ApplicationSubmitOutcome = 'submitted' | 'resubmitted' | 'updated' | 'already_pending';

export type ApplicationActionResult = {
    success: boolean;
    error?: string;
    errorCode?: ApplicationActionErrorCode;
    applicationId?: string;
    /** The application's private chat thread. */
    channelId?: string | null;
    applicationTraceId?: string;
    idempotent?: boolean;
    outcome?: ApplicationSubmitOutcome;
};

export type ApplicationStatusResult = {
    status: ApplicationCoreStatus;
    roleId?: string;
    roleTitle?: string;
    /** Durable project invitations include guidance appointments without a role id. */
    invitationKind?: 'ordinary_role' | 'guidance_appointment';
    invitationId?: string;
    decisionReason?: ApplicationDecisionReasonCode | null;
    lifecycleStatus?: ApplicationLifecycleStatus | 'none';
    canReapply?: boolean;
    waitTime?: string;
    updatedAt?: Date;
    membershipEnded?: boolean;
    applicationId?: string;
    proposedRoleId?: string;
    proposedRoleTitle?: string;
    /** The status could not be read: the card shows a retry, never an enabled Apply. */
    loadFailed?: boolean;
    /** The applicant's own submission, for the edit form. */
    message?: string | null;
    details?: { portfolioUrl?: string; availability?: string };
    /** The reviewer's reason in words, for the applicant. */
    decisionReasonText?: string | null;
    /** The application's private thread. */
    channelId?: string | null;
    /** When the applicant can still edit; absent once the window has closed. */
    editableUntil?: Date;
};

export type ApplicationCursorPaginationInput = {
    limit?: number;
    cursor?: string | null;
};

