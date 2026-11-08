'use client'

import { Suspense, useState } from 'react'
import { Button } from '@/components/ui/button'
import { useAuth } from '@/hooks/use-auth'
import { AuthRouteProviders } from '@/components/providers/AuthRouteProviders'
import { AUTH_LINK, AuthAlert, AuthShell, EmailCodeForm } from '@/components/auth/AuthShell'
import { toFriendlyAuthError } from '@/lib/auth/error-messages'
import { loadBrowserSupabase, syncBrowserSessionToServer } from '@/lib/auth/browser-auth-actions'


const VERIFY_PANEL = {
    eyebrow: 'One last step',
    title: 'Verified email keeps NetworkBase real.',
    points: ['Keeps spam accounts out', 'Lets you recover your account', 'Unlocks messages and workspaces'],
}

function VerifyEmailPageInner() {
    const { user, signOut } = useAuth()
    const [isChecking, setIsChecking] = useState(false)
    const [isSigningOut, setIsSigningOut] = useState(false)
    const [message, setMessage] = useState<string | null>(null)
    const [error, setError] = useState<string | null>(null)


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

    const busy = isChecking || isSigningOut

    const address = user?.email || ''
    return (
        <AuthShell
            title="Verify your email"
            description={<>We sent a 6-digit code to <span className="font-medium text-foreground">{address || 'your email address'}</span>. Enter it here, or open the link in the email.</>}
            panel={VERIFY_PANEL}
            footer={<button type="button" className={AUTH_LINK} disabled={busy} onClick={() => void handleSignOut()}>{isSigningOut ? 'Signing out…' : 'Use a different account'}</button>}
        >
            <div className="space-y-4">
                {message ? <AuthAlert tone="success">{message}</AuthAlert> : null}
                {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}
                {address ? (
                    <EmailCodeForm
                        id="verify-code"
                        email={address}
                        label="Verification code"
                        submitLabel="Verify email"
                        resendAction="signup-resend"
                        onVerify={async (code) => {
                            const supabase = await loadBrowserSupabase()
                            const { data, error: verifyError } = await supabase.auth.verifyOtp({ email: address, token: code, type: 'signup' })
                            if (verifyError || !data.session) return 'That code is wrong or has expired. Check it, or send a new one.'
                            await syncBrowserSessionToServer(data.session).catch(() => null)
                            window.location.reload()
                            return null
                        }}
                        onResend={async (token) => {
                            const supabase = await loadBrowserSupabase()
                            const { error: resendError } = await supabase.auth.resend({ type: 'signup', email: address, options: token ? { captchaToken: token } : undefined })
                            return resendError ? toFriendlyAuthError(resendError.message, 'We couldn’t send a new code. Try again in a minute.') : null
                        }}
                    />
                ) : null}
                <Button variant="outline" className="h-11 w-full font-medium" onClick={() => void handleContinue()} disabled={busy}>
                    {isChecking ? 'Checking…' : 'I opened the link on another device'}
                </Button>
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
