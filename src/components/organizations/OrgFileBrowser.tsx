'use client'

import { useEffect, useState } from 'react'
import { ChevronRight, MoreHorizontal, Search } from 'lucide-react'

import { FileViewer, fileSize } from '@/components/organizations/FileViewer'
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { FileTypeChip } from '@/components/workspaces/v2/files-tab/FileTypeChip'
import { FolderListHeader } from '@/components/workspaces/v2/files-tab/folder/FolderListHeader'
import { FOLDER_LIST_GRID_TEMPLATE, FOLDER_LIST_ROW_HEIGHT_PX } from '@/components/workspaces/v2/files-tab/folder/layout'
import { formatRelativeTime } from '@/components/workspaces/v2/files-tab/folder/format'
import type { BrowserFile } from '@/app/actions/org-files'
import { cn } from '@/lib/utils'

// Files report (2026-11-04-submissions-and-review-card-findings.md §1–§2): Submissions, Sprint materials and a team's
// Final files are browsed the Task files way — the same filter bar with counts, the same columns and rows, folders you
// open, a breadcrumb, Esc to go up, the place in the URL — and a file opens in the shared viewer.

export type Crumb = { label: string; onClick?: () => void }

/** The header line: where you are (a breadcrumb) and this level's actions. */
export function BrowserHeader({ crumbs, actions }: { crumbs: Crumb[]; actions?: React.ReactNode }) {
    return (
        <div className="flex min-h-11 items-center gap-3 border-b border-border px-4 py-1.5">
            <nav aria-label="Breadcrumb" className="min-w-0 flex-1">
                <ol className="flex min-w-0 items-center gap-1 text-[13px]">
                    {crumbs.map((c, i) => (
                        <li key={`${i}-${c.label}`} className="flex min-w-0 items-center gap-1">
                            {i ? <ChevronRight aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" /> : null}
                            {c.onClick && i < crumbs.length - 1
                                ? <button type="button" onClick={c.onClick} className="truncate text-muted-foreground hover:text-foreground hover:underline">{c.label}</button>
                                : <span aria-current={i === crumbs.length - 1 ? 'page' : undefined} className="truncate font-medium text-foreground">{c.label}</span>}
                        </li>
                    ))}
                </ol>
            </nav>
            {actions}
        </div>
    )
}

/** Task files' filter bar: "Status:" pills with live counts, and a quick filter on the right. */
export function FilterBar<K extends string>({ label = 'Status', pills, value, onChange, query, onQuery, placeholder, extra }: {
    label?: string; pills: ReadonlyArray<{ id: K; label: string; count: number }>; value: K; onChange: (id: K) => void
    query: string; onQuery: (q: string) => void; placeholder: string; extra?: React.ReactNode
}) {
    return (
        <div role="toolbar" aria-label={`${label} filters`} className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DBD5C8] bg-[#FAF8F5] px-4 py-1.5 dark:border-border dark:bg-card">
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="mr-1 font-mono text-[11px] font-medium text-muted-foreground">{label}:</span>
                {pills.map((p) => (
                    <button key={p.id} type="button" aria-pressed={value === p.id} onClick={() => onChange(p.id)}
                        className={cn('inline-flex h-6 items-center gap-1.5 rounded-[3px] px-2 font-mono text-[11px] transition-colors',
                            value === p.id ? 'bg-primary font-semibold text-primary-foreground shadow-xs'
                                : 'border border-[#DBD5C8]/70 bg-white text-[#4C5A61] hover:bg-[#E8E3D9] hover:text-[#141A1E] dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:bg-white/10 dark:hover:text-foreground')}>
                        <span>{p.label}</span>
                        <span className={cn('text-[10px] tabular-nums', value === p.id ? 'text-white/80' : 'text-[#8E9AA1] dark:text-muted-foreground')}>{p.count}</span>
                    </button>
                ))}
            </div>
            <div className="flex items-center gap-2">
                {extra}
                <div className="relative flex items-center">
                    <Search aria-hidden="true" className="pointer-events-none absolute left-2 size-3 text-muted-foreground" />
                    <input type="search" value={query} onChange={(e) => onQuery(e.target.value)} placeholder={placeholder} aria-label={placeholder.replace('…', '')}
                        className="h-6 w-36 rounded-[3px] border border-[#DBD5C8] bg-white pl-6 pr-2 font-mono text-[11px] text-[#141A1E] placeholder:text-[#8E9AA1] focus:border-[#D14E24] focus:outline-none dark:border-border dark:bg-card dark:text-foreground sm:w-48" />
                </div>
            </div>
        </div>
    )
}

export { FolderListHeader }

/** Header row and rows inside a table, as Task files lays them out (screen readers need the table around them). */
export function BrowserTable({ label, children }: { label: string; children: React.ReactNode }) {
    return <div role="table" aria-label={label} className="flex min-h-0 flex-1 flex-col">{children}</div>
}

const rowClass = 'group grid cursor-pointer items-center gap-x-3 border-b border-[#E8E3D9] px-4 text-sm outline-none transition-colors hover:bg-[#F3F0EA]/70 focus-visible:bg-[#F3F0EA]/70 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#D14E24] dark:border-white/10 dark:hover:bg-white/5'
const meta = 'min-w-0 truncate font-mono text-xs text-muted-foreground'

/** One row in the Task files grid: a folder (an assignment, a person, a sprint, a version) or a file. */
export function BrowserRow({ name, folder = false, badges, updated, size, by, byAvatarUrl, onOpen, menu, label }: {
    name: string; folder?: boolean; badges?: React.ReactNode; updated: string | null; size: string; by: string | null; byAvatarUrl?: string | null
    onOpen: () => void; menu?: React.ReactNode; label?: string
}) {
    return (
        <div role="row" tabIndex={0} aria-label={label ?? name} data-testid="browser-row" onClick={onOpen}
            onKeyDown={(e) => { if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onOpen() } }}
            style={{ gridTemplateColumns: FOLDER_LIST_GRID_TEMPLATE, minHeight: FOLDER_LIST_ROW_HEIGHT_PX }} className={rowClass}>
            <div role="cell" data-column="name" className="flex min-w-0 items-center gap-2.5">
                <FileTypeChip name={name} isFolder={folder} />
                <span className={cn('truncate', folder ? 'font-semibold text-[#141A1E] dark:text-foreground' : 'text-foreground')} title={name}>{name}</span>
                {badges}
            </div>
            <div role="cell" data-column="updated" className={meta} title={updated ?? undefined}>{updated ? formatRelativeTime(updated) : '—'}</div>
            <div role="cell" data-column="size" className={cn(meta, 'text-right')}>{size}</div>
            <div role="cell" data-column="by" className="flex min-w-0 items-center gap-1.5">
                {by ? <UserAvatar identity={{ fullName: by, avatarUrl: byAvatarUrl ?? null }} size={18} className="shrink-0" roundedClassName="rounded-[3px]" fallbackClassName="text-[9px]" /> : null}
                <span className={meta}>{by ?? '—'}</span>
            </div>
            <div role="cell" data-column="actions" className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                {menu ? (
                    <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                            <button type="button" aria-label={`More for ${name}`} className="inline-flex size-7 items-center justify-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="size-4" aria-hidden="true" /></button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">{menu}</DropdownMenuContent>
                    </DropdownMenu>
                ) : null}
            </div>
        </div>
    )
}

export const Badge = ({ children, tone = 'muted' }: { children: React.ReactNode; tone?: 'muted' | 'warning' | 'success' | 'danger' | 'info' }) => (
    <span className={cn('shrink-0 rounded-[3px] px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider',
        tone === 'warning' ? 'bg-[#FCF0EA] text-[#B23F1C] dark:bg-[#B23F1C]/20 dark:text-[#FCF0EA]'
            : tone === 'success' ? 'bg-[var(--status-success)]/10 text-[var(--status-success)]'
                : tone === 'danger' ? 'bg-destructive/10 text-destructive'
                    : tone === 'info' ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-foreground')}>{children}</span>
)

/** A file row; opening it shows the shared viewer. */
export function FileRows({ files, onOpen, extra }: { files: BrowserFile[]; onOpen: (f: BrowserFile) => void; extra?: (f: BrowserFile) => React.ReactNode }) {
    return <>{files.map((f) => <BrowserRow key={f.nodeId} name={f.name} updated={f.updatedAt} size={fileSize(f.size)} by={f.by} byAvatarUrl={f.byAvatarUrl} onOpen={() => onOpen(f)} badges={extra?.(f)} />)}</>
}

export function BrowserEmpty({ title, body, action }: { title: string; body?: string; action?: React.ReactNode }) {
    return (
        <div className="nb-empty-state py-12" role="status">
            <p className="nb-empty-state-title">{title}</p>
            {body ? <p className="nb-empty-state-desc">{body}</p> : null}
            {action}
        </div>
    )
}

/** The opened file: the shared viewer filling the list's place. */
export function OpenFile({ projectId, file }: { projectId: string; file: BrowserFile }) {
    return <div className="min-h-0 flex-1 p-4"><FileViewer projectId={projectId} file={{ nodeId: file.nodeId, name: file.name, size: file.size }} className="h-full min-h-[60vh]" /></div>
}

/**
 * The browser's place, kept in the URL next to `filesView` (files report §1: "as Task files keeps taskId"), and Esc
 * going up one level (not while typing, not when a menu or dialog took it).
 */
export function useBrowserPlace<K extends string>(keys: readonly K[]) {
    const read = () => {
        const params = typeof window === 'undefined' ? new URLSearchParams() : new URLSearchParams(window.location.search)
        return Object.fromEntries(keys.map((k) => [k, params.get(k)])) as Record<K, string | null>
    }
    const [place, setPlace] = useState<Record<K, string | null>>(read)
    const go = (next: Partial<Record<K, string | null>>) => {
        setPlace((cur) => {
            const merged = { ...cur, ...next }
            const url = new URL(window.location.href)
            for (const k of keys) { if (merged[k]) url.searchParams.set(k, merged[k]!); else url.searchParams.delete(k) }
            window.history.replaceState(window.history.state, '', url)
            return merged
        })
    }
    const deepest = [...keys].reverse().find((k) => place[k])
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            const target = event.target as HTMLElement | null
            if (event.key !== 'Escape' || !deepest) return
            if (target && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName))) return
            if (target?.closest?.('[role="menu"],[role="dialog"],[role="alertdialog"],[role="listbox"]')) return
            go({ [deepest]: null } as Partial<Record<K, string | null>>)
        }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
    })
    return { place, go }
}
