'use client'

import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'

import { decideOrgVerificationAction, dismissReportAction, hideFromDiscoverAction, removeReportedContentAction, suspendOrgAction, unsuspendOrgAction, type readAdminReportsAction } from '@/app/actions/trust'
import { Button } from '@/components/ui/button'
import { REPORT_REASON_LABEL, type ReportReason } from '@/lib/organizations/trust-rules'

type Data = NonNullable<Awaited<ReturnType<typeof readAdminReportsAction>>>

const KIND_LABEL: Record<string, string> = { project: 'Workspace or organization', update: 'Post', update_comment: 'Post comment', doc: 'Doc', task_comment: 'Task comment' }

export function AdminReportsClient({ data }: { data: Data }) {
    const router = useRouter()
    const [pending, start] = useTransition()
    const [message, setMessage] = useState<string | null>(null)
    const run = (action: () => Promise<{ success: boolean; error?: string }>) => start(async () => {
        const result = await action()
        setMessage(result.success ? 'Done.' : result.error ?? 'Couldn’t finish that.')
        if (result.success) router.refresh()
    })
    const suspend = (orgId: string, reportId?: string) => {
        const reason = window.prompt('Reason the owner will see')
        if (reason) run(() => suspendOrgAction({ orgId, reason, reportId }))
    }
    return (
        <main className="mx-auto max-w-4xl space-y-10 px-4 py-8">
            <header>
                <h1 className="nb-page-title text-foreground">Moderation</h1>
                <p className="nb-compact mt-1 text-muted-foreground">Dismiss, hide from Discover, remove content or suspend an organization.</p>
                {message ? <p role="status" className="mt-2 text-sm text-muted-foreground">{message}</p> : null}
            </header>

            <section aria-labelledby="open-reports" className="space-y-3">
                <h2 id="open-reports" className="nb-micro">Open reports ({data.reports.length})</h2>
                {data.reports.length === 0 ? <p className="text-sm text-muted-foreground">Nothing to review.</p> : null}
                {data.reports.map((r) => (
                    <article key={r.id} className="rounded-[6px] border border-border p-3">
                        <p className="text-sm text-foreground"><span className="font-medium">{KIND_LABEL[r.target_kind] ?? r.target_kind}</span> · {REPORT_REASON_LABEL[r.reason as ReportReason] ?? r.reason}{r.reports > 1 ? ` · ${r.reports} reports` : ''}</p>
                        <p className="text-xs text-muted-foreground">
                            {r.project_title ? <Link className="underline" href={`/${r.project_kind === 'organization' ? 'org' : 'projects'}/${encodeURIComponent(r.project_slug ?? r.project_id ?? '')}`}>{r.project_title}</Link> : 'Deleted'}
                            {r.suspended ? ' · suspended' : ''} · {new Date(r.created_at).toLocaleString()}
                        </p>
                        {r.excerpt ? <blockquote className="mt-2 border-l-2 border-border pl-2 text-sm text-foreground/80">{r.excerpt}</blockquote> : null}
                        {r.details ? <p className="mt-2 text-sm text-foreground">“{r.details}”</p> : null}
                        <div className="mt-3 flex flex-wrap gap-2">
                            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => dismissReportAction(r.id))}>Dismiss</Button>
                            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => hideFromDiscoverAction(r.id))}>Hide from Discover</Button>
                            {r.target_kind !== 'project' ? <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => removeReportedContentAction(r.id))}>Remove content</Button> : null}
                            {r.project_kind === 'organization' && r.project_id && !r.suspended ? <Button size="sm" variant="destructive" disabled={pending} onClick={() => suspend(r.project_id!, r.id)}>Suspend org</Button> : null}
                        </div>
                    </article>
                ))}
            </section>

            <section aria-labelledby="verification" className="space-y-3">
                <h2 id="verification" className="nb-micro">Verification requests ({data.verification.length})</h2>
                {data.verification.map((v) => (
                    <article key={v.id} className="flex flex-wrap items-center gap-3 rounded-[6px] border border-border p-3">
                        <Link className="text-sm font-medium underline" href={`/org/${encodeURIComponent(v.slug ?? v.id)}`}>{v.title}</Link>
                        <span className="text-xs text-muted-foreground">{v.websites.join(', ') || 'No website'}</span>
                        <span className="ml-auto flex gap-2">
                            <Button size="sm" disabled={pending} onClick={() => run(() => decideOrgVerificationAction(v.id, true))}>Verify</Button>
                            <Button size="sm" variant="outline" disabled={pending} onClick={() => run(() => decideOrgVerificationAction(v.id, false))}>Decline</Button>
                        </span>
                    </article>
                ))}
            </section>

            <section aria-labelledby="suspended" className="space-y-3">
                <h2 id="suspended" className="nb-micro">Suspended organizations ({data.suspended.length})</h2>
                {data.suspended.map((s) => (
                    <article key={s.id} className="flex flex-wrap items-center gap-3 rounded-[6px] border border-border p-3">
                        <Link className="text-sm font-medium underline" href={`/org/${encodeURIComponent(s.slug ?? s.id)}`}>{s.title}</Link>
                        <span className="text-xs text-muted-foreground">{s.reason}</span>
                        <Button size="sm" variant="outline" className="ml-auto" disabled={pending} onClick={() => run(() => unsuspendOrgAction(s.id))}>Lift suspension</Button>
                    </article>
                ))}
            </section>
        </main>
    )
}
