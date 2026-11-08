'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { adoptServerSessionIfMissing, loadBrowserSupabase, signInWithPassword as signIn, syncBrowserSessionToServer } from '@/lib/auth/browser-auth-actions'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import TurnstileWidget, { hasTurnstileSiteKey, SECURITY_CHECK_PROMPT } from '@/components/auth/TurnstileWidget'
import { GoogleOneTap } from '@/components/auth/GoogleOneTap'
import { AUTH_EMAIL_HANDOFF_KEY, AUTH_INPUT, AUTH_LINK, AuthAlert, AuthDivider, AuthField, AuthShell, CodeInput, EmailCodeForm, LastUsedTag, OAuthButtons, PasswordField, SubmitButton, fieldError } from '@/components/auth/AuthShell'
import { buildAuthPageHref, resolveAuthRedirectPath } from '@/lib/auth/redirects'
import { resolveAuthPageErrorMessage, toFriendlyAuthError } from '@/lib/auth/error-messages'
import { getTotpVerificationErrorMessage, needsSecondFactor } from '@/lib/auth/mfa-ui'
import { readSignInMethod, rememberSignInMethod, type SignInMethod } from '@/lib/auth/last-method'

const LOGIN_REQUEST_TIMEOUT_MS = 25_000
/** After this many wrong passwords in a row, the page offers a code or a reset instead. */
const WRONG_PASSWORD_HELP_AFTER = 3

const SIGN_IN_PANEL = {
    eyebrow: 'Welcome back',
    title: 'Pick up where you left off.',
    points: ['Your workspaces and tasks', 'Conversations with your team', "People you’ve connected with"],
}
const MFA_PANEL = { eyebrow: 'Two-step verification', title: 'Two-step sign-in keeps your account yours.' }
const CODE_PANEL = { eyebrow: 'Sign in with a code', title: 'No password needed. Just your inbox.' }

type Step = 'password' | 'mfa' | 'email-code' | 'confirm-email'

function toSignInErrorMessage(message: string, lastUsed: SignInMethod | null) {
    if (/invalid login credentials/i.test(message)) {
        // Someone who joined with Google or GitHub has no password: say so instead of "doesn't match".
        if (lastUsed === 'google' || lastUsed === 'github') return `That email and password don’t match. You last signed in with ${lastUsed === 'google' ? 'Google' : 'GitHub'} on this browser: try that button above.`
        return "That email and password don’t match. Try again or reset your password."
    }
    return toFriendlyAuthError(message, 'Sign in failed. Try again.')
}

async function askForEmailCode(email: string, captchaToken: string | null, next: string): Promise<string | null> {
    const response = await fetch('/api/v1/auth/email-code', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ email, purpose: 'sign-in', next, ...(captchaToken ? { captchaToken } : {}) }),
    }).catch(() => null)
    if (response?.ok) return null
    const body = await response?.json().catch(() => null) as { message?: string } | null
    return body?.message || 'We couldn’t send a code. Try again in a minute.'
}

export function LoginForm({ redirect, error, step: stepParam }: { redirect: string | null; error: string | null; step: string | null }) {
    const router = useRouter()
    const redirectPath = resolveAuthRedirectPath(redirect)
    const signupHref = buildAuthPageHref('/signup', redirectPath)
    const requiresCaptcha = hasTurnstileSiteKey()

    const [step, setStep] = useState<Step>(stepParam === 'mfa' ? 'mfa' : 'password')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({})
    const [formError, setFormError] = useState<string | null>(null)
    const [queryErrorDismissed, setQueryErrorDismissed] = useState(false)
    const [busy, setBusy] = useState(false)
    const [captchaToken, setCaptchaToken] = useState<string | null>(null)
    // Turnstile tokens are single-use: a failed attempt remounts the widget for a fresh one.
    const [captchaKey, setCaptchaKey] = useState(0)
    const [wrongPasswords, setWrongPasswords] = useState(0)
    const [lastUsed, setLastUsed] = useState<SignInMethod | null>(null)
    const [code, setCode] = useState('')
    const [codeError, setCodeError] = useState<string | null>(null)
    const [recoveryMode, setRecoveryMode] = useState(false)
    const [recoveryCode, setRecoveryCode] = useState('')
    const [recovered, setRecovered] = useState(false)
    const [trustBrowser, setTrustBrowser] = useState(false)
    const [canTrust, setCanTrust] = useState(true)
    const emailRef = useRef<HTMLInputElement | null>(null)
    const passwordRef = useRef<HTMLInputElement | null>(null)
    const codeRef = useRef<HTMLInputElement | null>(null)

    const queryError = queryErrorDismissed ? null : resolveAuthPageErrorMessage(error)
    const shownError = formError ?? queryError

    useEffect(() => setQueryErrorDismissed(false), [error])
    useEffect(() => {
        if (step === 'mfa') codeRef.current?.focus()
    }, [step])
    useEffect(() => {
        setLastUsed(readSignInMethod())
        // The email typed on the reset page comes along after a new password (never in the address).
        try {
            const handoff = sessionStorage.getItem(AUTH_EMAIL_HANDOFF_KEY)
            if (handoff) setEmail(handoff)
            sessionStorage.removeItem(AUTH_EMAIL_HANDOFF_KEY)
        } catch {
            // Storage can be blocked; the field just starts empty.
        }
    }, [])
    useEffect(() => {
        if (step !== 'mfa') return
        // Staff tools need the code every time, so their browsers are never trusted.
        void loadBrowserSupabase().then((supabase) => supabase.auth.getSession()).then(({ data }) => {
            const role = data.session?.user.app_metadata?.role
            setCanTrust(role !== 'admin' && role !== 'moderator')
        }).catch(() => null)
    }, [step])

    const clearFormError = () => {
        setFormError(null)
        setQueryErrorDismissed(true)
    }
    const renewCaptcha = () => {
        setCaptchaToken(null)
        setCaptchaKey((key) => key + 1)
    }

    /** Signed in (password or code): on to the code step if the account has one, unless this browser is trusted. */
    const continueAfterFirstStep = async (method: SignInMethod) => {
        rememberSignInMethod(method)
        const supabase = await loadBrowserSupabase()
        const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel()
        if (aal && needsSecondFactor(aal.currentLevel, aal.nextLevel === 'aal2')) {
            const trusted = await fetch('/api/v1/auth/trusted-browser', { credentials: 'same-origin', cache: 'no-store' })
                .then((response) => response.json()).then((body) => body?.data?.signedIn === true).catch(() => false)
            if (!trusted) {
                setStep('mfa')
                return false
            }
        }
        router.push(redirectPath)
        return true
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
                renewCaptcha()
                // Not confirmed yet: the code box and a new code right here, instead of a dead end.
                if (/email not confirmed/i.test(result.error.message)) {
                    setStep('confirm-email')
                    return
                }
                if (/invalid login credentials/i.test(result.error.message)) setWrongPasswords((count) => count + 1)
                setFormError(toSignInErrorMessage(result.error.message, lastUsed))
                return
            }
            leaving = await continueAfterFirstStep('password')
        } catch (signInError) {
            setFormError(signInError instanceof Error && signInError.message === 'LOGIN_TIMEOUT'
                ? 'Sign in is taking too long. Check your connection and try again.'
                : 'Something went wrong. Try again.')
        } finally {
            if (!leaving) setBusy(false)
        }
    }

    /** "Email me a sign-in code": uses the email typed above and the page's security check. */
    const startEmailCode = async () => {
        clearFormError()
        if (!email.trim()) {
            setFieldErrors({ email: 'Enter your email, then ask for a code.' })
            emailRef.current?.focus()
            return
        }
        if (requiresCaptcha && !captchaToken) {
            setFormError(SECURITY_CHECK_PROMPT)
            return
        }
        setBusy(true)
        const failed = await askForEmailCode(email.trim(), captchaToken, redirectPath)
        renewCaptcha()
        setBusy(false)
        if (failed) {
            setFormError(failed)
            return
        }
        setStep('email-code')
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
            if (trustBrowser && canTrust) {
                await fetch('/api/v1/auth/trusted-browser', { method: 'POST', credentials: 'same-origin' }).catch(() => null)
            }
            leaving = true
            // A full load so the server sees the upgraded session cookie.
            window.location.assign(redirectPath)
        } catch {
            setCodeError("Couldn’t check the code. Try again.")
        } finally {
            if (!leaving) setBusy(false)
        }
    }

    /** Lost the authenticator: a recovery code turns two-step off so the person can get in and set it up again. */
    const submitRecoveryCode = async (event: FormEvent) => {
        event.preventDefault()
        if (!recoveryCode.trim()) {
            setCodeError('Enter one of your recovery codes.')
            return
        }
        setBusy(true)
        setCodeError(null)
        try {
            const supabase = await loadBrowserSupabase()
            await adoptServerSessionIfMissing()
            const { data } = await supabase.auth.getSession()
            if (!data.session) {
                setStep('password')
                setFormError('Your sign-in expired. Sign in again to continue.')
                return
            }
            const response = await fetch('/api/v1/auth/mfa/recover', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                credentials: 'same-origin',
                body: JSON.stringify({ accessToken: data.session.access_token, code: recoveryCode.trim() }),
            })
            const body = await response.json().catch(() => null) as { message?: string } | null
            if (!response.ok) {
                setCodeError(body?.message || 'That recovery code didn’t work.')
                return
            }
            const { data: refreshed } = await supabase.auth.refreshSession()
            await syncBrowserSessionToServer(refreshed.session).catch(() => null)
            setRecovered(true)
        } catch {
            setCodeError('Couldn’t check the code. Try again.')
        } finally {
            setBusy(false)
        }
    }

    const switchAccount = async () => {
        setBusy(true)
        const supabase = await loadBrowserSupabase()
        await supabase.auth.signOut().catch(() => null)
        await syncBrowserSessionToServer(null).catch(() => null)
        window.location.assign(buildAuthPageHref('/login', redirectPath))
    }

    const backToPassword = () => {
        setStep('password')
        clearFormError()
    }

    if (step === 'email-code' || step === 'confirm-email') {
        const confirming = step === 'confirm-email'
        return (
            <AuthShell
                title={confirming ? 'Confirm your email first' : 'Check your email'}
                description={<>{confirming ? 'Your account isn’t confirmed yet. Enter the 6-digit code we sent to' : 'We sent a 6-digit sign-in code to'} <span className="font-medium text-foreground">{email.trim()}</span>{confirming ? '. Lost it? Send a new one below.' : '. It works once and expires within the hour.'}</>}
                panel={CODE_PANEL}
                footer={<button type="button" className={AUTH_LINK} onClick={backToPassword}>Back to sign in</button>}
            >
                <EmailCodeForm
                    id="email-code"
                    email={email.trim()}
                    label={confirming ? 'Confirmation code' : 'Sign-in code'}
                    submitLabel={confirming ? 'Confirm and sign in' : 'Sign in'}
                    resendAction="login"
                    onVerify={async (value) => {
                        const supabase = await loadBrowserSupabase()
                        const { data, error: verifyError } = await supabase.auth.verifyOtp({ email: email.trim(), token: value, type: confirming ? 'signup' : 'magiclink' })
                        if (verifyError || !data.session) return 'That code is wrong or has expired. Check it, or send a new one.'
                        await syncBrowserSessionToServer(data.session).catch(() => null)
                        await continueAfterFirstStep(confirming ? 'password' : 'code')
                        return null
                    }}
                    onResend={async (token) => {
                        if (!confirming) return askForEmailCode(email.trim(), token, redirectPath)
                        const supabase = await loadBrowserSupabase()
                        const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: email.trim(), options: token ? { captchaToken: token } : undefined })
                        return resendError ? toFriendlyAuthError(resendError.message, 'We couldn’t send a new code. Try again in a minute.') : null
                    }}
                />
            </AuthShell>
        )
    }

    if (step === 'mfa') {
        if (recovered) {
            return (
                <AuthShell title="You’re back in" description="Two-step verification is now off, and we emailed you about it. Set it up again with your new device to keep your account protected." panel={MFA_PANEL}>
                    <div className="nb-auth-step space-y-3">
                        <Button asChild className="h-11 w-full font-medium"><a href="/settings#settings-security">Set up two-step again</a></Button>
                        <Button asChild variant="ghost" className="h-11 w-full"><a href={redirectPath}>Later</a></Button>
                    </div>
                </AuthShell>
            )
        }
        return (
            <AuthShell
                title={recoveryMode ? 'Use a recovery code' : 'Enter your code'}
                description={recoveryMode
                    ? 'Enter one of the recovery codes you saved when you set up two-step verification. Each code works once.'
                    : 'Open your authenticator app and enter the 6-digit code for NetworkBase.'}
                panel={MFA_PANEL}
                footer={<>No recovery codes either? <a className={AUTH_LINK} href="mailto:support@networkbase.in">Contact support</a></>}
            >
                {recoveryMode ? (
                    <form onSubmit={(event) => void submitRecoveryCode(event)} className="nb-auth-step space-y-4" noValidate>
                        <AuthField id="recovery-code" label="Recovery code" error={codeError}>
                            <Input
                                id="recovery-code"
                                value={recoveryCode}
                                onChange={(event) => { setRecoveryCode(event.target.value); setCodeError(null) }}
                                autoComplete="off"
                                autoCapitalize="off"
                                spellCheck={false}
                                placeholder="xxxx-xxxx"
                                className={`${AUTH_INPUT} font-mono`}
                                disabled={busy}
                                {...fieldError('recovery-code', codeError)}
                            />
                        </AuthField>
                        <p className="nb-auth-note text-muted-foreground">This turns two-step verification off so you can get in. Set it up again with your new device right after.</p>
                        <SubmitButton busy={busy} busyLabel="Checking…">Use this code</SubmitButton>
                        <Button type="button" variant="ghost" className="h-11 w-full" onClick={() => { setRecoveryMode(false); setCodeError(null) }} disabled={busy}>
                            Use my authenticator app
                        </Button>
                    </form>
                ) : (
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
                        {canTrust ? (
                            <label className="flex min-h-11 cursor-pointer items-center gap-3 text-sm">
                                <input type="checkbox" checked={trustBrowser} onChange={(event) => setTrustBrowser(event.target.checked)} className="size-4 accent-[var(--primary)]" />
                                Trust this browser for 30 days
                            </label>
                        ) : null}
                        <SubmitButton busy={busy} busyLabel="Verifying…">Verify</SubmitButton>
                        <div className="flex items-center justify-between gap-3 text-sm">
                            <button type="button" className="min-h-11 text-muted-foreground hover:text-foreground" onClick={() => void switchAccount()} disabled={busy}>
                                Use a different account
                            </button>
                            <button type="button" className="min-h-11 font-medium text-primary underline-offset-4 hover:underline" onClick={() => { setRecoveryMode(true); setCodeError(null) }} disabled={busy}>
                                Lost your device?
                            </button>
                        </div>
                    </form>
                )}
            </AuthShell>
        )
    }

    const showWrongPasswordHelp = wrongPasswords >= WRONG_PASSWORD_HELP_AFTER
    return (
        <AuthShell
            title="Welcome back"
            description={redirect ? 'Sign in to continue where you left off.' : 'Sign in to your NetworkBase account.'}
            panel={SIGN_IN_PANEL}
            footer={<>New to NetworkBase? <Link className={AUTH_LINK} href={signupHref}>Create an account</Link></>}
        >
            {/* One check for every way in, out of sight unless Cloudflare needs a click. */}
            {requiresCaptcha ? (
                <TurnstileWidget
                    key={captchaKey}
                    action="login"
                    onVerify={(token) => { setCaptchaToken(token); setFormError((current) => current === SECURITY_CHECK_PROMPT ? null : current) }}
                    onExpire={() => setCaptchaToken(null)}
                />
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
                    aside={
                        <Link
                            href="/forgot-password"
                            onClick={() => {
                                try {
                                    if (email.trim()) sessionStorage.setItem(AUTH_EMAIL_HANDOFF_KEY, email.trim())
                                } catch {
                                    // Storage can be blocked; the forgot page just starts empty.
                                }
                            }}
                            className="-my-3 inline-flex min-h-11 items-center text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                        >
                            Forgot password?
                        </Link>
                    }
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
                {showWrongPasswordHelp ? (
                    <div className="grid grid-cols-2 gap-3" role="group" aria-label="Other ways in">
                        <Button type="button" variant="outline" className="h-11" onClick={() => void startEmailCode()} disabled={busy}>Email me a code</Button>
                        <Button asChild variant="outline" className="h-11"><Link href="/forgot-password">Reset password</Link></Button>
                    </div>
                ) : null}
                <SubmitButton busy={busy} busyLabel="Signing in…" className="relative h-11 w-full font-medium">
                    Sign in{lastUsed === 'password' ? <LastUsedTag /> : null}
                </SubmitButton>
                {showWrongPasswordHelp ? null : (
                    <Button type="button" variant="ghost" className="relative h-11 w-full" onClick={() => void startEmailCode()} disabled={busy}>
                        Email me a sign-in code instead{lastUsed === 'code' ? <LastUsedTag /> : null}
                    </Button>
                )}
            </form>
        </AuthShell>
    )
}
