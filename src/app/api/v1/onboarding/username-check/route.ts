import { createClient } from '@/lib/supabase/server'
import { checkUsernameAvailability } from '@/lib/onboarding/username-check'
import { getTrustedRequestIp } from '@/lib/security/request-ip'
import { getRequestId, jsonSuccess, jsonError, logApiRoute } from '@/app/api/v1/_shared'

function statusOf(result: Awaited<ReturnType<typeof checkUsernameAvailability>>) {
    if (result.rateLimited) return 429
    if (result.code === 'DB_ERROR') return 503
    if (result.code === 'USERNAME_INVALID') return 400
    return 200
}

const ERROR_CODES = { 429: 'RATE_LIMITED', 400: 'BAD_REQUEST', 503: 'DB_ERROR' } as const

export async function GET(request: Request) {
    const startedAt = Date.now()
    const requestId = getRequestId(request)
    const username = new URL(request.url).searchParams.get('username') || ''
    const ipAddress = getTrustedRequestIp(request) ?? 'unknown'
    const { data: authData } = await (await createClient()).auth.getUser()
    const user = authData.user || null

    const result = await checkUsernameAvailability({
        username,
        viewerKey: user?.id || `anon:${ipAddress}`,
        viewerId: user?.id || null,
        ipAddress,
        userAgent: request.headers.get('user-agent') || 'unknown',
    })
    const status = statusOf(result)
    const errorCode = ERROR_CODES[status as keyof typeof ERROR_CODES]
    logApiRoute(request, { requestId, action: 'onboarding.usernameCheck.get', startedAt, status, success: status < 400, errorCode })
    if (status >= 400) return jsonError(result.message || errorCode, status, errorCode)
    // The answer depends on who asks (your own claimed name reads as available), so no shared cache.
    return jsonSuccess(result, undefined, { headers: { 'Cache-Control': 'private, no-store' } })
}
