'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import { MoreHorizontal } from 'lucide-react'

import { excuseCopyAction, extendCopyAction, readAssignmentRosterAction, remindCopiesAction, removeCopyAction, reviewAssignmentCopyAction, type AssignmentRow, type RosterRow } from '@/app/actions/assignments'
import { Button } from '@/components/ui/button'
import { DownloadLink } from '@/components/ui/download-link'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ExcuseDialog, ExtendDialog } from '@/components/organizations/AssignmentDialogs'
import { rosterTiles } from '@/lib/organizations/assignment-rules'
import { ASSIGNMENT_STATE_LABELS } from '@/lib/copy/terms'
import { remindSummary } from '@/lib/organizations/member-rules'
import { toast } from '@/lib/feedback'
import { formatDistanceToNow } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

// Mockup task 1 (Board artboard): the class at a glance in the assignment's own panel — four tiles that filter, the
// actions, then who is waiting for review and who is not in yet. The full Roster window keeps the bulk tools.

const WHEN = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('')
type Filter = 'all' | 'done' | 'submitted' | 'notIn' | 'excused'
const NOT_IN = new Set(['not_started', 'in_progress', 'returned', 'missing'])

function Person({ row, detail, children }: { row: RosterRow; detail: string; children: React.ReactNode }) {
    return (
        <li className="flex items-center gap-2.5 border-t border-border py-2.5 first:border-t-0">
            <span aria-hidden="true" className="flex size-6 flex-none items-center justify-center rounded-full bg-muted font-mono text-[9px] font-semibold">{initials(row.label)}</span>
            <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px] font-medium">{row.label}</span>
                <span className="block font-mono text-[12px] text-muted-foreground">{detail}</span>
            </span>
            {children}
        </li>
    )
}

export function AssignmentGlance({ row, orgId, timeZone, onChanged, onFullRoster, onExport }: { row: AssignmentRow; orgId: string; timeZone: string | null; onChanged: () => void; onFullRoster: () => void; onExport: () => void }) {
    const [rows, setRows] = useState<RosterRow[]>([])
    const [filter, setFilter] = useState<Filter>('all')
    const [ask, setAsk] = useState<{ kind: 'extend' | 'excuse'; row: RosterRow } | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const load = useCallback(() => void readAssignmentRosterAction(row.masterId).then((r) => { if (r.success) setRows(r.rows) }), [row.masterId])
    useEffect(() => { load() }, [load])
    const run = (action: () => Promise<{ success: boolean; error?: string }>, done?: string) => startTransition(async () => {
        const result = await action()
        setError(result.success ? null : result.error ?? 'Something went wrong.')
        if (result.success && done) toast.success(done)
        load()
        onChanged()
    })
    const tiles = rosterTiles(row.counts)
    const waiting = rows.filter((r) => r.state === 'submitted')
    const notIn = rows.filter((r) => NOT_IN.has(r.state))
    const shown = (f: Filter) => filter === 'all' || filter === f
    const tile = (key: Exclude<Filter, 'all'>, n: number, label: string, tone: string) => (
        <button type="button" aria-label={`${n} ${label}`} aria-pressed={filter === key} onClick={() => setFilter(filter === key ? 'all' : key)}
            className={cn('rounded-[5px] p-2 text-left', tone, filter === key && 'outline outline-1 outline-current')}>
            <span className="block text-[17px] font-semibold">{n}</span>
            <span className="block font-mono text-[12px] text-muted-foreground">{label}</span>
        </button>
    )
    return (
        <div className="space-y-3">
            <div role="group" aria-label="Class at a glance" className="grid grid-cols-4 gap-2 max-sm:grid-cols-2">
                {tile('done', tiles.done, 'Done', 'bg-[var(--status-success-soft)] text-[var(--status-success)]')}
                {tile('submitted', tiles.submitted, 'Submitted', 'bg-[var(--status-warning-soft)] text-[var(--status-warning)]')}
                {tile('notIn', tiles.notIn, 'Not in', 'bg-[var(--status-danger-soft)] text-[var(--status-danger)]')}
                {tile('excused', tiles.excused, 'Excused', 'bg-muted text-foreground')}
            </div>
            <div className="flex flex-wrap gap-1.5">
                {tiles.submitted > 0 ? <Button asChild size="sm"><a href={`?tab=tasks&taskScope=review&assignment=${encodeURIComponent(row.masterId)}`}>Review {tiles.submitted}</a></Button> : null}
                {tiles.notIn > 0 ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => startTransition(async () => {
                    const r = await remindCopiesAction(row.masterId)
                    if (r.success) toast.success(remindSummary(r)); else setError(r.error)
                    load()
                })}>Remind {tiles.notIn}</Button> : null}
                {row.submissionType === 'file' && tiles.submitted + tiles.done > 0 ? <Button asChild size="sm" variant="outline"><DownloadLink href={`/api/v1/workspaces/${orgId}/tasks/${row.masterId}/submissions`}>Download all</DownloadLink></Button> : null}
                <Button type="button" size="sm" variant="outline" onClick={onExport}>Export</Button>
                <Button type="button" size="sm" variant="ghost" onClick={onFullRoster}>Full roster</Button>
            </div>
            {shown('submitted') ? (
                <div>
                    <p className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">Waiting for review</p>
                    {waiting.length ? (
                        <ul aria-label="Waiting for review">
                            {waiting.map((r) => (
                                <Person key={r.copyId} row={r} detail={[r.submittedAt ? WHEN.format(new Date(r.submittedAt)) : null, r.version ? `Version ${r.version}` : null, r.late ? 'Late' : null].filter(Boolean).join(' · ')}>
                                    <Button asChild size="sm" variant="outline"><a href={`?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(r.copyId)}`} aria-label={`Open ${r.label}`}>Open</a></Button>
                                    <Button type="button" size="sm" aria-label={`Approve ${r.label}`} disabled={pending} onClick={() => run(() => reviewAssignmentCopyAction(r.copyId, 'approve'), `Approved ${r.label}’s ${row.title}.`)}>Approve</Button>
                                </Person>
                            ))}
                        </ul>
                    ) : <p className="py-2 text-[13px] text-muted-foreground">Nobody’s waiting.</p>}
                </div>
            ) : null}
            {shown('notIn') ? (
                <div>
                    <p className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">Not in yet</p>
                    {notIn.length ? (
                        <ul aria-label="Not in yet">
                            {notIn.map((r) => (
                                <Person key={r.copyId} row={r} detail={[ASSIGNMENT_STATE_LABELS[r.state], r.remindedAt ? `Reminded ${formatDistanceToNow(new Date(r.remindedAt), { addSuffix: true })}` : null].filter(Boolean).join(' · ')}>
                                    <Button type="button" size="sm" variant="outline" aria-label={`Extend ${r.label}`} disabled={pending} onClick={() => setAsk({ kind: 'extend', row: r })}>Extend</Button>
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild><Button type="button" size="sm" variant="ghost" aria-label={`More for ${r.label}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                                        <DropdownMenuContent align="end">
                                            <DropdownMenuItem onSelect={() => run(async () => { const res = await remindCopiesAction(row.masterId, [r.copyId]); if (res.success) toast.success(remindSummary(res)); return res.success ? { success: true } : res })}>Remind</DropdownMenuItem>
                                            <DropdownMenuItem onSelect={() => setAsk({ kind: 'excuse', row: r })}>Excuse</DropdownMenuItem>
                                            {r.state === 'not_started' && !r.submission ? <DropdownMenuItem onSelect={() => run(() => removeCopyAction(r.copyId))}>Remove</DropdownMenuItem> : null}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                </Person>
                            ))}
                        </ul>
                    ) : <p className="py-2 text-[13px] text-muted-foreground">Everyone’s in.</p>}
                </div>
            ) : null}
            {filter === 'done' || filter === 'excused' ? (
                <ul aria-label={filter === 'done' ? 'Done' : 'Excused'}>
                    {rows.filter((r) => r.state === filter).map((r) => <Person key={r.copyId} row={r} detail={r.state === 'excused' ? r.excusedReason ?? 'Excused' : r.version ? `Version ${r.version}` : 'Done'}>{null}</Person>)}
                </ul>
            ) : null}
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <ExtendDialog timeZone={timeZone} label={ask?.row.label ?? ''} currentDue={ask?.row.dueDate ?? null} closed={false} open={ask?.kind === 'extend'} onClose={() => setAsk(null)}
                onExtend={(due, reopen) => { if (ask) { const copyId = ask.row.copyId; run(() => extendCopyAction(copyId, due, { reopen })) } }} />
            <ExcuseDialog label={ask?.row.label ?? ''} open={ask?.kind === 'excuse'} onClose={() => setAsk(null)}
                onExcuse={(reason) => { if (ask) { const copyId = ask.row.copyId; run(() => excuseCopyAction(copyId, reason)) } }} />
        </div>
    )
}
