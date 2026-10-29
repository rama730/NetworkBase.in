'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronRight, FileText, Folder } from 'lucide-react'

import {
    browseOrgFilesAction,
    listOrgCopiesAction,
    listOrgFoldersAction,
    readGroupDeliverablesAction,
    readOrgSprintMaterialsAction,
    readOrgStorageAction,
    recordOrgCopyAction,
    setFolderAccessAction,
    setFolderTemplateAction,
    type OrgBrowseNode,
    type OrgCopyRow,
    type OrgFolderRow,
    type GroupDeliverableRow,
    type SprintMaterialsGroup,
} from '@/app/actions/org-files'
import { uploadProjectFile } from '@/components/organizations/OrgDocParts'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import type { FolderAccess } from '@/lib/organizations/file-rules'
import { FolderAccessChip } from '@/components/organizations/FolderAccessChip'
import { toast, feedbackError } from '@/lib/feedback'

// Org Files (report §23): folder access and Template marks for org admins; From <org> and copies in child projects.

const ACCESS_LABEL: Record<'members' | FolderAccess, string> = { members: 'Members', admins: 'Admins only', public: 'Public' }

/** Org owners and admins: who can open each folder, and which folders are templates. */
function FolderAccessManager({ orgId }: { orgId: string }) {
    const [folders, setFolders] = useState<OrgFolderRow[] | null>(null)
    const [pending, startTransition] = useTransition()
    const load = useCallback(() => void listOrgFoldersAction(orgId).then((r) => setFolders(r.success ? r.folders : [])), [orgId])
    useEffect(() => { load() }, [load])
    const setAccess = (folder: OrgFolderRow, next: FolderAccess | null) => startTransition(async () => {
        const preview = await setFolderAccessAction(orgId, folder.id, next, false)
        if (!preview.success) return void toast.error(preview.error)
        if (preview.preview && !window.confirm(`${folder.path}: ${preview.preview.message}`)) return
        const saved = await setFolderAccessAction(orgId, folder.id, next, true)
        if (!saved.success) return void toast.error(saved.error)
        toast.success('Folder access saved')
        load()
    })
    const setTemplate = (folder: OrgFolderRow, template: boolean) => startTransition(async () => {
        const saved = await setFolderTemplateAction(orgId, folder.id, template)
        if (!saved.success) return void toast.error(saved.error)
        load()
    })
    if (!folders) return <p className="text-sm text-muted-foreground">Loading folders…</p>
    if (folders.length === 0) return <p className="text-sm text-muted-foreground">No folders yet.</p>
    return (
        <ul className="divide-y divide-border text-sm">
            {folders.map((folder) => (
                <li key={folder.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
                    <span className="min-w-0 flex-1 truncate font-mono text-[12px]" title={folder.path}>{folder.path}</span>
                    <select aria-label={`Access for ${folder.path}`} disabled={pending} value={folder.access ?? 'members'}
                        onChange={(e) => setAccess(folder, e.target.value === 'members' && !folder.access ? null : (e.target.value as FolderAccess))}
                        className="h-8 rounded-md border border-border bg-background px-2 text-[12px]">
                        {(['members', 'admins', 'public'] as const).map((value) => <option key={value} value={value}>{ACCESS_LABEL[value]}</option>)}
                    </select>
                    <label className="flex items-center gap-1.5 text-[12px]"><input type="checkbox" aria-label={`Template: ${folder.path}`} disabled={pending} checked={folder.template} onChange={(e) => setTemplate(folder, e.target.checked)} /> Template</label>
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
        void fetch(`/api/v1/projects/${orgId}/files/${file.id}/preview`).then(async (response) => {
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
                    <DialogDescription>From {orgTitle} · read-only · <Link href={href} className="underline underline-offset-4">Open in {orgTitle} →</Link></DialogDescription>
                </DialogHeader>
                {body === null ? <p className="text-sm text-muted-foreground">Loading…</p>
                    : body.kind === 'image' ? <img src={body.url} alt={file.name} className="max-h-[70dvh] w-full object-contain" />
                        : body.kind === 'text' ? <pre className="max-h-[70dvh] overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-3 text-[12px]">{body.text}</pre>
                            : <p className="text-sm text-muted-foreground">This file opens in {orgTitle}.</p>}
            </DialogContent>
        </Dialog>
    )
}

/** From <org> (report §23.6): the org tree read-only, with Copy to this project and Source updated hints. */
function FromOrgFiles({ projectId, canCopy }: { projectId: string; canCopy: boolean }) {
    const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([])
    const [data, setData] = useState<{ org: { id: string; title: string; slug: string | null }; nodes: OrgBrowseNode[] } | null>(null)
    const [copies, setCopies] = useState<OrgCopyRow[]>([])
    const [copying, setCopying] = useState<string | null>(null)
    const [peek, setPeek] = useState<OrgBrowseNode | null>(null)
    const folderId = trail.at(-1)?.id ?? null
    const loadCopies = useCallback(() => void listOrgCopiesAction(projectId).then((r) => setCopies(r.success ? r.copies : [])), [projectId])
    useEffect(() => {
        void browseOrgFilesAction(projectId, folderId).then((r) => setData(r.success ? { org: r.org, nodes: r.nodes } : null))
    }, [folderId, projectId])
    useEffect(() => { loadCopies() }, [loadCopies])
    if (!data) return null
    // Update copy (report §23.6): the org's current version becomes a new version of this project's copy.
    const updateCopy = async (c: OrgCopyRow) => {
        setCopying(c.nodeId)
        try {
            const response = await fetch(`/api/v1/projects/${data.org.id}/files/${c.sourceNodeId}/preview?download=1`)
            if (!response.ok) throw new Error('Couldn’t read the file')
            const blob = await response.blob()
            const { saveFileRevision } = await import('@/hooks/useFileVersions')
            const saved = await saveFileRevision({ projectId, nodeId: c.nodeId, file: new File([blob], c.name, { type: blob.type }), mode: 'new_revision', comment: `Updated from ${data.org.title} v${c.sourceVersion}`, baseVersion: null })
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
    const orgHref = (nodeId: string) => `/org/${encodeURIComponent(data.org.slug ?? data.org.id)}?tab=files&fileId=${encodeURIComponent(nodeId)}`

    const copy = async (file: OrgBrowseNode) => {
        setCopying(file.id)
        try {
            const response = await fetch(`/api/v1/projects/${data.org.id}/files/${file.id}/preview?download=1`)
            if (!response.ok) throw new Error('Couldn’t read the file')
            const created = await uploadProjectFile(projectId, null, file.name, await response.blob())
            const recorded = await recordOrgCopyAction(projectId, created.id, file.id)
            if (!recorded.success) throw new Error(recorded.error)
            toast.success(`Copied ${file.name} to this workspace`)
            loadCopies()
        } catch (error) {
            toast.error(feedbackError(error instanceof Error ? error.message : 'Copy failed', 'Copy failed'))
        } finally {
            setCopying(null)
        }
    }

    return (
        <div className="space-y-3">
            <nav aria-label={`${data.org.title} folders`} className="flex flex-wrap items-center gap-1 text-[12px] text-muted-foreground">
                <button type="button" onClick={() => setTrail([])} className="hover:text-foreground">{data.org.title}</button>
                {trail.map((step, index) => (
                    <span key={step.id} className="flex items-center gap-1"><ChevronRight className="size-3" aria-hidden="true" />
                        <button type="button" onClick={() => setTrail(trail.slice(0, index + 1))} className="hover:text-foreground">{step.name}</button>
                    </span>
                ))}
                <span className="ml-auto">read-only</span>
            </nav>
            <ul className="divide-y divide-border text-sm">
                {data.nodes.length === 0 ? <li className="py-2 text-muted-foreground">Nothing here.</li> : null}
                {data.nodes.map((n) => (
                    <li key={n.id} className="flex items-center gap-2 py-1.5">
                        {n.type === 'folder' ? <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /> : <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                        {n.type === 'folder'
                            ? <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setTrail([...trail, { id: n.id, name: n.name }])}>{n.name}</button>
                            : <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline" onClick={() => setPeek(n)}>{n.name}</button>}
                        <FolderAccessChip metadata={{ access: n.access }} />
                        {n.type === 'file' && n.currentVersion > 1 ? <span className="text-[11px] text-muted-foreground">v{n.currentVersion}</span> : null}
                        {n.type === 'file' && canCopy ? <Button type="button" size="sm" variant="outline" aria-label={`Copy ${n.name} to this workspace`} disabled={copying !== null} onClick={() => void copy(n)}>{copying === n.id ? 'Copying…' : <><span className="sm:hidden">Copy</span><span className="hidden sm:inline">Copy to this workspace</span></>}</Button> : null}
                    </li>
                ))}
            </ul>
            {peek ? <OrgFilePeek orgId={data.org.id} orgTitle={data.org.title} file={peek} href={orgHref(peek.id)} onClose={() => setPeek(null)} /> : null}
            {copies.length > 0 ? (
                <div className="space-y-1">
                    <p className="text-[12px] font-medium text-muted-foreground">Copied from {data.org.title}</p>
                    <ul className="text-sm">
                        {copies.map((c) => (
                            <li key={c.nodeId} className="flex flex-wrap items-center gap-2 py-1">
                                <span className="truncate">{c.name}</span>
                                <span className="text-[11px] text-muted-foreground">v{c.copiedVersion}</span>
                                {c.sourceVersion !== null && c.sourceVersion > c.copiedVersion ? (
                                    <>
                                        <Link href={orgHref(c.sourceNodeId)} className="text-[12px] underline underline-offset-4">Newer version in {data.org.title} (v{c.sourceVersion})</Link>
                                        {canCopy ? <Button type="button" size="sm" variant="outline" disabled={copying !== null} onClick={() => void updateCopy(c)}>{copying === c.nodeId ? 'Updating…' : 'Update copy'}</Button> : null}
                                    </>
                                ) : null}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    )
}

/** Sprint materials (report §23.3): org files grouped by sprint, read-only, for everyone in the org. */
export function OrgSprintMaterials({ orgId, orgSlug }: { orgId: string; orgSlug: string | null }) {
    const [groups, setGroups] = useState<SprintMaterialsGroup[] | null>(null)
    useEffect(() => { void readOrgSprintMaterialsAction(orgId).then((r) => setGroups(r.success ? r.groups : [])) }, [orgId])
    if (!groups?.length) return null
    const href = (nodeId: string) => `/org/${encodeURIComponent(orgSlug ?? orgId)}?tab=files&fileId=${encodeURIComponent(nodeId)}`
    return (
        <details className="mb-4 rounded-lg border border-border bg-card p-3" data-testid="org-sprint-materials">
            <summary className="cursor-pointer text-sm font-medium">Sprint materials</summary>
            <div className="space-y-3 pt-3">
                {groups.map((g) => (
                    <section key={g.sprintId} aria-label={g.sprint}>
                        <p className="text-[12px] font-medium text-muted-foreground">{g.sprint}{g.status === 'active' ? ' · now' : ''}</p>
                        <ul className="text-sm">
                            {g.files.map((f) => <li key={f.nodeId} className="flex items-center gap-2 py-1"><FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><Link href={href(f.nodeId)} className="min-w-0 truncate hover:underline">{f.name}</Link></li>)}
                        </ul>
                    </section>
                ))}
            </div>
        </details>
    )
}

const REVIEW: Record<string, string> = { pending: 'In review', approved: 'Approved', returned: 'Returned', none: 'Handed in' }

/** Group copies' files from child projects, in the org's Deliverables (report §23.6): "Reviewed by <org>". */
function GroupDeliverables({ orgId }: { orgId: string }) {
    const [rows, setRows] = useState<GroupDeliverableRow[]>([])
    useEffect(() => { void readGroupDeliverablesAction(orgId).then((r) => setRows(r.success ? r.rows : [])) }, [orgId])
    if (!rows.length) return null
    return (
        <details className="mb-4 rounded-lg border border-border bg-card p-3" data-testid="org-group-deliverables">
            <summary className="cursor-pointer text-sm font-medium">Final files from workspaces · {rows.length}</summary>
            <ul className="divide-y divide-border pt-2 text-sm">
                {rows.map((r) => (
                    <li key={r.nodeId} className="flex flex-wrap items-center gap-x-2 py-1.5">
                        <Link href={`/projects/${encodeURIComponent(r.projectSlug ?? r.projectId)}?tab=files&fileId=${encodeURIComponent(r.nodeId)}`} className="min-w-0 truncate hover:underline">{r.name}</Link>
                        <span className="text-[12px] text-muted-foreground">{r.project} · {r.assignment} · {REVIEW[r.review] ?? r.review}</span>
                    </li>
                ))}
            </ul>
        </details>
    )
}

const GB = 1024 ** 3

/** "3.9 GB of 5 GB used", amber from 80% (report §23). */
function OrgStorageLine({ orgId }: { orgId: string }) {
    const [storage, setStorage] = useState<{ usedBytes: number; limitBytes: number; warn: boolean } | null>(null)
    useEffect(() => { void readOrgStorageAction(orgId).then(setStorage) }, [orgId])
    if (!storage) return null
    return (
        <p role={storage.warn ? 'status' : undefined} data-testid="org-storage" className={storage.warn ? 'mb-2 text-[12px] text-amber-700 dark:text-amber-400' : 'mb-2 text-[12px] text-muted-foreground'}>
            {(storage.usedBytes / GB).toFixed(1)} GB of {storage.limitBytes / GB} GB used{storage.warn ? ' · nearly full. Remove old files or empty Trash.' : ''}
        </p>
    )
}

export function OrgFilesPanel({ projectId, mode, canCopy }: { projectId: string; mode: 'org-admin' | 'child'; canCopy: boolean }) {
    return (
        <>
        {mode === 'org-admin' ? <><OrgStorageLine orgId={projectId} /><GroupDeliverables orgId={projectId} /></> : null}
        <details className="mb-4 rounded-lg border border-border bg-card p-3">
            <summary className="cursor-pointer text-sm font-medium">{mode === 'org-admin' ? 'Folder access' : 'From the organization'}</summary>
            <div className="pt-3">
                {mode === 'org-admin' ? <FolderAccessManager orgId={projectId} /> : <FromOrgFiles projectId={projectId} canCopy={canCopy} />}
            </div>
        </details>
        </>
    )
}
