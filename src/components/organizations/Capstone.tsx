"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { consentShowcaseAction, readCapstoneAction, readCapstoneTeamsAction, readShowcaseAction, saveCapstoneAction, setShowcaseReadyAction } from "@/app/actions/capstone";
import { TeamFeedback } from "@/components/organizations/DemoDay";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";

// Report 31.6 C4 (plan B2.5a): the team's Capstone card, the class's Showcase, and the staff table.
const LINK = "nb-touch-target text-[13px] font-medium text-primary underline-offset-2 hover:underline";
const DAY = new Intl.DateTimeFormat("en", { month: "short", day: "numeric", timeZone: "UTC" });
const day = (d: string | null) => (d ? DAY.format(new Date(d.length === 10 ? `${d}T00:00:00Z` : d)) : "");
const SHOWCASE_WORDS = { none: "—", draft: "Draft", ready: "Ready (members)", public: "Ready (public)" } as const;

/** Team workspace Overview: brief, team roles, milestones and the Showcase card (Draft → Ready; Show publicly). */
export function CapstoneOverviewCard({ projectId }: { projectId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: ["capstone", projectId], queryFn: () => readCapstoneAction(projectId), staleTime: 30_000 });
  const [draft, setDraft] = useState<{ problem: string; audience: string; metrics: string; title: string; line: string; demo: string; code: string; video: string; track: string } | null>(null);
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const c = d.capstone;
  const refresh = () => client.invalidateQueries({ queryKey: ["capstone", projectId] });
  const run = (p: Promise<{ success: true } | { success: false; error: string }>, ok: string, after?: () => void) =>
    void p.then((r) => { if (!r.success) return void toast.error(r.error); toast.success(ok); after?.(); void refresh(); });
  const startEdit = () => setDraft({ problem: c.problem, audience: c.audience, metrics: c.metrics.join("\n"), title: c.showcase.title, line: c.showcase.line, ...c.showcase.links, track: c.showcase.track });
  const save = () => run(saveCapstoneAction(projectId, { problem: draft!.problem, audience: draft!.audience, metrics: draft!.metrics.split("\n").map((m) => m.trim()).filter(Boolean).slice(0, 3),
    showcase: { title: draft!.title, line: draft!.line, track: draft!.track, links: { demo: draft!.demo, code: draft!.code, video: draft!.video } } }), "Capstone saved", () => setDraft(null));
  const mine = Boolean(c.showcase.consents[d.me]);
  return (
    <OrgCard title="Capstone" testId="capstone-card" action={d.canEdit && !draft ? <button type="button" className={LINK} onClick={startEdit}>Edit</button> : undefined}>
      <div className="space-y-2 text-[13px]">
        {draft ? (
          <div className="space-y-2" data-testid="capstone-edit">
            {([["problem", "Problem"], ["audience", "Who it’s for"]] as const).map(([k, label]) => (
              <label key={k} className="flex flex-col gap-1"><span className="text-[12px] font-medium">{label}</span><Input value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></label>
            ))}
            <label className="flex flex-col gap-1"><span className="text-[12px] font-medium">Success metrics (up to 3, one per line)</span>
              <textarea className="nb-textarea" rows={3} value={draft.metrics} onChange={(e) => setDraft({ ...draft, metrics: e.target.value })} /></label>
            <p className="text-[12px] font-medium text-muted-foreground">Showcase card</p>
            {([["title", "Title"], ["line", "One line"], ["track", "Track"], ["demo", "Demo link"], ["code", "Code link"], ["video", "Video link"]] as const).map(([k, label]) => (
              <label key={k} className="flex flex-col gap-1"><span className="text-[12px]">{label}</span><Input value={draft[k]} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} /></label>
            ))}
            <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} onClick={save}>Save</button><button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDraft(null)}>Cancel</button></span>
          </div>
        ) : (
          <>
            <p className="font-medium">{c.problem || "Add the problem you’re solving."}</p>
            {c.audience ? <p className="text-muted-foreground">For {c.audience}</p> : null}
            {c.metrics.length ? <ul className="list-disc pl-5">{c.metrics.map((m) => <li key={m}>{m}</li>)}</ul> : null}
            <p>{d.members.map((m) => `${m.name}${c.roles[m.id] ? ` — ${c.roles[m.id]}` : ""}`).join(" · ")}{d.mentors.length ? <span className="text-muted-foreground"> · Mentor {d.mentors.map((m) => m.name).join(", ")}</span> : null}</p>
            {d.milestones.length ? (
              <p className="flex flex-wrap gap-x-3">{d.milestones.map((m) => <span key={m.id} className="inline-flex items-center gap-1">{m.title}{m.done ? <StatusBadge state="done">Done</StatusBadge> : m.due ? ` · ${day(m.due)}` : ""}</span>)}</p>
            ) : <p className="text-muted-foreground">Milestones show here when the class sets them.</p>}
          </>
        )}
        <TeamFeedback projectId={projectId} />
        <div className="space-y-1.5 rounded-md border border-border p-2.5" data-testid="showcase-card">
          <p className="flex flex-wrap items-center gap-2"><span className="font-medium">{c.showcase.title || "Showcase card"}</span>
            {c.showcase.readyAt ? <StatusBadge state="done">Ready</StatusBadge> : <StatusBadge state="new">Draft</StatusBadge>}
            {d.public ? <StatusBadge state="active">Public</StatusBadge> : null}</p>
          {c.showcase.line ? <p className="text-muted-foreground">{c.showcase.line}</p> : null}
          <span className="flex flex-wrap gap-3">
            {d.canEdit ? (c.showcase.readyAt
              ? <button type="button" className={LINK} onClick={() => run(setShowcaseReadyAction(projectId, false), "Back to Draft")}>Back to Draft</button>
              : <button type="button" className={LINK} onClick={() => run(setShowcaseReadyAction(projectId, true), "Ready for the Showcase")}>Mark Ready</button>) : null}
            {d.members.some((m) => m.id === d.me) ? <label className="flex items-center gap-2"><input className="nb-check" type="checkbox" checked={mine}
              onChange={(e) => run(consentShowcaseAction(projectId, e.target.checked), e.target.checked ? "You agreed to show it publicly" : "You took back your agreement")} />I agree to show it publicly</label> : null}
          </span>
          <p className="text-[12px] text-muted-foreground">Public only when every member agrees ({Object.keys(c.showcase.consents).filter((id) => d.members.some((m) => m.id === id)).length} of {d.members.length}).</p>
        </div>
      </div>
    </OrgCard>
  );
}

/** Class About → Showcase: one card per project; tracks to filter by. */
export function ShowcaseSection({ classId }: { classId: string }) {
  const q = useQuery({ queryKey: ["showcase", classId], queryFn: () => readShowcaseAction(classId), staleTime: 60_000 });
  const [track, setTrack] = useState<string | null>(null);
  const d = q.data?.success ? q.data : null;
  if (!d || !d.cards.length) return null;
  const cards = d.cards.filter((c) => !track || c.track === track);
  return (
    <section aria-label="Showcase" className="space-y-2" data-testid="showcase">
      <h2 className="nb-section-title">Showcase <span className="nb-meta font-mono">{d.cards.length}</span></h2>
      {d.tracks.length ? (
        <div role="group" aria-label="Tracks" className="inline-flex rounded-md border border-border p-0.5 text-[12px]">
          {[null, ...d.tracks].map((t) => <button key={t ?? "all"} type="button" aria-pressed={track === t} onClick={() => setTrack(t)} className={cn("rounded-sm px-2.5 py-1", track === t ? "bg-muted font-semibold text-foreground" : "text-muted-foreground")}>{t ?? "All"}</button>)}
        </div>
      ) : null}
      <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((c) => (
          <li key={c.id} className="space-y-1 rounded-md border border-border bg-card p-3 text-[13px]" data-testid="showcase-item">
            <p className="font-medium">{c.title}</p>
            {c.line ? <p className="text-muted-foreground">{c.line}</p> : null}
            {c.team ? <p className="text-[12px] text-muted-foreground">{c.team.join(", ")}</p> : null}
            <span className="flex flex-wrap gap-3">{(["demo", "code", "video"] as const).filter((k) => c.links[k]).map((k) => <a key={k} className={LINK} href={c.links[k]} target="_blank" rel="noreferrer noopener">{k === "demo" ? "Demo" : k === "code" ? "Code" : "Video"}<span className="sr-only"> of {c.title}</span></a>)}</span>
            {c.track ? <StatusBadge state="new">{c.track}</StatusBadge> : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Class Workspaces (staff): Team · Brief · Mentor · Milestones · Showcase. */
export function CapstoneTeams({ classId }: { classId: string }) {
  const q = useQuery({ queryKey: ["capstone-teams", classId], queryFn: () => readCapstoneTeamsAction(classId), staleTime: 60_000 });
  const rows = q.data?.success ? q.data.rows : [];
  if (!rows.length) return null;
  return (
    <section aria-label="Capstone teams" className="mb-5 space-y-2" data-testid="capstone-teams">
      <h2 className="nb-section-title">Capstone <span className="nb-meta font-mono">{rows.length}</span></h2>
      <div className="overflow-x-auto rounded-md border border-border">
        <table className="w-full text-left text-[13px]">
          <thead className="border-b border-border text-[12px] text-muted-foreground"><tr>
            <th scope="col" className="px-3 py-2 font-medium">Team</th><th scope="col" className="px-3 py-2 font-medium">Brief</th><th scope="col" className="px-3 py-2 font-medium">Mentor</th>
            <th scope="col" className="px-3 py-2 font-medium">Milestones</th><th scope="col" className="px-3 py-2 font-medium">Showcase</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-b-0" data-testid="capstone-row">
                <td className="px-3 py-2"><Link href={`/workspaces/${encodeURIComponent(r.slug ?? r.id)}`} className="hover:underline">{r.title}</Link> <span className="nb-meta font-mono">({r.size})</span></td>
                <td className="max-w-[240px] truncate px-3 py-2">{r.problem ?? "—"}</td>
                <td className="px-3 py-2">{r.mentors.join(", ") || "—"}</td>
                <td className="px-3 py-2"><span className="inline-flex flex-wrap items-center gap-1.5 font-mono text-[12px]">{r.done}/{r.total}
                  {r.next ? <span className="font-sans">· {r.next.title}{r.next.due ? ` ${day(r.next.due)}` : ""}</span> : null}{r.next?.overdue ? <StatusBadge state="late">Overdue</StatusBadge> : null}</span></td>
                <td className="px-3 py-2">{SHOWCASE_WORDS[r.showcase as keyof typeof SHOWCASE_WORDS]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
