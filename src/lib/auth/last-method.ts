/** How this browser last signed in, so the sign-in page can mark that way "Last used". Kept only in this browser. */
export type SignInMethod = 'google' | 'github' | 'password' | 'code'
const KEY = 'nb_last_sign_in'
const METHODS: readonly SignInMethod[] = ['google', 'github', 'password', 'code']

export function rememberSignInMethod(method: SignInMethod) {
    try {
        localStorage.setItem(KEY, method)
    } catch {
        // Storage can be blocked; the label just doesn't show.
    }
}

export function readSignInMethod(): SignInMethod | null {
    try {
        const value = localStorage.getItem(KEY)
        return METHODS.includes(value as SignInMethod) ? (value as SignInMethod) : null
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
