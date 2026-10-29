import Link from 'next/link'
import { Scale, UserRound } from 'lucide-react'

import { CaseView } from '@/components/trust/CaseView'
import { ActiveTable, AuditTable, VerificationList } from '@/components/trust/ConsoleTabs'
import { Deadline, ago } from '@/components/trust/format'
import { QueueList } from '@/components/trust/QueueList'
import { EmptyState } from '@/components/ui/EmptyState'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import { readAppeals } from '@/lib/trust/appeals'
import { caseIdByNumber, readActive, readAudit, readCase, readQueue, readVerification, searchPeople, type QueueFilters } from '@/lib/trust/console'
import { caseLabel, parseCaseLabel, type ReportTargetKind, type Severity } from '@/lib/trust/rules'
import { staffRoleOf } from '@/lib/trust/staff'

type Search = Record<string, string | string[] | undefined>
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined

/** Console tabs (17.2): each has its own URL (?tab=…); Queue is the default and splits with the open case on wide screens. */
export default async function TrustConsolePage({ searchParams }: { searchParams: Promise<Search> }) {
    const params = await searchParams
    const { user } = await getViewerAuthContext()
    const role = staffRoleOf(user)!
    const tab = one(params.tab) ?? 'queue'

    if (tab === 'appeals') {
        const decided = one(params.view) === 'decided'
        const appeals = await readAppeals(!decided)
        return (
            <section className="mt-4">
                <div role="group" aria-label="View" className="mb-3 flex gap-1">
                    {[['open', 'Waiting'], ['decided', 'Decided']].map(([id, text]) => (
                        <Link key={id} href={id === 'open' ? '/admin/trust?tab=appeals' : '/admin/trust?tab=appeals&view=decided'} aria-current={(id === 'decided') === decided ? 'true' : undefined}
                            className={`rounded-[5px] px-2.5 py-1.5 text-[13px] font-medium ${(id === 'decided') === decided ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{text}</Link>
                    ))}
                </div>
                {appeals.length ? (
                    <ul className="divide-y divide-border border-y border-border">
                        {appeals.map((a) => (
                            <li key={a.case_id}>
                                <Link href={`/admin/trust/appeals/${caseLabel(a.number)}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-2 py-2.5 text-[13px] hover:bg-muted/50">
                                    <span className="nb-meta text-foreground">{caseLabel(a.number)}</span>
                                    <span className="font-medium">{a.person ?? 'Deleted user'}</span>
                                    <span className="text-muted-foreground">{a.actions?.replace(/_/g, ' ') ?? ''}</span>
                                    {a.decided_by === user!.id ? <span className="nb-status" data-status="draft">self-review</span> : null}
                                    <span className="ml-auto nb-meta">{decided ? a.state : <>sent {ago(a.created_at)} · <Deadline at={a.deadline_at} openedAt={a.created_at} /></>}</span>
                                </Link>
                            </li>
                        ))}
                    </ul>
                ) : <EmptyState icon={Scale} title={decided ? 'No decided appeals yet' : 'No appeals waiting'} />}
            </section>
        )
    }
    if (tab === 'active') return <ActiveTable data={await readActive()} />
    if (tab === 'verification') return <VerificationList rows={await readVerification()} />
    if (tab === 'audit') return <AuditTable rows={await readAudit({ kind: one(params.action), from: one(params.from), to: one(params.to) })} />
    if (tab === 'people') {
        const q = one(params.q) ?? ''
        const people = q ? await searchPeople(q) : []
        return (
            <section className="mt-4 max-w-[720px]">
                <form action="/admin/trust" className="flex gap-2">
                    <input type="hidden" name="tab" value="people" />
                    <input name="q" type="search" defaultValue={q} placeholder="Search name, @handle or email" aria-label="Search people" className="h-[34px] w-full rounded-[5px] border border-input bg-card px-3 text-[13px]" />
                </form>
                {q && !people.length ? <EmptyState icon={UserRound} className="mt-6" title="No one matches" description="Try the exact @handle or email." /> : null}
                <ul className="mt-3 divide-y divide-border">
                    {people.map((p) => (
                        <li key={p.id}>
                            <Link href={`/admin/trust/people/${p.username ? `@${p.username}` : p.id}`} className="flex min-h-14 items-center gap-3 px-2 py-2 hover:bg-muted/50">
                                <UserAvatar identity={{ id: p.id, fullName: p.name, username: p.username, avatarUrl: p.avatar }} size={32} roundedClassName="rounded-[5px]" />
                                <span className="min-w-0 flex-1 text-[13px]"><span className="font-medium">{p.name ?? 'No name'}</span> {p.username ? <span className="text-muted-foreground">@{p.username}</span> : null}</span>
                                <span className="nb-status" data-status={p.restriction ? 'blocked' : 'completed'}>{p.restriction ?? 'good standing'}</span>
                            </Link>
                        </li>
                    ))}
                </ul>
            </section>
        )
    }

    const filters: QueueFilters = {
        view: one(params.view) as QueueFilters['view'], q: one(params.q), severity: one(params.severity) as Severity | undefined, kind: one(params.kind) as ReportTargetKind | undefined,
        source: one(params.source), overdue: Boolean(one(params.overdue)), pileOn: Boolean(one(params.pileon)), unclaimed: Boolean(one(params.unclaimed)), sort: one(params.sort) as QueueFilters['sort'],
    }
    const selected = parseCaseLabel(one(params.case) ?? '')
    const [rows, caseId] = await Promise.all([readQueue(user!.id, filters), selected ? caseIdByNumber(selected) : null])
    const c = caseId ? await readCase(caseId) : null
    return (
        <div className="mt-4 grid gap-6 xl:grid-cols-[440px_minmax(0,1fr)]">
            <div className={c ? 'hidden xl:block' : undefined}><QueueList rows={rows} selected={c?.number ?? null} /></div>
            {c ? (
                <div className="min-w-0">
                    <Link href="/admin/trust" className="mb-3 inline-block text-[13px] underline underline-offset-4 xl:hidden">Back to the queue</Link>
                    <CaseView c={c} staffId={user!.id} role={role} />
                </div>
            ) : (
                <p className="hidden self-start pt-10 text-center text-[13px] text-muted-foreground xl:block">Pick a case to review it here.</p>
            )}
        </div>
    )
}
