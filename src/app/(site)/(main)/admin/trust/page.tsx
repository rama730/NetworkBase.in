import Link from 'next/link'
import { redirect } from 'next/navigation'
import { UserRound } from 'lucide-react'

import { ActiveTable, AuditTable } from '@/components/trust/ConsoleTabs'
import { ConsoleScroll } from '@/components/trust/ConsoleScroll'
import { HealthTab } from '@/components/trust/HealthTab'
import { PeopleResults } from '@/components/trust/PeopleResults'
import { RefreshOnEvents } from '@/components/trust/RefreshOnEvents'
import { RuleTemplates } from '@/components/trust/RuleTemplates'
import { StaffList } from '@/components/trust/StaffList'
import { TrustInbox } from '@/components/trust/TrustInbox'
import { EmptyState } from '@/components/ui/EmptyState'
import { getViewerAuthContext } from '@/lib/server/viewer-context'
import { readActive, readAudit, readHealth, searchPeople } from '@/lib/trust/console'
import { inboxCounts, ruleTemplates } from '@/lib/trust/inbox'
import { listStaff, staffRoleOf } from '@/lib/trust/staff'

type Search = Record<string, string | string[] | undefined>
const one = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) || undefined
// Links from before the redesign (R1) land on the tab that now holds them.
const OLD_TABS: Record<string, string> = {
    queue: '/admin/trust', appeals: '/admin/trust?view=appeals', verification: '/admin/trust', active: '/admin/trust?tab=enforcement',
    people: '/admin/trust?tab=enforcement', health: '/admin/trust?tab=insights', audit: '/admin/trust?tab=insights&section=audit',
}

function Sections({ tab, current, items }: { tab: string; current: string; items: Array<[string, string]> }) {
    return (
        <div role="tablist" aria-label="Section" className="mt-4 flex gap-1">
            {items.map(([id, label]) => (
                <Link key={id} role="tab" aria-selected={current === id} href={`/admin/trust?tab=${tab}&section=${id}`}
                    className={`rounded-[5px] px-2.5 py-1.5 text-[13px] font-medium ${current === id ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted'}`}>{label}</Link>
            ))}
        </div>
    )
}

/** Four tabs (R1): Inbox, Enforcement, Insights, Staff. The Inbox is client data, updated in place (S6). */
export default async function TrustConsolePage({ searchParams }: { searchParams: Promise<Search> }) {
    const params = await searchParams
    const tab = one(params.tab) ?? 'inbox'
    if (OLD_TABS[tab] && tab !== 'queue') {
        const q = one(params.q)
        redirect(tab === 'people' && q ? `/admin/trust?tab=enforcement&section=people&q=${encodeURIComponent(q)}` : OLD_TABS[tab]!)
    }
    if (tab === 'inbox' || tab === 'queue') return <TrustInbox />

    const { user } = await getViewerAuthContext()
    const role = staffRoleOf(user)!
    const section = one(params.section)

    if (tab === 'enforcement') {
        const current = section === 'people' ? 'people' : 'active'
        const q = one(params.q) ?? ''
        return (
            <ConsoleScroll>
                <RefreshOnEvents />
                <Sections tab="enforcement" current={current} items={[['active', 'In force'], ['people', 'People']]} />
                {current === 'active' ? <ActiveTable data={await readActive()} /> : (
                    <section className="mt-4 max-w-[720px]">
                        <form action="/admin/trust" className="flex gap-2">
                            <input type="hidden" name="tab" value="enforcement" /><input type="hidden" name="section" value="people" />
                            <input name="q" type="search" defaultValue={q} placeholder="Search name, @handle or email" aria-label="Search people" className="h-[34px] w-full rounded-[5px] border border-input bg-card px-3 text-[13px]" />
                        </form>
                        {q ? <PeopleResults people={await searchPeople(q)} /> : <EmptyState icon={UserRound} className="mt-6" title="Find a person" description="Their standing, strikes and cases open in a side drawer." />}
                    </section>
                )}
            </ConsoleScroll>
        )
    }
    if (tab === 'insights') {
        const current = section === 'audit' ? 'audit' : 'health'
        if (current === 'audit') {
            const filters = { action: one(params.action), from: one(params.from), to: one(params.to), staff: one(params.staff) }
            const before = Number(one(params.before)) || undefined
            const [data, staff] = await Promise.all([readAudit({ kind: filters.action, from: filters.from, to: filters.to, staff: filters.staff, before }), listStaff()])
            return (
                <ConsoleScroll>
                    <Sections tab="insights" current="audit" items={[['health', 'Health'], ['audit', 'Audit log']]} />
                    {before ? <Link href={`/admin/trust?tab=insights&section=audit`} className="mt-3 inline-block text-[13px] underline underline-offset-4">Back to the newest</Link> : null}
                    <AuditTable data={data} staff={staff} filters={filters} />
                </ConsoleScroll>
            )
        }
        const days = [7, 30, 90].includes(Number(one(params.days))) ? Number(one(params.days)) : 30
        const [h, counts] = await Promise.all([readHealth(days), inboxCounts()])
        return (
            <ConsoleScroll>
                <RefreshOnEvents />
                <Sections tab="insights" current="health" items={[['health', 'Health'], ['audit', 'Audit log']]} />
                <HealthTab h={h} days={days} counts={counts} />
            </ConsoleScroll>
        )
    }
    if (tab === 'staff' && role === 'admin') {
        const [staff, templates] = await Promise.all([listStaff(), ruleTemplates()])
        return (
            <ConsoleScroll>
                <div className="mt-4 grid max-w-[1100px] gap-8 xl:grid-cols-2">
                    <section><h2 className="mb-2 text-[15px] font-semibold">Staff ({staff.length})</h2><StaffList staff={staff} canEdit /></section>
                    <section><h2 className="text-[15px] font-semibold">Message templates</h2><p className="mb-2 text-[13px] text-muted-foreground">The opening message for each rule. Leave one empty to use the built-in sentence.</p><RuleTemplates templates={templates} /></section>
                </div>
            </ConsoleScroll>
        )
    }
    redirect('/admin/trust')
}
