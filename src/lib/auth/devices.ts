import 'server-only'

import { createHash, randomBytes } from 'node:crypto'
import { and, desc, eq, gt, ne, sql } from 'drizzle-orm'
import type { NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { userDevices } from '@/lib/db/schema'
import { logger } from '@/lib/logger'
import { parseUserAgent } from '@/lib/utils/device'

/**
 * The browsers a person signed in from (0069). A browser carries a random id in a long-lived cookie; the table keeps
 * only its hash, so a database read can't be replayed as a browser. It drives the "new sign-in" email and
 * "Trust this browser for 30 days" on the two-step code screen.
 */
export const DEVICE_COOKIE = 'nb-device'
const DEVICE_COOKIE_MAX_AGE_SECONDS = 400 * 24 * 60 * 60
export const TRUST_DAYS = 30

export const deviceHash = (deviceId: string) => createHash('sha256').update(deviceId).digest('hex')
const validDeviceId = (value: string | null | undefined): value is string => Boolean(value && /^[A-Za-z0-9_-]{32,64}$/.test(value))

export function deviceLabel(userAgent: string | null | undefined): string {
    const { browser, os } = parseUserAgent(userAgent)
    return `${browser} on ${os}`
}

/** This browser's id: the one in the cookie, or a new one that the caller must set with `setDeviceCookie`. */
export function resolveDeviceId(cookieValue: string | null | undefined): { deviceId: string; isNewCookie: boolean } {
    return validDeviceId(cookieValue) ? { deviceId: cookieValue, isNewCookie: false } : { deviceId: randomBytes(24).toString('base64url'), isNewCookie: true }
}

export function setDeviceCookie(response: NextResponse, deviceId: string) {
    response.cookies.set(DEVICE_COOKIE, deviceId, {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        path: '/',
        maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
    })
}

/**
 * Records a sign-in from this browser. `isNew` is a browser this account never used; `hadOthers` says the account
 * already had one, so the very first browser (the sign-up) and everyone's first sign-in after this shipped stay quiet.
 */
export async function noteSignInDevice(userId: string, deviceId: string, userAgent: string | null): Promise<{ isNew: boolean; hadOthers: boolean; label: string }> {
    const hash = deviceHash(deviceId)
    const label = deviceLabel(userAgent)
    const rows = await db.execute<{ inserted: boolean }>(sql`
        INSERT INTO public.user_devices (user_id, device_hash, label)
        VALUES (${userId}::uuid, ${hash}, ${label})
        ON CONFLICT (user_id, device_hash) DO UPDATE SET last_seen_at = now(), label = EXCLUDED.label
        RETURNING (xmax = 0) AS inserted
    `)
    const isNew = Boolean(rows[0]?.inserted)
    if (!isNew) return { isNew, hadOthers: true, label }
    const [other] = await db.select({ found: sql<number>`1` }).from(userDevices)
        .where(and(eq(userDevices.userId, userId), ne(userDevices.deviceHash, hash))).limit(1)
    return { isNew, hadOthers: Boolean(other), label }
}

// ponytail: per-process cache, so stopping trust reaches every server within a minute; move to Redis if instances multiply.
const TRUST_CACHE_MS = 60_000
const trustCache = new Map<string, { trusted: boolean; at: number }>()

/** Whether this browser may skip the two-step code for this account. */
export async function isTrustedDevice(userId: string, cookieValue: string | null | undefined): Promise<boolean> {
    if (!validDeviceId(cookieValue)) return false
    const key = `${userId}:${deviceHash(cookieValue)}`
    const cached = trustCache.get(key)
    if (cached && Date.now() - cached.at < TRUST_CACHE_MS) return cached.trusted
    try {
        const [row] = await db.select({ found: sql<number>`1` }).from(userDevices)
            .where(and(eq(userDevices.userId, userId), eq(userDevices.deviceHash, deviceHash(cookieValue)), gt(userDevices.trustedUntil, sql`now()`))).limit(1)
        if (trustCache.size >= 10_000) trustCache.clear()
        trustCache.set(key, { trusted: Boolean(row), at: Date.now() })
        return Boolean(row)
    } catch (error) {
        // Failing closed only asks for the code, which the person can always give.
        logger.warn('auth.trusted_device_lookup_failed', { userId, error: error instanceof Error ? error.message : String(error) })
        return false
    }
}

export async function trustDevice(userId: string, deviceId: string, userAgent: string | null) {
    const hash = deviceHash(deviceId)
    await db.execute(sql`
        INSERT INTO public.user_devices (user_id, device_hash, label, trusted_until)
        VALUES (${userId}::uuid, ${hash}, ${deviceLabel(userAgent)}, now() + make_interval(days => ${TRUST_DAYS}))
        ON CONFLICT (user_id, device_hash) DO UPDATE SET trusted_until = EXCLUDED.trusted_until, last_seen_at = now()
    `)
    trustCache.delete(`${userId}:${hash}`)
}

export type TrustedBrowser = { id: string; label: string; lastSeenAt: string; trustedUntil: string; current: boolean }

export async function listTrustedDevices(userId: string, cookieValue: string | null | undefined): Promise<TrustedBrowser[]> {
    const currentHash = validDeviceId(cookieValue) ? deviceHash(cookieValue) : null
    const rows = await db.select().from(userDevices)
        .where(and(eq(userDevices.userId, userId), gt(userDevices.trustedUntil, sql`now()`)))
        .orderBy(desc(userDevices.lastSeenAt)).limit(50)
    return rows.map((row) => ({
        // The hash is not the cookie, so it is safe to show and to send back to stop trusting one browser.
        id: row.deviceHash,
        label: row.label || 'Unknown browser',
        lastSeenAt: row.lastSeenAt.toISOString(),
        trustedUntil: row.trustedUntil!.toISOString(),
        current: row.deviceHash === currentHash,
    }))
}

/** One browser by its listed id, or every browser of the account. */
export async function stopTrustingDevices(userId: string, id?: string) {
    await db.update(userDevices).set({ trustedUntil: null })
        .where(id ? and(eq(userDevices.userId, userId), eq(userDevices.deviceHash, id)) : eq(userDevices.userId, userId))
    for (const key of trustCache.keys()) if (key.startsWith(`${userId}:`)) trustCache.delete(key)
}

function readCookieHeader(request: Request, name: string): string | null {
    for (const part of (request.headers.get('cookie') || '').split(';')) {
        const eq = part.indexOf('=')
        if (eq > 0 && part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
    }
    return null
}

/**
 * After any sign-in: gives the browser its id if it has none, records it, and emails the person when a browser the
 * account never used signs in. Never throws: the sign-in already happened.
 */
export async function noteSignIn(request: Request, response: NextResponse, userId: string) {
    const { deviceId, isNewCookie } = resolveDeviceId(readCookieHeader(request, DEVICE_COOKIE))
    if (isNewCookie) setDeviceCookie(response, deviceId)
    try {
        const seen = await noteSignInDevice(userId, deviceId, request.headers.get('user-agent'))
        if (seen.isNew && seen.hadOthers) {
            const { queueSecurityEmail } = await import('@/lib/email/security-queue')
            await queueSecurityEmail(userId, 'security_new_sign_in', { detail: seen.label })
        }
    } catch (error) {
        logger.warn('auth.note_sign_in_failed', { userId, error: error instanceof Error ? error.message : String(error) })
    }
}

export const readDeviceCookie = (request: Request) => readCookieHeader(request, DEVICE_COOKIE)
