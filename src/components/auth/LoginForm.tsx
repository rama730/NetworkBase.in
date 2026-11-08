'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { adoptServerSessionIfMissing, loadBrowserSupabase, signInWithPassword as signIn, syncBrowserSessionToServer } from '@/lib/auth/browser-auth-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import TurnstileWidget, { hasTurnstileSiteKey, SECURITY_CHECK_PROMPT } from '@/components/auth/TurnstileWidget'
import { GoogleOneTap } from '@/components/auth/GoogleOneTap'
import { AUTH_EMAIL_HANDOFF_KEY, AUTH_INPUT, AUTH_LINK, AuthAlert, AuthDivider, AuthField, AuthShell, CodeInput, OAuthButtons, PasswordField, SubmitButton, fieldError } from '@/components/auth/AuthShell'
import { buildAuthPageHref, resolveAuthRedirectPath } from '@/lib/auth/redirects'
import { resolveAuthPageErrorMessage, toFriendlyAuthError } from '@/lib/auth/error-messages'
import { getTotpVerificationErrorMessage, needsSecondFactor } from '@/lib/auth/mfa-ui'

const LOGIN_REQUEST_TIMEOUT_MS = 25_000

const SIGN_IN_PANEL = {
    eyebrow: 'Welcome back',
    title: 'Pick up where you left off.',
    points: ['Your workspaces and tasks', 'Conversations with your team', "People you’ve connected with"],
}
const MFA_PANEL = { eyebrow: 'Two-step verification', title: 'Two-step sign-in keeps your account yours.' }

function toSignInErrorMessage(message: string) {
    if (/invalid login credentials/i.test(message)) return "That email and password don’t match. Try again or reset your password."
    if (/email not confirmed/i.test(message)) return 'Confirm your email first. Check your inbox for the link we sent.'
    return toFriendlyAuthError(message, 'Sign in failed. Try again.')
}

export function LoginForm({ redirect, error, step: stepParam }: { redirect: string | null; error: string | null; step: string | null }) {
    const router = useRouter()
    const redirectPath = resolveAuthRedirectPath(redirect)
    const signupHref = buildAuthPageHref('/signup', redirectPath)
    const requiresCaptcha = hasTurnstileSiteKey()

    const [step, setStep] = useState<'password' | 'mfa'>(stepParam === 'mfa' ? 'mfa' : 'password')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
    const [formError, setFormError] = useState<string | null>(null)
    const [queryErrorDismissed, setQueryErrorDismissed] = useState(false)
    const [busy, setBusy] = useState(false)
    const [captchaToken, setCaptchaToken] = useState<string | null>(null)
    // Turnstile tokens are single-use: a failed attempt remounts the widget for a fresh one.
    const [captchaKey, setCaptchaKey] = useState(0)
    const [code, setCode] = useState('')
    const [codeError, setCodeError] = useState<string | null>(null)
    const emailRef = useRef<HTMLInputElement | null>(null)
    const passwordRef = useRef<HTMLInputElement | null>(null)
    const codeRef = useRef<HTMLInputElement | null>(null)

    const queryError = queryErrorDismissed ? null : resolveAuthPageErrorMessage(error)
    const shownError = formError ?? queryError

    useEffect(() => setQueryErrorDismissed(false), [error])
    useEffect(() => {
        if (step === 'mfa') codeRef.current?.focus()
    }, [step])

    const clearFormError = () => {
        setFormError(null)
        setQueryErrorDismissed(true)
    }
    const renewCaptcha = () => {
        setCaptchaToken(null)
        setCaptchaKey((key) => key + 1)
    }

    const handleSignIn = async (event: FormEvent) => {
        event.preventDefault()
        clearFormError()
        const errors = {
            email: email.trim() ? undefined : 'Enter your email.',
            password: password ? undefined : 'Enter your password.',
        }
        setFieldErrors(errors)
        if (errors.email || errors.password) {
            ;(errors.email ? emailRef : passwordRef).current?.focus()
            return
        }
        if (requiresCaptcha && !captchaToken) {
            setFormError(SECURITY_CHECK_PROMPT)
            return
        }

        setBusy(true)
        let leaving = false
        try {
            const result = await Promise.race([
                signIn(email.trim(), password, captchaToken || undefined),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('LOGIN_TIMEOUT')), LOGIN_REQUEST_TIMEOUT_MS)),
            ])
            if (result.error) {
                setFormError(toSignInErrorMessage(result.error.message))
                setCaptchaToken(null)
                setCaptchaKey((key) => key + 1)
                return
            }
            const supabase = await loadBrowserSupabase()
            const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
            if (aal && needsSecondFactor(aal.currentLevel, aal.nextLevel === 'aal2')) {
                setStep('mfa')
                return
            }
            leaving = true
            router.push(redirectPath)
        } catch (signInError) {
            setFormError(signInError instanceof Error && signInError.message === 'LOGIN_TIMEOUT'
                ? 'Sign in is taking too long. Check your connection and try again.'
                : 'Something went wrong. Try again.')
        } finally {
            if (!leaving) setBusy(false)
        }
    }

    const verifyCode = async (value: string) => {
        if (value.length !== 6) {
            setCodeError('Enter the 6-digit code.')
            codeRef.current?.focus()
            return
        }
        setBusy(true)
        setCodeError(null)
        let leaving = false
        try {
            const supabase = await loadBrowserSupabase()
            await adoptServerSessionIfMissing()
            const { data: factors, error: listError } = await supabase.auth.mfa.listFactors()
            if (listError) {
                setStep('password')
                setFormError('Your sign-in expired. Sign in again to continue.')
                return
            }
            const factor = (factors?.totp ?? []).find((candidate: { id: string; status: string }) => candidate.status === 'verified')
            if (!factor) {
                setCodeError('No authenticator app is set up on this account. Contact support.')
                return
            }
            const { error: verifyError } = await supabase.auth.mfa.challengeAndVerify({ factorId: factor.id, code: value })
            if (verifyError) {
                setCodeError(getTotpVerificationErrorMessage(verifyError))
                setCode('')
                codeRef.current?.focus()
                return
            }
            const { data } = await supabase.auth.getSession()
            await syncBrowserSessionToServer(data.session).catch(() => null)
            leaving = true
            // A full load so the server sees the upgraded session cookie.
            window.location.assign(redirectPath)
        } catch {
            setCodeError("Couldn’t check the code. Try again.")
        } finally {
            if (!leaving) setBusy(false)
        }
    }

    const switchAccount = async () => {
        setBusy(true)
        const supabase = await loadBrowserSupabase()
        await supabase.auth.signOut().catch(() => null)
        await syncBrowserSessionToServer(null).catch(() => null)
        window.location.assign(buildAuthPageHref('/login', redirectPath))
    }

    if (step === 'mfa') {
        return (
            <AuthShell
                title="Enter your code"
                description="Open your authenticator app and enter the 6-digit code for NetworkBase."
                panel={MFA_PANEL}
                footer={<>Lost your device? <a className={AUTH_LINK} href="mailto:support@networkbase.in">Contact support</a></>}
            >
                <form onSubmit={(event) => { event.preventDefault(); void verifyCode(code) }} className="nb-auth-step space-y-4" noValidate>
                    <AuthField id="mfa-code" label="Authentication code" error={codeError}>
                        <CodeInput
                            ref={codeRef}
                            id="mfa-code"
                            value={code}
                            onChange={(value) => { setCode(value); setCodeError(null) }}
                            onComplete={(value) => void verifyCode(value)}
                            disabled={busy}
                            {...fieldError('mfa-code', codeError)}
                        />
                    </AuthField>
                    <SubmitButton busy={busy} busyLabel="Verifying…">Verify</SubmitButton>
                    <Button type="button" variant="ghost" className="h-11 w-full" onClick={() => void switchAccount()} disabled={busy}>
                        Use a different account
                    </Button>
                </form>
            </AuthShell>
        )
    }

    return (
        <AuthShell
            title="Welcome back"
            description={redirect ? 'Sign in to continue where you left off.' : 'Sign in to your NetworkBase account.'}
            panel={SIGN_IN_PANEL}
            footer={<>New to NetworkBase? <Link className={AUTH_LINK} href={signupHref}>Create an account</Link></>}
        >
            {/* One check for every way in: Google, GitHub and One Tap use it as well as the email form. */}
            {requiresCaptcha ? (
                <div className="mb-4">
                    <TurnstileWidget
                        key={captchaKey}
                        action="login"
                        onVerify={(token) => { setCaptchaToken(token); setFormError((current) => current === SECURITY_CHECK_PROMPT ? null : current) }}
                        onExpire={() => setCaptchaToken(null)}
                    />
                </div>
            ) : null}
            <GoogleOneTap nextPath={redirectPath} onError={setFormError} captchaToken={captchaToken} onCaptchaUsed={renewCaptcha} />
            <OAuthButtons next={redirectPath} disabled={busy} onError={setFormError} captchaToken={captchaToken} onCaptchaUsed={renewCaptcha} />
            <AuthDivider />
            <form onSubmit={handleSignIn} className="space-y-4" noValidate>
                {shownError ? <AuthAlert tone="error">{shownError}</AuthAlert> : null}
                <AuthField id="email" label="Email" error={fieldErrors.email}>
                    <Input
                        ref={emailRef}
                        id="email"
                        type="email"
                        autoComplete="username email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(event) => {
                            clearFormError()
                            setFieldErrors((errors) => ({ ...errors, email: undefined }))
                            setEmail(event.target.value)
                        }}
                        className={AUTH_INPUT}
                        disabled={busy}
                        {...fieldError('email', fieldErrors.email)}
                    />
                </AuthField>
                <AuthField
                    id="password"
                    label="Password"
                    error={fieldErrors.password}
                >
                    <PasswordField
                        ref={passwordRef}
                        id="password"
                        autoComplete="current-password"
                        placeholder="Enter your password"
                        value={password}
                        onChange={(event) => {
                            clearFormError()
                            setFieldErrors((errors) => ({ ...errors, password: undefined }))
                            setPassword(event.target.value)
                        }}
                        disabled={busy}
                        {...fieldError('password', fieldErrors.password)}
                    />
                </AuthField>
                <div className="-mt-2 flex justify-end">
                    <Link
                        href="/forgot-password"
                        onClick={() => {
                            try {
                                if (email.trim()) sessionStorage.setItem(AUTH_EMAIL_HANDOFF_KEY, email.trim())
                            } catch {
                                // Storage can be blocked; the forgot page just starts empty.
                            }
                        }}
                        className="inline-flex min-h-11 items-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                    >
                        Forgot password?
                    </Link>
                </div>
                <SubmitButton busy={busy} busyLabel="Signing in…">Sign in</SubmitButton>
            </form>
        </AuthShell>
    )
}
