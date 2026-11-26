'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, useTransition } from 'react'
import { ConfirmDialog } from '@/components/ui/ConfirmDialog'

import { decideOrgReportAction, readOrgReportsAction } from '@/app/actions/moderation-org'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/feedback'
import { KIND_NOUN, REPORT_REASON_LABEL } from '@/lib/trust/rules'

// Settings → Moderation → Reports (report §22.4; docs/trust-and-safety-concept.md §11.6): the org's own non-urgent cases. Unanswered cases pass
// to NetworkBase at the deadline. Reporters are never named.

type Cases = Extract<Awaited<ReturnType<typeof readOrgReportsAction>>, { success: true }>['cases']

const dueText = (at: string | null) => {
    if (!at) return ''
    const hours = Math.round((new Date(at).getTime() - Date.now()) / 3_600_000)
    return hours <= 0 ? 'passing to NetworkBase' : hours < 24 ? `${hours}h left` : `${Math.round(hours / 24)}d left`
}

export function OrgReportsSection({ orgId, showEmpty = false }: { orgId: string; showEmpty?: boolean }) {
    const [cases, setCases] = useState<Cases | null>(null)
    const [pending, start] = useTransition()
    const [removing, setRemoving] = useState<string | null>(null)
    const load = useCallback(() => void readOrgReportsAction(orgId).then((r) => setCases(r.success ? r.cases : [])), [orgId])
    useEffect(() => { load() }, [load])
    // Report §22.4: Settings → Moderation says so when there's nothing open.
    if (!cases) return showEmpty ? <div className="nb-skeleton h-14 rounded-md" role="status" aria-label="Loading reports" /> : null
    if (!cases.length) return showEmpty ? <p className="text-[13px] text-muted-foreground">No open reports.</p> : null
    const decide = (caseId: string, choice: 'dismiss' | 'hide' | 'remove' | 'warn', done: string) => start(async () => {
        const result = await decideOrgReportAction(orgId, caseId, choice)
        if (!result.success) return void toast.error(result.error ?? 'Couldn’t decide that report.')
        toast.success(done)
        load()
    })
    return (
        <section aria-label={`Open reports · ${cases.length}`} className="space-y-3">
            {cases.map((c) => (
                <div key={c.id} className="space-y-2 rounded-md bg-muted p-3 text-[13px]">
                    <p><span className="font-medium">{REPORT_REASON_LABEL[c.reason]}</span> <span className="text-muted-foreground">· {KIND_NOUN[c.target_kind]} · {c.reports} {c.reports === 1 ? 'report' : 'reports'} · {dueText(c.org_deadline_at)}</span></p>
                    <p className="line-clamp-2 text-muted-foreground">{c.href ? <Link href={c.href} className="nb-link">{c.label}</Link> : c.label}</p>
                    {c.content ? <blockquote className="line-clamp-3 rounded-sm bg-background px-2 py-1.5">{c.content}</blockquote> : null}
                    {c.details ? <p className="line-clamp-2 text-muted-foreground">“{c.details}”</p> : null}
                    <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => decide(c.id, 'dismiss', 'Report dismissed')}>Dismiss</Button>
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => decide(c.id, 'hide', 'Hidden')}>Hide</Button>
                        <Button size="sm" variant="outline" className="text-destructive" disabled={pending} onClick={() => setRemoving(c.id)}>Remove…</Button>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide(c.id, 'warn', 'Author warned')}>Warn author</Button>
                    </div>
                </div>
            ))}
            <ConfirmDialog open={Boolean(removing)} onOpenChange={(open) => { if (!open) setRemoving(null) }} variant="destructive" title="Remove this content?"
                description="It's taken down for everyone. The reporter isn't named and the author is told." confirmLabel="Remove content"
                onConfirm={() => { const id = removing; setRemoving(null); if (id) decide(id, 'remove', 'Removed') }} />
        </section>
    )
}
