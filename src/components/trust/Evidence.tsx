'use client'

import { useState, type ReactNode } from 'react'
import { toast } from '@/lib/feedback'

import { evidenceShownAction, filePreviewAction, messageContextAction } from '@/app/actions/moderation-staff'
import { istDateTime } from '@/components/trust/format'
import type { ReportReason, ReportTargetKind } from '@/lib/trust/rules'

// Evidence drawn the way the person saw it (R4): a profile as a card, a post as a post, a message in its thread
// with the reported one marked. As reported / Now / Changes shows exactly what changed after the report.

type Snap = Record<string, unknown>
export const SENSITIVE: ReportReason[] = ['inappropriate', 'intimate_images', 'child_safety', 'self_harm', 'threat']
const META = new Set(['label', 'href', 'privateConversation', 'context', 'avatar', 'cover', 'createdAt', 'author'])
const FIELD_LABEL: Record<string, string> = {
    name: 'Name', username: 'Handle', headline: 'Headline', bio: 'Bio', location: 'Location', title: 'Title', tagline: 'Tagline', description: 'Description',
    links: 'Links', tags: 'Tags', kind: 'Kind', content: 'Text', message: 'Message', filename: 'File', size: 'Size', type: 'Type', task: 'Task', topic: 'Topic',
    note: 'Note', workspace: 'Workspace', role: 'Role', summary: 'Summary', story: 'Story', details: 'Details',
}
const text = (v: unknown) => (v == null ? '' : typeof v === 'string' ? v : Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join(', ') : JSON.stringify(v))
const fields = (s: Snap) => Object.entries(s).filter(([k, v]) => !META.has(k) && text(v) !== '')

/** Blurred until Show; each Show is logged (17.4, staff wellbeing). */
export function Sensitive({ caseId, on, children }: { caseId: string; on: boolean; children: ReactNode }) {
    const [shown, setShown] = useState(!on)
    if (shown) return <>{children}</>
    return (
        <div className="relative overflow-hidden rounded-[8px]">
            <div aria-hidden="true" className="pointer-events-none select-none blur-md">{children}</div>
            <div className="absolute inset-0 flex items-center justify-center bg-background/60">
                <button type="button" className="rounded-[5px] border border-border bg-card px-3 py-1.5 text-[13px] font-medium" onClick={() => { setShown(true); void evidenceShownAction(caseId) }}>
                    Sensitive content · Show
                </button>
            </div>
        </div>
    )
}

/** Word-level changes between two texts: removed struck through, added marked. */
function WordDiff({ before, after }: { before: string; after: string }) {
    const a = before.split(/(\s+)/)
    const b = after.split(/(\s+)/)
    // ponytail: LCS over words, O(n·m); evidence is clipped to a few thousand characters.
    const n = a.length, m = b.length
    const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1))
    for (let i = n - 1; i >= 0; i -= 1) for (let j = m - 1; j >= 0; j -= 1) dp[i]![j] = a[i] === b[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!)
    const out: ReactNode[] = []
    let i = 0, j = 0
    while (i < n || j < m) {
        if (i < n && j < m && a[i] === b[j]) { out.push(a[i]); i += 1; j += 1 }
        else if (j < m && (i >= n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) { out.push(<ins key={`a${j}`} className="bg-[var(--status-success-soft)] no-underline">{b[j]}</ins>); j += 1 }
        else { out.push(<del key={`d${i}`} className="bg-[var(--status-danger-soft)]">{a[i]}</del>); i += 1 }
    }
    return <>{out}</>
}

function Fields({ s, compare }: { s: Snap; compare?: Snap }) {
    const keys = [...new Set([...fields(s).map(([k]) => k), ...(compare ? fields(compare).map(([k]) => k) : [])])]
    return (
        <dl className="grid grid-cols-[96px_minmax(0,1fr)] gap-x-3 gap-y-2">
            {keys.map((k) => {
                const now = text(s[k])
                const was = compare ? text(compare[k]) : null
                return (
                    <div key={k} className="contents">
                        <dt className="pt-0.5 text-[12px] text-muted-foreground">{FIELD_LABEL[k] ?? k}</dt>
                        <dd className="whitespace-pre-wrap break-words text-[14px]">{was !== null && was !== now ? <WordDiff before={was} after={now} /> : now || <span className="text-muted-foreground">—</span>}</dd>
                    </div>
                )
            })}
        </dl>
    )
}

function Avatar({ src, name }: { src: unknown; name: string }) {
    return typeof src === 'string' && src
         
        ? <img src={src} alt="" className="size-12 shrink-0 rounded-[6px] object-cover" />
        : <span aria-hidden="true" className="flex size-12 shrink-0 items-center justify-center rounded-[6px] bg-secondary text-[15px] font-semibold">{name.charAt(0).toUpperCase() || '?'}</span>
}

function Drawn({ kind, s, compare }: { kind: ReportTargetKind; s: Snap; compare?: Snap }) {
    if (compare) return <Fields s={s} compare={compare} />
    if (kind === 'person') {
        const name = text(s.name) || text(s.username) || 'No name'
        return (
            <div className="rounded-[8px] border border-border bg-card p-4">
                <div className="flex gap-3">
                    <Avatar src={s.avatar} name={name} />
                    <div className="min-w-0">
                        <p className="text-[15px] font-semibold">{name} {s.username ? <span className="font-normal text-muted-foreground">@{text(s.username)}</span> : null}</p>
                        {s.headline ? <p className="text-[14px]">{text(s.headline)}</p> : null}
                        {s.location ? <p className="text-[12px] text-muted-foreground">{text(s.location)}</p> : null}
                    </div>
                </div>
                {s.bio ? <p className="mt-3 whitespace-pre-wrap break-words text-[14px]">{text(s.bio)}</p> : null}
            </div>
        )
    }
    if (kind === 'update' || kind === 'update_comment' || kind === 'task_comment') {
        const author = text(s.author) || 'Someone'
        return (
            <div className="rounded-[8px] border border-border bg-card p-4">
                <p className="text-[13px]"><span className="font-semibold">{author}</span>{s.createdAt ? <span className="text-[12px] text-muted-foreground"> · {istDateTime(text(s.createdAt))}</span> : null}</p>
                {s.task ? <p className="text-[12px] text-muted-foreground">On {text(s.task)}</p> : null}
                <p className="mt-2 whitespace-pre-wrap break-words text-[14px]">{text(s.content)}</p>
            </div>
        )
    }
    if (kind === 'project') {
        return (
            <div className="rounded-[8px] border border-border bg-card p-4">
                <p className="text-[15px] font-semibold">{text(s.title)}</p>
                {s.tagline ? <p className="text-[14px] text-muted-foreground">{text(s.tagline)}</p> : null}
                {s.description ? <p className="mt-2 whitespace-pre-wrap break-words text-[14px]">{text(s.description)}</p> : null}
                {fields(s).some(([k]) => k === 'links' || k === 'tags') ? <div className="mt-3"><Fields s={{ links: s.links, tags: s.tags }} /></div> : null}
            </div>
        )
    }
    return <Fields s={s} />
}

type Msg = { author?: string | null; body?: string | null; seq?: number; at?: string; deleted?: boolean }

/** The thread with the reported message marked, and "Show 10 more" while the reporter could see it (S9). */
function Thread({ caseId, s, targetSeq }: { caseId: string; s: Snap; targetSeq: number | null }) {
    const [older, setOlder] = useState<Msg[]>([])
    const [done, setDone] = useState(false)
    const [busy, setBusy] = useState(false)
    const context = Array.isArray(s.context) ? (s.context as Msg[]) : []
    const first = older[0]?.seq ?? context[0]?.seq ?? targetSeq
    const more = async () => {
        if (first == null) return
        setBusy(true)
        const rows = await messageContextAction(caseId, first).catch(() => null)
        setBusy(false)
        if (!rows) { setDone(true); return void toast('No more context: the reporter can’t see earlier messages.') }
        if (rows.length < 10) setDone(true)
        setOlder((prev) => [...rows, ...prev])
    }
    const line = (m: Msg, key: string, marked = false) => (
        <li key={key} className={`px-3 py-2 ${marked ? 'border-l-2 border-primary bg-[var(--status-warning-soft)]' : ''}`}>
            <p className="text-[13px]"><span className="font-semibold">{m.author ?? 'Someone'}</span>{m.at ? <span className="text-[12px] text-muted-foreground"> · {istDateTime(m.at)}</span> : null}{marked ? <span className="text-[12px] text-muted-foreground"> · reported</span> : null}</p>
            <p className="whitespace-pre-wrap break-words text-[14px]">{m.deleted ? <span className="text-muted-foreground">Deleted</span> : m.body}</p>
        </li>
    )
    return (
        <div className="rounded-[8px] border border-border bg-card">
            {!done && first != null ? <button type="button" disabled={busy} onClick={more} className="w-full border-b border-border px-3 py-2 text-left text-[13px] text-muted-foreground hover:bg-muted/50">{busy ? 'Loading…' : 'Show 10 more'}</button> : null}
            <ol>
                {older.map((m, i) => line(m, `o${i}`))}
                {context.map((m, i) => line(m, `c${i}`))}
                {line({ author: text(s.author) || null, body: text(s.message), at: text(s.createdAt) || undefined }, 'r', true)}
            </ol>
        </div>
    )
}

/** A file's preview, opened on click behind the blur; the link lasts 10 minutes and is logged (S9). */
function FilePreview({ caseId, s }: { caseId: string; s: Snap }) {
    const [file, setFile] = useState<{ url: string; mime: string | null; name: string } | null>(null)
    const [busy, setBusy] = useState(false)
    const open = async () => {
        setBusy(true)
        const r = await filePreviewAction(caseId)
        setBusy(false)
        if (!r.success) return void toast(r.error)
        setFile({ url: r.url, mime: r.mime, name: r.name })
    }
    return (
        <div className="space-y-3">
            <Fields s={s} />
            {file ? (
                file.mime?.startsWith('image/')
                     
                    ? <img src={file.url} alt={`Reported file ${file.name}`} className="max-h-[420px] max-w-full rounded-[6px] border border-border object-contain" />
                    : file.mime === 'application/pdf'
                        ? <iframe title={`Reported file ${file.name}`} src={file.url} sandbox="" className="h-[420px] w-full rounded-[6px] border border-border" />
                        : <a href={file.url} target="_blank" rel="noreferrer noopener" className="text-[13px] underline underline-offset-4">Open {file.name} in a new tab</a>
            ) : <button type="button" disabled={busy} onClick={open} className="rounded-[5px] border border-border px-3 py-1.5 text-[13px]">{busy ? 'Opening…' : 'Preview file'}</button>}
        </div>
    )
}

export function Evidence({ caseId, kind, reason, snapshot, live, liveState, targetSeq }: {
    caseId: string; kind: ReportTargetKind; reason: ReportReason; snapshot: Snap; live: Snap | null; liveState: 'deleted' | 'unchanged' | 'edited' | null; targetSeq: number | null
}) {
    const [view, setView] = useState<'reported' | 'now' | 'changes'>('reported')
    const edited = liveState === 'edited' && live
    const body = view === 'now' && edited ? <Drawn kind={kind} s={live} />
        : view === 'changes' && edited ? <Drawn kind={kind} s={live} compare={snapshot} />
        : kind === 'chat_message' ? <Thread caseId={caseId} s={snapshot} targetSeq={targetSeq} />
        : kind === 'file' ? <FilePreview caseId={caseId} s={snapshot} />
        : <Drawn kind={kind} s={snapshot} />
    return (
        <section aria-labelledby="evidence-title">
            <div className="mb-2 flex flex-wrap items-center gap-2">
                <h2 id="evidence-title" className="text-[15px] font-semibold">What was reported</h2>
                <span className="text-[12px] text-muted-foreground">{liveState === null ? 'Checking for changes…' : liveState === 'deleted' ? 'Deleted since' : liveState === 'edited' ? 'Edited since' : 'Unchanged'}</span>
                {edited ? (
                    <div role="tablist" aria-label="Version" className="ml-auto flex gap-1">
                        {(['reported', 'now', 'changes'] as const).map((v) => (
                            <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)}
                                className={`rounded-[5px] px-2 py-1 text-[12px] font-medium ${view === v ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted'}`}>
                                {v === 'reported' ? 'As reported' : v === 'now' ? 'Now' : 'Changes'}
                            </button>
                        ))}
                    </div>
                ) : null}
            </div>
            <Sensitive caseId={caseId} on={SENSITIVE.includes(reason)}>{body}</Sensitive>
        </section>
    )
}
