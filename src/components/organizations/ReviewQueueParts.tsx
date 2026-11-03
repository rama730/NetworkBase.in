'use client'

import { useEffect, useState } from 'react'
import dynamic from 'next/dynamic'

import type { ReviewQueueRow } from '@/app/actions/assignments'
import { getFilePreviewUrl } from '@/app/actions/files/content'
import { getNodesByIds } from '@/app/actions/files/nodes'
import { readTaskDiscussionAction } from '@/app/actions/task-comment'
import type { WorkspaceNode } from '@/lib/db/schema'

// Mockup task 2 (Review artboard): the handed-in work in the middle, the conversation on the right.

const DAY = new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric' })
// The Files tab's own viewer: pdf.js for PDFs, an archive listing for zips, and the rest; loaded only when opened.
const UniversalPreviewEngine = dynamic(() => import('@/components/workspaces/v2/preview/UniversalPreviewEngine'), { ssr: false, loading: () => null })

/** The current submission's first file in the Files viewer, with Download and the earlier versions. */
export function ReviewWork({ row }: { row: ReviewQueueRow }) {
    const file = row.files[0] ?? null
    const [view, setView] = useState<{ node: WorkspaceNode; url: string; download: string } | null>(null)
    useEffect(() => {
        let live = true
        setView(null)
        if (!file) return
        void Promise.all([getNodesByIds(row.projectId, [file.nodeId]), getFilePreviewUrl(row.projectId, file.nodeId), getFilePreviewUrl(row.projectId, file.nodeId, true)]).then(([nodes, url, download]) => {
            const node = (nodes as WorkspaceNode[])[0]
            if (live && node && url && 'url' in url && download && 'url' in download) setView({ node, url: url.url as string, download: download.url as string })
        }).catch(() => undefined)
        return () => { live = false }
    }, [file, row.projectId])
    const versions = row.versions ?? []
    if (!file) return null
    return (
        <div className="flex min-h-0 flex-col gap-2">
            <div className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{file.name}</span>
                {versions.length ? (
                    <select aria-label="Versions" className="h-8 rounded-md border border-input bg-background px-2 text-xs" defaultValue="">
                        <option value="">Version {row.version ?? versions[0]!.version + 1} · now</option>
                        {versions.map((v) => <option key={v.version} value={v.version}>Version {v.version} · {v.files.join(', ') || 'nothing attached'} · {DAY.format(new Date(v.at))}</option>)}
                    </select>
                ) : null}
                {view ? <a href={view.download} className="text-[13px] text-primary underline-offset-4 hover:underline" aria-label={`Download ${file.name}`}>Download</a> : null}
            </div>
            <div className="h-[60vh] overflow-hidden rounded-md border border-border bg-card max-md:h-[50vh]" data-testid="review-preview">
                {view ? <UniversalPreviewEngine node={view.node} fileUrl={view.url} projectId={row.projectId} /> : <p className="p-4 text-[13px] text-muted-foreground">Loading {file.name}…</p>}
            </div>
            {row.files.length > 1 ? <p className="text-[12px] text-muted-foreground">Also: {row.files.slice(1).map((f) => f.name).join(', ')}</p> : null}
        </div>
    )
}

/** The latest messages of the copy's private conversation, oldest first. */
export function ReviewConversation({ row }: { row: ReviewQueueRow }) {
    const [lines, setLines] = useState<Array<{ id: string; who: string; text: string }>>([])
    useEffect(() => {
        let live = true
        setLines([])
        if (!row.comments) return
        void readTaskDiscussionAction(row.projectId, row.copyId).then((r) => {
            if (!live || !r.success) return
            setLines(r.data.comments.slice(0, 3).reverse().map((c) => ({ id: c.id, who: c.author?.fullName || c.author?.username || 'Someone', text: c.content })))
        }).catch(() => undefined)
        return () => { live = false }
    }, [row.comments, row.copyId, row.projectId])
    if (!lines.length) return null
    return (
        <ul aria-label="Private conversation" className="space-y-1.5 text-[13px]">
            {lines.map((l) => <li key={l.id}><span className="font-medium">{l.who}:</span> <span className="whitespace-pre-line">{l.text}</span></li>)}
        </ul>
    )
}
