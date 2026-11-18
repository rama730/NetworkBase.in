'use client'

import { Suspense, useEffect, useState } from 'react'
import { TerminalBlock } from "@/components/ui/terminal-block";
import Image from 'next/image'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
    ExternalLink,
    Loader2,
    Lock,
    RefreshCw,
    ShieldCheck,
    Terminal,
    UserCheck,
} from 'lucide-react'

import { generateExtensionAuthCode } from '@/app/actions/extension-sessions'
import { AUTH_LINK, AuthAlert, AuthShell } from '@/components/auth/AuthShell'
import { Button } from '@/components/ui/button'

type ConnectionStatus = 'idle' | 'authorizing' | 'success' | 'error'

const AUTHORIZE_PANEL = {
    eyebrow: 'Editor sync',
    title: 'Your work, inside your code editor.',
    points: ['Open your workspaces and virtual files', 'Push tasks without leaving the editor', 'Disconnect any time from settings'],
}

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
    if (protocol === 'http') return 'NetworkBase CLI'

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
        const isLoopbackCli =
            parsed.protocol === 'http:'
            && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')
            && Boolean(parsed.port)
            && parsed.pathname === AUTH_CALLBACK_PATH

        const isIdeScheme =
            /^[a-zA-Z][a-zA-Z0-9+.-]*:$/.test(parsed.protocol)
            && parsed.protocol !== 'http:'
            && parsed.protocol !== 'https:'
            && parsed.hostname === EXTENSION_URI_AUTHORITY
            && parsed.pathname === AUTH_CALLBACK_PATH

        return isLoopbackCli || isIdeScheme
    } catch {
        return false
    }
}

function formatCallbackDestination(url: string | null): string {
    if (!url) return 'Missing callback URI'

    try {
        const parsed = new URL(url)
        if (parsed.protocol === 'http:' && (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost')) {
            return `cli://${parsed.hostname}:${parsed.port}`
        }
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
    const [progressText, setProgressText] = useState('Connecting…')
    const [errorMsg, setErrorMsg] = useState<string | null>(null)
    const [debugDetails, setDebugDetails] = useState<string | null>(null)
    const [authCode, setAuthCode] = useState<string | null>(null)
    const [needsSignIn, setNeedsSignIn] = useState(false)
    const [countdown, setCountdown] = useState<number | null>(null)

    const isDev = process.env.NODE_ENV !== 'production'

    useEffect(() => {
        if (status !== 'success' || parseProtocol(callbackUrl) !== 'http') {
            return
        }
        setCountdown(4)
        const interval = setInterval(() => {
            setCountdown((prev) => {
                if (prev === null || prev <= 1) {
                    clearInterval(interval)
                    try {
                        window.close()
                    } catch {}
                    return 0
                }
                return prev - 1
            })
        }, 1000)
        return () => clearInterval(interval)
    }, [status, callbackUrl])

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
            setProgressText('Connecting…')

            const protocol = parseProtocol(callbackUrl)
            // The CLI names its computer (device=), so Settings can tell two terminal sign-ins apart.
            const device = protocol === 'http' ? (searchParams.get('device') ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120) : ''
            const res = await generateExtensionAuthCode(device || editorName, {
                authMethod: 'web_login',
                editorHost: protocol === 'http' ? 'cli' : protocol || undefined,
                editorName,
                requestState: callbackState,
                callbackUri: callbackUrl,
                codeChallenge: searchParams.get('code_challenge'),
            })

            if (res.success) {
                setAuthCode(res.code)
                const isCliLoopback = protocol === 'http'

                if (isCliLoopback) {
                    setProgressText('Connecting to terminal…')
                    try {
                        const targetUrl = buildCallbackUrl(
                            callbackUrl,
                            callbackState ? { code: res.code, state: callbackState } : { code: res.code },
                        )
                        const controller = new AbortController()
                        const timer = setTimeout(() => controller.abort(), 3500)
                        const fetchRes = await fetch(targetUrl, {
                            mode: 'cors',
                            headers: { Accept: 'application/json' },
                            signal: controller.signal,
                        })
                        clearTimeout(timer)
                        if (fetchRes.ok) {
                            setStatus('success')
                            return
                        }
                    } catch {
                        // Background handshake didn't reach loopback; proceed to redirect fallback
                    }
                }

                setProgressText('Opening your editor…')
                setStatus('success')
                redirectToEditor({ code: res.code })
                return
            }

            const nextError = 'error' in res ? res.error : 'Couldn’t authorize extension.'
            if (nextError === 'Sign in to continue') {
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
                message: 'User canceled authorization',
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
                : `Approve to connect ${editorName} to your NetworkBase workspaces, virtual files and tasks.`

    const statusLabel = !isValid
        ? 'Callback blocked'
        : needsSignIn
            ? 'Sign-in required'
            : status === 'success'
                ? 'Connected'
                : status === 'authorizing'
                    ? progressText
                    : 'Editor sync'
    const statusTone = !isValid || status === 'error' ? 'blocked' : needsSignIn ? 'draft' : status === 'success' ? 'completed' : 'active'

    return (
        <AuthShell
            title={heading}
            description={subtitle}
            panel={AUTHORIZE_PANEL}
            footer={<>Disconnect an editor any time in <Link href="/settings?tab=integrations" className={AUTH_LINK}>Integrations settings</Link>.</>}
        >
            <div aria-busy={status === 'authorizing'} className="space-y-5">
                <span className="nb-status" data-status={statusTone}>{statusLabel}</span>

                {!isValid ? (
                    <AuthAlert tone="error" title="Unverified redirect destination">
                        Only official <code className="font-mono">{EXTENSION_URI_AUTHORITY}</code> callbacks are allowed. Start sign-in again from the NetworkBase sidebar in your editor.
                    </AuthAlert>
                ) : null}

                {status === 'error' && errorMsg ? (
                    <AuthAlert tone="error">
                        {errorMsg}
                        {isDev && debugDetails ? (
                            <TerminalBlock variant="output" label="Details" className="mt-2">{debugDetails}</TerminalBlock>
                        ) : null}
                    </AuthAlert>
                ) : null}

                {status === 'success' ? (
                    <AuthAlert tone="success" title={`${editorName} connected`}>
                        {parseProtocol(callbackUrl) === 'http' ? (
                            <>
                                Your terminal session is authenticated. You can safely close this tab and return to your terminal.
                                {countdown !== null && countdown > 0 ? (
                                    <span className="block mt-1.5 font-mono text-xs text-muted-foreground">
                                        Closing window automatically in {countdown}s…
                                    </span>
                                ) : null}
                            </>
                        ) : (
                            <>
                                If {editorName} didn’t open on its own, choose <strong>Open {editorName}</strong> below. You can close this tab once you’re back in your editor.
                            </>
                        )}
                    </AuthAlert>
                ) : null}

                <section aria-label="Connection details" className="divide-y divide-border rounded-md border border-border bg-card">
                    <div className="flex items-center justify-between gap-3 p-3.5">
                        <div className="flex min-w-0 items-center gap-3">
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-foreground">
                                {editorIcon ? (
                                    <Image src={editorIcon} alt="" width={20} height={20} unoptimized className="size-5 object-contain" />
                                ) : (
                                    <Terminal className="size-4 text-muted-foreground" aria-hidden="true" />
                                )}
                            </span>
                            <div className="min-w-0">
                                <p className="text-xs text-muted-foreground">Editor</p>
                                <p className="truncate text-sm font-medium">{editorName}</p>
                            </div>
                        </div>
                        <span title={callbackDestination} className="max-w-[160px] truncate rounded-sm border border-border bg-muted/40 px-2 py-0.5 font-mono text-[11px] text-muted-foreground">
                            {callbackDestination}
                        </span>
                    </div>
                    <div className="flex items-center justify-between gap-3 p-3.5">
                        <div className="flex min-w-0 items-center gap-3">
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground">
                                <UserCheck className="size-4" aria-hidden="true" />
                            </span>
                            <div className="min-w-0">
                                <p className="text-xs text-muted-foreground">Account</p>
                                <p className="truncate text-sm font-medium">{needsSignIn ? 'Sign in to continue' : viewerEmail || 'Active browser session'}</p>
                            </div>
                        </div>
                        {!needsSignIn && status !== 'success' ? (
                            <button type="button" onClick={handleSignIn} className="min-h-11 shrink-0 text-xs font-medium text-muted-foreground underline underline-offset-4 hover:text-foreground">
                                Switch
                            </button>
                        ) : null}
                    </div>
                    <div className="flex items-center gap-3 p-3.5">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted/50 text-muted-foreground">
                            <Lock className="size-4" aria-hidden="true" />
                        </span>
                        <div className="min-w-0">
                            <p className="text-xs text-muted-foreground">Access</p>
                            <p className="text-xs">Workspaces, virtual files and task pushes. Revocable any time.</p>
                        </div>
                    </div>
                </section>

                <div className="space-y-2.5">
                    {needsSignIn ? (
                        <Button type="button" onClick={handleSignIn} className="h-11 w-full font-medium">
                            <ShieldCheck className="size-4" aria-hidden="true" />
                            Sign in to continue
                        </Button>
                    ) : status === 'success' ? (
                        parseProtocol(callbackUrl) === 'http' ? (
                            <Button type="button" onClick={() => window.close()} className="h-11 w-full font-medium">
                                Close window
                            </Button>
                        ) : (
                            <Button type="button" onClick={handleManualLaunch} className="h-11 w-full font-medium">
                                <ExternalLink className="size-4" aria-hidden="true" />
                                Open {editorName}
                            </Button>
                        )
                    ) : status === 'error' ? (
                        <Button type="button" onClick={handleAuthorize} disabled={!isValid} className="h-11 w-full font-medium">
                            <RefreshCw className="size-4" aria-hidden="true" />
                            Try again
                        </Button>
                    ) : (
                        <Button type="button" onClick={handleAuthorize} disabled={status === 'authorizing' || !isValid} className="h-11 w-full font-medium">
                            {status === 'authorizing' ? (
                                <><Loader2 className="size-4 animate-spin" aria-hidden="true" />Connecting {editorName}…</>
                            ) : (
                                <><ShieldCheck className="size-4" aria-hidden="true" />Connect {editorName}</>
                            )}
                        </Button>
                    )}
                    <Button type="button" variant="ghost" onClick={status === 'success' ? () => router.push('/discover') : handleCancel} className="h-11 w-full">
                        {status === 'success' ? 'Return to NetworkBase' : 'Cancel'}
                    </Button>
                </div>
            </div>
        </AuthShell>
    )
}

function AuthorizeFallback() {
    return (
        <AuthShell title="Connect your editor" description="Preparing the connection…" panel={AUTHORIZE_PANEL}>
            <div className="h-40 animate-pulse rounded-md bg-muted" aria-busy="true" />
        </AuthShell>
    )
}

export default function AuthorizeClient({ viewerEmail = null }: { viewerEmail?: string | null }) {
    return (
        <Suspense fallback={<AuthorizeFallback />}>
            <AuthorizePageInner viewerEmail={viewerEmail} />
        </Suspense>
    )
}
