'use client'
import { CharCount } from "@/components/ui/CharCount";

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { appealAction, withdrawAppealAction } from '@/app/actions/moderation'
import { Button } from '@/components/ui/button'

const DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', timeZone: 'Asia/Kolkata' })

/** §10.3: one appeal per decision; the restriction stays while we review. */
export function AppealForm({ caseNumber, status, appealState, workspaceAction, appealUntil }: {
    caseNumber: string; status: 'open' | 'sent' | 'closed' | 'not_appealable'; appealState: string | null; workspaceAction: boolean; appealUntil: string | null
}) {
    const router = useRouter()
    const [body, setBody] = useState('')
    const [fixed, setFixed] = useState(false)
    const [error, setError] = useState<string | null>(null)
    const [sent, setSent] = useState<string | null>(null)
    const [pending, start] = useTransition()
    const decideBy = DATE.format(new Date(Date.now() + 72 * 3_600_000))

    if (sent) return <p role="status" className="nb-body mt-6 text-foreground">Appeal sent. We&apos;ll decide by {sent} and email you.</p>
    if (status === 'not_appealable') return <p className="nb-body mt-6 text-foreground">This decision can&apos;t be appealed. Questions? Email support@networkbase.in and mention {caseNumber}.</p>
    if (status === 'closed') return <p className="nb-body mt-6 text-foreground">The appeal window has closed. Questions? Email support@networkbase.in and mention {caseNumber}.</p>
    if (status === 'sent') {
        const decided = appealState && !['pending', 'in_review'].includes(appealState)
        return (
            <div className="mt-6 space-y-3">
                <p className="nb-body text-foreground">{decided ? `Appeal decided (${appealState}). This was your one appeal for ${caseNumber}.` : 'Appeal sent. We’ll email you when it’s decided.'}</p>
                {appealState === 'pending' ? (
                    <Button variant="outline" disabled={pending} onClick={() => start(async () => {
                        const result = await withdrawAppealAction(caseNumber)
                        if (!result.success) return setError(result.error)
                        router.refresh()
                    })}>Withdraw appeal</Button>
                ) : null}
                {error ? <p role="alert" className="text-[13px] text-destructive">{error}</p> : null}
            </div>
        )
    }
    return (
        <form className="mt-6 space-y-4" onSubmit={(e) => {
            e.preventDefault()
            start(async () => {
                const result = await appealAction({ caseNumber, body, fixed })
                if (!result.success) return setError(result.error)
                setSent(DATE.format(new Date(result.decideBy)))
            })
        }}>
            <label className="block text-sm font-medium text-foreground">Why should we look again?
                <textarea required rows={6} maxLength={1000} value={body} onChange={(e) => setBody(e.target.value)}
                    className="mt-1.5 w-full resize-y rounded-[5px] border border-input bg-card px-3 py-2.5 text-[13px] font-normal" />
                <CharCount value={body.length} max={1000} className="mt-1 block" />
            </label>
            {workspaceAction ? (
                <label className="flex items-center gap-2 text-sm text-foreground"><input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)} /> I&apos;ve changed or removed the content</label>
            ) : null}
            <p className="nb-compact text-muted-foreground">You get one appeal for this decision{appealUntil ? `, until ${appealUntil}` : ''}. We&apos;ll reply by {decideBy}. Your restriction stays in place while we review.</p>
            {error ? <p role="alert" className="rounded-[5px] border border-destructive/30 bg-[var(--status-danger-soft)] px-3 py-2 text-[13px]">{error}</p> : null}
            <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" onClick={() => router.back()}>Cancel</Button>
                <Button type="submit" disabled={pending || !body.trim()}>{pending ? 'Sending…' : 'Send appeal'}</Button>
            </div>
        </form>
    )
}
