import Link from 'next/link'

import { NewCaseDialog } from '@/components/trust/NewCaseDialog'
import { CopyText } from '@/components/trust/CopyText'
import { caseHref, istDate } from '@/components/trust/format'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/ui/UserAvatar'
import type { readPerson } from '@/lib/trust/console'
import { ACTION_LABEL, caseLabel, REPORT_REASON_LABEL, ruleLabel, type ModerationActionKind } from '@/lib/trust/rules'

export type Person = NonNullable<Awaited<ReturnType<typeof readPerson>>>

function Section({ title, empty, children }: { title: string; empty: boolean; children: React.ReactNode }) {
    return (
        <section className="border-b border-border py-4">
            <h2 className="nb-micro mb-2">{title}</h2>
            {empty ? <p className="text-[13px] text-muted-foreground">None.</p> : <ul className="space-y-1.5 text-[13px]">{children}</ul>}
        </section>
    )
}

/** A person's standing (17.8), on its page and in the case's side drawer. Email addresses appear only here, for staff. */
export function PersonView({ p }: { p: Person }) {
    const handle = p.username ? `@${p.username}` : p.id
    const active = p.actions.filter((a) => !a.undone_at && !a.reversed_at && !a.lifted_at && ['limit', 'suspension', 'ban'].includes(a.action) && (!a.ends_at || new Date(a.ends_at) > new Date()))
    const strikes = p.actions.filter((a) => a.strike && !a.undone_at && !a.reversed_at && a.strike_expires_at && new Date(a.strike_expires_at) > new Date())
    return (
        <article className="max-w-[880px]">
            <header className="flex flex-wrap items-center gap-4 border-b border-border pb-4">
                <UserAvatar identity={{ id: p.id, fullName: p.name, username: p.username, avatarUrl: p.avatar }} size={48} roundedClassName="rounded-[6px]" />
                <div className="min-w-0 flex-1">
                    <h1 className="text-[20px] font-semibold">{p.name ?? 'No name'} {p.username ? <span className="text-muted-foreground">@{p.username}</span> : null}</h1>
                    <p className="nb-meta">Joined {istDate(p.created_at)} · {p.email ? <CopyText text={p.email} /> : 'no email'}</p>
                </div>
                <span className="nb-status" data-status={p.restriction ? 'blocked' : 'completed'}>{p.restriction ? `${p.restriction}${p.until ? ` until ${istDate(p.until)}` : ''}` : 'good standing'}</span>
                <NewCaseDialog what={handle.startsWith('@') ? handle : ''} trigger={<Button variant="outline">Act on account</Button>} />
            </header>
            <Section title="Active restrictions" empty={!active.length}>
                {active.map((a) => <li key={a.id}>{ACTION_LABEL[a.action as ModerationActionKind]} · until {a.ends_at ? istDate(a.ends_at) : 'permanent'}{a.case_number ? <> · <Link className="underline underline-offset-4" href={caseHref(a.case_number)}>{caseLabel(a.case_number)}</Link></> : null}</li>)}
            </Section>
            <Section title={`Strikes (${strikes.length})`} empty={!strikes.length}>
                {strikes.map((a) => <li key={a.id}>{ACTION_LABEL[a.action as ModerationActionKind]}{a.rule ? ` · ${ruleLabel(a.rule)}` : ''} · expires {istDate(a.strike_expires_at)}</li>)}
            </Section>
            <Section title="Cases about them" empty={!p.cases.length}>
                {p.cases.map((c) => <li key={c.id}><Link className="underline underline-offset-4" href={caseHref(c.number)}>{caseLabel(c.number)}</Link> · {REPORT_REASON_LABEL[c.reason]} · {c.label} · {c.outcome ?? c.state}</li>)}
            </Section>
            <Section title="Appeals" empty={!p.appeals.length}>
                {p.appeals.map((a) => <li key={a.number}><Link className="underline underline-offset-4" href={`/admin/trust?case=${caseLabel(a.number)}&type=appeal`}>{caseLabel(a.number)}</Link> · {a.state} · {istDate(a.created_at)}</li>)}
            </Section>
            <Section title={`Reports they made · ${p.accuracy.actioned} of ${p.accuracy.total} actioned`} empty={!p.reported.length}>
                {p.reported.map((r, i) => <li key={i}>{REPORT_REASON_LABEL[r.reason]} · {r.status}{r.number ? <> · <Link className="underline underline-offset-4" href={caseHref(r.number)}>{caseLabel(r.number)}</Link></> : null} · {istDate(r.created_at)}</li>)}
            </Section>
            <Section title="Workspaces and orgs they own" empty={!p.owned.length}>
                {p.owned.map((w) => <li key={w.id}><Link className="underline underline-offset-4" href={`/${w.kind === 'organization' ? 'org' : 'workspaces'}/${encodeURIComponent(w.slug ?? w.id)}`}>{w.title}</Link></li>)}
            </Section>
        </article>
    )
}
