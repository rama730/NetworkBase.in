'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { keepLatestVersionsAction, readLargeFilesAction, readOrgStorageBreakdownAction, readOrgStorageFilesAction, type OrgStorageBreakdown } from '@/app/actions/org-files'
import { bulkTrashNodes } from '@/app/actions/files/mutations'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { SettingsCard } from '@/components/workspaces/settings/SettingsFormFields'
import { DownloadHistory } from '@/components/workspaces/settings/DownloadHistory'
import { toast } from '@/lib/feedback'
import { cn } from '@/lib/utils'

// Settings → Storage (report §7.12, §37.5): one bar by type, recommendations that say what they free, by type and by
// workspace, and download history. Admins only.

const TYPES: Array<{ key: keyof OrgStorageBreakdown['byType']; label: string }> = [
    { key: 'documents', label: 'Documents' },
    { key: 'images', label: 'Images' },
    { key: 'video', label: 'Video' },
    { key: 'code', label: 'Code' },
    { key: 'submissions', label: 'Submissions' },
    { key: 'other', label: 'Other' },
]

export function formatSize(bytes: number) {
    if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
    if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
    if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
    return `${bytes} B`
}

export function OrgStorageSection({ orgId, orgTitle, handle, submissionsWord }: { orgId: string; orgTitle: string; handle: string | null; submissionsWord: string }) {
    const client = useQueryClient()
    const query = useQuery({ queryKey: ['org-storage', orgId], queryFn: () => readOrgStorageBreakdownAction(orgId) })
    const [largeOpen, setLargeOpen] = useState(false)
    const [versionsAsk, setVersionsAsk] = useState(false)
    const s = query.data?.success ? query.data.storage : null
    const base = `/org/${encodeURIComponent(handle ?? orgId)}`
    const refresh = () => void client.invalidateQueries({ queryKey: ['org-storage', orgId] })
    const ratio = s ? s.usedBytes / s.limitBytes : 0
    const total = s ? Object.values(s.byType).reduce((a, b) => a + b, 0) : 0
    const recommendations = s ? [
        // Audit C12: freed space reaches the bar after the next clean-up, not at once; say so.
        s.trashBytes > 0 ? { key: 'trash', label: 'Empty the Trash to free space', detail: `Free up ${formatSize(s.trashBytes)} · within about 2 hours of emptying`, action: <Button asChild size="sm" variant="outline"><Link href={`${base}?tab=files&filesView=trash`}>Open Trash</Link></Button> } : null,
        s.largeFiles > 0 ? { key: 'large', label: 'Review large files', detail: `${s.largeFiles} ${s.largeFiles === 1 ? 'file' : 'files'} over 100 MB`, action: <Button size="sm" variant="outline" onClick={() => setLargeOpen(true)}>Review</Button> } : null,
        s.oldVersionBytes > 0 ? { key: 'versions', label: 'Old versions', detail: `Free up ${formatSize(s.oldVersionBytes)}`, action: <Button size="sm" variant="outline" onClick={() => setVersionsAsk(true)}>Review</Button> } : null,
    ].filter((r): r is NonNullable<typeof r> => Boolean(r)) : []
    return (
        <section id="project-settings-org-storage" data-project-settings-section className="space-y-6">
            <SettingsCard title="Storage" headingLevel={2} description="What uses the organization’s space. Each workspace’s team storage is separate." loadState={{ loading: query.isPending, hasData: Boolean(s), error: query.data && !query.data.success ? query.data.error : null, retry: () => void query.refetch() }}>
                {s ? (
                    <div className="space-y-6">
                        <div>
                            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                                <span className="text-[13px] font-medium">{orgTitle}</span>
                                <span className="nb-meta text-foreground">{formatSize(s.usedBytes)} of {formatSize(s.limitBytes)} used</span>
                            </div>
                            {/* One determinate bar (spec §10 ProgressBar: 6px, clay); warning and danger only when it's nearly or fully used. */}
                            <div role="progressbar" aria-label="Storage used" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, Math.round(ratio * 100))} className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
                                <div className={cn('h-full rounded-full', ratio >= 1 ? 'bg-[var(--status-danger)]' : ratio >= 0.8 ? 'bg-[var(--status-warning)]' : 'bg-primary')} style={{ width: `${Math.min(100, ratio * 100)}%` }} />
                            </div>
                            <p className={cn('nb-meta mt-1.5', ratio >= 1 ? 'text-destructive' : ratio >= 0.8 ? 'text-[var(--status-warning)]' : '')}>{Math.round(ratio * 100)}% · {formatSize(Math.max(0, s.limitBytes - s.usedBytes))} free</p>
                        </div>
                        {total === 0 && s.trashBytes === 0 ? <p className="text-[13px] text-muted-foreground">Nothing stored yet. Your {formatSize(s.limitBytes)} is ready.</p> : null}
                        {recommendations.length ? (
                            <div>
                                <h3 className="nb-micro mb-2">Recommendations</h3>
                                <ul className="divide-y divide-border">
                                    {recommendations.map((r) => (
                                        <li key={r.key} className="flex min-h-12 items-center justify-between gap-3 py-2 text-[13px]">
                                            <span>{r.label}<span className="block text-[12px] text-muted-foreground">{r.detail}</span></span>
                                            {r.action}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                        <div className="grid gap-6 sm:grid-cols-2">
                            <div>
                                <h3 className="nb-micro mb-2">By type</h3>
                                <ul className="text-[13px]">
                                    {TYPES.filter((t) => s.byType[t.key] > 0).map((t) => t.key === 'submissions' ? (
                                        <li key={t.key} className="flex justify-between py-1"><Link href={`${base}?tab=files&filesView=submissions`} className="hover:underline">{submissionsWord}</Link><span className="nb-meta">{formatSize(s.byType[t.key])}</span></li>
                                    ) : (
                                        <TypeRow key={t.key} orgId={orgId} base={base} kind={t.key} label={t.label} bytes={s.byType[t.key]} />
                                    ))}
                                    {s.trashBytes > 0 ? <li className="flex justify-between py-1"><Link href={`${base}?tab=files&filesView=trash`} className="hover:underline">Trash</Link><span className="nb-meta">{formatSize(s.trashBytes)}</span></li> : null}
                                </ul>
                            </div>
                            <div>
                                <h3 className="nb-micro mb-2">By workspace</h3>
                                {s.byWorkspace.length === 0 ? <p className="text-sm text-muted-foreground">No workspaces yet.</p> : (
                                    <ul className="text-[13px]">
                                        {s.byWorkspace.map((w) => <li key={w.id} className="flex justify-between py-1"><Link href={`/workspaces/${w.id}?tab=files`} className="truncate hover:underline">{w.title}</Link><span className="nb-meta">{formatSize(w.bytes)}</span></li>)}
                                    </ul>
                                )}
                                <p className="mt-2 text-[12px] text-muted-foreground">Each team has its own 2 GB; it doesn’t count here.</p>
                            </div>
                        </div>
                    </div>
                ) : null}
                <div className="mt-6 border-t border-border pt-6"><DownloadHistory projectId={orgId} noun="organization" /></div>
            </SettingsCard>
            <LargeFilesDialog orgId={orgId} base={base} open={largeOpen} onOpenChange={setLargeOpen} onChanged={refresh} />
            <ConfirmDialog open={versionsAsk} onOpenChange={setVersionsAsk} title="Keep the latest 3 versions?"
                description={s ? `Older versions of the organization’s files are removed, freeing ${formatSize(s.oldVersionBytes)}. Handed-in work keeps every version.` : undefined}
                confirmLabel="Remove old versions" variant="destructive"
                onConfirm={async () => {
                    const r = await keepLatestVersionsAction(orgId, true)
                    if (!r.success) throw new Error(r.error)
                    toast.success(`Removed ${r.versions} old ${r.versions === 1 ? 'version' : 'versions'}`, { description: 'The space shows as free within about 2 hours.' })
                    refresh()
                }} />
        </section>
    )
}

/** Review large files (report §37.5): largest first, with Open and Move to Trash. */
function LargeFilesDialog({ orgId, base, open, onOpenChange, onChanged }: { orgId: string; base: string; open: boolean; onOpenChange: (open: boolean) => void; onChanged: () => void }) {
    const files = useQuery({ queryKey: ['org-large-files', orgId], queryFn: () => readLargeFilesAction(orgId), enabled: open })
    const [busy, setBusy] = useState<string | null>(null)
    const list = files.data?.success ? files.data.files : []
    const trash = async (id: string) => {
        setBusy(id)
        try {
            await bulkTrashNodes([id], orgId)
            toast.success('Moved to Trash')
            void files.refetch()
            onChanged()
        } catch (error) {
            toast.error(error instanceof Error ? error.message : 'Couldn’t move it to Trash')
        } finally {
            setBusy(null)
        }
    }
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[85dvh] max-w-xl overflow-y-auto">
                <DialogHeader>
                    <DialogTitle>Large files</DialogTitle>
                    <DialogDescription>Largest first. Moving one to Trash frees its space when Trash is emptied.</DialogDescription>
                </DialogHeader>
                {files.isPending ? <div className="nb-skeleton h-24 rounded-md" role="status" aria-label="Loading large files" /> : list.length === 0 ? <p className="text-[13px] text-muted-foreground">No files over 100 MB are left.</p> : (
                    <ul className="divide-y divide-border text-[13px]">
                        {list.map((f) => (
                            <li key={f.id} className="flex items-center gap-2 py-1.5">
                                <span className="min-w-0 flex-1 truncate" title={f.path}>{f.name}</span>
                                <span className="nb-meta">{formatSize(f.size)}</span>
                                <Button asChild size="sm" variant="ghost"><Link href={`${base}?tab=files&fileId=${encodeURIComponent(f.id)}`}>Open</Link></Button>
                                <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void trash(f.id)}>Move to Trash</Button>
                            </li>
                        ))}
                    </ul>
                )}
            </DialogContent>
        </Dialog>
    )
}

/** A By type row (step 9 gap): opens that type's largest files, each linking to it in Files. */
function TypeRow({ orgId, base, kind, label, bytes }: { orgId: string; base: string; kind: Exclude<keyof OrgStorageBreakdown['byType'], 'submissions'>; label: string; bytes: number }) {
    const [open, setOpen] = useState(false)
    const [files, setFiles] = useState<Array<{ id: string; name: string; path: string; size: number }> | null>(null)
    const toggle = () => {
        setOpen(!open)
        if (!files) void readOrgStorageFilesAction(orgId, kind).then((r) => setFiles(r.success ? r.files : []))
    }
    return (
        <li className="py-1">
            <div className="flex justify-between">
                <button type="button" aria-expanded={open} onClick={toggle} className="hover:underline">{label}</button>
                <span className="nb-meta">{formatSize(bytes)}</span>
            </div>
            {open ? files === null ? <div className="nb-skeleton mt-1 h-10 rounded-md" role="status" aria-label={`Loading ${label}`} /> : (
                <ul className="mt-1 space-y-0.5 border-l border-border pl-3 text-[13px]">
                    {files.map((f) => (
                        <li key={f.id} className="flex justify-between gap-2">
                            <Link href={`${base}?tab=files&path=${encodeURIComponent(f.path)}`} className="min-w-0 truncate hover:underline">{f.name}</Link>
                            <span className="nb-meta shrink-0">{formatSize(f.size)}</span>
                        </li>
                    ))}
                </ul>
            ) : null}
        </li>
    )
}
