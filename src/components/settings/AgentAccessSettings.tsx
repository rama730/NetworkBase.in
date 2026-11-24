'use client'
import { PixelBeat } from "@/components/ui/PixelBeat";

import { useState } from 'react'
import { Bot} from '@/components/ui/icons'

import { changeAgentAccessAction, decideAgentAccessRequestAction, renewAgentAccessAction } from '@/app/actions/agent-access'
import { AGENT_EXPIRY_CHOICES, AgentAccessPicker, agentAccessSentence, type AgentAccessValue, type AgentWorkspaceOption } from '@/components/agents/AgentAccessPicker'
import { useStepUp } from '@/components/trust/StepUp'
import { Button } from '@/components/ui/button'
import type { AgentPreset } from '@/lib/agents/access'
import { feedbackError, toast } from '@/lib/feedback'
import type { TokenScope } from '@/lib/security/token-access'
import { formatDistanceToNow } from '@/lib/utils/date'

export type AgentSettingsView = {
    id: string
    agentName: string
    deviceName: string
    sentence: string
    preset: AgentPreset
    extraScopes: string[]
    workspace: 'all' | string | null
    workspaceTitle: string | null
    expiresAt: string
    lastSeenAt: string
    requests: { id: string; scope: string; words: string; reason: string | null; createdAt: string }[]
}

const EXTRA = new Set<string>(['task:complete', 'file:final', 'doc:write'])
type Busy = null | 'change' | 'renew' | `${string}:${'once' | 'always' | 'no'}`

/** Settings → Integrations → an agent (report A4 "Afterwards", A5, A8). */
export default function AgentAccessSettings({ view, workspaces, focusRequest, prefill = null }: { view: AgentSettingsView; workspaces: AgentWorkspaceOption[]; focusRequest: string | null; prefill?: { access: AgentPreset | null; workspace: string | null } | null }) {
    const [sentence, setSentence] = useState(view.sentence)
    const [expiresAt, setExpiresAt] = useState(view.expiresAt)
    const [requests, setRequests] = useState(view.requests)
    const [changing, setChanging] = useState(prefill !== null)
    const [busy, setBusy] = useState<Busy>(null)
    const [renewDays, setRenewDays] = useState<(typeof AGENT_EXPIRY_CHOICES)[number]>(30)
    const [choice, setChoice] = useState<AgentAccessValue>({
        access: prefill?.access ?? view.preset,
        workspace: prefill?.workspace ?? view.workspace ?? 'all',
        expiryDays: 30,
        extraScopes: view.extraScopes.filter((s): s is TokenScope => EXTRA.has(s)),
    })
    const { needs, dialog } = useStepUp(`Changing what ${view.agentName} may do is a security change, so confirm it is you first.`)
    const daysLeft = Math.max(0, Math.ceil((new Date(expiresAt).getTime() - Date.now()) / 86_400_000))

    const change = async () => {
        setBusy('change')
        const result = await changeAgentAccessAction(view.id, choice)
        setBusy(null)
        if (needs(result, () => void change())) return
        if (!result.success) return void toast.error(feedbackError(result.error, 'Couldn’t change access'))
        setSentence(result.sentence)
        setExpiresAt(new Date(Date.now() + choice.expiryDays * 86_400_000).toISOString())
        setChanging(false)
        toast.success('Access changed')
    }
    const renew = async () => {
        setBusy('renew')
        const result = await renewAgentAccessAction(view.id, renewDays)
        setBusy(null)
        if (needs(result, () => void renew())) return
        if (!result.success) return void toast.error(feedbackError(result.error, 'Couldn’t renew'))
        setSentence(result.sentence)
        setExpiresAt(new Date(Date.now() + renewDays * 86_400_000).toISOString())
        toast.success(`Renewed for ${renewDays} days`)
    }
    const answer = async (id: string, how: 'once' | 'always' | 'no') => {
        setBusy(`${id}:${how}`)
        const result = await decideAgentAccessRequestAction(id, how)
        setBusy(null)
        if (needs(result, () => void answer(id, how))) return
        if (!result.success) return void toast.error(feedbackError(result.error, 'Couldn’t save the answer'))
        setRequests((cur) => cur.filter((r) => r.id !== id))
        toast.success(how === 'no' ? `${view.agentName} won’t ask again for a day` : how === 'once' ? `${view.agentName} can do it once. Tell it to try again.` : 'Allowed from now on')
    }

    return (
        <div className="mx-auto w-full max-w-2xl space-y-6 px-4 py-6 md:px-0">
            <header className="flex items-start gap-3">
                <span className="flex size-10 shrink-0 items-center justify-center rounded-md bg-muted text-foreground"><Bot className="size-5" aria-hidden="true" /></span>
                <div className="min-w-0">
                    <h1 className="nb-page-title break-words">{view.agentName} on {view.deviceName}</h1>
                    <p className="nb-meta text-muted-foreground">Active {formatDistanceToNow(new Date(view.lastSeenAt), { addSuffix: true })} · ends in {daysLeft} day{daysLeft === 1 ? '' : 's'}</p>
                </div>
            </header>

            <p className="rounded-md border border-border bg-card p-4 text-sm leading-relaxed" aria-live="polite">{changing ? agentAccessSentence(view.agentName, choice, workspaces) : sentence}</p>

            {requests.length ? (
                <section aria-labelledby="agent-requests" className="space-y-2">
                    <h2 id="agent-requests" className="nb-ui-label">Waiting for your answer</h2>
                    {requests.map((r) => (
                        <div key={r.id} className={`space-y-3 rounded-md border p-4 ${r.id === focusRequest ? 'border-primary' : 'border-border'}`}>
                            <p className="text-sm"><span className="font-medium">{view.agentName}</span> asks to also <span className="font-medium">{r.words}</span>.
                                <span className="nb-meta block text-muted-foreground">{formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}{r.reason ? ` · “${r.reason}”` : ''}</span></p>
                            <div className="flex flex-col gap-2 sm:flex-row">
                                {(['once', 'always', 'no'] as const).map((how) => (
                                    <Button key={how} type="button" size="sm" variant={how === 'once' ? 'default' : 'outline'} disabled={busy !== null} onClick={() => void answer(r.id, how)}>
                                        {busy === `${r.id}:${how}` ? <PixelBeat /> : null}
                                        {how === 'once' ? 'Allow once' : how === 'always' ? 'Always' : 'No'}
                                    </Button>
                                ))}
                            </div>
                        </div>
                    ))}
                </section>
            ) : null}

            <section aria-labelledby="agent-change" className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                    <h2 id="agent-change" className="nb-ui-label">Access</h2>
                    {changing ? null : <Button type="button" size="sm" variant="outline" onClick={() => setChanging(true)}>Change access</Button>}
                </div>
                {changing ? (
                    <div className="space-y-4 rounded-md border border-border p-4">
                        <AgentAccessPicker value={choice} onChange={setChoice} workspaces={workspaces} />
                        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                            <Button type="button" variant="outline" onClick={() => setChanging(false)} disabled={busy === 'change'}>Cancel</Button>
                            <Button pending={busy === 'change'} type="button" onClick={() => void change()} disabled={busy === 'change'}>
                                Save access
                            </Button>
                        </div>
                    </div>
                ) : null}
            </section>

            <section aria-labelledby="agent-renew" className="space-y-3">
                <h2 id="agent-renew" className="nb-ui-label">Renew</h2>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <label className="flex items-center gap-2 text-sm">
                        <span>Keep it working for</span>
                        <select className="nb-select" value={renewDays} onChange={(e) => setRenewDays(Number(e.target.value) as (typeof AGENT_EXPIRY_CHOICES)[number])}>
                            {AGENT_EXPIRY_CHOICES.map((d) => <option key={d} value={d}>{d} days</option>)}
                        </select>
                    </label>
                    <Button pending={busy === 'renew'} type="button" variant="outline" size="sm" onClick={() => void renew()} disabled={busy === 'renew'}>
                        Renew
                    </Button>
                </div>
            </section>
            {dialog}
        </div>
    )
}
