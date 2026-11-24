'use client'
import { PixelBeat } from "@/components/ui/PixelBeat";

import { useQuery, useQueryClient } from '@tanstack/react-query'
import Link from 'next/link'
import { useState, useTransition } from 'react'
import { Gavel, MoreHorizontal, Scale, ShieldAlert, Users } from '@/components/ui/icons'
import { toast } from '@/lib/feedback'

import {
    addNoteAction, assignCaseAction, caseLiveAction, changeSeverityAction, claimCaseAction, escalateCaseAction, legalHoldAction, mergeCaseAction, personDetailAction, staffListAction,
} from '@/app/actions/moderation-staff'
import type { CaseDetail } from '@/components/trust/DecisionPanel'
import { Evidence } from '@/components/trust/Evidence'
import { caseState, Deadline, istDate, istDateTime } from '@/components/trust/format'
import { useLive, useServerNow } from '@/components/trust/live'
import { FIELD } from '@/components/trust/NewCaseDialog'
import { PersonView } from '@/components/trust/PersonView'
import { useStepUp } from '@/components/trust/StepUp'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { ACTION_LABEL, caseLabel, KIND_NOUN, REPORT_REASON_LABEL, ruleLabel, type ModerationActionKind, type Severity } from '@/lib/trust/rules'
import { copyOrSay } from '@/lib/clipboard';

const SEVERITY_TONE: Record<Severity, string> = { urgent: 'text-[var(--status-danger)]', high: 'text-[var(--status-warning)]', normal: 'text-muted-foreground' }
const EVENT_TEXT: Record<string, string> = {
    opened: 'opened the case', report_added: 'report added', claimed: 'started reviewing', released: 'stopped reviewing', taken_over: 'took over', decided: 'decided',
    undone: 'undid the decision', merged: 'merged into another case', merged_in: 'merged a case in', severity_changed: 'changed severity', legal_hold: 'added legal hold',
    legal_hold_removed: 'removed legal hold', lifted: 'lifted an action', reversed: 'reversed an action', reporters_told: 'reporters told', evidence_shown: 'viewed hidden evidence',
    appealed: 'appeal received', appeal_decided: 'appeal decided', handed_to_staff: 'handed to NetworkBase', viewed: 'opened', assigned: 'assigned it', unassigned: 'removed the assignment',
    escalated: 'asked for an admin', escalation_cleared: 'cleared the admin request', stale_refused: 'was stopped by a newer change', claim_released: 'claim expired',
    context_shown: 'loaded more messages', file_previewed: 'previewed the file',
}
/** "7 of 8 actioned" in green, "1 of 9" in amber (R10). */
const trustTone = (actioned: number, decided: number) => (decided < 3 ? 'text-muted-foreground' : actioned / decided >= 0.6 ? 'text-[var(--status-success)]' : actioned / decided <= 0.3 ? 'text-[var(--status-warning)]' : 'text-muted-foreground')
const handleOf = (p: { username: string | null; id: string }) => (p.username ? `@${p.username}` : p.id)

export function CasePane({ c, onMerged }: { c: CaseDetail; onMerged: () => void }) {
    const label = caseLabel(c.number)
    const open = c.state === 'open' || c.state === 'in_review'
    const now = useServerNow()
    const { viewers, me } = useLive()
    const watching = viewers.filter((v) => v.caseId === c.id && v.staffId !== me)
    const [allReports, setAllReports] = useState(false)
    const reports = allReports ? c.reports : c.reports.slice(0, 3)
    const firstAt = c.reports[0]?.created_at
    const lastAt = c.reports.at(-1)?.created_at
    const reasons = [...new Set(c.reports.map((r) => REPORT_REASON_LABEL[r.reason]))]
    const decidedBefore = c.priorCases
    // Evidence in stages: the snapshot shows at once, the comparison right after; re-checked every 30 s while open
    // (ponytail: content edits don't write to the moderation log, so polling the one open case is the cheap way).
    const live = useQuery({ queryKey: ['trust', 'case-live', c.id], queryFn: () => caseLiveAction(c.id), refetchInterval: 30_000, staleTime: 10_000 })
    // Reporter accuracy across everyone who reported this, each person once (R3 "what was reported" line).
    const reporters = [...new Map(c.reports.map((r) => [r.reporter_id, r])).values()]
    const accuracy = { actioned: reporters.reduce((n, r) => n + r.actioned, 0), decided: reporters.reduce((n, r) => n + r.decided, 0) }

    return (
        <article aria-labelledby="case-title" className="min-w-0">
            <header className="sticky top-0 z-10 border-b border-border bg-background pb-3 pt-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px]">
                    <span className="font-mono tabular-nums text-muted-foreground">{label}</span>
                    <span className={`font-medium capitalize ${SEVERITY_TONE[c.severity]}`}>{c.severity}</span>
                    <span>{REPORT_REASON_LABEL[c.reason]}</span>
                    <span className="text-muted-foreground">{caseState({ ...c, appeal_state: c.appeal?.state }, now)}{c.leased && c.assignee_name && open ? ` by ${c.assignee_id === c.me ? 'you' : c.assignee_name}` : ''}</span>
                    {open ? <Deadline at={c.deadline_at} openedAt={c.created_at} now={now} /> : null}
                    {c.escalated_at ? <span className="text-[var(--status-warning)]">Needs an admin</span> : null}
                    {c.assigned_name ? <span className="text-muted-foreground">Assigned to {c.assigned_name}</span> : null}
                    {c.legal_hold ? <span className="text-muted-foreground">Legal hold</span> : null}
                    <div className="ml-auto flex items-center gap-2">
                        {watching.length ? (
                            <span className="flex items-center gap-1 text-[12px] text-muted-foreground" aria-label={`Also viewing: ${watching.map((v) => v.name).join(', ')}`}>
                                <span className="flex -space-x-1">{watching.slice(0, 3).map((v) => <UserAvatar key={v.staffId} identity={{ id: v.staffId, fullName: v.name }} size={20} roundedClassName="rounded-full ring-2 ring-background" />)}</span>
                                Also viewing
                            </span>
                        ) : null}
                        <CaseMenu c={c} onMerged={onMerged} />
                    </div>
                </div>
                <h1 id="case-title" tabIndex={-1} className="mt-1 text-[20px] font-semibold leading-tight outline-none">{c.label ?? KIND_NOUN[c.target_kind]}</h1>
                {decidedBefore.length ? (
                    <p className="mt-1 text-[12px] text-muted-foreground">
                        Reported before: {decidedBefore.slice(0, 3).map((p, i) => (
                            <span key={p.id}>{i ? ' · ' : ''}<Link href={`/admin/trust?view=done&case=${caseLabel(p.number)}`} className="font-mono tabular-nums underline underline-offset-4">{caseLabel(p.number)}</Link> {p.outcome === 'no_violation' ? 'No rule broken' : p.outcome === 'actioned' ? 'Action taken' : p.outcome ?? 'closed'}{p.same_target ? '' : ' (same person)'}{p.decided_at ? `, ${istDate(p.decided_at)}` : ''}</span>
                        ))}
                    </p>
                ) : null}
            </header>

            <div className="space-y-6 pt-4">
                {c.person ? <PersonStrip c={c} /> : null}
                {!c.duplicates.length && c.otherCases.length && open ? (
                    <p role="note" className="flex flex-wrap items-center gap-2 rounded-[5px] bg-secondary px-3 py-2 text-[13px]">
                        <Users className="size-4" aria-hidden="true" />
                        {c.otherCases.length + 1} open cases about this person
                        {/* Different content can't be merged: the closed case's content would never be acted on. Decide together acts on each. */}
                        <span className="ml-auto text-muted-foreground">Decide together from the decision panel</span>
                    </p>
                ) : null}
                {c.duplicates.length && open ? (
                    <p role="note" className="flex flex-wrap items-center gap-2 rounded-[5px] bg-secondary px-3 py-2 text-[13px]">
                        <Users className="size-4" aria-hidden="true" />
                        {c.duplicates.length} other open {c.duplicates.length === 1 ? 'case' : 'cases'} about this {KIND_NOUN[c.target_kind]}: {c.duplicates.map((d) => caseLabel(d.number)).join(', ')}
                        <MergeButton caseId={c.id} into={caseLabel(c.duplicates[0]!.number)} label={label} onMerged={onMerged} />
                    </p>
                ) : null}

                {c.appeal ? (
                    <section aria-labelledby="appeal-title" className="space-y-2">
                        <h2 id="appeal-title" className="flex items-center gap-2 text-[15px] font-semibold"><Scale className="size-4" aria-hidden="true" />Appeal · {c.appeal.state.replace('_', ' ')}</h2>
                        <p className="text-[13px] text-muted-foreground">Sent {istDateTime(c.appeal.created_at)} · against {c.actions.filter((a) => !a.undone_at).map((a) => `${ACTION_LABEL[a.action as ModerationActionKind] ?? a.action}${a.rule ? ` (${ruleLabel(a.rule)})` : ''}`).join(', ') || 'the decision'}</p>
                        <div className="whitespace-pre-wrap rounded-[8px] border border-border bg-card p-4 text-[14px]">{c.appeal.body}</div>
                        {c.appeal.fixed ? <p className="text-[13px]">They say they&apos;ve changed or removed the content.</p> : null}
                        {c.appeal.reply ? <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">Reply: {c.appeal.reply}</p> : null}
                    </section>
                ) : null}

                <p className="text-[13px]">
                    {c.reports.length ? <>{reasons.join(', ')} · {c.reports.length} {c.reports.length === 1 ? 'report' : 'reports'} · first {istDateTime(firstAt)}{lastAt !== firstAt ? `, last ${istDateTime(lastAt)}` : ''} · <span className={trustTone(accuracy.actioned, accuracy.decided)}>{reporters.length === 1 ? 'reporter' : 'reporters'} {accuracy.actioned} of {accuracy.decided} actioned</span></> : 'Opened by staff, no user reports'}
                    {c.routed_to === 'org' ? ' · With the org’s moderators' : ''}
                </p>
                {c.pile_on ? (
                    <p role="note" className="rounded-[5px] border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] px-3 py-2 text-[13px]">
                        Possible pile-on: several new accounts or people from one place reported this within an hour. Judge the content, not the count.
                    </p>
                ) : null}

                <Evidence key={c.id} caseId={c.id} kind={c.target_kind} reason={c.reason} snapshot={c.snapshot ?? {}} live={live.data?.live ?? null} liveState={live.data?.state ?? null} targetSeq={c.target_seq} />
                {c.details ? <p className="whitespace-pre-wrap text-[13px] text-muted-foreground">{c.details}</p> : null}
                {typeof c.snapshot?.href === 'string' && live.data?.state !== 'deleted' ? <Link href={c.snapshot.href} className="inline-block text-[13px] underline underline-offset-4">Open in app</Link> : null}

                {c.reports.length ? (
                    <section aria-labelledby="reports-title">
                        <h2 id="reports-title" className="mb-2 text-[15px] font-semibold">Reports</h2>
                        <ul className="divide-y divide-border">
                            {reports.map((r) => (
                                <li key={r.id} className="py-2.5 text-[13px]">
                                    <p><span className="font-medium">{REPORT_REASON_LABEL[r.reason]}</span> · {r.reporter_name ?? 'Deleted user'} · <span className="text-muted-foreground">{istDateTime(r.created_at)}</span> · <span className={trustTone(r.actioned, r.decided)}>{r.actioned} of {r.decided} actioned</span></p>
                                    {r.details ? <blockquote className="mt-1 border-l-2 border-border pl-2 text-muted-foreground">{r.details}</blockquote> : null}
                                </li>
                            ))}
                        </ul>
                        {c.reports.length > 3 && !allReports ? <button type="button" onClick={() => setAllReports(true)} className="mt-1 text-[13px] underline underline-offset-4">Show all {c.reports.length}</button> : null}
                    </section>
                ) : null}

                <Timeline c={c} />
            </div>
        </article>
    )
}

/** Person strip (R10): standing at a glance; the history popover on hover, the full drawer on click. */
function PersonStrip({ c }: { c: CaseDetail }) {
    const p = c.person!
    const [drawer, setDrawer] = useState(false)
    const [peek, setPeek] = useState(false)
    const queryClient = useQueryClient()
    const key = ['trust', 'person', p.id]
    const person = useQuery({ queryKey: key, queryFn: () => personDetailAction(p.id), enabled: drawer || peek, staleTime: 30_000 })
    const strikes = person.data?.actions.filter((a) => a.strike && !a.undone_at && !a.reversed_at && a.strike_expires_at && new Date(a.strike_expires_at) > new Date()) ?? []
    return (
        <div className="relative" onMouseLeave={() => setPeek(false)}>
            <button type="button" onClick={() => setDrawer(true)} onMouseEnter={() => { setPeek(true); void queryClient.prefetchQuery({ queryKey: key, queryFn: () => personDetailAction(p.id) }) }} onFocus={() => setPeek(true)} onBlur={() => setPeek(false)}
                className="flex w-full items-center gap-3 rounded-[8px] border border-border px-3 py-2 text-left hover:bg-muted/50">
                <UserAvatar identity={{ id: p.id, fullName: p.name, username: p.username, avatarUrl: p.avatar }} size={36} roundedClassName="rounded-[6px]" />
                <span className="min-w-0 flex-1 text-[13px]">
                    <span className="font-medium">{p.name ?? 'No name'}</span> {p.username ? <span className="text-muted-foreground">@{p.username}</span> : null}
                    <span className="block text-[12px] text-muted-foreground">
                        {p.restriction ? `${p.restriction}${p.until ? ` until ${istDate(p.until)}` : ''}` : 'Good standing'} · {p.strikes} active {p.strikes === 1 ? 'strike' : 'strikes'}
                        {c.otherCases.length ? ` · ${c.otherCases.length} other open ${c.otherCases.length === 1 ? 'case' : 'cases'}` : ''} · joined {istDate(p.created_at)}
                    </span>
                </span>
            </button>
            {peek && person.data ? (
                <div role="tooltip" className="absolute left-0 top-full z-20 mt-1 w-[320px] rounded-[8px] border border-border bg-popover p-3 text-[13px] shadow-md">
                    <p className="font-medium">History</p>
                    <ul className="mt-1 space-y-0.5">
                        {person.data.cases.slice(0, 5).map((x) => <li key={x.id}><span className="font-mono tabular-nums">{caseLabel(x.number)}</span> · {REPORT_REASON_LABEL[x.reason]} · {caseState(x)}</li>)}
                        {!person.data.cases.length ? <li className="text-muted-foreground">No earlier cases.</li> : null}
                    </ul>
                    <p className="mt-2 font-medium">Strikes</p>
                    <ul className="mt-1 space-y-0.5">
                        {strikes.map((a) => <li key={a.id}>{ACTION_LABEL[a.action as ModerationActionKind]} · expires {istDate(a.strike_expires_at)}</li>)}
                        {!strikes.length ? <li className="text-muted-foreground">None active.</li> : null}
                    </ul>
                </div>
            ) : null}
            <Dialog open={drawer} onOpenChange={setDrawer}>
                <DialogContent presentation="right-drawer" className="w-full max-w-[560px] overflow-y-auto">
                    <DialogHeader className="sr-only"><DialogTitle>{p.name ?? handleOf(p)}</DialogTitle><DialogDescription>Their standing and history</DialogDescription></DialogHeader>
                    {person.data ? <PersonView p={person.data} /> : <p role="status" className="nb-waiting text-[13px] text-muted-foreground">{person.isError ? 'Couldn’t load · try again' : <><PixelBeat />Loading…</>}</p>}
                </DialogContent>
            </Dialog>
        </div>
    )
}

/** Notes and history in one timeline, the note box at the bottom (R3). */
function Timeline({ c }: { c: CaseDetail }) {
    const queryClient = useQueryClient()
    const [body, setBody] = useState('')
    const [pending, start] = useTransition()
    const events = c.events.filter((e) => e.kind !== 'reporters_told')
    return (
        <section aria-labelledby="timeline-title">
            <h2 id="timeline-title" className="mb-2 text-[15px] font-semibold">Notes and history</h2>
            <ol className="space-y-2 border-l border-border pl-3 text-[13px]">
                {events.map((e, i) => (
                    <li key={i}>
                        <span className="text-muted-foreground">{istDateTime(e.created_at)}</span> · <span className="font-medium">{e.actor_name ?? 'System'}</span> {e.kind === 'note' ? 'noted' : EVENT_TEXT[e.kind] ?? e.kind.replace(/_/g, ' ')}
                        {e.kind === 'note' ? <p className="whitespace-pre-wrap">{String(e.data.body ?? '')}</p> : null}
                        {(e.kind === 'assigned' || e.kind === 'escalated') && (e.data.reason || e.data.note) ? <p className="text-muted-foreground">{String(e.data.reason ?? e.data.note)}</p> : null}
                    </li>
                ))}
            </ol>
            <form className="mt-3 space-y-2" onSubmit={(e) => {
                e.preventDefault()
                start(async () => {
                    const result = await addNoteAction(c.id, body)
                    if (!result.success) return void toast(result.error)
                    setBody('')
                    void queryClient.invalidateQueries({ queryKey: ['trust', 'case', c.id] })
                })
            }}>
                <textarea rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a note visible to staff only" aria-label="Internal note" className={`${FIELD} py-2`} />
                <Button type="submit" size="sm" variant="outline" disabled={pending || !body.trim()}>Add note</Button>
            </form>
        </section>
    )
}

function MergeButton({ caseId, into, label, onMerged }: { caseId: string; into: string; label: string; onMerged: () => void }) {
    const [pending, start] = useTransition()
    return (
        <Button size="sm" variant="outline" className="ml-auto" disabled={pending} onClick={() => start(async () => {
            const r = await mergeCaseAction(caseId, into)
            toast(r.success ? `${label} merged into ${into}` : r.error)
            if (r.success) onMerged()
        })}>Merge into {into}</Button>
    )
}

/** The case menu: assign, escalate, severity, merge, legal hold, release, copy link (S11). */
function CaseMenu({ c, onMerged }: { c: CaseDetail; onMerged: () => void }) {
    const queryClient = useQueryClient()
    const label = caseLabel(c.number)
    const open = c.state === 'open' || c.state === 'in_review'
    const [pending, start] = useTransition()
    const [dialog, setDialog] = useState<'severity' | 'merge' | 'assign' | 'escalate' | null>(null)
    const [value, setValue] = useState('')
    const [nextSeverity, setNextSeverity] = useState<Severity>(c.severity)
    const [assignee, setAssignee] = useState('')
    const staff = useQuery({ queryKey: ['trust', 'staff'], queryFn: staffListAction, enabled: dialog === 'assign', staleTime: 60_000 })
    const stepUp = useStepUp('Releasing a legal hold needs one more check.')
    const run = (action: () => Promise<{ success: boolean; error?: string }>, done: string, after?: () => void) => start(async () => {
        const result = await action()
        if (stepUp.needs(result, () => run(action, done, after))) return
        toast(result.success ? done : result.error ?? 'Couldn’t do that. Try again.')
        if (!result.success) return
        setDialog(null)
        setValue('')
        after?.()
        void queryClient.invalidateQueries({ queryKey: ['trust'] })
    })
    const title = { severity: 'Change severity', merge: 'Merge into another case', assign: 'Assign to someone', escalate: c.escalated_at ? 'Clear the admin request' : 'Needs an admin' }
    const description = {
        severity: 'The deadline moves with it. Say why; it goes in the case history.',
        merge: 'This case closes as a duplicate and its reports move to the other case.',
        assign: 'They get a notice, and the case shows in their Mine view.',
        escalate: c.escalated_at ? 'The case leaves the Needs an admin view.' : 'Admins get a notice and push. Say what they need to decide.',
    }
    return (
        <>
            <DropdownMenu>
                <DropdownMenuTrigger asChild><Button size="icon-sm" variant="ghost" aria-label="Case actions"><MoreHorizontal /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {open ? (
                        <>
                            <DropdownMenuItem onSelect={() => setDialog('assign')}><Users aria-hidden="true" />Assign…</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setDialog('escalate')}><ShieldAlert aria-hidden="true" />{c.escalated_at ? 'Clear admin request' : 'Needs an admin…'}</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setDialog('severity')}><Gavel aria-hidden="true" />Change severity…</DropdownMenuItem>
                            <DropdownMenuItem onSelect={() => setDialog('merge')}>Merge into another case…</DropdownMenuItem>
                            {c.leased && c.assignee_id === c.me ? <DropdownMenuItem onSelect={() => run(() => claimCaseAction(c.id, 'release'), 'You stopped reviewing')}>Stop reviewing</DropdownMenuItem> : null}
                            <DropdownMenuSeparator />
                        </>
                    ) : null}
                    <DropdownMenuItem onSelect={() => { copyOrSay(`${window.location.origin}/admin/trust?case=${label}`, () => toast('Case link copied')) }}>Copy case link</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => run(() => legalHoldAction(c.id, !c.legal_hold), c.legal_hold ? 'Legal hold removed' : 'Legal hold added')}>{c.legal_hold ? 'Remove legal hold' : 'Add to legal hold'}</DropdownMenuItem>
                </DropdownMenuContent>
            </DropdownMenu>
            {stepUp.dialog}
            <Dialog open={dialog !== null} onOpenChange={(next) => !next && setDialog(null)}>
                <DialogContent size="confirm">
                    <DialogHeader>
                        <DialogTitle>{dialog ? title[dialog] : ''}</DialogTitle>
                        <DialogDescription>{dialog ? description[dialog] : ''}</DialogDescription>
                    </DialogHeader>
                    {dialog === 'severity' ? (
                        <select value={nextSeverity} onChange={(e) => setNextSeverity(e.target.value as Severity)} aria-label="Severity" className={`${FIELD} h-[var(--ui-control-height)]`}>
                            <option value="urgent">Urgent</option><option value="high">High</option><option value="normal">Normal</option>
                        </select>
                    ) : null}
                    {dialog === 'assign' ? (
                        <select value={assignee} onChange={(e) => setAssignee(e.target.value)} aria-label="Staff member" className={`${FIELD} h-[var(--ui-control-height)]`}>
                            <option value="">{c.assigned_to ? 'No one (remove the assignment)' : 'Pick someone'}</option>
                            {staff.data?.map((s) => <option key={s.id} value={s.id}>{s.name}{s.id === c.me ? ' (you)' : ''} · {s.role}</option>)}
                        </select>
                    ) : null}
                    {dialog === 'escalate' && c.escalated_at ? null : (
                        <input value={value} onChange={(e) => setValue(e.target.value)} aria-label={dialog === 'merge' ? 'Case number' : 'Reason'}
                            placeholder={dialog === 'merge' ? 'NB-1001' : dialog === 'assign' ? 'Why them (optional)' : dialog === 'escalate' ? 'What an admin needs to decide' : 'Reason'} className={`${FIELD} h-[var(--ui-control-height)]`} />
                    )}
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setDialog(null)}>Cancel</Button>
                        <Button disabled={pending || (dialog === 'severity' || dialog === 'merge' ? !value.trim() : dialog === 'escalate' && !c.escalated_at ? value.trim().length < 3 : dialog === 'assign' ? !assignee && !c.assigned_to : false)} onClick={() => {
                            if (dialog === 'severity') run(() => changeSeverityAction(c.id, nextSeverity, value, c.version), 'Severity changed')
                            else if (dialog === 'merge') run(() => mergeCaseAction(c.id, value), `${label} merged into ${value.toUpperCase()}`, onMerged)
                            else if (dialog === 'assign') run(() => assignCaseAction(c.id, assignee || null, value, c.version), assignee ? 'Assigned' : 'Assignment removed')
                            else if (dialog === 'escalate') run(() => escalateCaseAction(c.id, value, !c.escalated_at, c.version), c.escalated_at ? 'Admin request cleared' : 'Admins asked to decide')
                        }}>
                            {dialog === 'severity' ? 'Change severity' : dialog === 'merge' ? 'Merge case' : dialog === 'assign' ? (assignee || !c.assigned_to ? 'Assign' : 'Remove assignment') : c.escalated_at ? 'Clear request' : 'Ask an admin'}
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </>
    )
}
