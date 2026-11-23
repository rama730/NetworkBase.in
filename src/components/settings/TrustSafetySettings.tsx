"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import { useEffect, useState } from "react";

import { listMyReportsAction, myStandingAction } from "@/app/actions/moderation";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
import { SettingsRow, SettingsRows } from "@/components/settings/ui/SettingsRow";
import { LogList, Tag } from "@/components/settings/mix/parts";
import { logDate } from "@/lib/settings/format";
import { padCount } from "@/lib/ui/tab-marker";
import { ACTION_LABEL, KIND_NOUN, REPORT_REASON_LABEL, ruleLabel, type ReportReason, type ReportTargetKind } from "@/lib/trust/rules";

// Trust and safety in Settings (docs/trust-and-safety-concept.md §8.5, C18): Account → Standing and
// Privacy → Your reports. Both load when Settings opens; neither names anyone else.

const DATE = new Intl.DateTimeFormat("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
const day = (value: string | null | undefined) => (value ? DATE.format(new Date(value)) : "");

type Standing = Extract<Awaited<ReturnType<typeof myStandingAction>>, { success: true }>;
type Action = Standing["history"][number];

function AppealState({ a }: { a: Action }) {
  const label = a.case_number ? `NB-${a.case_number}` : null;
  if (!label) return null;
  if (a.appeal_state === "pending" || a.appeal_state === "in_review") return <span className="nb-meta">Appeal sent · decision by {day(a.appeal_deadline)}</span>;
  if (a.appeal_state) return <span className="nb-meta">Appeal decided ({a.appeal_state})</span>;
  if (!a.appeal_until) return <span className="nbs-meta">Can&apos;t be appealed</span>;
  if (new Date(a.appeal_until) < new Date()) return <span className="nb-meta">Appeal closed</span>;
  return <a href={`/appeal/${label}`} className="text-[13px] font-medium underline underline-offset-4">Appeal</a>;
}

const what = (a: Action) => [ACTION_LABEL[a.action], a.ends_at && ["limit", "suspension"].includes(a.action) ? `until ${day(a.ends_at)}` : null, a.rule ? ruleLabel(a.rule) : null].filter(Boolean).join(" · ");

export function StandingSettings() {
  const [data, setData] = useState<Standing | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { myStandingAction().then((r) => (r.success ? setData(r) : setFailed(true)), () => setFailed(true)); }, []);
  const restricted = Boolean(data?.restriction);
  const status = data?.restriction ? `${ACTION_LABEL[data.restriction.action]}${data.restriction.endsAt ? ` until ${day(data.restriction.endsAt)}` : ""}` : "In good standing";
  return (
    <SettingsSectionCard id="settings-account-standing" title="Standing" state={restricted ? "restricted" : undefined} flush findKeys="strikes appeal moderation">
      {failed ? <p className="nbs-ghelp">Couldn&apos;t load your standing. Refresh to try again.</p> : !data ? <p role="status" className="nb-waiting nbs-ghelp"><PixelBeat />Loading your standing…</p> : (
        <>
          <SettingsRows>
            <SettingsRow
              title={status}
              description={restricted ? "A decision limits what your account can do. Each one says how to appeal." : "No decisions about your account or content. Strikes expire after 6 months."}
              right={restricted ? <Tag tone="bad">Restricted</Tag> : <Tag tone="ok" tick>Good</Tag>}
              meta={<>{padCount(data.strikes.length)} strike{data.strikes.length === 1 ? "" : "s"} · questions: support@networkbase.in with the case number · <a href="/acceptable-use" className="underline underline-offset-2">community rules</a></>}
            />
            {data.active.map((a) => <SettingsRow key={a.id} title={what(a)} meta={a.case_number ? `NB-${a.case_number}` : undefined} right={<AppealState a={a} />} />)}
          </SettingsRows>
          <LogList
            label="Strikes and history"
            entries={[...data.strikes.map((a) => ({ key: `s-${a.id}`, date: logDate(a.created_at), dateTime: a.created_at ?? undefined, event: <>{a.rule ? ruleLabel(a.rule) : ACTION_LABEL[a.action]} <Tag tone="hot">Strike</Tag></>, detail: `${a.label ?? ACTION_LABEL[a.action]} · expires ${day(a.strike_expires_at)}${a.case_number ? ` · NB-${a.case_number}` : ""}` })),
              ...data.history.map((a) => ({ key: `h-${a.id}`, date: logDate(a.created_at), dateTime: a.created_at ?? undefined, event: what(a), detail: [a.reversed_at ? "reversed" : a.lifted_at ? "lifted" : null, a.case_number ? `NB-${a.case_number}` : null].filter(Boolean).join(" · ") || undefined, actions: <AppealState a={a} /> }))]}
          />
          <p className="nbs-foot">Safety notices are always sent, whatever your notification settings.</p>
        </>
      )}
    </SettingsSectionCard>
  );
}

type Report = Extract<Awaited<ReturnType<typeof listMyReportsAction>>, { success: true }>["reports"][number];
const STATUS: Record<Report["status"], string> = { in_review: "In review", actioned: "Action taken", no_violation: "No rule broken" };

export function YourReportsSettings() {
  const [reports, setReports] = useState<Report[] | null>(null);
  useEffect(() => { listMyReportsAction().then((r) => setReports(r.success ? r.reports : []), () => setReports([])); }, []);
  return (
    <SettingsSectionCard id="settings-privacy-reports" title="Your reports" state={reports?.length ? padCount(reports.length) : undefined} stateOk flush findKeys="report reported">
      {!reports ? <p role="status" className="nb-waiting nbs-ghelp"><PixelBeat />Loading your reports…</p> : (
        <LogList
          label="Your reports"
          empty={<p className="nbs-ghelp">You haven&apos;t reported anything in the last 90 days.</p>}
          entries={reports.map((r) => ({
            key: `${r.caseNumber}-${r.createdAt}`, date: logDate(r.createdAt), dateTime: r.createdAt,
            event: `${REPORT_REASON_LABEL[r.reason as ReportReason]} · ${KIND_NOUN[r.kind as ReportTargetKind]}`,
            detail: r.caseNumber,
            actions: <Tag tone={r.status === "actioned" ? "ok" : r.status === "in_review" ? "warn" : undefined}>{STATUS[r.status]}</Tag>,
          }))}
        />
      )}
      <p className="nbs-foot">The last 90 days. We never tell anyone who reported.</p>
    </SettingsSectionCard>
  );
}
