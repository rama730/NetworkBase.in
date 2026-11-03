'use client'

import { useEffect, useState, useTransition } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { readHandInAction, submitAssignmentAction, type HandIn } from '@/app/actions/assignments'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { webLink } from '@/lib/organizations/assignment-rules'

// Hand in, in the task panel (report §34.4, decision 85): every hand-in type, an optional note, and the state with
// what to do next. Files attach in the panel's Files tab; Submit locks them with this version (decision 127).

// Student check 21: the reader's own zone (§32.5), named, so nobody guesses whose 11 pm it is.
const WHEN = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' })
const ASKED: Record<string, string> = { file: 'a file', link: 'a link', text: 'text', none: 'nothing to attach' }
const area = 'w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

function StateLine({ h }: { h: HandIn }) {
    const at = h.latest ? WHEN.format(new Date(h.latest.at)) : null
    if (h.excusedReason) return <p>You’re excused: {h.excusedReason}</p>
    if (h.returned) return <p className="font-medium text-amber-700 dark:text-amber-400">Returned: {h.returned.reason ?? 'Make the changes and hand it in again.'}{h.returned.fixBy ? ` Fix by ${WHEN.format(new Date(h.returned.fixBy))}.` : ''}</p>
    if (h.approved) return <p>Approved{at ? ` · handed in ${at}` : ''}. It’s locked now.</p>
    if (h.state === 'submitted') return <p>Submitted {at} · Version {h.latest?.version ?? 1}{h.late ? ' · Late' : ''} · Waiting for review</p>
    if (h.state === 'done') return <p>Done {at}{h.late ? ' · Late' : ''}</p>
    if (h.closed && !h.canSubmit) return <p>This assignment is closed.</p>
    if (h.state === 'missing') return <p>{h.canSubmit ? `Overdue.${h.lateLabel ? ` ${h.lateLabel}.` : ''}` : `The due date has passed. Ask ${h.from} if you need more time.`}</p>
    return null
}

export function HandInSection({ copyId, onOpenFiles, onSubmitted, onUploadFiles, onRemoveFile }: { copyId: string; onOpenFiles: () => void; onSubmitted: (reviewRequired: boolean) => void; onUploadFiles?: (files: File[]) => Promise<{ success: boolean; error?: string }>; onRemoveFile?: (nodeId: string) => Promise<{ success: boolean; error?: string }> }) {
    const client = useQueryClient()
    const query = useQuery({ queryKey: ['hand-in', copyId], queryFn: () => readHandInAction(copyId), staleTime: 0 })
    const [link, setLink] = useState('')
    const [text, setText] = useState('')
    const [note, setNote] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const [uploading, setUploading] = useState(false)
    const [dragging, setDragging] = useState(false)
    // Files go onto the copy right here (step 13 gap); a failed upload says so and keeps nothing half done (32.6).
    const attach = async (files: File[]) => {
        if (!onUploadFiles || files.length === 0) return
        setUploading(true)
        const result = await onUploadFiles(files).catch((e: unknown) => ({ success: false, error: e instanceof Error ? e.message : undefined }))
        setUploading(false)
        // Student check 1: production hides a thrown server message behind React's code, which means nothing to a student.
        const detail = result.error && !/React error|Server Components/.test(result.error) ? ` ${result.error}` : ''
        if (!result.success) return setError(`Couldn’t add the file. Try again.${detail}`)
        setError(null)
        await client.invalidateQueries({ queryKey: ['hand-in', copyId] })
    }
    // Live loop 34: returned work can drop the earlier file instead of handing both in.
    const remove = async (nodeId: string) => {
        if (!onRemoveFile) return
        const result = await onRemoveFile(nodeId)
        if (!result.success) return setError('Couldn’t remove the file. Try again.')
        setError(null)
        await client.invalidateQueries({ queryKey: ['hand-in', copyId] })
    }
    const h = query.data?.success ? query.data.handIn : null
    // Failure keeps the text (report §32.6); a fresh load starts from what was last handed in.
    useEffect(() => { if (h?.latest) { setLink((v) => v || h.latest!.link || ''); setText((v) => v || h.latest!.text || '') } }, [h?.latest])
    if (!h) return null
    // Decision 173: waiting for review or approved, the files are locked until it's returned.
    const canAttach = Boolean(onUploadFiles) && h.state !== 'submitted' && !h.approved
    const submit = () => startTransition(async () => {
        const withNote = note.trim() ? { note: note.trim() } : {}
        const result = await submitAssignmentAction(copyId, h.submissionType === 'link' ? { link, ...withNote } : h.submissionType === 'text' ? { text, ...withNote } : withNote)
        if (!result.success) return setError(`Couldn’t submit. Your work is still here. ${result.error}`)
        setError(null)
        setNote('')
        await client.invalidateQueries({ queryKey: ['hand-in', copyId] })
        onSubmitted(h.reviewRequired)
    })
    const label = h.state === 'returned' ? 'Submit again' : h.state === 'submitted' || h.state === 'done' ? 'Replace submission' : h.submissionType === 'none' ? 'Mark as done' : 'Submit'
    return (
        <section aria-labelledby="hand-in-heading" className="space-y-3 rounded-[6px] border border-border p-4 text-sm">
            <div className="space-y-0.5">
                <h3 id="hand-in-heading" className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-muted-foreground">Hand in</h3>
                <p className="text-muted-foreground">
                    What’s asked: {ASKED[h.submissionType] ?? h.submissionType}
                    {h.dueDate ? ` · Due ${WHEN.format(new Date(h.dueDate))}` : ''}{h.lateLabel ? ` · ${h.lateLabel}` : ''}
                    {h.reviewRequired ? ` · Reviewed by ${h.reviewers}` : ''}
                </p>
                {/* Locked fields say who set them (report §17.4, §18.3), in a workspace as in the organization. */}
                <p className="text-[12px] text-muted-foreground">Set by {h.from}: the title, instructions and due date.</p>
            </div>
            <StateLine h={h} />
            {h.latest ? (
                <div className="space-y-1 rounded-md bg-muted/40 px-3 py-2">
                    <p className="text-[12px] text-muted-foreground">Version {h.latest.version} · {WHEN.format(new Date(h.latest.at))} · by {h.latest.by}</p>
                    {webLink(h.latest.link) ? <a href={webLink(h.latest.link)!} target="_blank" rel="noreferrer noopener" className="break-all text-primary underline">{h.latest.link}</a> : h.latest.link ? <span className="break-all">{h.latest.link}</span> : null}
                    {h.latest.text ? <p className="whitespace-pre-line">{h.latest.text}</p> : null}
                    {h.latest.files.length ? <p>{h.latest.files.map((f) => f.name).join(', ')}</p> : null}
                    {h.latest.note ? <p className="text-muted-foreground">Note: {h.latest.note}</p> : null}
                </div>
            ) : null}
            {h.materials.length ? <p className="text-muted-foreground">Materials: {h.materials.map((m) => m.name).join(', ')}</p> : null}
            {h.holder && h.canSubmit ? (
                <div className="space-y-2">
                    {h.submissionType === 'link' ? <Input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://" aria-label="Link to your work" /> : null}
                    {h.submissionType === 'text' ? <textarea value={text} onChange={(e) => setText(e.target.value)} rows={5} maxLength={10000} className={area} aria-label="Your answer" /> : null}
                    {h.submissionType === 'file' ? (
                        <div onDragOver={(e) => { if (canAttach) { e.preventDefault(); setDragging(true) } }} onDragLeave={() => setDragging(false)}
                            onDrop={(e) => { if (!canAttach) return; e.preventDefault(); setDragging(false); void attach(Array.from(e.dataTransfer.files)) }}
                            className={dragging ? 'rounded-md border border-dashed border-primary p-2' : canAttach ? 'rounded-md border border-dashed border-border p-2' : undefined}>
                            <p className="flex flex-wrap items-center gap-2">
                                {uploading ? 'Adding…' : h.files.length ? h.files.map((f) => (
                                    <span key={f.nodeId} className="inline-flex items-center gap-1">{f.name}
                                        {canAttach && onRemoveFile ? <button type="button" aria-label={`Remove ${f.name}`} className="rounded-[3px] px-1 text-muted-foreground hover:bg-muted hover:text-foreground" onClick={() => void remove(f.nodeId)}>×</button> : null}
                                    </span>
                                )) : canAttach ? 'Drop your file here, or choose one.' : 'No file attached yet.'}
                                {canAttach ? (
                                    <label className="inline-flex cursor-pointer items-center rounded-md border border-input px-2.5 py-1 text-[13px] hover:bg-muted">
                                        Choose file<input type="file" multiple className="sr-only" disabled={uploading} onChange={(e) => { void attach(Array.from(e.target.files ?? [])); e.target.value = '' }} />
                                    </label>
                                ) : null}
                                <Button type="button" size="sm" variant="ghost" onClick={onOpenFiles}>{h.files.length ? 'Manage files' : 'Open files'}</Button>
                            </p>
                        </div>
                    ) : null}
                    <label className="block space-y-1"><span className="font-medium">Add a note (optional)</span>
                        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className={area} />
                    </label>
                    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
                    <Button type="button" disabled={pending || uploading || (h.submissionType === 'file' && h.files.length === 0)} onClick={submit}>{pending ? 'Submitting…' : label}</Button>
                </div>
            ) : null}
        </section>
    )
}
