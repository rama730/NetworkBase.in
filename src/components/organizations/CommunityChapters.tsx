"use client";

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Hash, MapPin, UsersRound } from "lucide-react";

import { decideChapterProposalAction, proposeChapterAction, readChaptersAction, saveChapterSettingsAction } from "@/app/actions/community-chapters";
import { StatusBadge } from "@/components/organizations/org-ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { CHAPTER_KINDS, GROUP_KIND_WORDS, GROUP_KINDS } from "@/lib/organizations/chapters";
import { answerGroupRequestAction, joinGroupAction, readGroupsAction, startGroupAction } from "@/app/actions/community-groups";

// Report 34.6 (plan B5.5a, M5): a community's Workspaces → Chapters — the chapters (members see them; organisers also
// see organisers, last activity and the Needs a co-organiser and Dormant flags), Propose a chapter, and Proposals.
const key = (orgId: string) => ["community-chapters", orgId] as const;
const when = (iso: string) => new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" }).format(new Date(iso));

/** A community's Workspaces: the list, and Chapters a click away. */
export function CommunityProjects({ orgId, list }: { orgId: string; list: ReactNode }) {
  const [view, setView] = useState<"workspaces" | "chapters" | "groups">(() => {
    const v = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("view") : null;
    return v === "chapters" || v === "groups" ? v : "workspaces";
  });
  return (
    <div className="space-y-4">
      <div className="flex gap-1 text-[13px]" role="group" aria-label="Workspaces views">
        {(["workspaces", "chapters", "groups"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("rounded-sm px-2.5 py-1", view === v ? "bg-muted font-semibold text-foreground" : "text-muted-foreground")}>{v === "workspaces" ? "Workspaces" : v === "chapters" ? "Chapters" : "Groups"}</button>
        ))}
      </div>
      {view === "chapters" ? <CommunityChapters orgId={orgId} /> : view === "groups" ? <CommunityGroups orgId={orgId} /> : list}
    </div>
  );
}

export function CommunityChapters({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const [proposing, setProposing] = useState(false);
  const q = useQuery({ queryKey: key(orgId), queryFn: () => readChaptersAction(orgId), staleTime: 30_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading chapters…</p>;
  if (!q.data?.success) return <ErrorNotice what="Chapters" onRetry={() => void q.refetch()} />;
  const d = q.data;
  const refresh = () => void client.invalidateQueries({ queryKey: key(orgId) });
  return (
    <section aria-label="Chapters" className="space-y-3 text-[13px]" data-testid="community-chapters">
      {d.canPropose ? <div className="flex justify-end"><button type="button" className={FORM_PRIMARY_CLASS} onClick={() => setProposing(true)}>{d.organiser ? "Start a chapter" : "Propose a chapter"}</button></div> : null}
      {d.chapters.length ? (
        <ul className="divide-y divide-border rounded-md border border-border bg-card" aria-label="Chapters list">
          {d.chapters.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2" data-testid="chapter-row">
              {c.kind === "topic" ? <Hash className="size-4" aria-hidden="true" /> : <MapPin className="size-4" aria-hidden="true" />}
              <span className="min-w-[160px] flex-1"><a href={`/org/${encodeURIComponent(c.slug ?? c.id)}`} className="nb-link font-medium">{c.title}</a>
                <span className="block text-muted-foreground">{CHAPTER_KINDS[c.kind]}{c.place ? ` · ${c.place}` : ""} · <span className="font-mono">{c.members}</span> {c.members === 1 ? "member" : "members"}
                  {"organisers" in c ? <> · <span className="font-mono">{c.organisers}</span> {c.organisers === 1 ? "organiser" : "organisers"}</> : null}
                  {c.nextEvent ? ` · next event ${when(c.nextEvent)}` : ""}</span></span>
              {c.closed ? <StatusBadge state="neutral">Closed</StatusBadge> : null}
              {"needsCoOrganiser" in c && c.needsCoOrganiser ? <StatusBadge state="at_risk">Needs a co-organiser</StatusBadge> : null}
              {"dormant" in c && c.dormant ? <StatusBadge state="neutral">Dormant</StatusBadge> : null}
            </li>
          ))}
        </ul>
      ) : <p className="py-2 text-muted-foreground">No chapters yet.{d.canPropose ? " A chapter is a local or topic group under this community, with its own organisers and the same rules." : ""}</p>}
      {d.proposals.length ? <Proposals orgId={orgId} organiser={d.organiser} proposals={d.proposals} onDone={refresh} /> : null}
      {d.mine.length ? <p className="text-muted-foreground">Your proposals: {d.mine.map((p) => `${p.name} (${p.state === "approved" ? "approved" : `not approved${p.reason ? `: ${p.reason}` : ""}`})`).join(" · ")}</p> : null}
      {proposing ? <ProposeChapter orgId={orgId} onClose={() => setProposing(false)} onDone={refresh} /> : null}
      {d.settings ? <ChapterSettings orgId={orgId} initial={d.settings} onSaved={refresh} /> : null}
    </section>
  );
}

type Proposal = { id: string; name: string; kind: "local" | "topic"; place: string; why: string; by: string };
function Proposals({ orgId, organiser, proposals, onDone }: { orgId: string; organiser: boolean; proposals: Proposal[]; onDone: () => void }) {
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const decide = async (id: string, approve: boolean) => {
    const r = await decideChapterProposalAction(orgId, id, { approve, reason: approve ? null : reasons[id]?.trim() || null });
    if (!r.success) return void toast.error(r.error);
    toast.success(approve ? "Chapter made. The proposer runs it now." : "Declined. The proposer has been told why.");
    onDone();
  };
  return (
    <div className="space-y-2" data-testid="chapter-proposals">
      <h3 className="font-medium">{organiser ? "Proposals" : "Your proposal"}</h3>
      <ul className="space-y-2">{proposals.map((p) => (
        <li key={p.id} className="space-y-1 rounded-md border border-border bg-card p-3">
          <p><span className="font-medium">{p.name}</span> <span className="text-muted-foreground">· {CHAPTER_KINDS[p.kind]} · {p.place}</span></p>
          {p.why ? <p className="text-muted-foreground">{p.why}</p> : null}
          {organiser ? <span className="flex flex-wrap items-center gap-2">
            <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void decide(p.id, true)}>Approve</button>
            <Input value={reasons[p.id] ?? ""} maxLength={300} placeholder="Why not (shown to them)" aria-label={`Why not ${p.name}`} onChange={(x) => setReasons({ ...reasons, [p.id]: x.target.value })} className="min-w-0 flex-1" />
            <button type="button" className={FORM_SECONDARY_CLASS} disabled={!reasons[p.id]?.trim()} onClick={() => void decide(p.id, false)}>Decline</button>
          </span> : <p className="text-muted-foreground">Waiting for the organisers.</p>}
        </li>))}</ul>
    </div>
  );
}

function ProposeChapter({ orgId, onClose, onDone }: { orgId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ name: "", kind: "local" as "local" | "topic", place: "", why: "" });
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    const r = await proposeChapterAction(orgId, { name: f.name, kind: f.kind, place: f.place, why: f.why, coOrganiserId: null });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast.success("Proposal sent to the organisers");
    onDone(); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="form">
        <DialogHeader><DialogTitle>Propose a chapter</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]" data-testid="propose-chapter">
          <label className="block">Name<Input value={f.name} maxLength={80} placeholder="Bangalore" onChange={(x) => setF({ ...f, name: x.target.value })} /></label>
          <fieldset className="flex flex-wrap gap-4"><legend className="mb-1">Kind</legend>
            {(["local", "topic"] as const).map((k) => <label key={k} className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name="kind" checked={f.kind === k} onChange={() => setF({ ...f, kind: k })} />{CHAPTER_KINDS[k]}</label>)}
          </fieldset>
          <label className="block">{f.kind === "local" ? "City" : "Topic"}<Input value={f.place} maxLength={80} onChange={(x) => setF({ ...f, place: x.target.value })} /></label>
          <label className="block">Why (optional)<textarea className="nb-textarea mt-1 w-full" rows={3} maxLength={600} value={f.why} onChange={(x) => setF({ ...f, why: x.target.value })} /></label>
          <p className="text-muted-foreground">If the organisers approve, you run the chapter under the community’s rules.</p>
          <div className="flex justify-end gap-2"><button type="button" className={FORM_SECONDARY_CLASS} onClick={onClose}>Cancel</button><button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || f.name.trim().length < 3 || !f.place.trim()} onClick={() => void send()}>Send proposal</button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Chapter settings (organisers): who proposes, Dormant after, and the About text new chapters start with. */
function ChapterSettings({ orgId, initial, onSaved }: { orgId: string; initial: { proposeBy: "members" | "organisers"; dormantDays: number; kitAbout: string }; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState(initial);
  const save = async () => {
    const r = await saveChapterSettingsAction(orgId, f);
    if (!r.success) return void toast.error(r.error);
    toast.success("Chapter settings saved");
    onSaved();
  };
  if (!open) return <button type="button" className="nb-link text-[13px]" onClick={() => setOpen(true)}>Chapter settings</button>;
  return (
    <fieldset className="space-y-2 rounded-md border border-border bg-card p-3" data-testid="chapter-settings">
      <legend className="px-1 font-medium">Chapter settings</legend>
      <span className="flex flex-wrap gap-4">
        <label className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name="proposeBy" checked={f.proposeBy === "members"} onChange={() => setF({ ...f, proposeBy: "members" })} />Members propose chapters</label>
        <label className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name="proposeBy" checked={f.proposeBy === "organisers"} onChange={() => setF({ ...f, proposeBy: "organisers" })} />Only organisers start them</label>
      </span>
      <label className="flex flex-wrap items-center gap-2">Dormant after<Input type="number" min={30} max={730} value={f.dormantDays} onChange={(x) => setF({ ...f, dormantDays: Number(x.target.value) })} className="w-[90px] font-mono" />days with no events or posts (organisers only; nothing closes on its own)</label>
      <label className="block">New chapters start with this About text<textarea className="nb-textarea mt-1 w-full" rows={3} maxLength={2000} value={f.kitAbout} onChange={(x) => setF({ ...f, kitAbout: x.target.value })} /></label>
      <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save chapter settings</button>
    </fieldset>
  );
}

/** Groups (B5.5b, call 8): small groups by name, kind, size and when they meet; Join, Ask to join, Full or Invite only; hosts answer requests. */
export function CommunityGroups({ orgId }: { orgId: string }) {
  const client = useQueryClient();
  const [starting, setStarting] = useState(false);
  const q = useQuery({ queryKey: ["community-groups", orgId], queryFn: () => readGroupsAction(orgId), staleTime: 30_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading groups…</p>;
  if (!q.data?.success) return <ErrorNotice what="Groups" onRetry={() => void q.refetch()} />;
  const d = q.data;
  const refresh = () => void client.invalidateQueries({ queryKey: ["community-groups", orgId] });
  const join = async (id: string) => {
    const r = await joinGroupAction(orgId, id);
    if (!r.success) return void toast.error(r.error);
    toast.success(r.outcome === "joined" ? "You’re in the group" : "Asked. The group’s hosts will answer.");
    refresh();
  };
  const answer = async (groupId: string, person: string, accept: boolean) => {
    const r = await answerGroupRequestAction(orgId, groupId, person, accept);
    if (!r.success) return void toast.error(r.error);
    toast.success(accept ? "Added to the group" : "Declined");
    refresh();
  };
  return (
    <section aria-label="Groups" className="space-y-3 text-[13px]" data-testid="community-groups">
      {d.canStart ? <div className="flex justify-end"><button type="button" className={FORM_PRIMARY_CLASS} onClick={() => setStarting(true)}>Start a group</button></div> : null}
      {d.groups.length ? (
        <ul className="grid gap-2 sm:grid-cols-2" aria-label="Groups list">
          {d.groups.map((g) => (
            <li key={g.id} className="space-y-1.5 rounded-md border border-border bg-card p-3" data-testid="group-card">
              <p className="flex items-center gap-2"><UsersRound className="size-4" aria-hidden="true" />{g.mine ? <a href={`/workspaces/${encodeURIComponent(g.slug ?? g.id)}`} className="nb-link font-medium">{g.title}</a> : <span className="font-medium">{g.title}</span>}</p>
              <p className="text-muted-foreground">{GROUP_KIND_WORDS[g.kind as keyof typeof GROUP_KIND_WORDS] ?? "Other"} · <span className="font-mono">{g.members} of {g.cap}</span>{g.meets ? ` · ${g.meets}` : ""}{g.chapter ? ` · ${g.chapter}` : ""}</p>
              {g.purpose ? <p>{g.purpose}</p> : null}
              {g.mine ? <StatusBadge state="active">You’re in it</StatusBadge>
                : g.join === "invite" ? <StatusBadge state="neutral">Invite only</StatusBadge>
                : g.members >= g.cap ? <StatusBadge state="neutral">Full</StatusBadge>
                : g.asked ? <StatusBadge state="neutral">Asked</StatusBadge>
                : <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void join(g.id)}>{g.join === "ask" ? "Ask to join" : "Join"}</button>}
              {g.requests.length ? <div className="space-y-1 border-t border-border pt-2"><p className="font-medium">Asked to join</p>
                {g.requests.map((id, i) => (
                  <span key={id} className="flex flex-wrap items-center gap-2">{g.requestNames[i]}
                    <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void answer(g.id, id, true)}>Accept</button>
                    <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void answer(g.id, id, false)}>Decline</button></span>))}
              </div> : null}
            </li>
          ))}
        </ul>
      ) : <p className="py-2 text-muted-foreground">No groups yet. A group is a few people meeting regularly: a study group, a book club, a circle.</p>}
      {starting ? <StartGroup orgId={orgId} onClose={() => setStarting(false)} onDone={refresh} /> : null}
    </section>
  );
}

function StartGroup({ orgId, onClose, onDone }: { orgId: string; onClose: () => void; onDone: () => void }) {
  const [f, setF] = useState({ title: "", kind: "study" as (typeof GROUP_KINDS)[number], purpose: "", meets: "", cap: 12, join: "open" as "open" | "ask" | "invite" });
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    const r = await startGroupAction(orgId, { ...f, chapterId: null });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast.success("Group started. Our commitment is ready to edit.");
    onDone(); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="form">
        <DialogHeader><DialogTitle>Start a group</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]" data-testid="start-group">
          <label className="block">Name<Input value={f.title} maxLength={80} onChange={(x) => setF({ ...f, title: x.target.value })} /></label>
          <label className="block">Kind<select className="nb-select mt-1 block" value={f.kind} onChange={(x) => setF({ ...f, kind: x.target.value as typeof f.kind })}>{GROUP_KINDS.map((k) => <option key={k} value={k}>{GROUP_KIND_WORDS[k]}</option>)}</select></label>
          <label className="block">Purpose<Input value={f.purpose} maxLength={500} onChange={(x) => setF({ ...f, purpose: x.target.value })} /></label>
          <label className="block">When it meets<Input value={f.meets} maxLength={80} placeholder="Tuesdays 20:00" onChange={(x) => setF({ ...f, meets: x.target.value })} /></label>
          <label className="block">Size<Input type="number" min={2} max={50} value={f.cap} onChange={(x) => setF({ ...f, cap: Number(x.target.value) })} className="w-[90px] font-mono" /></label>
          <fieldset className="flex flex-wrap gap-4"><legend className="mb-1">Joining</legend>
            {(["open", "ask", "invite"] as const).map((k) => <label key={k} className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name="join" checked={f.join === k} onChange={() => setF({ ...f, join: k })} />{k === "open" ? "Open" : k === "ask" ? "Ask to join" : "Invite only"}</label>)}
          </fieldset>
          <p className="text-muted-foreground">The group is listed to the community by name and size; what happens inside stays with the group.</p>
          <div className="flex justify-end gap-2"><button type="button" className={FORM_SECONDARY_CLASS} onClick={onClose}>Cancel</button><button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || f.title.trim().length < 3} onClick={() => void start()}>Start</button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
