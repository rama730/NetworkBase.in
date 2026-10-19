type VerificationSubject = {
    email_confirmed_at?: unknown
    confirmed_at?: unknown
    app_metadata?: Record<string, unknown> | null
}

function hasTimestamp(value: unknown): boolean {
    return typeof value === 'string' && value.trim().length > 0
}

/**
 * SEC-003: a person can edit their own `user_metadata`, so it never proves anything. Verification is
 * the Auth-owned confirmation timestamp, or `app_metadata.email_verified`, which a database trigger on
 * auth.users keeps equal to "email_confirmed_at is set" and which the browser cannot write.
 */
export function isEmailVerified(subject: VerificationSubject | null | undefined): boolean {
    if (!subject) return false

    if (hasTimestamp(subject.email_confirmed_at) || hasTimestamp(subject.confirmed_at)) {
        return true
    }

    return subject.app_metadata?.email_verified === true
}
