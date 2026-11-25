"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { answerMyAskAction, askTeamAction, matchingPagesAction, readAskableTeamsAction, readCompanyRequestsSettingAction, readMyAsksAction, setCompanyRequestsAction } from "@/app/actions/company-requests";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";

// Report 33.6 (plan B4.5, K5): Ask a team and My asks on the company Overview; the team's switch in its Requests tab.

/** Ask a team: pick the team and type, say what you need; matching handbook pages show first; nothing is blocked. */
export function AskTeamCard({ orgId, base }: { orgId: string; base: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["askable-teams", orgId], queryFn: () => readAskableTeamsAction(orgId), staleTime: 60_000 });
  const [f, setF] = useState({ teamId: "", typeId: "", title: "", answers: {} as Record<string, string> });
  const pages = useQuery({ queryKey: ["matching-pages", orgId, f.title], queryFn: () => matchingPagesAction(orgId, f.title), enabled: f.title.trim().length > 4, staleTime: 60_000 });
  const teams = q.data?.success ? q.data.teams : [];
  if (!teams.length) return null;
  const team = teams.find((t) => t.id === f.teamId);
  const type = team?.types.find((t) => t.id === f.typeId);
  const send = async () => {
    const r = await askTeamAction(orgId, f);
    if (!r.success) return void toast.error(r.error);
    toast.success(`Sent to ${team?.title ?? "the team"}`);
    setF({ teamId: "", typeId: "", title: "", answers: {} });
    void client.invalidateQueries({ queryKey: ["my-asks", orgId] });
  };
  const found = pages.data?.success ? pages.data.pages : [];
  return (
    <OrgCard title="Ask a team" testId="ask-team">
      <div className="space-y-2 text-[13px]">
        <span className="flex flex-wrap gap-2">
          <select className="nb-select" data-size="sm" aria-label="Team" value={f.teamId} onChange={(e) => setF({ ...f, teamId: e.target.value, typeId: "", answers: {} })}>
            <option value="">Which team?</option>{teams.map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}</select>
          {team ? <select className="nb-select" data-size="sm" aria-label="Request type" value={f.typeId} onChange={(e) => setF({ ...f, typeId: e.target.value, answers: {} })}>
            <option value="">What kind of request?</option>{team.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select> : null}
        </span>
        {type ? (
          <>
            <Input value={f.title} maxLength={200} placeholder="What do you need, in a line?" aria-label="What you need" onChange={(e) => setF({ ...f, title: e.target.value })} />
            {found.length ? <p className="text-muted-foreground" data-testid="matching-pages">Might help first: {found.map((p, i) => <span key={p.slug}>{i ? ", " : ""}<Link href={`${base}?tab=docs&doc=${encodeURIComponent(p.slug)}`} className="nb-link">{p.title}</Link></span>)}</p> : null}
            {type.questions.filter((qq) => qq.kind !== "file").map((qq) => (
              <label key={qq.id} className="flex flex-col gap-1"><span>{qq.label}{qq.required ? " *" : ""}</span>
                {qq.kind === "choice" ? <select className="nb-select" data-size="sm" value={f.answers[qq.id] ?? ""} onChange={(e) => setF({ ...f, answers: { ...f.answers, [qq.id]: e.target.value } })}><option value="">Pick one</option>{(qq.options ?? []).map((o) => <option key={o}>{o}</option>)}</select>
                  : <Input type={qq.kind === "date" ? "date" : "text"} value={f.answers[qq.id] ?? ""} onChange={(e) => setF({ ...f, answers: { ...f.answers, [qq.id]: e.target.value } })} />}
              </label>
            ))}
            <button type="button" className={FORM_PRIMARY_CLASS} disabled={!f.title.trim()} onClick={() => void send()}>Send</button>
          </>
        ) : null}
        <MyAsks orgId={orgId} />
      </div>
    </OrgCard>
  );
}

/** My asks (call 6): my requests and where they stand; Did this solve it? once delivered (call 7). */
function MyAsks({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["my-asks", orgId], queryFn: () => readMyAsksAction(orgId), staleTime: 30_000 });
  const [missing, setMissing] = useState<Record<string, string>>({});
  const asks = q.data?.success ? q.data.asks : [];
  if (!asks.length) return null;
  const answer = async (id: string, solved: "yes" | "no") => {
    const r = await answerMyAskAction(orgId, id, { solved, note: missing[id] });
    if (!r.success) return void toast.error(r.error);
    toast.success(solved === "yes" ? "Thanks — marked solved" : "Sent back to the team");
    void client.invalidateQueries({ queryKey: ["my-asks", orgId] });
  };
  return (
    <div className="space-y-1.5 border-t border-border pt-2" data-testid="my-asks">
      <p className="font-medium">My asks</p>
      <ul className="space-y-1.5">
        {asks.map((a) => (
          <li key={a.id} className="space-y-1">
            <span className="flex flex-wrap items-center gap-2">{a.title}<span className="text-muted-foreground">· {a.team}</span>
              <StatusBadge state={a.stage === "delivered" ? "done" : a.stage === "declined" ? "missing" : "draft"}>{a.stageWord}</StatusBadge></span>
            {a.declineReason ? <p className="text-muted-foreground">“{a.declineReason}”</p> : null}
            {a.stage === "delivered" && !a.solved ? (
              <span className="flex flex-wrap items-center gap-2">Did this solve it?
                <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void answer(a.id, "yes")}>Yes</button>
                <Input value={missing[a.id] ?? ""} maxLength={2000} placeholder="If not, what’s still missing?" aria-label={`What’s still missing for ${a.title}`} onChange={(e) => setMissing({ ...missing, [a.id]: e.target.value })} className="w-[240px]" />
                <button type="button" className={FORM_SECONDARY_CLASS} disabled={!missing[a.id]?.trim()} onClick={() => void answer(a.id, "no")}>No</button>
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The team's switch (call 1): Take requests from the company. Owners and admins of a team in a company. */
export function CompanyRequestsSwitch({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["company-requests-setting", projectId], queryFn: () => readCompanyRequestsSettingAction(projectId), staleTime: 60_000 });
  const [picked, setPicked] = useState<boolean | null>(null);
  const d = q.data?.success ? q.data : null;
  if (!d?.available) return null;
  const flip = async (on: boolean) => {
    setPicked(on);
    const r = await setCompanyRequestsAction(projectId, on);
    if (!r.success) { setPicked(null); return void toast.error(r.error); }
    toast.success(on ? "Anyone in the company can ask this team" : "Only people in this workspace can ask now");
    void client.invalidateQueries({ queryKey: ["company-requests-setting", projectId] });
  };
  return <label className="flex items-center gap-2 text-xs text-muted-foreground" data-testid="company-requests-switch"><input type="checkbox" className="nb-check" checked={picked ?? d.on} onChange={(e) => void flip(e.target.checked)} />Take requests from the company</label>;
}
