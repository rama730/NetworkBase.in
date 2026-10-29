import type { Session, SupabaseClient, User } from '@supabase/supabase-js'
import { readBoundedBody } from '@/lib/security/bounded-body'
import { isEmailVerified } from '@/lib/auth/email-verification'
import { resolveSupabasePublicEnv } from '@/lib/supabase/env'

const JWKS_CACHE_TTL_MS = 30 * 60 * 1000
const JWT_SECRET_ENV = process.env.SUPABASE_JWT_SECRET?.trim() || null
const AUTH_SNAPSHOT_NETWORK_TIMEOUT_MS = readTimeoutMsFromEnv(
    'AUTH_MIDDLEWARE_LOOKUP_TIMEOUT_MS',
    4_000,
)

type JwtHeader = {
    alg?: string
    kid?: string
    typ?: string
}

type JwtPayload = Record<string, unknown> & {
    sub?: string
    exp?: number
    iat?: number
    nbf?: number
    role?: string
    session_id?: string
    email?: string
    email_confirmed_at?: string
    confirmed_at?: string
    email_verified?: boolean | string
    app_metadata?: Record<string, unknown>
    user_metadata?: Record<string, unknown>
}

type JwksResponse = {
    keys: JsonWebKey[]
}

type CachedJwksEntry = {
    fetchedAt: number
    value: JwksResponse
}

const JWKS_MAX_BYTES = 256 * 1024
const jwksCache = new Map<string, CachedJwksEntry>()
const jwksInflight = new Map<string, Promise<JwksResponse>>()
/** An unknown kid refreshes the key set at most this often, so forged kids cannot drive fetches. */
const JWKS_UNKNOWN_KID_REFRESH_MIN_MS = 10_000

/** The issuer's keys could not be read: unlike a bad signature, this says nothing about the token. */
export class JwksUnavailableError extends Error {
    constructor(message: string) {
        super(message)
        this.name = 'JwksUnavailableError'
    }
}

function readTimeoutMsFromEnv(name: string, fallback: number) {
    const raw = process.env[name]
    if (!raw) return fallback
    const parsed = Number(raw)
    if (!Number.isFinite(parsed) || parsed < 250) return fallback
    return Math.trunc(parsed)
}

export type AuthSnapshot = {
    userId: string
    sessionId: string | null
    onboardingComplete: boolean
    emailVerified: boolean
    issuedAt: number | null
    expiresAt: number | null
    roles: string[]
    email: string | null
    appMetadata: Record<string, unknown>
    userMetadata: Record<string, unknown>
    /** Assurance level from the verified token: 'aal2' only after the second factor. */
    aal: 'aal1' | 'aal2'
}

export type AuthSnapshotResolution = {
    session: Session | null
    snapshot: AuthSnapshot | null
    user: User | null
    error: { name: 'AuthError'; message: string; status: number } | null
}

type DecodedJwt = {
    header: JwtHeader
    payload: JwtPayload
    signature: Uint8Array
    signingInput: Uint8Array
}

function normalizeBase64Url(value: string) {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
    const padding = normalized.length % 4
    return padding === 0 ? normalized : normalized + '='.repeat(4 - padding)
}

function decodeBase64UrlToString(value: string) {
    const normalized = normalizeBase64Url(value)
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(normalized, 'base64').toString('utf8')
    }

    const decoded = globalThis.atob(normalized)
    const bytes = Uint8Array.from(decoded, (char) => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
}

function decodeBase64UrlToBytes(value: string) {
    const normalized = normalizeBase64Url(value)
    if (typeof Buffer !== 'undefined') {
        return Uint8Array.from(Buffer.from(normalized, 'base64'))
    }

    const decoded = globalThis.atob(normalized)
    return Uint8Array.from(decoded, (char) => char.charCodeAt(0))
}

function encodeUtf8(value: string) {
    return new TextEncoder().encode(value)
}

function toArrayBuffer(bytes: Uint8Array) {
    const copy = new Uint8Array(bytes.byteLength)
    copy.set(bytes)
    return copy.buffer
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : {}
}

function parseNumericClaim(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value
    if (typeof value === 'string') {
        const parsed = Number(value)
        return Number.isFinite(parsed) ? parsed : null
    }
    return null
}

function decodeJwt(token: string): DecodedJwt {
    const parts = token.split('.')
    if (parts.length !== 3) {
        throw new Error('Invalid JWT format')
    }

    const [rawHeader, rawPayload, rawSignature] = parts
    const header = JSON.parse(decodeBase64UrlToString(rawHeader!)) as JwtHeader
    const payload = JSON.parse(decodeBase64UrlToString(rawPayload!)) as JwtPayload

    return {
        header,
        payload,
        signature: decodeBase64UrlToBytes(rawSignature!),
        signingInput: encodeUtf8(`${rawHeader}.${rawPayload}`),
    }
}

function assertTemporalClaims(payload: JwtPayload, nowSeconds = Date.now() / 1000) {
    const exp = parseNumericClaim(payload.exp)
    if (exp !== null && exp <= nowSeconds) {
        throw new Error('JWT has expired')
    }

    const nbf = parseNumericClaim(payload.nbf)
    if (nbf !== null && nbf > nowSeconds) {
        throw new Error('JWT is not active yet')
    }
}

function getJwtVerifyAlgorithm(alg: string): any {
    switch (alg) {
        case 'RS256':
            return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
        case 'RS384':
            return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' }
        case 'RS512':
            return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }
        case 'HS256':
            return { name: 'HMAC', hash: 'SHA-256' }
        case 'HS384':
            return { name: 'HMAC', hash: 'SHA-384' }
        case 'HS512':
            return { name: 'HMAC', hash: 'SHA-512' }
        case 'ES256':
            return { name: 'ECDSA', hash: { name: 'SHA-256' } }
        case 'ES384':
            return { name: 'ECDSA', hash: { name: 'SHA-384' } }
        case 'ES512':
            return { name: 'ECDSA', hash: { name: 'SHA-512' } }
        default:
            throw new Error(`Unsupported JWT algorithm: ${alg}`)
    }
}

function getJwkImportAlgorithm(alg: string): any {
    switch (alg) {
        case 'RS256':
            return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }
        case 'RS384':
            return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-384' }
        case 'RS512':
            return { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-512' }
        case 'ES256':
            return { name: 'ECDSA', namedCurve: 'P-256' }
        case 'ES384':
            return { name: 'ECDSA', namedCurve: 'P-384' }
        case 'ES512':
            return { name: 'ECDSA', namedCurve: 'P-521' }
        default:
            throw new Error(`Unsupported JWK algorithm: ${alg}`)
    }
}

function jwksCacheKey() {
    return resolveSupabasePublicEnv('auth.snapshot').url.replace(/\/$/, '')
}

/** One fetch per cache key at a time; concurrent callers share it. */
async function fetchSupabaseJwks(options: { refresh?: boolean } = {}): Promise<JwksResponse> {
    const cacheKey = jwksCacheKey()
    const cached = jwksCache.get(cacheKey)

    if (!options.refresh && cached && Date.now() - cached.fetchedAt < JWKS_CACHE_TTL_MS) {
        return cached.value
    }

    const inflight = jwksInflight.get(cacheKey)
    if (inflight) return inflight
    const request = loadSupabaseJwks(cacheKey).finally(() => jwksInflight.delete(cacheKey))
    jwksInflight.set(cacheKey, request)
    return request
}

async function loadSupabaseJwks(cacheKey: string): Promise<JwksResponse> {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), AUTH_SNAPSHOT_NETWORK_TIMEOUT_MS)
    let value: JwksResponse
    try {
        const response = await fetch(`${cacheKey}/auth/v1/.well-known/jwks.json`, {
            method: 'GET',
            headers: {
                'Accept': 'application/json',
            },
            // The TTL above is the only cache: a framework-level cache would pin a rotated-out key set.
            cache: 'no-store',
            signal: controller.signal,
        })
        if (!response.ok) {
            throw new JwksUnavailableError(`Couldn’t fetch Supabase JWKS (${response.status})`)
        }
        // One deadline covers the headers and the body; the body is size-bounded.
        value = JSON.parse(new TextDecoder().decode((await readBoundedBody(response, JWKS_MAX_BYTES)).bytes)) as JwksResponse
    } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
            throw new JwksUnavailableError('Auth snapshot JWKS lookup timed out')
        }
        throw error instanceof JwksUnavailableError ? error : new JwksUnavailableError(error instanceof Error ? error.message : 'JWKS lookup failed')
    } finally {
        clearTimeout(timeoutId)
    }
    if (!Array.isArray(value.keys) || value.keys.length === 0) {
        throw new JwksUnavailableError('Supabase JWKS response is empty')
    }

    jwksCache.set(cacheKey, {
        fetchedAt: Date.now(),
        value,
    })

    return value
}

async function verifyAsymmetricJwt(token: DecodedJwt) {
    const alg = token.header.alg
    const kid = token.header.kid

    if (!alg || !kid) {
        throw new Error('JWT is missing signing metadata')
    }

    const findKey = (set: JwksResponse) => set.keys.find((candidate) => (candidate as JsonWebKey & { kid?: string }).kid === kid)
    let jwk = findKey(await fetchSupabaseJwks())
    // AUTH-008: a key the cache has not seen is usually a rotation, so look once more, not more than
    // once per cooldown.
    if (!jwk && Date.now() - (jwksCache.get(jwksCacheKey())?.fetchedAt ?? 0) >= JWKS_UNKNOWN_KID_REFRESH_MIN_MS) {
        jwk = findKey(await fetchSupabaseJwks({ refresh: true }))
    }
    if (!jwk) {
        throw new Error(`Couldn’t find JWKS key for kid ${kid}`)
    }

    const publicKey = await crypto.subtle.importKey(
        'jwk',
        jwk,
        getJwkImportAlgorithm(alg),
        true,
        ['verify'],
    )

    const verified = await crypto.subtle.verify(
        getJwtVerifyAlgorithm(alg),
        publicKey,
        toArrayBuffer(token.signature),
        toArrayBuffer(token.signingInput),
    )

    if (!verified) {
        throw new Error('Invalid JWT signature')
    }
}

async function verifySymmetricJwt(token: DecodedJwt) {
    const alg = token.header.alg
    if (!alg) {
        throw new Error('JWT is missing algorithm metadata')
    }

    if (!JWT_SECRET_ENV) {
        throw new Error('SUPABASE_JWT_SECRET is required for symmetric Supabase JWT verification')
    }

    const secretKey = await crypto.subtle.importKey(
        'raw',
        encodeUtf8(JWT_SECRET_ENV),
        getJwtVerifyAlgorithm(alg),
        false,
        ['verify'],
    )

    const verified = await crypto.subtle.verify(
        getJwtVerifyAlgorithm(alg),
        secretKey,
        toArrayBuffer(token.signature),
        toArrayBuffer(token.signingInput),
    )

    if (!verified) {
        throw new Error('Invalid JWT signature')
    }
}

export async function verifySupabaseAccessToken(accessToken: string): Promise<JwtPayload> {
    const token = decodeJwt(accessToken)
    const alg = token.header.alg

    assertTemporalClaims(token.payload)

    if (!alg) {
        throw new Error('JWT is missing algorithm metadata')
    }

    if (alg.startsWith('HS')) {
        await verifySymmetricJwt(token)
    } else {
        await verifyAsymmetricJwt(token)
    }

    return token.payload
}

function readRoles(payload: JwtPayload, appMetadata: Record<string, unknown>): string[] {
    const roles = new Set<string>()
    const payloadRole = typeof payload.role === 'string' ? payload.role.trim() : ''
    if (payloadRole) roles.add(payloadRole)

    const appRole = typeof appMetadata.role === 'string' ? appMetadata.role.trim() : ''
    if (appRole) roles.add(appRole)

    const appRoles = appMetadata.roles
    if (Array.isArray(appRoles)) {
        for (const candidate of appRoles) {
            if (typeof candidate === 'string' && candidate.trim().length > 0) {
                roles.add(candidate.trim())
            }
        }
    }

    return [...roles]
}

export function buildAuthSnapshotFromClaims(payload: JwtPayload): AuthSnapshot | null {
    const userId = typeof payload.sub === 'string' && payload.sub.trim().length > 0
        ? payload.sub
        : null

    if (!userId) return null

    const userMetadata = asRecord(payload.user_metadata)
    const appMetadata = asRecord(payload.app_metadata)
    const serverOnboarded = appMetadata.onboarding_complete === true

    return {
        userId,
        sessionId: typeof payload.session_id === 'string' ? payload.session_id : null,
        onboardingComplete: serverOnboarded,
        emailVerified: isEmailVerified({
            email_confirmed_at: payload.email_confirmed_at,
            confirmed_at: payload.confirmed_at,
            app_metadata: appMetadata,
        }),
        issuedAt: parseNumericClaim(payload.iat),
        expiresAt: parseNumericClaim(payload.exp),
        roles: readRoles(payload, appMetadata),
        email: typeof payload.email === 'string' ? payload.email : null,
        appMetadata,
        userMetadata,
        aal: payload.aal === 'aal2' ? 'aal2' : 'aal1',
    }
}

export function buildUserFromSnapshot(snapshot: AuthSnapshot): User {
    const createdAtIso = new Date((snapshot.issuedAt ?? Math.floor(Date.now() / 1000)) * 1000).toISOString()
    const isAnonymous =
        snapshot.appMetadata.provider === 'anonymous'
        || snapshot.appMetadata.anonymous === true
        || snapshot.appMetadata.is_anonymous === true
        || snapshot.roles.includes('anonymous')

    return {
        id: snapshot.userId,
        app_metadata: snapshot.appMetadata,
        user_metadata: snapshot.userMetadata,
        aud: 'authenticated',
        created_at: createdAtIso,
        updated_at: createdAtIso,
        email: snapshot.email ?? undefined,
        email_confirmed_at: snapshot.emailVerified ? createdAtIso : undefined,
        phone: undefined,
        role: snapshot.roles[0],
        factors: undefined,
        identities: [],
        is_anonymous: isAnonymous,
    } as unknown as User
}

function authError(message: string, status: number): AuthSnapshotResolution['error'] {
    return {
        name: 'AuthError',
        message,
        status,
    }
}

export async function resolveAuthSnapshot(
    supabase: SupabaseClient
): Promise<AuthSnapshotResolution> {
    const sessionResponse = await supabase.auth.getSession()
    const session = sessionResponse.data.session ?? null

    if (sessionResponse.error) {
        return {
            session,
            snapshot: null,
            user: null,
            error: authError(
                sessionResponse.error.message,
                sessionResponse.error.status ?? 500,
            ),
        }
    }

    if (!session?.access_token) {
        return {
            session,
            snapshot: null,
            user: null,
            error: null,
        }
    }

    try {
        const claims = await verifySupabaseAccessToken(session.access_token)
        const snapshot = buildAuthSnapshotFromClaims(claims)

        if (!snapshot) {
            return {
                session: null,
                snapshot: null,
                user: null,
                error: authError('JWT is missing subject claims', 401),
            }
        }

        return {
            session,
            snapshot,
            user: buildUserFromSnapshot(snapshot),
            error: null,
        }
    } catch (error) {
        return {
            session: null,
            snapshot: null,
            user: null,
            error: authError(error instanceof Error ? error.message : 'Couldn’t verify auth session', 401),
        }
    }
}
