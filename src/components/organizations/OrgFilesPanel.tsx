'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronRight, FileText, Folder } from 'lucide-react'

import {
    browseOrgFilesAction,
    listOrgCopiesAction,
    readOrgStorageAction,
    recordOrgCopyAction,
    setFolderAccessAction,
    setFolderTemplateAction,
    type OrgBrowseNode,
    type OrgCopyRow,
} from '@/app/actions/org-files'
import { uploadWorkspaceFile } from '@/components/organizations/OrgDocParts'
import { FinalFilesBrowser, SprintMaterialsBrowser, SubmissionsBrowser } from '@/components/organizations/OrgFileViews'
import { getWorkspaceNodes } from '@/app/actions/files/nodes'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { readFolderAccess, type FolderAccess } from '@/lib/organizations/file-rules'
import { FolderAccessChip } from '@/components/organizations/FolderAccessChip'
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
    // Files report §1–§2: Submissions, Sprint materials and Final files are browsed the Task files way, edge to edge.
    if (view === 'from_org') return <div className="flex-1 overflow-y-auto p-4" data-testid="org-files-from_org"><FromOrgFiles projectId={projectId} org={org} /></div>
    return (
        <div className="flex min-h-0 flex-1 flex-col" data-testid={`org-files-${view}`}>
            {view === 'materials' ? <SprintMaterialsBrowser org={org} /> : org.mode === 'org' ? <SubmissionsBrowser org={org} /> : <FinalFilesBrowser projectId={projectId} />}
        </div>
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

/** Where a copy from the organization goes: this workspace's folders, one level at a time. */
function CopyToFolderDialog({ projectId, name, onClose, onPick }: { projectId: string; name: string; onClose: () => void; onPick: (parentId: string | null) => void }) {
    const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([])
    const [folders, setFolders] = useState<Array<{ id: string; name: string }> | null>(null)
    const parentId = trail.at(-1)?.id ?? null
    useEffect(() => {
        setFolders(null)
        void getWorkspaceNodes(projectId, parentId, undefined, 100, undefined, { itemType: 'folder' })
            .then((r) => setFolders(r.nodes.filter((n) => n.type === 'folder').map((n) => ({ id: n.id, name: n.name }))), () => setFolders([]))
    }, [parentId, projectId])
    return (
        <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
            <DialogContent className="max-w-md">
                <DialogHeader>
                    <DialogTitle>Copy {name}</DialogTitle>
                    <DialogDescription>Pick the folder in this workspace.</DialogDescription>
                </DialogHeader>
                <nav aria-label="Folders" className="flex flex-wrap items-center gap-1 text-[12px] text-muted-foreground">
                    <button type="button" onClick={() => setTrail([])} className="hover:text-foreground">Top folder</button>
                    {trail.map((step, index) => (
                        <span key={step.id} className="flex items-center gap-1"><ChevronRight className="size-3" aria-hidden="true" />
                            <button type="button" onClick={() => setTrail(trail.slice(0, index + 1))} className="hover:text-foreground">{step.name}</button>
                        </span>
                    ))}
                </nav>
                {folders === null ? <div className="nb-skeleton h-16 rounded-md" aria-label="Loading folders" /> : folders.length === 0 ? <p className="text-sm text-muted-foreground">No folders inside.</p> : (
                    <ul className="max-h-64 divide-y divide-border overflow-y-auto text-sm">
                        {folders.map((f) => (
                            <li key={f.id}>
                                <button type="button" className="flex w-full items-center gap-2 py-1.5 text-left hover:underline" onClick={() => setTrail([...trail, f])}>
                                    <Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />{f.name}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <div className="flex justify-end gap-2">
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button type="button" onClick={() => onPick(parentId)}>Copy to {trail.at(-1)?.name ?? 'top folder'}</Button>
                </div>
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
    const [copyTarget, setCopyTarget] = useState<OrgBrowseNode | null>(null)
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
    // The copy goes into the folder picked in CopyToFolderDialog (step 8 gap); null is the top folder.
    const copy = async (file: OrgBrowseNode, parentId: string | null) => {
        setCopying(file.id)
        try {
            const response = await fetch(`/api/v1/workspaces/${org.orgId}/files/${file.id}/preview`)
            if (!response.ok) throw new Error('Couldn’t read the file')
            const created = await uploadWorkspaceFile(projectId, parentId, file.name, await response.blob())
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
                                    <Button type="button" size="sm" variant="outline" aria-label={`Copy ${n.name} to this workspace`} disabled={copying !== null} onClick={() => setCopyTarget(n)}>
                                        {copying === n.id ? 'Copying…' : 'Copy to this workspace'}
                                    </Button>
                                ) : null}
                            </li>
                        )
                    })}
                </ul>
            )}
            {peek ? <OrgFilePeek orgId={org.orgId} orgTitle={org.title} file={peek} href={fileHref(org, peek.id)} onClose={() => setPeek(null)} /> : null}
            {copyTarget ? <CopyToFolderDialog projectId={projectId} name={copyTarget.name} onClose={() => setCopyTarget(null)} onPick={(parentId) => { const file = copyTarget; setCopyTarget(null); void copy(file, parentId) }} /> : null}
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
