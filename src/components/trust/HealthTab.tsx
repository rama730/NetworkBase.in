import Link from 'next/link'

import { StaffList } from '@/components/trust/StaffList'
import type { readHealth } from '@/lib/trust/console'
import { ACTION_LABEL, REPORT_REASON_LABEL, type ModerationActionKind } from '@/lib/trust/rules'
import type { StaffRole } from '@/lib/trust/staff'

type Health = Awaited<ReturnType<typeof readHealth>>
const dash = (value: number | null | undefined, suffix = '') => (value === null || value === undefined ? '—' : `${value}${suffix}`)

function Metric({ label, value, context }: { label: string; value: string; context?: string }) {
    return (
        <div className="rounded-[8px] border border-border bg-card p-3">
            <p className="text-[11px] font-medium text-muted-foreground">{label}</p>
            <p className="mt-1 font-mono text-[24px] leading-none tabular-nums text-foreground">{value}</p>
            {context ? <p className="mt-1.5 text-[13px] text-muted-foreground">{context}</p> : null}
        </div>
    )
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
    return <section className="rounded-[8px] border border-border bg-card p-4"><h2 className="nb-micro mb-3">{title}</h2>{children}</section>
}

const TH = 'nb-micro py-1.5 text-left font-medium'
const TD = 'py-1.5 text-[13px]'

/** Health tab (17.10): quiet numbers, "—" when there's no data, every chart with its table. */
export function HealthTab({ h, days, counts, staff, role }: { h: Health; days: number; counts: { open: number; urgent: number; overdue: number; appeals: number }; staff: Array<{ id: string; role: StaffRole; name: string | null; email: string | null }>; role: StaffRole }) {
    const max = Math.max(1, ...h.perDay.map((d) => d.urgent + d.high + d.normal))
    return (
        <div className="mt-4 space-y-4">
            <div role="radiogroup" aria-label="Range" className="flex gap-1">
                {[7, 30, 90].map((d) => (
                    <Link key={d} role="radio" aria-checked={d === days} href={`/admin/trust?tab=health&days=${d}`}
                        className={`rounded-[4px] border px-2 py-0.5 text-[12px] font-medium ${d === days ? 'border-foreground bg-foreground text-background' : 'border-border text-muted-foreground'}`}>{d} days</Link>
                ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
                <Metric label="Open cases" value={String(counts.open)} context={`${counts.urgent} urgent`} />
                <Metric label="Overdue" value={String(counts.overdue)} />
                <Metric label="Median time to decision" value={dash(h.medianHours.normal, 'h')} context={`Urgent ${dash(h.medianHours.urgent, 'h')} / High ${dash(h.medianHours.high, 'h')} vs 1h / 24h / 72h`} />
                <Metric label="Appeals pending" value={String(counts.appeals)} context={`${dash(h.appealRate, '%')} of decisions appealed`} />
                <Metric label="Reversal rate" value={dash(h.reversalRate, '%')} context="of decided appeals" />
                <Metric label="Repeat offenders" value={String(h.repeatOffenders)} context="3+ active strikes" />
            </div>
            <div className="grid gap-4 xl:grid-cols-2">
                <Panel title="New cases per day">
                    {h.perDay.length ? (
                        <>
                            <div aria-hidden="true" className="flex h-28 items-end gap-1">
                                {h.perDay.map((d) => (
                                    <div key={d.day} className="flex flex-1 flex-col justify-end" title={`${d.day}: ${d.urgent} urgent, ${d.high} high, ${d.normal} normal`}>
                                        <div style={{ height: `${(d.normal / max) * 100}%` }} className="bg-muted-foreground/40" />
                                        <div style={{ height: `${(d.high / max) * 100}%` }} className="bg-[var(--status-warning)]" />
                                        <div style={{ height: `${(d.urgent / max) * 100}%` }} className="bg-primary" />
                                    </div>
                                ))}
                            </div>
                            <details className="mt-2"><summary className="cursor-pointer text-[13px]">Data table</summary>
                                <table className="mt-2 w-full"><thead><tr><th className={TH}>Day</th><th className={TH}>Urgent</th><th className={TH}>High</th><th className={TH}>Normal</th></tr></thead>
                                    <tbody>{h.perDay.map((d) => <tr key={d.day}><td className={`${TD} nb-meta`}>{d.day}</td><td className={TD}>{d.urgent}</td><td className={TD}>{d.high}</td><td className={TD}>{d.normal}</td></tr>)}</tbody></table>
                            </details>
                        </>
                    ) : <p className="text-[13px] text-muted-foreground">—</p>}
                </Panel>
                <Panel title="Actions by type">
                    {h.actions.length ? <table className="w-full"><tbody>{h.actions.map((a) => <tr key={a.action}><td className={TD}>{ACTION_LABEL[a.action as ModerationActionKind] ?? a.action}</td><td className={`${TD} text-right font-mono`}>{a.n}</td></tr>)}</tbody></table> : <p className="text-[13px] text-muted-foreground">—</p>}
                </Panel>
                <Panel title="Top reasons">
                    {h.reasons.length ? <table className="w-full"><tbody>{h.reasons.map((r) => <tr key={r.reason}><td className={TD}>{REPORT_REASON_LABEL[r.reason]}</td><td className={`${TD} text-right font-mono`}>{r.n}</td></tr>)}</tbody></table> : <p className="text-[13px] text-muted-foreground">—</p>}
                </Panel>
                <Panel title="Most reported workspaces and orgs">
                    {h.places.length ? <table className="w-full"><tbody>{h.places.map((p) => <tr key={p.id}><td className={TD}><Link className="underline underline-offset-4" href={`/${p.kind === 'organization' ? 'org' : 'workspaces'}/${encodeURIComponent(p.slug ?? p.id)}`}>{p.title}</Link></td><td className={`${TD} text-right font-mono`}>{p.n}</td></tr>)}</tbody></table> : <p className="text-[13px] text-muted-foreground">—</p>}
                </Panel>
                <Panel title="Reporters with low accuracy (90 days)">
                    {h.reporters.length ? <table className="w-full"><tbody>{h.reporters.map((r) => <tr key={r.id}><td className={TD}><Link className="underline underline-offset-4" href={`/admin/trust/people/${r.username ? `@${r.username}` : r.id}`}>{r.name ?? `@${r.username}`}</Link></td><td className={`${TD} text-right font-mono`}>{r.actioned} of {r.decided}</td></tr>)}</tbody></table> : <p className="text-[13px] text-muted-foreground">—</p>}
                </Panel>
                <Panel title={`Staff (${staff.length})`}>
                    <StaffList staff={staff} canEdit={role === 'admin'} />
                </Panel>
            </div>
            <p className="nb-meta">
                {h.newCases} new cases and {h.decided} decided in {days} days · {h.pileOns} pile-on flags ·{' '}
                <Link href="/admin/notifications" className="underline underline-offset-4">Notification delivery</Link>
            </p>
        </div>
    )
}
