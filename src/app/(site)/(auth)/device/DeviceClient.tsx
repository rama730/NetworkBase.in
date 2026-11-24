'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ShieldCheck, Sparkles, X } from 'lucide-react'
import { toast } from 'sonner'

import { decideDeviceCodeAction } from '@/app/actions/device-codes'
import { AgentAccessPicker, agentAccessSentence, workspaceBlocked, type AgentAccessValue, type AgentWorkspaceOption } from '@/components/agents/AgentAccessPicker'
import { AUTH_INPUT, AUTH_LINK, AuthAlert, AuthShell, SignedInAs, usePasteAnywhere } from '@/components/auth/AuthShell'
import { AUTH_PANELS } from '@/components/auth/auth-panels'
import { TerminalMirror } from '@/components/auth/AuthPanel'
import { PixelIcon, PixelSpinner } from '@/components/auth/pixel'
import { formatGroupedCode } from '@/lib/auth/code-format'
import SecurityStepUpDialog from '@/components/settings/SecurityStepUpDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TerminalBlock } from '@/components/ui/terminal-block'
import type { AgentPreset } from '@/lib/agents/access'
import type { TokenScope } from '@/lib/security/token-access'

type Pending = {
    userCode: string
    clientName: string
    deviceName: string
    clientVersion: string | null
    platform: string | null
    requestedType: 'device' | 'agent'
    agentName: string | null
    ipAddress: string | null
    country: string | null
    viaOAuth: boolean
    returnTo: string | null
    renewal: boolean
    prefill: { access: AgentPreset; workspace: string; expiryDays: number; extraScopes?: TokenScope[] }
    createdAt: string
    expiresAt: string
}
type StepUpMethod = 'totp' | 'recovery_code' | 'password'

const PANEL = AUTH_PANELS.device
const NEW_BANNER_KEY = 'nb-new-banner:one-click-agents'
const TRY_PROMPTS = ['What should I do today?', 'Work on task 4']

const countryName = (code: string | null) => {
    if (!code) return null
    try { return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code } catch { return code }
}

function startingChoice(pending: Pending | null, workspaces: AgentWorkspaceOption[]): AgentAccessValue {
    const p = pending?.prefill
    const known = p && p.workspace !== 'all' && workspaces.some((w) => w.id === p.workspace && !w.agentsOff)
    const days = p && [7, 30, 90].includes(p.expiryDays) ? (p.expiryDays as 7 | 30 | 90) : 30
    const choice: AgentAccessValue = { access: p?.access ?? 'full', workspace: known ? p!.workspace : 'all', expiryDays: days, extraScopes: p?.extraScopes ?? [] }
    // Only read access reaches anything when every workspace is read-only for this person (report A3).
    const writable = workspaces.some((w) => !workspaceBlocked(w, 'full'))
    if (!writable && workspaces.some((w) => !w.agentsOff)) choice.access = 'read'
    return choice
}

/** The approval page (report A2, A3): a summary first and one click, with the options on request. */
export default function DeviceClient({ viewerEmail, viewerName = null, viewerId, code, pending, workspaces }: { viewerEmail: string | null; viewerName?: string | null; viewerId: string | null; code: string; pending: Pending | null; workspaces: AgentWorkspaceOption[] }) {
    const [type, setType] = useState<'device' | 'agent'>(pending?.viaOAuth ? 'agent' : pending?.requestedType ?? 'device')
    const [choice, setChoice] = useState<AgentAccessValue>(() => startingChoice(pending, workspaces))
    const [changing, setChanging] = useState(false)
    const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
    const [done, setDone] = useState<'approve' | 'deny' | null>(null)
    const [expired, setExpired] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [stepUp, setStepUp] = useState<{ methods: StepUpMethod[]; factorId?: string } | null>(null)
    const [showNew, setShowNew] = useState(false)
    const router = useRouter()
    // The code box groups as ABCD-EFGH while typing, takes a paste from anywhere on the page, and goes on when complete.
    const [typed, setTyped] = useState(() => formatGroupedCode(code))
    const codeFormRef = useRef<HTMLFormElement | null>(null)
    const takeCode = (raw: string) => {
        const next = formatGroupedCode(raw)
        setTyped(next)
        if (next.length === 9 && next !== typed) queueMicrotask(() => codeFormRef.current?.requestSubmit())
    }
    usePasteAnywhere((text) => { if (formatGroupedCode(text).length === 9) takeCode(text) }, !!viewerEmail && (!pending || expired) && !done)
    const here = `/device${code ? `?code=${encodeURIComponent(code)}` : ''}`
    const account = viewerEmail ? <SignedInAs userId={viewerId} email={viewerEmail} name={viewerName} next={here} /> : null

    const bannerKey = `${NEW_BANNER_KEY}:${viewerId ?? 'anon'}`
    useEffect(() => {
        try { setShowNew(window.localStorage.getItem(bannerKey) !== '1') } catch { setShowNew(true) }
    }, [bannerKey])
    const dismissNew = () => { setShowNew(false); try { window.localStorage.setItem(bannerKey, '1') } catch { /* private mode */ } }

    const agentName = pending?.agentName?.trim() || (pending?.viaOAuth ? pending.clientName : 'This AI agent')
    const from = countryName(pending?.country ?? null)
    const usable = workspaces.filter((w) => !w.agentsOff)
    const agentsOffEverywhere = workspaces.length > 0 && usable.length === 0
    const noWorkspace = workspaces.length === 0
    const agentBlocked = type === 'agent' && (agentsOffEverywhere || noWorkspace)
    const sentence = agentAccessSentence(agentName, choice, workspaces)

    const signIn = () => router.push(`/login?redirect=${encodeURIComponent(`/device${code ? `?code=${encodeURIComponent(code)}` : ''}`)}`)

    async function decide(decision: 'approve' | 'deny') {
        if (!pending) return
        setBusy(decision)
        setError(null)
        try {
            const input = decision === 'deny'
                ? { decision }
                : type === 'agent'
                    ? { decision, type, access: choice.access, workspace: choice.workspace, expiryDays: choice.expiryDays, ...(choice.access === 'custom' ? { extraScopes: choice.extraScopes } : {}) }
                    : { decision, type }
            const result = await decideDeviceCodeAction(pending.userCode, input)
            if (result.success) {
                // An editor's OAuth sign-in goes back to the editor with its code (or access_denied).
                if (result.redirectTo) {
                    window.location.assign(result.redirectTo)
                    return
                }
                setDone(result.decision)
                return
            }
            if (result.expired) { setTyped(''); return void setExpired(true) }
            if (result.stepUpRequired) {
                const response = await fetch('/api/v1/auth/security-step-up')
                const payload = await response.json().catch(() => null)
                const methods = (payload?.data?.availableMethods ?? []).filter((m: unknown): m is StepUpMethod => m === 'totp' || m === 'recovery_code' || m === 'password')
                if (methods.length) setStepUp({ methods, factorId: typeof payload?.data?.primaryTotpFactorId === 'string' ? payload.data.primaryTotpFactorId : undefined })
                else toast.warning('Add a password or authenticator in Security first')
                return
            }
            setError(result.error)
        } catch {
            setError('Couldn’t save your answer. Try again.')
        } finally {
            setBusy(null)
        }
    }

    const footer = <>Signed-in terminals and agents are listed in <Link href="/settings#settings-integrations" className={AUTH_LINK}>Settings → Integrations</Link>, where you can change or revoke them.</>
    const codeForm = (
        <form ref={codeFormRef} method="get" action="/device" className="space-y-3">
            <label className="block space-y-1.5">
                <span className="text-sm font-medium">Code</span>
                <Input name="code" value={typed} onChange={(event) => takeCode(event.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={9} placeholder="ABCD-EFGH" className={`${AUTH_INPUT} font-mono tracking-widest uppercase`} required />
            </label>
            <p className="text-xs text-muted-foreground">Paste it as it is: capitals and the dash don’t matter.</p>
            <Button type="submit" className="h-11 w-full font-medium">Continue</Button>
        </form>
    )

    if (done === 'approve') {
        return (
            <AuthShell
                title={type === 'agent' ? `${agentName} is connected` : 'Your terminal is signed in'}
                description="Go back to your terminal; it continues on its own."
                panel={PANEL}
                footer={footer}
                mark="check"
                outcome={{ word: 'OK', title: type === 'agent' ? `${agentName} is connected.` : 'Your terminal is signed in.' }}
                panelExtra={pending && !pending.viaOAuth && type === 'device' ? <TerminalMirror code={pending.userCode} done email={viewerEmail} /> : undefined}
            >
                {type === 'agent' ? (
                    <div className="space-y-3">
                        <p className="text-sm font-medium">Try asking it</p>
                        <ul className="space-y-2">
                            {TRY_PROMPTS.map((p) => <li key={p} className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">“{p}”</li>)}
                        </ul>
                        <p className="text-sm text-muted-foreground">{sentence}</p>
                    </div>
                ) : <AuthAlert tone="success">You can close this tab.</AuthAlert>}
            </AuthShell>
        )
    }
    if (done === 'deny') {
        return (
            <AuthShell title="Sign-in denied" description="Nothing was signed in. Your terminal will say so." panel={PANEL} footer={footer} mark="cross" outcome={{ word: 'NO', title: 'Nothing was signed in.' }}>
                <div className="space-y-4">
                    <AuthAlert tone="info">If you didn’t start this, someone tried to sign in as you{from ? ` from ${from}` : ''}. Secure your account:</AuthAlert>
                    <div className="grid gap-2.5 sm:grid-cols-2">
                        <Button asChild variant="outline" className="h-11 font-medium"><Link href="/settings#settings-security-sessions">Sign out everywhere</Link></Button>
                        <Button asChild variant="outline" className="h-11 font-medium"><Link href="/settings#settings-security-password">Change password</Link></Button>
                    </div>
                    <p className="text-sm"><Link href="/settings#settings-security" className={AUTH_LINK}>Security settings</Link></p>
                </div>
            </AuthShell>
        )
    }
    if (!viewerEmail) {
        return (
            <AuthShell title="Sign in to approve a terminal" description="Sign in, and you come straight back here with the code filled in." panel={PANEL} footer={footer} step={[1, 2]}>
                <div className="space-y-3">
                    <Button type="button" onClick={signIn} className="h-11 w-full font-medium"><ShieldCheck className="size-4" aria-hidden="true" />Sign in to continue</Button>
                    <p className="text-sm text-muted-foreground">Your terminal shows a code after <code className="whitespace-nowrap rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground">nb login --device</code>.</p>
                </div>
            </AuthShell>
        )
    }
    if (expired || (code && !pending)) {
        return (
            <AuthShell title="This code has run out" description="It expired or was already used. Start the sign-in again in your terminal:" panel={PANEL} footer={footer} mark="clock" outcome={{ word: 'OLD', title: 'Codes work once, then expire.' }}>
                <div className="space-y-5">
                    <TerminalBlock variant="command" label="Terminal">{'$ nb login --device'}</TerminalBlock>
                    <p className="text-sm text-muted-foreground">Got a new code? Enter it here.</p>
                    {codeForm}
                </div>
            </AuthShell>
        )
    }
    if (!pending) {
        return (
            <AuthShell title="Enter the code from your terminal" description="Your terminal shows a code like ABCD-EFGH." panel={PANEL} footer={footer} step={[1, 2]}>
                <div className="space-y-5">
                    {account}
                    {codeForm}
                </div>
            </AuthShell>
        )
    }

    const title = type === 'device' ? 'Sign in your terminal' : pending.renewal ? `Renew ${agentName}’s access` : `${agentName} wants to work with you on NetworkBase`
    const description = pending.viaOAuth ? `Approving sends you back to ${pending.returnTo}.` : 'Approve only if your terminal shows the same code.'
    return (
        <AuthShell
            title={title}
            description={description}
            panel={PANEL}
            footer={footer}
            step={[2, 2]}
            mark="shield"
            panelExtra={pending.viaOAuth ? undefined : <TerminalMirror code={pending.userCode} />}
        >
            <div className="space-y-5" aria-busy={busy !== null}>
                {showNew && type === 'agent' ? (
                    <div role="note" className="flex items-start gap-2.5 rounded-md border border-border bg-muted/40 p-3 text-sm">
                        <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden="true" />
                        <p className="min-w-0 flex-1"><span className="font-medium">New: approve agents in one click.</span> Change where, what and how long here, or any time in Settings.</p>
                        <button type="button" onClick={dismissNew} aria-label="Dismiss" className="rounded p-0.5 text-muted-foreground hover:text-foreground"><X className="size-4" aria-hidden="true" /></button>
                    </div>
                ) : null}

                {pending.viaOAuth ? null : <p className="rounded-md border border-border bg-muted/40 p-3 text-center font-mono text-2xl tracking-[0.3em]" aria-label={`Code ${pending.userCode.split('').join(' ')}`}>{pending.userCode}</p>}

                {account}

                <section aria-label="Who is asking" className="divide-y divide-border rounded-md border border-border bg-card text-sm">
                    <div className="flex items-start gap-3 p-3">
                        <PixelIcon name={type === 'agent' ? 'bot' : 'terminal'} className="mt-1 text-muted-foreground" />
                        <span className="min-w-0 break-words">
                            <span className="font-medium">{pending.clientName}</span>{pending.clientVersion ? <span className="text-muted-foreground"> {pending.clientVersion}</span> : null}
                            {pending.viaOAuth ? <span className="text-muted-foreground"> · editor</span> : <> · {pending.deviceName}{pending.platform ? <span className="text-muted-foreground"> · {pending.platform}</span> : null}</>}
                        </span>
                    </div>
                    {pending.viaOAuth ? (
                        <div className="flex items-start gap-3 p-3">
                            <PixelIcon name="arrow" className="mt-1 text-muted-foreground" />
                            <span className="min-w-0 break-words text-muted-foreground">Sends you back to <span className="font-medium text-foreground">{pending.returnTo}</span></span>
                        </div>
                    ) : null}
                    <div className="flex items-start gap-3 p-3">
                        <PixelIcon name="pin" className="mt-1 text-muted-foreground" />
                        <span className="min-w-0 break-words">{from ? <>From {from}</> : 'Location unknown'}{pending.ipAddress ? <span className="text-xs text-muted-foreground"> · {pending.ipAddress}</span> : null}</span>
                    </div>
                    <div className="flex items-start gap-3 p-3">
                        <PixelIcon name="clock" className="mt-1 text-muted-foreground" />
                        <span className="min-w-0 break-words text-muted-foreground">Asked at {new Date(pending.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    </div>
                </section>

                {type === 'device' ? (
                    <div className="space-y-2 text-sm">
                        <p className="flex items-start gap-2.5 rounded-md border border-border bg-card p-3 leading-relaxed"><PixelIcon name="check" className="mt-1.5 text-[var(--status-success)]" />Your terminal can do what you can, in all your workspaces, for 90 days.</p>
                        {pending.viaOAuth ? null : <button type="button" className={`${AUTH_LINK} text-sm`} onClick={() => setType('agent')}>This is actually an AI agent</button>}
                    </div>
                ) : agentsOffEverywhere ? (
                    <AuthAlert tone="error">Every workspace you’re in belongs to an organization that turned AI agents off. Its admins can turn them back on in the organization’s settings.</AuthAlert>
                ) : noWorkspace ? (
                    <div className="space-y-3">
                        <AuthAlert tone="info">You don’t have a workspace yet. Create one, then come back: this sign-in keeps waiting until {new Date(pending.expiresAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.</AuthAlert>
                        <Button asChild variant="outline" className="h-11 w-full font-medium"><Link href="/workspaces/new" target="_blank">Create a workspace</Link></Button>
                    </div>
                ) : (
                    <section aria-label="What you approve" className="space-y-3">
                        <div className="rounded-md border border-border bg-card p-3 text-sm leading-relaxed">
                            <p aria-live="polite">{sentence}</p>
                            {!workspaces.some((w) => !workspaceBlocked(w, 'full')) ? <p className="mt-1.5 text-muted-foreground">You can only read your workspaces, so this agent can only read too.</p> : null}
                            <div className="mt-2 flex items-center gap-3">
                                <button type="button" className={`${AUTH_LINK} text-sm`} aria-expanded={changing} onClick={() => setChanging((v) => !v)}>{changing ? 'Done' : 'Change'}</button>
                                <a href="/docs/agents#presets" target="_blank" rel="noreferrer" className="text-sm text-muted-foreground underline underline-offset-4 hover:text-foreground">What’s this?</a>
                            </div>
                        </div>
                        {changing ? <div className="rounded-md border border-border p-3"><AgentAccessPicker value={choice} onChange={setChoice} workspaces={workspaces} /></div> : null}
                    </section>
                )}

                {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}

                <div className="grid gap-2.5 sm:grid-cols-2">
                    <Button type="button" onClick={() => decide('approve')} disabled={busy !== null || agentBlocked} className="h-11 font-medium sm:order-2">
                        {busy === 'approve' ? <PixelSpinner /> : <ShieldCheck className="size-4" aria-hidden="true" />}{pending.renewal && type === 'agent' ? 'Renew' : 'Approve'}
                    </Button>
                    <Button type="button" variant="outline" onClick={() => decide('deny')} disabled={busy !== null} className="h-11 font-medium sm:order-1">
                        {busy === 'deny' ? <PixelSpinner /> : null}Not me
                    </Button>
                </div>
            </div>
            <SecurityStepUpDialog
                open={stepUp !== null}
                onOpenChange={(open) => { if (!open) setStepUp(null) }}
                title="Verify before approving"
                description="Approving signs this in as you, so confirm it is you first. A check in the last 5 minutes counts."
                availableMethods={stepUp?.methods ?? []}
                factorId={stepUp?.factorId}
                onVerified={() => { setStepUp(null); return decide('approve') }}
            />
        </AuthShell>
    )
}
