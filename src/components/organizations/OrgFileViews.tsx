'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ChevronDown } from 'lucide-react'

import {
    readChildFinalFilesAction,
    readHandInFilesAction,
    readOrgSprintMaterialsAction,
    readOrgSubmissionsAction,
    type BrowserFile,
    type ChildFinalFileRow,
    type SprintMaterialsGroup,
    type SubmissionGroup,
    type SubmissionRow,
} from '@/app/actions/org-files'
import { Badge, BrowserEmpty, BrowserHeader, BrowserRow, BrowserTable, FileRows, FilterBar, FolderListHeader, OpenFile, useBrowserPlace, type Crumb } from '@/components/organizations/OrgFileBrowser'
import { Button } from '@/components/ui/button'
import { DownloadLink } from '@/components/ui/download-link'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { assignmentHref } from '@/lib/organizations/assignment-rules'
import { Notice } from '@/components/ui/notice'
import { readUrlParam, useUrlMirror } from '@/lib/navigation/url-state'

// Files report §1–§2: Submissions, Sprint materials and a team's Final files, browsed the Task files way.

type OrgRef = { orgId: string; slug: string | null; isAdmin: boolean }
const orgPath = (org: Pick<OrgRef, 'orgId' | 'slug'>) => `/org/${encodeURIComponent(org.slug ?? org.orgId)}`
const filesCount = (n: number) => `${n} ${n === 1 ? 'file' : 'files'}`
const latest = <T,>(rows: T[], at: (r: T) => string | null) => rows.reduce<T | null>((best, r) => (at(r) && (!best || at(r)! > at(best)!) ? r : best), null)
const zipHref = (orgId: string, masterId: string) => `/api/v1/workspaces/${orgId}/tasks/${masterId}/submissions`
const shell = 'flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden'
const list = 'min-h-0 flex-1 overflow-y-auto'

// ---------------------------------------------------------------- Submissions

type Status = 'all' | 'review' | 'returned' | 'approved' | 'late'
const STATUS: ReadonlyArray<{ id: Status; label: string; test: (r: SubmissionRow) => boolean }> = [
    { id: 'all', label: 'All', test: () => true },
    { id: 'review', label: 'In review', test: (r) => r.status === 'In review' },
    { id: 'returned', label: 'Returned', test: (r) => r.status === 'Returned' },
    { id: 'approved', label: 'Approved', test: (r) => r.status === 'Approved' || r.status === 'Done' },
    { id: 'late', label: 'Late', test: (r) => r.late },
]
const statusTone = (s: string) => (s === 'In review' ? 'warning' : s === 'Approved' || s === 'Done' ? 'success' : s === 'Returned' || s === 'Missing' ? 'danger' : 'muted') as 'warning' | 'success' | 'danger' | 'muted'

export function SubmissionsBrowser({ org }: { org: OrgRef }) {
    const [data, setData] = useState<SubmissionGroup[] | null>(null)
    const [status, setStatus] = useState<Status>(() => { const s = readUrlParam('ofstatus'); return STATUS.find((x) => x.id === s)?.id ?? 'all' })
    const [query, setQuery] = useState(() => readUrlParam('ofq') ?? '')
    const [only, setOnly] = useState(() => readUrlParam('ofonly') ?? '')
    const [sort, setSort] = useState<'name' | 'updated' | 'size'>(() => { const s = readUrlParam('ofsort'); return s === 'name' || s === 'size' ? s : 'updated' })
    const [dir, setDir] = useState<'asc' | 'desc'>(() => (readUrlParam('ofdir') === 'asc' ? 'asc' : 'desc'))
    // The view lives in the address (unified back R3).
    useUrlMirror({ ofstatus: status !== 'all' ? status : null, ofq: query || null, ofonly: only || null, ofsort: sort !== 'updated' ? sort : null, ofdir: dir !== 'desc' ? dir : null })
    const { place, go } = useBrowserPlace(['assignment', 'copy', 'version', 'file'] as const)
    const [truncated, setTruncated] = useState(false)
    useEffect(() => { void readOrgSubmissionsAction(org.orgId).then((r) => { setData(r.success ? r.assignments : []); setTruncated(r.success && r.truncated) }) }, [org.orgId])
    const matches = (r: SubmissionRow) => STATUS.find((s) => s.id === status)!.test(r) && (!query.trim() || `${r.who} ${r.by ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()))
    const allRows = useMemo(() => (data ?? []).flatMap((g) => g.rows), [data])
    const pills = STATUS.map((s) => ({ id: s.id, label: s.label, count: allRows.filter(s.test).length }))
    const onSort = (c: 'name' | 'updated' | 'size') => { if (c === sort) setDir(dir === 'asc' ? 'desc' : 'asc'); else { setSort(c); setDir(c === 'name' ? 'asc' : 'desc') } }
    const order = <T,>(rows: T[], name: (r: T) => string, at: (r: T) => string | null, size: (r: T) => number) => [...rows].sort((a, b) => {
        const d = sort === 'name' ? name(a).localeCompare(name(b)) : sort === 'size' ? size(a) - size(b) : (at(a) ?? '').localeCompare(at(b) ?? '')
        return dir === 'asc' ? d : -d
    })
    if (!data) return <div className="nb-skeleton m-4 h-24 rounded-md" aria-label="Loading submissions" />
    const group = data.find((g) => g.id === place.assignment) ?? null
    const row = group?.rows.find((r) => r.copyId === place.copy) ?? null
    const home = { label: 'Submissions', onClick: () => go({ assignment: null, copy: null, version: null, file: null }) }
    const crumbs: Crumb[] = [home]
    if (group) crumbs.push({ label: group.title, onClick: () => go({ copy: null, version: null, file: null }) })
    if (row) crumbs.push({ label: row.who, onClick: () => go({ version: null, file: null }) })
    if (row && place.version) crumbs.push({ label: `Version ${place.version}`, onClick: () => go({ file: null }) })
    const downloadAll = group
        ? (group.rows.some((r) => r.files > 0) ? <Button asChild size="sm" variant="outline"><DownloadLink href={zipHref(org.orgId, group.id)}>Download all</DownloadLink></Button> : null)
        : data.some((g) => g.rows.some((r) => r.files > 0)) ? (
            <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild><Button type="button" size="sm" variant="outline">Download all<ChevronDown className="size-3.5" aria-hidden="true" /></Button></DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {data.filter((g) => g.rows.some((r) => r.files > 0)).map((g) => <DropdownMenuItem key={g.id} asChild><DownloadLink href={zipHref(org.orgId, g.id)}>{g.title}</DownloadLink></DropdownMenuItem>)}
                </DropdownMenuContent>
            </DropdownMenu>
        ) : null
    return (
        <div className={shell} data-testid="org-submissions">
            <BrowserHeader crumbs={crumbs} actions={downloadAll} />
            {/* Audit 10.3: say when older assignments aren't listed, rather than cutting one off silently. */}
            {truncated && !place.assignment ? <Notice className="mx-4 mt-3">The newest assignments are listed. Older ones are in each assignment’s Tasks roster.</Notice> : null}
            {row ? <HandIn org={org} row={row} masterId={group!.id} version={place.version} file={place.file} go={go} /> : (
                <>
                    <FilterBar pills={pills} value={status} onChange={setStatus} query={query} onQuery={setQuery} placeholder="Filter people…"
                        extra={group ? null : (
                            <select aria-label="Assignment" value={only} onChange={(e) => setOnly(e.target.value)}
                                className="nb-select max-w-[12rem]" data-size="sm">
                                <option value="">All assignments</option>
                                {data.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
                            </select>
                        )} />
                    <BrowserTable label="Files listing">
                    <FolderListHeader sort={sort} sortDirection={dir} onSort={onSort} updatedLabel="Handed in" sizeLabel="Files" byLabel="By" />
                    <div role="rowgroup" className={list}>
                        {data.length === 0 ? <BrowserEmpty title="Nothing handed in yet" body="Work handed in for assignments shows here." /> : group ? (() => {
                            const rows = order(group.rows.filter(matches), (r) => r.who, (r) => r.submittedAt, (r) => r.files)
                            return rows.length === 0 ? <BrowserEmpty title="No hand-ins match these filters" action={<Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => { setStatus('all'); setQuery('') }}>Clear filters</Button>} />
                                : rows.map((r) => (
                                    <BrowserRow key={r.copyId} folder name={r.who} label={`${r.who}, ${r.status}${r.late ? ', late' : ''}`} updated={r.submittedAt} size={filesCount(r.files)} by={r.by ?? (r.team ? null : r.who)} byAvatarUrl={r.avatarUrl}
                                        onOpen={() => go({ copy: r.copyId, version: null, file: null })}
                                        badges={<>{r.version ? <Badge>v{r.version}</Badge> : null}<Badge tone={statusTone(r.status)}>{r.status}</Badge>{r.late ? <Badge tone="danger">Late</Badge> : null}</>}
                                        menu={<>
                                            <DropdownMenuItem asChild><Link href={`${orgPath(org)}?tab=tasks&taskScope=review&assignment=${group.id}&review=${r.copyId}`}>Open in review</Link></DropdownMenuItem>
                                            <DropdownMenuItem asChild><Link href={assignmentHref(orgPath(org), r.copyId)}>Open the hand-in</Link></DropdownMenuItem>
                                        </>} />
                                ))
                        })() : (() => {
                            const groups = order(data.filter((g) => (!only || g.id === only) && g.rows.some(matches)), (g) => g.title, (g) => latest(g.rows, (r) => r.submittedAt)?.submittedAt ?? null, (g) => g.rows.reduce((n, r) => n + r.files, 0))
                            return groups.length === 0 ? <BrowserEmpty title="No hand-ins match these filters" action={<Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => { setStatus('all'); setQuery(''); setOnly('') }}>Clear filters</Button>} />
                                : groups.map((g) => {
                                    const last = latest(g.rows, (r) => r.submittedAt)
                                    const waiting = g.rows.filter((r) => r.status === 'In review').length
                                    const allApproved = g.rows.length > 0 && g.rows.every((r) => r.status === 'Approved' || r.status === 'Done' || r.status === 'Excused')
                                    return (
                                        <BrowserRow key={g.id} folder name={g.title} updated={last?.submittedAt ?? null} size={filesCount(g.rows.reduce((n, r) => n + r.files, 0))} by={last ? last.by ?? last.who : null} byAvatarUrl={last?.avatarUrl}
                                            onOpen={() => go({ assignment: g.id, copy: null, version: null, file: null })}
                                            badges={g.closed ? <Badge>Closed</Badge> : waiting ? <Badge tone="warning">{waiting} to review</Badge> : allApproved ? <Badge tone="success">All {g.reviewRequired ? 'approved' : 'done'}</Badge> : null}
                                            menu={<>
                                                {g.rows.some((r) => r.files > 0) ? <DropdownMenuItem asChild><DownloadLink href={zipHref(org.orgId, g.id)}>Download all</DownloadLink></DropdownMenuItem> : null}
                                                <DropdownMenuItem asChild><Link href={assignmentHref(orgPath(org), g.id)}>Open in Tasks</Link></DropdownMenuItem>
                                            </>} />
                                    )
                                })
                        })()}
                    </div>
                    </BrowserTable>
                </>
            )}
        </div>
    )
}

/** Level 3 (and 4): a person's handed-in files, earlier versions as folders (D3), and a file in the shared viewer. */
function HandIn({ org, row, masterId, version, file, go }: { org: OrgRef; row: SubmissionRow; masterId: string; version: string | null; file: string | null
    go: (next: Partial<Record<'assignment' | 'copy' | 'version' | 'file', string | null>>) => void }) {
    const [data, setData] = useState<{ projectId: string; current: BrowserFile[]; versions: Array<{ version: number; at: string; files: BrowserFile[] }> } | null | 'denied'>(null)
    useEffect(() => { void readHandInFilesAction(row.copyId).then((r) => setData(r.success ? r : 'denied')) }, [row.copyId])
    if (data === null) return <div className="nb-skeleton m-4 h-24 rounded-md" aria-label="Loading the hand-in" />
    if (data === 'denied') return <BrowserEmpty title="These files can’t be shown here" body="Open the hand-in to see them." action={<Link className="nb-link mt-3 inline-block" href={assignmentHref(orgPath(org), row.copyId)}>Open the hand-in</Link>} />
    const v = version ? data.versions.find((x) => String(x.version) === version) ?? null : null
    const files = v ? v.files : data.current
    const opened = file ? files.find((f) => f.nodeId === file) ?? null : null
    if (opened) return <OpenFile projectId={data.projectId} file={opened} />
    return (
        <>
            <div className="flex min-h-10 items-center gap-2 border-b border-border bg-background px-4 py-1.5 text-[12px] text-muted-foreground">
                <span>{row.status}{row.late ? ' · Late' : ''}{row.version ? ` · Version ${v ? v.version : row.version}` : ''}{row.by ? ` · handed in by ${row.by}` : ''}</span>
                <span className="flex-1" />
                <Link className="nb-link" href={`${orgPath(org)}?tab=tasks&taskScope=review&assignment=${masterId}&review=${row.copyId}`}>Open in review</Link>
            </div>
            <BrowserTable label="Files listing">
            <FolderListHeader updatedLabel="Last updated" byLabel="By" />
            <div role="rowgroup" className={list}>
                {files.length === 0 ? <BrowserEmpty title="No files" body={row.files ? 'They were removed from the hand-in.' : 'Handed in without a file.'} />
                    : <FileRows files={files} onOpen={(f) => go({ file: f.nodeId })} />}
                {!v ? data.versions.map((x) => (
                    <BrowserRow key={x.version} folder name={`Version ${x.version} · ${new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' }).format(new Date(x.at))}`}
                        updated={x.at} size={filesCount(x.files.length)} by={x.files[0]?.by ?? null} onOpen={() => go({ version: String(x.version), file: null })} badges={<Badge>Earlier</Badge>} />
                )) : null}
            </div>
            </BrowserTable>
        </>
    )
}

// ---------------------------------------------------------------- Sprint materials

type Phase = 'all' | 'running' | 'upcoming' | 'closed'
const phaseOf = (s: string): Exclude<Phase, 'all'> => (s === 'active' ? 'running' : s === 'planning' ? 'upcoming' : 'closed')

export function SprintMaterialsBrowser({ org }: { org: OrgRef }) {
    const [groups, setGroups] = useState<SprintMaterialsGroup[] | null>(null)
    const [phase, setPhase] = useState<Phase>(() => { const s = readUrlParam('ofphase'); return s === 'running' || s === 'upcoming' || s === 'closed' ? s : 'all' })
    const [query, setQuery] = useState(() => readUrlParam('ofmq') ?? '')
    useUrlMirror({ ofphase: phase !== 'all' ? phase : null, ofmq: query || null })
    const { place, go } = useBrowserPlace(['sprint', 'file'] as const)
    useEffect(() => { void readOrgSprintMaterialsAction(org.orgId).then((r) => setGroups(r.success ? r.groups : [])) }, [org.orgId])
    if (!groups) return <div className="nb-skeleton m-4 h-24 rounded-md" aria-label="Loading sprint materials" />
    // Term order: each CO, then the sprints inside it.
    const byStart = (a: SprintMaterialsGroup, b: SprintMaterialsGroup) => (a.startDate ?? '').localeCompare(b.startDate ?? '')
    const top = groups.filter((g) => !g.parentId || !groups.some((x) => x.sprintId === g.parentId)).sort(byStart)
    const ordered = top.flatMap((g) => [g, ...groups.filter((c) => c.parentId === g.sprintId).sort(byStart)])
    const nameOf = (g: SprintMaterialsGroup) => (g.parentName ? `${g.parentName} · ${g.sprint}` : g.sprint)
    const q = query.trim().toLowerCase()
    const filesOf = (g: SprintMaterialsGroup) => {
        const parent = g.parentId ? groups.find((x) => x.sprintId === g.parentId) : null
        return [...g.files, ...(parent?.files ?? []).filter((f) => !g.files.some((x) => x.nodeId === f.nodeId))]
    }
    const shown = ordered.filter((g) => (phase === 'all' || phaseOf(g.status) === phase) && (!q || nameOf(g).toLowerCase().includes(q) || g.files.some((f) => f.name.toLowerCase().includes(q))))
    const pills = (['all', 'running', 'upcoming', 'closed'] as const).map((id) => ({ id, label: id === 'all' ? 'All' : id[0]!.toUpperCase() + id.slice(1), count: id === 'all' ? groups.length : groups.filter((g) => phaseOf(g.status) === id).length }))
    const group = groups.find((g) => g.sprintId === place.sprint) ?? null
    const crumbs: Crumb[] = [{ label: 'Sprint materials', onClick: () => go({ sprint: null, file: null }) }]
    if (group) crumbs.push({ label: nameOf(group), onClick: () => go({ file: null }) })
    const files = group ? filesOf(group) : []
    const opened = group && place.file ? files.find((f) => f.nodeId === place.file) ?? null : null
    if (opened) crumbs.push({ label: opened.name })
    return (
        <div className={shell} data-testid="org-materials">
            <BrowserHeader crumbs={crumbs} actions={group && org.isAdmin ? <Button asChild size="sm" variant="outline"><Link href={`${orgPath(org)}?tab=sprints&sprintId=${group.sprintId}`}>Add materials</Link></Button> : null} />
            {opened ? <OpenFile projectId={org.orgId} file={opened} /> : group ? (
                <>
                    <BrowserTable label="Files listing">
                    <FolderListHeader updatedLabel="Last updated" byLabel="By" />
                    <div role="rowgroup" className={list}>
                        {files.length === 0 ? <BrowserEmpty title="No materials in this sprint" body={org.isAdmin ? 'Add them from the sprint’s page.' : undefined} />
                            : <FileRows files={files} onOpen={(f) => go({ file: f.nodeId })} extra={(f) => (group.files.some((x) => x.nodeId === f.nodeId) ? null : <Badge>From {group.parentName}</Badge>)} />}
                    </div>
                    </BrowserTable>
                </>
            ) : (
                <>
                    <FilterBar label="Sprints" pills={pills} value={phase} onChange={setPhase} query={query} onQuery={setQuery} placeholder="Filter files…" />
                    <BrowserTable label="Files listing">
                    <FolderListHeader updatedLabel="Last updated" byLabel="By" sizeLabel="Files" />
                    <div role="rowgroup" className={list}>
                        {groups.length === 0 ? <BrowserEmpty title="No sprint materials yet" body={org.isAdmin ? 'Add files to a sprint from its page in Sprints.' : 'Files your admins add to a sprint show here.'} />
                            : shown.length === 0 ? <BrowserEmpty title="No sprints match these filters" action={<Button type="button" size="sm" variant="outline" className="mt-3" onClick={() => { setPhase('all'); setQuery('') }}>Clear filters</Button>} />
                                : shown.map((g) => {
                                    const last = latest(g.files, (f) => f.updatedAt)
                                    return <BrowserRow key={g.sprintId} folder name={nameOf(g)} updated={last?.updatedAt ?? null} size={filesCount(filesOf(g).length)} by={last?.by ?? null} byAvatarUrl={last?.byAvatarUrl}
                                        onOpen={() => go({ sprint: g.sprintId, file: null })} badges={g.status === 'active' ? <Badge tone="info">Now</Badge> : null} />
                                })}
                    </div>
                    </BrowserTable>
                </>
            )}
        </div>
    )
}

// ---------------------------------------------------------------- A team's Final files

export function FinalFilesBrowser({ projectId }: { projectId: string }) {
    const [rows, setRows] = useState<ChildFinalFileRow[] | null>(null)
    const [state, setState] = useState<'all' | 'review' | 'reviewed'>(() => { const s = readUrlParam('ofstate'); return s === 'review' || s === 'reviewed' ? s : 'all' })
    const [query, setQuery] = useState(() => readUrlParam('offq') ?? '')
    useUrlMirror({ ofstate: state !== 'all' ? state : null, offq: query || null })
    const { place, go } = useBrowserPlace(['assignment', 'file'] as const)
    useEffect(() => { void readChildFinalFilesAction(projectId).then((r) => setRows(r.success ? r.rows : [])) }, [projectId])
    if (!rows) return <div className="nb-skeleton m-4 h-24 rounded-md" aria-label="Loading final files" />
    const reviewed = (r: ChildFinalFileRow) => r.review.startsWith('Reviewed')
    const q = query.trim().toLowerCase()
    const keep = (r: ChildFinalFileRow) => (state === 'all' || (state === 'reviewed' ? reviewed(r) : r.review === 'In review')) && (!q || `${r.name} ${r.assignment}`.toLowerCase().includes(q))
    const groups = [...new Map(rows.map((r) => [r.assignmentId, r.assignment])).entries()]
    const asFile = (r: ChildFinalFileRow): BrowserFile => ({ nodeId: r.nodeId, name: r.name, size: r.size, updatedAt: r.updatedAt, by: r.by, byAvatarUrl: null })
    const open = place.assignment ? rows.filter((r) => r.assignmentId === place.assignment) : []
    const title = groups.find(([id]) => id === place.assignment)?.[1] ?? null
    const opened = place.file ? open.find((r) => r.nodeId === place.file) ?? null : null
    const crumbs: Crumb[] = [{ label: 'Final files', onClick: () => go({ assignment: null, file: null }) }]
    if (title) crumbs.push({ label: title, onClick: () => go({ file: null }) })
    if (opened) crumbs.push({ label: opened.name })
    const pills = [{ id: 'all' as const, label: 'All', count: rows.length }, { id: 'review' as const, label: 'In review', count: rows.filter((r) => r.review === 'In review').length }, { id: 'reviewed' as const, label: 'Reviewed', count: rows.filter(reviewed).length }]
    return (
        <div className={shell} data-testid="org-final-files">
            <BrowserHeader crumbs={crumbs} />
            {opened ? <OpenFile projectId={projectId} file={asFile(opened)} /> : (
                <>
                    {!title ? <FilterBar pills={pills} value={state} onChange={setState} query={query} onQuery={setQuery} placeholder="Filter files…" /> : null}
                    <BrowserTable label="Files listing">
                    <FolderListHeader updatedLabel="Last updated" byLabel="By" sizeLabel={title ? 'Size' : 'Files'} />
                    <div role="rowgroup" className={list}>
                        {rows.length === 0 ? <BrowserEmpty title="No final files yet" body="Files your team hands in for group work show here." />
                            : title ? open.map((r) => <BrowserRow key={r.nodeId} name={r.name} updated={r.updatedAt} size={r.size == null ? '' : `${Math.max(1, Math.round(r.size / 1024))} KB`} by={r.by} onOpen={() => go({ file: r.nodeId })}
                                badges={<Badge tone={reviewed(r) ? 'success' : r.review === 'In review' ? 'warning' : 'muted'}>{r.review}</Badge>} />)
                                : groups.filter(([id]) => rows.some((r) => r.assignmentId === id && keep(r))).map(([id, name]) => {
                                    const mine = rows.filter((r) => r.assignmentId === id)
                                    const last = latest(mine, (r) => r.updatedAt)
                                    return <BrowserRow key={id} folder name={name} updated={last?.updatedAt ?? null} size={filesCount(mine.length)} by={last?.by ?? null} onOpen={() => go({ assignment: id, file: null })}
                                        badges={mine.every(reviewed) ? <Badge tone="success">Reviewed</Badge> : mine.some((r) => r.review === 'In review') ? <Badge tone="warning">In review</Badge> : null} />
                                })}
                    </div>
                    </BrowserTable>
                </>
            )}
        </div>
    )
}
