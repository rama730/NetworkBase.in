import { NextResponse, after } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { logger } from '@/lib/logger'
import { normalizeAuthNextPath, resolveAuthBaseUrl } from '@/lib/auth/redirects'
import { getAuthHardeningPhase } from '@/lib/auth/hardening'
import { clearGithubImportAccessCookie, setGithubImportAccessCookie } from '@/lib/github/import-access-cookie'
import { sealGithubImportToken } from '@/lib/github/repo-security'
import { hasCompletedOnboarding } from '@/lib/onboarding/completion'
import { ensureDefaultGithubContributorIdentity } from '@/lib/github/contributor-identity'
import { recordSecurityEvent } from '@/lib/security/audit'
import { queueSecurityEmail } from '@/lib/email/security-queue'
import { getLegalAcceptanceState } from '@/lib/legal/acceptance'
import { githubOAuthFailureCode } from '@/lib/github/oauth-errors'
import { getSessionIdentifierFromSession } from '@/lib/auth/session-identifier'
import { getTrustedRequestIp } from '@/lib/security/request-ip'
import { enrichSessionDeviceInfo } from '@/lib/security/session-activity'
import { HUMAN_CHECK_COOKIE, clearHumanCheckCookie, humanCheckMatches, markHumanChecked, readCookie } from '@/lib/auth/human-check'
import { isTurnstileServerConfigured } from '@/lib/security/turnstile'
import { noteSignIn } from '@/lib/auth/devices'

export async function GET(request: Request) {
    const startedAt = Date.now()
    const requestId = crypto.randomUUID()
    const hardeningPhase = getAuthHardeningPhase()
    const requestUrl = new URL(request.url)
    const { searchParams } = requestUrl
    const code = searchParams.get('code')
    const nextPath = normalizeAuthNextPath(searchParams.get('next'))
    const oauthRequestId = searchParams.get('rid')?.trim() || null
    const provider = searchParams.get('provider')?.trim() || 'unknown'
    let baseUrl: string
    try {
        baseUrl = resolveAuthBaseUrl({ requestUrl: request.url, browserOrigin: requestUrl.origin })
    } catch (error) {
        logger.metric('auth.callback.exchange.failure', {
            requestId,
            reason: 'canonical_base_url_missing',
            nextPath,
            path: requestUrl.pathname,
            oauthRequestId,
            provider,
            error: error instanceof Error ? error.message : String(error),
            durationMs: Date.now() - startedAt,
            phase: hardeningPhase,
        })
        const response = NextResponse.json({ error: 'Server configuration error' }, { status: 500 })
        response.headers.set('x-request-id', requestId)
        return response
    }
    // Say which way in failed: Google, GitHub, or an email link (reset links go back to the reset page).
    const isResetLink = nextPath === '/reset-password' || nextPath.startsWith('/reset-password?')
    const loginErrorUrl = new URL(isResetLink ? '/forgot-password' : '/login', baseUrl)
    loginErrorUrl.searchParams.set('error', isResetLink ? 'reset-link-expired' : provider === 'google' || provider === 'github' ? `${provider}-failed` : 'link-expired')
    if (!isResetLink) loginErrorUrl.searchParams.set('redirect', nextPath)

    const syncReturn = provider === 'github' && nextPath.startsWith('/workspaces/') && new URL(nextPath, baseUrl).searchParams.get('filesView') === 'github'

    const oauthError = searchParams.get('error')
    const oauthErrorCode = searchParams.get('error_code') || oauthError
    const oauthErrorDescription = searchParams.get('error_description')

    if (!code) {
        logger.metric('auth.callback.exchange.failure', {
            requestId,
            reason: oauthErrorCode ? 'oauth_error' : 'missing_code',
            nextPath,
            path: requestUrl.pathname,
            oauthRequestId,
            provider,
            errorCode: oauthErrorCode,
            durationMs: Date.now() - startedAt,
            phase: hardeningPhase,
        })

        // When an in-app linking attempt (such as from /settings?tab=integrations) encounters
        // an OAuth error (e.g. identity_already_exists), return back to the requesting page
        // instead of bouncing through /login with misleading success parameters.
        if (nextPath.startsWith('/settings') || nextPath.startsWith('/workspaces') || nextPath.startsWith('/discover')) {
            const inAppUrl = new URL(nextPath, baseUrl)
            inAppUrl.searchParams.delete('githubIdentity')
            if (syncReturn) {
                inAppUrl.searchParams.set('githubAuth', githubOAuthFailureCode(oauthErrorCode))
            } else if (oauthErrorCode === 'identity_already_exists') {
                inAppUrl.searchParams.set('githubIdentity', 'already_linked')
            } else if (oauthErrorCode) {
                inAppUrl.searchParams.set('githubIdentity', 'error')
                if (oauthErrorDescription) {
                    inAppUrl.searchParams.set('githubErrorDesc', oauthErrorDescription)
                }
            }
            const response = NextResponse.redirect(inAppUrl)
            response.headers.set('x-request-id', requestId)
            return response
        }

        const response = NextResponse.redirect(loginErrorUrl)
        response.headers.set('x-request-id', requestId)
        return response
    }

    const supabase = await createClient()
    const [{ data: previousUserData }, { data: previousSessionData }] = await Promise.all([
        supabase.auth.getUser(),
        supabase.auth.getSession(),
    ])
    // Signing in with Google or GitHub needs the pass the sign-in page got from Cloudflare for this attempt.
    // Someone already signed in is connecting an account: they passed a check when they signed in.
    const humanCheckNeeded = !previousUserData.user && isTurnstileServerConfigured()
    if (humanCheckNeeded && !humanCheckMatches(readCookie(request, HUMAN_CHECK_COOKIE), oauthRequestId)) {
        logger.metric('auth.callback.exchange.failure', {
            requestId,
            reason: 'human_check_missing',
            nextPath,
            path: requestUrl.pathname,
            oauthRequestId,
            provider,
            durationMs: Date.now() - startedAt,
            phase: hardeningPhase,
        })
        const checkUrl = new URL(loginErrorUrl)
        checkUrl.searchParams.set('error', 'security-check')
        const response = NextResponse.redirect(checkUrl)
        clearHumanCheckCookie(response)
        response.headers.set('x-request-id', requestId)
        return response
    }
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error) {
        logger.metric('auth.callback.exchange.failure', {
            requestId,
            reason: 'exchange_failed',
            nextPath,
            path: requestUrl.pathname,
            oauthRequestId,
            provider,
            error: error.message,
            durationMs: Date.now() - startedAt,
            phase: hardeningPhase,
        })
        const syncErrorUrl = new URL(nextPath, baseUrl)
        syncErrorUrl.searchParams.set('githubAuth', 'invalid')
        const response = NextResponse.redirect(syncReturn ? syncErrorUrl : loginErrorUrl)
        response.headers.set('x-request-id', requestId)
        return response
    }

    logger.metric('auth.callback.exchange.success', {
        requestId,
        nextPath,
        path: requestUrl.pathname,
        oauthRequestId,
        provider,
        durationMs: Date.now() - startedAt,
        phase: hardeningPhase,
    })

    // The mark is what lets a new account accept the terms; written before the redirect so that step never races it.
    if (humanCheckNeeded && !(await markHumanChecked(data.user))) {
        logger.warn('auth.callback.human_check_mark_failed', { requestId, provider, userId: data.user.id })
    }

    const exchangedSessionId = data?.session ? getSessionIdentifierFromSession(data.session) : null
    if (exchangedSessionId) {
        const incomingUa = request.headers.get('user-agent')
        const incomingIp = getTrustedRequestIp(request)
        if (incomingUa) {
            enrichSessionDeviceInfo(exchangedSessionId, incomingUa, incomingIp).catch(() => null)
        }
    }

    let destinationPath = nextPath
    try {
        const requestedUrl = new URL(nextPath, baseUrl)
        const isLegalAcceptance = requestedUrl.pathname === '/legal/accept'
        const afterAcceptance = isLegalAcceptance
            ? normalizeAuthNextPath(requestedUrl.searchParams.get('next'))
            : nextPath
        const acceptanceState = isLegalAcceptance
            ? await getLegalAcceptanceState(data.user.id)
            : null
        const hasCurrentAcceptance = acceptanceState?.current === true
        const complete = await hasCompletedOnboarding(data.user)

        if (!complete) {
            const onboardingUrl = new URL('/onboarding', baseUrl)
            if (afterAcceptance !== '/discover' && afterAcceptance !== '/onboarding') {
                onboardingUrl.searchParams.set('next', afterAcceptance)
            }

            if (isLegalAcceptance && !hasCurrentAcceptance) {
                const legalUrl = new URL('/legal/accept', baseUrl)
                if (requestedUrl.searchParams.get('context') === 'oauth_signup' && !acceptanceState?.latest) {
                    legalUrl.searchParams.set('context', 'oauth_signup')
                }
                legalUrl.searchParams.set('next', `${onboardingUrl.pathname}${onboardingUrl.search}`)
                destinationPath = `${legalUrl.pathname}${legalUrl.search}`
            } else {
                destinationPath = `${onboardingUrl.pathname}${onboardingUrl.search}`
            }
        } else if (isLegalAcceptance && hasCurrentAcceptance) {
            destinationPath = afterAcceptance === '/onboarding' ? '/discover' : afterAcceptance
        } else if (nextPath === '/onboarding' || nextPath.startsWith('/onboarding?')) {
            destinationPath = '/discover'
        }
    } catch (profileError) {
        logger.warn('auth.callback.onboarding_resolution_failed', {
            requestId,
            provider,
            error: profileError instanceof Error ? profileError.message : String(profileError),
        })
    }

    const successUrl = new URL(destinationPath, baseUrl)
    const providerToken = typeof (data?.session as { provider_token?: unknown } | null | undefined)?.provider_token === 'string'
        ? (data?.session as { provider_token?: string }).provider_token?.trim() || ''
        : ''
    const previousUser = previousUserData.user
    const expectedUser = previousUser ?? data.user
    const githubIdentityMatches = provider !== 'github'
        || !previousUser
        || previousUser.id === data.user.id
    const githubGrantIsValid = provider === 'github'
        && Boolean(providerToken)
        && githubIdentityMatches

    if (provider === 'github' && !githubGrantIsValid) {
        successUrl.searchParams.set(
            'githubAuth',
            providerToken && !githubIdentityMatches ? 'account_mismatch' : 'token_missing',
        )
    } else if (provider === 'github') {
        successUrl.searchParams.delete('githubAuth')
    }

    // Repository authorization must not replace the account session that
    // initiated it. The browser also retains that session, but restoring it
    // here removes the race between the callback redirect and session bridge.
    if (provider === 'github' && previousSessionData.session && previousUser) {
        await supabase.auth.setSession({
            access_token: previousSessionData.session.access_token,
            refresh_token: previousSessionData.session.refresh_token,
        }).catch((sessionError) => {
            logger.warn('github.repository_auth.session_restore_failed', {
                requestId,
                userId: previousUser.id,
                error: sessionError instanceof Error ? sessionError.message : String(sessionError),
            })
        })
    }

    const response = NextResponse.redirect(successUrl)
    if (provider === 'github') {
        if (!githubGrantIsValid) {
            clearGithubImportAccessCookie(response)
        } else {
            const sealed = sealGithubImportToken(providerToken)
            if (sealed) setGithubImportAccessCookie(response, sealed)
            // Next.js after() ensures contributor identity enrichment and audit logging
            // do not block the OAuth HTTP redirect back to the user's browser.
            const isReplaced = successUrl.searchParams.get('githubIdentity') === 'replaced'
            const isLinked = successUrl.searchParams.get('githubIdentity') === 'linked'
            after(async () => {
                try {
                    const contributorIdentity = await ensureDefaultGithubContributorIdentity(expectedUser.id, providerToken)
                    // Adding or swapping a way to sign in is worth an email as well as a log line.
                    if (isLinked || isReplaced) {
                        await queueSecurityEmail(expectedUser.id, 'security_sign_in_method_changed', { detail: isReplaced ? 'The linked GitHub account was replaced' : 'GitHub was connected' })
                    }
                    if (isLinked) {
                        await recordSecurityEvent({ userId: expectedUser.id, eventType: 'sign_in_method_linked', request, metadata: { provider: 'github', githubLogin: contributorIdentity.login } })
                            .catch((auditError) => logger.warn('github.account.link.audit_failed', { requestId, userId: expectedUser.id, error: auditError instanceof Error ? auditError.message : String(auditError) }))
                    }
                    if (isReplaced) {
                        await recordSecurityEvent({
                            userId: expectedUser.id,
                            eventType: 'github_account_replaced',
                            request,
                            metadata: {
                                githubId: contributorIdentity.githubId,
                                githubLogin: contributorIdentity.login,
                            },
                        }).catch((auditError) => {
                            logger.warn('github.account.replacement.audit_failed', {
                                requestId,
                                userId: expectedUser.id,
                                error: auditError instanceof Error ? auditError.message : String(auditError),
                            })
                        })
                    }
                } catch (identityError) {
                    // Attribution enrichment must never block a successful OAuth flow.
                    logger.warn('github.contributor_identity.default_failed', {
                        requestId,
                        userId: expectedUser.id,
                        error: identityError instanceof Error ? identityError.message : String(identityError),
                    })
                }
            })
        }
    }
    // Only a real link counts: someone was already signed in, they are the same person after the exchange, and a
    // Google identity is on the account. The identityProvider hint comes from the address, so it proves nothing alone.
    const googleLinked = provider === 'google'
        && successUrl.searchParams.get('identityProvider') === 'google'
        && Boolean(previousUser)
        && previousUser?.id === data.user.id
        && Boolean(data.user.identities?.some((identity) => identity.provider === 'google'))
    if (googleLinked) {
        after(async () => {
            try {
                await queueSecurityEmail(expectedUser.id, 'security_sign_in_method_changed', { detail: 'Google was connected' })
                await recordSecurityEvent({ userId: expectedUser.id, eventType: 'sign_in_method_linked', request, metadata: { provider: 'google' } })
            } catch (linkError) {
                logger.warn('google.account.link.follow_up_failed', { requestId, userId: expectedUser.id, error: linkError instanceof Error ? linkError.message : String(linkError) })
            }
        })
    }
    if (humanCheckNeeded) clearHumanCheckCookie(response)
    // A sign-in, not someone connecting an account: remember the browser and warn about a new one.
    if (!previousUser) await noteSignIn(request, response, data.user.id)
    response.headers.set('x-request-id', requestId)
    return response
}
