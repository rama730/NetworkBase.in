export type OnboardingErrorCode =
    | 'NOT_AUTHENTICATED'
    | 'INVALID_INPUT'
    | 'RATE_LIMITED'
    | 'USERNAME_TAKEN'
    | 'USERNAME_INVALID'
    | 'USERNAME_RESERVED'
    | 'DRAFT_CONFLICT'
    | 'DB_ERROR'

export type OnboardingError = {
    code: OnboardingErrorCode
    message: string
    retryable?: boolean
}

export function onboardingError(
    code: OnboardingErrorCode,
    message: string,
    retryable = false
): OnboardingError {
    return { code, message, retryable }
}
