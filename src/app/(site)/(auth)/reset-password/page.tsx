'use client'

import Link from 'next/link'
import type { FormEvent } from 'react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { AuthChangeEvent, Session } from '@supabase/supabase-js'
import { Button } from '@/components/ui/button'
import { PasswordStrengthMeter } from '@/components/settings/PasswordStrengthMeter'
import { AUTH_EMAIL_HANDOFF_KEY, AUTH_LINK, AuthAlert, AuthField, AuthShell, PasswordField, PasswordRules, SubmitButton, fieldError } from '@/components/auth/AuthShell'
import { AUTH_PANELS } from '@/components/auth/auth-panels'
import { PixelIcon } from '@/components/auth/pixel'
import { loadBrowserSupabase } from '@/lib/auth/browser-auth-actions'
import { getPasswordPolicyResult, PASSWORD_MIN_LENGTH } from '@/lib/security/password-policy'

type RecoveryState = 'loading' | 'ready' | 'invalid' | 'success'

const SUCCESS_REDIRECT_MS = 3000

const COPY: Record<RecoveryState, { title: string; description: string }> = {
    loading: { title: 'Checking your link…', description: 'This only takes a moment.' },
    invalid: { title: 'This link has expired', description: 'Reset links work once and expire after a short time. Ask for a new one to continue.' },
    ready: { title: 'Choose a new password', description: `Use at least ${PASSWORD_MIN_LENGTH} characters with upper and lower case letters and a number.` },
    success: { title: 'Password updated', description: 'For your safety, every device was signed out, this one too. Sign in with your new password: taking you there now…' },
}

export default function ResetPasswordPage() {
    const router = useRouter()
    const redirectTimeoutRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
    const [status, setStatus] = useState<RecoveryState>('loading')
    const [newPassword, setNewPassword] = useState('')
    const [confirmPassword, setConfirmPassword] = useState('')
    const [submitting, setSubmitting] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [fieldErrors, setFieldErrors] = useState<{ password?: string; confirm?: string }>({})

    useEffect(() => {
        return () => {
            if (redirectTimeoutRef.current !== undefined) {
                clearTimeout(redirectTimeoutRef.current)
                redirectTimeoutRef.current = undefined
            }
        }
    }, [])

    useEffect(() => {
        let active = true
        let unsubscribe: (() => void) | null = null

        void loadBrowserSupabase().then(async (supabase) => {
            if (!active) return
            const {
                data: { subscription },
            } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, session: Session | null) => {
                if (!active) return
                if (session) {
                    setStatus('ready')
                }
            })
            unsubscribe = () => subscription.unsubscribe()
            const { data } = await supabase.auth.getSession()
            if (!active) return
            setStatus(data.session ? 'ready' : 'invalid')
        })

        return () => {
            active = false
            unsubscribe?.()
        }
    }, [])

    const passwordPolicy = useMemo(() => getPasswordPolicyResult(newPassword), [newPassword])

    const handleSubmit = async (event: FormEvent) => {
        event.preventDefault()
        setError(null)

        const errors = {
            password: passwordPolicy.ok ? undefined : passwordPolicy.error || 'Choose a stronger password.',
            confirm: newPassword === confirmPassword ? undefined : "Passwords don’t match.",
        }
        setFieldErrors(errors)
        if (errors.password || errors.confirm) {
            document.getElementById(errors.password ? 'new-password' : 'confirm-password')?.focus()
            return
        }

        setSubmitting(true)
        try {
            const safetyResponse = await fetch('/api/v1/auth/password-safety', {
                method: 'POST',
                credentials: 'same-origin',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ password: newPassword }),
            })
            const safetyBody = (await safetyResponse.json().catch(() => null)) as { message?: string } | null
            if (!safetyResponse.ok) {
                throw new Error(safetyBody?.message || 'Couldn’t verify password safety.')
            }

            const supabase = await loadBrowserSupabase()
            const { error: updateError } = await supabase.auth.updateUser({ password: newPassword })
            if (updateError) {
                throw updateError
            }

            // The sign-in page starts with this email filled in (never in the address).
            const { data: current } = await supabase.auth.getUser()
            try {
                if (current.user?.email) sessionStorage.setItem(AUTH_EMAIL_HANDOFF_KEY, current.user.email)
            } catch {
                // Storage can be blocked; the sign-in page just starts empty.
            }
            await supabase.auth.signOut().catch(() => null)
            setStatus('success')
            if (redirectTimeoutRef.current !== undefined) {
                clearTimeout(redirectTimeoutRef.current)
            }
            redirectTimeoutRef.current = setTimeout(() => {
                redirectTimeoutRef.current = undefined
                router.replace('/login')
            }, SUCCESS_REDIRECT_MS)
        } catch (submitError) {
            setError(submitError instanceof Error ? submitError.message : 'Couldn’t update password.')
        } finally {
            setSubmitting(false)
        }
    }

    const { title, description } = COPY[status]

    return (
        <AuthShell
            title={title}
            description={description}
            panel={AUTH_PANELS.reset}
            step={status === 'ready' ? [3, 3] : undefined}
            mark={status === 'success' ? 'check' : status === 'invalid' ? 'clock' : undefined}
            outcome={status === 'success' ? { word: 'OK', title: 'You’re back in.' } : status === 'invalid' ? { word: 'OLD', title: 'Links work once, then expire.' } : undefined}
            footer={status === 'ready' || status === 'loading' ? <>Changed your mind? <Link href="/login" className={AUTH_LINK}>Back to sign in</Link></> : undefined}
        >
            {status === 'loading' ? (
                <div className="space-y-4" aria-busy="true">
                    <div className="h-11 animate-pulse rounded-md bg-muted" />
                    <div className="h-11 animate-pulse rounded-md bg-muted" />
                </div>
            ) : null}

            {status === 'invalid' ? (
                <div className="nb-auth-step space-y-3">
                    <Button asChild className="h-11 w-full font-medium"><Link href="/forgot-password">Send a new link</Link></Button>
                    <Button asChild variant="ghost" className="h-11 w-full"><Link href="/login">Back to sign in</Link></Button>
                </div>
            ) : null}

            {status === 'success' ? (
                <div className="nb-auth-step space-y-4">
                    <AuthAlert tone="success">Your password has changed and this device is signed out.</AuthAlert>
                    <Button asChild className="h-11 w-full font-medium"><Link href="/login">Sign in</Link></Button>
                </div>
            ) : null}

            {status === 'ready' ? (
                <form onSubmit={handleSubmit} className="nb-auth-step space-y-4" noValidate>
                    {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
                    <AuthField id="new-password" label="New password" error={fieldErrors.password} note={<div className="space-y-2"><PasswordStrengthMeter password={newPassword} result={passwordPolicy} /><PasswordRules result={passwordPolicy} /></div>}>
                        <PasswordField
                            id="new-password"
                            autoComplete="new-password"
                            placeholder="Enter your new password"
                            value={newPassword}
                            onChange={(event) => { setError(null); setFieldErrors((e) => ({ ...e, password: undefined })); setNewPassword(event.target.value) }}
                            disabled={submitting}
                            {...fieldError('new-password', fieldErrors.password)}
                        />
                    </AuthField>
                    <AuthField
                        id="confirm-password"
                        label="Confirm password"
                        error={fieldErrors.confirm}
                        note={confirmPassword && confirmPassword === newPassword ? (
                            <p className="nb-auth-note inline-flex items-center gap-1.5 text-[var(--status-success)]" role="status"><PixelIcon name="check" />Passwords match</p>
                        ) : null}
                    >
                        <PasswordField
                            id="confirm-password"
                            autoComplete="new-password"
                            placeholder="Re-enter your new password"
                            value={confirmPassword}
                            onChange={(event) => { setError(null); setFieldErrors((e) => ({ ...e, confirm: undefined })); setConfirmPassword(event.target.value) }}
                            disabled={submitting}
                            {...fieldError('confirm-password', fieldErrors.confirm)}
                        />
                    </AuthField>
                    <SubmitButton busy={submitting} busyLabel="Updating password…">Update password</SubmitButton>
                </form>
            ) : null}
        </AuthShell>
    )
}
