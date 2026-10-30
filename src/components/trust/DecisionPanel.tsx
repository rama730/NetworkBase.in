'use client'

import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from 'react'
import { toast } from '@/lib/feedback'

import {
    caseDetailAction, caseHeartbeatAction, claimCaseAction, decideCaseAction, decideTogetherAction, previewDecisionEmailAction,
} from '@/app/actions/moderation-staff'
import { AppealOutcomeForm } from '@/components/trust/AppealsClient'
import { useLive } from '@/components/trust/live'
import { FIELD } from '@/components/trust/NewCaseDialog'
import { useStepUp } from '@/components/trust/StepUp'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import {
    ACTION_LABEL, actionsFor, addsStrike, ADMIN_ONLY_ACTIONS, caseLabel, REASON_RULES, RULE_MEANINGS, RULES, ruleLabel, type ModerationActionKind,
} from '@/lib/trust/rules'

export type CaseDetail = NonNullable<Awaited<ReturnType<typeof caseDetailAction>>>
type Account = { action: 'warning' | 'limit' | 'suspension' | 'ban'; days?: number | null }
const ACCOUNT_OPTIONS: Array<{ id: string; label: string; value: Account | null; rank: number }> = [
    { id: 'none', label: 'None', value: null, rank: -1 },
    { id: 'warning', label: 'Warning', value: { action: 'warning' }, rank: 0 },
    { id: 'limit7', label: 'Limit 7 days', value: { action: 'limit', days: 7 }, rank: 1 },
    { id: 'limit30', label: 'Limit 30 days', value: { action: 'limit', days: 30 }, rank: 2 },
    { id: 'suspension14', label: 'Suspend 14 days', value: { action: 'suspension', days: 14 }, rank: 3 },
    { id: 'suspension30', label: 'Suspend 30 days', value: { action: 'suspension', days: 30 }, rank: 3 },
    { id: 'ban', label: 'Ban', value: { action: 'ban' }, rank: 4 },
]
const accountId = (a: { action: ModerationActionKind; days?: number }) => (a.action === 'warning' ? 'warning' : `${a.action}${a.days ?? ''}`)
const dateIn = (days: number) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + days * 86_400_000))
const builtIn = (rule: number) => `Please read ${ruleLabel(rule)} in our community rules. Repeated breaks lead to limits on your account.`
const HEARTBEAT_MS = 45_000
export const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

export const Kbd = ({ children }: { children: ReactNode }) => (
    <kbd className="ml-1.5 hidden rounded-[4px] border border-current/30 px-1 font-sans text-[11px] font-normal opacity-70 md:inline">{children}</kbd>
)

function Radio({ name, checked, onChange, disabled, title, children }: { name: string; checked: boolean; onChange: () => void; disabled?: boolean; title?: string; children: ReactNode }) {
    return (
        <label title={title} className={`relative inline-flex items-center gap-1.5 rounded-[5px] px-1.5 py-1 text-[13px] ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-muted'}`}>
            <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} />{children}
        </label>
    )
}

/**
 * The decision panel (R3, R5, S2, S3, S10, S12): always on screen. Opening shows you as viewing; touching the form
 * claims the case as a lease, renewed by a heartbeat; Send carries the version you reviewed.
 */
export function DecisionPanel({ c, onSent }: { c: CaseDetail; onSent: (sent: { caseId: string; label: string }) => void }) {
    const label = caseLabel(c.number)
    const open = c.state === 'open' || c.state === 'in_review'
    if (c.appeal && (c.appeal.state === 'pending' || c.appeal.state === 'in_review')) {
        const actions = c.actions.filter((a) => !a.undone_at && !a.reversed_at).map((a) => a.action)
        const personName = c.person?.name ?? (c.person?.username ? `@${c.person.username}` : 'them')
        return (
            <section aria-labelledby="decide-title" className="space-y-3">
                <h2 id="decide-title" className="text-[15px] font-semibold">Appeal outcome</h2>
                <AppealOutcomeForm caseId={c.id} label={label} personName={personName} selfReview={c.decided_by === c.me} claimed={c.appeal.assignee_id === c.me}
                    actions={actions} saved={c.templates} onDone={() => onSent({ caseId: c.id, label })} />
            </section>
        )
    }
    if (!open) {
        return (
            <section aria-labelledby="decide-title" className="space-y-2 text-[13px]">
                <h2 id="decide-title" className="text-[15px] font-semibold">Decision</h2>
                <p>{c.decided_by_name ? `${c.decided_by_name} decided this` : 'Decided'}{c.outcome === 'no_violation' ? ' · No rule broken' : c.outcome === 'duplicate' ? ' · Duplicate' : c.outcome === 'actioned' ? ' · Action taken' : ''}</p>
                {c.actions.map((a) => (
                    <p key={a.id}>
                        <span className="font-medium">{ACTION_LABEL[a.action as ModerationActionKind] ?? a.action}</span>
                        {a.rule ? ` · ${ruleLabel(a.rule)}` : ''}{a.strike ? ' · strike' : ''}{a.undone_at ? ' · undone' : a.reversed_at ? ' · reversed' : a.lifted_at ? ' · lifted' : ''}
                    </p>
                ))}
                {c.actions[0]?.message ? <blockquote className="border-l-2 border-border pl-2 text-muted-foreground">{c.actions[0].message}</blockquote> : null}
            </section>
        )
    }
    return <DecisionForm key={c.id} c={c} label={label} onSent={onSent} />
}

function DecisionForm({ c, label, onSent }: { c: CaseDetail; label: string; onSent: (sent: { caseId: string; label: string }) => void }) {
    const queryClient = useQueryClient()
    const { setMine } = useLive()
    const isAdmin = c.role === 'admin'
    const heldByMe = c.leased && c.assignee_id === c.me
    const heldByOther = c.leased && c.assignee_id !== c.me
    const personName = c.person?.name ?? (c.person?.username ? `@${c.person.username}` : 'them')
    const firstRule = REASON_RULES[c.reason].rule
    const messageFor = (rule: number) => c.templates[`rule:${rule}`] ?? builtIn(rule)

    const [outcome, setOutcome] = useState<'no_violation' | 'actioned' | null>(null)
    const [content, setContent] = useState<ModerationActionKind | null>(null)
    const [account, setAccount] = useState('none')
    const [rule, setRule] = useState(firstRule)
    const [message, setMessage] = useState(() => messageFor(firstRule))
    const [note, setNote] = useState('')
    const [together, setTogether] = useState<string[]>([])
    const [error, setError] = useState<string | null>(null)
    const [confirm, setConfirm] = useState(false)
    const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
    // The version this reviewer has seen; a newer one from someone else shows "changed · Review" (S2).
    const [seen, setSeen] = useState(c.version)
    const [held, setHeld] = useState(heldByMe)
    const active = useRef(false)
    const stepUp = useStepUp('Bans and removing a workspace need one more check.')
    const [pending, start] = useTransition()

    const accountOption = ACCOUNT_OPTIONS.find((o) => o.id === account)!
    const accountValue = outcome === 'actioned' ? accountOption.value : null
    const suggestedId = accountId(c.suggested)
    const suggestedRank = ACCOUNT_OPTIONS.find((o) => o.id === suggestedId)?.rank ?? 0
    const skips = Boolean(accountValue) && accountOption.rank > suggestedRank
    // Only a version newer than what this reviewer saw counts; their own claim raises `seen` before the refetch lands.
    const stale = c.version > seen
    const decision = { outcome: outcome ?? 'no_violation', content: outcome === 'actioned' ? content : null, account: accountValue, rule, message, note: note || null, expectedVersion: seen }
    const severe = outcome === 'actioned' && (accountValue?.action === 'ban' || content === 'remove_workspace')
    const others = c.otherCases

    useEffect(() => setHeld(heldByMe), [heldByMe])
    useEffect(() => {
        setMine(c.id, held ? 'deciding' : 'viewing')
        return () => setMine(null, 'viewing')
    }, [c.id, held, setMine])

    // The lease's heartbeat while this case is open; leaving lets it lapse within 2 minutes (S3).
    useEffect(() => {
        if (!held) return
        const t = window.setInterval(async () => {
            if (document.visibilityState !== 'visible') return
            const r = await caseHeartbeatAction(c.id, active.current).catch(() => null)
            active.current = false
            if (r?.success && !r.held) { setHeld(false); toast(`Your claim on ${label} lapsed`); void queryClient.invalidateQueries({ queryKey: ['trust', 'case', c.id] }) }
        }, HEARTBEAT_MS)
        return () => window.clearInterval(t)
    }, [held, c.id, label, queryClient])
    useEffect(() => () => { if (heldRef.current) void claimCaseAction(c.id, 'release') }, [c.id])
    const heldRef = useRef(held)
    heldRef.current = held

    /** Touching the form claims the case (R5); later touches keep the lease fresh. */
    const touch = () => {
        active.current = true
        if (held || heldByOther || pending) return
        setHeld(true)
        void claimCaseAction(c.id, 'claim', seen).then((r) => {
            if (r.success) { if (r.version) setSeen(r.version); void queryClient.invalidateQueries({ queryKey: ['trust', 'case', c.id] }); return }
            setHeld(false)
            setError(r.error)
            void queryClient.invalidateQueries({ queryKey: ['trust', 'case', c.id] })
        }, () => { setHeld(false); setError('Couldn’t start reviewing. Check your connection and try again.') })
    }
    const takeOver = () => start(async () => {
        const r = await claimCaseAction(c.id, 'take_over', c.version)
        if (!r.success) return void toast(r.error)
        setHeld(true)
        if (r.version) setSeen(r.version)
        toast(`You took over ${label}`)
        void queryClient.invalidateQueries({ queryKey: ['trust'] })
    })

    const consequences = useMemo(() => {
        if (outcome === 'no_violation') return 'Nothing changes for the person. Anything hidden while we reviewed comes back. Reporters are told no rule was broken.'
        if (outcome !== 'actioned') return 'Pick an outcome.'
        const primary = accountValue?.action ?? content
        if (!primary) return 'Pick at least one action.'
        const strike = accountValue ? true : content ? addsStrike(content) : false
        const appeal = c.reason === 'child_safety' ? 'No appeal' : `Can appeal until ${dateIn(primary === 'ban' ? 60 : 30)}`
        const more = together.length ? ` · ${together.length + 1} cases, one notice` : ''
        return `${personName} gets a notice and email${strike ? ` · Strike ${c.strikes + 1}` : ''} · ${appeal} · Reporters told “action taken”${more}`
    }, [outcome, accountValue, content, c.reason, c.strikes, personName, together.length])

    const send = () => start(async () => {
        setConfirm(false)
        setError(null)
        const result = together.length ? await decideTogetherAction(c.id, together, decision) : await decideCaseAction(c.id, decision)
        if (!result.success) {
            if (stepUp.needs(result, send)) return
            return setError(result.error)
        }
        heldRef.current = false
        onSent({ caseId: c.id, label })
    })
    const showPreview = () => start(async () => {
        const result = await previewDecisionEmailAction(c.id, decision)
        if (!result.success) return setError(result.error)
        setPreview({ subject: result.subject, html: result.html })
    })
    const canSend = Boolean(outcome) && !pending && !heldByOther && !stale && !(skips && !note.trim()) && (outcome !== 'actioned' || Boolean(content || accountValue))

    // 1 / 2 pick the outcome, R the rule, ⌘Enter sends (R8).
    const sendRef = useRef<() => void>(() => undefined)
    sendRef.current = () => { if (!canSend) return; if (severe) setConfirm(true); else send() }
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); sendRef.current(); return }
            if (isTyping(e.target) || e.metaKey || e.ctrlKey || e.altKey || heldByOther) return
            if (e.key === '1') { touch(); setOutcome('no_violation') }
            else if (e.key === '2') { touch(); setOutcome('actioned') }
            else if (e.key === 'r' || e.key === 'R') { e.preventDefault(); touch(); setOutcome('actioned'); window.setTimeout(() => document.getElementById('decision-rule')?.focus(), 0) }
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    })

    return (
        <section aria-labelledby="decide-title" className="space-y-3">
            <h2 id="decide-title" className="text-[15px] font-semibold">Decision</h2>
            {heldByOther ? (
                <div role="status" className="flex flex-wrap items-center gap-2 rounded-[5px] bg-secondary px-3 py-2 text-[13px]">
                    <span>{c.assignee_name ?? 'Someone'} is reviewing</span>
                    <Button size="sm" variant="outline" className="ml-auto" disabled={pending} onClick={takeOver}>Take over</Button>
                </div>
            ) : null}
            {stale ? (
                <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[5px] border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] px-3 py-2 text-[13px]">
                    <span>This case changed while you were reviewing it.</span>
                    <Button size="sm" variant="outline" className="ml-auto" onClick={() => setSeen(c.version)}>Review</Button>
                </div>
            ) : null}
            <fieldset id="decision" tabIndex={-1} disabled={heldByOther || pending} onChangeCapture={touch} onFocusCapture={() => { active.current = true }} className="space-y-3 outline-none">
                <div className="flex flex-wrap gap-2">
                    <Radio name="outcome" checked={outcome === 'no_violation'} onChange={() => setOutcome('no_violation')}>No rule broken<Kbd>1</Kbd></Radio>
                    <Radio name="outcome" checked={outcome === 'actioned'} onChange={() => setOutcome('actioned')}>Take action<Kbd>2</Kbd></Radio>
                </div>
                {outcome === 'actioned' ? (
                    <>
                        <div>
                            <p className="mb-1 text-[13px] font-medium">{c.target_kind === 'project' ? 'Workspace' : c.target_kind === 'person' ? 'Profile' : 'Content'}</p>
                            <div className="flex flex-wrap gap-1">
                                <Radio name="content" checked={content === null} onChange={() => setContent(null)}>None</Radio>
                                {actionsFor(c.target_kind).map((a) => (
                                    <Radio key={a} name="content" checked={content === a} onChange={() => setContent(a)} disabled={!isAdmin && ADMIN_ONLY_ACTIONS.includes(a)} title={!isAdmin && ADMIN_ONLY_ACTIONS.includes(a) ? 'Admins only · Escalate to an admin from the case menu' : undefined}>
                                        {ACTION_LABEL[a]}
                                    </Radio>
                                ))}
                            </div>
                        </div>
                        {c.subject_id ? (
                            <div>
                                <p className="mb-1 text-[13px] font-medium">Account</p>
                                <div className="flex flex-wrap gap-1">
                                    {ACCOUNT_OPTIONS.map((o) => (
                                        <Radio key={o.id} name="account" checked={account === o.id} onChange={() => setAccount(o.id)} disabled={o.id === 'ban' && !isAdmin} title={o.id === 'ban' && !isAdmin ? 'Admins only · Escalate to an admin from the case menu' : undefined}>{o.label}</Radio>
                                    ))}
                                </div>
                                <p className="mt-1 text-[12px] text-muted-foreground">Suggested: {ACCOUNT_OPTIONS.find((o) => o.id === suggestedId)?.label ?? ACTION_LABEL[c.suggested.action]} · {c.strikes} active {c.strikes === 1 ? 'strike' : 'strikes'}</p>
                                {skips ? (
                                    <p role="note" className="mt-1 rounded-[5px] border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] px-2 py-1.5 text-[13px]">
                                        This skips the suggested step ({ACCOUNT_OPTIONS.find((o) => o.id === suggestedId)?.label ?? 'Warning'}) · add a note below
                                    </p>
                                ) : null}
                            </div>
                        ) : null}
                        <label className="block text-[13px] font-medium">Rule<Kbd>R</Kbd>
                            <select id="decision-rule" value={rule} onChange={(e) => { const next = Number(e.target.value); if (message === messageFor(rule)) setMessage(messageFor(next)); setRule(next) }} className={`${FIELD} h-[var(--ui-control-height)]`}>
                                {Object.keys(RULES).map((n) => <option key={n} value={n}>{ruleLabel(Number(n))}</option>)}
                            </select>
                            <span className="mt-1 block text-[12px] font-normal text-muted-foreground">{RULE_MEANINGS[rule]}</span>
                        </label>
                        <label className="block text-[13px] font-medium">
                            <span className="flex items-center">Message to {personName}<button type="button" onClick={showPreview} className="ml-auto text-[13px] font-normal underline underline-offset-4">Preview email</button></span>
                            <textarea rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} className={`${FIELD} py-2`} />
                        </label>
                    </>
                ) : null}
                {others.length && outcome ? (
                    <fieldset className="space-y-1">
                        <legend className="text-[13px] font-medium">{others.length} other open {others.length === 1 ? 'case' : 'cases'} about {personName} · Decide together</legend>
                        {others.map((o) => (
                            <label key={o.id} className="relative flex items-center gap-2 text-[13px]">
                                <input type="checkbox" checked={together.includes(o.id)} onChange={(e) => setTogether((prev) => (e.target.checked ? [...prev, o.id] : prev.filter((x) => x !== o.id)))} />
                                <span className="font-mono tabular-nums">{caseLabel(o.number)}</span>
                            </label>
                        ))}
                        {together.length ? <p className="text-[12px] text-muted-foreground">The account step applies once; the others get the same content action, and {personName} hears once.</p> : null}
                    </fieldset>
                ) : null}
                <label className="block text-[13px] font-medium">Internal note{skips ? ' (required)' : ' (staff only)'}
                    <textarea rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} className={`${FIELD} py-2`} />
                </label>
                <p className="rounded-[5px] bg-secondary px-3 py-2 text-[13px]">{consequences}</p>
                {error ? <p role="alert" className="rounded-[5px] border border-destructive/30 bg-[var(--status-danger-soft)] px-3 py-2 text-[13px]">{error}</p> : null}
                <Button className="w-full" disabled={!canSend} onClick={() => (severe ? setConfirm(true) : send())}>{pending ? 'Sending…' : 'Send decision'}<Kbd>⌘↵</Kbd></Button>
            </fieldset>
            <Dialog open={confirm} onOpenChange={setConfirm}>
                <DialogContent className="max-w-[460px]">
                    <DialogHeader>
                        <DialogTitle>{accountValue?.action === 'ban' ? `Ban ${personName}?` : 'Remove this workspace?'}</DialogTitle>
                        <DialogDescription>{consequences}</DialogDescription>
                    </DialogHeader>
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setConfirm(false)}>Cancel</Button>
                        <Button variant="destructive" onClick={send}>{accountValue?.action === 'ban' ? `Ban ${personName}` : 'Remove workspace'}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
            {stepUp.dialog}
            <Dialog open={Boolean(preview)} onOpenChange={(next) => !next && setPreview(null)}>
                <DialogContent className="max-w-[680px]">
                    <DialogHeader><DialogTitle>{preview?.subject}</DialogTitle><DialogDescription>Exactly what {personName} gets, from notifications@ with replies to support@.</DialogDescription></DialogHeader>
                    {preview ? <iframe title="Email preview" sandbox="" srcDoc={preview.html} className="h-[60vh] w-full rounded-[5px] border border-border bg-white" /> : null}
                </DialogContent>
            </Dialog>
        </section>
    )
}
