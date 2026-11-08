export function resolveAuthPageErrorMessage(code: string | null | undefined): string | null {
    switch ((code || '').trim()) {
        case 'google-failed':
            return 'Google sign-in didn’t finish. Try again.'
        case 'github-failed':
            return 'GitHub sign-in didn’t finish. Try again.'
        case 'link-expired':
            return 'That sign-in link has expired or was already used. Ask for a new code below.'
        case 'reset-link-expired':
            return 'That reset link has expired or was already used. Ask for a new one: the email also has a code that works on any device.'
        case 'auth-code-error':
            return 'Sign-in didn’t finish. Try again.'
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
