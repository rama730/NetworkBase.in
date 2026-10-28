'use client'

import { useCallback, useEffect, useState, useTransition } from 'react'
import Link from 'next/link'
import { ChevronRight, FileText, Folder } from 'lucide-react'

import {
    browseOrgFilesAction,
    listOrgCopiesAction,
    listOrgFoldersAction,
    recordOrgCopyAction,
    setFolderAccessAction,
    setFolderTemplateAction,
    type OrgBrowseNode,
    type OrgCopyRow,
    type OrgFolderRow,
} from '@/app/actions/org-files'
import { uploadProjectFile } from '@/components/organizations/OrgDocParts'
import { Button } from '@/components/ui/button'
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

/** From <org> (report §23.6): the org tree read-only, with Copy to this project and Source updated hints. */
function FromOrgFiles({ projectId, canCopy }: { projectId: string; canCopy: boolean }) {
    const [trail, setTrail] = useState<Array<{ id: string; name: string }>>([])
    const [data, setData] = useState<{ org: { id: string; title: string; slug: string | null }; nodes: OrgBrowseNode[] } | null>(null)
    const [copies, setCopies] = useState<OrgCopyRow[]>([])
    const [copying, setCopying] = useState<string | null>(null)
    const folderId = trail.at(-1)?.id ?? null
    const loadCopies = useCallback(() => void listOrgCopiesAction(projectId).then((r) => setCopies(r.success ? r.copies : [])), [projectId])
    useEffect(() => {
        void browseOrgFilesAction(projectId, folderId).then((r) => setData(r.success ? { org: r.org, nodes: r.nodes } : null))
    }, [folderId, projectId])
    useEffect(() => { loadCopies() }, [loadCopies])
    if (!data) return null
    const orgHref = (nodeId: string) => `/org/${encodeURIComponent(data.org.slug ?? data.org.id)}?tab=files&fileId=${encodeURIComponent(nodeId)}`

    const copy = async (file: OrgBrowseNode) => {
        setCopying(file.id)
        try {
            const response = await fetch(`/api/v1/projects/${data.org.id}/files/${file.id}/preview?download=1`)
            if (!response.ok) throw new Error('Could not read the file')
            const created = await uploadProjectFile(projectId, null, file.name, await response.blob())
            const recorded = await recordOrgCopyAction(projectId, created.id, file.id)
            if (!recorded.success) throw new Error(recorded.error)
            toast.success(`Copied ${file.name} to this project`)
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
                            : <Link href={orgHref(n.id)} className="min-w-0 flex-1 truncate hover:underline">{n.name}</Link>}
                        <FolderAccessChip metadata={{ access: n.access }} />
                        {n.type === 'file' && n.currentVersion > 1 ? <span className="text-[11px] text-muted-foreground">v{n.currentVersion}</span> : null}
                        {n.type === 'file' && canCopy ? <Button type="button" size="sm" variant="outline" aria-label={`Copy ${n.name} to this project`} disabled={copying !== null} onClick={() => void copy(n)}>{copying === n.id ? 'Copying…' : <><span className="sm:hidden">Copy</span><span className="hidden sm:inline">Copy to this project</span></>}</Button> : null}
                    </li>
                ))}
            </ul>
            {copies.length > 0 ? (
                <div className="space-y-1">
                    <p className="text-[12px] font-medium text-muted-foreground">Copied from {data.org.title}</p>
                    <ul className="text-sm">
                        {copies.map((c) => (
                            <li key={c.nodeId} className="flex flex-wrap items-center gap-2 py-1">
                                <span className="truncate">{c.name}</span>
                                <span className="text-[11px] text-muted-foreground">v{c.copiedVersion}</span>
                                {c.sourceVersion !== null && c.sourceVersion > c.copiedVersion
                                    ? <Link href={orgHref(c.sourceNodeId)} className="text-[12px] underline underline-offset-4">Newer version in {data.org.title} (v{c.sourceVersion})</Link>
                                    : null}
                            </li>
                        ))}
                    </ul>
                </div>
            ) : null}
        </div>
    )
}

export function OrgFilesPanel({ projectId, mode, canCopy }: { projectId: string; mode: 'org-admin' | 'child'; canCopy: boolean }) {
    return (
        <details className="mb-4 rounded-lg border border-border bg-card p-3">
            <summary className="cursor-pointer text-sm font-medium">{mode === 'org-admin' ? 'Folder access' : 'From the organization'}</summary>
            <div className="pt-3">
                {mode === 'org-admin' ? <FolderAccessManager orgId={projectId} /> : <FromOrgFiles projectId={projectId} canCopy={canCopy} />}
            </div>
        </details>
    )
}
