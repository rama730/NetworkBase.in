/** How this browser last signed in, so the sign-in page can mark that way "Last used". Kept only in this browser. */
export type SignInMethod = 'google' | 'github' | 'password' | 'code'
export const LAST_SIGN_IN_KEY = 'nb_last_sign_in'
/** A way of signing in not used for three months is no longer "last used": it would only be guessing. */
export const LAST_SIGN_IN_TTL_MS = 90 * 24 * 60 * 60 * 1000
const METHODS: readonly SignInMethod[] = ['google', 'github', 'password', 'code']

/** The stored value: the method and when, or (saved before the date was kept) just the method. */
export function parseLastSignIn(raw: string | null | undefined, now: number): SignInMethod | null {
    if (!raw) return null
    if (METHODS.includes(raw as SignInMethod)) return raw as SignInMethod
    try {
        const value = JSON.parse(raw) as { method?: unknown; at?: unknown } | null
        if (!value || typeof value.at !== 'number' || !METHODS.includes(value.method as SignInMethod)) return null
        if (now - value.at > LAST_SIGN_IN_TTL_MS || value.at - now > 60_000) return null
        return value.method as SignInMethod
    } catch {
        return null
    }
}

export function rememberSignInMethod(method: SignInMethod) {
    try {
        localStorage.setItem(LAST_SIGN_IN_KEY, JSON.stringify({ method, at: Date.now() }))
    } catch {
        // Storage can be blocked; the marker just doesn't show.
    }
}

export function readSignInMethod(): SignInMethod | null {
    try {
        return parseLastSignIn(localStorage.getItem(LAST_SIGN_IN_KEY), Date.now())
    } catch {
        return null
    }
}

/** Mail services with a web inbox to open from a "Check your email" screen. */
export function mailAppFor(email: string): { label: string; href: string } | null {
    const domain = email.trim().toLowerCase().split('@')[1] || ''
    if (['gmail.com', 'googlemail.com'].includes(domain)) return { label: 'Open Gmail', href: 'https://mail.google.com/mail/u/0/#search/from%3Anetworkbase' }
    if (['outlook.com', 'hotmail.com', 'live.com', 'msn.com'].includes(domain)) return { label: 'Open Outlook', href: 'https://outlook.live.com/mail/0/' }
    if (['yahoo.com', 'ymail.com'].includes(domain)) return { label: 'Open Yahoo Mail', href: 'https://mail.yahoo.com/' }
    if (['icloud.com', 'me.com', 'mac.com'].includes(domain)) return { label: 'Open iCloud Mail', href: 'https://www.icloud.com/mail' }
    return null
}
