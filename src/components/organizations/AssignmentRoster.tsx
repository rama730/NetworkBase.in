'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { MoreHorizontal } from 'lucide-react'

import {
    addAssignmentStepAction, excuseCopyAction, excuseTeamMemberAction, extendCopiesAction, extendCopyAction, giveCopyAction, moveTeamMemberAction,
    readAssignmentRosterAction, remindCopiesAction, removeCopyAction, returnCopiesAction, reviewAssignmentCopyAction, type AssignmentRow, type RosterRow,
} from '@/app/actions/assignments'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { DownloadLink } from '@/components/ui/download-link'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { ExcuseDialog, ExtendDialog, GiveToDialog, ReturnDialog } from '@/components/organizations/AssignmentDialogs'
import { ReasonDialog } from '@/components/organizations/ReasonDialog'
import { filterRoster, remindSkips, rosterSections, rosterTiles } from '@/lib/organizations/assignment-rules'
import { ASSIGNMENT_STATE_LABELS } from '@/lib/copy/terms'
import { remindSummary } from '@/lib/organizations/member-rules'
import { toast } from '@/lib/feedback'
import { formatDistanceToNow } from '@/lib/utils/date'
import { cn } from '@/lib/utils'

// Review UX phase 2 (Board artboard, findings 1.1–1.6, 1.14, 5.5, 6.2): the whole class in the Assignment tab —
// tiles that filter, search and sort, everyone in sections by state, each row's own actions, and the bulk tools
// that used to live in the Full roster window.

const WHEN = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
type Tile = 'all' | 'done' | 'submitted' | 'notIn' | 'excused'
const TILE_SECTIONS: Record<Tile, string[] | null> = { all: null, done: ['approved', 'done'], submitted: ['submitted'], notIn: ['returned', 'in_progress', 'not_started', 'missing'], excused: ['excused'] }
type Ask = { kind: 'return' | 'change' | 'extend' | 'excuse' | 'remove'; row: RosterRow } | { kind: 'give' | 'bulk-return' | 'bulk-extend' } | null

/** What a row says under the name: when it came in, which version, late; or the reminder, reason or last change. */
function detail(r: RosterRow) {
    if (r.state === 'submitted' || r.state === 'done') return [r.submittedAt ? WHEN.format(new Date(r.submittedAt)) : null, r.version ? `Version ${r.version}` : null, r.late ? 'Late' : null, r.submittedBy ? `by ${r.submittedBy}` : null].filter(Boolean).join(' · ')
    if (r.state === 'excused') return r.excusedReason ?? 'Excused'
    return [ASSIGNMENT_STATE_LABELS[r.state], r.remindedAt ? `Reminded ${formatDistanceToNow(new Date(r.remindedAt), { addSuffix: true })}` : `Changed ${formatDistanceToNow(new Date(r.updatedAt), { addSuffix: true })}`].join(' · ')
}

export function AssignmentRoster({ row, orgId, timeZone, onChanged, onExport }: { row: AssignmentRow; orgId: string; timeZone: string | null; onChanged: () => void; onExport: () => void }) {
    const [rows, setRows] = useState<RosterRow[]>([])
    const [withoutCopy, setWithoutCopy] = useState<Array<{ userId: string; name: string }>>([])
    const [closed, setClosed] = useState(false)
    const [tile, setTile] = useState<Tile>('all')
    const [query, setQuery] = useState('')
    const [sort, setSort] = useState<'name' | 'handedIn'>('name')
    const [lateOnly, setLateOnly] = useState(false)
    const [picked, setPicked] = useState<Set<string>>(new Set())
    const [ask, setAsk] = useState<Ask>(null)
    const [teamExcuse, setTeamExcuse] = useState<{ copyId: string; userId: string; name: string } | null>(null)
    const [step, setStep] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const load = useCallback(() => void readAssignmentRosterAction(row.masterId).then((r) => { if (r.success) { setRows(r.rows); setWithoutCopy(r.withoutCopy); setClosed(r.closed) } }), [row.masterId])
    // The tiles' counts change when work is decided anywhere (the queue, a copy); the lists follow them.
    const countsKey = JSON.stringify(row.counts)
    useEffect(() => { load() }, [load, countsKey])
    const run = (action: () => Promise<{ success: boolean; error?: string }>, done?: string) => startTransition(async () => {
        const result = await action()
        setError(result.success ? null : result.error ?? 'Something went wrong.')
        if (result.success && done) toast.success(done)
        load()
        onChanged()
    })
    const tiles = rosterTiles(row.counts)
    const sections = useMemo(() => rosterSections(filterRoster(rows, { query, lateOnly }), sort).filter((s) => !TILE_SECTIONS[tile] || TILE_SECTIONS[tile]!.includes(s.key)), [rows, query, lateOnly, sort, tile])
    const skips = remindSkips(rows)
    const copyHref = (r: RosterRow) => `?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(r.copyId)}`
    const remindAll = () => startTransition(async () => {
        const r = await remindCopiesAction(row.masterId, picked.size ? [...picked] : undefined)
        if (r.success) toast.success(remindSummary(r)); else setError(r.error)
        load()
    })
    const tileButton = (key: Exclude<Tile, 'all'>, n: number, label: string, tone: string) => (
        <button type="button" aria-label={`${n} ${label}`} aria-pressed={tile === key} onClick={() => setTile(tile === key ? 'all' : key)}
            className={cn('rounded-[5px] p-2.5 text-left', tone, tile === key && 'outline outline-1 outline-current')}>
            <span className="block text-[20px] font-semibold leading-tight">{n}</span>
            <span className="block font-mono text-[12px] text-muted-foreground">{label}</span>
        </button>
    )
    const actions = (r: RosterRow) => {
        const open = <Button asChild size="sm" variant="outline"><a href={copyHref(r)} aria-label={`Open ${r.label}`}>Open</a></Button>
        const more = (
            <DropdownMenu>
                <DropdownMenuTrigger asChild><Button type="button" size="sm" variant="ghost" aria-label={`More for ${r.label}`}><MoreHorizontal className="size-4" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {r.state !== 'done' && r.state !== 'excused' && r.state !== 'submitted' ? <DropdownMenuItem onSelect={() => run(async () => { const res = await remindCopiesAction(row.masterId, [r.copyId]); if (res.success) toast.success(remindSummary(res)); return res.success ? { success: true } : res })}>Remind</DropdownMenuItem> : null}
                    {r.state !== 'done' && r.state !== 'excused' ? <DropdownMenuItem onSelect={() => setAsk({ kind: 'extend', row: r })}>Extend</DropdownMenuItem> : null}
                    {r.approved && !closed ? <DropdownMenuItem onSelect={() => setAsk({ kind: 'change', row: r })}>Change decision</DropdownMenuItem> : null}
                    {r.state === 'excused' ? <DropdownMenuItem onSelect={() => run(() => excuseCopyAction(r.copyId, null))}>Un-excuse</DropdownMenuItem> : <DropdownMenuItem onSelect={() => setAsk({ kind: 'excuse', row: r })}>Excuse</DropdownMenuItem>}
                    {r.state === 'not_started' && !r.submission ? <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setAsk({ kind: 'remove', row: r })}>Remove</DropdownMenuItem> : null}
                </DropdownMenuContent>
            </DropdownMenu>
        )
        if (r.state === 'submitted') return <>{open}<Button type="button" size="sm" variant="outline" aria-label={`Return ${r.label}`} disabled={pending} onClick={() => setAsk({ kind: 'return', row: r })}>Return</Button><Button type="button" size="sm" aria-label={`Approve ${r.label}`} disabled={pending} onClick={() => run(() => reviewAssignmentCopyAction(r.copyId, 'approve'), `Approved ${r.label}’s ${row.title}.`)}>Approve</Button>{more}</>
        if (r.state === 'done' || r.state === 'excused') return <>{open}{more}</>
        return <>{open}<Button type="button" size="sm" variant="outline" aria-label={`Extend ${r.label}`} disabled={pending} onClick={() => setAsk({ kind: 'extend', row: r })}>Extend</Button>{more}</>
    }
    const moveable = rows.filter((o) => o.people && o.state !== 'submitted' && o.state !== 'done')
    return (
        <div className="space-y-4">
            <div role="group" aria-label="Class at a glance" className="grid grid-cols-4 gap-2 max-sm:grid-cols-2">
                {tileButton('done', tiles.done, 'Done', 'bg-[var(--status-success-soft)] text-[var(--status-success)]')}
                {tileButton('submitted', tiles.submitted, 'Submitted', 'bg-[var(--status-warning-soft)] text-[var(--status-warning)]')}
                {tileButton('notIn', tiles.notIn, 'Not in', 'bg-[var(--status-danger-soft)] text-[var(--status-danger)]')}
                {tileButton('excused', tiles.excused, 'Excused', 'bg-muted text-foreground')}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                {tiles.submitted > 0 ? <Button asChild size="sm"><a href={`?tab=tasks&taskScope=review&assignment=${encodeURIComponent(row.masterId)}`}>Review {tiles.submitted}</a></Button> : null}
                {tiles.notIn > 0 ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={remindAll}>Remind {picked.size || tiles.notIn - skips}</Button> : null}
                {row.submissionType === 'file' && tiles.submitted + tiles.done > 0 ? <Button asChild size="sm" variant="outline"><DownloadLink href={`/api/v1/workspaces/${orgId}/tasks/${row.masterId}/submissions`}>Download all</DownloadLink></Button> : null}
                <Button type="button" size="sm" variant="outline" onClick={onExport}>Export</Button>
                {withoutCopy.length ? <Button type="button" size="sm" variant="ghost" disabled={pending} onClick={() => setAsk({ kind: 'give' })}>Give to…</Button> : null}
            </div>
            {/* Decision 60, finding 1.14: say who Remind skips before the click, not after. */}
            {skips > 0 && tiles.notIn > 0 ? <p className="text-[12px] text-muted-foreground">{skips} {skips === 1 ? 'person was' : 'people were'} reminded in the last 12 hours and won’t be reminded again yet.</p> : null}
            <div className="flex flex-wrap items-center gap-2">
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search people" aria-label="Search people" className="h-8 min-w-0 flex-1 basis-40" />
                <select aria-label="Sort people" value={sort} onChange={(e) => setSort(e.target.value as 'name' | 'handedIn')} className="h-8 rounded-md border border-input bg-background px-2 text-xs">
                    <option value="name">Name</option>
                    <option value="handedIn">Handed in first</option>
                </select>
                <label className="flex items-center gap-1.5 text-xs"><input type="checkbox" checked={lateOnly} onChange={(e) => setLateOnly(e.target.checked)} /> Late only</label>
            </div>
            {picked.size ? (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-muted/30 p-2 text-sm" role="group" aria-label="Selected">
                    <span className="font-medium">{picked.size} selected</span>
                    <Button type="button" size="sm" disabled={pending} onClick={() => run(async () => {
                        let approved = 0
                        for (const id of picked) if (rows.find((r) => r.copyId === id)?.state === 'submitted' && (await reviewAssignmentCopyAction(id, 'approve')).success) approved += 1
                        toast.success(`Approved ${approved}. Each person is told.`)
                        setPicked(new Set())
                        return { success: true }
                    })}>Approve selected</Button>
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setAsk({ kind: 'bulk-return' })}>Return selected</Button>
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => setAsk({ kind: 'bulk-extend' })}>Extend for {picked.size}</Button>
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={remindAll}>Remind selected</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setPicked(new Set())}>Clear</Button>
                </div>
            ) : null}
            {sections.length ? sections.map((section) => (
                <section key={section.key} aria-labelledby={`roster-${section.key}`}>
                    <h4 id={`roster-${section.key}`} className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">{section.title} · {section.rows.length}</h4>
                    <ul aria-labelledby={`roster-${section.key}`}>
                        {section.rows.map((r) => (
                            <li key={r.copyId} className="border-t border-border py-2.5 first:border-t-0">
                                <div className="flex flex-wrap items-center gap-2.5">
                                    <input type="checkbox" aria-label={`Select ${r.label}`} checked={picked.has(r.copyId)} onChange={(e) => setPicked((cur) => { const next = new Set(cur); if (e.target.checked) next.add(r.copyId); else next.delete(r.copyId); return next })} />
                                    <UserAvatar identity={{ id: r.userId ?? r.copyId, fullName: r.label, username: null, avatarUrl: r.avatarUrl }} size={28} roundedClassName="rounded-full" />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-[13px] font-medium">{r.label}</span>
                                        <span className="block truncate font-mono text-[12px] text-muted-foreground">{detail(r)}</span>
                                        {/* Finding 6.2: a team row shows its people, ★ the lead. */}
                                        {r.people?.length ? <span className="block truncate text-[12px] text-muted-foreground">{r.people.map((p) => `${p.name}${p.lead ? ' ★' : ''}`).join(' · ')}</span> : null}
                                    </span>
                                    <span className="flex shrink-0 flex-wrap justify-end gap-1 max-sm:w-full">{actions(r)}</span>
                                </div>
                                {r.people?.length && r.state !== 'submitted' && r.state !== 'done' ? (
                                    <div className="mt-1.5 flex flex-wrap gap-2 pl-10 text-xs">
                                        {r.people.map((p) => (
                                            <select key={p.id} value="" aria-label={`Move ${p.name} to…`} className="h-7 rounded border border-border bg-background px-1 text-xs" disabled={pending}
                                                onChange={(e) => { const v = e.target.value; if (!v) return; if (v === 'excuse') { setTeamExcuse({ copyId: r.copyId, userId: p.id, name: p.name }); return } run(() => moveTeamMemberAction(row.masterId, p.id, v === 'own' ? null : v)) }}>
                                                <option value="">{p.name}…</option>
                                                {moveable.filter((o) => o.copyId !== r.copyId).map((o) => <option key={o.copyId} value={o.copyId}>Move to {o.label}</option>)}
                                                <option value="own">Own assignment</option>
                                                <option value="excuse">Excuse {p.name}</option>
                                            </select>
                                        ))}
                                    </div>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                </section>
            )) : <p className="text-[13px] text-muted-foreground">{rows.length ? 'Nobody matches.' : 'Nobody has this yet.'}</p>}
            {/* Report §25.7, decision 47: late joiners on group work, with Add to group or Own copy. */}
            {row.teams && withoutCopy.length ? (
                <section aria-labelledby="roster-no-group" className="space-y-1 text-sm">
                    <h4 id="roster-no-group" className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">Not in a group · {withoutCopy.length}</h4>
                    <ul className="space-y-1">
                        {withoutCopy.map((p) => (
                            <li key={p.userId} className="flex flex-wrap items-center gap-2">
                                {p.name}
                                <select value="" aria-label={`Add ${p.name} to a group`} className="h-7 rounded border border-border bg-background px-1 text-xs" disabled={pending}
                                    onChange={(e) => { const v = e.target.value; if (v) run(() => moveTeamMemberAction(row.masterId, p.userId, v === 'own' ? null : v)) }}>
                                    <option value="">Add to group…</option>
                                    {moveable.map((o) => <option key={o.copyId} value={o.copyId}>{o.label}</option>)}
                                    <option value="own">Own copy</option>
                                </select>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
            <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); const value = step.trim(); if (value) run(async () => { const r = await addAssignmentStepAction(row.masterId, value); if (r.success) setStep(''); return r }, `Added “${value}” to every copy.`) }}>
                <Input value={step} onChange={(e) => setStep(e.target.value)} placeholder="Add a step to every copy" maxLength={200} aria-label="Add a step to every copy" className="h-8" />
                <Button type="submit" size="sm" variant="outline" disabled={pending || !step.trim()}>Add step</Button>
            </form>
            {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            <ReturnDialog timeZone={timeZone} label={ask && 'row' in ask ? ask.row.label : ''} change={ask?.kind === 'change'} open={ask?.kind === 'return' || ask?.kind === 'change'} onClose={() => setAsk(null)}
                onReturn={(reason, fixBy) => { if (ask && 'row' in ask) { const { copyId, label } = ask.row; const change = ask.kind === 'change'; run(() => reviewAssignmentCopyAction(copyId, 'return', reason, undefined, { fixBy, change }), `Returned ${row.title} to ${label}.`) } }} />
            <ExtendDialog timeZone={timeZone} label={ask && 'row' in ask ? ask.row.label : ''} currentDue={ask && 'row' in ask ? ask.row.dueDate : null} closed={closed} open={ask?.kind === 'extend'} onClose={() => setAsk(null)}
                onExtend={(due, reopen) => { if (ask && 'row' in ask) { const copyId = ask.row.copyId; run(() => extendCopyAction(copyId, due, { reopen })) } }} />
            <ExcuseDialog label={ask && 'row' in ask ? ask.row.label : ''} open={ask?.kind === 'excuse'} onClose={() => setAsk(null)}
                onExcuse={(reason) => { if (ask && 'row' in ask) { const copyId = ask.row.copyId; run(() => excuseCopyAction(copyId, reason)) } }} />
            <GiveToDialog timeZone={timeZone} people={withoutCopy} open={ask?.kind === 'give'} onClose={() => setAsk(null)} onGive={(userId, due) => run(() => giveCopyAction(row.masterId, userId, due))} />
            <ReturnDialog timeZone={timeZone} label={`${picked.size} people`} open={ask?.kind === 'bulk-return'} onClose={() => setAsk(null)}
                onReturn={(reason, fixBy) => run(async () => { const r = await returnCopiesAction([...picked], reason, fixBy); if (r.success) { toast.success(`Returned ${r.returned}${r.skipped ? `. ${r.skipped} weren’t waiting for review.` : '.'}`); setPicked(new Set()) } return r })} />
            <ExtendDialog timeZone={timeZone} label={`${picked.size} people`} currentDue={row.dueDate} closed={closed} open={ask?.kind === 'bulk-extend'} onClose={() => setAsk(null)}
                onExtend={(due, reopen) => run(async () => { const r = await extendCopiesAction([...picked], due, { reopen }); if (r.success) setPicked(new Set()); return r })} />
            <ConfirmDialog open={ask?.kind === 'remove'} onOpenChange={(v) => { if (!v) setAsk(null) }} variant="destructive"
                title={`Remove ${ask && 'row' in ask ? ask.row.label : ''}’s copy?`} description="They haven’t started it. It leaves their list, and they’re told."
                confirmLabel="Remove" onConfirm={() => { if (ask && 'row' in ask) { const copyId = ask.row.copyId; run(() => removeCopyAction(copyId)) } setAsk(null) }} />
            <ReasonDialog open={Boolean(teamExcuse)} onOpenChange={(v) => { if (!v) setTeamExcuse(null) }} title={`Excuse ${teamExcuse?.name ?? ''}?`}
                label={`Why is ${teamExcuse?.name ?? 'this person'} excused?`} confirmLabel="Excuse" required
                onConfirm={(reason) => { if (teamExcuse) run(() => excuseTeamMemberAction(teamExcuse.copyId, teamExcuse.userId, reason)) }} />
        </div>
    )
}
