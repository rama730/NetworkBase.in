'use client'

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ArrowLeft, Check, Loader2 } from 'lucide-react'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { loadBrowserSupabase, signUpWithPassword as signUp, verifyEmailOtp as verifyOtp } from '@/lib/auth/browser-auth-actions'
import { Input } from '@/components/ui/input'
import TurnstileWidget, { hasTurnstileSiteKey } from '@/components/auth/TurnstileWidget'
import { GoogleOneTap } from '@/components/auth/GoogleOneTap'
import { AUTH_INPUT, AUTH_LINK, AuthAlert, AuthDivider, AuthField, AuthShell, CodeInput, OAuthButtons, PasswordField, SubmitButton, fieldError } from '@/components/auth/AuthShell'
import { PasswordStrengthMeter } from '@/components/settings/PasswordStrengthMeter'
import { buildAuthPageHref, resolveAuthRedirectPath } from '@/lib/auth/redirects'
import { toFriendlyAuthError } from '@/lib/auth/error-messages'
import { getPasswordPolicyResult } from '@/lib/security/password-policy'
import { detectEmailDomainTypo } from '@/lib/validations/email-typo'
import { sanitizeUsernameInput } from '@/lib/validations/username'
import { isDisposableEmail } from '@/lib/validations/disposable-email'

const DUPLICATE_EMAIL_MESSAGE = 'This email has already been used to create an account'
const SIGNUP_REQUEST_TIMEOUT_MS = 15_000
const RESEND_COOLDOWN_SECONDS = 60
const DRAFT_KEY = 'nb_signup_draft'

const SIGNUP_PANEL = {
    eyebrow: 'Get started',
    title: 'Your first workspace is three steps away.',
    points: ['Add your skills', 'Find or start a workspace', 'Invite people and get going'],
}
const VERIFY_PANEL = {
    eyebrow: 'One last step',
    title: 'Verified email keeps NetworkBase real.',
    points: ['Keeps spam accounts out', 'Lets you recover your account', 'Unlocks messages and workspaces'],
}

type FieldKey = 'fullName' | 'email' | 'password' | 'confirmPassword' | 'legal'

function toErrorMessage(authError: unknown): string {
    const raw = typeof authError === 'object' && authError !== null && 'message' in authError
        ? String((authError as { message?: unknown }).message || '')
        : String(authError || '')
    if (/already (been )?registered|already exists/i.test(raw)) return DUPLICATE_EMAIL_MESSAGE
    return toFriendlyAuthError(raw, "We couldn’t create your account. Try again.")
}

function isDuplicateObfuscatedResponse(payload: unknown): boolean {
    const identities = (payload as { data?: { user?: { identities?: unknown[] } } } | null)?.data?.user?.identities
    return Array.isArray(identities) && identities.length === 0
}

function clearDraft() {
    try {
        sessionStorage.removeItem(DRAFT_KEY)
    } catch {
        // Storage can be blocked.
    }
}

export function SignupForm({ redirect, invite, referral, project }: { redirect: string | null; invite: string | null; referral?: string | null; project: string | null }) {
    const router = useRouter()
    const redirectPath = resolveAuthRedirectPath(redirect)
    const loginHref = buildAuthPageHref('/login', redirectPath)
    const inviteParam = invite || referral || project
    const afterSignupPath = inviteParam
        ? `${redirectPath}${redirectPath.includes('?') ? '&' : '?'}invite=${encodeURIComponent(inviteParam)}`
        : redirectPath
    // One Tap skips the OAuth callback, so it is sent through the same agreement step first. Someone who has
    // already agreed passes straight through it.
    const oneTapNextPath = `/legal/accept?context=oauth_signup&next=${encodeURIComponent(afterSignupPath)}`
    const requiresCaptcha = hasTurnstileSiteKey()

    const [fullName, setFullName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [legalAccepted, setLegalAccepted] = useState(false)
    const [honeypot, setHoneypot] = useState('')
    const [captchaToken, setCaptchaToken] = useState<string | null>(null)
    const [captchaKey, setCaptchaKey] = useState(0)
    const [fieldErrors, setFieldErrors] = useState<Partial<Record<FieldKey, string>>>({})
    const [formError, setFormError] = useState<string | null>(null)
    const [isLoading, setIsLoading] = useState(false)
    const [handleStatus, setHandleStatus] = useState<'idle' | 'checking' | 'available' | 'taken'>('idle')
    const idempotencyKeyRef = useRef<string>(
        typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : String(Date.now())
    )
    const fieldRefs = useRef<Partial<Record<FieldKey, HTMLInputElement | null>>>({})

    const [isVerifyingOtp, setIsVerifyingOtp] = useState(false)
    const [otp, setOtp] = useState('')
    const [isOtpLoading, setIsOtpLoading] = useState(false)
    const [otpError, setOtpError] = useState<string | null>(null)
    const [resendCooldown, setResendCooldown] = useState(0)
    const [resendMessage, setResendMessage] = useState<string | null>(null)
    const [resendCaptchaToken, setResendCaptchaToken] = useState<string | null>(null)
    const otpInputRef = useRef<HTMLInputElement | null>(null)

    const suggestedHandle = useMemo(() => (fullName.trim() ? sanitizeUsernameInput(fullName.trim().replace(/\s+/g, '_')) : ''), [fullName])
    const emailTypo = useMemo(() => detectEmailDomainTypo(email), [email])
    const isDisposable = useMemo(() => isDisposableEmail(email), [email])
    const passwordPolicy = useMemo(() => getPasswordPolicyResult(password), [password])

    // Restore non-sensitive draft fields (fullName, email) from sessionStorage
    useEffect(() => {
        try {
            const draft = JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null') as { fullName?: string; email?: string } | null
            if (draft?.fullName) setFullName(draft.fullName)
            if (draft?.email) setEmail(draft.email)
        } catch {
            // Ignore storage access issues
        }
    }, [])

    useEffect(() => {
        try {
            if (fullName || email) sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ fullName, email }))
        } catch {
            // Ignore storage write issues
        }
    }, [fullName, email])

    // Debounced live handle availability check
    useEffect(() => {
        if (!suggestedHandle || suggestedHandle.length < 3) {
            setHandleStatus('idle')
            return
        }
        setHandleStatus('checking')
        const controller = new AbortController()
        const timer = setTimeout(async () => {
            try {
                const res = await fetch(`/api/v1/onboarding/username-check?username=${encodeURIComponent(suggestedHandle)}`, { signal: controller.signal })
                const json = (await res.json().catch(() => null)) as { data?: { available?: boolean } } | null
                setHandleStatus(json?.data ? (json.data.available ? 'available' : 'taken') : 'idle')
            } catch (err) {
                if ((err as Error)?.name !== 'AbortError') setHandleStatus('idle')
            }
        }, 400)
        return () => {
            clearTimeout(timer)
            controller.abort()
        }
    }, [suggestedHandle])

    // If the person confirms through the email link in another tab or device, move on automatically.
    useEffect(() => {
        if (!isVerifyingOtp) return
        let cancelled = false
        let unsubscribe: (() => void) | null = null
        void loadBrowserSupabase().then((supabase) => {
            if (cancelled) return
            const { data: { subscription } } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
                if (session?.user) {
                    clearDraft()
                    router.push(redirectPath)
                }
            })
            unsubscribe = () => subscription.unsubscribe()
        })
        return () => {
            cancelled = true
            unsubscribe?.()
        }
    }, [isVerifyingOtp, redirectPath, router])

    useEffect(() => {
        if (resendCooldown <= 0) return
        const timer = setInterval(() => setResendCooldown((prev) => Math.max(0, prev - 1)), 1000)
        return () => clearInterval(timer)
    }, [resendCooldown])

    const clearField = (key: FieldKey) => {
        setFormError(null)
        setFieldErrors((errors) => ({ ...errors, [key]: undefined }))
    }

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault()
        setFormError(null)

        const errors: Partial<Record<FieldKey, string>> = {
            fullName: fullName.trim() ? undefined : 'Enter your full name.',
            email: !email.trim() ? 'Enter your email.' : isDisposable ? "Use a permanent email address. Temporary inboxes aren’t allowed." : undefined,
            password: passwordPolicy.ok ? undefined : passwordPolicy.error || 'Choose a stronger password.',
            confirmPassword: password === confirmPassword ? undefined : "Passwords don’t match.",
            legal: legalAccepted ? undefined : 'Accept the terms to create your account.',
        }
        setFieldErrors(errors)
        const firstInvalid = (['fullName', 'email', 'password', 'confirmPassword', 'legal'] as const).find((key) => errors[key])
        if (firstInvalid) {
            fieldRefs.current[firstInvalid]?.focus()
            return
        }
        if (!captchaToken) {
            setFormError('Complete the security check above the button.')
            return
        }

        setIsLoading(true)
        try {
            const signUpResult = await Promise.race([
                signUp(email.trim(), password, fullName.trim(), captchaToken || undefined, legalAccepted, {
                    suggestedUsername: suggestedHandle || undefined,
                    inviteToken: inviteParam || undefined,
                    website_hp: honeypot || undefined,
                    idempotencyKey: idempotencyKeyRef.current,
                }),
                new Promise<never>((_, reject) => setTimeout(() => reject(new Error('Request timeout')), SIGNUP_REQUEST_TIMEOUT_MS)),
            ])

            const authError = (signUpResult as { error?: unknown } | null)?.error
            if (isDuplicateObfuscatedResponse(signUpResult) || authError) {
                setFormError(authError ? toErrorMessage(authError) : DUPLICATE_EMAIL_MESSAGE)
                if (requiresCaptcha) {
                    setCaptchaToken(null)
                    setCaptchaKey((key) => key + 1)
                }
                return
            }

            const data = (signUpResult as { data?: { session?: unknown; user?: unknown } } | null)?.data
            if (data?.session) {
                clearDraft()
                router.push(redirectPath)
                return
            }
            if (data?.user) {
                setIsVerifyingOtp(true)
                setResendCooldown(RESEND_COOLDOWN_SECONDS)
                setTimeout(() => otpInputRef.current?.focus(), 150)
                return
            }
            setFormError("We couldn’t create your account. Try again.")
        } catch (signupError) {
            setFormError(signupError instanceof Error && signupError.message === 'Request timeout'
                ? 'Creating your account is taking too long. Check your connection and try again.'
                : 'Something went wrong. Try again.')
        } finally {
            setIsLoading(false)
        }
    }

    const handleVerifyOtp = async (code: string) => {
        if (code.length !== 6) {
            setOtpError('Enter the 6-digit code.')
            otpInputRef.current?.focus()
            return
        }
        setIsOtpLoading(true)
        setOtpError(null)
        try {
            const res = await verifyOtp(email, code, 'signup')
            if (res.error) {
                setOtpError(res.error.message || 'That code is wrong or has expired.')
                setOtp('')
                otpInputRef.current?.focus()
                return
            }
            clearDraft()
            router.push(redirectPath)
        } catch {
            setOtpError("Couldn’t check the code. Try again.")
        } finally {
            setIsOtpLoading(false)
        }
    }

    const handleResendOtp = async () => {
        if (resendCooldown > 0) return
        setOtpError(null)
        setResendMessage(null)
        if (requiresCaptcha && !resendCaptchaToken) {
            setOtpError('Complete the security check, then resend.')
            return
        }
        try {
            const supabase = await loadBrowserSupabase()
            const { error } = await supabase.auth.resend({
                type: 'signup',
                email: email.trim(),
                options: resendCaptchaToken ? { captchaToken: resendCaptchaToken } : undefined,
            })
            setResendCaptchaToken(null)
            if (error) {
                setOtpError(toFriendlyAuthError(error.message, "We couldn’t send a new code. Try again in a minute."))
                return
            }
            setResendCooldown(RESEND_COOLDOWN_SECONDS)
            setResendMessage(`We sent a new code to ${email.trim()}.`)
        } catch {
            setOtpError("We couldn’t send a new code. Try again in a minute.")
        }
    }

    if (isVerifyingOtp) {
        return (
            <AuthShell
                title="Check your email"
                description={<>We sent a 6-digit code to <span className="font-medium text-foreground">{email}</span>. Enter it below or use the link in the email.</>}
                panel={VERIFY_PANEL}
                footer={<>Already have an account? <Link href={loginHref} className={AUTH_LINK}>Sign in</Link></>}
            >
                <form onSubmit={(event) => { event.preventDefault(); void handleVerifyOtp(otp) }} className="nb-auth-step space-y-4" noValidate>
                    {resendMessage ? <AuthAlert tone="success">{resendMessage}</AuthAlert> : null}
                    <AuthField id="signup-code" label="Verification code" error={otpError}>
                        <CodeInput
                            ref={otpInputRef}
                            id="signup-code"
                            value={otp}
                            onChange={(value) => { setOtp(value); setOtpError(null) }}
                            onComplete={(value) => void handleVerifyOtp(value)}
                            disabled={isOtpLoading}
                            {...fieldError('signup-code', otpError)}
                        />
                    </AuthField>
                    <SubmitButton busy={isOtpLoading} busyLabel="Verifying…">Verify email</SubmitButton>
                    {requiresCaptcha && resendCooldown === 0 ? (
                        <TurnstileWidget action="signup-resend" onVerify={setResendCaptchaToken} onExpire={() => setResendCaptchaToken(null)} />
                    ) : null}
                    <div className="flex items-center justify-between gap-3 text-sm">
                        <button
                            type="button"
                            onClick={() => { setIsVerifyingOtp(false); setOtp(''); setOtpError(null); setResendMessage(null) }}
                            className="inline-flex min-h-11 items-center gap-1.5 text-muted-foreground hover:text-foreground"
                        >
                            <ArrowLeft className="size-4" aria-hidden="true" />
                            Change email
                        </button>
                        <button
                            type="button"
                            onClick={() => void handleResendOtp()}
                            disabled={resendCooldown > 0}
                            className="min-h-11 font-medium text-primary underline-offset-4 hover:underline disabled:font-normal disabled:text-muted-foreground disabled:no-underline"
                        >
                            {resendCooldown > 0 ? `Resend code in ${resendCooldown}s` : 'Resend code'}
                        </button>
                    </div>
                </form>
            </AuthShell>
        )
    }

    const handleNote = suggestedHandle.length >= 2 ? (
        <p className="nb-auth-note flex items-center justify-between gap-2 text-muted-foreground" role="status">
            <span className="truncate">Your profile link: <span className="font-mono text-foreground">@{suggestedHandle}</span></span>
            {handleStatus === 'checking' ? <span className="inline-flex shrink-0 items-center gap-1"><Loader2 className="size-3 animate-spin" aria-hidden="true" />Checking</span> : null}
            {handleStatus === 'available' ? <span className="inline-flex shrink-0 items-center gap-1 text-[var(--status-success)]"><Check className="size-3" aria-hidden="true" />Available</span> : null}
            {handleStatus === 'taken' ? <span className="shrink-0 text-[var(--status-warning)]">Taken. You can pick another during setup.</span> : null}
        </p>
    ) : null

    const emailNote = isDisposable ? (
        <p className="nb-auth-note text-[var(--status-warning)]" role="status">Use a permanent email address. Temporary inboxes aren’t allowed.</p>
    ) : emailTypo.hasTypo && emailTypo.suggestedEmail ? (
        <p className="nb-auth-note flex items-center justify-between gap-2 text-[var(--status-warning)]" role="status">
            <span className="truncate">Did you mean <span className="font-medium">{emailTypo.suggestedEmail}</span>?</span>
            <button
                type="button"
                className="shrink-0 font-medium text-foreground underline underline-offset-2"
                onClick={() => { if (emailTypo.suggestedEmail) { setEmail(emailTypo.suggestedEmail); clearField('email') } }}
            >
                Use this
            </button>
        </p>
    ) : null

    return (
        <AuthShell
            title="Create your account"
            description="Find people and work together."
            panel={SIGNUP_PANEL}
            footer={<>Already have an account? <Link href={loginHref} className={AUTH_LINK}>Sign in</Link></>}
        >
            <GoogleOneTap nextPath={oneTapNextPath} onError={setFormError} />
            {inviteParam ? <AuthAlert tone="info" className="mb-5">You’ve been invited. Create your account to accept.</AuthAlert> : null}
            <OAuthButtons next={afterSignupPath} disabled={isLoading} onError={setFormError} />
            <AuthDivider />
            <form onSubmit={handleSubmit} className="space-y-4" noValidate>
                {/* Invisible honeypot field for automated sign-ups */}
                <input
                    type="text"
                    name="website_hp"
                    value={honeypot}
                    onChange={(event) => setHoneypot(event.target.value)}
                    tabIndex={-1}
                    autoComplete="off"
                    className="pointer-events-none absolute -z-10 h-0 w-0 opacity-0"
                    aria-hidden="true"
                />
                {formError ? <AuthAlert tone="error">{formError}</AuthAlert> : null}

                <AuthField id="fullName" label="Full name" error={fieldErrors.fullName} note={handleNote}>
                    <Input
                        ref={(element) => { fieldRefs.current.fullName = element }}
                        id="fullName"
                        type="text"
                        autoComplete="name"
                        placeholder="Your full name"
                        value={fullName}
                        onChange={(event) => { clearField('fullName'); setFullName(event.target.value) }}
                        className={AUTH_INPUT}
                        disabled={isLoading}
                        {...fieldError('fullName', fieldErrors.fullName)}
                    />
                </AuthField>

                <AuthField id="email" label="Email" error={fieldErrors.email} note={emailNote}>
                    <Input
                        ref={(element) => { fieldRefs.current.email = element }}
                        id="email"
                        type="email"
                        autoComplete="username email"
                        placeholder="you@example.com"
                        value={email}
                        onChange={(event) => { clearField('email'); setEmail(event.target.value) }}
                        className={AUTH_INPUT}
                        disabled={isLoading}
                        {...fieldError('email', fieldErrors.email)}
                    />
                </AuthField>

                <AuthField id="password" label="Password" error={fieldErrors.password} note={<PasswordStrengthMeter password={password} result={passwordPolicy} />}>
                    <PasswordField
                        ref={(element) => { fieldRefs.current.password = element }}
                        id="password"
                        autoComplete="new-password"
                        placeholder="Create a strong password"
                        value={password}
                        onChange={(event) => { clearField('password'); setPassword(event.target.value) }}
                        disabled={isLoading}
                        {...fieldError('password', fieldErrors.password)}
                    />
                </AuthField>

                <AuthField
                    id="confirmPassword"
                    label="Confirm password"
                    error={fieldErrors.confirmPassword}
                    note={confirmPassword && confirmPassword === password ? (
                        <p className="nb-auth-note inline-flex items-center gap-1 text-[var(--status-success)]" role="status"><Check className="size-3" aria-hidden="true" />Passwords match</p>
                    ) : null}
                >
                    <PasswordField
                        ref={(element) => { fieldRefs.current.confirmPassword = element }}
                        id="confirmPassword"
                        autoComplete="new-password"
                        placeholder="Re-enter your password"
                        value={confirmPassword}
                        onChange={(event) => { clearField('confirmPassword'); setConfirmPassword(event.target.value) }}
                        disabled={isLoading}
                        {...fieldError('confirmPassword', fieldErrors.confirmPassword)}
                    />
                </AuthField>

                {requiresCaptcha ? (
                    <TurnstileWidget
                        key={captchaKey}
                        action="signup"
                        onVerify={(token) => { setCaptchaToken(token); setFormError(null) }}
                        onExpire={() => setCaptchaToken(null)}
                    />
                ) : (
                    // Local development without a Turnstile key: an explicit stand-in for the check.
                    <label className="flex min-h-11 cursor-pointer items-center gap-3 rounded-md border border-border bg-muted/40 px-3 text-sm">
                        <input
                            type="checkbox"
                            checked={Boolean(captchaToken)}
                            onChange={(event) => { setCaptchaToken(event.target.checked ? 'dev-verified-token' : null); setFormError(null) }}
                            className="size-4 accent-[var(--primary)]"
                        />
                        Complete the security check
                        <span className="ml-auto text-xs text-muted-foreground">Hide from regular users</span>
                    </label>
                )}

                <div className="space-y-1.5">
                    <label className="flex min-h-11 cursor-pointer items-start gap-3 py-1 text-[13px] leading-relaxed text-muted-foreground">
                        <input
                            ref={(element) => { fieldRefs.current.legal = element }}
                            type="checkbox"
                            checked={legalAccepted}
                            onChange={(event) => { setLegalAccepted(event.target.checked); clearField('legal') }}
                            className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
                            {...fieldError('legal', fieldErrors.legal)}
                        />
                        <span>
                            I am at least 18 and agree to the{' '}
                            <Link className="font-medium text-foreground underline underline-offset-2 hover:text-primary" href="/terms" target="_blank">Terms of Service</Link>{' '}
                            and{' '}
                            <Link className="font-medium text-foreground underline underline-offset-2 hover:text-primary" href="/eula" target="_blank">EULA</Link>
                            . I have read the{' '}
                            <Link className="font-medium text-foreground underline underline-offset-2 hover:text-primary" href="/privacy" target="_blank">Privacy Policy</Link>
                            .
                        </span>
                    </label>
                    {fieldErrors.legal ? <p id="legal-error" className="nb-auth-note text-[var(--status-danger)]">{fieldErrors.legal}</p> : null}
                </div>

                <SubmitButton busy={isLoading} busyLabel="Creating account…">Create account</SubmitButton>
            </form>
        </AuthShell>
    )
}
