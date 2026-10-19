'use client'

import { Suspense, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
    AlertCircle,
    CheckCircle2,
    ExternalLink,
    KeyRound,
    Loader2,
    Lock,
    RefreshCw,
    ShieldCheck,
    Terminal,
    UserCheck,
} from 'lucide-react'

import { generateExtensionAuthCode } from '@/app/actions/extension-sessions'
import { AuthAmbientCanvas } from '@/components/auth/AuthAmbientCanvas'
import Logo from '@/components/layout/header/Logo'
import { LegalLinks } from '@/components/legal/LegalLinks'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

type ConnectionStatus = 'idle' | 'authorizing' | 'success' | 'error'

const EXTENSION_URI_AUTHORITY = 'nb-workspace.nb-vscode-sync'
const AUTH_CALLBACK_PATH = '/auth-callback'

const IDE_ICON_ASSETS: Record<string, string> = {
    vscode: '/ide-icons/vscode.png',
    'vscode-insiders': '/ide-icons/vscode.png',
    cursor: '/ide-icons/cursor.png',
    windsurf: '/ide-icons/windsurf.svg',
    antigravity: '/ide-icons/antigravity.png',
}

function parseProtocol(url: string | null): string | null {
    if (!url) return null
    try {
        return new URL(url).protocol.replace(':', '').toLowerCase()
    } catch {
        const match = url.match(/^([a-zA-Z][a-zA-Z0-9+.-]*):/)
        return match && match[1] ? match[1].toLowerCase() : null
    }
}

function getCallbackEditorName(url: string | null): string {
    const protocol = parseProtocol(url)
    if (!protocol) return 'IDE'

    if (protocol === 'antigravity') return 'Antigravity'
    if (protocol === 'cursor') return 'Cursor'
    if (protocol === 'windsurf') return 'Windsurf'
    if (protocol === 'vscode-insiders') return 'VS Code Insiders'
    if (protocol === 'vscode') return 'VS Code'
    if (protocol === 'http') return 'Local IDE Bridge'

    return protocol
        .split(/[-_]+/)
        .map((word) => {
            const lower = word.toLowerCase()
            if (lower === 'ide') return 'IDE'
            if (lower === 'vs') return 'VS'
            return word.charAt(0).toUpperCase() + word.slice(1)
        })
        .join(' ')
}

function getCallbackEditorIcon(url: string | null): string | null {
    const protocol = parseProtocol(url)
    if (!protocol) return null
    return IDE_ICON_ASSETS[protocol] ?? null
}

function validateCallback(url: string | null): boolean {
    if (!url) return false

    try {
        const parsed = new URL(url)
        return (
            /^[a-zA-Z][a-zA-Z0-9+.-]*:$/.test(parsed.protocol)
            && parsed.hostname === EXTENSION_URI_AUTHORITY
            && parsed.pathname === AUTH_CALLBACK_PATH
        )
    } catch {
        return false
    }
}

function formatCallbackDestination(url: string | null): string {
    if (!url) return 'Missing callback URI'

    try {
        const parsed = new URL(url)
        const scheme = parsed.protocol.replace(':', '')
        if (parsed.hostname) return `${scheme}://${parsed.hostname}`
        return `${scheme} callback`
    } catch {
        return url.length > 44 ? `${url.slice(0, 41)}...` : url
    }
}

function buildCallbackUrl(baseUrl: string, params: Record<string, string>): string {
    try {
        const url = new URL(baseUrl)
        Object.entries(params).forEach(([key, value]) => {
            url.searchParams.set(key, value)
        })
        return url.toString()
    } catch {
        const separator = baseUrl.includes('?') ? '&' : '?'
        return `${baseUrl}${separator}${new URLSearchParams(params).toString()}`
    }
}

function AuthorizePageInner({ viewerEmail }: { viewerEmail?: string | null }) {
    const router = useRouter()
    const searchParams = useSearchParams()
    const callbackUrl = searchParams.get('callback')
    const callbackState = searchParams.get('state')
    const isValid = validateCallback(callbackUrl)
    const editorName = getCallbackEditorName(callbackUrl)
    const editorIcon = getCallbackEditorIcon(callbackUrl)
    const callbackDestination = formatCallbackDestination(callbackUrl)

    const [status, setStatus] = useState<ConnectionStatus>('idle')
    const [progressText, setProgressText] = useState('Issuing revocable session token…')
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    const [debugDetails, setDebugDetails] = useState<string | null>(null)
    const [authCode, setAuthCode] = useState<string | null>(null)
    const [needsSignIn, setNeedsSignIn] = useState(false)

    const isDev = process.env.NODE_ENV !== 'production'

    const redirectToEditor = (params: Record<string, string>) => {
        if (!callbackUrl || !isValid) return
        window.location.assign(
            buildCallbackUrl(callbackUrl, callbackState ? { ...params, state: callbackState } : params),
        )
    }

    const handleAuthorize = async () => {
        if (!callbackUrl) {
            setStatus('error')
            setErrorMsg('Missing callback parameter.')
            return
        }

        if (!isValid) {
            setStatus('error')
            setErrorMsg('Invalid redirect callback scheme.')
            return
        }

        setStatus('authorizing')
        setErrorMsg(null)
        setDebugDetails(null)
        setProgressText('Verifying workspace session…')

        try {
            setProgressText('Generating revocable device token…')

            const res = await generateExtensionAuthCode(editorName, {
                authMethod: 'web_login',
                requestState: callbackState,
                callbackUri: callbackUrl,
            })

            if (res.success) {
                setAuthCode(res.code)
                setProgressText('Handing off to editor…')
                setStatus('success')
                redirectToEditor({ code: res.code })
                return
            }

            const nextError = 'error' in res ? res.error : 'Failed to authorize extension.'
            if (nextError === 'Not authenticated') {
                setNeedsSignIn(true)
                setStatus('idle')
                return
            }
            setStatus('error')
            setErrorMsg(nextError)
            setDebugDetails(JSON.stringify(res, null, 2))
            redirectToEditor({
                error: 'auth_failed',
                message: nextError,
            })
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            const stack = err instanceof Error ? err.stack : undefined
            setStatus('error')
            setErrorMsg('An unexpected error occurred during authorization.')
            setDebugDetails(JSON.stringify({ error: message, stack }, null, 2))
            redirectToEditor({
                error: 'server_error',
                message,
            })
        }
    }

    const handleCancel = () => {
        if (callbackUrl && isValid) {
            redirectToEditor({
                error: 'cancelled',
                message: 'User cancelled authorization',
            })
        }

        setTimeout(() => {
            window.location.assign('/discover')
        }, 250)
    }

    const handleManualLaunch = () => {
        if (!authCode) return
        redirectToEditor({ code: authCode })
    }

    const handleSignIn = () => {
        const nextPath = `${window.location.pathname}${window.location.search}`
        window.location.assign(`/login?redirect=${encodeURIComponent(nextPath)}`)
    }

    // Derive headline and subtitle for the active state
    const heading = !isValid
        ? 'Callback verification failed'
        : needsSignIn
            ? `Sign in to connect ${editorName}`
            : status === 'success'
                ? `${editorName} connected`
                : status === 'authorizing'
                    ? `Connecting ${editorName}…`
                    : `Connect ${editorName}`

    const subtitle = !isValid
        ? 'This authorization request is missing a valid NetworkBase extension callback URI.'
        : needsSignIn
            ? `Sign in to your NetworkBase account before approving access for ${editorName}.`
            : status === 'success'
                ? `Your session token was sent to ${editorName}. Return to your editor to start working.`
                : `Approve this request to connect ${editorName} to your NetworkBase projects, virtual files, and tasks.`

    return (
        <main
            aria-busy={status === 'authorizing'}
            className="min-h-dvh w-full grid grid-cols-1 lg:grid-cols-2 bg-background text-foreground"
        >
            {/* Left Panel: Clean Paper / Ink / Clay Authorization Surface */}
            <div className="flex flex-col justify-center items-center py-8 sm:py-12 px-6 sm:px-10 lg:px-12 xl:p-16 w-full min-h-dvh">
                <div className="w-full max-w-md my-auto sm:mt-2 transition-[color,background-color,border-color,box-shadow,opacity,transform] duration-[220ms] ease-out">
                    <div className="mb-10">
                        <Logo />
                    </div>

                    {/* Status Pill + Header */}
                    <div className="space-y-2 mb-6">
                        <div className="inline-flex items-center gap-2 rounded-sm border border-border bg-muted/40 px-2.5 py-1">
                            <span
                                aria-hidden="true"
                                className={cn(
                                    'size-1.5 rounded-[1px]',
                                    !isValid || status === 'error'
                                        ? 'bg-destructive'
                                        : needsSignIn
                                            ? 'bg-amber-600'
                                            : status === 'success'
                                                ? 'bg-emerald-700 dark:bg-emerald-400'
                                                : status === 'authorizing'
                                                    ? 'bg-primary animate-pulse'
                                                    : 'bg-primary',
                                )}
                            />
                            <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                                {!isValid
                                    ? 'Callback blocked'
                                    : needsSignIn
                                        ? 'Authentication required'
                                        : status === 'success'
                                            ? 'Session authorized'
                                            : status === 'authorizing'
                                                ? progressText
                                                : 'IDE Extension Handshake'}
                            </span>
                        </div>

                        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight text-foreground">
                            {heading}
                        </h1>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                            {subtitle}
                        </p>
                    </div>

                    {/* Error / Invalid Callback Banner */}
                    {!isValid ? (
                        <div
                            role="alert"
                            className="mb-5 p-3.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-start gap-2.5"
                        >
                            <AlertCircle className="size-4 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="font-medium">Unverified redirect destination</p>
                                <p className="text-xs leading-relaxed opacity-90">
                                    Only official <code className="font-mono">{EXTENSION_URI_AUTHORITY}</code> callbacks are permitted. Start the sign-in flow again directly from the NetworkBase sidebar in your IDE.
                                </p>
                            </div>
                        </div>
                    ) : null}

                    {status === 'error' && errorMsg ? (
                        <div
                            role="alert"
                            className="mb-5 p-3.5 rounded-md bg-destructive/10 border border-destructive/20 text-destructive text-sm space-y-2"
                        >
                            <div className="flex items-start gap-2.5">
                                <AlertCircle className="size-4 shrink-0 mt-0.5" />
                                <span>{errorMsg}</span>
                            </div>
                            {isDev && debugDetails ? (
                                <pre className="max-h-36 overflow-auto rounded border border-border bg-background/90 p-2.5 font-mono text-[11px] leading-relaxed text-foreground">
                                    {debugDetails}
                                </pre>
                            ) : null}
                        </div>
                    ) : null}

                    {status === 'success' ? (
                        <div className="mb-5 p-3.5 rounded-md border border-emerald-600/25 bg-emerald-600/10 text-sm text-emerald-900 dark:text-emerald-200 flex items-start gap-2.5">
                            <CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-400 shrink-0 mt-0.5" />
                            <div className="space-y-1">
                                <p className="font-medium">Handshake complete</p>
                                <p className="text-xs leading-relaxed opacity-90">
                                    If {editorName} did not open automatically, click <strong>Open {editorName}</strong> below. You can close this browser tab once connected.
                                </p>
                            </div>
                        </div>
                    ) : null}

                    {/* Compact Connection Summary Card */}
                    <section
                        aria-label="Connection details"
                        className="mb-6 rounded-md border border-border bg-card divide-y divide-border"
                    >
                        {/* Row 1: Target IDE & Callback */}
                        <div className="flex items-center justify-between gap-3 p-3.5">
                            <div className="flex min-w-0 items-center gap-3">
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-foreground">
                                    {editorIcon ? (
                                        <Image
                                            src={editorIcon}
                                            alt=""
                                            width={20}
                                            height={20}
                                            unoptimized
                                            className="size-5 object-contain"
                                        />
                                    ) : (
                                        <Terminal className="size-4 text-muted-foreground" />
                                    )}
                                </span>
                                <div className="min-w-0">
                                    <p className="text-xs text-muted-foreground">Editor</p>
                                    <p className="truncate text-sm font-medium text-foreground">
                                        {editorName}
                                    </p>
                                </div>
                            </div>
                            <span
                                title={callbackDestination}
                                className="max-w-[200px] truncate rounded-sm border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground"
                            >
                                {callbackDestination}
                            </span>
                        </div>

                        {/* Row 2: Account */}
                        <div className="flex items-center justify-between gap-3 p-3.5">
                            <div className="flex min-w-0 items-center gap-3">
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground">
                                    <UserCheck className="size-4" />
                                </span>
                                <div className="min-w-0">
                                    <p className="text-xs text-muted-foreground">Account</p>
                                    <p className="truncate text-sm font-medium text-foreground">
                                        {needsSignIn
                                            ? 'Not signed in'
                                            : viewerEmail || 'Active browser session'}
                                    </p>
                                </div>
                            </div>
                            {!needsSignIn && status !== 'success' ? (
                                <button
                                    type="button"
                                    onClick={handleSignIn}
                                    className="shrink-0 text-xs font-medium text-muted-foreground hover:text-foreground underline underline-offset-4 transition-colors cursor-pointer"
                                >
                                    Switch
                                </button>
                            ) : null}
                        </div>

                        {/* Row 3: Scope & Security */}
                        <div className="flex items-center justify-between gap-3 p-3.5">
                            <div className="flex min-w-0 items-center gap-3">
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground">
                                    <Lock className="size-4" />
                                </span>
                                <div className="min-w-0">
                                    <p className="text-xs text-muted-foreground">Session scope</p>
                                    <p className="truncate text-xs text-foreground">
                                        Projects, virtual files &amp; task pushes · Revocable anytime
                                    </p>
                                </div>
                            </div>
                            <KeyRound className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
                        </div>
                    </section>

                    {/* Primary & Secondary Actions */}
                    <div className="space-y-2.5">
                        {needsSignIn ? (
                            <Button
                                type="button"
                                onClick={handleSignIn}
                                className="w-full h-11 font-medium shadow-none"
                            >
                                <ShieldCheck className="size-4 mr-2" />
                                Sign in to continue
                            </Button>
                        ) : status === 'success' ? (
                            <Button
                                type="button"
                                onClick={handleManualLaunch}
                                className="w-full h-11 font-medium shadow-none"
                            >
                                <ExternalLink className="size-4 mr-2" />
                                Open {editorName}
                            </Button>
                        ) : status === 'error' ? (
                            <Button
                                type="button"
                                onClick={handleAuthorize}
                                disabled={!isValid}
                                className="w-full h-11 font-medium shadow-none"
                            >
                                <RefreshCw className="size-4 mr-2" />
                                Try again
                            </Button>
                        ) : (
                            <Button
                                type="button"
                                onClick={handleAuthorize}
                                disabled={status === 'authorizing' || !isValid}
                                className="w-full h-11 font-medium shadow-none"
                            >
                                {status === 'authorizing' ? (
                                    <>
                                        <Loader2 className="size-4 mr-2 animate-spin" />
                                        Authorizing {editorName}…
                                    </>
                                ) : (
                                    <>
                                        <ShieldCheck className="size-4 mr-2" />
                                        Authorize {editorName}
                                    </>
                                )}
                            </Button>
                        )}

                        <Button
                            type="button"
                            variant="outline"
                            onClick={status === 'success' ? () => router.push('/discover') : handleCancel}
                            className="w-full h-10 font-medium border-border/80 hover:bg-muted/50"
                        >
                            {status === 'success' ? 'Return to NetworkBase' : 'Cancel'}
                        </Button>
                    </div>

                    {/* Footer */}
                    <div className="mt-7 pt-5 border-t border-border/40 text-center space-y-3.5">
                        <p className="text-xs text-muted-foreground">
                            Connected editors can be disconnected anytime in{' '}
                            <Link
                                href="/settings?tab=integrations"
                                className="text-foreground font-medium hover:text-primary underline underline-offset-4 transition-colors"
                            >
                                Integrations Settings
                            </Link>
                        </p>
                        <LegalLinks className="text-[11px] text-muted-foreground/80" showCopyright />
                    </div>
                </div>
            </div>

            {/* Right Panel: Canonical NetworkBase Editorial Ambient Canvas */}
            <AuthAmbientCanvas />
        </main>
    )
}

function AuthorizeFallback() {
    return (
        <main className="min-h-dvh w-full grid grid-cols-1 lg:grid-cols-2 bg-background text-foreground">
            <div className="flex flex-col justify-center items-center py-8 px-6 w-full min-h-dvh">
                <div className="w-full max-w-md space-y-4">
                    <div className="mb-10">
                        <Logo />
                    </div>
                    <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
                        <Loader2 className="size-4 animate-spin text-primary" />
                        <span>Preparing editor handshake…</span>
                    </div>
                </div>
            </div>
            <AuthAmbientCanvas />
        </main>
    )
}

export default function AuthorizeClient({ viewerEmail = null }: { viewerEmail?: string | null }) {
    return (
        <Suspense fallback={<AuthorizeFallback />}>
            <AuthorizePageInner viewerEmail={viewerEmail} />
        </Suspense>
    )
}
