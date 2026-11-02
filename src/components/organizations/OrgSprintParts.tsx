'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import { AlertTriangle, CalendarRange, FileText, Paperclip, Play, X } from 'lucide-react'

import {
    addSprintMaterialAction,
    planSprintSeriesAction,
    removeSprintMaterialAction,
    searchSprintMaterialCandidatesAction,
    startSprintNowAction,
} from '@/app/actions/workspace'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { SprintMaterial, SprintOrgContext } from '@/lib/organizations/sprints'
import { useQuery } from '@tanstack/react-query'
import { readSprintAssignmentsAction } from '@/app/actions/sprint-assignments'
import { RosterDialog } from '@/components/organizations/AssignmentsPanel'
import type { AssignmentRow } from '@/app/actions/assignments'
import { ASSIGNMENT_STATE_LABELS } from '@/lib/copy/terms'

// The organization parts of the Sprints tab (report §15.4–15.5). The existing tab keeps its layout.

const DAY = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })

type Done = () => void

/** Child sprint header line: `Inside CO1 · CSE-3A · ends Oct 31`, flagged when it no longer fits (report §15.3). */
export function ChildSprintLine({ org }: { org: SprintOrgContext }) {
    const parent = org.parentSprint
    if (!parent) return null
    const orgName = org.orgSlug ? <Link href={`/org/${org.orgSlug}`} className="underline underline-offset-4">{org.orgTitle}</Link> : org.orgTitle
    return (
        <p className="nb-compact mb-3 flex flex-wrap items-center gap-1.5 text-muted-foreground" data-testid="child-sprint-line">
            <CalendarRange className="size-3.5" aria-hidden="true" />
            Inside {parent.name} · {orgName} · ends {DAY.format(new Date(parent.endDate))}
            {!parent.fits ? (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle className="size-3.5" aria-hidden="true" />Outside {parent.name} dates</span>
            ) : null}
        </p>
    )
}

/** Child project with no active sprint while an org sprint runs (report §15.5). */
export function RunningOrgSprintPrompt({ org, canCreate, onCreateLinked }: { org: SprintOrgContext; canCreate: boolean; onCreateLinked: (parentSprintId: string) => void }) {
    const running = org.runningOrgSprint
    if (!running) return null
    return (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-border bg-secondary/50 px-4 py-3" role="status">
            <p className="text-sm text-foreground">{running.name} is running in {org.orgTitle}. Plan your sprint inside it.</p>
            {canCreate ? <Button size="sm" onClick={() => onCreateLinked(running.id)}>Create linked sprint</Button> : null}
        </div>
    )
}

/** Org sprint: the child projects' linked sprints, and how many have none (report §15.4). */
export function LinkedWorkspacesBlock({ org }: { org: SprintOrgContext }) {
    if (org.linkedProjects.length === 0 && org.notLinkedCount === 0) return null
    return (
        <section aria-label="Linked workspaces" className="mb-4 rounded-md border border-border p-3">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">Linked workspaces</p>
            <ul className="mt-2 space-y-1 text-sm">
                {org.linkedProjects.map((row) => (
                    <li key={row.sprintId}>
                        <Link href={`/workspaces/${row.slug ?? row.projectId}?tab=sprints&sprintId=${row.sprintId}`} className="hover:underline">
                            {row.title} · {row.sprintName}
                        </Link>
                        <span className="text-muted-foreground"> · {row.status === 'planning' ? 'planned' : row.status}</span>
                    </li>
                ))}
            </ul>
            {org.notLinkedCount > 0 ? <p className="mt-2 text-sm text-muted-foreground">{org.notLinkedCount} {org.notLinkedCount === 1 ? 'workspace' : 'workspaces'} not linked</p> : null}
        </section>
    )
}

/** Materials under the header: always visible; owners and admins add and remove (report §15.2, §15.4). */
export function SprintMaterials({ projectId, sprintId, projectSlug, materials, canManage, onChanged }: {
    projectId: string
    sprintId: string
    projectSlug: string
    materials: SprintMaterial[]
    canManage: boolean
    onChanged: Done
}) {
    const [open, setOpen] = useState(false)
    const [pending, startTransition] = useTransition()
    if (materials.length === 0 && !canManage) return null
    return (
        <section aria-label="Materials" className="mb-4 flex flex-wrap items-center gap-2">
            <span className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">Materials</span>
            {materials.map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-card py-0.5 pl-2.5 pr-1 text-sm">
                    <FileText className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <Link
                        href={m.kind === 'doc' ? `/workspaces/${projectSlug}?tab=docs&doc=${m.docSlug}` : `/workspaces/${projectSlug}?tab=files&fileId=${m.nodeId}`}
                        className="hover:underline"
                    >{m.title}</Link>
                    {canManage ? (
                        <button type="button" aria-label={`Remove ${m.title}`} disabled={pending} className="nb-icon-button size-6 rounded-full"
                            onClick={() => startTransition(async () => { await removeSprintMaterialAction({ projectId, materialId: m.id }); onChanged() })}>
                            <X className="size-3" aria-hidden="true" />
                        </button>
                    ) : null}
                </span>
            ))}
            {canManage ? <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><Paperclip className="size-3.5" aria-hidden="true" />Add material</Button> : null}
            {canManage ? <MaterialPicker open={open} onOpenChange={setOpen} projectId={projectId} sprintId={sprintId} onAdded={onChanged} /> : null}
        </section>
    )
}

function MaterialPicker({ open, onOpenChange, projectId, sprintId, onAdded }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: string; sprintId: string; onAdded: Done }) {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<{ files: Array<{ id: string; title: string }>; docs: Array<{ id: string; title: string }> }>({ files: [], docs: [] })
    const [error, setError] = useState<string | null>(null)
    useEffect(() => {
        if (!open) return
        let cancelled = false
        const timer = setTimeout(() => void searchSprintMaterialCandidatesAction({ projectId, query }).then((r) => { if (!cancelled) setResults({ files: r.files, docs: r.docs }) }), 250)
        return () => { cancelled = true; clearTimeout(timer) }
    }, [open, projectId, query])
    const add = async (target: { nodeId?: string; docId?: string }) => {
        const result = await addSprintMaterialAction({ projectId, sprintId, ...target })
        if (!result.success) return setError(result.error)
        onAdded()
        onOpenChange(false)
    }
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Add a material</DialogTitle>
                    <DialogDescription>A file or doc from this workspace, for everyone working in the sprint.</DialogDescription>
                </DialogHeader>
                <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search files and docs" aria-label="Search files and docs" autoFocus />
                <ul className="max-h-72 divide-y divide-border overflow-y-auto rounded-md border border-border">
                    {[...results.docs.map((d) => ({ ...d, kind: 'doc' as const })), ...results.files.map((f) => ({ ...f, kind: 'file' as const }))].map((item) => (
                        <li key={`${item.kind}-${item.id}`}>
                            <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted/50" onClick={() => void add(item.kind === 'doc' ? { docId: item.id } : { nodeId: item.id })}>
                                <FileText className="size-3.5 text-muted-foreground" aria-hidden="true" />{item.title}
                                <span className="ml-auto text-xs text-muted-foreground">{item.kind === 'doc' ? 'Doc' : 'File'}</span>
                            </button>
                        </li>
                    ))}
                    {results.docs.length + results.files.length === 0 ? <li className="px-3 py-4 text-sm text-muted-foreground">Nothing matches.</li> : null}
                </ul>
                {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
            </DialogContent>
        </Dialog>
    )
}

/** Planned sprints that don't start on their own (or start early) start here (report §15.2, §15.8). */
export function StartNowButton({ projectId, sprintId, onStarted, announceAs }: { projectId: string; sprintId: string; onStarted: Done; announceAs?: string | null }) {
    const [pending, startTransition] = useTransition()
    const [error, setError] = useState<string | null>(null)
    // Orgs: "Also post an announcement" (report §17.2), off by default with the text pre-filled.
    const [confirming, setConfirming] = useState(false)
    const [announce, setAnnounce] = useState(false)
    const [text, setText] = useState(announceAs ? `${announceAs} has started.` : '')
    const start = () => startTransition(async () => {
        const result = await startSprintNowAction(sprintId, projectId, announce ? text : null)
        if (!result.success) return setError(result.error)
        setError(null)
        setConfirming(false)
        onStarted()
    })
    if (confirming) {
        return (
            <div className="space-y-2 rounded-md border border-border p-2 text-sm">
                <label className="flex items-center gap-2"><input type="checkbox" checked={announce} onChange={(e) => setAnnounce(e.target.checked)} /> Also post an announcement</label>
                {announce ? <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={5000} aria-label="Announcement" className="w-full rounded-md border border-border bg-background p-2" /> : null}
                <div className="flex gap-2">
                    <Button type="button" size="sm" disabled={pending} onClick={start}><Play className="size-3.5" aria-hidden="true" />Start now</Button>
                    <Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>Cancel</Button>
                </div>
                {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
            </div>
        )
    }
    return (
        <span className="inline-flex items-center gap-2">
            <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => (announceAs ? setConfirming(true) : start())}><Play className="size-3.5" aria-hidden="true" />Start now</Button>
            {error ? <span role="alert" className="text-xs text-destructive">{error}</span> : null}
        </span>
    )
}

/** "Plan a series" on an org: prefix, count, length, start date (report §15.2). */
export function PlanSeriesButton({ projectId, suggestedPrefix, onPlanned }: { projectId: string; suggestedPrefix: string; onPlanned: Done }) {
    const [open, setOpen] = useState(false)
    const [prefix, setPrefix] = useState(suggestedPrefix)
    const [count, setCount] = useState(5)
    const [length, setLength] = useState(7)
    const [start, setStart] = useState(() => new Date().toISOString().slice(0, 10))
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const submit = () => startTransition(async () => {
        const result = await planSprintSeriesAction({ projectId, prefix, count, lengthDays: length, startDate: start })
        if (!result.success) return setError(result.error)
        setError(null)
        setOpen(false)
        onPlanned()
    })
    return (
        <>
            <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}><CalendarRange className="size-3.5" aria-hidden="true" />Plan a series</Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent className="max-w-md">
                    <DialogHeader>
                        <DialogTitle>Plan a series</DialogTitle>
                        <DialogDescription>Planned sprints back to back, for example {prefix || 'CO'}1–{prefix || 'CO'}{count} every {length} days.</DialogDescription>
                    </DialogHeader>
                    <div className="grid gap-3 sm:grid-cols-2">
                        <label className="text-sm">Name prefix<Input value={prefix} onChange={(e) => setPrefix(e.target.value)} maxLength={40} className="mt-1" /></label>
                        <label className="text-sm">How many<Input type="number" min={1} max={52} value={count} onChange={(e) => setCount(Number(e.target.value))} className="mt-1" /></label>
                        <label className="text-sm">Days each<Input type="number" min={1} max={366} value={length} onChange={(e) => setLength(Number(e.target.value))} className="mt-1" /></label>
                        <label className="text-sm">First starts<Input type="date" value={start} onChange={(e) => setStart(e.target.value)} className="mt-1" /></label>
                    </div>
                    {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
                    <Button type="button" disabled={pending} onClick={submit}>Create {count} sprints</Button>
                </DialogContent>
            </Dialog>
        </>
    )
}

const STATE: Record<string, string> = ASSIGNMENT_STATE_LABELS
const dueText = (iso: string | null) => (iso ? `due ${DAY.format(new Date(iso))}` : 'no due date')

/**
 * Assignment rows in the sprint timeline (report §15.4–15.5): admins `Lab 1 — 18 of 30 done · 4 missing` with the
 * roster; guests the counts only; members their own copy; a child project the org's group copies.
 */
export function SprintAssignmentRows({ projectId, sprintId }: { projectId: string; sprintId: string }) {
    const query = useQuery({ queryKey: ['sprint-assignments', projectId, sprintId], queryFn: () => readSprintAssignmentsAction(projectId, sprintId), staleTime: 30_000 })
    const [roster, setRoster] = useState<AssignmentRow | null>(null)
    const data = query.data
    if (!data || data.rows.length === 0) return null
    const item = 'flex flex-wrap items-center gap-x-2 gap-y-1 py-1.5 text-sm'
    return (
        <section aria-label="Assignments in this sprint" className="mb-4 rounded-md border border-border p-3">
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">Assignments</p>
            <ul className="mt-1 divide-y divide-border">
                {data.view === 'admin' || data.view === 'guest' ? data.rows.map((row) => (
                    <li key={row.masterId} className={item}>
                        <span className="text-muted-foreground">Assignment ·</span><span className="font-medium">{row.title}</span>
                        <span className="text-muted-foreground">— {row.counts.done} of {row.counts.total} done{row.counts.missing ? ` · ${row.counts.missing} missing` : ''}</span>
                        {data.view === 'admin' ? <Button type="button" size="sm" variant="outline" className="ml-auto" onClick={() => setRoster(row)}>Roster</Button> : null}
                    </li>
                )) : null}
                {data.view === 'member' ? data.rows.map((row) => (
                    <li key={row.masterId} className={item}>
                        <span className="font-medium">{row.title}</span>
                        <span className="text-muted-foreground">· {row.state === 'submitted' || row.state === 'done' ? STATE[row.state] : row.state ? `${dueText(row.dueDate)} · ${STATE[row.state]}` : dueText(row.dueDate)}{row.late ? ' · late' : ''}</span>
                    </li>
                )) : null}
                {data.view === 'child' ? data.rows.map((row) => (
                    <li key={row.copyId} className={item}>
                        <span className="rounded-[3px] border border-border px-1 text-[11px] text-muted-foreground">From {data.orgTitle}</span>
                        <span className="font-medium">{row.title}</span>
                        <span className="text-muted-foreground">· {dueText(row.dueDate)} · {STATE[row.state]}{row.late ? ' · late' : ''}</span>
                    </li>
                )) : null}
            </ul>
            {data.view !== 'member' && data.view !== 'child' && data.completed ? (
                <p className="mt-2 text-xs text-muted-foreground">{data.completed.by} completed this sprint · {data.completed.assignments} {data.completed.assignments === 1 ? 'assignment' : 'assignments'} · {data.completed.missingPeople} {data.completed.missingPeople === 1 ? 'person' : 'people'} with missing work</p>
            ) : null}
            {roster ? <RosterDialog row={roster} orgId={projectId} open onOpenChange={(open) => { if (!open) setRoster(null) }} onChanged={() => void query.refetch()} /> : null}
        </section>
    )
}
