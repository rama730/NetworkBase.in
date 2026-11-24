'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Lock, MoreHorizontal, Plus, X } from '@/components/ui/icons'

import {
    ensureDocsFolderAction,
    markDocOpenedAction,
    publishOrgDocAction,
    readOrgDocsAction,
    readOrgTemplateCopyAction,
    readTemplateTargetsAction,
    readUnreadDocPeopleAction,
    remindUnreadDocAction,
    saveOrgDocGroupsAction,
    updateOrgDocOptionsAction,
    type OrgDocItem,
    type OrgDocsData,
} from '@/app/actions/org-docs'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { toast } from '@/lib/feedback'
import { Input } from '@/components/ui/input'
import { docTitle, type DocGroup } from '@/lib/organizations/doc-rules'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { formatDistanceToNow } from '@/lib/utils/date'
import { buildWorkspaceFileKey } from '@/lib/storage/workspace-file-key'
import { uploadToSupabaseSignedUrl } from '@/lib/upload/supabase-signed-upload-client'
import { cn } from '@/lib/utils'
import { NotYetDialog, StatusBadge } from '@/components/organizations/org-ui'
import { fieldError, fieldHint, fieldLabel } from '@/lib/organizations/display'
import { Notice } from '@/components/ui/notice'

// Org Docs (report §19): labels and groups in the doc rail, the From <org> section in child projects,
// admin options, and saving a new Markdown doc (New doc, template copies).

export const ORG_DOCS_QUERY_KEY = (projectId: string) => ['org-docs', projectId] as const

export function useOrgDocs(projectId: string, enabled = true) {
    return useQuery({
        queryKey: ORG_DOCS_QUERY_KEY(projectId),
        enabled,
        queryFn: async () => {
            const result = await readOrgDocsAction(projectId)
            return result.success ? result.data : null
        },
        staleTime: 60_000,
    })
}

/** Uploads bytes as a new file in a project folder (the Files upload path: presign, upload, node). */
export async function uploadWorkspaceFile(projectId: string, folderId: string | null, filename: string, blob: Blob) {
    const [{ getUploadPresignedUrl }, { createFileNode }] = await Promise.all([
        import('@/app/actions/upload'),
        import('@/app/actions/files/mutations'),
    ])
    const contentType = blob.type || 'application/octet-stream'
    const extension = filename.includes('.') ? filename.split('.').pop() : 'bin'
    const presigned = await getUploadPresignedUrl(buildWorkspaceFileKey(projectId, `${crypto.randomUUID()}.${extension}`), contentType, blob.size)
    if ('error' in presigned) throw new Error(presigned.error || 'Couldn’t prepare upload')
    await uploadToSupabaseSignedUrl({
        bucket: 'project-files',
        storagePath: presigned.storageKey,
        uploadToken: presigned.token,
        uploadUrl: presigned.url,
        contentType,
        operationId: presigned.uploadIntentId,
    }, blob, { cacheProfile: 'immutable' })
    return createFileNode(projectId, folderId, {
        name: filename,
        s3Key: presigned.storageKey,
        size: blob.size,
        mimeType: contentType,
        uploadIntentId: presigned.uploadIntentId,
    })
}

/** Saves a Markdown file in the project's Docs folder and adds it to Docs (the Files upload path). */
export async function createDocFile(projectId: string, filename: string, content: string) {
    const folder = await ensureDocsFolderAction(projectId)
    if (!folder.success) throw new Error(folder.error)
    const node = await uploadWorkspaceFile(projectId, folder.folderId, filename, new Blob([content], { type: 'text/plain' }))
    const { linkWorkspaceDocAction } = await import('@/app/actions/workspace/doc')
    const linked = await linkWorkspaceDocAction(projectId, node.id).catch(() => ({ success: false as const, error: 'Couldn’t add it to Docs.' }))
    if (!linked.success) {
        // Audit N87: the upload isn't left behind as a stray file when adding it to Docs fails.
        const { bulkTrashNodes } = await import('@/app/actions/files/mutations')
        await bulkTrashNodes([node.id], projectId).catch(() => undefined)
        throw new Error(linked.error)
    }
    return { node, slug: linked.slug, id: linked.id }
}

/** A document's state, the same badge in the list and in the reader's header (spec §10 Badge). */
export function OrgDocChips({ item }: { item?: OrgDocItem }) {
    if (!item) return null
    return (
        <span className="flex shrink-0 items-center gap-1">
            {item.label === 'new' ? <StatusBadge state="new">New</StatusBadge> : null}
            {item.label === 'updated' ? <StatusBadge state="updated">Updated</StatusBadge> : null}
            {item.state === 'draft' ? <StatusBadge state="draft">Draft</StatusBadge> : null}
            {item.state === 'changed' ? <StatusBadge state="changed">Changed</StatusBadge> : null}
            {item.required ? <StatusBadge state="required">Required</StatusBadge> : null}
            {item.sprint ? <span className="nb-meta">{item.sprint}</span> : null}
        </span>
    )
}

/** Opening an org doc clears its New label (report §19.4). */
export function useMarkOrgDocOpened(orgId: string | null, docSlug: string | null, labelProjectId: string) {
    const queryClient = useQueryClient()
    const marked = useRef<string | null>(null)
    useEffect(() => {
        if (!orgId || !docSlug || marked.current === `${orgId}:${docSlug}`) return
        marked.current = `${orgId}:${docSlug}`
        void markDocOpenedAction(orgId, docSlug).then((result) => {
            if (result.success) void queryClient.invalidateQueries({ queryKey: ORG_DOCS_QUERY_KEY(labelProjectId) })
        })
    }, [docSlug, labelProjectId, orgId, queryClient])
}

/** "From CSE-3A" at the bottom of a child project's doc list: read-only org docs, opened in place (§19.7). */
export function FromOrgDocs({ data, activeSlug }: { data: OrgDocsData; activeSlug: string | null }) {
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    if (data.mode !== 'child' || data.docs.length === 0) return null
    const open = (slug: string) => {
        const params = new URLSearchParams(searchParams?.toString() ?? '')
        params.set('tab', 'docs')
        params.set('doc', slug)
        params.set('from', 'org')
        router.push(`${pathname}?${params.toString()}`, { scroll: false })
    }
    return (
        <div className="space-y-1 pt-3">
            <p className="nb-micro pb-1">From {data.orgTitle}</p>
            {data.groups.map((group) => {
                const docs = data.docs.filter((d) => d.group === group.id)
                if (docs.length === 0) return null
                return (
                    <div key={group.id} className="space-y-1">
                        <p className="px-1 text-[11px] text-muted-foreground">{group.name}</p>
                        {docs.map((doc) => (
                            <button key={doc.id} type="button" onClick={() => open(doc.slug)}
                                aria-current={searchParams?.get('from') === 'org' && doc.slug === activeSlug ? 'page' : undefined}
                                className="flex w-full items-center gap-2 rounded-md border border-border bg-card px-2.5 py-2 text-left text-[13px] font-medium text-foreground hover:bg-muted aria-[current=page]:bg-muted aria-[current=page]:text-foreground">
                                <Lock className="size-3.5 shrink-0" aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate">{docTitle(doc.filename)}</span>
                                <OrgDocChips item={doc} />
                            </button>
                        ))}
                    </div>
                )
            })}
        </div>
    )
}

/** Per-doc options, Publish & notify, and the group editor, for org owners and admins (report §19.3, §19.6). */
export function OrgDocAdminTools({ data, doc, visibility }: { data: OrgDocsData; doc: OrgDocItem | undefined; visibility: string }) {
    const queryClient = useQueryClient()
    const [pending, startTransition] = useTransition()
    const [status, setStatus] = useState<string | null>(null)
    const [publishOpen, setPublishOpen] = useState(false)
    const [editingGroups, setEditingGroups] = useState(false)
    if (data.mode !== 'org' || !data.isAdmin || !doc) return null
    const run = (work: () => Promise<{ success: boolean; error?: string }>, done: string) => startTransition(async () => {
        const result = await work()
        if (!result.success) { setStatus(result.error ?? 'Something went wrong.'); return }
        setStatus(null)
        toast.success(done)
        if (result.success) await queryClient.invalidateQueries({ queryKey: ORG_DOCS_QUERY_KEY(data.orgId) })
    })
    const setOption = (patch: Parameters<typeof updateOrgDocOptionsAction>[2]) => run(() => updateOrgDocOptionsAction(data.orgId, doc.id, patch), 'Saved')
    const box = 'flex items-center gap-2.5 text-[13px] text-foreground'
    return (
        <div className="space-y-4 text-[13px]" aria-label="Document options">
            <label className="block"><span className={fieldLabel}>Group</span>
                <select value={doc.group} disabled={pending} onChange={(e) => setOption({ group: e.target.value })} className="nb-select mt-1.5 w-full">
                    {data.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
            </label>
            <label className="block"><span className={fieldLabel}>Visibility</span>
                <select value={visibility === 'public' ? 'public' : 'members_only'} disabled={pending} onChange={(e) => setOption({ visibility: e.target.value as 'public' | 'members_only' })} className="nb-select mt-1.5 w-full] border border-border bg-background px-2">
                    <option value="members_only">Organization only</option>
                    <option value="public">Public</option>
                </select>
                <span className={`block ${fieldHint}`}>Public shows it to anyone once published. An empty document never shows to visitors.</span>
            </label>
            {data.sprints.length > 0 || doc.sprintId ? (
                <label className="block"><span className={fieldLabel}>Linked sprint</span>
                    <select value={doc.sprintId ?? ''} disabled={pending} onChange={(e) => setOption({ sprintId: e.target.value || null })} className="nb-select mt-1.5 w-full">
                        <option value="">None</option>
                        {doc.sprintId && !data.sprints.some((s) => s.id === doc.sprintId) ? <option value={doc.sprintId}>{doc.sprint}</option> : null}
                        {data.sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </label>
            ) : null}
            <label className={box}><input type="checkbox" className="nb-check" checked={doc.required} disabled={pending} onChange={(e) => setOption({ required: e.target.checked })} /> Required reading</label>
            <label className={box}><input type="checkbox" className="nb-check" checked={doc.template} disabled={pending} onChange={(e) => setOption({ template: e.target.checked })} /> Template · moves it to Templates</label>
            <label className={box}><input type="checkbox" className="nb-check" checked={doc.showInChildren} disabled={pending} onChange={(e) => setOption({ showInChildren: e.target.checked })} /> Show in every workspace in the organization</label>
            {/* Report §37.4, decision 101: where it stands, and Publish when there's something to publish. */}
            <div className="space-y-2 rounded-md bg-muted p-3">
                <p>{doc.state === 'draft' ? 'Draft · only admins see it' : doc.state === 'changed' ? 'Unpublished changes · members see the last published version' : 'Published'}</p>
                {doc.state !== 'published' ? <Button type="button" size="sm" disabled={pending} onClick={() => setPublishOpen(true)}>Publish…</Button> : null}
                {doc.readers ? <ReadByLine orgId={data.orgId} docId={doc.id} readers={doc.readers} /> : null}
            </div>
            {doc.template ? <UseTemplateButton orgId={data.orgId} docId={doc.id} /> : null}
            <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} required={doc.required} memberCount={data.memberCount}
                onPublish={(input) => run(() => publishOrgDocAction(data.orgId, doc.id, input), input.notify ? 'Published, and members were told' : 'Published')} />
            <Button type="button" size="sm" variant="outline" aria-expanded={editingGroups} onClick={() => setEditingGroups((v) => !v)}>{editingGroups ? 'Close groups' : 'Edit groups'}</Button>
            {editingGroups ? <GroupEditor orgId={data.orgId} groups={data.groups} onSaved={() => { setEditingGroups(false); void queryClient.invalidateQueries({ queryKey: ORG_DOCS_QUERY_KEY(data.orgId) }) }} /> : null}
            {status ? <p role="alert" className={fieldError}>{status}</p> : null}
        </div>
    )
}

/**
 * The reader's header (live-fix 22, 24; report §7.4): the title, who updated it and when, where it stands, Edit, and
 * ⋯ for the options that used to sit in the rail, Publish, History and Remove.
 */
export function OrgDocHeader({ data, doc, updatedBy, updatedAt, editHref, onRemove, visibility }: {
    data: OrgDocsData; doc: OrgDocItem; updatedBy: string | null; updatedAt: string | null; editHref: string | null; onRemove: (() => void) | null; visibility: string
}) {
    const queryClient = useQueryClient()
    const [optionsOpen, setOptionsOpen] = useState(false)
    const [publishOpen, setPublishOpen] = useState(false)
    const [pending, startTransition] = useTransition()
    const admin = data.mode === 'org' && data.isAdmin
    const status = admin ? (doc.state === 'draft' ? 'Draft' : doc.state === 'changed' ? 'Unpublished changes' : 'Published') : doc.label === 'new' ? 'New' : doc.label === 'updated' ? 'Updated' : 'Read'
    return (
        <header className="mb-5 space-y-1.5 border-b border-border pb-4" data-testid="org-doc-header">
            <div className="flex items-start gap-2">
                <h1 className="nb-section-title min-w-0 flex-1 break-words">{docTitle(doc.filename)}</h1>
                {editHref ? <Button asChild size="sm" variant="outline"><Link href={editHref}>Edit</Link></Button> : null}
                {admin || onRemove ? (
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild><button type="button" aria-label="Document actions" className="nb-touch-target inline-flex size-[var(--ui-control-height-sm)] items-center justify-center rounded-md text-muted-foreground hover:bg-muted"><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                            {admin ? <DropdownMenuItem onSelect={() => setOptionsOpen(true)}>Options…</DropdownMenuItem> : null}
                            {admin && doc.state !== 'published' ? <DropdownMenuItem onSelect={() => setPublishOpen(true)}>Publish…</DropdownMenuItem> : null}
                            {editHref ? <DropdownMenuItem asChild><Link href={`${editHref}&filesPanel=version_history`}>History</Link></DropdownMenuItem> : null}
                            {onRemove ? <DropdownMenuItem variant="destructive" onSelect={onRemove}>Remove</DropdownMenuItem> : null}
                        </DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
            </div>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-muted-foreground">
                {updatedAt ? <span>Updated by {updatedBy ?? 'someone'} · {formatDistanceToNow(new Date(updatedAt), { addSuffix: true })}</span> : null}
                <StatusBadge state={admin ? (doc.state === 'published' ? 'published' : doc.state) : (doc.label ?? 'read')}>{status}</StatusBadge>
                {admin && doc.readers ? <ReadByLine orgId={data.orgId} docId={doc.id} readers={doc.readers} /> : null}
            </p>
            {admin ? (
                <Dialog open={optionsOpen} onOpenChange={setOptionsOpen}>
                    <DialogContent>
                        <DialogHeader><DialogTitle>Document options</DialogTitle><DialogDescription>Group, who can see it and where it shows.</DialogDescription></DialogHeader>
                        <OrgDocAdminTools data={data} doc={doc} visibility={visibility} />
                    </DialogContent>
                </Dialog>
            ) : null}
            {admin ? <PublishDialog open={publishOpen} onOpenChange={setPublishOpen} required={doc.required} memberCount={data.memberCount}
                onPublish={(input) => startTransition(async () => {
                    const result = await publishOrgDocAction(data.orgId, doc.id, input)
                    if (!result.success) return void toast.error(result.error ?? 'Couldn’t publish.')
                    toast.success(input.notify ? 'Published, and members were told' : 'Published')
                    await queryClient.invalidateQueries({ queryKey: ORG_DOCS_QUERY_KEY(data.orgId) })
                })} /> : null}
            {pending ? <span className="sr-only" role="status">Publishing…</span> : null}
        </header>
    )
}

/** Rename, reorder and add groups; ids stay so docs keep their group (report §19.2). */
function GroupEditor({ orgId, groups, onSaved }: { orgId: string; groups: DocGroup[]; onSaved: () => void }) {
    const [rows, setRows] = useState(groups)
    const [removing, setRemoving] = useState<DocGroup | null>(null)
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const move = (index: number, by: number) => setRows((current) => {
        const next = [...current]
        const [row] = next.splice(index, 1)
        next.splice(index + by, 0, row!)
        return next
    })
    return (
        <div className="space-y-1.5">
            {rows.map((row, index) => (
                <div key={row.id} className="flex items-center gap-1">
                    <Input value={row.name} maxLength={40} aria-label={`Group ${index + 1} name`} className="h-[var(--ui-control-height-sm)] text-[13px]"
                        onChange={(e) => setRows((current) => current.map((g) => (g.id === row.id ? { ...g, name: e.target.value } : g)))} />
                    <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)} className="nb-icon-button size-7 rounded-md text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"><ArrowUp className="size-3.5" /></button>
                    <button type="button" aria-label="Move down" disabled={index === rows.length - 1} onClick={() => move(index, 1)} className="nb-icon-button size-7 rounded-md text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"><ArrowDown className="size-3.5" /></button>
                    <button type="button" aria-label="Remove group" disabled={rows.length === 1} onClick={() => setRemoving(row)} className="nb-icon-button size-7 rounded-md text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50"><X className="size-3.5" /></button>
                </div>
            ))}
            <div className="flex gap-1.5">
                <Button type="button" size="sm" variant="outline" onClick={() => setRows((current) => [...current, { id: `g-${crypto.randomUUID().slice(0, 8)}`, name: 'New group' }])}><Plus className="size-3.5" /> Add</Button>
                <Button type="button" size="sm" disabled={pending} onClick={() => startTransition(async () => {
                    const result = await saveOrgDocGroupsAction(orgId, rows.map((g) => ({ ...g, name: g.name.trim() })))
                    if (!result.success) return setError(result.error)
                    onSaved()
                })}>Save groups</Button>
            </div>
            {error ? <p role="alert" className={fieldError}>{error}</p> : null}
            {/* Report §28.4: removing a group moves its documents to the first group, after a confirmation. */}
            <ConfirmDialog open={Boolean(removing)} onOpenChange={(open) => { if (!open) setRemoving(null) }} title={`Remove ${removing?.name ?? 'this group'}?`}
                description={`Its documents move to ${rows.find((g) => g.id !== removing?.id)?.name ?? 'the first group'}.`} confirmLabel="Remove group"
                onConfirm={() => { setRows((current) => current.filter((g) => g.id !== removing?.id)); setRemoving(null) }} />
        </div>
    )
}

/** Publish (report §37.4): what changed, Tell members off by default, Ask to re-read on Required documents. */
function PublishDialog({ open, onOpenChange, required, memberCount, onPublish }: { open: boolean; onOpenChange: (open: boolean) => void; required: boolean; memberCount: number; onPublish: (input: { summary: string; reread: boolean; notify: boolean }) => void }) {
    const [summary, setSummary] = useState('')
    const [notify, setNotify] = useState(false)
    const [reread, setReread] = useState(false)
    const people = `${memberCount} ${memberCount === 1 ? 'person' : 'people'}`
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>Publish</DialogTitle>
                    <DialogDescription>Members will read this version. Edits after this wait until you publish again.</DialogDescription>
                </DialogHeader>
                <label className="block"><span className={fieldLabel}>What changed? (optional)</span><Input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={200} className="mt-1.5" /></label>
                <label className="flex items-center gap-2.5 text-[13px]"><input type="checkbox" className="nb-check" checked={notify} onChange={(e) => setNotify(e.target.checked)} /> Tell members</label>
                {required ? <label className="flex items-center gap-2.5 text-[13px]"><input type="checkbox" className="nb-check" checked={reread} onChange={(e) => setReread(e.target.checked)} /> Ask to re-read · Read by counts from zero</label> : null}
                <DialogFooter paper>
                    <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
                    <Button onClick={() => { onPublish({ summary, notify, reread: required && reread }); onOpenChange(false) }}>{notify ? `Publish and tell ${people}` : 'Publish'}</Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

/** "Read by 32 of 40" (report §28.4, decision 58): the shared NotYetDialog. "Read" means opened. */
function ReadByLine({ orgId, docId, readers }: { orgId: string; docId: string; readers: { read: number; total: number } }) {
    return <NotYetDialog verb="Read" done={readers.read} total={readers.total} queryKey={['org-doc-unread', docId]}
        load={() => readUnreadDocPeopleAction(orgId, docId)} remind={() => remindUnreadDocAction(orgId, docId)}
        title="Not read yet" description="“Read” means they opened it. We can’t know more than that." emptyLine="Everyone has opened it." />
}

/** Use this template (report §28.4): pick one of your workspaces; a filled copy is made there and doesn't update later. */
function UseTemplateButton({ orgId, docId }: { orgId: string; docId: string }) {
    const router = useRouter()
    const [open, setOpen] = useState(false)
    const [busy, setBusy] = useState(false)
    const targets = useQuery({ queryKey: ['org-template-targets', orgId], queryFn: () => readTemplateTargetsAction(orgId), enabled: open })
    const list = targets.data?.success ? targets.data.workspaces : []
    const use = async (workspaceId: string) => {
        setBusy(true)
        try {
            const copy = await readOrgTemplateCopyAction(workspaceId, docId)
            if (!copy.success) throw new Error(copy.error)
            const made = await createDocFile(workspaceId, copy.filename, copy.content)
            router.push(`/workspaces/${encodeURIComponent(workspaceId)}?tab=docs&doc=${encodeURIComponent(made.slug)}`)
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Couldn’t copy the template')
        } finally {
            setBusy(false)
        }
    }
    return (
        <>
            <Button type="button" size="sm" variant="outline" onClick={() => setOpen(true)}>Use this template</Button>
            <Dialog open={open} onOpenChange={setOpen}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Use this template</DialogTitle>
                        <DialogDescription>A copy goes into the workspace you pick. Later changes here don’t reach it.</DialogDescription>
                    </DialogHeader>
                    {targets.isPending ? <div className="nb-skeleton h-16 rounded-md" role="status" aria-label="Loading workspaces" /> : list.length === 0 ? <p className="text-[13px] text-muted-foreground">You’re not in a workspace here yet.</p> : (
                        <ul className="space-y-1">{list.map((w) => <li key={w.id}><Button variant="ghost" className="w-full justify-start" disabled={busy} onClick={() => void use(w.id)}>{w.title}</Button></li>)}</ul>
                    )}
                </DialogContent>
            </Dialog>
        </>
    )
}

/** An org doc opened inside a child project: read-only, with the way back to the org (report §19.7). */
export function OrgDocBanner({ orgTitle, href, backHref }: { orgTitle: string; href: string; backHref: string }) {
    return (
        <Notice className="mb-4" action={<><Link href={href} className="nb-link text-[13px]">Open in {orgTitle}</Link><Link href={backHref} className="nb-link text-[13px]">Workspace documents</Link></>}>
            <span className="font-medium">From {orgTitle}</span><span className="text-muted-foreground"> · Read-only</span>
        </Notice>
    )
}
