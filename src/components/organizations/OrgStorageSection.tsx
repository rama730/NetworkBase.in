'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { keepLatestVersionsAction, readLargeFilesAction, readOrgStorageBreakdownAction, type OrgStorageBreakdown } from '@/app/actions/org-files'
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

const TYPES: Array<{ key: keyof OrgStorageBreakdown['byType']; label: string; color: string }> = [
    { key: 'documents', label: 'Documents', color: 'bg-sky-500' },
    { key: 'images', label: 'Images', color: 'bg-emerald-500' },
    { key: 'video', label: 'Video', color: 'bg-violet-500' },
    { key: 'code', label: 'Code', color: 'bg-amber-500' },
    { key: 'submissions', label: 'Submissions', color: 'bg-rose-500' },
    { key: 'other', label: 'Other', color: 'bg-slate-400' },
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
        s.trashBytes > 0 ? { key: 'trash', label: 'Empty the Trash', detail: `Free up ${formatSize(s.trashBytes)}`, action: <Button asChild size="sm" variant="outline"><Link href={`${base}?tab=files&filesView=trash`}>Empty</Link></Button> } : null,
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
                                <span className="font-medium">{orgTitle}</span>
                                <span>{formatSize(s.usedBytes)} of {formatSize(s.limitBytes)} used</span>
                            </div>
                            <div role="img" aria-label={`${Math.round(ratio * 100)}% used`} className={cn('mt-2 flex h-3 overflow-hidden rounded-full bg-muted', ratio >= 1 ? 'ring-2 ring-destructive' : ratio >= 0.8 ? 'ring-2 ring-amber-500' : '')}>
                                {TYPES.map((t) => s.byType[t.key] > 0 ? <span key={t.key} className={t.color} style={{ width: `${Math.min(100, (s.byType[t.key] / s.limitBytes) * 100)}%` }} /> : null)}
                            </div>
                            <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-[12px] text-muted-foreground">
                                <span className="flex flex-wrap gap-3">{TYPES.map((t) => <span key={t.key} className="inline-flex items-center gap-1"><span className={cn('size-2 rounded-full', t.color)} aria-hidden="true" />{t.key === 'submissions' ? submissionsWord : t.label}</span>)}</span>
                                <span className={ratio >= 1 ? 'text-destructive' : ratio >= 0.8 ? 'text-amber-700 dark:text-amber-400' : ''}>{formatSize(Math.max(0, s.limitBytes - s.usedBytes))} free</span>
                            </div>
                        </div>
                        {total === 0 && s.trashBytes === 0 ? <p className="text-sm text-muted-foreground">Nothing stored yet. Your {formatSize(s.limitBytes)} is ready.</p> : null}
                        {recommendations.length ? (
                            <div>
                                <h3 className="nb-micro mb-1 text-muted-foreground">Recommendations</h3>
                                <ul className="divide-y divide-border">
                                    {recommendations.map((r) => (
                                        <li key={r.key} className="flex items-center justify-between gap-3 py-2 text-sm">
                                            <span>{r.label}<span className="block text-[12px] text-muted-foreground">{r.detail}</span></span>
                                            {r.action}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        ) : null}
                        <div className="grid gap-6 sm:grid-cols-2">
                            <div>
                                <h3 className="nb-micro mb-1 text-muted-foreground">By type</h3>
                                <ul className="text-sm">
                                    {TYPES.filter((t) => s.byType[t.key] > 0).map((t) => (
                                        <li key={t.key} className="flex justify-between py-1"><Link href={`${base}?tab=files`} className="hover:underline">{t.key === 'submissions' ? submissionsWord : t.label}</Link><span className="text-muted-foreground">{formatSize(s.byType[t.key])}</span></li>
                                    ))}
                                    {s.trashBytes > 0 ? <li className="flex justify-between py-1"><Link href={`${base}?tab=files&filesView=trash`} className="hover:underline">Trash</Link><span className="text-muted-foreground">{formatSize(s.trashBytes)}</span></li> : null}
                                </ul>
                            </div>
                            <div>
                                <h3 className="nb-micro mb-1 text-muted-foreground">By workspace</h3>
                                {s.byWorkspace.length === 0 ? <p className="text-sm text-muted-foreground">No workspaces yet.</p> : (
                                    <ul className="text-sm">
                                        {s.byWorkspace.map((w) => <li key={w.id} className="flex justify-between py-1"><Link href={`/workspaces/${w.id}?tab=files`} className="truncate hover:underline">{w.title}</Link><span className="text-muted-foreground">{formatSize(w.bytes)}</span></li>)}
                                    </ul>
                                )}
                                <p className="mt-1 text-[12px] text-muted-foreground">Each team has its own 2 GB; it doesn’t count here.</p>
                            </div>
                        </div>
                    </div>
                ) : null}
            </SettingsCard>
            <DownloadHistory projectId={orgId} />
            <LargeFilesDialog orgId={orgId} base={base} open={largeOpen} onOpenChange={setLargeOpen} onChanged={refresh} />
            <ConfirmDialog open={versionsAsk} onOpenChange={setVersionsAsk} title="Keep the latest 3 versions?"
                description={s ? `Older versions of the organization’s files are removed, freeing ${formatSize(s.oldVersionBytes)}. Handed-in work keeps every version.` : undefined}
                confirmLabel="Remove old versions" variant="destructive"
                onConfirm={async () => {
                    const r = await keepLatestVersionsAction(orgId, true)
                    if (!r.success) throw new Error(r.error)
                    toast.success(`Removed ${r.versions} old ${r.versions === 1 ? 'version' : 'versions'}`)
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
                {files.isPending ? <div className="nb-skeleton h-24 rounded-md" /> : (
                    <ul className="divide-y divide-border text-sm">
                        {list.map((f) => (
                            <li key={f.id} className="flex items-center gap-2 py-1.5">
                                <span className="min-w-0 flex-1 truncate" title={f.path}>{f.name}</span>
                                <span className="text-[12px] text-muted-foreground">{formatSize(f.size)}</span>
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
