'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { TerminalBlock } from '@/components/ui/terminal-block';
import Link from 'next/link'
import { FolderOpen } from 'lucide-react'
import { FileTypeChip } from '@/components/workspaces/v2/files-tab/FileTypeChip'
import { EmptyState } from '@/components/ui/EmptyState'
import { Notice } from '@/components/ui/notice'
import { Crumbs } from '@/components/organizations/org-ui'

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
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
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
        toast.success(`${folder.name} saved`)
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
                <div role="radiogroup" aria-label="Who can see this" className="space-y-2.5 text-[13px]">
                    {options.map((o) => (
                        <label key={o.label} className="flex items-center gap-2.5">
                            <input type="radio" className="nb-radio" name="folder-access" checked={(choice ?? null) === o.value} onChange={() => setChoice(o.value)} />
                            {o.label}
                        </label>
                    ))}
                </div>
                {line ? <p role="status" className="text-[13px] text-muted-foreground">{line}</p> : null}
                <label className="flex items-center gap-2.5 text-[13px]">
                    <input type="checkbox" className="nb-check" checked={template && choice !== 'admins'} disabled={choice === 'admins'} onChange={(e) => setTemplate(e.target.checked)} />
                    Use as template for new workspaces
                </label>
                {choice === 'admins' ? <p className="text-[13px] text-muted-foreground">Admins-only folders can’t be templates.</p> : null}
                <DialogFooter paper>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button disabled={pending} onClick={save}>Save access</Button>
                </DialogFooter>
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
        <div data-testid="org-storage" className="mb-2"><Notice tone={percent >= 100 ? 'danger' : 'warning'} action={<Link href={`${orgPath(org)}?tab=settings`} className="nb-link text-[13px]">Manage storage</Link>}>
            {percent >= 100 ? 'Storage is full.' : `Storage is ${percent}% full.`}
        </Notice></div>
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
            <DialogContent size="wide" className="max-h-[90dvh] max-w-3xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>{file.name}</DialogTitle>
                    <DialogDescription>From {orgTitle} · Read-only · <Link href={href} className="nb-link">Open in {orgTitle}</Link></DialogDescription>
                </DialogHeader>
                {body === null ? <div className="nb-skeleton h-64 rounded-md" role="status" aria-label={`Loading ${file.name}`} />
                    : body.kind === 'image' ? <img src={body.url} alt={file.name} className="max-h-[70dvh] w-full object-contain" />
                        : body.kind === 'text' ? <TerminalBlock variant="code" label={file.name} lines collapseAfter={400} wrap className="max-h-[70dvh] overflow-auto">{body.text}</TerminalBlock>
                            : <p className="text-[13px] text-muted-foreground">This file opens in {orgTitle}.</p>}
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
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Copy {name}</DialogTitle>
                    <DialogDescription>Pick the folder in this workspace.</DialogDescription>
                </DialogHeader>
                <Crumbs label="Folders" items={[{ key: 'top', name: 'Top folder' }, ...trail.map((t) => ({ key: t.id, name: t.name }))]} onGo={(i) => setTrail(trail.slice(0, i))} />
                {folders === null ? <div className="nb-skeleton h-16 rounded-md" role="status" aria-label="Loading folders" /> : folders.length === 0 ? <p className="text-[13px] text-muted-foreground">No folders inside.</p> : (
                    <ul className="max-h-64 divide-y divide-border overflow-y-auto text-[13px]">
                        {folders.map((f) => (
                            <li key={f.id}>
                                <button type="button" className="flex min-h-11 w-full items-center gap-2.5 text-left hover:underline" onClick={() => setTrail([...trail, f])}>
                                    <FileTypeChip name={f.name} isFolder />{f.name}
                                </button>
                            </li>
                        ))}
                    </ul>
                )}
                <DialogFooter paper>
                    <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
                    <Button type="button" onClick={() => onPick(parentId)}>Copy to {trail.at(-1)?.name ?? 'top folder'}</Button>
                </DialogFooter>
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
            <p className="text-[13px] text-muted-foreground">{org.title} · Read-only · <Link href={`${orgPath(org)}?tab=files`} className="nb-link">Open in {org.title}</Link></p>
            {trail.length ? <Crumbs label={`${org.title} folders`} items={[{ key: 'org', name: org.title }, ...trail.map((t) => ({ key: t.id, name: t.name }))]} onGo={(i) => setTrail(trail.slice(0, i))} /> : null}
            {nodes.length === 0 ? <EmptyState icon={FolderOpen} title={trail.length ? 'Nothing here' : `${org.title} hasn’t shared files yet`} description={trail.length ? 'This folder is empty.' : 'Files the organization shares with workspaces show here.'} /> : (
                <ul className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card text-[13px]">
                    {nodes.map((n) => {
                        const mine = copiesBySource.get(n.id)
                        const newer = mine && mine.sourceVersion !== null && mine.sourceVersion > mine.copiedVersion
                        return (
                            <li key={n.id} className="flex min-h-12 flex-wrap items-center gap-2.5 px-3 py-1.5">
                                <FileTypeChip name={n.name} isFolder={n.type === 'folder'} />
                                <button type="button" className="min-w-0 flex-1 truncate text-left hover:underline"
                                    onClick={() => (n.type === 'folder' ? setTrail([...trail, { id: n.id, name: n.name }]) : setPeek(n))}>{n.name}</button>
                                <FolderAccessChip metadata={{ access: n.access }} />
                                {n.type === 'file' && n.currentVersion > 1 ? <span className="nb-meta">v{n.currentVersion}</span> : null}
                                {mine && !newer ? <span className="nb-meta">Copied · v{mine.copiedVersion}</span> : null}
                                {newer && org.canCopy ? (
                                    <Button type="button" size="sm" variant="outline" disabled={copying !== null} onClick={() => setAskUpdate(mine)}>Newer version · Update copy</Button>
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
