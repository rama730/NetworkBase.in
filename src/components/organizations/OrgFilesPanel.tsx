'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronRight, FileText, Folder } from 'lucide-react'

import {
    browseOrgFilesAction,
    listOrgCopiesAction,
    readChildFinalFilesAction,
    readOrgSprintMaterialsAction,
    readOrgStorageAction,
    readOrgSubmissionsAction,
    recordOrgCopyAction,
    setFolderAccessAction,
    setFolderTemplateAction,
    type ChildFinalFileRow,
    type OrgBrowseNode,
    type OrgCopyRow,
    type SprintMaterialsGroup,
    type SubmissionGroup,
} from '@/app/actions/org-files'
import { uploadWorkspaceFile } from '@/components/organizations/OrgDocParts'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DownloadLink } from '@/components/ui/download-link'
import { readFolderAccess, type FolderAccess } from '@/lib/organizations/file-rules'
import { FolderAccessChip } from '@/components/organizations/FolderAccessChip'
import { assignmentHref } from '@/lib/organizations/assignment-rules'
import { toast, feedbackError } from '@/lib/feedback'

// Org Files (report §7.8, §16.4, §18.6, §37.5): the left panel's organization views, folder access in each
// folder's menu, and the slim storage notice. Nothing sits above the browser.

/** What the Files tab knows about the organization it belongs to. */
export type OrgFilesInfo = {
    mode: 'org' | 'child'
    orgId: string
    title: string
    slug: string | null
    isAdmin: boolean
    /** Child: an organization person may copy its files here. */
    canCopy: boolean
}

const orgPath = (org: Pick<OrgFilesInfo, 'orgId' | 'slug'>) => `/org/${encodeURIComponent(org.slug ?? org.orgId)}`
const fileHref = (org: Pick<OrgFilesInfo, 'orgId' | 'slug'>, nodeId: string) => `${orgPath(org)}?tab=files&fileId=${encodeURIComponent(nodeId)}`

/** Who can see this? (report §7.8, decision 11): in each folder's menu, admins only. */
export function FolderAccessDialog({ orgId, orgTitle, folder, open, onOpenChange, onSaved }: {
    orgId: string
    orgTitle: string
    folder: { id: string; name: string; metadata: unknown }
    open: boolean
    onOpenChange: (open: boolean) => void
    /** The folder's new metadata, so the list can show its chips at once. */
    onSaved?: (metadata: Record<string, unknown>) => void
}) {
    const current = readFolderAccess(folder.metadata)
    const [choice, setChoice] = useState<FolderAccess | null>(current)
    const [template, setTemplate] = useState((folder.metadata as { template?: unknown } | null)?.template === true)
    const [line, setLine] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    useEffect(() => {
        if (!open || choice === current) return setLine(null)
        let live = true
        void setFolderAccessAction(orgId, folder.id, choice, false).then((r) => { if (live) setLine(r.success ? r.preview?.message ?? null : r.error) })
        return () => { live = false }
    }, [choice, current, folder.id, open, orgId])
    const save = () => startTransition(async () => {
        if (choice !== current) {
            const r = await setFolderAccessAction(orgId, folder.id, choice, true)
            if (!r.success) return void toast.error(r.error)
        }
        const wasTemplate = (folder.metadata as { template?: unknown } | null)?.template === true
        if (template !== wasTemplate && choice !== 'admins') {
            const r = await setFolderTemplateAction(orgId, folder.id, template)
            if (!r.success) return void toast.error(r.error)
        }
        toast.success('Saved')
        const { access: _a, template: _t, ...rest } = (folder.metadata ?? {}) as Record<string, unknown>
        onSaved?.({ ...rest, ...(choice ? { access: choice } : {}), ...(template && choice !== 'admins' ? { template: true } : {}) })
        onOpenChange(false)
    })
    const options: Array<{ value: FolderAccess | null; label: string }> = [
        { value: null, label: `Everyone in ${orgTitle}` },
        { value: 'admins', label: 'Admins only' },
        { value: 'public', label: 'Public' },
    ]
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Who can see {folder.name}?</DialogTitle>
                    <DialogDescription>Folders inside follow this, and can only be stricter.</DialogDescription>
                </DialogHeader>
                <div role="radiogroup" aria-label="Who can see this" className="space-y-1.5">
                    {options.map((o) => (
                        <label key={o.label} className="flex items-center gap-2 text-sm">
                            <input type="radio" name="folder-access" checked={(choice ?? null) === o.value} onChange={() => setChoice(o.value)} />
                            {o.label}
                        </label>
                    ))}
                </div>
                {line ? <p role="status" className="text-sm text-muted-foreground">{line}</p> : null}
                <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={template && choice !== 'admins'} disabled={choice === 'admins'} onChange={(e) => setTemplate(e.target.checked)} />
                    Use as template for new workspaces
                </label>
                {choice === 'admins' ? <p className="text-[12px] text-muted-foreground">Admins-only folders can’t be templates.</p> : null}
                <div className="flex justify-end gap-2">
                    <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button size="sm" disabled={pending} onClick={save}>Save</Button>
                </div>
            </DialogContent>
        </Dialog>
    )
}

/** "Storage is 85% full · Manage" (report §7.8): admins only, from 80%; the rest of Storage lives in Settings. */
export function OrgStorageNotice({ org }: { org: OrgFilesInfo }) {
    const [storage, setStorage] = useState<{ usedBytes: number; limitBytes: number; warn: boolean } | null>(null)
    useEffect(() => { if (org.isAdmin && org.mode === 'org') void readOrgStorageAction(org.orgId).then(setStorage) }, [org.isAdmin, org.mode, org.orgId])
    if (!storage?.warn) return null
    const percent = Math.min(100, Math.round((storage.usedBytes / storage.limitBytes) * 100))
    return (
        <p role="status" data-testid="org-storage" className="mb-2 text-[12px] text-amber-700 dark:text-amber-400">
            {percent >= 100 ? 'Storage is full' : `Storage is ${percent}% full`} · <Link href={`${orgPath(org)}?tab=settings`} className="underline underline-offset-4">Manage</Link>
        </p>
    )
}

/** The organization's left-panel views (report §7.8, §18.6, §37.5). */
export function OrgFilesCollection({ view, projectId, org }: { view: 'materials' | 'submissions' | 'from_org'; projectId: string; org: OrgFilesInfo }) {
    return (
        <div className="flex-1 overflow-y-auto p-4" data-testid={`org-files-${view}`}>
            {view === 'materials' ? <SprintMaterialsView org={org} />
                : view === 'from_org' ? <FromOrgFiles projectId={projectId} org={org} />
                    : org.mode === 'org' ? <SubmissionsView org={org} /> : <ChildFinalFiles projectId={projectId} />}
        </div>
    )
}

/** Sprint materials (report §37.5): grouped by sprint; members read; admins add from the sprint. */
function SprintMaterialsView({ org }: { org: OrgFilesInfo }) {
    const [groups, setGroups] = useState<SprintMaterialsGroup[] | null>(null)
    useEffect(() => { void readOrgSprintMaterialsAction(org.orgId).then((r) => setGroups(r.success ? r.groups : [])) }, [org.orgId])
    if (!groups) return <div className="nb-skeleton h-24 rounded-md" aria-label="Loading sprint materials" />
    if (groups.length === 0) {
        return (
            <div className="nb-empty-state py-12" role="status">
                <p className="nb-empty-state-title">No sprint materials yet</p>
                <p className="nb-empty-state-desc">{org.isAdmin ? 'Add files to a sprint from its page in Sprints.' : 'Files your admins add to a sprint show here.'}</p>
            </div>
        )
    }
    return (
        <div className="space-y-4">
            {groups.map((g) => (
                <section key={g.sprintId} aria-label={g.sprint}>
                    <h3 className="nb-micro mb-1 text-muted-foreground">{g.sprint}{g.status === 'active' ? ' · now' : ''}</h3>
                    <ul className="divide-y divide-border text-sm">
                        {g.files.map((f) => (
                            <li key={f.nodeId} className="flex items-center gap-2 py-1.5">
                                <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                                <Link href={fileHref(org, f.nodeId)} className="min-w-0 truncate hover:underline">{f.name}</Link>
                            </li>
                        ))}
                    </ul>
                </section>
            ))}
        </div>
    )
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '—')

/** Submissions (Final files for other types, report §37.5): per assignment, each person or group, with filters. */
function SubmissionsView({ org }: { org: OrgFilesInfo }) {
    const [data, setData] = useState<SubmissionGroup[] | null>(null)
    const [assignment, setAssignment] = useState('')
    const [status, setStatus] = useState('')
    const [lateOnly, setLateOnly] = useState(false)
    useEffect(() => { void readOrgSubmissionsAction(org.orgId).then((r) => setData(r.success ? r.assignments : [])) }, [org.orgId])
    const statuses = useMemo(() => [...new Set((data ?? []).flatMap((g) => g.rows.map((r) => r.status)))], [data])
    if (!data) return <div className="nb-skeleton h-24 rounded-md" aria-label="Loading submissions" />
    if (data.length === 0) return <div className="nb-empty-state py-12" role="status"><p className="nb-empty-state-title">Nothing handed in yet</p><p className="nb-empty-state-desc">Work handed in for assignments shows here.</p></div>
    const shown = data.filter((g) => !assignment || g.id === assignment)
        .map((g) => ({ ...g, rows: g.rows.filter((r) => (!status || r.status === status) && (!lateOnly || r.late)) }))
    return (
        <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-sm">
                <select aria-label="Assignment" value={assignment} onChange={(e) => setAssignment(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2">
                    <option value="">All assignments</option>
                    {data.map((g) => <option key={g.id} value={g.id}>{g.title}</option>)}
                </select>
                <select aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2">
                    <option value="">Any status</option>
                    {statuses.map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
                <label className="flex items-center gap-1.5"><input type="checkbox" checked={lateOnly} onChange={(e) => setLateOnly(e.target.checked)} />Late</label>
            </div>
            {shown.map((g) => (
                <section key={g.id} aria-label={g.title}>
                    <div className="mb-1 flex items-center gap-2">
                        <h3 className="text-sm font-medium">{g.title}</h3>
                        {g.rows.some((r) => r.files > 0) ? <Button asChild size="sm" variant="outline" className="ml-auto"><DownloadLink href={`/api/v1/workspaces/${org.orgId}/tasks/${g.id}/submissions`}>Download all</DownloadLink></Button> : null}
                    </div>
                    {g.rows.length === 0 ? <p className="text-[13px] text-muted-foreground">Nothing matches these filters.</p> : (
                        <ul className="divide-y divide-border text-sm">
                            {g.rows.map((r) => (
                                <li key={r.copyId} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-1.5">
                                    <Link href={assignmentHref(orgPath(org), r.copyId)} className="min-w-0 truncate font-medium hover:underline">{r.who}</Link>
                                    <span className="text-[12px] text-muted-foreground">{r.files} {r.files === 1 ? 'file' : 'files'}{r.version ? ` · v${r.version}` : ''} · {when(r.submittedAt)}</span>
                                    <span className="ml-auto text-[12px]">{r.status}{r.late ? ' · Late' : ''}</span>
                                </li>
                            ))}
                        </ul>
                    )}
                </section>
            ))}
        </div>
    )
}

/** A workspace's Final files (report §18.6): its group work handed in, with "Reviewed by CSE 3B". */
function ChildFinalFiles({ projectId }: { projectId: string }) {
    const [rows, setRows] = useState<ChildFinalFileRow[] | null>(null)
    useEffect(() => { void readChildFinalFilesAction(projectId).then((r) => setRows(r.success ? r.rows : [])) }, [projectId])
    if (!rows) return <div className="nb-skeleton h-24 rounded-md" aria-label="Loading final files" />
    if (rows.length === 0) return <div className="nb-empty-state py-12" role="status"><p className="nb-empty-state-title">No final files yet</p><p className="nb-empty-state-desc">Files your team hands in for group work show here.</p></div>
    return (
        <ul className="divide-y divide-border text-sm">
            {rows.map((r) => (
                <li key={r.nodeId} className="flex flex-wrap items-center gap-x-2 py-1.5">
                    <Link href={`?tab=files&fileId=${encodeURIComponent(r.nodeId)}`} className="min-w-0 truncate hover:underline">{r.name}</Link>
                    <span className="text-[12px] text-muted-foreground">{r.assignment} · {r.review}</span>
                </li>
            ))}
        </ul>
    )
}

/**
 * An org file opened in place from a child project (report §23.6): `From CSE-3A · read-only · Open in CSE-3A →`.
 * Images and text show here; anything else opens in the org.
 */
function OrgFilePeek({ orgId, orgTitle, file, href, onClose }: { orgId: string; orgTitle: string; file: OrgBrowseNode; href: string; onClose: () => void }) {
    const [body, setBody] = useState<{ kind: 'image'; url: string } | { kind: 'text'; text: string } | { kind: 'other' } | null>(null)
    useEffect(() => {
        let url: string | null = null
        void fetch(`/api/v1/workspaces/${orgId}/files/${file.id}/preview`).then(async (response) => {
            const type = response.headers.get('content-type') ?? ''
            if (!response.ok) return setBody({ kind: 'other' })
            if (type.startsWith('image/')) { url = URL.createObjectURL(await response.blob()); return setBody({ kind: 'image', url }) }
            if (type.startsWith('text/') || type.includes('json') || type.includes('markdown')) return setBody({ kind: 'text', text: (await response.text()).slice(0, 200_000) })
            setBody({ kind: 'other' })
        }).catch(() => setBody({ kind: 'other' }))
        return () => { if (url) URL.revokeObjectURL(url) }
    }, [file.id, orgId])
    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
            <DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{file.name}</DialogTitle>
                    <DialogDescription>From {orgTitle} · Read only · <Link href={href} className="underline underline-offset-4">Open in {orgTitle}</Link></DialogDescription>
                </DialogHeader>
                {body === null ? <p className="text-sm text-muted-foreground">Loading…</p>
                    : body.kind === 'image' ? <img src={body.url} alt={file.name} className="max-h-[70dvh] w-full object-contain" />
                        : body.kind === 'text' ? <pre className="max-h-[70dvh] overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-[12px]">{body.text}</pre>
                            : <p className="text-sm text-muted-foreground">This file opens in {orgTitle}.</p>}
            </DialogContent>
        </Dialog>
    )
}

/** From CSE 3B (report §17.5, §18.6): the organization's tree, read only, with Copy and the Newer version chip. */
function FromOrgFiles({ projectId, org }: { projectId: string; org: OrgFilesInfo }) {
    const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([])
    const [nodes, setNodes] = useState<OrgBrowseNode[] | null>(null)
    const [copies, setCopies] = useState<OrgCopyRow[]>([])
    const [copying, setCopying] = useState<string | null>(null)
    const [peek, setPeek] = useState<OrgBrowseNode | null>(null)
    const [askUpdate, setAskUpdate] = useState<OrgCopyRow | null>(null)
    const folderId = trail.at(-1)?.id ?? null
    const loadCopies = useCallback(() => void listOrgCopiesAction(projectId).then((r) => setCopies(r.success ? r.copies : [])), [projectId])
    useEffect(() => { void browseOrgFilesAction(projectId, folderId).then((r) => setNodes(r.success ? r.nodes : [])) }, [folderId, projectId])
    useEffect(() => { loadCopies() }, [loadCopies])
    const copiesBySource = useMemo(() => new Map(copies.map((c) => [c.sourceNodeId, c])), [copies])
    if (!nodes) return <div className="nb-skeleton h-24 rounded-md" aria-label={`Loading ${org.title} files`} />

    // Update copy (report §18.6): asks first, then the organization's version becomes a new version of this copy.
    const updateCopy = async (c: OrgCopyRow) => {
        setCopying(c.nodeId)
        try {
            const response = await fetch(`/api/v1/workspaces/${org.orgId}/files/${c.sourceNodeId}/preview`)
            if (!response.ok) throw new Error('Couldn’t read the file')
            const blob = await response.blob()
            const { saveFileRevision } = await import('@/hooks/useFileVersions')
            const saved = await saveFileRevision({ projectId, nodeId: c.nodeId, file: new File([blob], c.name, { type: blob.type }), mode: 'new_revision', comment: `Updated from ${org.title} v${c.sourceVersion}`, baseVersion: null })
            if (!saved.success) throw new Error(saved.error)
            const recorded = await recordOrgCopyAction(projectId, c.nodeId, c.sourceNodeId)
            if (!recorded.success) throw new Error(recorded.error)
            toast.success(`${c.name} updated to v${c.sourceVersion}`)
            loadCopies()
        } catch (error) {
            toast.error(feedbackError(error instanceof Error ? error.message : 'Update failed', 'Update failed'))
        } finally {
            setCopying(null)
        }
    }
    // ponytail: copies land in this workspace's top folder; a folder picker comes if teams ask for it.
    const copy = async (file: OrgBrowseNode) => {
        setCopying(file.id)
        try {
            const response = await fetch(`/api/v1/workspaces/${org.orgId}/files/${file.id}/preview`)
            if (!response.ok) throw new Error('Couldn’t read the file')
            const created = await uploadWorkspaceFile(projectId, null, file.name, await response.blob())
            const recorded = await recordOrgCopyAction(projectId, created.id, file.id)
            if (!recorded.success) throw new Error(recorded.error)
            toast.success(`Copied from ${org.title} · v${file.currentVersion}`)
            loadCopies()
        } catch (error) {
            toast.error(feedbackError(error instanceof Error ? error.message : 'Copy failed', 'Copy failed'))
        } finally {
            setCopying(null)
        }
    }

    return (
        <div className="space-y-3">
            <p className="text-[12px] text-muted-foreground">{org.title} · Read only · <Link href={`${orgPath(org)}?tab=files`} className="underline underline-offset-4">Open in {org.title}</Link></p>
            {trail.length ? (
                <nav aria-label={`${org.title} folders`} className="flex flex-wrap items-center gap-1 text-[12px] text-muted-foreground">
                    <button type="button" onClick={() => setTrail([])} className="hover:text-foreground">{org.title}</button>
                    {trail.map((step, index) => (
                        <span key={step.id} className="flex items-center gap-1"><ChevronRight className="size-3" aria-hidden="true" />
                            <button type="button" onClick={() => setTrail(trail.slice(0, index + 1))} className="hover:text-foreground">{step.name}</button>
                        </span>
                    ))}
                </nav>
            ) : null}
            {nodes.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{trail.length ? 'Nothing here.' : `${org.title} hasn’t shared files yet.`}</p> : (
                <ul className="divide-y divide-border text-sm">
                    {nodes.map((n) => {
                        const mine = copiesBySource.get(n.id)
                        const newer = mine && mine.sourceVersion !== null && mine.sourceVersion > mine.copiedVersion
                        return (
                            <li key={n.id} className="flex flex-wrap items-center gap-2 py-1.5">
                                {n.type === 'folder' ? <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                                <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline"
                                    onClick={() => (n.type === 'folder' ? setTrail([...trail, { id: n.id, name: n.name }]) : setPeek(n))}>{n.name}</button>
                                <FolderAccessChip metadata={{ access: n.access }} />
                                {n.type === 'file' && n.currentVersion > 1 ? <span className="text-[11px] text-muted-foreground">v{n.currentVersion}</span> : null}
                                {mine && !newer ? <span className="text-[11px] text-muted-foreground">Copied · v{mine.copiedVersion}</span> : null}
                                {newer && org.canCopy ? (
                                    <button type="button" disabled={copying !== null} onClick={() => setAskUpdate(mine)} className="rounded-[3px] border border-border px-1.5 text-[11px] hover:bg-muted">Newer version · Update copy</button>
                                ) : null}
                                {n.type === 'file' && org.canCopy && !mine ? (
                                    <Button type="button" size="sm" variant="outline" aria-label={`Copy ${n.name} to this workspace`} disabled={copying !== null} onClick={() => void copy(n)}>
                                        {copying === n.id ? 'Copying…' : 'Copy to this workspace'}
                                    </Button>
                                ) : null}
                            </li>
                        )
                    })}
                </ul>
            )}
            {peek ? <OrgFilePeek orgId={org.orgId} orgTitle={org.title} file={peek} href={fileHref(org, peek.id)} onClose={() => setPeek(null)} /> : null}
            <ConfirmDialog
                open={Boolean(askUpdate)}
                onOpenChange={(open) => { if (!open) setAskUpdate(null) }}
                title="Update your copy?"
                description={askUpdate ? `${askUpdate.name} becomes ${org.title}’s v${askUpdate.sourceVersion}. Your current copy stays in its version history.` : undefined}
                confirmLabel="Update copy"
                onConfirm={async () => { if (askUpdate) await updateCopy(askUpdate) }}
            />
        </div>
    )
}
