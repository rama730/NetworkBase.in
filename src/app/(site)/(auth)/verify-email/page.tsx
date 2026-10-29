'use client'

import { Suspense, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import { AuthRouteProviders } from '@/components/providers/AuthRouteProviders'
import { AuthAlert, AuthShell } from '@/components/auth/AuthShell'
import { loadBrowserSupabase, syncBrowserSessionToServer } from '@/lib/auth/browser-auth-actions'

const RESEND_COOLDOWN_SECONDS = 60

const VERIFY_PANEL = {
    eyebrow: 'One last step',
    title: 'Verified email keeps NetworkBase real.',
    points: ['Keeps spam accounts out', 'Lets you recover your account', 'Unlocks messages and projects'],
}

function VerifyEmailPageInner() {
    const { user, signOut } = useAuth()
    const [isSending, setIsSending] = useState(false)
    const [isChecking, setIsChecking] = useState(false)
    const [isSigningOut, setIsSigningOut] = useState(false)
    const [cooldown, setCooldown] = useState(0)
    const [message, setMessage] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)

    useEffect(() => {
        if (cooldown <= 0) return
        const timer = setInterval(() => setCooldown((value) => Math.max(0, value - 1)), 1000)
        return () => clearInterval(timer)
    }, [cooldown])

    const handleResend = async () => {
        if (!user?.email) {
            setError('Sign in again to resend the verification email.')
            return
        }

        setIsSending(true)
        setMessage(null)
        setError(null)

        try {
            const response = await fetch('/api/v1/auth/verify-email', {
                method: 'POST',
                credentials: 'same-origin',
            })
            const body = await response.json().catch(() => null) as { success?: boolean; message?: string } | null;

            if (!response.ok || body?.success === false) {
                setError(body?.message || 'Couldn’t resend verification email.')
                return
            }

            setCooldown(RESEND_COOLDOWN_SECONDS)
            setMessage(`We sent a new link to ${user.email}.`)
        } catch (resendError) {
            setError(resendError instanceof Error ? resendError.message : 'Couldn’t resend verification email.')
        } finally {
            setIsSending(false)
        }
    }

    // The link may have been opened on another device: refresh the session and let the server route on.
    const handleContinue = async () => {
        setIsChecking(true)
        setMessage(null)
        setError(null)
        try {
            const supabase = await loadBrowserSupabase()
            const { data } = await supabase.auth.refreshSession()
            if (!data.session) {
                setError('Your session has ended. Sign in again to continue.')
                setIsChecking(false)
                return
            }
            if (data.session.user?.email_confirmed_at) {
                await syncBrowserSessionToServer(data.session).catch(() => null)
                window.location.reload()
                return
            }
            setError("Your email isn’t verified yet. Open the link in the email, then try again.")
        } catch {
            setError("Couldn’t check right now. Try again.")
        }
        setIsChecking(false)
    }

    const handleSignOut = async () => {
        setError(null)
        setIsSigningOut(true)
        try {
            await signOut()
        } catch (signOutError) {
            setError(signOutError instanceof Error ? signOutError.message : 'Couldn’t sign out. Try again.')
            setIsSigningOut(false)
        }
    }

    const busy = isSending || isChecking || isSigningOut

    return (
        <AuthShell
            title="Verify your email"
            description={<>We sent a link to <span className="font-medium text-foreground">{user?.email || 'your email address'}</span>. Open it to finish setting up your account.</>}
            panel={VERIFY_PANEL}
        >
            <div className="space-y-4">
                {message ? <AuthAlert tone="success">{message}</AuthAlert> : null}
                {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
                <Button className="h-11 w-full font-medium" onClick={() => void handleContinue()} disabled={busy}>
                    {isChecking ? 'Checking…' : "I’ve verified, continue"}
                </Button>
                <div className="flex items-center justify-between gap-3 text-sm">
                    <button type="button" className="min-h-11 text-muted-foreground hover:text-foreground disabled:opacity-60" disabled={busy} onClick={() => void handleSignOut()}>
                        {isSigningOut ? 'Signing out…' : 'Use a different account'}
                    </button>
                    <button
                        type="button"
                        onClick={() => void handleResend()}
                        disabled={busy || cooldown > 0}
                        className="min-h-11 font-medium text-primary underline-offset-4 hover:underline disabled:font-normal disabled:text-muted-foreground disabled:no-underline"
                    >
                        {isSending ? 'Sending…' : cooldown > 0 ? `Resend email in ${cooldown}s` : 'Resend email'}
                    </button>
                </div>
                <p className="nb-auth-note text-muted-foreground">
                    Emails come from <span className="font-mono text-foreground">welcome@networkbase.in</span>. Check spam if you can’t find it.
                </p>
            </div>
        </AuthShell>
    )
}

function VerifyEmailPageFallback() {
    return (
        <AuthShell title="Verify your email" description="Checking your account…" panel={VERIFY_PANEL}>
            <div className="h-11 animate-pulse rounded-md bg-muted" aria-busy="true" />
        </AuthShell>
    )
}

export default function VerifyEmailPage() {
    return (
        <AuthRouteProviders initialUser={null} initialProfile={null}>
            <Suspense fallback={<VerifyEmailPageFallback />}>
                <VerifyEmailPageInner />
            </Suspense>
        </AuthRouteProviders>
    )
}
