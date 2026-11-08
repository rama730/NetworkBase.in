export function resolveAuthPageErrorMessage(code: string | null | undefined): string | null {
    switch ((code || '').trim()) {
        case 'auth-code-error':
            return 'Google sign-in could not be completed. Try again. If you are developing locally, open the app on the same origin you started from.'
        case 'security-check':
            return 'The security check didn’t finish. Wait for it on this page, then choose Google or GitHub again.'
        default:
            return null
    }
}

/** Plain copy for provider errors people can act on; anything else passes through. */
export function toFriendlyAuthError(message: string | null | undefined, fallback: string): string {
    const text = (message || '').trim()
    if (/captcha/i.test(text)) return "The security check didn’t pass. Wait for a new check, then try again."
    if (/rate limit|too many requests|for security purposes/i.test(text)) return 'Too many attempts. Wait a minute and try again.'
    return text || fallback
}
