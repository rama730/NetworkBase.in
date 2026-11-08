import { createHmac, timingSafeEqual } from 'node:crypto'
import type { NextResponse } from 'next/server'
import type { User } from '@supabase/supabase-js'

/**
 * The Cloudflare check for Google, GitHub and One Tap. Supabase checks the token for email sign-in and sign-up
 * itself, but not for these, so the server asks Cloudflare and leaves a short pass that the return step needs.
 */
export const HUMAN_CHECK_COOKIE = 'nb-human-check'
export const HUMAN_CHECK_MAX_AGE_SECONDS = 10 * 60
/** The sign-in and sign-up pages' widgets: the social ways in use whichever page they are on. */
export const HUMAN_CHECK_ACTIONS = ['login', 'signup']
export const HUMAN_CHECK_MARK = 'human_checked_at'

function resolveSecret(): string {
    const secret = process.env.SECURITY_STEPUP_SECRET?.trim()
    if (secret) return secret
    if (process.env.NODE_ENV === 'production') throw new Error('Missing SECURITY_STEPUP_SECRET')
    return 'development-human-check-secret'
}

// The step-up secret is reused under its own label, so a pass can never stand in for a step-up cookie.
const sign = (payload: string) => createHmac('sha256', resolveSecret()).update(`human-check:${payload}`).digest('base64url')

/** `rid.expiresAt.signature` — the rid is the sign-in attempt's id, which travels in the return address. */
export function createHumanCheckValue(rid: string, now = Date.now()): string {
    const payload = `${rid}.${now + HUMAN_CHECK_MAX_AGE_SECONDS * 1000}`
    return `${payload}.${sign(payload)}`
}

export function humanCheckMatches(value: string | null | undefined, rid: string | null | undefined, now = Date.now()): boolean {
    if (!value || !rid) return false
    const cut = value.lastIndexOf('.')
    if (cut <= 0) return false
    const payload = value.slice(0, cut)
    const signature = Buffer.from(value.slice(cut + 1))
    const expected = Buffer.from(sign(payload))
    if (signature.length !== expected.length || !timingSafeEqual(signature, expected)) return false
    const dot = payload.lastIndexOf('.')
    return payload.slice(0, dot) === rid && Number(payload.slice(dot + 1)) > now
}

function cookieOptions(maxAge: number) {
    return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/', maxAge }
}

export function setHumanCheckCookie(response: NextResponse, rid: string) {
    response.cookies.set(HUMAN_CHECK_COOKIE, createHumanCheckValue(rid), cookieOptions(HUMAN_CHECK_MAX_AGE_SECONDS))
}

export function clearHumanCheckCookie(response: NextResponse) {
    response.cookies.set(HUMAN_CHECK_COOKIE, '', cookieOptions(0))
}

export function readCookie(request: Request, name: string): string | null {
    for (const part of (request.headers.get('cookie') || '').split(';')) {
        const eq = part.indexOf('=')
        if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
    }
    return null
}

/** Email accounts passed Supabase's own check at sign-up; Google and GitHub accounts carry the server's mark. */
export function hasPassedHumanCheck(user: Pick<User, 'app_metadata'> & { identities?: Array<{ provider: string }> }): boolean {
    return Boolean(user.app_metadata?.[HUMAN_CHECK_MARK]) || (user.identities ?? []).some((identity) => identity.provider === 'email')
}

/** The mark lives in app_metadata, which only the server can write. */
export async function markHumanChecked(user: Pick<User, 'id' | 'app_metadata'> & { identities?: Array<{ provider: string }> }): Promise<boolean> {
    if (hasPassedHumanCheck(user)) return true
    const { createAdminClient } = await import('@/lib/supabase/server')
    const admin = await createAdminClient()
    const app_metadata = { ...(user.app_metadata || {}), [HUMAN_CHECK_MARK]: new Date().toISOString() }
    for (let attempt = 0; attempt < 2; attempt += 1) {
        const { error } = await admin.auth.admin.updateUserById(user.id, { app_metadata })
        if (!error) return true
    }
    return false
}
