import Link from 'next/link'
import { notFound } from 'next/navigation'

import { AppealOutcomeForm } from '@/components/trust/AppealsClient'
import { caseHref, Deadline, istDate, istDateTime } from '@/components/trust/format'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import { readAppeal } from '@/lib/trust/appeals'
import { caseIdByNumber, readCase } from '@/lib/trust/console'
import { ACTION_LABEL, caseLabel, parseCaseLabel, ruleLabel, type ModerationActionKind } from '@/lib/trust/rules'

/** One appeal (17.6): the original decision, the appeal text, the outcome form; the person in the rail. */
export default async function TrustAppealPage({ params }: { params: Promise<{ number: string }> }) {
    const number = parseCaseLabel(decodeURIComponent((await params).number))
    const caseId = number ? await caseIdByNumber(number) : null
    const [c, appeal] = caseId ? await Promise.all([readCase(caseId), readAppeal(caseId)]) : [null, null]
    if (!c || !appeal) notFound()
    const { user } = await getViewerAuthContext()
    const label = caseLabel(c.number)
    const open = appeal.state === 'pending' || appeal.state === 'in_review'
    const actions = c.actions.filter((a) => !a.undone_at)
    const personName = c.person?.name ?? (c.person?.username ? `@${c.person.username}` : 'them')
    return (
        <article className="mt-4">
            <Link href="/admin/trust?tab=appeals" className="mb-3 inline-block text-[13px] underline underline-offset-4">Back to appeals</Link>
            <header className="border-b border-border pb-4">
                <p className="nb-meta text-foreground">{label} · appeal {appeal.state.replace('_', ' ')}</p>
                <h1 className="nb-section-title mt-1">Appeal from {personName}</h1>
                <p className="nb-meta mt-1">Sent {istDateTime(appeal.created_at)} · {open ? <Deadline at={appeal.deadline_at} openedAt={appeal.created_at} /> : 'decided'}</p>
            </header>
            <div className="grid gap-6 pt-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0 space-y-6">
                    <section>
                        <h2 className="nb-micro mb-2">Original decision</h2>
                        <ul className="space-y-1 text-[13px]">
                            {actions.map((a) => (
                                <li key={a.id}>{ACTION_LABEL[a.action as ModerationActionKind] ?? a.action}{a.rule ? ` · ${ruleLabel(a.rule)}` : ''}{a.ends_at ? ` · until ${istDate(a.ends_at)}` : ''}{a.reversed_at ? ' · reversed' : a.lifted_at ? ' · lifted' : ''}</li>
                            ))}
                        </ul>
                        {actions[0]?.message ? <blockquote className="mt-2 border-l-2 border-border pl-2 text-[13px] text-muted-foreground">{actions[0].message}</blockquote> : null}
                        <Link href={caseHref(c.number)} className="mt-2 inline-block text-[13px] underline underline-offset-4">Open the case and evidence</Link>
                    </section>
                    <section>
                        <h2 className="nb-micro mb-2">Appeal</h2>
                        <div className="whitespace-pre-wrap rounded-[8px] bg-muted/60 p-4 text-[13px]">{appeal.body}</div>
                        {appeal.fixed ? <p className="mt-2 text-[13px]">They say they&apos;ve changed or removed the content.</p> : null}
                    </section>
                    <section>
                        <h2 className="nb-micro mb-2">Outcome</h2>
                        {open ? (
                            <AppealOutcomeForm caseId={c.id} label={label} personName={personName} selfReview={c.decided_by === user?.id}
                                claimed={appeal.assignee_id === user?.id} actions={actions.filter((a) => !a.reversed_at).map((a) => a.action)} />
                        ) : <p className="whitespace-pre-wrap text-[13px]">{appeal.reply}</p>}
                    </section>
                </div>
                <aside className="min-w-0 text-[13px] xl:border-l xl:border-border xl:pl-6">
                    <h2 className="nb-micro mb-2">Person</h2>
                    {c.person ? (
                        <>
                            <p className="font-medium">{personName}</p>
                            <p className="nb-meta">{c.person.strikes} active strikes{c.person.restriction ? ` · ${c.person.restriction}` : ''}</p>
                            <Link href={`/admin/trust/people/${c.person.username ? `@${c.person.username}` : c.person.id}`} className="underline underline-offset-4">Open in People</Link>
                        </>
                    ) : <p className="text-muted-foreground">No account attached.</p>}
                </aside>
            </div>
        </article>
    )
}
