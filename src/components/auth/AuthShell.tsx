'use client'

import { useEffect, useRef, useState, type ComponentProps, type FormEvent, type KeyboardEvent, type ReactNode } from 'react'
import { ExternalLink, Eye, EyeOff, Github } from '@/components/ui/icons'
import Logo from '@/components/layout/header/Logo'
import { LegalLinks } from '@/components/legal/LegalLinks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { loadBrowserSupabase, startOAuthSignIn, syncBrowserSessionToServer } from '@/lib/auth/browser-auth-actions'
import { buildAuthPageHref } from '@/lib/auth/redirects'
import { formatCountdown } from '@/lib/auth/code-format'
import { PASSWORD_MIN_LENGTH, type PasswordPolicyResult } from '@/lib/security/password-policy'
import type { PixelIconName } from '@/lib/pixel-icons'
import type { AuthPanelContent, PanelOutcome } from '@/components/auth/auth-panels'
import { AuthPanel } from '@/components/auth/AuthPanel'
import { PixelIcon, PixelSpinner } from '@/components/auth/pixel'
import { PixelPerson } from '@/components/ui/PixelPerson'
import { clearSignInMarker, markSignIn } from '@/lib/auth/signin-flight'
import TurnstileWidget, { hasTurnstileSiteKey, SECURITY_CHECK_PROMPT } from '@/components/auth/TurnstileWidget'
import { mailAppFor, readSignInMethod, rememberSignInMethod, type SignInMethod } from '@/lib/auth/last-method'
import { cn } from '@/lib/utils'

type StatusMark = 'check' | 'cross' | 'clock' | 'alert' | 'shield'
const MARK_TONE: Record<StatusMark, string> = { check: 'ok', cross: 'no', clock: 'wait', alert: 'no', shield: 'brand' }
const GLITCH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/<>-_=+*#'

/** The marketing page's mono label: scrambles once and settles on the words. Plain text on the server and under reduced motion. */
export function Eyebrow({ text, step }: { text: string; step?: readonly [number, number] }) {
    const ref = useRef<HTMLSpanElement | null>(null)
    useEffect(() => {
        const el = ref.current
        if (!el || matchMedia('(prefers-reduced-motion: reduce)').matches) return
        // By the clock (480ms), not by frames: on a busy first load it settles on time instead of hanging half-scrambled.
        let timer = 0
        const t0 = performance.now()
        const tick = () => {
            const progress = (performance.now() - t0) / 480
            if (progress >= 1) { el.textContent = text; return }
            const shown = Math.floor(progress * text.length)
            el.textContent = [...text].map((ch, i) => i < shown || ch === ' ' ? ch : GLITCH[Math.floor(Math.random() * GLITCH.length)]).join('')
            timer = window.setTimeout(tick, 34)
        }
        tick()
        return () => { clearTimeout(timer); el.textContent = text }
    }, [text])
    const pad = (n: number) => String(n).padStart(2, '0')
    return (
        <p className="nb-auth-eyebrow">
            <span className="sr-only">{step ? `${text}, step ${step[0]} of ${step[1]}` : text}</span>
            <span ref={ref} aria-hidden="true">{text}</span>
            {step ? <span aria-hidden="true"> · <b>{pad(step[0])} / {pad(step[1])}</b></span> : null}
        </p>
    )
}

/**
 * How the form enters: the CSS load sequence the first time, then sideways when the step moves (forward from the right,
 * back from the left), or a fade. Read during render, recorded after commit, so StrictMode's second render agrees.
 */
export function useEnter(key: string, step: number | undefined) {
    const last = useRef<{ key: string; step: number | undefined; enter: string } | null>(null)
    const prev = last.current
    const enter = !prev ? 'load' : prev.key === key ? prev.enter : step !== undefined && prev.step !== undefined && step !== prev.step ? (step < prev.step ? 'back' : 'fwd') : 'fade'
    useEffect(() => { last.current = { key, step, enter } })
    return enter
}

/**
 * Every account page: wordmark → title → form → alternate path → legal links, with the ink panel on wide screens.
 * `panel={null}` drops the panel for status-only pages.
 */
export function AuthShell({
    title,
    description,
    panel,
    footer,
    children,
    step,
    mark,
    outcome,
    panelRoute,
    panelExtra,
}: {
    title: ReactNode
    description?: ReactNode
    panel: AuthPanelContent | null
    footer?: ReactNode
    children?: ReactNode
    /** Where this screen sits in its flow, shown as "· 02 / 03" after the label. */
    step?: readonly [number, number]
    /** A pixel status mark above the label on result and approve screens. */
    mark?: StatusMark
    /** A finished screen: the panel's word and headline change (OK, NO, OLD, HALT). */
    outcome?: PanelOutcome
    /** The panel's path when it is more than the page (join/K7M2QX). */
    panelRoute?: string
    /** Extra panel content under the headline (the terminal mirror). */
    panelExtra?: ReactNode
}) {
    const enter = useEnter(typeof title === 'string' ? title : String(step?.[0] ?? ''), step?.[0])
    return (
        <main className="nb-auth" data-panel={panel ? 'true' : 'false'}>
            <div className="nb-auth-form">
                <header className="nb-auth-top"><div className="nb-auth-logo"><Logo /></div></header>
                <div className="nb-auth-wrap">
                    <div className="nb-auth-column">
                        <div className="nb-auth-body" key={typeof title === 'string' ? title : undefined} data-enter={enter}>
                            <div className="nb-auth-head mb-6 space-y-1.5">
                                {mark ? <span className="nb-auth-mark" data-tone={MARK_TONE[mark]}><PixelIcon name={mark} size={24} /></span> : null}
                                {panel ? <Eyebrow text={panel.eyebrow} step={step} /> : null}
                                <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.015em]">{title}</h1>
                                {description ? <p className="text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
                            </div>
                            {children}
                        </div>
                        <div className="nb-auth-foot space-y-4 border-t border-border pt-5 text-center">
                            {footer ? <p className="text-sm text-muted-foreground">{footer}</p> : null}
                            <LegalLinks className="text-[11px]" showCopyright />
                        </div>
                    </div>
                </div>
            </div>
            {panel ? <AuthPanel panel={panel} outcome={outcome} route={panelRoute} extra={panelExtra} /> : null}
        </main>
    )
}

const ALERT_ICON: Record<'error' | 'success' | 'warning' | 'info', PixelIconName> = { error: 'alert', success: 'check', warning: 'alert', info: 'info' }

export function AuthAlert({ tone, title, children, className }: { tone: keyof typeof ALERT_ICON; title?: ReactNode; children?: ReactNode; className?: string }) {
    return (
        <div role={tone === 'error' ? 'alert' : 'status'} data-tone={tone} className={cn('nb-auth-alert', className)}>
            <PixelIcon name={ALERT_ICON[tone]} className="mt-1 shrink-0" />
            <div className="min-w-0 space-y-1">
                {title ? <p className="font-medium">{title}</p> : null}
                {children ? <div className="text-[13px] leading-relaxed">{children}</div> : null}
            </div>
        </div>
    )
}

/** Props that tie an input to the error rendered by `AuthField`. */
export function fieldError(id: string, error: string | null | undefined) {
    return error ? { 'aria-invalid': true as const, 'aria-describedby': `${id}-error` } : {}
}

export function AuthField({ id, label, aside, error, note, children }: { id: string; label: ReactNode; aside?: ReactNode; error?: string | null; note?: ReactNode; children: ReactNode }) {
    return (
        <div className="space-y-1.5">
            <div className="flex min-h-5 items-center justify-between gap-3">
                <label htmlFor={id} className="text-sm font-medium leading-none">{label}</label>
                {aside}
            </div>
            {children}
            {error ? <p id={`${id}-error`} className="nb-auth-note text-[var(--status-danger)]">{error}</p> : note}
        </div>
    )
}

export const AUTH_INPUT = 'h-11'
export const AUTH_LINK = 'font-medium text-primary underline-offset-4 hover:underline'
/** sessionStorage key that carries the typed email from sign-in to the reset form (never the URL). */
export const AUTH_EMAIL_HANDOFF_KEY = 'nb_auth_email'

export function PasswordField({ className, onKeyDown, onKeyUp, onBlur, ...props }: Omit<ComponentProps<'input'>, 'type'>) {
    const [shown, setShown] = useState(false)
    const [capsLock, setCapsLock] = useState(false)
    const track = (event: KeyboardEvent<HTMLInputElement>) => setCapsLock(event.getModifierState?.('CapsLock') ?? false)
    return (
        <div className="space-y-1.5">
            <div className="relative">
                <Input
                    {...props}
                    type={shown ? 'text' : 'password'}
                    className={cn(AUTH_INPUT, 'pr-11', className)}
                    onKeyDown={(event) => { track(event); onKeyDown?.(event) }}
                    onKeyUp={(event) => { track(event); onKeyUp?.(event) }}
                    onBlur={(event) => { setCapsLock(false); onBlur?.(event) }}
                />
                <button
                    type="button"
                    className="nb-auth-reveal"
                    onClick={() => setShown((value) => !value)}
                    aria-pressed={shown}
                    aria-label={shown ? 'Hide password' : 'Show password'}
                    disabled={props.disabled}
                >
                    {shown ? <EyeOff className="size-4" aria-hidden="true" /> : <Eye className="size-4" aria-hidden="true" />}
                </button>
            </div>
            {capsLock ? <p className="nb-auth-note text-[var(--status-warning)]" role="status">Caps lock is on</p> : null}
        </div>
    )
}

/**
 * A paste anywhere on the page that is not into a field (the person copied the code from the email and pressed ⌘V)
 * goes to this code instead of nowhere.
 */
export function usePasteAnywhere(onText: (text: string) => void, enabled = true) {
    const handler = useRef(onText)
    handler.current = onText
    useEffect(() => {
        if (!enabled) return
        const onPaste = (event: ClipboardEvent) => {
            if ((event.target as Element | null)?.closest?.('input, textarea, select, [contenteditable="true"]')) return
            const text = event.clipboardData?.getData('text') ?? ''
            if (!text.trim()) return
            event.preventDefault()
            handler.current(text)
        }
        document.addEventListener('paste', onPaste)
        return () => document.removeEventListener('paste', onPaste)
    }, [enabled])
}

/** A single field for 6-digit codes: native paste and OS one-time-code autofill work without per-digit boxes. */
export function CodeInput({ value, onChange, onComplete, ...props }: Omit<ComponentProps<'input'>, 'value' | 'onChange'> & { value: string; onChange: (value: string) => void; onComplete?: (code: string) => void }) {
    const take = (raw: string) => {
        const code = raw.replace(/\D/g, '').slice(0, 6)
        onChange(code)
        if (code.length === 6 && code !== value) onComplete?.(code)
    }
    // Only a whole code: pasting a link or a sentence elsewhere on the page leaves the box alone.
    usePasteAnywhere((text) => { if (text.replace(/\D/g, '').length >= 6) take(text) }, !props.disabled)
    return (
        <Input
            {...props}
            value={value}
            onChange={(event) => take(event.target.value)}
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]*"
            maxLength={6}
            placeholder="000000"
            className="h-14 text-center font-mono text-2xl tracking-[0.5em]"
        />
    )
}

export function AuthDivider() {
    return (
        <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground" aria-hidden="true">
            <span className="h-px flex-1 bg-border" />or<span className="h-px flex-1 bg-border" />
        </div>
    )
}

export function SubmitButton({ busy, busyLabel, children, ...props }: ComponentProps<typeof Button> & { busy: boolean; busyLabel: string }) {
    return (
        <Button type="submit" className="h-11 w-full font-medium" disabled={busy || props.disabled} aria-busy={busy || undefined} {...props}>
            {busy ? <><PixelSpinner />{busyLabel}</> : children}
        </Button>
    )
}

function GoogleIcon() {
    return (
        <svg className="size-4 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
            <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
            <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
            <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
            <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
        </svg>
    )
}


/**
 * Google and GitHub. Both return through the versioned legal-acceptance step; someone who has already
 * agreed passes straight through it.
 */
export function OAuthButtons({ next, disabled, onError, captchaToken, onCaptchaUsed }: {
    next: string
    disabled?: boolean
    onError: (message: string | null) => void
    /** The page's Cloudflare check: the server turns it into a pass for this attempt before leaving. */
    captchaToken?: string | null
    onCaptchaUsed?: () => void
}) {
    const [loading, setLoading] = useState<'google' | 'github' | null>(null)
    const [lastUsed, setLastUsed] = useState<SignInMethod | null>(null)
    useEffect(() => setLastUsed(readSignInMethod()), [])
    const requiresCaptcha = hasTurnstileSiteKey()
    const start = async (provider: 'google' | 'github') => {
        if (requiresCaptcha && !captchaToken) {
            onError(SECURITY_CHECK_PROMPT)
            return
        }
        onError(null)
        setLoading(provider)
        const legalNext = `/legal/accept?context=oauth_signup&next=${encodeURIComponent(next)}`
        try {
            rememberSignInMethod(provider)
            // The page leaves and comes back: the marker tells the welcome flight this tab signed in.
            markSignIn(next)
            const { error } = await startOAuthSignIn(provider, legalNext, requiresCaptcha ? captchaToken : null)
            if (error) {
                clearSignInMarker()
                onError(error.message)
                setLoading(null)
                // Cloudflare's tokens are single-use: a failed attempt needs a fresh check.
                if (requiresCaptcha) onCaptchaUsed?.()
            }
        } catch {
            clearSignInMarker()
            onError(`Couldn’t start ${provider === 'google' ? 'Google' : 'GitHub'} sign-in. Try again.`)
            setLoading(null)
            if (requiresCaptcha) onCaptchaUsed?.()
        }
    }
    const busy = disabled || loading !== null
    return (
        <div>
            <div className="grid grid-cols-2 gap-3">
                {(['google', 'github'] as const).map((provider) => (
                    <Button key={provider} type="button" variant="outline" className="relative h-11 w-full font-medium" onClick={() => void start(provider)} disabled={busy}>
                        {loading === provider ? <PixelSpinner /> : provider === 'google' ? <GoogleIcon /> : <Github className="size-4" aria-hidden="true" />}
                        <span className="truncate">{loading === provider ? 'Redirecting…' : provider === 'google' ? 'Google' : 'GitHub'}</span>
                        {lastUsed === provider && loading !== provider ? <LastUsedMarker place="edge" /> : null}
                    </Button>
                ))}
            </div>
        </div>
    )
}

/**
 * Marks how this browser signed in last time: a small chip on the top edge of the matching button (styles:
 * .nb-last-used in globals.css), so the buttons keep their size and their centred label. Where there is no edge to sit
 * on (the sign-in code link) it goes inline after the text.
 */
export function LastUsedMarker({ place }: { place: 'edge' | 'inline' }) {
    return (
        <span className="nb-last-used" data-place={place} title="You last signed in this way on this browser">
            Last used
        </span>
    )
}

/** "Open Gmail" and the like on a "Check your email" screen, when the address is at a service with a web inbox. */
export function MailAppLink({ email }: { email: string }) {
    const app = mailAppFor(email)
    if (!app) return null
    return (
        <Button asChild variant="outline" className="h-11 w-full font-medium">
            <a href={app.href} target="_blank" rel="noopener noreferrer">{app.label}<ExternalLink className="size-3.5" aria-hidden="true" /></a>
        </Button>
    )
}

const RESEND_SECONDS = 60

/**
 * The one code box for every emailed code: sign-in code, confirming an email, password reset. `onVerify` and
 * `onResend` return an error to show, or null. Resending asks Cloudflare again (invisible unless it needs a click).
 */
export function EmailCodeForm({ id, email, label, submitLabel, onVerify, onResend, resendAction }: {
    id: string
    email: string
    label: string
    submitLabel: string
    onVerify: (code: string) => Promise<string | null>
    onResend: (captchaToken: string | null) => Promise<string | null>
    resendAction: string
}) {
    const [code, setCode] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [message, setMessage] = useState<string | null>(null)
    const [busy, setBusy] = useState(false)
    const [cooldown, setCooldown] = useState(RESEND_SECONDS)
    // Said to screen readers once when the wait starts and once when it ends, never every second.
    const [announce, setAnnounce] = useState(`You can send a new code in ${RESEND_SECONDS} seconds.`)
    const [resendToken, setResendToken] = useState<string | null>(null)
    const [resendKey, setResendKey] = useState(0)
    const requiresCaptcha = hasTurnstileSiteKey()
    useEffect(() => {
        if (cooldown <= 0) return setAnnounce('You can send a new code now.')
        const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
        return () => clearInterval(timer)
    }, [cooldown])

    const verify = async (value: string) => {
        if (value.length !== 6) {
            setError('Enter the 6-digit code.')
            return
        }
        setBusy(true)
        setError(null)
        const failed = await onVerify(value).catch(() => 'Couldn’t check the code. Try again.')
        if (failed) {
            setError(failed)
            setCode('')
            setBusy(false)
        }
    }
    const resend = async () => {
        if (cooldown > 0) return
        if (requiresCaptcha && !resendToken) {
            setError(SECURITY_CHECK_PROMPT)
            return
        }
        setError(null)
        setMessage(null)
        const failed = await onResend(resendToken).catch(() => 'We couldn’t send a new code. Try again in a minute.')
        setResendToken(null)
        setResendKey((key) => key + 1)
        if (failed) {
            setError(failed)
            return
        }
        setCooldown(RESEND_SECONDS)
        setAnnounce(`You can send a new code in ${RESEND_SECONDS} seconds.`)
        setMessage(`We sent a new code to ${email}.`)
    }
    return (
        <form onSubmit={(event: FormEvent) => { event.preventDefault(); void verify(code) }} className="nb-auth-step space-y-4" noValidate>
            {message ? <AuthAlert tone="success">{message}</AuthAlert> : null}
            <AuthField id={id} label={label} error={error}>
                <CodeInput
                    id={id}
                    value={code}
                    onChange={(value) => { setCode(value); setError(null) }}
                    onComplete={(value) => void verify(value)}
                    disabled={busy}
                    {...fieldError(id, error)}
                />
            </AuthField>
            <SubmitButton busy={busy} busyLabel="Checking…">{submitLabel}</SubmitButton>
            <MailAppLink email={email} />
            {requiresCaptcha && cooldown === 0 ? <TurnstileWidget key={resendKey} action={resendAction} onVerify={setResendToken} onExpire={() => setResendToken(null)} /> : null}
            <p className="flex min-h-11 items-center justify-center text-sm">
                <button
                    type="button"
                    onClick={() => void resend()}
                    disabled={cooldown > 0}
                    className="min-h-11 font-medium text-primary underline-offset-4 hover:underline disabled:font-normal disabled:text-muted-foreground disabled:no-underline"
                >
                    {cooldown > 0 ? <>Send a new code in <span className="font-mono tabular-nums">{formatCountdown(cooldown)}</span></> : 'Send a new code'}
                </button>
            </p>
            <p className="sr-only" aria-live="polite">{announce}</p>
        </form>
    )
}

/** The four rules a new password must meet, each ticking as it is met (beside the strength meter). */
export function PasswordRules({ result }: { result: PasswordPolicyResult }) {
    const rules = [
        [`${PASSWORD_MIN_LENGTH} or more characters`, result.checks.minLength],
        ['An upper case letter', result.checks.uppercase],
        ['A lower case letter', result.checks.lowercase],
        ['A number', result.checks.number],
    ] as const
    return (
        <ul className="nb-auth-rules" aria-label="Password rules">
            {rules.map(([label, met]) => (
                <li key={label} data-met={met ? 'true' : 'false'}>
                    {met ? <PixelIcon name="check" /> : <span className="nb-auth-rule-box" aria-hidden="true" />}
                    {label}<span className="sr-only">{met ? ': done' : ': not yet'}</span>
                </li>
            ))}
        </ul>
    )
}

/** Sign out here and come back through sign in to the same page, as someone else. */
export async function switchAccount(next: string) {
    const supabase = await loadBrowserSupabase()
    await supabase.auth.signOut().catch(() => null)
    await syncBrowserSessionToServer(null).catch(() => null)
    window.location.assign(buildAuthPageHref('/login', next))
}

/** Who is approving: their pixel person (like the app's avatars), the name and email, and a way to switch. */
export function SignedInAs({ email, name, next, userId }: { email: string; name?: string | null; next: string; userId?: string | null }) {
    const [busy, setBusy] = useState(false)
    return (
        <div className="nb-auth-account">
            <span className="nb-auth-avatar" aria-hidden="true"><PixelPerson identityKey={userId || email} size={36} /></span>
            <span className="min-w-0 flex-1 leading-snug">
                <span className="block truncate font-medium">Signed in as {name || email}</span>
                {name ? <span className="block truncate text-muted-foreground">{email}</span> : null}
            </span>
            <button type="button" className="min-h-11 shrink-0 text-xs font-medium text-primary underline-offset-4 hover:underline" disabled={busy} onClick={() => { setBusy(true); void switchAccount(next) }}>
                {busy ? 'Signing out…' : 'Not you? Switch'}
            </button>
        </div>
    )
}
