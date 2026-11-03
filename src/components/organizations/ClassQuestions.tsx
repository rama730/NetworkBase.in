'use client'

import { useState, useTransition } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { createTaskCommentAction, readClassQuestionsAction } from '@/app/actions/task-comment'
import { Button } from '@/components/ui/button'
import { formatDistanceToNow } from '@/lib/utils/date'

// Class questions on a copy (report §23.5, decision 16): the main assignment's shared thread, read and asked from the
// student's own copy. The line above the box always says who will see the message.

const area = 'w-full resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring'

export function ClassQuestions({ copyId }: { copyId: string }) {
    const client = useQueryClient()
    const query = useQuery({ queryKey: ['class-questions', copyId], queryFn: () => readClassQuestionsAction(copyId), staleTime: 15_000 })
    const [draft, setDraft] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [pending, startTransition] = useTransition()
    const data = query.data?.success ? query.data : null
    if (query.isPending) return <p className="p-6 text-sm text-muted-foreground">Loading class questions…</p>
    if (!data) return <p className="p-6 text-sm text-muted-foreground">{query.data && !query.data.success ? query.data.error : 'Couldn’t load class questions.'}</p>
    const post = () => startTransition(async () => {
        const result = await createTaskCommentAction(data.masterId, data.orgId, draft.trim())
        if (!result.success) return setError(`${result.error ?? 'Couldn’t post.'} Your text is still here.`)
        setDraft('')
        setError(null)
        await client.invalidateQueries({ queryKey: ['class-questions', copyId] })
    })
    return (
        <div className="space-y-4 p-6 text-sm max-md:p-4">
            <ul className="space-y-3" aria-label="Class questions">
                {data.questions.length === 0 ? <li className="text-muted-foreground">No questions yet.</li> : null}
                {data.questions.map((q) => (
                    <li key={q.id} className="space-y-1 rounded-md border border-border p-3">
                        <p className="text-[12px] text-muted-foreground">
                            {q.author?.fullName || q.author?.username || 'Someone'} · {formatDistanceToNow(new Date(q.createdAt), { addSuffix: true })}
                            {q.answered ? <span className="nb-status ml-2" data-status="completed">Answered</span> : null}
                        </p>
                        <p className="whitespace-pre-line">{q.deletedAt ? 'Deleted' : q.content}</p>
                        {q.replies.map((r) => (
                            <div key={r.id} className="ml-4 border-l border-border pl-3">
                                <p className="text-[12px] text-muted-foreground">{r.author?.fullName || r.author?.username || 'Someone'}</p>
                                <p className="whitespace-pre-line">{r.deletedAt ? 'Deleted' : r.content}</p>
                            </div>
                        ))}
                    </li>
                ))}
            </ul>
            {data.canPost ? (
                <div className="space-y-2">
                    <p className="text-[12px] text-muted-foreground">Everyone with this assignment sees this.</p>
                    <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={5000} className={area} aria-label="Ask the class" />
                    {error ? <p role="alert" className="text-destructive">{error}</p> : null}
                    <Button type="button" size="sm" disabled={pending || !draft.trim()} onClick={post}>Ask</Button>
                </div>
            ) : <p className="text-[12px] text-muted-foreground">You can read class questions here.</p>}
        </div>
    )
}
