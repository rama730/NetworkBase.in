'use client'

import Link from 'next/link'
import { useEffect, useState, useTransition } from 'react'
import { AlertTriangle, CalendarRange, FileText, Paperclip, Play, X } from 'lucide-react'

import {
    addSprintMaterialAction,
    fitSprintToParentAction,
    remindSprintLeadsAction,
    removeSprintMaterialAction,
    searchSprintMaterialCandidatesAction,
    startSprintNowAction,
} from '@/app/actions/workspace'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import type { SprintMaterial, SprintOrgContext } from '@/lib/organizations/sprints'
import { useQuery } from '@tanstack/react-query'
import { RosterDialog } from '@/components/organizations/AssignmentsPanel'
import type { AssignmentRow } from '@/app/actions/assignments'
import { ASSIGNMENT_STATE_LABELS } from '@/lib/copy/terms'
import { toast } from '@/lib/feedback'

// The organization parts of the Sprints tab (report §15.4–15.5). The existing tab keeps its layout.

const DAY = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', timeZone: 'UTC' })

type Done = () => void

/** The empty Sprints tab: one line for the situation and its one button (report §7.6, §17.3, §18.2). */
export function sprintEmptyLine(org: SprintOrgContext | null, canCreate: boolean): { title: string; line: string; button: string } {
    if (org?.kind === 'child') {
        const running = org.orgSprints.find((s) => s.status === 'active')
        const next = org.orgSprints.find((s) => s.status === 'planning')
        if (!canCreate) return { title: 'No sprints yet', line: 'Your team hasn’t planned a sprint yet.', button: '' }
        if (running) return { title: 'Plan your sprint', line: `${running.name} is running. Plan what your team will do during it.`, button: 'Plan your sprint' }
        if (next) return { title: 'Plan your sprint', line: `${next.name} starts ${DAY.format(new Date(next.startDate))}. Get ready.`, button: 'Plan your sprint' }
        return { title: 'No sprints yet', line: 'Plan your team’s first sprint.', button: 'Create sprint' }
    }
    if (org?.kind === 'org') {
        return canCreate
            ? { title: 'No sprints yet', line: 'Plan the term as sprints. Turn on “Plan more sprints like this” to plan several at once.', button: 'Plan your first sprint' }
            : { title: 'No sprints planned yet', line: 'Sprints your admins plan show here.', button: '' }
    }
    return canCreate
        ? { title: 'No sprints yet', line: 'Create the first sprint to plan the work inside it.', button: 'Create sprint' }
        : { title: 'No sprints yet', line: 'Sprints created by the owner or admins show here.', button: '' }
}

/** Child sprint header line: `Inside CO1 · CSE-3A · ends Oct 31`, flagged when it no longer fits, with Fix dates (report §15.3, §18.2). */
export function ChildSprintLine({ org, projectId, sprintId, canManage, onFixed }: { org: SprintOrgContext; projectId: string; sprintId: string; canManage: boolean; onFixed: Done }) {
    const [pending, startTransition] = useTransition()
    const parent = org.parentSprint
    if (!parent) return null
    const orgName = org.orgSlug ? <Link href={`/org/${org.orgSlug}`} className="underline underline-offset-4">{org.orgTitle}</Link> : org.orgTitle
    return (
        <p className="nb-compact mb-3 flex flex-wrap items-center gap-1.5 text-muted-foreground" data-testid="child-sprint-line">
            <CalendarRange className="size-3.5" aria-hidden="true" />
            Inside {parent.name} · {orgName} · ends {DAY.format(new Date(parent.endDate))}
            {parent.endedFirst ? <span className="font-medium text-foreground">{parent.name} ended. Complete {parent.endedFirst}?</span> : null}
            {!parent.fits ? (
                <span className="inline-flex items-center gap-1 text-amber-600 dark:text-amber-400"><AlertTriangle className="size-3.5" aria-hidden="true" />Outside {parent.name}</span>
            ) : null}
            {!parent.fits && canManage ? (
                <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => startTransition(async () => {
                    const result = await fitSprintToParentAction({ projectId, sprintId })
                    if (!result.success) return void toast.error(result.error)
                    toast.success(`Dates fit inside ${parent.name} again`)
                    onFixed()
                })}>Fix dates</Button>
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
            <p className="text-sm text-foreground">{running.name} is running. Plan what your team will do during it.</p>
            {canCreate ? <Button size="sm" onClick={() => onCreateLinked(running.id)}>Plan your sprint</Button> : null}
        </div>
    )
}

/** Workspaces panel (report §37.2): `3 of 5 workspaces linked`, each one's sprint or Not planned, with Remind. Admins only. */
export function LinkedWorkspacesBlock({ org, projectId, sprintId }: { org: SprintOrgContext; projectId: string; sprintId: string }) {
    const [pending, startTransition] = useTransition()
    const total = org.linkedProjects.length + org.notLinked.length
    if (total === 0) return null
    const remind = (ids: string[]) => startTransition(async () => {
        const result = await remindSprintLeadsAction({ projectId, sprintId, workspaceIds: ids })
        if (!result.success) return void toast.error(result.error)
        // Report §28.8: an honest count.
        toast.success(result.skipped ? `Sent to ${result.reminded}. ${result.skipped} ${result.skipped === 1 ? 'was' : 'were'} reminded recently.` : `Sent to ${result.reminded}.`)
    })
    return (
        <section aria-labelledby="sprint-teams-heading" className="rounded-md border border-border p-3">
            {/* Sprint redesign §5.5: teams plan their own sprint inside this one; say who has. */}
            <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 id="sprint-teams-heading" className="text-sm font-semibold">Teams <span className="font-normal text-muted-foreground">· {org.linkedProjects.length} of {total} planned</span></h3>
                {org.notLinked.length > 1 ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => remind(org.notLinked.map((w) => w.projectId))}>Remind {org.notLinked.length}</Button> : null}
            </div>
            <ul className="mt-2 space-y-1 text-sm">
                {org.linkedProjects.map((row) => (
                    <li key={row.sprintId}>
                        <Link href={`/workspaces/${row.slug ?? row.projectId}?tab=sprints&sprintId=${row.sprintId}`} className="hover:underline">
                            {row.title} · {row.sprintName}
                        </Link>
                        <span className="text-muted-foreground"> · {row.status === 'planning' ? 'planned' : row.status}{row.total ? ` · ${row.done ?? 0} of ${row.total} done` : ''}</span>
                    </li>
                ))}
                {org.notLinked.map((row) => (
                    <li key={row.projectId} className="flex flex-wrap items-center gap-x-2">
                        <Link href={`/workspaces/${row.slug ?? row.projectId}?tab=sprints`} className="hover:underline">{row.title}</Link>
                        <span className="text-muted-foreground">· no sprint yet</span>
                        <button type="button" disabled={pending} className="text-xs font-medium text-primary hover:underline" onClick={() => remind([row.projectId])}>Remind</button>
                    </li>
                ))}
            </ul>
        </section>
    )
}

/** Materials under the header: always visible; owners and admins add and remove (report §15.2, §15.4). */
export function SprintMaterials({ projectId, sprintId, projectSlug, materials, canManage, onChanged, title = 'Materials' }: {
    projectId: string
    sprintId: string
    projectSlug: string
    materials: SprintMaterial[]
    canManage: boolean
    onChanged: Done
    /** Sprint redesign §5.5, §8.5: "Materials" for a class, "Files" for a workspace. */
    title?: 'Materials' | 'Files'
}) {
    const [open, setOpen] = useState(false)
    const [pending, startTransition] = useTransition()
    if (materials.length === 0 && !canManage) return null
    return (
        <section aria-labelledby={`sprint-${title}-heading`} className="space-y-2 rounded-md border border-border p-3">
            <div className="flex items-center justify-between gap-2">
                <h3 id={`sprint-${title}-heading`} className="text-sm font-semibold">{title}</h3>
                {canManage ? <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(true)}><Paperclip className="size-3.5" aria-hidden="true" />Add</Button> : null}
            </div>
            {materials.length === 0 ? <p className="text-[13px] text-muted-foreground">{title === 'Materials' ? 'Slides, readings or files everyone uses in this sprint.' : 'Specs and designs the whole sprint works from.'}</p> : null}
            <div className="flex flex-wrap gap-2">
            {materials.map((m) => (
                <span key={m.id} className="inline-flex items-center gap-1 rounded-[5px] border border-border bg-card py-0.5 pl-2.5 pr-1 text-sm">
                    <FileText className="size-3.5 text-muted-foreground" aria-hidden="true" />
                    <Link
                        href={m.kind === 'doc' ? `/workspaces/${projectSlug}?tab=docs&doc=${m.docSlug}` : `/workspaces/${projectSlug}?tab=files&fileId=${m.nodeId}`}
                        className="hover:underline"
                    >{m.title}</Link>
                    {canManage ? (
                        <button type="button" aria-label={`Remove ${m.title}`} disabled={pending} className="nb-icon-button size-6 rounded-[4px]"
                            onClick={() => startTransition(async () => { await removeSprintMaterialAction({ projectId, materialId: m.id }); onChanged() })}>
                            <X className="size-3" aria-hidden="true" />
                        </button>
                    ) : null}
                </span>
            ))}
            </div>
            {canManage ? <MaterialPicker open={open} onOpenChange={setOpen} projectId={projectId} sprintId={sprintId} onAdded={onChanged} /> : null}
        </section>
    )
}

function MaterialPicker({ open, onOpenChange, projectId, sprintId, onAdded }: { open: boolean; onOpenChange: (open: boolean) => void; projectId: string; sprintId: string; onAdded: Done }) {
    const [query, setQuery] = useState('')
    const [results, setResults] = useState<{ files: Array<{ id: string; title: string; adminsOnly?: boolean }>; docs: Array<{ id: string; title: string }> }>({ files: [], docs: [] })
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
                                <FileText className="size-3.5 text-muted-foreground" aria-hidden="true" />
                                <span className="min-w-0">
                                    {item.title}
                                    {/* Decision 137: an Admins-only file says so before it becomes a material. */}
                                    {'adminsOnly' in item && item.adminsOnly ? <span className="block text-xs text-amber-700 dark:text-amber-400">Admins only. Members won’t be able to open this.</span> : null}
                                </span>
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

const STATE: Record<string, string> = ASSIGNMENT_STATE_LABELS
const dueText = (iso: string | null) => (iso ? `due ${DAY.format(new Date(iso))}` : 'no due date')

