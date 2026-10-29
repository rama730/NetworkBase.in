export const APPLICATION_DECISION_REASON_CODES = [
    'skills_mismatch',
    'role_filled',
    'project_closed',
    'role_removed',
    'availability',
    'experience',
    'other',
    'withdrawn_by_applicant',
    'reopened_by_reviewer',
] as const;

export type ApplicationDecisionReasonCode = (typeof APPLICATION_DECISION_REASON_CODES)[number];

const APPLICATION_DECISION_REASON_SET = new Set<string>(APPLICATION_DECISION_REASON_CODES);

export const APPLICATION_DECISION_REASON_TEMPLATES: Record<ApplicationDecisionReasonCode, string> = {
    skills_mismatch: 'Your skills are strong, but this role currently needs a closer stack match.',
    role_filled: 'This role has already been filled by another applicant.',
    project_closed: 'The workspace is no longer taking applications.',
    role_removed: 'The role was removed from the workspace.',
    availability: 'Current availability requirements do not align with the team schedule.',
    experience: 'We need deeper experience for this role at this stage of the workspace.',
    other: 'Thank you for applying. We are moving forward with another direction right now.',
    withdrawn_by_applicant: 'Application withdrawn by applicant.',
    reopened_by_reviewer: 'Application reopened for review.',
};

export function normalizeApplicationDecisionReason(
    value: unknown,
    fallback: ApplicationDecisionReasonCode = 'other'
): ApplicationDecisionReasonCode {
    if (typeof value !== 'string') return fallback;
    const normalized = value.trim().toLowerCase();
    if (!APPLICATION_DECISION_REASON_SET.has(normalized)) {
        return fallback;
    }
    return normalized as ApplicationDecisionReasonCode;
}

