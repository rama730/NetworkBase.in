'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { Bot, Clock, ExternalLink, Loader2, MapPin, ShieldCheck, Terminal } from 'lucide-react'
import { toast } from 'sonner'

import { decideDeviceCodeAction } from '@/app/actions/device-codes'
import { AUTH_INPUT, AUTH_LINK, AuthAlert, AuthShell } from '@/components/auth/AuthShell'
import SecurityStepUpDialog from '@/components/settings/SecurityStepUpDialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

type Pending = {
    userCode: string
    clientName: string
    deviceName: string
    clientVersion: string | null
    platform: string | null
    requestedType: 'device' | 'agent'
    agentName: string | null
    ipAddress: string | null
    viaOAuth: boolean
    returnTo: string | null
    createdAt: string
    expiresAt: string
}
type Workspace = { id: string; title: string; slug: string | null }
type StepUpMethod = 'totp' | 'recovery_code' | 'password'

const PANEL = {
    eyebrow: 'Terminal sign-in',
    title: 'Sign in a terminal that has no browser.',
    points: ['Servers, containers and cloud agents', 'Agents only reach the workspace you pick', 'Revoke any time in Settings'],
}

const EXTRAS = [
    { scope: 'task:complete', label: 'Finish tasks', detail: 'mark tasks done or send them for review' },
    { scope: 'file:final', label: 'Final files', detail: 'add or replace final files on tasks' },
    { scope: 'doc:write', label: 'Edit docs', detail: 'change the README and other docs' },
] as const
const EXPIRY_DAYS = [7, 30, 90] as const

export default function DeviceClient({ viewerEmail, code, pending, workspaces }: { viewerEmail: string | null; code: string; pending: Pending | null; workspaces: Workspace[] }) {
    const [type, setType] = useState<'device' | 'agent'>(pending?.requestedType ?? 'device')
    const [workspaceId, setWorkspaceId] = useState(workspaces.length === 1 ? workspaces[0]!.id : '')
    const [expiryDays, setExpiryDays] = useState<(typeof EXPIRY_DAYS)[number]>(30)
    const [extras, setExtras] = useState<string[]>([])
    const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
    const [done, setDone] = useState<'approve' | 'deny' | null>(null)
    const [error, setError] = useState<string | null>(null)
    const router = useRouter()
    const [stepUp, setStepUp] = useState<{ methods: StepUpMethod[]; factorId?: string } | null>(null)

    const signIn = () => router.push(`/login?redirect=${encodeURIComponent(`/device${code ? `?code=${encodeURIComponent(code)}` : ''}`)}`)

    async function decide(decision: 'approve' | 'deny') {
        if (!pending) return
        if (decision === 'approve' && type === 'agent' && !workspaceId) {
            setError('Choose the workspace this agent may use')
            return
        }
        setBusy(decision)
        setError(null)
        try {
            const input = decision === 'deny' ? { decision } : type === 'agent' ? { decision, type, workspaceId, expiryDays, extraScopes: extras } : { decision, type }
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

    const who = pending ? (pending.requestedType === 'agent' && pending.agentName && pending.agentName !== pending.clientName ? `${pending.agentName} via ${pending.clientName}` : pending.clientName) : 'a terminal'
    const title = done === 'approve' ? 'Signed in' : done === 'deny' ? 'Sign-in denied' : !viewerEmail ? 'Sign in to approve a terminal' : pending ? `Approve ${who}?` : 'Enter the code from your terminal'
    const description = done === 'approve'
        ? 'Go back to your terminal; it continues on its own within a few seconds.'
        : done === 'deny'
            ? 'Nothing was signed in. Your terminal will say so.'
            : pending?.viaOAuth
                ? `Only approve if you just connected ${pending.clientName} to NetworkBase. Approving sends you back to ${pending.returnTo}.`
                : pending
                ? `Only approve if you started this and your terminal shows ${pending.userCode}.`
                : 'Your terminal shows a code like ABCD-EFGH after nb login --device.'

    return (
        <AuthShell
            title={title}
            description={description}
            panel={PANEL}
            footer={<>Signed-in terminals and agents are listed in <Link href="/settings?tab=integrations" className={AUTH_LINK}>Integrations settings</Link>, where you can revoke them.</>}
        >
            {done ? (
                <AuthAlert tone={done === 'approve' ? 'success' : 'info'}>You can close this tab.</AuthAlert>
            ) : !viewerEmail ? (
                <Button type="button" onClick={signIn} className="h-11 w-full font-medium">
                    <ShieldCheck className="size-4" aria-hidden="true" />Sign in to continue
                </Button>
            ) : !pending ? (
                <form method="get" action="/device" className="space-y-3">
                    {code ? <AuthAlert tone="error">That code has expired, was already used, or doesn’t exist. Run the sign-in again in your terminal.</AuthAlert> : null}
                    <label className="block space-y-1.5">
                        <span className="text-sm font-medium">Code</span>
                        <Input name="code" defaultValue={code} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="ABCD-EFGH" className={`${AUTH_INPUT} font-mono tracking-widest uppercase`} required />
                    </label>
                    <Button type="submit" className="h-11 w-full font-medium">Continue</Button>
                </form>
            ) : (
                <div className="space-y-5" aria-busy={busy !== null}>
                    {pending.viaOAuth ? null : <p className="rounded-md border border-border bg-muted/40 p-3 text-center font-mono text-2xl tracking-[0.3em]" aria-label={`Code ${pending.userCode.split('').join(' ')}`}>{pending.userCode}</p>}

                    <section aria-label="Who is asking" className="divide-y divide-border rounded-md border border-border bg-card text-sm">
                        <div className="flex items-center gap-3 p-3">
                            {pending.requestedType === 'agent' ? <Bot className="size-4 text-muted-foreground" aria-hidden="true" /> : <Terminal className="size-4 text-muted-foreground" aria-hidden="true" />}
                            {pending.viaOAuth
                                ? <span className="min-w-0 truncate"><span className="font-medium">{who}</span> <span className="text-muted-foreground">(editor)</span></span>
                                : <span className="min-w-0 truncate"><span className="font-medium">{who}</span>{pending.clientVersion ? <span className="text-muted-foreground"> {pending.clientVersion}</span> : null} on <span className="font-medium">{pending.deviceName}</span>{pending.platform ? <span className="text-muted-foreground"> ({pending.platform})</span> : null}</span>}
                        </div>
                        {pending.viaOAuth ? (
                            <div className="flex items-center gap-3 p-3">
                                <ExternalLink className="size-4 text-muted-foreground" aria-hidden="true" />
                                <span className="min-w-0 truncate text-muted-foreground">Sends you back to <span className="font-medium text-foreground">{pending.returnTo}</span></span>
                            </div>
                        ) : null}
                        <div className="flex items-center gap-3 p-3">
                            <MapPin className="size-4 text-muted-foreground" aria-hidden="true" />
                            <span className="text-muted-foreground">{pending.ipAddress ? `From ${pending.ipAddress}` : 'Network address unknown'}</span>
                        </div>
                        <div className="flex items-center gap-3 p-3">
                            <Clock className="size-4 text-muted-foreground" aria-hidden="true" />
                            <span className="text-muted-foreground">Asked at {new Date(pending.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · signed in as {viewerEmail}</span>
                        </div>
                    </section>

                    <fieldset className="space-y-2" hidden={pending.viaOAuth}>
                        <legend className="mb-1 text-sm font-medium">This is</legend>
                        <label className="flex items-start gap-2.5 text-sm">
                            <input type="radio" className="nb-radio mt-0.5" name="type" checked={type === 'device'} onChange={() => setType('device')} />
                            <span><span className="font-medium">My terminal</span><span className="block text-muted-foreground">Can do what you can, in all your workspaces, for 90 days.</span></span>
                        </label>
                        <label className="flex items-start gap-2.5 text-sm">
                            <input type="radio" className="nb-radio mt-0.5" name="type" checked={type === 'agent'} onChange={() => setType('agent')} />
                            <span><span className="font-medium">An AI agent</span><span className="block text-muted-foreground">Reads and makes small changes in one workspace; asks you before anything bigger.</span></span>
                        </label>
                    </fieldset>

                    {type === 'agent' ? (
                        <div className="space-y-3">
                            <label className="block space-y-1.5 text-sm">
                                <span className="font-medium">Workspace</span>
                                <select className="nb-select w-full" value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} aria-invalid={error !== null && !workspaceId}>
                                    <option value="">Choose a workspace…</option>
                                    {workspaces.map((w) => <option key={w.id} value={w.id}>{w.title}{w.slug ? ` (${w.slug})` : ''}</option>)}
                                </select>
                            </label>
                            <label className="block space-y-1.5 text-sm">
                                <span className="font-medium">Works for</span>
                                <select className="nb-select w-full" value={expiryDays} onChange={(e) => setExpiryDays(Number(e.target.value) as (typeof EXPIRY_DAYS)[number])}>
                                    {EXPIRY_DAYS.map((d) => <option key={d} value={d}>{d} days</option>)}
                                </select>
                            </label>
                            <fieldset className="space-y-2">
                                <legend className="mb-1 text-sm font-medium">Also allow <span className="font-normal text-muted-foreground">(off unless you tick)</span></legend>
                                {EXTRAS.map((x) => (
                                    <label key={x.scope} className="flex items-start gap-2.5 text-sm">
                                        <input type="checkbox" className="nb-check mt-0.5" checked={extras.includes(x.scope)} onChange={(e) => setExtras((cur) => (e.target.checked ? [...cur, x.scope] : cur.filter((s) => s !== x.scope)))} />
                                        <span><span className="font-medium">{x.label}</span><span className="text-muted-foreground"> · {x.detail}</span></span>
                                    </label>
                                ))}
                            </fieldset>
                        </div>
                    ) : null}

                    {error ? <AuthAlert tone="error">{error}</AuthAlert> : null}

                    <div className="grid grid-cols-2 gap-2.5">
                        <Button type="button" variant="outline" onClick={() => decide('deny')} disabled={busy !== null} className="h-11 font-medium">
                            {busy === 'deny' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}Not me, deny
                        </Button>
                        <Button type="button" onClick={() => decide('approve')} disabled={busy !== null} className="h-11 font-medium">
                            {busy === 'approve' ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <ShieldCheck className="size-4" aria-hidden="true" />}Approve
                        </Button>
                    </div>
                </div>
            )}
            <SecurityStepUpDialog
                open={stepUp !== null}
                onOpenChange={(open) => { if (!open) setStepUp(null) }}
                title="Verify before approving"
                description="Approving signs this terminal in as you, so confirm it is you first."
                availableMethods={stepUp?.methods ?? []}
                factorId={stepUp?.factorId}
                onVerified={() => { setStepUp(null); return decide('approve') }}
            />
        </AuthShell>
    )
}
