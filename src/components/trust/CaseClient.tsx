'use client'

import { useRouter } from 'next/navigation'
import { useMemo, useState, useTransition, type ReactNode } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { toast } from '@/lib/feedback'

import {
    addNoteAction, changeSeverityAction, claimCaseAction, decideCaseAction, evidenceShownAction, legalHoldAction, mergeCaseAction, previewDecisionEmailAction, undoDecisionAction,
} from '@/app/actions/moderation-staff'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { FIELD } from '@/components/trust/NewCaseDialog'
import { useStepUp } from '@/components/trust/StepUp'
import { ACTION_LABEL, actionsFor, addsStrike, ADMIN_ONLY_ACTIONS, REASON_RULES, RULES, ruleLabel, type ModerationActionKind, type ReportReason, type ReportTargetKind } from '@/lib/trust/rules'

type Account = { action: 'warning' | 'limit' | 'suspension' | 'ban'; days?: number | null }
const ACCOUNT_OPTIONS: Array<{ id: string; label: string; value: Account | null }> = [
    { id: 'none', label: 'None', value: null },
    { id: 'warning', label: 'Warning', value: { action: 'warning' } },
    { id: 'limit7', label: 'Limit 7 days', value: { action: 'limit', days: 7 } },
    { id: 'limit30', label: 'Limit 30 days', value: { action: 'limit', days: 30 } },
    { id: 'suspension14', label: 'Suspend 14 days', value: { action: 'suspension', days: 14 } },
    { id: 'suspension30', label: 'Suspend 30 days', value: { action: 'suspension', days: 30 } },
    { id: 'ban', label: 'Ban', value: { action: 'ban' } },
]
const accountId = (a: { action: ModerationActionKind; days?: number }) => a.action === 'warning' ? 'warning' : `${a.action}${a.days ?? ''}`
const dateIn = (days: number) => new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' }).format(new Date(Date.now() + days * 86_400_000))
const defaultMessage = (rule: number) => `Please read ${ruleLabel(rule)} in our community rules. Repeated breaks lead to limits on your account.`

function Radio({ name, checked, onChange, disabled, title, children }: { name: string; checked: boolean; onChange: () => void; disabled?: boolean; title?: string; children: ReactNode }) {
    return (
        <label title={title} className={`inline-flex items-center gap-1.5 rounded-[5px] px-1.5 py-1 text-[13px] ${disabled ? 'opacity-50' : 'cursor-pointer hover:bg-muted'}`}>
            <input type="radio" name={name} checked={checked} onChange={onChange} disabled={disabled} />{children}
        </label>
    )
}

/** The decision form (17.5): the one place a decision is made. Undo stays for 10 seconds after sending (C8). */
export function DecisionForm({ caseId, label, targetKind, reason, hasSubject, personName, strikes, suggested, isAdmin, readOnly }: {
    caseId: string; label: string; targetKind: ReportTargetKind; reason: ReportReason; hasSubject: boolean; personName: string; strikes: number
    suggested: { action: ModerationActionKind; days?: number }; isAdmin: boolean; readOnly: boolean
}) {
    const router = useRouter()
    const [outcome, setOutcome] = useState<'no_violation' | 'actioned' | null>(null)
    const [content, setContent] = useState<ModerationActionKind | null>(null)
    const [account, setAccount] = useState('none')
    const [rule, setRule] = useState(REASON_RULES[reason].rule)
    const [message, setMessage] = useState(defaultMessage(REASON_RULES[reason].rule))
    const [note, setNote] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [confirm, setConfirm] = useState(false)
    const [preview, setPreview] = useState<{ subject: string; html: string } | null>(null)
    const stepUp = useStepUp('Bans and removing a workspace need one more check.')
    const [pending, start] = useTransition()
    const accountValue = ACCOUNT_OPTIONS.find((o) => o.id === account)?.value ?? null
    const decision = { outcome: outcome ?? 'no_violation', content: outcome === 'actioned' ? content : null, account: outcome === 'actioned' ? accountValue : null, rule, message, note: note || null }
    const severe = outcome === 'actioned' && (accountValue?.action === 'ban' || content === 'remove_workspace')

    const consequences = useMemo(() => {
        if (outcome === 'no_violation') return 'Nothing changes for the person. Anything hidden while we reviewed comes back. Reporters are told no rule was broken.'
        if (outcome !== 'actioned') return 'Pick an outcome.'
        const primary = accountValue?.action ?? content
        if (!primary) return 'Pick at least one action.'
        const strike = accountValue ? true : content ? addsStrike(content) : false
        const appeal = reason === 'child_safety' ? 'No appeal' : `Can appeal until ${dateIn(primary === 'ban' ? 60 : 30)}`
        return `${personName} gets a notice and email${strike ? ` · Strike ${strikes + 1}` : ''} · ${appeal} · Reporters told “action taken”`
    }, [outcome, accountValue, content, reason, personName, strikes])

    const send = () => start(async () => {
        setConfirm(false)
        setError(null)
        const result = await decideCaseAction(caseId, decision)
        if (!result.success) {
            if (stepUp.needs(result, send)) return
            return setError(result.error)
        }
        toast(`Decision sent · ${label}`, {
            duration: 10_000,
            action: { label: 'Undo', onClick: async () => { const undo = await undoDecisionAction(caseId); toast(undo.success ? `Decision undone · ${label}` : undo.error); router.refresh() } },
        })
        router.refresh()
    })
    const showPreview = () => start(async () => {
        const result = await previewDecisionEmailAction(caseId, decision)
        if (!result.success) return setError(result.error)
        setPreview({ subject: result.subject, html: result.html })
    })

    return (
        <fieldset id="decision" tabIndex={-1} disabled={readOnly || pending} className="max-w-[64ch] space-y-3 outline-none">
            {readOnly ? <p className="text-[13px] text-muted-foreground">Someone else is reviewing this case. Take it over from the menu to decide.</p> : null}
            <div className="flex flex-wrap gap-2">
                <Radio name="outcome" checked={outcome === 'no_violation'} onChange={() => setOutcome('no_violation')}>No rule broken</Radio>
                <Radio name="outcome" checked={outcome === 'actioned'} onChange={() => setOutcome('actioned')}>Take action</Radio>
            </div>
            {outcome === 'actioned' ? (
                <>
                    <div className="grid gap-1 sm:grid-cols-[88px_1fr]">
                        <span className="pt-1 text-[13px] font-medium">{targetKind === 'project' ? 'Workspace' : targetKind === 'person' ? 'Profile' : 'Content'}</span>
                        <div className="flex flex-wrap gap-1">
                            <Radio name="content" checked={content === null} onChange={() => setContent(null)}>None</Radio>
                            {actionsFor(targetKind).map((a) => (
                                <Radio key={a} name="content" checked={content === a} onChange={() => setContent(a)} disabled={!isAdmin && ADMIN_ONLY_ACTIONS.includes(a)} title={!isAdmin && ADMIN_ONLY_ACTIONS.includes(a) ? 'Admins only' : undefined}>
                                    {ACTION_LABEL[a]}
                                </Radio>
                            ))}
                        </div>
                    </div>
                    {hasSubject ? (
                        <div className="grid gap-1 sm:grid-cols-[88px_1fr]">
                            <span className="pt-1 text-[13px] font-medium">Account</span>
                            <div>
                                <div className="flex flex-wrap gap-1">
                                    {ACCOUNT_OPTIONS.map((o) => (
                                        <Radio key={o.id} name="account" checked={account === o.id} onChange={() => setAccount(o.id)} disabled={o.id === 'ban' && !isAdmin} title={o.id === 'ban' && !isAdmin ? 'Admins only' : undefined}>{o.label}</Radio>
                                    ))}
                                </div>
                                <p className="nb-meta mt-1">Suggested: {ACCOUNT_OPTIONS.find((o) => o.id === accountId(suggested))?.label ?? ACTION_LABEL[suggested.action]} · {strikes} active {strikes === 1 ? 'strike' : 'strikes'}</p>
                            </div>
                        </div>
                    ) : null}
                    <label className="block text-[13px] font-medium">Rule
                        <select value={rule} onChange={(e) => { const next = Number(e.target.value); if (message === defaultMessage(rule)) setMessage(defaultMessage(next)); setRule(next) }} className={`${FIELD} h-[var(--ui-control-height)]`}>
                            {Object.keys(RULES).map((n) => <option key={n} value={n}>{ruleLabel(Number(n))}</option>)}
                        </select>
                    </label>
                    <label className="block text-[13px] font-medium">
                        <span className="flex items-center">Message to {personName}<button type="button" onClick={showPreview} className="ml-auto text-[13px] font-normal underline underline-offset-4">Preview email</button></span>
                        <textarea rows={4} maxLength={2000} value={message} onChange={(e) => setMessage(e.target.value)} className={`${FIELD} py-2`} />
                    </label>
                </>
            ) : null}
            <label className="block text-[13px] font-medium">Internal note (staff only)
                <textarea rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} className={`${FIELD} py-2`} />
            </label>
            <p className="rounded-[5px] bg-secondary px-3 py-2 text-[13px]">{consequences}</p>
            {error ? <p role="alert" className="rounded-[5px] border border-destructive/30 bg-[var(--status-danger-soft)] px-3 py-2 text-[13px]">{error}</p> : null}
            <div className="flex justify-end gap-2">
                <Button className="min-w-[124px]" disabled={!outcome || pending} onClick={() => (severe ? setConfirm(true) : send())}>{pending ? 'Sending…' : 'Send decision'}</Button>
            </div>
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
        </fieldset>
    )
}

/** Header actions (17.4): I'm reviewing, and the "⋯" menu. */
export function CaseMenu({ caseId, label, open, claimed, claimedByOther, legalHold, severity }: { caseId: string; label: string; open: boolean; claimed: boolean; claimedByOther: boolean; legalHold: boolean; severity: string }) {
    const router = useRouter()
    const [pending, start] = useTransition()
    const [dialog, setDialog] = useState<'severity' | 'merge' | null>(null)
    const [value, setValue] = useState('')
    const [nextSeverity, setNextSeverity] = useState(severity)
    const stepUp = useStepUp('Releasing a legal hold needs one more check.')
    const run = (action: () => Promise<{ success: boolean; error?: string }>, done: string) => start(async () => {
        const result = await action()
        if (stepUp.needs(result, () => run(action, done))) return
        toast(result.success ? done : result.error ?? 'Couldn’t do that. Try again.')
        if (result.success) { setDialog(null); setValue(''); router.refresh() }
    })
    return (
        <>
            {open && !claimed && !claimedByOther ? <Button size="sm" disabled={pending} onClick={() => run(() => claimCaseAction(caseId, 'claim'), `You're reviewing ${label}`)}>I&apos;m reviewing</Button> : null}
            <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Case actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {open && claimed ? <DropdownMenuItem onSelect={() => run(() => claimCaseAction(caseId, 'release'), 'Claim released')}>Release claim</DropdownMenuItem> : null}
                    {open && claimedByOther ? <DropdownMenuItem onSelect={() => run(() => claimCaseAction(caseId, 'take_over'), `You took over ${label}`)}>Take over</DropdownMenuItem> : null}
                    <DropdownMenuItem onSelect={() => { void navigator.clipboard.writeText(`${window.location.origin}/admin/trust/cases/${label}`); toast('Case link copied') }}>Copy case link</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => run(() => legalHoldAction(caseId, !legalHold), legalHold ? 'Legal hold removed' : 'Legal hold added')}>{legalHold ? 'Remove legal hold' : 'Add to legal hold'}</DropdownMenuItem>
                    {open ? (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => setDialog('severity')}>Change severity</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setDialog('merge')}>Merge into another case</DropdownMenuItem>
                        </>
                    ) : null}
                </DropdownMenuContent>
            </DropdownMenu>
            {stepUp.dialog}
            <Dialog open={dialog !== null} onOpenChange={(next) => !next && setDialog(null)}>
                <DialogContent className="max-w-[420px]">
                    <DialogHeader>
                        <DialogTitle>{dialog === 'severity' ? 'Change severity' : 'Merge into another case'}</DialogTitle>
                        <DialogDescription>{dialog === 'severity' ? 'The deadline moves with it. Say why; it goes in the case history.' : 'This case closes as a duplicate and its reports move to the other case.'}</DialogDescription>
                    </DialogHeader>
                    {dialog === 'severity' ? (
                        <select value={nextSeverity} onChange={(e) => setNextSeverity(e.target.value)} className={`${FIELD} h-[var(--ui-control-height)]`}>
                            <option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option>
                        </select>
                    ) : null}
                    <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={dialog === 'severity' ? 'Reason' : 'NB-1001'} className={`${FIELD} h-[var(--ui-control-height)]`} />
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
                        <Button disabled={pending || !value.trim()} onClick={() => dialog === 'severity'
                            ? run(() => changeSeverityAction(caseId, nextSeverity as 'urgent' | 'high' | 'normal', value), 'Severity changed')
                            : run(() => mergeCaseAction(caseId, value), `${label} merged into ${value.toUpperCase()}`)}>
                            {dialog === 'severity' ? 'Change severity' : 'Merge case'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}

export function NoteForm({ caseId }: { caseId: string }) {
    const router = useRouter()
    const [body, setBody] = useState('')
    const [pending, start] = useTransition()
    return (
        <form className="max-w-[64ch] space-y-2" onSubmit={(e) => {
            e.preventDefault()
            start(async () => {
                const result = await addNoteAction(caseId, body)
                if (!result.success) return void toast(result.error)
                setBody('')
                router.refresh()
            })
        }}>
            <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note visible to staff only" aria-label="Internal note" className={`${FIELD} py-2`} />
            <Button type="submit" size="sm" variant="outline" disabled={pending || !body.trim()}>Add note</Button>
        </form>
    )
}

/** Sensitive evidence stays covered until staff choose to see it; each Show is logged. */
export function SensitiveReveal({ caseId, children }: { caseId: string; children: ReactNode }) {
    const [shown, setShown] = useState(false)
    if (shown) return <>{children}</>
    return (
        <p className="text-[13px] text-muted-foreground">
            Sensitive content hidden · <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={() => { setShown(true); void evidenceShownAction(caseId) }}>Show</button>
        </p>
    )
}
