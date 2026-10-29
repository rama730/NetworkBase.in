import Link from 'next/link'

import { CaseMenu, DecisionForm, NoteForm, SensitiveReveal } from '@/components/trust/CaseClient'
import { ago, caseHref, Deadline, istDate, istDateTime, SeverityBadge, StateBadge } from '@/components/trust/format'
import { UserAvatar } from '@/components/ui/UserAvatar'
import type { readCase } from '@/lib/trust/console'
import { ACTION_LABEL, caseLabel, KIND_NOUN, REPORT_REASON_LABEL, ruleLabel, type ModerationActionKind, type ReportReason } from '@/lib/trust/rules'
import type { StaffRole } from '@/lib/trust/staff'

type Case = NonNullable<Awaited<ReturnType<typeof readCase>>>

// Evidence staff only see after choosing to (17.4, staff wellbeing).
const SENSITIVE: ReportReason[] = ['inappropriate', 'intimate_images', 'child_safety', 'self_harm', 'threat']
const HIDDEN_KEYS = new Set(['label', 'href', 'privateConversation', 'context'])
const EVENT_TEXT: Record<string, string> = {
    opened: 'opened', report_added: 'report added', claimed: 'claimed', released: 'released', taken_over: 'took over', decided: 'decided', undone: 'undid the decision',
    note: 'added a note', merged: 'merged into another case', merged_in: 'merged a case in', severity_changed: 'changed severity', legal_hold: 'added legal hold',
    legal_hold_removed: 'removed legal hold', lifted: 'lifted an action', reversed: 'reversed an action', reporters_told: 'reporters told', evidence_shown: 'viewed hidden evidence',
    appealed: 'appeal received', appeal_decided: 'appeal decided', handed_to_staff: 'handed to NetworkBase',
}

function Snapshot({ value }: { value: Record<string, unknown> }) {
    const context = Array.isArray(value.context) ? (value.context as Array<{ author?: string; body?: string; seq?: number }>) : null
    return (
        <div className="space-y-2 text-[13px]">
            {context?.map((m, i) => <p key={i} className="text-muted-foreground"><span className="font-medium text-foreground">{m.author ?? 'Someone'}:</span> {m.body}</p>)}
            {Object.entries(value).filter(([k, v]) => !HIDDEN_KEYS.has(k) && v != null && v !== '').map(([k, v]) => (
                <div key={k} className={k === 'message' ? 'border-l-2 border-primary pl-2' : undefined}>
                    <span className="nb-micro">{k === 'message' ? 'Reported' : k}</span>
                    <p className="whitespace-pre-wrap break-words text-foreground">{typeof v === 'string' ? v : JSON.stringify(v)}</p>
                </div>
            ))}
        </div>
    )
}

function RailSection({ title, children }: { title: string; children: React.ReactNode }) {
    return <section className="border-b border-border py-4 first:pt-0 last:border-0"><h2 className="nb-micro mb-2">{title}</h2>{children}</section>
}

/** One case (17.4): header, evidence, reports, the decision form, notes; the rail with the person and history. */
export function CaseView({ c, staffId, role }: { c: Case; staffId: string; role: StaffRole }) {
    const label = caseLabel(c.number)
    const open = c.state === 'open' || c.state === 'in_review'
    const claimedByOther = Boolean(c.assignee_id && c.assignee_id !== staffId)
    const sensitive = SENSITIVE.includes(c.reason)
    const notes = c.events.filter((e) => e.kind === 'note')
    const live = c.live && c.liveState === 'edited' ? c.live : null
    return (
        <article aria-labelledby="case-title" className="min-w-0">
            <header className="border-b border-border pb-4">
                <div className="flex flex-wrap items-center gap-2">
                    <span className="nb-meta text-foreground">{label}</span>
                    <SeverityBadge severity={c.severity} />
                    <StateBadge state={c.state} outcome={c.outcome} />
                    {c.legal_hold ? <span className="nb-status" data-status="blocked">legal hold</span> : null}
                    <div className="ml-auto flex items-center gap-2">
                        {claimedByOther ? <span className="text-[13px] text-muted-foreground">{c.assignee_name} is reviewing</span> : null}
                        <CaseMenu caseId={c.id} label={label} open={open} claimed={c.assignee_id === staffId} claimedByOther={claimedByOther} legalHold={c.legal_hold} severity={c.severity} />
                    </div>
                </div>
                <h1 id="case-title" tabIndex={-1} className="nb-section-title mt-2 text-foreground">{c.label ?? KIND_NOUN[c.target_kind]}</h1>
                <p className="nb-meta mt-1">
                    Opened {istDateTime(c.created_at)} · {open ? <Deadline at={c.deadline_at} openedAt={c.created_at} /> : `decided ${ago(c.decided_at)}${c.decided_by_name ? ` by ${c.decided_by_name}` : ''}`} · {c.reports.length} {c.reports.length === 1 ? 'report' : 'reports'} · Source: {c.source}
                    {c.routed_to === 'org' ? ' · With the org’s moderators' : ''}
                </p>
            </header>
            <div className="grid gap-6 pt-4 xl:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0 space-y-6">
                    <section aria-labelledby="evidence">
                        <div className="mb-2 flex items-center gap-2">
                            <h2 id="evidence" className="nb-micro">Evidence</h2>
                            <span className="nb-status" data-status={c.liveState === 'deleted' ? 'blocked' : c.liveState === 'edited' ? 'draft' : 'archived'}>
                                live now: {c.liveState}
                            </span>
                            {c.snapshot?.href && typeof c.snapshot.href === 'string' && c.liveState !== 'deleted' ? <Link href={c.snapshot.href} className="ml-auto text-[13px] underline underline-offset-4">Open in app</Link> : null}
                        </div>
                        <div className="rounded-[8px] bg-muted/60 p-4">
                            <p className="nb-micro mb-2">As reported</p>
                            {sensitive ? <SensitiveReveal caseId={c.id}><Snapshot value={c.snapshot ?? {}} /></SensitiveReveal> : <Snapshot value={c.snapshot ?? {}} />}
                        </div>
                        {live ? (
                            <div className="mt-2 rounded-[8px] border border-border p-4">
                                <p className="nb-micro mb-2">Live now (edited)</p>
                                {sensitive ? <SensitiveReveal caseId={c.id}><Snapshot value={live} /></SensitiveReveal> : <Snapshot value={live} />}
                            </div>
                        ) : null}
                        {c.details ? <p className="mt-2 whitespace-pre-wrap text-[13px] text-muted-foreground">{c.details}</p> : null}
                    </section>

                    <section aria-labelledby="reports">
                        <h2 id="reports" className="nb-micro mb-2">Reports ({c.reports.length})</h2>
                        {c.pile_on ? (
                            <p role="note" className="mb-2 rounded-[5px] border border-[var(--status-warning)]/30 bg-[var(--status-warning-soft)] px-3 py-2 text-[13px]">
                                Possible pile-on: several new accounts or people from one place reported this within an hour. Judge the content, not the count.
                            </p>
                        ) : null}
                        <ul className="divide-y divide-border">
                            {c.reports.map((r) => (
                                <li key={r.id} className="py-2.5 text-[13px]">
                                    <p><span className="font-medium">{REPORT_REASON_LABEL[r.reason]}</span> · {r.reporter_name ?? 'Deleted user'} · <span className="nb-meta">{istDateTime(r.created_at)}</span></p>
                                    {r.details ? <blockquote className="mt-1 border-l-2 border-border pl-2 text-muted-foreground">{r.details}</blockquote> : null}
                                    <p className="nb-meta mt-1">Reporter accuracy {r.actioned} of {r.decided} actioned</p>
                                </li>
                            ))}
                            {!c.reports.length ? <li className="py-2.5 text-[13px] text-muted-foreground">Opened by staff, no user reports.</li> : null}
                        </ul>
                    </section>

                    <section aria-labelledby="decision-title">
                        <h2 id="decision-title" className="nb-micro mb-2">Decision</h2>
                        {open ? (
                            <DecisionForm caseId={c.id} label={label} targetKind={c.target_kind} reason={c.reason} hasSubject={Boolean(c.subject_id)}
                                personName={c.person?.name ?? (c.person?.username ? `@${c.person.username}` : 'them')} strikes={c.strikes} suggested={c.suggested}
                                isAdmin={role === 'admin'} readOnly={claimedByOther} />
                        ) : (
                            <div className="space-y-1.5 text-[13px]">
                                {c.actions.length ? c.actions.map((a) => (
                                    <p key={a.id}>
                                        <span className="font-medium">{ACTION_LABEL[a.action as ModerationActionKind] ?? a.action}</span>
                                        {a.rule ? ` · ${ruleLabel(a.rule)}` : ''}{a.ends_at ? ` · until ${istDate(a.ends_at)}` : ''}{a.strike ? ' · strike' : ''}
                                        {a.undone_at ? ' · undone' : a.reversed_at ? ' · reversed' : a.lifted_at ? ' · lifted' : ''}
                                    </p>
                                )) : <p>{c.outcome === 'no_violation' ? 'No rule broken.' : c.outcome === 'duplicate' ? 'Closed as a duplicate.' : 'Closed.'}</p>}
                                {c.actions[0]?.message ? <blockquote className="border-l-2 border-border pl-2 text-muted-foreground">{c.actions[0].message}</blockquote> : null}
                            </div>
                        )}
                    </section>

                    <section aria-labelledby="notes">
                        <h2 id="notes" className="nb-micro mb-2">Internal notes</h2>
                        <ul className="mb-2 space-y-2">
                            {notes.map((n, i) => <li key={i} className="text-[13px]"><span className="font-medium">{n.actor_name ?? 'Staff'}</span> <span className="nb-meta">{istDateTime(n.created_at)}</span><p className="whitespace-pre-wrap">{String(n.data.body ?? '')}</p></li>)}
                        </ul>
                        <NoteForm caseId={c.id} />
                    </section>
                </div>

                <aside aria-label="Case details" className="min-w-0 xl:border-l xl:border-border xl:pl-6">
                    <RailSection title="Person">
                        {c.person ? (
                            <div className="flex gap-3">
                                <UserAvatar identity={{ id: c.person.id, fullName: c.person.name, username: c.person.username, avatarUrl: c.person.avatar }} size={48} roundedClassName="rounded-[6px]" />
                                <div className="min-w-0 text-[13px]">
                                    <p className="font-medium">{c.person.name ?? 'No name'} {c.person.username ? <span className="text-muted-foreground">@{c.person.username}</span> : null}</p>
                                    <p className="nb-meta">Joined {istDate(c.person.created_at)} · {c.person.strikes} active {c.person.strikes === 1 ? 'strike' : 'strikes'}</p>
                                    {c.person.restriction ? <p className="mt-1"><span className="nb-status" data-status="blocked">{c.person.restriction}</span>{c.person.until ? <span className="nb-meta"> until {istDate(c.person.until)}</span> : null}</p> : null}
                                    <Link href={`/admin/trust/people/${c.person.username ? `@${c.person.username}` : c.person.id}`} className="mt-1 inline-block underline underline-offset-4">Open in People</Link>
                                </div>
                            </div>
                        ) : <p className="text-[13px] text-muted-foreground">No account attached.</p>}
                    </RailSection>
                    {c.otherCases.length ? (
                        <RailSection title={`Other open cases (${c.otherCases.length})`}>
                            <ul className="space-y-1 text-[13px]">
                                {c.otherCases.map((o) => <li key={o.id}><Link href={caseHref(o.number)} className="underline underline-offset-4">{caseLabel(o.number)}</Link> · {REPORT_REASON_LABEL[o.reason]} · {KIND_NOUN[o.target_kind]}</li>)}
                            </ul>
                        </RailSection>
                    ) : null}
                    <RailSection title="Where">
                        <p className="text-[13px]">{c.workspace_title
                            ? <Link href={`/${c.workspace_kind === 'organization' ? 'org' : 'workspaces'}/${encodeURIComponent(c.workspace_slug ?? c.workspace_id ?? '')}`} className="underline underline-offset-4">{c.workspace_title}</Link>
                            : c.snapshot?.privateConversation ? 'Direct message · no workspace' : 'No workspace'}</p>
                    </RailSection>
                    <RailSection title="Case history">
                        <ol className="space-y-1 text-[13px]">
                            {c.events.filter((e) => e.kind !== 'note').map((e, i) => (
                                <li key={i}><span className="nb-meta">{istDateTime(e.created_at)}</span> · {e.actor_name ? `${e.actor_name} ` : ''}{EVENT_TEXT[e.kind] ?? e.kind.replace(/_/g, ' ')}</li>
                            ))}
                        </ol>
                    </RailSection>
                </aside>
            </div>
        </article>
    )
}
