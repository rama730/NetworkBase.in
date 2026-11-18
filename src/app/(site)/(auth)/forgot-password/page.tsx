'use client'

import Link from 'next/link'
import type { FormEvent } from 'react'
import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Input } from '@/components/ui/input'
import TurnstileWidget, { hasTurnstileSiteKey, SECURITY_CHECK_PROMPT } from '@/components/auth/TurnstileWidget'
import { AUTH_EMAIL_HANDOFF_KEY, AUTH_INPUT, AUTH_LINK, AuthAlert, AuthField, AuthShell, EmailCodeForm, SubmitButton, fieldError } from '@/components/auth/AuthShell'
import { AUTH_PANELS } from '@/components/auth/auth-panels'
import { loadBrowserSupabase, syncBrowserSessionToServer } from '@/lib/auth/browser-auth-actions'
import { resolveAuthPageErrorMessage } from '@/lib/auth/error-messages'

/** The reset email carries a 6-digit code and a link; both work on any device, so asking on a laptop and reading the email on a phone works. */
async function askForResetCode(email: string, captchaToken: string | null): Promise<string | null> {
    const response = await fetch('/api/v1/auth/email-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, purpose: 'reset', ...(captchaToken ? { captchaToken } : {}) }),
    }).catch(() => null)
    if (response?.ok) return null
    const body = await response?.json().catch(() => null) as { message?: string } | null
    return body?.message || 'We couldn’t send the reset email. Try again.'
}

export default function ForgotPasswordPage() {
    const router = useRouter()
    const [email, setEmail] = useState('')
    const [emailError, setEmailError] = useState<string | null>(null)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sent, setSent] = useState(false)
    const [captchaToken, setCaptchaToken] = useState<string | null>(null)
    // Turnstile tokens are single-use: every attempt remounts the widget for a fresh one.
    const [captchaKey, setCaptchaKey] = useState(0)
    const emailRef = useRef<HTMLInputElement | null>(null)
    const requiresCaptcha = hasTurnstileSiteKey()

    useEffect(() => {
        // An expired or used reset link lands here with ?error=reset-link-expired.
        setError(resolveAuthPageErrorMessage(new URLSearchParams(window.location.search).get('error')))
        try {
            const handoff = sessionStorage.getItem(AUTH_EMAIL_HANDOFF_KEY)
            if (handoff) setEmail(handoff)
            sessionStorage.removeItem(AUTH_EMAIL_HANDOFF_KEY)
        } catch {
            // Storage can be blocked; the field just starts empty.
        }
    }, [])

    const sendCode = async () => {
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
        const failed = await askForResetCode(email.trim(), captchaToken)
        setCaptchaToken(null)
        setCaptchaKey((key) => key + 1)
        setIsSubmitting(false)
        if (failed) {
            setError(failed)
            return
        }
        setSent(true)
    }

    if (sent) {
        return (
            <AuthShell
                title="Check your email"
                description={<>If an account exists for <span className="font-medium text-foreground">{email.trim()}</span>, we sent a 6-digit code and a link. Both work on any device. Check spam too.</>}
                panel={AUTH_PANELS.recovery}
                step={[2, 3]}
                footer={<button type="button" className={AUTH_LINK} onClick={() => { setSent(false); setError(null) }}>Use a different email</button>}
            >
                <EmailCodeForm
                    id="reset-code"
                    email={email.trim()}
                    label="Reset code"
                    submitLabel="Continue"
                    resendAction="forgot-password"
                    onVerify={async (code) => {
                        const supabase = await loadBrowserSupabase()
                        const { data, error: verifyError } = await supabase.auth.verifyOtp({ email: email.trim(), token: code, type: 'recovery' })
                        if (verifyError || !data.session) return 'That code is wrong or has expired. Check it, or send a new one.'
                        await syncBrowserSessionToServer(data.session).catch(() => null)
                        router.push('/reset-password')
                        return null
                    }}
                    onResend={(token) => askForResetCode(email.trim(), token)}
                />
            </AuthShell>
        )
    }

    return (
        <AuthShell
            title="Reset your password"
            description="Enter your account email and we’ll send you a code to choose a new password."
            panel={AUTH_PANELS.recovery}
            step={[1, 3]}
            footer={<>Remembered it? <Link href="/login" className={AUTH_LINK}>Sign in</Link></>}
        >
            <form onSubmit={(event: FormEvent) => { event.preventDefault(); void sendCode() }} className="space-y-4" noValidate>
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
                {requiresCaptcha ? (
                    <TurnstileWidget
                        key={captchaKey}
                        action="forgot-password"
                        onVerify={(token) => { setCaptchaToken(token); setError((current) => current === SECURITY_CHECK_PROMPT ? null : current) }}
                        onExpire={() => setCaptchaToken(null)}
                    />
                ) : null}
                <SubmitButton busy={isSubmitting} busyLabel="Sending code…">Send reset code</SubmitButton>
            </form>
        </AuthShell>
    )
}
