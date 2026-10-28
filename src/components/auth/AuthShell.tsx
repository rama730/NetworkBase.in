'use client'

import { useState, type ComponentProps, type KeyboardEvent, type ReactNode } from 'react'
import { AlertCircle, CheckCircle2, Eye, EyeOff, Github, Info, Loader2, TriangleAlert } from 'lucide-react'
import Logo from '@/components/layout/header/Logo'
import { LegalLinks } from '@/components/legal/LegalLinks'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { startOAuthSignIn } from '@/lib/auth/browser-auth-actions'
import { cn } from '@/lib/utils'

export type AuthPanelContent = { eyebrow: string; title: string; points?: readonly string[] }

/** Forgot and reset password share one panel. */
export const RECOVERY_PANEL: AuthPanelContent = {
    eyebrow: 'Account recovery',
    title: "We'll get you back in.",
    points: ['Reset links work once and expire', 'We never ask for your password by email', 'Only you choose the new password'],
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
}: {
    title: ReactNode
    description?: ReactNode
    panel: AuthPanelContent | null
    footer?: ReactNode
    children?: ReactNode
}) {
    return (
        <main className="nb-auth" data-panel={panel ? 'true' : 'false'}>
            <div className="nb-auth-form">
                <div className="nb-auth-column">
                    <Logo />
                    <div className="nb-auth-body">
                        <div className="mb-6 space-y-1.5">
                            <h1 className="text-[30px] font-semibold leading-tight tracking-[-0.015em]">{title}</h1>
                            {description ? <p className="text-sm leading-relaxed text-muted-foreground">{description}</p> : null}
                        </div>
                        {children}
                    </div>
                    <div className="space-y-4 border-t border-border pt-5 text-center">
                        {footer ? <p className="text-sm text-muted-foreground">{footer}</p> : null}
                        <LegalLinks className="text-[11px]" showCopyright />
                    </div>
                </div>
            </div>
            {panel ? <AuthPanel {...panel} /> : null}
        </main>
    )
}

function AuthPanel({ eyebrow, title, points }: AuthPanelContent) {
    return (
        <aside className="nb-auth-panel nb-grid-ground" aria-label="About NetworkBase">
            <span className="nb-micro nb-inverse-muted">{eyebrow}</span>
            <div className="space-y-6">
                <div className="h-[9px] w-[9px] bg-[var(--nb-brand)]" aria-hidden="true" />
                <p className="max-w-[20ch] font-serif text-[38px] leading-[1.12]">{title}</p>
                {points?.length ? (
                    <ol className="max-w-[36ch] space-y-3 text-sm">
                        {points.map((point, index) => (
                            <li key={point} className="flex gap-4 border-t border-white/15 pt-3">
                                <span className="font-mono text-[var(--accent-inverse)]">0{index + 1}</span>
                                <span className="nb-inverse-muted">{point}</span>
                            </li>
                        ))}
                    </ol>
                ) : null}
            </div>
            <span className="nb-inverse-muted font-mono text-xs">NetworkBase / Build together</span>
        </aside>
    )
}

const ALERT_ICON = { error: AlertCircle, success: CheckCircle2, warning: TriangleAlert, info: Info }

export function AuthAlert({ tone, title, children, className }: { tone: keyof typeof ALERT_ICON; title?: ReactNode; children?: ReactNode; className?: string }) {
    const Icon = ALERT_ICON[tone]
    return (
        <div role={tone === 'error' ? 'alert' : 'status'} data-tone={tone} className={cn('nb-auth-alert', className)}>
            <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
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
            {capsLock ? <p className="nb-auth-note text-[var(--status-warning)]" role="status">Caps Lock is on</p> : null}
        </div>
    )
}

/** A single field for 6-digit codes: native paste and OS one-time-code autofill work without per-digit boxes. */
export function CodeInput({ value, onChange, onComplete, ...props }: Omit<ComponentProps<'input'>, 'value' | 'onChange'> & { value: string; onChange: (value: string) => void; onComplete?: (code: string) => void }) {
    return (
        <Input
            {...props}
            value={value}
            onChange={(event) => {
                const code = event.target.value.replace(/\D/g, '').slice(0, 6)
                onChange(code)
                if (code.length === 6 && code !== value) onComplete?.(code)
            }}
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
            {busy ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" />{busyLabel}</> : children}
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

const signInWithGoogle = (nextPath: string) => startOAuthSignIn('google', nextPath)
const signInWithGitHub = (nextPath: string) => startOAuthSignIn('github', nextPath)

/**
 * Google and GitHub. Both return through the versioned legal-acceptance step; someone who has already
 * agreed passes straight through it.
 */
export function OAuthButtons({ next, disabled, onError }: { next: string; disabled?: boolean; onError: (message: string | null) => void }) {
    const [loading, setLoading] = useState<'google' | 'github' | null>(null)
    const start = async (provider: 'google' | 'github') => {
        onError(null)
        setLoading(provider)
        const legalNext = `/legal/accept?context=oauth_signup&next=${encodeURIComponent(next)}`
        try {
            const { error } = provider === 'google' ? await signInWithGoogle(legalNext) : await signInWithGitHub(legalNext)
            if (error) {
                onError(error.message)
                setLoading(null)
            }
        } catch {
            onError(`Couldn't start ${provider === 'google' ? 'Google' : 'GitHub'} sign-in. Try again.`)
            setLoading(null)
        }
    }
    const busy = disabled || loading !== null
    return (
        <div className="grid grid-cols-2 gap-3">
            {(['google', 'github'] as const).map((provider) => (
                <Button key={provider} type="button" variant="outline" className="h-11 w-full font-medium" onClick={() => void start(provider)} disabled={busy}>
                    {loading === provider ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : provider === 'google' ? <GoogleIcon /> : <Github className="size-4" aria-hidden="true" />}
                    <span className="truncate">{loading === provider ? 'Redirecting…' : provider === 'google' ? 'Google' : 'GitHub'}</span>
                </Button>
            ))}
        </div>
    )
}
