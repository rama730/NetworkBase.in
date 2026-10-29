'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { BadgeCheck, ScrollText, ShieldCheck } from 'lucide-react'
import { toast } from '@/lib/feedback'

import { auditExportedAction, decideVerificationAction, liftActionAction, unsuspendOrgAction } from '@/app/actions/moderation-staff'
import { FIELD } from '@/components/trust/NewCaseDialog'
import { caseHref, istDate, istDateTime } from '@/components/trust/format'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import type { readActive, readAudit, readVerification } from '@/lib/trust/console'
import { ACTION_LABEL, caseLabel, ruleLabel, type ModerationActionKind } from '@/lib/trust/rules'

const ACTIVE_BADGE: Record<string, string> = { limit: 'limited', suspension: 'suspended', ban: 'banned', restrict: 'restricted', hide_discover: 'hidden', suspend_workspace: 'suspended', remove_workspace: 'removal' }
const TH = 'nb-micro px-2 py-2 text-left font-medium'
const TD = 'px-2 py-2.5 align-top text-[13px]'

function useRun() {
    const router = useRouter()
    const [pending, start] = useTransition()
    const run = (action: () => Promise<{ success: boolean; error?: string }>, done: string, after?: () => void) => start(async () => {
        const result = await action()
        toast(result.success ? done : result.error ?? 'Couldn’t do that. Check your connection and try again.')
        if (result.success) { after?.(); router.refresh() }
    })
    return { pending, run }
}

/** Active tab (17.7): everything in force, with Lift. */
export function ActiveTable({ data }: { data: Awaited<ReturnType<typeof readActive>> }) {
    const { pending, run } = useRun()
    const [lifting, setLifting] = useState<{ id: string; what: string; action: string } | null>(null)
    const [reason, setReason] = useState('')
    if (!data.rows.length && !data.legacy.length) return <EmptyState icon={ShieldCheck} className="mt-6" title="Nothing is in force" description="Limits, suspensions, bans and workspace actions show here while they last." />
    return (
        <div className="mt-4 overflow-x-auto">
            <table className="w-full border-collapse">
                <thead className="border-b border-border"><tr><th className={TH}>What</th><th className={TH}>Action</th><th className={TH}>Since → until</th><th className={TH}>Case</th><th className={TH}>Appeal</th><th className={TH}><span className="sr-only">Lift</span></th></tr></thead>
                <tbody className="divide-y divide-border">
                    {data.rows.map((r) => (
                        <tr key={r.id}>
                            <td className={TD}>{r.target_kind === 'account' ? 'Account' : 'Workspace'} · {r.what ?? '—'}</td>
                            <td className={TD}><span className="nb-status" data-status="blocked">{r.action === 'remove_workspace' && r.ends_at ? `removal ${istDate(r.ends_at)}` : ACTIVE_BADGE[r.action] ?? r.action}</span></td>
                            <td className={`${TD} nb-meta`}>{istDate(r.created_at)} → {r.ends_at ? istDate(r.ends_at) : r.action === 'ban' ? 'Permanent' : 'Until lifted'}</td>
                            <td className={TD}>{r.case_number ? <Link href={caseHref(r.case_number)} className="nb-meta text-foreground underline underline-offset-4">{caseLabel(r.case_number)}</Link> : '—'}</td>
                            <td className={TD}>{r.appeal_state ?? '—'}</td>
                            <td className={`${TD} text-right`}><Button size="sm" variant="outline" onClick={() => setLifting({ id: r.id, what: r.what ?? 'this', action: ACTION_LABEL[r.action as ModerationActionKind] ?? r.action })}>Lift</Button></td>
                        </tr>
                    ))}
                    {data.legacy.map((l) => (
                        <tr key={l.id}>
                            <td className={TD}>Organization · {l.title}</td>
                            <td className={TD}><span className="nb-status" data-status="blocked">suspended</span></td>
                            <td className={`${TD} nb-meta`}>{istDate(l.at)} → Until lifted</td>
                            <td className={TD}>Before cases · {l.reason}</td>
                            <td className={TD}>—</td>
                            <td className={`${TD} text-right`}><Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => unsuspendOrgAction(l.id), `Suspension lifted for ${l.title}`)}>Lift</Button></td>
                        </tr>
                    ))}
                </tbody>
            </table>
            <Dialog open={Boolean(lifting)} onOpenChange={(next) => { if (!next) { setLifting(null); setReason('') } }}>
                <DialogContent className="max-w-[420px]">
                    <DialogHeader>
                        <DialogTitle>Lift {lifting?.action.toLowerCase()} for {lifting?.what}</DialogTitle>
                        <DialogDescription>It ends now and they get a notice. The reason stays in the audit log.</DialogDescription>
                    </DialogHeader>
                    <textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why it's lifted" aria-label="Reason" className={`${FIELD} py-2`} />
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
export function VerificationList({ rows }: { rows: Awaited<ReturnType<typeof readVerification>> }) {
    const { pending, run } = useRun()
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
                            <p className="nb-meta">Owner domain {domain ?? '—'} · <span className={match ? 'text-[var(--status-success)]' : 'text-[var(--status-warning)]'}>{match ? 'Match' : 'No match'}</span> · requested {istDate(r.requested_at)}</p>
                        </div>
                        <Button size="sm" disabled={pending} onClick={() => run(() => decideVerificationAction(r.id, true), 'Organization verified')}>Verify organization</Button>
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => setDeclining({ id: r.id, title: r.title })}>Decline</Button>
                    </li>
                )
            })}
            <Dialog open={Boolean(declining)} onOpenChange={(next) => !next && setDeclining(null)}>
                <DialogContent className="max-w-[420px]">
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

const csvCell = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`

/** Audit log tab (17.11): append-only; Export CSV downloads what's shown. */
export function AuditTable({ rows }: { rows: Awaited<ReturnType<typeof readAudit>> }) {
    const exportCsv = () => {
        const lines = [['time', 'staff', 'action', 'case', 'rule', 'note'], ...rows.map((r) => [r.created_at, r.staff, r.kind, r.case_number ? caseLabel(r.case_number) : '', r.data.rule ?? '', r.data.body ?? r.data.note ?? r.data.reason ?? ''])]
        const url = URL.createObjectURL(new Blob([lines.map((l) => l.map(csvCell).join(',')).join('\n')], { type: 'text/csv' }))
        const a = Object.assign(document.createElement('a'), { href: url, download: `trust-audit-${new Date().toISOString().slice(0, 10)}.csv` })
        a.click()
        URL.revokeObjectURL(url)
        void auditExportedAction(rows.length)
    }
    if (!rows.length) return <EmptyState icon={ScrollText} className="mt-6" title="Nothing logged yet" description="Every staff action lands here." />
    return (
        <div className="mt-4 overflow-x-auto">
            <div className="mb-2 flex justify-end"><Button size="sm" variant="outline" onClick={exportCsv}>Export CSV</Button></div>
            <table className="w-full border-collapse">
                <thead className="border-b border-border"><tr><th className={TH}>Time</th><th className={TH}>Staff</th><th className={TH}>Action</th><th className={TH}>Case</th><th className={TH}>Rule</th><th className={TH}>Note</th></tr></thead>
                <tbody className="divide-y divide-border">
                    {rows.map((r) => (
                        <tr key={r.id}>
                            <td className={`${TD} nb-meta whitespace-nowrap`}>{istDateTime(r.created_at)}</td>
                            <td className={TD}>{r.staff ?? '—'}</td>
                            <td className={TD}>{r.kind.replace(/_/g, ' ')}</td>
                            <td className={TD}>{r.case_number ? <Link href={caseHref(r.case_number)} className="nb-meta text-foreground underline underline-offset-4">{caseLabel(r.case_number)}</Link> : '—'}</td>
                            <td className={TD}>{typeof r.data.rule === 'number' ? ruleLabel(r.data.rule) : '—'}</td>
                            <td className={`${TD} max-w-[40ch]`}><span className="line-clamp-2" title={String(r.data.body ?? r.data.note ?? r.data.reason ?? '')}>{String(r.data.body ?? r.data.note ?? r.data.reason ?? '')}</span></td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    )
}
