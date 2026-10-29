'use client'

import { useEffect, useRef, useState, useTransition } from 'react'
import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Lock, Plus, X } from 'lucide-react'

import {
    ensureDocsFolderAction,
    markDocOpenedAction,
    publishOrgDocAction,
    readOrgDocsAction,
    saveOrgDocGroupsAction,
    updateOrgDocOptionsAction,
    type OrgDocItem,
    type OrgDocsData,
} from '@/app/actions/org-docs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { DocGroup } from '@/lib/organizations/doc-rules'
import { buildProjectFileKey } from '@/lib/storage/project-file-key'
import { uploadToSupabaseSignedUrl } from '@/lib/upload/supabase-signed-upload-client'
import { cn } from '@/lib/utils'

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
export async function uploadProjectFile(projectId: string, folderId: string | null, filename: string, blob: Blob) {
    const [{ getUploadPresignedUrl }, { createFileNode }] = await Promise.all([
        import('@/app/actions/upload'),
        import('@/app/actions/files/mutations'),
    ])
    const contentType = blob.type || 'application/octet-stream'
    const extension = filename.includes('.') ? filename.split('.').pop() : 'bin'
    const presigned = await getUploadPresignedUrl(buildProjectFileKey(projectId, `${crypto.randomUUID()}.${extension}`), contentType, blob.size)
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
    const node = await uploadProjectFile(projectId, folder.folderId, filename, new Blob([content], { type: 'text/plain' }))
    const { linkProjectDocAction } = await import('@/app/actions/project/doc')
    const linked = await linkProjectDocAction(projectId, node.id)
    if (!linked.success) throw new Error(linked.error)
    return { node, slug: linked.slug, id: linked.id }
}

const chip = 'inline-flex shrink-0 items-center rounded-[3px] border border-border px-1 font-mono text-[10px] uppercase tracking-wider text-muted-foreground'

export function OrgDocChips({ item }: { item?: OrgDocItem }) {
    if (!item) return null
    return (
        <span className="flex shrink-0 items-center gap-1">
            {item.label === 'new' ? <span className="rounded-[3px] bg-foreground px-1 font-mono text-[10px] uppercase tracking-wider text-background">New</span> : null}
            {item.label === 'updated' ? <span className={chip}>Updated</span> : null}
            {item.required ? <span className={chip} title="Required reading">Req</span> : null}
            {item.sprint ? <span className={chip}>{item.sprint}</span> : null}
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
            <p className="nb-ui-label pb-1 text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">From {data.orgTitle}</p>
            {data.groups.map((group) => {
                const docs = data.docs.filter((d) => d.group === group.id)
                if (docs.length === 0) return null
                return (
                    <div key={group.id} className="space-y-1">
                        <p className="px-1 text-[11px] text-muted-foreground">{group.name}</p>
                        {docs.map((doc) => (
                            <button key={doc.id} type="button" onClick={() => open(doc.slug)}
                                aria-current={searchParams?.get('from') === 'org' && doc.slug === activeSlug ? 'page' : undefined}
                                className="flex w-full items-center gap-2 rounded-[5px] border border-border bg-card px-2.5 py-2 text-left text-[13px] text-muted-foreground hover:bg-muted/40 hover:text-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground">
                                <Lock className="size-3.5 shrink-0" aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate">{doc.filename}</span>
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
    const [summary, setSummary] = useState('')
    const [reread, setReread] = useState(false)
    const [editingGroups, setEditingGroups] = useState(false)
    if (data.mode !== 'org' || !data.isAdmin || !doc) return null
    const run = (work: () => Promise<{ success: boolean; error?: string }>, done: string) => startTransition(async () => {
        const result = await work()
        setStatus(result.success ? done : result.error ?? 'Something went wrong.')
        if (result.success) await queryClient.invalidateQueries({ queryKey: ORG_DOCS_QUERY_KEY(data.orgId) })
    })
    const setOption = (patch: Parameters<typeof updateOrgDocOptionsAction>[2]) => run(() => updateOrgDocOptionsAction(data.orgId, doc.id, patch), 'Saved')
    const box = 'flex items-center gap-2 text-[12px] text-foreground'
    return (
        <div className="space-y-3 border-t border-border pt-3 text-[12px]" aria-label="Doc options">
            <p className="nb-ui-label text-[11px] font-semibold uppercase tracking-[0.09em] text-muted-foreground">Doc options</p>
            <label className="block space-y-1">
                <span className="text-muted-foreground">Group</span>
                <select value={doc.group} disabled={pending} onChange={(e) => setOption({ group: e.target.value })} className="h-8 w-full rounded-[5px] border border-border bg-background px-2">
                    {data.groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}
                </select>
            </label>
            <label className="block space-y-1">
                <span className="text-muted-foreground">Visibility</span>
                <select value={visibility === 'public' ? 'public' : 'members_only'} disabled={pending} onChange={(e) => setOption({ visibility: e.target.value as 'public' | 'members_only' })} className="h-8 w-full rounded-[5px] border border-border bg-background px-2">
                    <option value="members_only">Members only</option>
                    <option value="public">Public</option>
                </select>
            </label>
            {data.sprints.length > 0 || doc.sprintId ? (
                <label className="block space-y-1">
                    <span className="text-muted-foreground">Linked sprint</span>
                    <select value={doc.sprintId ?? ''} disabled={pending} onChange={(e) => setOption({ sprintId: e.target.value || null })} className="h-8 w-full rounded-[5px] border border-border bg-background px-2">
                        <option value="">None</option>
                        {doc.sprintId && !data.sprints.some((s) => s.id === doc.sprintId) ? <option value={doc.sprintId}>{doc.sprint}</option> : null}
                        {data.sprints.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                </label>
            ) : null}
            <label className={box}><input type="checkbox" checked={doc.required} disabled={pending} onChange={(e) => setOption({ required: e.target.checked })} /> Required reading</label>
            <label className={box}><input type="checkbox" checked={doc.template} disabled={pending} onChange={(e) => setOption({ template: e.target.checked })} /> Template</label>
            <label className={box}><input type="checkbox" checked={doc.showInChildren} disabled={pending} onChange={(e) => setOption({ showInChildren: e.target.checked })} /> Show in every workspace in the organization</label>
            <div className="space-y-1.5 rounded-[5px] border border-border p-2">
                <Input value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={200} placeholder="What changed? (optional)" aria-label="Change summary" className="h-8 text-[12px]" />
                <label className={box}><input type="checkbox" checked={reread} onChange={(e) => setReread(e.target.checked)} /> Ask members to re-read</label>
                <div className="flex flex-wrap gap-1.5">
                    <Button type="button" size="sm" disabled={pending} onClick={() => run(() => publishOrgDocAction(data.orgId, doc.id, { summary, reread, notify: true }), 'Members notified')}>Publish and notify</Button>
                    {reread ? <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => run(() => publishOrgDocAction(data.orgId, doc.id, { summary, reread: true, notify: false }), 'Marked as new')}>Ask to re-read</Button> : null}
                </div>
            </div>
            <button type="button" className="text-muted-foreground underline underline-offset-4 hover:text-foreground" onClick={() => setEditingGroups((v) => !v)}>{editingGroups ? 'Close groups' : 'Edit groups'}</button>
            {editingGroups ? <GroupEditor orgId={data.orgId} groups={data.groups} onSaved={() => { setEditingGroups(false); void queryClient.invalidateQueries({ queryKey: ORG_DOCS_QUERY_KEY(data.orgId) }) }} /> : null}
            {status ? <p role="status" className="text-muted-foreground">{status}</p> : null}
        </div>
    )
}

/** Rename, reorder and add groups; ids stay so docs keep their group (report §19.2). */
function GroupEditor({ orgId, groups, onSaved }: { orgId: string; groups: DocGroup[]; onSaved: () => void }) {
    const [rows, setRows] = useState(groups)
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
                    <Input value={row.name} maxLength={40} aria-label={`Group ${index + 1} name`} className="h-8 text-[12px]"
                        onChange={(e) => setRows((current) => current.map((g) => (g.id === row.id ? { ...g, name: e.target.value } : g)))} />
                    <button type="button" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)} className="p-1 text-muted-foreground disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                    <button type="button" aria-label="Move down" disabled={index === rows.length - 1} onClick={() => move(index, 1)} className="p-1 text-muted-foreground disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                    <button type="button" aria-label="Remove group" disabled={rows.length === 1} onClick={() => setRows((current) => current.filter((g) => g.id !== row.id))} className="p-1 text-muted-foreground disabled:opacity-30"><X className="size-3.5" /></button>
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
            {error ? <p role="alert" className="text-destructive">{error}</p> : null}
        </div>
    )
}

/** An org doc opened inside a child project: read-only, with the way back to the org (report §19.7). */
export function OrgDocBanner({ orgTitle, href, backHref }: { orgTitle: string; href: string; backHref: string }) {
    return (
        <div className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-[5px] border border-border bg-muted/30 px-3 py-2 text-[13px]">
            <Lock className="size-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="font-medium">From {orgTitle}</span>
            <span className="text-muted-foreground">· read-only</span>
            <Link href={href} className="ml-auto underline underline-offset-4">Open in {orgTitle} →</Link>
            <Link href={backHref} className={cn('text-muted-foreground underline underline-offset-4')}>Project docs</Link>
        </div>
    )
}
