'use client'


import { ViaLabel } from '@/components/ui/via-label'
import { useEffect, useRef, useState, useTransition } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { readHandInAction, startCopyAction, submitAssignmentAction, unsubmitAssignmentAction, type HandIn, type HandInFile } from '@/app/actions/assignments'
import { readMyPlanItemsAction, submitPlanItemAction } from '@/app/actions/plan-hand-in'
import { toggleSubtaskAction } from '@/app/actions/subtask'
import { Button } from '@/components/ui/button'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'
import { Input } from '@/components/ui/input'
import { FileViewer, fileSize } from '@/components/organizations/FileViewer'
import { CopyReview } from '@/components/organizations/ReviewQueueParts'
import { MarkingPanel, MyMarkCard } from '@/components/organizations/Marking'
import { PeerReviewCard } from '@/components/organizations/PeerReview'
import { ExamCard } from '@/components/organizations/ExamCard'
import { handInBlocked, handInBox, handInButton, handInChip, webLink } from '@/lib/organizations/assignment-rules'
import { cn } from '@/lib/utils'
import { toast } from '@/lib/feedback'

// Hand in, in the task panel (report §34.4, decision 85; review UX phase 3): what's asked, one state box with what to
// do next, the files once, the steps, the note and the button that says why it's off; history underneath.

// Student check 21: the reader's own zone (§32.5), named, so nobody guesses whose 11 pm it is.
const WHEN = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
const ASKED: Record<string, string> = { file: 'a file', link: 'a link', text: 'text', none: 'nothing to attach' }
// Textareas use .nb-textarea (spec §10); this only adds layout.
const area = 'w-full'
const TONE = { info: 'active', warn: 'draft', ok: 'completed', danger: 'blocked', muted: 'archived' } as const
// Mockup task 3 (Submit artboard): the state in a coloured box, green when it's in, red when it came back.
const BOX = { ok: 'bg-[var(--status-success-soft)]', danger: 'bg-[var(--status-danger-soft)]', info: 'bg-muted', muted: 'bg-muted' } as const
const TITLE = { ok: 'text-[var(--status-success)]', danger: 'text-[var(--status-danger)]', info: '', muted: '' } as const
const TEXT_MAX = 10000
const label = 'font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground'

/** One file: name and size, Preview in place (review UX 4.6), and Remove while the work is open. */
function FileRow({ file, onRemove }: { file: HandInFile; onRemove?: () => void }) {
    const [open, setOpen] = useState(false)
    const { name } = file
    return (
        <li className="rounded-md border border-border text-[13px]">
            <div className="flex items-center gap-2 px-2.5 py-1.5">
                <span className="min-w-0 flex-1 truncate">{name}</span>
                {/* CLI report A8.3: who made it, per file. */}
                <ViaLabel via={file.viaAgent ? 'agent' : null} agentName={file.agentName} />
                <span className="font-mono text-[12px] text-muted-foreground">{fileSize(file.size)}</span>
                <button type="button" aria-expanded={open} aria-label={`${open ? 'Hide' : 'Preview'} ${name}`} className="rounded-sm px-1.5 text-[12px] text-primary hover:bg-muted" onClick={() => setOpen(!open)}>{open ? 'Hide' : 'Preview'}</button>
                {onRemove ? <button type="button" aria-label={`Remove ${name}`} className="rounded-sm px-1.5 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={onRemove}>×</button> : null}
            </div>
            {open ? <FileViewer projectId={file.projectId} file={file} className="m-2 mt-0 h-[50vh]" /> : null}
        </li>
    )
}

/** Review UX 5.2: the copy's chip from the same read as the card, so the panel header and Hand in never disagree. */
export function HandInChip({ copyId, fallback }: { copyId: string; fallback: React.ReactNode }) {
    const query = useQuery({ queryKey: ['hand-in', copyId], queryFn: () => readHandInAction(copyId), staleTime: 0 })
    const h = query.data?.success ? query.data.handIn : null
    if (!h) return <>{fallback}</>
    const chip = handInChip(h.state, h.approved)
    return <span className="nb-status" data-status={TONE[chip.tone]}>{chip.label}</span>
}

export function HandInSection({ copyId, onOpenFiles, onSubmitted, onUploadFiles, onRemoveFile, onOpenConversation, onReviewed }: {
    copyId: string; onOpenFiles: () => void; onSubmitted: (reviewRequired: boolean) => void
    onUploadFiles?: (files: File[]) => Promise<{ success: boolean; error?: string }>; onRemoveFile?: (nodeId: string) => Promise<{ success: boolean; error?: string }>
    /** Review UX 2.11: Message and Class questions open the panel's conversation. */
    onOpenConversation?: (kind: 'private' | 'class') => void
    /** Review UX 3.12: an admin decided this copy from its own panel. */
    onReviewed?: (decision: 'approve' | 'return') => void
}) {
    const client = useQueryClient()
    const query = useQuery({ queryKey: ['hand-in', copyId], queryFn: () => readHandInAction(copyId), staleTime: 0 })
    const [link, setLink] = useState('')
    const [text, setText] = useState('')
    const [note, setNote] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const [uploading, setUploading] = useState<string[] | null>(null)
    const [dragging, setDragging] = useState(false)
    const [confirmSteps, setConfirmSteps] = useState(false)
    const refresh = () => client.invalidateQueries({ queryKey: ['hand-in', copyId] })
    const h = query.data?.success ? query.data.handIn : null
    // Files go onto the copy right here (step 13 gap); a failed upload says why when it can (32.6, review UX 2.10).
    const attach = async (files: File[]) => {
        if (!onUploadFiles || files.length === 0 || !h) return
        const big = files.find((f) => f.size > h.maxFileBytes)
        if (big) return setError(`${big.name} is ${fileSize(big.size)}. Files can be up to ${fileSize(h.maxFileBytes)}.`)
        setUploading(files.map((f) => f.name))
        const result = await onUploadFiles(files).catch((e: unknown) => ({ success: false, error: e instanceof Error ? e.message : undefined }))
        setUploading(null)
        // Student check 1: production hides a thrown server message behind React's code, which means nothing to a student.
        const detail = result.error && !/React error|Server Components/.test(result.error) ? ` ${result.error}` : ''
        if (!result.success) return setError(`Couldn’t add the file. Try again.${detail}`)
        setError(null)
        await refresh()
    }
    // Live loop 34: returned work can drop the earlier file instead of handing both in.
    const remove = async (nodeId: string) => {
        if (!onRemoveFile) return
        const result = await onRemoveFile(nodeId)
        if (!result.success) return setError('Couldn’t remove the file. Try again.')
        setError(null)
        await refresh()
    }
    // Failure keeps the text (report §32.6); a fresh load starts from what was last handed in.
    useEffect(() => { if (h?.latest) { setLink((v) => v || h.latest!.link || ''); setText((v) => v || h.latest!.text || '') } }, [h?.latest])
    // Assignment flow decision 1: an answer not handed in yet is kept as a draft in this browser, and the first words of
    // it start a copy that's still in To do. The draft never hands anything in.
    const draftKey = `nb:handin-draft:${copyId}`
    useEffect(() => {
        if (!h || h.latest) return
        try {
            const saved = JSON.parse(window.localStorage.getItem(draftKey) ?? 'null') as { link?: string; text?: string } | null
            if (saved) { setLink((v) => v || saved.link || ''); setText((v) => v || saved.text || '') }
        } catch { /* no draft */ }
    }, [h, draftKey])
    const started = useRef(false)
    const typed = (next: { link?: string; text?: string }) => {
        if (next.link !== undefined) setLink(next.link)
        if (next.text !== undefined) setText(next.text)
        try { window.localStorage.setItem(draftKey, JSON.stringify({ link: next.link ?? link, text: next.text ?? text })) } catch { /* private window */ }
        if (!started.current && h?.holder && h.state === 'not_started' && (next.link ?? next.text ?? '').trim()) {
            started.current = true
            void startCopyAction(copyId).then(() => refresh()).catch(() => { started.current = false })
        }
    }
    if (!h) return null
    // Decision 173: waiting for review or approved, the files are locked until it's returned.
    const canAttach = Boolean(onUploadFiles) && h.state !== 'submitted' && !h.approved
    const locked = h.state === 'submitted' || h.approved || (h.state === 'done' && !h.canSubmit)
    const submit = () => startTransition(async () => {
        setConfirmSteps(false)
        const withNote = note.trim() ? { note: note.trim() } : {}
        const result = await submitAssignmentAction(copyId, h.submissionType === 'link' ? { link: link.trim(), ...withNote } : h.submissionType === 'text' ? { text, ...withNote } : withNote)
        if (!result.success) return setError(`Couldn’t hand it in. Your work is still here. ${result.error}`)
        setError(null)
        setNote('')
        try { window.localStorage.removeItem(draftKey) } catch { /* nothing kept */ }
        await refresh()
        onSubmitted(h.reviewRequired)
    })
    // Take back: handed in, not approved, and they could hand it in again (the server checks the same).
    const canTakeBack = h.holder && (h.state === 'submitted' || h.state === 'done') && !h.approved && h.canSubmit
    const takeBack = () => startTransition(async () => {
        const result = await unsubmitAssignmentAction(copyId)
        setError(result.success ? null : `Couldn’t take it back. ${result.error}`)
        await refresh()
    })
    const toggleStep = (id: string, done: boolean) => startTransition(async () => {
        const result = await toggleSubtaskAction(id, done, h.projectId)
        setError(result.success ? null : 'Couldn’t tick that step. Try again.')
        await refresh()
    })
    const chip = handInChip(h.state, h.approved)
    const box = handInBox(h)
    const button = handInButton(h)
    const blocked = handInBlocked({ submissionType: h.submissionType, files: h.files.length, link, text })
    const openSteps = h.steps.filter((s) => !s.done).length
    const at = h.latest ? WHEN.format(new Date(h.latest.at)) : null
    // Review UX 3.14: an approval says who approved it and when, not only when it was handed in.
    const approval = h.approved ? h.history.find((e) => e.kind === 'approved') : undefined
    // Review UX 2.2, 2.15: the files once — what was handed in while it's locked, the working files while it's open.
    const shownFiles = locked ? h.latest?.files ?? [] : h.files
    // "Message your teacher or TA": role words lower-cased, initialisms kept.
    const message = `Message your ${h.reviewers.replace(/\b([A-Z])([a-z])/g, (_, a: string, b: string) => a.toLowerCase() + b)}`
    const msgButton = onOpenConversation ? <Button type="button" size="sm" variant="outline" onClick={() => onOpenConversation('private')}>{message}</Button> : null
    return (
        <section aria-labelledby="hand-in-heading" className="space-y-4 rounded-lg border border-border p-4 text-sm">
            {/* Review UX 2.3: what's asked, when it's due, and who reviews it, each on its own line. */}
            <div className="space-y-1">
                <div className="flex items-center gap-2">
                    <h3 id="hand-in-heading" className="flex-1 text-[15px] font-semibold">Hand in</h3>
                    <span className="nb-status" data-status={TONE[chip.tone]}>{chip.label}</span>
                </div>
                <dl className="grid grid-cols-[max-content_1fr] gap-x-3 gap-y-0.5 text-[13px]">
                    <dt className="text-muted-foreground">What’s asked</dt><dd>{ASKED[h.submissionType] ?? h.submissionType}</dd>
                    <dt className="text-muted-foreground">Due</dt><dd>{h.dueDate ? WHEN.format(new Date(h.dueDate)) : 'No due date'}{h.lateLabel ? <span className="block text-[12px] text-muted-foreground">{h.lateLabel}</span> : null}</dd>
                    {h.reviewRequired ? <><dt className="text-muted-foreground">Reviewed by</dt><dd>{h.reviewers}</dd></> : null}
                </dl>
                {/* Locked fields say who set them (report §17.4, §18.3), in a workspace as in the organization. */}
                <p className="text-[12px] text-muted-foreground">Set by {h.from}: the title, instructions and due date.</p>
            </div>

            <div role="status" className={cn('space-y-0.5 rounded-md px-3 py-2.5', BOX[box.tone])}>
                <p className={cn('font-semibold', TITLE[box.tone])}>{box.title}{approval ? ` by ${approval.by ?? h.from} · ${WHEN.format(new Date(approval.at))}` : (box.title === 'Handed in' || box.title === 'Done') && at ? ` · ${at}` : ''}</p>
                {box.lines.map((line) => <p key={line} className={box.tone === 'ok' ? 'font-mono text-[12px] text-muted-foreground' : 'text-[13px]'}>{line}</p>)}
                {h.returned?.fixBy ? <p className="font-mono text-[12px] text-muted-foreground">Fix by {WHEN.format(new Date(h.returned.fixBy))}</p> : null}
                {box.next ? <p className="text-[13px] text-muted-foreground">{box.next}</p> : null}
                {box.message && msgButton && h.holder ? <div className="pt-1.5">{msgButton}</div> : null}
            </div>
            {h.exam ? <ExamCard exam={h.exam.settings} coverNames={h.exam.coverNames} rules={h.exam.settings.format !== 'take_home' ? ['Late work not accepted'] : []} extraMinutes={h.holder ? h.exam.extraMinutes : 0} /> : null}
            {h.holder ? <><MyMarkCard copyId={copyId} /><PeerReviewCard copyId={copyId} /></> : <MarkingPanel copyId={copyId} />}
            {!h.holder && h.state === 'submitted' ? <CopyReview copyId={copyId} orgId={h.orgId} masterId={h.masterId} onReviewed={(d) => { void refresh(); onReviewed?.(d) }} /> : null}

            {h.materials.length ? (
                <div className="space-y-1.5">
                    <h4 className={label}>Materials</h4>
                    {/* Review UX 2.8: materials open in the file viewer, read-only. */}
                    <ul className="space-y-1" aria-label="Materials">{h.materials.map((m) => <FileRow key={m.nodeId} file={{ ...m, size: null }} />)}</ul>
                </div>
            ) : null}

            {locked && h.latest ? (
                <div className="space-y-1.5">
                    <h4 className={label}>Handed in · Version {h.latest.version} · by {h.latest.by}</h4>
                    {webLink(h.latest.link) ? <a href={webLink(h.latest.link)!} target="_blank" rel="noreferrer noopener" className="block break-all rounded-md border border-border px-2.5 py-1.5 text-primary underline">{h.latest.link}</a> : h.latest.link ? <span className="break-all">{h.latest.link}</span> : null}
                    {h.latest.text ? <p className="whitespace-pre-line rounded-md border border-border px-2.5 py-1.5">{h.latest.text}</p> : null}
                    {h.latest.note ? <p className="text-muted-foreground">Note: {h.latest.note}</p> : null}
                </div>
            ) : null}
            {shownFiles.length ? (
                <div className="space-y-1.5">
                {locked ? null : <h4 className={label}>Your files</h4>}
                <ul className="space-y-1" aria-label={locked && h.latest ? `Version ${h.latest.version} files` : 'Your files'}>
                    {shownFiles.map((f) => <FileRow key={f.nodeId} file={f} onRemove={!locked && canAttach && onRemoveFile ? () => void remove(f.nodeId) : undefined} />)}
                </ul>
                </div>
            ) : null}

            {/* Review UX 2.7: the steps, ticked here. */}
            {h.steps.length ? (
                <div className="space-y-1.5">
                    <h4 className={label}>Steps · {h.steps.length - openSteps} of {h.steps.length}</h4>
                    <ul className="space-y-1" aria-label="Steps">
                        {h.steps.map((s) => (
                            <li key={s.id}><label className="flex items-center gap-2 text-[13px]">
                                <input className="nb-check" type="checkbox" checked={s.done} disabled={!h.holder || locked || pending} onChange={(e) => toggleStep(s.id, e.target.checked)} />
                                <span className={cn(s.done && 'text-muted-foreground line-through')}>{s.title}</span>
                            </label></li>
                        ))}
                    </ul>
                </div>
            ) : null}

            {h.holder && button.show ? (
                <div className="space-y-3">
                    {h.submissionType === 'link' ? (
                        <label className="block space-y-1"><span className="font-medium">Link to your work</span>
                            <Input type="url" value={link} onChange={(e) => typed({ link: e.target.value })} placeholder="https://" aria-invalid={Boolean(link.trim()) && !webLink(link.trim())} />
                        </label>
                    ) : null}
                    {h.submissionType === 'text' ? <PlanItemHandIn copyId={copyId} onDone={async () => { await refresh(); onSubmitted(h.reviewRequired) }} /> : null}
                    {h.submissionType === 'text' ? (
                        <label className="block space-y-1"><span className="font-medium">Your answer</span>
                            <textarea value={text} onChange={(e) => typed({ text: e.target.value })} rows={5} maxLength={TEXT_MAX} className="nb-textarea" aria-describedby="hand-in-count" />
                            <span id="hand-in-count" className="block text-right font-mono text-[11px] text-muted-foreground">{text.length.toLocaleString()} / {TEXT_MAX.toLocaleString()}</span>
                        </label>
                    ) : null}
                    {h.submissionType === 'file' ? (
                        <div onDragOver={(e) => { if (canAttach) { e.preventDefault(); setDragging(true) } }} onDragLeave={() => setDragging(false)}
                            onDrop={(e) => { if (!canAttach) return; e.preventDefault(); setDragging(false); void attach(Array.from(e.dataTransfer.files)) }}
                            data-drop-target={canAttach || undefined} className={cn('space-y-1 rounded-md border border-border p-3 text-center text-[13px] text-muted-foreground', canAttach && 'border-dashed', dragging && 'nb-drop-over')}>
                            {uploading ? <p role="status">Adding {uploading.join(', ')}…</p> : (
                                <p className="flex flex-wrap items-center justify-center gap-2">
                                    {canAttach ? (h.files.length ? 'Drop another file, or' : 'Drop your file here, or') : null}
                                    {canAttach ? (
                                        <label className="inline-flex cursor-pointer items-center rounded-md border border-input px-2.5 py-1 text-[13px] text-foreground hover:bg-muted">
                                            Choose file<input type="file" multiple className="sr-only" disabled={Boolean(uploading)} onChange={(e) => { void attach(Array.from(e.target.files ?? [])); e.target.value = '' }} />
                                        </label>
                                    ) : null}
                                    <Button type="button" size="sm" variant="ghost" onClick={onOpenFiles}>Open the Files tab</Button>
                                </p>
                            )}
                            {canAttach ? <p className="text-[12px]">Up to {fileSize(h.maxFileBytes)} a file.</p> : null}
                        </div>
                    ) : null}
                    {h.submissionType !== 'none' ? (
                        <label className="block space-y-1"><span className="font-medium">Add a note (optional)</span>
                            <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className="nb-textarea" />
                        </label>
                    ) : null}
                    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <Button type="button" disabled={pending || Boolean(uploading) || Boolean(blocked)} aria-describedby={blocked ? 'hand-in-blocked' : undefined}
                            onClick={() => (openSteps ? setConfirmSteps(true) : submit())}>{pending ? 'Handing in…' : button.label}</Button>
                        {blocked ? <span id="hand-in-blocked" className="text-[12px] text-muted-foreground">{blocked}</span>
                            // Assignment flow decision 3: ticking every step never hands it in; the button says it's ready.
                            : h.steps.length && !openSteps ? <span className="text-[12px] font-medium text-[var(--status-success)]">All steps done</span> : null}
                    </div>
                    {h.wouldBeLate ? <p className="font-mono text-[12px] text-[var(--status-warning)]">This will be marked Late.</p> : null}
                </div>
            ) : error ? <p role="alert" className="text-destructive">{error}</p> : null}

            {canTakeBack ? (
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={takeBack}>{pending ? 'Taking back…' : 'Take back'}</Button>
                    <span className="text-[12px] text-muted-foreground">Back to In progress, so you can change it and hand it in again.</span>
                </div>
            ) : null}

            {onOpenConversation && h.holder ? (
                <div className="flex flex-wrap gap-2 border-t border-border pt-3">
                    {box.message ? null : msgButton}
                    <Button type="button" size="sm" variant="ghost" onClick={() => onOpenConversation('class')}>Class questions</Button>
                </div>
            ) : null}

            {/* Review UX 2.9, 3.14, 3.15: every version, each return with its reason, and the approval. */}
            {h.history.length ? (
                <details className="text-[13px]">
                    <summary className="cursor-pointer font-medium text-muted-foreground hover:text-foreground">History · {h.history.length}</summary>
                    <ol className="mt-2 space-y-1.5 border-l border-border pl-3" aria-label="History">
                        {h.history.map((e, i) => (
                            <li key={`${e.kind}-${e.at}-${i}`}>
                                <span className="font-medium">{e.kind === 'handed_in' ? `Version ${e.version} handed in` : e.kind === 'returned' ? 'Returned' : 'Approved'}</span>
                                <span className="text-muted-foreground"> · {WHEN.format(new Date(e.at))}{e.by ? ` · ${e.by}` : ''}{e.late ? ' · Late' : ''}</span>
                                {e.reason ? <span className="block text-muted-foreground">“{e.reason}”</span> : null}
                            </li>
                        ))}
                    </ol>
                </details>
            ) : null}
            <ConfirmDialog open={confirmSteps} onOpenChange={setConfirmSteps} title={`${openSteps} ${openSteps === 1 ? 'step isn’t' : 'steps aren’t'} ticked`}
                description="Hand it in anyway? You can’t change the steps while it waits for review." confirmLabel={button.label} onConfirm={submit} />
        </section>
    )
}

/**
 * B3.3b (report 32.4 call 2): hand in a unit or lesson from one of your courses — it is written into this hand-in as
 * it is now and frozen as a version; later edits to the unit don't change what was handed in.
 */
function PlanItemHandIn({ copyId, onDone }: { copyId: string; onDone: () => Promise<void> | void }) {
    const q = useQuery({ queryKey: ['plan-items', copyId], queryFn: () => readMyPlanItemsAction(copyId), staleTime: 60_000 })
    const [pick, setPick] = useState('')
    const [busy, setBusy] = useState(false)
    const courses = q.data?.success ? q.data.courses : []
    if (!courses.length) return null
    const send = async () => {
        const [kind, id] = pick.split(':') as ['unit' | 'lesson', string]
        if (!id) return
        setBusy(true)
        const r = await submitPlanItemAction(copyId, { kind, id }).finally(() => setBusy(false))
        if (!r.success) return void toast.error(r.error)
        toast.success(kind === 'unit' ? 'Unit handed in' : 'Lesson handed in')
        setPick('')
        await onDone()
    }
    return (
        <div className="space-y-1.5 rounded-md border border-border p-3" data-testid="plan-item-hand-in">
            <span className="block font-medium">Hand in a unit or lesson</span>
            <span className="block text-[12px] text-muted-foreground">It is handed in as it is now; later changes to it don’t change this version.</span>
            <span className="flex flex-wrap gap-2">
                <select className="nb-select" aria-label="Unit or lesson to hand in" value={pick} onChange={(e) => setPick(e.target.value)}>
                    <option value="">Pick a unit or lesson…</option>
                    {courses.map((c) => (
                        <optgroup key={c.id} label={c.course}>
                            {c.units.flatMap((u) => [<option key={u.id} value={`unit:${u.id}`}>Unit: {u.name}</option>,
                                ...u.lessons.map((l) => <option key={l.id} value={`lesson:${l.id}`}>Lesson: {l.title}</option>)])}
                        </optgroup>
                    ))}
                </select>
                <Button type="button" size="sm" disabled={!pick || busy} onClick={() => void send()}>{pick.startsWith('lesson') ? 'Hand in this lesson' : 'Hand in this unit'}</Button>
            </span>
        </div>
    )
}
