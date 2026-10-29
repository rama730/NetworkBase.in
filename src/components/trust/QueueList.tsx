'use client'

import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { Fragment, useEffect, useState, useTransition } from 'react'
import { Inbox } from 'lucide-react'
import { toast } from '@/lib/feedback'

import { bulkDecideAction, claimCaseAction } from '@/app/actions/moderation-staff'
import { Deadline, SeverityBadge } from '@/components/trust/format'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/EmptyState'
import type { QueueRow } from '@/lib/trust/console'
import { caseLabel, KIND_NOUN, REPORT_REASON_LABEL } from '@/lib/trust/rules'

const VIEWS = [['needs_action', 'Needs action'], ['mine', 'Mine'], ['org', 'Org cases'], ['decided', 'Decided']] as const
const FILTERS = [['severity', 'urgent', 'Urgent'], ['severity', 'high', 'High'], ['source', 'email', 'Email'], ['source', 'legal', 'Legal'],
    ['overdue', '1', 'Overdue'], ['pileon', '1', 'Pile-on'], ['unclaimed', '1', 'Unclaimed']] as const
const FILTER_KEYS = ['q', 'severity', 'kind', 'source', 'overdue', 'pileon', 'unclaimed']

const isTyping = (target: EventTarget | null) => target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))

/** The queue (17.3): toolbar, rows, keyboard (17.13) and bulk "No rule broken". */
export function QueueList({ rows, selected }: { rows: QueueRow[]; selected: number | null }) {
    const router = useRouter()
    const params = useSearchParams()
    const [checked, setChecked] = useState<string[]>([])
    const [help, setHelp] = useState(false)
    const [pending, start] = useTransition()
    const view = params.get('view') ?? 'needs_action'
    const href = (changes: Record<string, string | null>) => {
        const next = new URLSearchParams(params)
        for (const [k, v] of Object.entries(changes)) { if (v === null) next.delete(k); else next.set(k, v) }
        const query = next.toString()
        return query ? `/admin/trust?${query}` : '/admin/trust'
    }
    const filtered = FILTER_KEYS.some((k) => params.get(k))
    const index = rows.findIndex((r) => r.number === selected)

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (isTyping(event.target) || event.metaKey || event.ctrlKey || event.altKey) return
            const go = (i: number) => rows[i] && router.replace(href({ case: caseLabel(rows[i]!.number) }), { scroll: false })
            if (event.key === 'j') go(index < 0 ? 0 : Math.min(rows.length - 1, index + 1))
            else if (event.key === 'k') go(Math.max(0, index - 1))
            else if (event.key === '/') { event.preventDefault(); document.getElementById('queue-search')?.focus() }
            else if (event.key === 'd') { event.preventDefault(); document.getElementById('decision')?.focus() }
            else if (event.key === '?') setHelp(true)
            else if (event.key === 'c' && rows[index]) start(async () => {
                const r = await claimCaseAction(rows[index]!.id, 'claim')
                toast(r.success ? `You're reviewing ${caseLabel(rows[index]!.number)}` : r.error)
            })
            else return
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    })

    const bulkDismiss = () => start(async () => {
        const result = await bulkDecideAction(checked, { outcome: 'no_violation' })
        if (!result.success) return void toast(result.error)
        toast(`${result.done} cases closed · no rule broken${result.failed ? ` · ${result.failed} skipped` : ''}`)
        setChecked([])
    })

    return (
        <section aria-label="Cases" className="min-w-0">
            <div className="space-y-2.5">
                <form action="/admin/trust" className="flex gap-2">
                    {[...params.entries()].filter(([k]) => k !== 'q' && k !== 'case').map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
                    <input id="queue-search" name="q" type="search" defaultValue={params.get('q') ?? ''} placeholder="Search case number, name or @handle"
                        className="h-[34px] w-full rounded-[5px] border border-input bg-card px-3 text-[13px]" />
                </form>
                <div role="group" aria-label="View" className="flex flex-wrap gap-1">
                    {VIEWS.map(([id, label]) => (
                        <Link key={id} href={href({ view: id === 'needs_action' ? null : id, case: null })} aria-current={view === id ? 'true' : undefined}
                            className={`rounded-[5px] px-2.5 py-1.5 text-[13px] font-medium ${view === id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{label}</Link>
                    ))}
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                    {FILTERS.map(([key, value, label]) => {
                        const on = params.get(key) === value
                        return (
                            <Link key={`${key}${value}`} href={href({ [key]: on ? null : value, case: null })} aria-pressed={on}
                                className={`rounded-[4px] border px-2 py-0.5 text-[12px] font-medium ${on ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground hover:text-foreground'}`}>{label}</Link>
                        )
                    })}
                    <select aria-label="Sort" value={params.get('sort') ?? 'deadline'} onChange={(e) => router.replace(href({ sort: e.target.value === 'deadline' ? null : e.target.value }))}
                        className="ml-auto h-[28px] rounded-[5px] border border-input bg-card px-2 text-[12px]">
                        <option value="deadline">Deadline</option><option value="newest">Newest</option><option value="reports">Most reported</option>
                    </select>
                </div>
                {filtered ? <p className="nb-meta">Filtered · <Link href="/admin/trust" className="underline underline-offset-4">Clear filters</Link></p> : null}
                {checked.length ? (
                    <div className="flex items-center gap-2 rounded-[5px] bg-secondary px-3 py-2 text-[13px]">
                        {checked.length} selected
                        <Button size="sm" variant="outline" className="ml-auto" disabled={pending} onClick={bulkDismiss}>No rule broken</Button>
                        <Button size="sm" variant="ghost" onClick={() => setChecked([])}>Clear</Button>
                    </div>
                ) : null}
            </div>
            {rows.length ? (
                <ul className="mt-3 divide-y divide-border border-y border-border">
                    {rows.map((r) => (
                        <li key={r.id} className={`flex gap-2 px-2 py-2.5 ${r.number === selected ? 'bg-secondary' : 'hover:bg-muted/50'}`}>
                            {view !== 'decided' ? (
                                <input type="checkbox" aria-label={`Select ${caseLabel(r.number)}`} className="mt-1" checked={checked.includes(r.id)}
                                    onChange={(e) => setChecked((list) => e.target.checked ? [...list, r.id] : list.filter((id) => id !== r.id))} />
                            ) : null}
                            <Link href={href({ case: caseLabel(r.number) })} scroll={false} aria-current={r.number === selected ? 'true' : undefined} className="min-w-0 flex-1">
                                <span className="flex items-center gap-2">
                                    <SeverityBadge severity={r.severity} />
                                    <span className="nb-meta text-foreground">{caseLabel(r.number)}</span>
                                    <span className="truncate text-[13px] text-muted-foreground">· {REPORT_REASON_LABEL[r.reason]} · {r.reports} {r.reports === 1 ? 'report' : 'reports'}</span>
                                    <span className="ml-auto shrink-0"><Deadline at={r.deadline_at} openedAt={r.created_at} done={view === 'decided'} /></span>
                                </span>
                                <span className="mt-1 flex items-center gap-2">
                                    <span className="truncate text-[13px] font-medium text-foreground" title={r.label ?? ''}>{r.label ?? KIND_NOUN[r.target_kind]}</span>
                                    {r.pile_on ? <span className="nb-status" data-status="draft">pile-on</span> : null}
                                    {r.routed_to === 'org' ? <span className="nb-status" data-status="archived">org</span> : null}
                                    {r.assignee_name ? <span className="ml-auto shrink-0 text-[12px] text-muted-foreground">{r.assignee_name} reviewing</span> : null}
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            ) : filtered ? (
                <EmptyState icon={Inbox} className="mt-4" title="No cases match these filters" action={<Button asChild variant="outline"><Link href="/admin/trust">Clear filters</Link></Button>} />
            ) : (
                <EmptyState icon={Inbox} className="mt-4" title={view === 'decided' ? 'No decided cases yet' : 'No open cases'} description="New reports appear here. Urgent ones also email you." />
            )}
            <Dialog open={help} onOpenChange={setHelp}>
                <DialogContent className="max-w-[380px]">
                    <DialogHeader><DialogTitle>Keyboard shortcuts</DialogTitle></DialogHeader>
                    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13px]">
                        {[['j / k', 'Next and previous case'], ['c', 'Claim the case'], ['d', 'Jump to the decision'], ['/', 'Search'], ['?', 'This list']].map(([k, v]) => (
                            <Fragment key={k}><dt className="nb-meta text-foreground">{k}</dt><dd>{v}</dd></Fragment>
                        ))}
                    </dl>
                </DialogContent>
            </Dialog>
        </section>
    )
}
