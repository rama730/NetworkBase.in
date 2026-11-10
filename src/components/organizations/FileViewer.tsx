'use client'

import { useEffect, useRef, useState } from 'react'
import dynamic from 'next/dynamic'

import { getFilePreviewUrl } from '@/app/actions/files/content'
import { getNodesByIds } from '@/app/actions/files/nodes'
import type { WorkspaceNode } from '@/lib/db/schema'
import { cn } from '@/lib/utils'

// Review UX 4.1–4.6: the Files tab's own viewer (pdf.js, slides, sheets, video, archives…), with a file bar —
// name, size, Download, Open in new tab, Full screen — for a hand-in, a material, or work under review.
const UniversalPreviewEngine = dynamic(() => import('@/components/workspaces/v2/preview/UniversalPreviewEngine'), { ssr: false, loading: () => null })

// Binary units, as the upload limit is set (25 MiB reads "25 MB").
export const fileSize = (bytes: number | null | undefined) => (bytes == null ? '' : bytes >= 2 ** 20 ? `${Number((bytes / 2 ** 20).toFixed(1))} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

export function FileViewer({ projectId, file, meta, unavailable, className }: {
    projectId: string; file: { nodeId: string; name: string; size?: number | null }; meta?: string | null; unavailable?: React.ReactNode; className?: string
}) {
    const [view, setView] = useState<{ node: WorkspaceNode; url: string; download: string } | 'unavailable' | null>(null)
    const frame = useRef<HTMLDivElement>(null)
    // Review queue §2: one file bar — the viewer's page and zoom join it here.
    const [controls, setControls] = useState<HTMLSpanElement | null>(null)
    useEffect(() => {
        let live = true
        setView(null)
        void Promise.all([getNodesByIds(projectId, [file.nodeId]), getFilePreviewUrl(projectId, file.nodeId), getFilePreviewUrl(projectId, file.nodeId, true)]).then(([nodes, url, download]) => {
            if (!live) return
            const node = (nodes as WorkspaceNode[])[0]
            // A file this viewer can't read here (a team's own workspace) says so instead of loading forever.
            setView(node && url && 'url' in url && download && 'url' in download ? { node, url: url.url as string, download: download.url as string } : 'unavailable')
        }).catch(() => { if (live) setView('unavailable') })
        return () => { live = false }
    }, [file.nodeId, projectId])
    const link = 'text-[13px] text-primary underline-offset-4 hover:underline'
    return (
        <div ref={frame} className={cn('flex min-h-0 flex-col overflow-hidden rounded-md border border-border bg-card', className)}>
            <div className="flex min-h-9 flex-wrap items-center gap-x-3.5 gap-y-1 border-b border-border px-3 py-1.5" data-testid="file-bar">
                <span className="min-w-0 max-w-[18rem] truncate text-[13px] font-medium" title={file.name}>{file.name}</span>
                {[fileSize(file.size), meta].filter(Boolean).length ? <span className="min-w-0 truncate font-mono text-[11px] text-muted-foreground">{[fileSize(file.size), meta].filter(Boolean).join(' · ')}</span> : null}
                <span className="flex-1" />
                <span ref={setControls} className="contents" />
                {view && view !== 'unavailable' ? <>
                    <a href={view.download} className={cn(link, 'whitespace-nowrap')} aria-label={`Download ${file.name}`}>Download</a>
                    <a href={view.url} target="_blank" rel="noreferrer noopener" className={cn(link, 'whitespace-nowrap')} aria-label={`Open ${file.name} in a new tab`}>New tab</a>
                    <button type="button" className={cn(link, 'whitespace-nowrap')} aria-label={`Show ${file.name} full screen`} onClick={() => void frame.current?.requestFullscreen?.().catch(() => undefined)}>Full screen</button>
                </> : null}
            </div>
            <div className="min-h-0 flex-1 overflow-auto" data-testid="file-viewer">
                {view === 'unavailable' ? <div className="p-4 text-[13px] text-muted-foreground">{unavailable ?? 'The preview isn’t available here.'}</div>
                    : view ? <UniversalPreviewEngine node={view.node} fileUrl={view.url} projectId={projectId} controlsTarget={controls} />
                        : <p className="p-4 text-[13px] text-muted-foreground">Loading {file.name}…</p>}
            </div>
        </div>
    )
}
