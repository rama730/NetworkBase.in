'use client'

import Link from 'next/link'
import { useCallback, useEffect, useState, useTransition } from 'react'

import { decideOrgReportAction, readOrgReportsAction } from '@/app/actions/moderation-org'
import { Button } from '@/components/ui/button'
import { toast } from '@/lib/feedback'
import { KIND_NOUN, REPORT_REASON_LABEL } from '@/lib/trust/rules'

// Members → Reports (docs/trust-and-safety-concept.md §11.6): the org's own non-urgent cases. Unanswered cases pass
// to NetworkBase at the deadline. Reporters are never named.

type Cases = Extract<Awaited<ReturnType<typeof readOrgReportsAction>>, { success: true }>['cases']

const dueText = (at: string | null) => {
    if (!at) return ''
    const hours = Math.round((new Date(at).getTime() - Date.now()) / 3_600_000)
    return hours <= 0 ? 'passing to NetworkBase' : hours < 24 ? `${hours}h left` : `${Math.round(hours / 24)}d left`
}

export function OrgReportsSection({ orgId }: { orgId: string }) {
    const [cases, setCases] = useState<Cases | null>(null)
    const [pending, start] = useTransition()
    const load = useCallback(() => void readOrgReportsAction(orgId).then((r) => setCases(r.success ? r.cases : [])), [orgId])
    useEffect(() => { load() }, [load])
    if (!cases?.length) return null
    const decide = (caseId: string, choice: 'dismiss' | 'hide' | 'remove' | 'warn', done: string) => start(async () => {
        const result = await decideOrgReportAction(orgId, caseId, choice)
        toast(result.success ? done : result.error)
        load()
    })
    return (
        <section aria-label="Reports" className="space-y-2">
            <h3 className="text-sm font-semibold">Reports · {cases.length}</h3>
            {cases.map((c) => (
                <div key={c.id} className="space-y-1.5 rounded-md border border-border p-2 text-[13px]">
                    <p><span className="font-medium">{REPORT_REASON_LABEL[c.reason]}</span> <span className="text-muted-foreground">· {KIND_NOUN[c.target_kind]} · {c.reports} {c.reports === 1 ? 'report' : 'reports'} · {dueText(c.org_deadline_at)}</span></p>
                    <p className="line-clamp-2 text-muted-foreground">{c.href ? <Link href={c.href} className="underline underline-offset-4">{c.label}</Link> : c.label}</p>
                    {c.content ? <blockquote className="line-clamp-3 border-l-2 border-border pl-2">{c.content}</blockquote> : null}
                    {c.details ? <p className="line-clamp-2 text-muted-foreground">“{c.details}”</p> : null}
                    <div className="flex flex-wrap gap-1.5">
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => decide(c.id, 'dismiss', 'Report dismissed')}>Dismiss</Button>
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => decide(c.id, 'hide', 'Hidden')}>Hide</Button>
                        <Button size="sm" variant="outline" disabled={pending} onClick={() => decide(c.id, 'remove', 'Removed')}>Remove</Button>
                        <Button size="sm" variant="ghost" disabled={pending} onClick={() => decide(c.id, 'warn', 'Author warned')}>Warn author</Button>
                    </div>
                </div>
            ))}
        </section>
    )
}
