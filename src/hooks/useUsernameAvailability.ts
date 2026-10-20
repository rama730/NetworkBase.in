'use client'

import { useEffect, useState } from 'react'
import { normalizeUsername, sanitizeUsernameInput, validateUsername } from '@/lib/validations/username'

export type UsernameAvailabilityStatus = 'idle' | 'checking' | 'valid' | 'invalid' | 'error'

type UsernameAvailabilityPayload = {
    available?: boolean
    message?: string
    code?: string
}

type UsernameAvailabilityEnvelope =
    | {
        success: true
        data?: UsernameAvailabilityPayload
        message?: string
    }
    | {
        success: false
        message?: string
        errorCode?: string
    }

export type UsernameAvailabilityResult = {
    ok: boolean
    status: number
    payload: UsernameAvailabilityPayload
    responseText: string
}

function resolveUsernameAvailabilityMessage(payload: UsernameAvailabilityPayload, responseText: string): string {
    if (payload.code === 'USERNAME_RESERVED') return 'This username is reserved'
    if (payload.code === 'USERNAME_TAKEN') return 'Username is already taken'
    return payload.message || responseText
}

const USERNAME_CHECK_TTL_MS = 20_000
const USERNAME_CHECK_CACHE_MAX = 120
const usernameCheckCache = new Map<string, { expiresAt: number; result: UsernameAvailabilityResult }>()
const usernameCheckInFlight = new Map<string, Promise<UsernameAvailabilityResult>>()

function setUsernameCheckCache(username: string, result: UsernameAvailabilityResult) {
    if (usernameCheckCache.size >= USERNAME_CHECK_CACHE_MAX) {
        const oldest = usernameCheckCache.keys().next().value
        if (oldest) usernameCheckCache.delete(oldest)
    }
    usernameCheckCache.set(username, {
        expiresAt: Date.now() + USERNAME_CHECK_TTL_MS,
        result,
    })
}

export async function requestUsernameAvailability(username: string): Promise<UsernameAvailabilityResult> {
    const normalized = sanitizeUsernameInput(username)
    if (!normalized) {
        return {
            ok: true,
            status: 200,
            payload: { available: false, message: 'Username is unavailable' },
            responseText: '',
        }
    }

    const cached = usernameCheckCache.get(normalized)
    if (cached && cached.expiresAt > Date.now()) {
        return cached.result
    }

    const existing = usernameCheckInFlight.get(normalized)
    if (existing) {
        return existing
    }

    const task = (async (): Promise<UsernameAvailabilityResult> => {
        const response = await fetch(`/api/v1/onboarding/username-check?username=${encodeURIComponent(normalized)}`, {
            method: 'GET',
            cache: 'no-store',
        })
        const responseForText = response.clone()
        const contentType = response.headers.get('content-type') || ''
        let payload: UsernameAvailabilityPayload = {}
        let responseText = ''

        if (contentType.includes('application/json')) {
            try {
                const body = (await response.json()) as UsernameAvailabilityEnvelope
                if (body && typeof body === 'object' && 'success' in body) {
                    if (body.success) {
                        payload = body.data ?? {}
                        if (!payload.message && typeof body.message === 'string') {
                            payload.message = body.message
                        }
                    } else {
                        payload = {
                            message: typeof body.message === 'string' ? body.message : undefined,
                            code: typeof body.errorCode === 'string' ? body.errorCode : undefined,
                        }
                    }
                } else {
                    payload = body as UsernameAvailabilityPayload
                }
            } catch {
                payload = {}
            }
        }

        if (!payload.message) {
            try {
                responseText = (await responseForText.text()).trim()
            } catch {
                responseText = ''
            }
        }

        const result: UsernameAvailabilityResult = {
            ok: response.ok,
            status: response.status,
            payload,
            responseText,
        }

        if (response.status < 500) {
            setUsernameCheckCache(normalized, result)
        }

        return result
    })().finally(() => {
        usernameCheckInFlight.delete(normalized)
    })

    usernameCheckInFlight.set(normalized, task)
    return task
}

type RemoteCheck = { forValue: string; status: UsernameAvailabilityStatus; message: string }

export function useUsernameAvailability(params: {
    value: string
    currentUsername?: string | null
    debounceMs?: number
    enabled?: boolean
}) {
    const { value, currentUsername, debounceMs = 350, enabled = true } = params
    const normalizedValue = normalizeUsername(value)
    const isCurrent = Boolean(currentUsername) && normalizedValue === normalizeUsername(currentUsername || '')
    const validation = normalizedValue ? validateUsername(normalizedValue) : null
    const needsRemoteCheck = enabled && Boolean(normalizedValue) && !isCurrent && validation?.valid === true

    // The answer is stored with the name it belongs to, so a result for the previous name is never shown for this one.
    const [remote, setRemote] = useState<RemoteCheck | null>(null)

    useEffect(() => {
        if (!needsRemoteCheck) return
        let cancelled = false
        const timer = window.setTimeout(async () => {
            const done = (status: UsernameAvailabilityStatus, message: string) => {
                if (!cancelled) setRemote({ forValue: normalizedValue, status, message })
            }
            try {
                const { ok, status: responseStatus, payload, responseText } = await requestUsernameAvailability(normalizedValue)
                if (!ok) {
                    if (responseStatus === 429 || payload.code === 'RATE_LIMITED') {
                        // Not a verdict on the name: no red cross, and saving still re-checks on the server.
                        return done('error', 'Too many checks. Wait a moment and try again.')
                    }
                    return done('error', resolveUsernameAvailabilityMessage(payload, responseText) || `HTTP ${responseStatus}`)
                }
                if (payload.available) return done('valid', 'Username is available')
                if (typeof payload.available !== 'boolean') {
                    return done('error', payload.message || responseText || 'Unable to verify username right now. Please retry.')
                }
                return done('invalid', resolveUsernameAvailabilityMessage(payload, responseText) || 'Username is unavailable')
            } catch {
                done('error', 'Unable to verify username right now. Please retry.')
            }
        }, debounceMs)

        return () => {
            cancelled = true
            window.clearTimeout(timer)
        }
    }, [debounceMs, needsRemoteCheck, normalizedValue])

    if (!enabled || !normalizedValue || isCurrent) return { status: 'idle' as const, message: '', checkedValue: '' }
    if (validation && !validation.valid) return { status: 'invalid' as const, message: validation.message, checkedValue: normalizedValue }
    if (remote && remote.forValue === normalizedValue) {
        return { status: remote.status, message: remote.message, checkedValue: normalizedValue }
    }
    return { status: 'checking' as const, message: 'Checking availability...', checkedValue: normalizedValue }
}
