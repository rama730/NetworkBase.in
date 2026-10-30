'use client'

import Script from 'next/script'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSecurityRuntime } from '@/components/providers/SecurityRuntimeProvider'

declare global {
    interface Window {
        turnstile?: {
            render: (
                container: HTMLElement,
                options: {
                    sitekey: string
                    action?: string
                    theme?: 'light' | 'dark' | 'auto'
                    size?: 'flexible' | 'compact'
                    callback?: (token: string) => void
                    'expired-callback'?: () => void
                    'error-callback'?: () => void
                    'timeout-callback'?: () => void
                }
            ) => string
            remove: (widgetId: string) => void
        }
    }
}

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || ''
// The form is the viewport less 32px of gutter, and Cloudflare's flexible box needs at least 300px.
const NARROW_FORM = '(max-width: 331px)'

export const SECURITY_CHECK_PROMPT = 'Complete the security check first.'

export function hasTurnstileSiteKey() {
    return TURNSTILE_SITE_KEY.length > 0
}

export default function TurnstileWidget({
    action,
    onVerify,
    onExpire,
}: {
    action: string
    onVerify: (token: string) => void
    onExpire: () => void
}) {
    const { nonce } = useSecurityRuntime()
    const containerRef = useRef<HTMLDivElement | null>(null)
    const widgetIdRef = useRef<string | null>(null)
    const [scriptReady, setScriptReady] = useState(false)
    const [failed, setFailed] = useState(false)
    const [attempt, setAttempt] = useState(0)
    const verifyRef = useRef(onVerify)
    const expireRef = useRef(onExpire)

    useEffect(() => {
        verifyRef.current = onVerify
        expireRef.current = onExpire
    }, [onExpire, onVerify])

    const handleFailure = useCallback(() => {
        setFailed(true)
        expireRef.current()
    }, [])

    useEffect(() => {
        if (!TURNSTILE_SITE_KEY || !scriptReady || !containerRef.current || !window.turnstile) {
            return
        }

        if (widgetIdRef.current) {
            window.turnstile.remove(widgetIdRef.current)
            widgetIdRef.current = null
        }

        widgetIdRef.current = window.turnstile.render(containerRef.current, {
            sitekey: TURNSTILE_SITE_KEY,
            action,
            theme: 'auto',
            size: window.matchMedia(NARROW_FORM).matches ? 'compact' : 'flexible',
            callback: (token) => {
                setFailed(false)
                verifyRef.current(token)
            },
            'expired-callback': () => expireRef.current(),
            'error-callback': handleFailure,
            'timeout-callback': handleFailure,
        })

        return () => {
            if (widgetIdRef.current && window.turnstile) {
                window.turnstile.remove(widgetIdRef.current)
                widgetIdRef.current = null
            }
        }
    }, [action, attempt, handleFailure, scriptReady])

    const retry = () => {
        // Without the script (blocked or offline at load) only a new page can fetch it again.
        if (!window.turnstile) {
            window.location.reload()
            return
        }
        setFailed(false)
        setAttempt((current) => current + 1)
    }

    if (!TURNSTILE_SITE_KEY) return null

    return (
        <>
            <Script
                src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit"
                nonce={nonce ?? undefined}
                strategy="afterInteractive"
                onReady={() => setScriptReady(true)}
                onError={handleFailure}
            />
            {/* The fixed height hides the gap under Cloudflare's frame, so the button below never moves. */}
            <div className="relative h-[65px] overflow-hidden max-[331px]:h-[140px]">
                {failed ? (
                    <div role="alert" className="flex h-full items-center justify-between gap-3 rounded-md border border-border px-3 text-sm">
                        <span>The security check didn’t load.</span>
                        <button
                            type="button"
                            onClick={retry}
                            className="inline-flex min-h-11 shrink-0 items-center font-medium underline underline-offset-4"
                        >
                            Retry
                        </button>
                    </div>
                ) : (
                    <p className="absolute inset-0 flex items-center rounded-md border border-border px-3 text-xs text-muted-foreground">
                        Loading security check…
                    </p>
                )}
                <div ref={containerRef} className={failed ? 'hidden' : 'relative'} />
            </div>
        </>
    )
}
