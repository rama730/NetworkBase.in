'use client'

import { useEffect, useState, useTransition } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { readHandInAction, submitAssignmentAction, type HandIn } from '@/app/actions/assignments'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { webLink } from '@/lib/organizations/assignment-rules'

// Hand in, in the task panel (report §34.4, decision 85): every hand-in type, an optional note, and the state with
// what to do next. Files attach in the panel's Files tab; Submit locks them with this version (decision 127).

const WHEN = new Intl.DateTimeFormat('en', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
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

export function HandInSection({ copyId, onOpenFiles, onSubmitted }: { copyId: string; onOpenFiles: () => void; onSubmitted: (reviewRequired: boolean) => void }) {
    const client = useQueryClient()
    const query = useQuery({ queryKey: ['hand-in', copyId], queryFn: () => readHandInAction(copyId), staleTime: 0 })
    const [link, setLink] = useState('')
    const [text, setText] = useState('')
    const [note, setNote] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const h = query.data?.success ? query.data.handIn : null
    // Failure keeps the text (report §32.6); a fresh load starts from what was last handed in.
    useEffect(() => { if (h?.latest) { setLink((v) => v || h.latest!.link || ''); setText((v) => v || h.latest!.text || '') } }, [h?.latest])
    if (!h) return null
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
                    {h.reviewRequired ? ` · Reviewed by ${h.from}` : ''}
                </p>
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
                        <p className="flex flex-wrap items-center gap-2">
                            {h.files.length ? h.files.map((f) => f.name).join(', ') : 'No file attached yet.'}
                            <Button type="button" size="sm" variant="outline" onClick={onOpenFiles}>{h.files.length ? 'Change files' : 'Attach a file'}</Button>
                        </p>
                    ) : null}
                    <label className="block space-y-1"><span className="font-medium">Add a note (optional)</span>
                        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={500} className={area} />
                    </label>
                    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
                    <Button type="button" disabled={pending || (h.submissionType === 'file' && h.files.length === 0)} onClick={submit}>{pending ? 'Submitting…' : label}</Button>
                </div>
            ) : null}
        </section>
    )
}
