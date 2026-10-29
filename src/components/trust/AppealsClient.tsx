'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { toast } from '@/lib/feedback'

import { claimAppealAction, decideAppealAction } from '@/app/actions/moderation-staff'
import { FIELD } from '@/components/trust/NewCaseDialog'
import { Button } from '@/components/ui/button'

type Outcome = 'upheld' | 'reduced' | 'reversed'
const REPLIES: Record<Outcome, string> = {
    upheld: 'We looked again and the decision stays. It broke our rules as described.',
    reduced: 'We looked again and made the decision lighter.',
    reversed: 'We looked again and got this wrong. We’ve reversed the decision.',
}
const REDUCTIONS = [
    { id: 'hide', label: 'Hide instead of remove', value: { action: 'hide' as const } },
    { id: 'limit7', label: 'Limit 7 days', value: { action: 'limit' as const, days: 7 } },
    { id: 'suspension14', label: 'Suspend 14 days', value: { action: 'suspension' as const, days: 14 } },
]

/** The appeal outcome form (17.6). Reduced shows only lighter steps; the reply is required. */
export function AppealOutcomeForm({ caseId, label, personName, selfReview, claimed, actions }: { caseId: string; label: string; personName: string; selfReview: boolean; claimed: boolean; actions: string[] }) {
    const router = useRouter()
    const [outcome, setOutcome] = useState<Outcome | null>(null)
    const [reduce, setReduce] = useState<string | null>(null)
    const [reply, setReply] = useState('')
    const [note, setNote] = useState('')
    const [error, setError] = useState<string | null>(null)
    const [pending, start] = useTransition()
    const reductions = REDUCTIONS.filter((r) => r.id === 'hide' ? actions.includes('remove') : r.id === 'limit7' ? actions.some((a) => ['limit', 'suspension', 'ban'].includes(a)) : actions.includes('ban'))
    const consequences = outcome === 'upheld' ? `${personName} gets M10: the decision stays. No second appeal.`
        : outcome === 'reduced' ? `${personName} gets M11 with the lighter step. The strike stays.`
        : outcome === 'reversed' ? `${personName} gets M11: everything is undone and the strike is removed.` : 'Pick an outcome.'
    const pick = (next: Outcome) => { setOutcome(next); if (!reply || Object.values(REPLIES).includes(reply)) setReply(REPLIES[next]) }
    return (
        <div className="max-w-[64ch] space-y-3">
            {!claimed ? <Button size="sm" variant="outline" disabled={pending} onClick={() => start(async () => { const r = await claimAppealAction(caseId); toast(r.success ? `You're reviewing the appeal on ${label}` : r.error); router.refresh() })}>I&apos;m reviewing</Button> : null}
            {selfReview ? (
                <p role="note" className="rounded-[5px] border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] px-3 py-2 text-[13px]">You made this decision. Add a note explaining the second look.</p>
            ) : null}
            <div className="flex flex-wrap gap-1">
                {(['upheld', 'reduced', 'reversed'] as const).map((o) => (
                    <label key={o} className={`inline-flex items-center gap-1.5 rounded-[5px] px-1.5 py-1 text-[13px] capitalize ${o === 'reduced' && !reductions.length ? 'opacity-50' : 'cursor-pointer hover:bg-muted'}`}>
                        <input type="radio" name="appeal-outcome" checked={outcome === o} disabled={o === 'reduced' && !reductions.length} onChange={() => pick(o)} />{o}
                    </label>
                ))}
            </div>
            {outcome === 'reduced' ? (
                <div className="flex flex-wrap gap-1">
                    {reductions.map((r) => (
                        <label key={r.id} className="inline-flex cursor-pointer items-center gap-1.5 rounded-[5px] px-1.5 py-1 text-[13px] hover:bg-muted">
                            <input type="radio" name="appeal-reduce" checked={reduce === r.id} onChange={() => setReduce(r.id)} />{r.label}
                        </label>
                    ))}
                </div>
            ) : null}
            <label className="block text-[13px] font-medium">Reply to {personName}
                <textarea rows={4} maxLength={4000} value={reply} onChange={(e) => setReply(e.target.value)} className={`${FIELD} py-2`} />
            </label>
            <label className="block text-[13px] font-medium">Internal note{selfReview ? ' (required)' : ''}
                <textarea rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} className={`${FIELD} py-2`} />
            </label>
            <p className="rounded-[5px] bg-secondary px-3 py-2 text-[13px]">{consequences}</p>
            {error ? <p role="alert" className="rounded-[5px] border border-destructive/30 bg-[var(--status-danger-soft)] px-3 py-2 text-[13px]">{error}</p> : null}
            <div className="flex justify-end">
                <Button className="min-w-[124px]" disabled={pending || !outcome || !reply.trim() || (outcome === 'reduced' && !reduce) || (selfReview && !note.trim())} onClick={() => start(async () => {
                    setError(null)
                    const result = await decideAppealAction(caseId, { outcome: outcome!, reply, note, reduceTo: REDUCTIONS.find((r) => r.id === reduce)?.value ?? null })
                    if (!result.success) return setError(result.error)
                    toast(`Outcome sent · ${label}`)
                    router.push('/admin/trust?tab=appeals')
                })}>{pending ? 'Sending…' : 'Send outcome'}</Button>
            </div>
        </div>
    )
}
