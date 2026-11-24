'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { BadgeCheck, ScrollText, ShieldCheck } from '@/components/ui/icons'
import { toast } from '@/lib/feedback'

import { auditExportedAction, decideVerificationAction, liftActionAction, unsuspendOrgAction, verificationDocumentUrlAction } from '@/app/actions/moderation-staff'
import { FIELD } from '@/components/trust/NewCaseDialog'
import { useStepUp } from '@/components/trust/StepUp'
import { caseHref, istDate, istDateTime } from '@/components/trust/format'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import type { readActive, readAudit, readVerification } from '@/lib/trust/console'
import { ACTION_LABEL, caseLabel, ruleLabel, type ModerationActionKind } from '@/lib/trust/rules'
import { saveBlob, toCsvBlob } from '@/lib/download'

const TH = 'px-2 py-2 text-left text-[12px] font-medium text-muted-foreground'
const TD = 'px-2 py-2.5 align-top text-[13px]'

/** `onDone` in place of a page refresh where the data lives in the client (the Inbox, S6). */
function useRun(onDone?: () => void) {
    const router = useRouter()
    const [pending, start] = useTransition()
    const run = (action: () => Promise<{ success: boolean; error?: string }>, done: string, after?: () => void) => start(async () => {
        const result = await action()
        toast(result.success ? done : result.error ?? 'Couldn’t do that. Check your connection and try again.')
        if (result.success) { after?.(); if (onDone) onDone(); else router.refresh() }
    })
    return { pending, run }
}

/** What's left of a restriction, as a bar (R1 Enforcement). */
function Remaining({ from, to }: { from: string; to: string | null }) {
    if (!to) return <span className="text-[12px] text-muted-foreground">No end date</span>
    const total = new Date(to).getTime() - new Date(from).getTime()
    const left = Math.max(0, new Date(to).getTime() - Date.now())
    const days = Math.ceil(left / 86_400_000)
    return (
        <span className="flex items-center gap-2">
            <span className="h-1.5 w-20 overflow-hidden rounded-full bg-secondary" aria-hidden="true"><span suppressHydrationWarning className="block h-full bg-[var(--status-warning)]" style={{ width: `${total > 0 ? Math.round((left / total) * 100) : 0}%` }} /></span>
            <span suppressHydrationWarning className="font-mono text-[12px] tabular-nums text-muted-foreground">{days}d left</span>
        </span>
    )
}

/** Enforcement (R1, 17.7): everything in force, grouped by Accounts / Workspaces / Organizations, with Lift. */
export function ActiveTable({ data }: { data: Awaited<ReturnType<typeof readActive>> }) {
    const { pending, run } = useRun()
    const [lifting, setLifting] = useState<{ id: string; what: string; action: string } | null>(null)
    const [reason, setReason] = useState('')
    if (!data.rows.length && !data.legacy.length) return <EmptyState icon={ShieldCheck} className="mt-6" title="Nothing is in force" description="Limits, suspensions, bans and workspace actions show here while they last." />
    const groups = [
        { title: 'Accounts', rows: data.rows.filter((r) => r.target_kind === 'account') },
        { title: 'Workspaces', rows: data.rows.filter((r) => r.target_kind !== 'account' && r.workspace_kind !== 'organization') },
        { title: 'Organizations', rows: data.rows.filter((r) => r.target_kind !== 'account' && r.workspace_kind === 'organization') },
    ]
    return (
        <div className="mt-4 space-y-6 overflow-x-auto">
            {groups.map((g) => (g.rows.length || (g.title === 'Organizations' && data.legacy.length)) ? (
                <section key={g.title}>
                    <h2 className="mb-1 text-[15px] font-semibold">{g.title}</h2>
                    <table className="w-full border-collapse">
                        <thead className="border-b border-border"><tr><th className={TH}>Who</th><th className={TH}>Action</th><th className={TH}>Time left</th><th className={TH}>Case</th><th className={TH}>Appeal</th><th className={TH}><span className="sr-only">Lift</span></th></tr></thead>
                        <tbody className="divide-y divide-border">
                            {g.rows.map((r) => (
                                <tr key={r.id}>
                                    <td className={TD}>{r.what ?? '—'}</td>
                                    <td className={TD}>{r.action === 'remove_workspace' && r.ends_at ? `Removal on ${istDate(r.ends_at)}` : ACTION_LABEL[r.action as ModerationActionKind] ?? r.action}</td>
                                    <td className={TD}>{r.action === 'ban' ? <span className="text-[12px] text-muted-foreground">Permanent</span> : <Remaining from={r.created_at} to={r.ends_at} />}</td>
                                    <td className={TD}>{r.case_number ? <Link href={caseHref(r.case_number)} className="font-mono text-[12px] tabular-nums underline underline-offset-4">{caseLabel(r.case_number)}</Link> : '—'}</td>
                                    <td className={TD}>{r.appeal_state?.replace('_', ' ') ?? '—'}</td>
                                    <td className={`${TD} text-right`}><Button size="sm" variant="outline" onClick={() => setLifting({ id: r.id, what: r.what ?? 'this', action: ACTION_LABEL[r.action as ModerationActionKind] ?? r.action })}>Lift</Button></td>
                                </tr>
                            ))}
                            {g.title === 'Organizations' ? data.legacy.map((l) => (
                                <tr key={l.id}>
                                    <td className={TD}>{l.title}</td>
                                    <td className={TD}>Suspended</td>
                                    <td className={TD}><span className="text-[12px] text-muted-foreground">Until lifted · since {istDate(l.at)}</span></td>
                                    <td className={TD}>Before cases · {l.reason}</td>
                                    <td className={TD}>—</td>
                                    <td className={`${TD} text-right`}><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => unsuspendOrgAction(l.id), `Suspension lifted for ${l.title}`)}>Lift</Button></td>
                                </tr>
                            )) : null}
                        </tbody>
                    </table>
                </section>
            ) : null)}
            <Dialog open={Boolean(lifting)} onOpenChange={(next) => { if (!next) { setLifting(null); setReason('') } }}>
                <DialogContent size="confirm">
                    <DialogHeader>
                        <DialogTitle>Lift {lifting?.action.toLowerCase()} for {lifting?.what}</DialogTitle>
                        <DialogDescription>It ends now and they get a notice. The reason stays in the audit log.</DialogDescription>
                    </DialogHeader>
                    <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it’s lifted" aria-label="Reason" className={`${FIELD} py-2`} />
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setLifting(null)}>Cancel</Button>
                        <Button disabled={pending || reason.trim().length < 3} onClick={() => lifting && run(() => liftActionAction(lifting.id, reason), `${lifting.action} lifted for ${lifting.what}`, () => { setLifting(null); setReason('') })}>Lift {lifting?.action.toLowerCase()}</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </div>
    )
}

const linkUrls = (links: unknown): string[] => Array.isArray(links)
    ? links.map((l) => (l as { url?: unknown })?.url).filter((u): u is string => typeof u === 'string')
    : links && typeof links === 'object' ? Object.values(links).filter((u): u is string => typeof u === 'string') : []
const host = (url: string) => { try { return new URL(url).hostname.replace(/^www\./, '') } catch { return url } }

/** Verification tab (17.9). */
export function VerificationList({ rows, onDone }: { rows: Awaited<ReturnType<typeof readVerification>>; onDone?: () => void }) {
    const { pending, run } = useRun(onDone)
    const [declining, setDeclining] = useState<{ id: string; title: string } | null>(null)
    const [note, setNote] = useState('')
    if (!rows.length) return <EmptyState icon={BadgeCheck} className="mt-6" title="No verification requests" />
    return (
        <ul className="mt-4 divide-y divide-border border-y border-border">
            {rows.map((r) => {
                const sites = linkUrls(r.links)
                const domain = r.owner_email?.split('@')[1]?.toLowerCase() ?? null
                const match = Boolean(domain && sites.some((s) => host(s) === domain || host(s).endsWith(`.${domain}`)))
                return (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 py-3">
                        <div className="min-w-0 flex-1 text-[13px]">
                            <Link href={`/org/${encodeURIComponent(r.slug ?? r.id)}`} className="font-medium underline underline-offset-4">{r.title}</Link>
                            <p className="text-muted-foreground">{sites.length ? sites.map(host).join(' · ') : 'No website'}</p>
                            <p className="text-[12px] text-muted-foreground">Owner domain {domain ?? '—'} · <span className={match ? 'text-[var(--status-success)]' : 'text-[var(--status-warning)]'}>{match ? 'Match' : 'No match'}</span> · requested {istDate(r.requested_at)}</p>
                            {r.part_of ? <p className="text-[12px] text-muted-foreground">Part of {r.part_of}</p> : null}
                            {/* G7: what the owner wrote, their links and the document (staff only, a 5-minute link). */}
                            {r.request?.explanation ? <blockquote className="mt-1.5 whitespace-pre-wrap border-l-2 border-border pl-2 text-[13px] text-foreground">{r.request.explanation}</blockquote> : null}
                            {r.request?.links?.length ? <p className="mt-1 flex flex-wrap gap-x-3 text-[12px]">{r.request.links.map((l) => <a key={l} href={l} target="_blank" rel="noopener noreferrer nofollow" className="underline underline-offset-4">{host(l) || l}</a>)}</p> : null}
                            {r.request?.document ? <button type="button" className="mt-1 text-[12px] text-primary underline underline-offset-4" onClick={() => void verificationDocumentUrlAction(r.id).then((d) => d.success ? window.open(d.url, '_blank', 'noopener') : toast.error(d.error))}>
                                Open {r.request.document.name} ({Math.max(1, Math.round(r.request.document.size / 1024))} KB)
                            </button> : null}
                        </div>
                        <Button size="sm" disabled={pending} onClick={() => run(() => decideVerificationAction(r.id, true), 'Organization verified')}>Verify organization</Button>
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => setDeclining({ id: r.id, title: r.title })}>Decline</Button>
                    </li>
                )
            })}
            <Dialog open={Boolean(declining)} onOpenChange={(next) => !next && setDeclining(null)}>
                <DialogContent size="confirm">
                    <DialogHeader><DialogTitle>Decline {declining?.title}</DialogTitle><DialogDescription>The owner is told it wasn’t verified this time. Add a note if it helps them.</DialogDescription></DialogHeader>
                    <textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional note to the owner" aria-label="Note" className={`${FIELD} py-2`} />
                    <DialogFooter>
                        <Button variant="ghost" onClick={() => setDeclining(null)}>Cancel</Button>
                        <Button disabled={pending} onClick={() => declining && run(() => decideVerificationAction(declining.id, false, note), 'Request declined', () => { setDeclining(null); setNote('') })}>Decline request</Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </ul>
    )
}

type AuditFilters = { action?: string; from?: string; to?: string; staff?: string }

/** Audit log (17.11, S7): append-only, filtered by staff, action and dates, 50 a page; Export CSV downloads what's shown. */
export function AuditTable({ data, staff, filters }: { data: Awaited<ReturnType<typeof readAudit>>; staff: Array<{ id: string; name: string | null }>; filters: AuditFilters }) {
    const rows = data.rows
    const stepUp = useStepUp('Exporting the audit log needs one more check.')
    // The export is logged and needs a fresh check (F16); the file is built only once the server agrees.
    const [exporting, setExporting] = useState(false)
    const exportCsv = async () => {
        if (exporting) return
        setExporting(true)
        try {
            await runExport()
        } finally {
            setExporting(false)
        }
    }
    const runExport = async () => {
        const result = await auditExportedAction(rows.length)
        if (stepUp.needs(result, () => void exportCsv())) return
        if (!result.success) return void toast(result.error)
        const lines = [['time', 'staff', 'action', 'case', 'rule', 'note'], ...rows.map((r) => [r.created_at, r.staff, r.kind, r.case_number ? caseLabel(r.case_number) : '', r.data.rule ?? '', r.data.body ?? r.data.note ?? r.data.reason ?? ''])]
        saveBlob(toCsvBlob(lines), `trust-audit-${new Date().toISOString().slice(0, 10)}.csv`)
    }
    const older = new URLSearchParams({ tab: 'insights', section: 'audit', ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string>, ...(data.before ? { before: String(data.before) } : {}) })
    const filterForm = (
        <form action="/admin/trust" className="flex flex-wrap items-end gap-2 text-[13px]">
            <input type="hidden" name="tab" value="insights" /><input type="hidden" name="section" value="audit" />
            <label className="grid gap-1">Staff
                <select name="staff" defaultValue={filters.staff ?? ''} className={`${FIELD} mt-0 h-8 w-44`}><option value="">Anyone</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name ?? 'Staff'}</option>)}</select>
            </label>
            <label className="grid gap-1">Action<input name="action" defaultValue={filters.action ?? ''} placeholder="decided, viewed…" className={`${FIELD} mt-0 h-8 w-40`} /></label>
            <label className="grid gap-1">From<input type="date" name="from" defaultValue={filters.from ?? ''} className={`${FIELD} mt-0 h-8`} /></label>
            <label className="grid gap-1">To<input type="date" name="to" defaultValue={filters.to ?? ''} className={`${FIELD} mt-0 h-8`} /></label>
            <Button type="submit" size="sm" variant="outline">Apply</Button>
            <Button size="sm" variant="outline" type="button" className="ml-auto" onClick={() => void exportCsv()} disabled={!rows.length || exporting}>Export CSV</Button>
        </form>
    )
    if (!rows.length) return <div className="mt-4 space-y-4">{filterForm}<EmptyState icon={ScrollText} title="Nothing logged here" description="Every staff action lands in the log." /></div>
    return (
        <div className="mt-4 overflow-x-auto">
            <div className="mb-3">{filterForm}</div>
            {stepUp.dialog}
            <table className="w-full border-collapse">
                <thead className="border-b border-border"><tr><th className={TH}>Time</th><th className={TH}>Staff</th><th className={TH}>Action</th><th className={TH}>Case</th><th className={TH}>Rule</th><th className={TH}>Note</th></tr></thead>
                <tbody className="divide-y divide-border">
                    {rows.map((r) => (
                        <tr key={r.id}>
                            <td className={`${TD} whitespace-nowrap font-mono text-[12px] tabular-nums text-muted-foreground`}>{istDateTime(r.created_at)}</td>
                            <td className={TD}>{r.staff ?? '—'}</td>
                            <td className={TD}>{r.kind.replace(/_/g, ' ')}</td>
                            <td className={TD}>{r.case_number ? <Link href={caseHref(r.case_number)} className="font-mono text-[12px] tabular-nums underline underline-offset-4">{caseLabel(r.case_number)}</Link> : '—'}</td>
                            <td className={TD}>{typeof r.data.rule === 'number' ? ruleLabel(r.data.rule) : '—'}</td>
                            <td className={`${TD} max-w-[40ch]`}><span className="line-clamp-2" title={String(r.data.body ?? r.data.note ?? r.data.reason ?? '')}>{String(r.data.body ?? r.data.note ?? r.data.reason ?? '')}</span></td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {data.before ? <Link href={`/admin/trust?${older}`} className="mt-3 inline-block text-[13px] underline underline-offset-4">Older entries</Link> : null}
        </div>
    )
}
