/**
 * The ink panel beside every account page (prototype 99MRvJU75MFy8J2XLCi5BL): the path line, a 4x5 pixel word, the serif
 * headline, and the trail's session script. `eyebrow` is also the mono label above the form's heading.
 */
export type AuthPanelContent = {
    eyebrow: string
    title: string
    /** Shown after "networkbase /" and typed in when it changes. */
    route: string
    /** Drawn with the grid's 4x5 font; keep it to 24 columns (`wordWidth`). */
    word: string
    script: readonly string[]
    /** Sign in only: the `$ nb login` chip in the corner. */
    chip?: boolean
}

/** A finished screen changes the panel's word and headline: worked, refused, expired, or stopped. */
export type PanelOutcome = { word: (typeof AUTH_OUTCOME_WORDS)[number]; title: string }
export const AUTH_OUTCOME_WORDS = ['OK', 'NO', 'OLD', 'HALT'] as const

const SIGNIN_SCRIPT = ['$ nb login', 'nb status', 'nb pull', 'nb next'] as const
const INBOX_SCRIPT = ['check inbox', 'enter code'] as const

export const AUTH_PANELS = {
    signin: { eyebrow: 'Sign in', title: 'Pick up where you left off.', route: 'login', word: 'HEY', script: SIGNIN_SCRIPT, chip: true },
    code: { eyebrow: 'Sign in with a code', title: 'No password needed. Just your inbox.', route: 'login', word: 'CODE', script: INBOX_SCRIPT },
    mfa: { eyebrow: 'Two-step verification', title: 'Two-step sign-in keeps your account yours.', route: 'login', word: 'SAFE', script: ['open your app', 'enter code'] },
    signup: { eyebrow: 'Get started', title: 'Your first workspace is three steps away.', route: 'signup', word: 'INIT', script: ['nb init', 'nb pull', 'nb push'] },
    verify: { eyebrow: 'One last step', title: 'Verified email keeps NetworkBase real.', route: 'verify-email', word: 'MAIL', script: INBOX_SCRIPT },
    recovery: { eyebrow: 'Account recovery', title: 'We’ll get you back in.', route: 'forgot-password', word: 'KEYS', script: ['check inbox', 'new password'] },
    reset: { eyebrow: 'Account recovery', title: 'We’ll get you back in.', route: 'reset-password', word: 'NEW', script: ['new password', 'nb login'] },
    device: { eyebrow: 'Terminal sign-in', title: 'Sign in a terminal that has no browser.', route: 'device', word: 'TERM', script: ['nb login --device', 'nb whoami'] },
    editor: { eyebrow: 'Editor sync', title: 'Your work, inside your code editor.', route: 'authorize', word: 'SYNC', script: ['nb mcp', 'nb status'] },
    join: { eyebrow: 'Organizations', title: 'Your class or team, in one place.', route: 'join', word: 'JOIN', script: ['enter code', 'join'] },
    legal: { eyebrow: 'Updated terms', title: 'What you agree to, in plain view.', route: 'legal/accept', word: 'READ', script: ['read', 'accept'] },
    legalSignup: { eyebrow: 'Almost there', title: 'One agreement, then you’re in.', route: 'legal/accept', word: 'READ', script: ['read', 'accept'] },
} as const satisfies Record<string, AuthPanelContent>
