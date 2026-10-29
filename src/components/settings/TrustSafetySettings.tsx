"use client";

import { useEffect, useState } from "react";

import { listMyReportsAction, myStandingAction } from "@/app/actions/moderation";
import { SettingsSectionCard } from "@/components/settings/ui/SettingsSectionCard";
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
  if (!a.appeal_until) return <span className="nb-meta">Can&apos;t be appealed</span>;
  if (new Date(a.appeal_until) < new Date()) return <span className="nb-meta">Appeal closed</span>;
  return <a href={`/appeal/${label}`} className="text-[13px] font-medium underline underline-offset-4">Appeal</a>;
}

const what = (a: Action) => [ACTION_LABEL[a.action], a.ends_at && ["limit", "suspension"].includes(a.action) ? `until ${day(a.ends_at)}` : null, a.rule ? ruleLabel(a.rule) : null].filter(Boolean).join(" · ");

export function StandingSettings() {
  const [data, setData] = useState<Standing | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => { myStandingAction().then((r) => (r.success ? setData(r) : setFailed(true)), () => setFailed(true)); }, []);
  const status = data?.restriction ? `${ACTION_LABEL[data.restriction.action]}${data.restriction.endsAt ? ` until ${day(data.restriction.endsAt)}` : ""}` : "Your account is in good standing.";
  return (
    <SettingsSectionCard id="settings-account-standing" title="Account standing" description="Decisions about your account and content, and how to appeal them.">
      {failed ? <p className="nb-compact text-muted-foreground">Couldn&apos;t load your standing. Refresh to try again.</p> : !data ? <p className="nb-compact text-muted-foreground">Loading…</p> : (
        <div className="space-y-5">
          <p className="nb-ui-label text-foreground">{status}</p>
          {data.active.length ? (
            <div>
              <h4 className="nb-micro mb-1.5">Active</h4>
              <ul className="divide-y divide-border">
                {data.active.map((a) => <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]"><span className="min-w-0 flex-1">{what(a)}{a.case_number ? <span className="nb-meta"> · NB-{a.case_number}</span> : null}</span><AppealState a={a} /></li>)}
              </ul>
            </div>
          ) : null}
          <div>
            <h4 className="nb-micro mb-1.5">Strikes ({data.strikes.length} active)</h4>
            {data.strikes.length ? (
              <ul className="divide-y divide-border">
                {data.strikes.map((a) => <li key={a.id} className="flex flex-wrap gap-x-3 py-2 text-[13px]"><span className="min-w-0 flex-1">{a.rule ? ruleLabel(a.rule) : ACTION_LABEL[a.action]} · {a.label ?? ACTION_LABEL[a.action]} · {day(a.created_at)} · expires {day(a.strike_expires_at)}</span>{a.case_number ? <span className="nb-meta">NB-{a.case_number}</span> : null}</li>)}
              </ul>
            ) : <p className="nb-compact text-muted-foreground">None. Strikes expire after 6 months.</p>}
          </div>
          {data.history.length ? (
            <details>
              <summary className="cursor-pointer text-[13px] font-medium">History (24 months)</summary>
              <ul className="mt-2 divide-y divide-border">
                {data.history.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]">
                    <span className="min-w-0 flex-1">{what(a)} · {day(a.created_at)}{a.reversed_at ? " · reversed" : a.lifted_at ? " · lifted" : ""}</span><AppealState a={a} />
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
          <p className="nb-meta">Safety notices are always sent, whatever your notification settings. Questions? Read the <a href="/acceptable-use" className="underline underline-offset-4">community rules</a> or email support@networkbase.in with the case number.</p>
        </div>
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
    <SettingsSectionCard id="settings-privacy-reports" title="Your reports" description="What you reported in the last 90 days and what happened. We never tell anyone who reported.">
      {!reports ? <p className="nb-compact text-muted-foreground">Loading…</p> : !reports.length ? <p className="nb-compact text-muted-foreground">You haven&apos;t reported anything recently.</p> : (
        <ul className="divide-y divide-border">
          {reports.map((r) => (
            <li key={`${r.caseNumber}-${r.createdAt}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]">
              <span className="min-w-0 flex-1">{REPORT_REASON_LABEL[r.reason as ReportReason]} · {KIND_NOUN[r.kind as ReportTargetKind]} · {day(r.createdAt)}</span>
              <span className="nb-meta">{r.caseNumber}</span>
              <span className="nb-status" data-status={r.status === "in_review" ? "active" : r.status === "actioned" ? "completed" : "archived"}>{STATUS[r.status]}</span>
            </li>
          ))}
        </ul>
      )}
    </SettingsSectionCard>
  );
}
