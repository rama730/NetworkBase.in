'use client'

import Link from 'next/link'
import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import TurnstileWidget, { hasTurnstileSiteKey, SECURITY_CHECK_PROMPT } from '@/components/auth/TurnstileWidget'
import { AUTH_EMAIL_HANDOFF_KEY, AUTH_INPUT, AUTH_LINK, RECOVERY_PANEL, AuthAlert, AuthField, AuthShell, SubmitButton, fieldError } from '@/components/auth/AuthShell'
import { buildOAuthRedirectTo, resolveAuthBaseUrl } from '@/lib/auth/redirects'
import { loadBrowserSupabase } from '@/lib/auth/browser-auth-actions'
import { toFriendlyAuthError } from '@/lib/auth/error-messages'

const RESEND_COOLDOWN_SECONDS = 60

function toRecoveryErrorMessage(error: unknown) {
    return toFriendlyAuthError(error instanceof Error ? error.message : '', "We couldn’t send the reset email. Try again.")
}

export default function ForgotPasswordPage() {
    const [email, setEmail] = useState('')
    const [emailError, setEmailError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sent, setSent] = useState(false)
    const [cooldown, setCooldown] = useState(0)
    const [captchaToken, setCaptchaToken] = useState<string | null>(null)
    // Turnstile tokens are single-use: every attempt remounts the widget for a fresh one.
    const [captchaKey, setCaptchaKey] = useState(0)
    const emailRef = useRef<HTMLInputElement | null>(null)
    const requiresCaptcha = hasTurnstileSiteKey()

    useEffect(() => {
        try {
            const handoff = sessionStorage.getItem(AUTH_EMAIL_HANDOFF_KEY)
            if (handoff) setEmail(handoff)
            sessionStorage.removeItem(AUTH_EMAIL_HANDOFF_KEY)
        } catch {
            // Storage can be blocked; the field just starts empty.
        }
    }, [])

    useEffect(() => {
        if (cooldown <= 0) return
        const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
        return () => clearInterval(timer)
    }, [cooldown])

    const sendLink = async () => {
        setError(null)
        if (!email.trim()) {
            setEmailError('Enter your email.')
            emailRef.current?.focus()
            return
        }
        if (requiresCaptcha && !captchaToken) {
            setError(SECURITY_CHECK_PROMPT)
            return
        }

        setIsSubmitting(true)
        try {
            const redirectTo = buildOAuthRedirectTo(
                resolveAuthBaseUrl({ browserOrigin: typeof window !== 'undefined' ? window.location.origin : null }),
                '/reset-password'
            )
            const supabase = await loadBrowserSupabase()
            const { error: resetError } = await supabase.auth.resetPasswordForEmail(email.trim(), {
                redirectTo,
                captchaToken: captchaToken || undefined,
            })
            if (resetError) throw resetError
            setSent(true)
            setCooldown(RESEND_COOLDOWN_SECONDS)
        } catch (submitError) {
            setError(toRecoveryErrorMessage(submitError))
        } finally {
            setCaptchaToken(null)
            setCaptchaKey((key) => key + 1)
            setIsSubmitting(false)
        }
    }

    const captcha = requiresCaptcha ? (
        <TurnstileWidget
            key={captchaKey}
            action="forgot-password"
            onVerify={(token) => { setCaptchaToken(token); setError((current) => current === SECURITY_CHECK_PROMPT ? null : current) }}
            onExpire={() => setCaptchaToken(null)}
        />
    ) : null

    if (sent) {
        return (
            <AuthShell
                title="Check your email"
                description={<>If an account exists for <span className="font-medium text-foreground">{email.trim()}</span>, a reset link is on its way. It can take a minute, so check spam too.</>}
                panel={RECOVERY_PANEL}
            >
                <div className="nb-auth-step space-y-4">
                    {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
                    <Button asChild className="h-11 w-full font-medium"><Link href="/login">Back to sign in</Link></Button>
                    {cooldown === 0 ? captcha : null}
                    <div className="flex items-center justify-between gap-3 text-sm">
                        <button type="button" className="min-h-11 text-muted-foreground hover:text-foreground" onClick={() => { setSent(false); setError(null) }}>
                            Use a different email
                        </button>
                        <button
                            type="button"
                            onClick={() => void sendLink()}
                            disabled={cooldown > 0 || isSubmitting}
                            className="min-h-11 font-medium text-primary underline-offset-4 hover:underline disabled:font-normal disabled:text-muted-foreground disabled:no-underline"
                        >
                            {isSubmitting ? 'Sending…' : cooldown > 0 ? `Resend link in ${cooldown}s` : 'Resend link'}
                        </button>
                    </div>
                </div>
            </AuthShell>
        )
    }

    return (
        <AuthShell
            title="Reset your password"
            description="Enter your account email and we’ll send you a link to choose a new password."
            panel={RECOVERY_PANEL}
            footer={<>Remembered it? <Link href="/login" className={AUTH_LINK}>Sign in</Link></>}
        >
            <form onSubmit={(event: FormEvent) => { event.preventDefault(); void sendLink() }} className="space-y-4" noValidate>
                {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
                <AuthField id="email" label="Email" error={emailError}>
                    <Input
                        ref={emailRef}
                        id="email"
                        type="email"
                        autoComplete="username email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(event) => { setError(null); setEmailError(null); setEmail(event.target.value) }}
                        className={AUTH_INPUT}
                        disabled={isSubmitting}
                        {...fieldError('email', emailError)}
                    />
                </AuthField>
                {captcha}
                <SubmitButton busy={isSubmitting} busyLabel="Sending link…">Send reset link</SubmitButton>
            </form>
        </AuthShell>
    )
}
