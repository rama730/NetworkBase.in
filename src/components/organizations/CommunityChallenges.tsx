"use client";

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, Sparkles } from "lucide-react";

import { createAssignmentAction } from "@/app/actions/assignments";
import { featureEntryAction, joinChallengeAction, readPromptsAction, savePromptsAction, leaveChallengeAction, readChallengeEntriesAction, readChallengesAction, readShowcaseAction, saveEntryCardAction } from "@/app/actions/community-challenges";
import { StatusBadge } from "@/components/organizations/org-ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";

// Report 34.5 (plan B5.4a, M4): a community's Tasks → Challenges — optional challenges members Join and hand in to,
// never Missing; organisers Start a challenge. The current challenge also shows on the Overview.
const key = (orgId: string) => ["community-challenges", orgId] as const;
const closes = (iso: string | null) => (iso ? new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short", hour: "numeric", minute: "2-digit" }).format(new Date(iso)) : null);

/** A community's Tasks: the board, and Challenges a click away. */
export function CommunityTasks({ orgId, base, children }: { orgId: string; base: string; children: ReactNode }) {
  const [view, setView] = useState<"tasks" | "challenges">(() => (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("view") === "challenges" ? "challenges" : "tasks"));
  return (
    <div className="space-y-4">
      <div className="flex gap-1 text-[13px]" role="group" aria-label="Tasks views">
        {(["tasks", "challenges"] as const).map((v) => (
          <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)} className={cn("rounded-sm px-2.5 py-1", view === v ? "bg-muted font-semibold text-foreground" : "text-muted-foreground")}>{v === "tasks" ? "Tasks" : "Challenges"}</button>
        ))}
      </div>
      {view === "challenges" ? <CommunityChallenges orgId={orgId} base={base} /> : children}
    </div>
  );
}

export function CommunityChallenges({ orgId, base }: { orgId: string; base: string }) {
  const client = useQueryClient();
  const [starting, setStarting] = useState(false);
  const [shown, setShown] = useState<string | null>(null);
  const q = useQuery({ queryKey: key(orgId), queryFn: () => readChallengesAction(orgId), staleTime: 30_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading challenges…</p>;
  if (!q.data?.success) return <ErrorNotice what="Challenges" onRetry={() => void q.refetch()} />;
  const d = q.data;
  const join = async (id: string) => {
    const r = await joinChallengeAction(orgId, id);
    if (!r.success) return void toast.error(r.error);
    toast.success("You’re in. Hand in your entry when it’s ready.");
    void client.invalidateQueries({ queryKey: key(orgId) });
  };
  const leave = async (id: string) => {
    const r = await leaveChallengeAction(orgId, id);
    if (!r.success) return void toast.error(r.error);
    toast.success("You left the challenge");
    void client.invalidateQueries({ queryKey: key(orgId) });
  };
  const open = d.challenges.filter((c) => c.open);
  const past = d.challenges.filter((c) => !c.open);
  const card = (c: (typeof d.challenges)[number]) => (
    <li key={c.id} className="space-y-1.5 rounded-md border border-border bg-card p-3" data-testid="challenge-card">
      <p className="flex flex-wrap items-center gap-2"><Flag className="size-3.5" aria-hidden="true" /><span className="font-medium">{c.title}</span>
        {c.open ? <span className="font-mono text-muted-foreground">{c.closes ? `Open · closes ${closes(c.closes)}` : "Open"}</span> : <StatusBadge state="neutral">Closed</StatusBadge>}</p>
      {c.description ? <p className="whitespace-pre-wrap text-muted-foreground">{c.description}</p> : null}
      <Prompts orgId={orgId} masterId={c.id} />
      <p className="font-mono text-muted-foreground">{c.joined} joined · {c.entries} {c.entries === 1 ? "entry" : "entries"}</p>
      <span className="flex flex-wrap gap-2">
        {c.mine ? <a href={`${base}?tab=tasks&taskId=${c.mine.id}`} className={FORM_PRIMARY_CLASS}>{c.mine.handedIn ? "Your entry" : "Hand in"}</a>
          : c.open && d.canJoin ? <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void join(c.id)}>Join the challenge</button> : null}
        {c.mine && !c.mine.handedIn && c.open ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void leave(c.id)}>Leave</button> : null}
        {c.entries ? <button type="button" className={FORM_SECONDARY_CLASS} aria-expanded={shown === c.id} onClick={() => setShown(shown === c.id ? null : c.id)}>{shown === c.id ? "Hide entries" : "See entries"}</button> : null}
      </span>
      {shown === c.id ? <Entries orgId={orgId} masterId={c.id} /> : null}
    </li>
  );
  return (
    <section aria-label="Challenges" className="space-y-3 text-[13px]" data-testid="community-challenges">
      {d.canStart ? <div className="flex justify-end"><button type="button" className={FORM_PRIMARY_CLASS} onClick={() => setStarting(true)}>Start a challenge</button></div> : null}
      {open.length ? <ul className="space-y-2" aria-label="Open challenges">{open.map(card)}</ul> : <p className="py-2 text-muted-foreground">{d.canStart ? "No challenge running. Start one: taking part is always a choice." : "No challenge running right now."}</p>}
      {past.length ? <><h3 className="pt-2 font-medium">Past challenges</h3><ul className="space-y-2" aria-label="Past challenges">{past.map(card)}</ul></> : null}
      {starting ? <StartChallenge orgId={orgId} onClose={() => setStarting(false)} onMade={() => void client.invalidateQueries({ queryKey: key(orgId) })} /> : null}
    </section>
  );
}

function StartChallenge({ orgId, onClose, onMade }: { orgId: string; onClose: () => void; onMade: () => void }) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const d = new Date(Date.now() + 7 * 86_400_000);
  const [f, setF] = useState({ title: "", prompt: "", closes: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T23:00`, entry: "link" as "link" | "text" | "file" });
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    const r = await createAssignmentAction({ projectId: orgId, title: f.title.trim(), description: f.prompt.trim() || undefined, dueDate: new Date(f.closes).toISOString(), publish: true,
      submissionType: f.entry, reviewRequired: false, lateRule: "none", target: { mode: "optional" }, steps: [] });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast.success("Challenge started. Members can join now.");
    onMade(); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="form">
        <DialogHeader><DialogTitle>Start a challenge</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]" data-testid="start-challenge">
          <label className="block">Title<Input value={f.title} maxLength={200} onChange={(x) => setF({ ...f, title: x.target.value })} /></label>
          <label className="block">Prompt<textarea className="nb-textarea mt-1 w-full" rows={3} maxLength={10000} value={f.prompt} onChange={(x) => setF({ ...f, prompt: x.target.value })} /></label>
          <label className="block">Closes<Input type="datetime-local" value={f.closes} onChange={(x) => setF({ ...f, closes: x.target.value })} className="font-mono" /></label>
          <fieldset className="flex flex-wrap gap-4"><legend className="mb-1">Entries are</legend>
            {(["link", "text", "file"] as const).map((k) => <label key={k} className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name="entry" checked={f.entry === k} onChange={() => setF({ ...f, entry: k })} />{k === "link" ? "A link" : k === "text" ? "Text" : "A file"}</label>)}
          </fieldset>
          <p className="text-muted-foreground">Only people who join get it. Nothing turns missing, and nobody is reminded to take part.</p>
          <div className="flex justify-end gap-2"><button type="button" className={FORM_SECONDARY_CLASS} onClick={onClose}>Cancel</button><button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !f.title.trim()} onClick={() => void start()}>Start</button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** The current challenge on the Overview (layer 6): title, closes, joined count, Join or your entry. */
export function CurrentChallengeCard({ orgId, base }: { orgId: string; base: string }) {
  const q = useQuery({ queryKey: key(orgId), queryFn: () => readChallengesAction(orgId), staleTime: 60_000 });
  const c = q.data?.success ? q.data.challenges.find((x) => x.open) : null;
  if (!c) return null;
  return (
    <section aria-label="Current challenge" className="space-y-1 rounded-md border border-border bg-card p-3 text-[13px]" data-testid="current-challenge">
      <h3 className="font-medium">Current challenge</h3>
      <p><a href={`${base}?tab=tasks&view=challenges`} className="nb-link font-medium">{c.title}</a></p>
      <p className="font-mono text-muted-foreground">{c.closes ? `Closes ${closes(c.closes)} · ` : ""}{c.joined} joined</p>
      {c.mine ? <a href={`${base}?tab=tasks&taskId=${c.mine.id}`} className="nb-link">{c.mine.handedIn ? "Your entry" : "Hand in your entry"}</a> : null}
    </section>
  );
}

type Entry = { id: string; challenge: string; title: string; line: string | null; link: string | null; text: string | null; maker: string; mine: boolean; featured: boolean; why: string | null; isPublic: boolean };

/** One entry card (layer 6): title, maker, challenge, Featured as a word with its line. */
function EntryCard({ e, children }: { e: Entry; children?: ReactNode }) {
  return (
    <li className="space-y-1 rounded-md border border-border bg-card p-3" data-testid="entry-card">
      <p className="font-medium">{e.link ? <a href={e.link} target="_blank" rel="noopener noreferrer" className="nb-link">{e.title}</a> : e.title}</p>
      <p className="text-muted-foreground">{e.maker} · {e.challenge}</p>
      {e.line ? <p>{e.line}</p> : null}
      {e.text ? <p className="line-clamp-3 whitespace-pre-wrap text-muted-foreground">{e.text}</p> : null}
      {e.featured ? <p className="flex items-start gap-1"><Sparkles className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" /><span><span className="font-medium">Featured</span>{e.why ? ` · “${e.why}”` : ""}</span></p> : null}
      {children}
    </li>
  );
}

/** A challenge's entries (members): Featured first; organisers Feature with a line; your entry's card and public tick. */
function Entries({ orgId, masterId }: { orgId: string; masterId: string }) {
  const q = useQuery({ queryKey: ["challenge-entries", orgId, masterId], queryFn: () => readChallengeEntriesAction(orgId, masterId) });
  if (q.isPending) return <p role="status" className="nb-waiting text-muted-foreground"><PixelBeat />Loading entries…</p>;
  if (!q.data?.success) return <ErrorNotice what="Entries" onRetry={() => void q.refetch()} />;
  const d = q.data;
  return (
    <ul className="grid gap-2 sm:grid-cols-2" aria-label="Entries">
      {d.entries.map((e) => (
        <EntryCard key={e.id} e={e}>
          {e.mine ? <MyEntryCard orgId={orgId} e={e} onSaved={() => void q.refetch()} /> : null}
          {d.canFeature ? <FeatureControl orgId={orgId} e={e} onSaved={() => void q.refetch()} /> : null}
        </EntryCard>
      ))}
    </ul>
  );
}

function MyEntryCard({ orgId, e, onSaved }: { orgId: string; e: Entry; onSaved: () => void }) {
  const [f, setF] = useState({ title: e.title, line: e.line ?? "", isPublic: e.isPublic });
  const save = async () => {
    const r = await saveEntryCardAction(orgId, e.id, { title: f.title.trim() || null, line: f.line.trim() || null, isPublic: f.isPublic });
    if (!r.success) return void toast.error(r.error);
    toast.success("Your entry is updated");
    onSaved();
  };
  return (
    <fieldset className="space-y-2 border-t border-border pt-2" data-testid="my-entry-card">
      <legend className="sr-only">Your entry’s card</legend>
      <Input value={f.title} maxLength={120} aria-label="Entry title" onChange={(x) => setF({ ...f, title: x.target.value })} />
      <Input value={f.line} maxLength={200} placeholder="One line about it" aria-label="Entry line" onChange={(x) => setF({ ...f, line: x.target.value })} />
      <label className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={f.isPublic} onChange={(x) => setF({ ...f, isPublic: x.target.checked })} />Show on the public Showcase</label>
      <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void save()}>Save</button>
    </fieldset>
  );
}

function FeatureControl({ orgId, e, onSaved }: { orgId: string; e: Entry; onSaved: () => void }) {
  const [why, setWhy] = useState(e.why ?? "");
  const feature = async (on: boolean) => {
    const r = await featureEntryAction(orgId, e.id, on ? why : null);
    if (!r.success) return void toast.error(r.error);
    toast.success(on ? "Featured" : "No longer featured");
    onSaved();
  };
  return (
    <span className="flex flex-wrap items-center gap-2 border-t border-border pt-2">
      <Input value={why} maxLength={200} placeholder="Why we love it" aria-label={`Why we love ${e.title}`} onChange={(x) => setWhy(x.target.value)} className="min-w-0 flex-1" />
      <button type="button" className={FORM_SECONDARY_CLASS} disabled={!why.trim()} onClick={() => void feature(true)}>{e.featured ? "Update" : "Feature"}</button>
      {e.featured ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void feature(false)}>Not now</button> : null}
    </span>
  );
}

/** The Showcase on About (calls 5–6): Featured first, then newest; visitors see only entries their makers said yes to. */
export function CommunityShowcase({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: ["community-showcase", orgId], queryFn: () => readShowcaseAction(orgId), staleTime: 60_000 });
  const list = q.data?.success ? q.data.entries : [];
  if (!list.length) return null;
  return (
    <section aria-label="Showcase" className="space-y-2" data-testid="showcase">
      <h3 className="nb-card-title">Showcase</h3>
      <ul className="grid gap-2 sm:grid-cols-2">{list.slice(0, 12).map((e) => <EntryCard key={e.id} e={e} />)}</ul>
    </section>
  );
}

const fullDate = (iso: string) => new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" }).format(new Date(iso));

/** Prompts by day (call 2): a prompt shows only once it opens; before that, its day and when it opens. Organisers edit them. */
function Prompts({ orgId, masterId }: { orgId: string; masterId: string }) {
  const q = useQuery({ queryKey: ["challenge-prompts", orgId, masterId], queryFn: () => readPromptsAction(orgId, masterId), staleTime: 60_000 });
  const [editing, setEditing] = useState(false);
  if (!q.data?.success) return null;
  const { prompts, canEdit } = q.data;
  if (!prompts.length && !canEdit) return null;
  return (
    <div className="space-y-1" data-testid="challenge-prompts">
      {prompts.length ? <ol className="space-y-0.5" aria-label="Prompts">{prompts.map((p) => (
        <li key={p.position}><span className="font-mono text-muted-foreground">Day {p.position}</span>{" "}
          {p.open ? <><span className="font-medium">{p.title}</span>{p.body ? <span className="text-muted-foreground"> · {p.body}</span> : null}</>
            : <span className="text-muted-foreground">{canEdit && p.title ? `${p.title} · ` : ""}Opens {fullDate(p.opensAt)}</span>}
        </li>))}</ol> : null}
      {canEdit ? (editing ? <PromptEditor orgId={orgId} masterId={masterId} initial={prompts} onDone={() => { setEditing(false); void q.refetch(); }} />
        : <button type="button" className="nb-link text-[13px]" onClick={() => setEditing(true)}>{prompts.length ? "Edit prompts" : "Add prompts by day"}</button>) : null}
    </div>
  );
}

function PromptEditor({ orgId, masterId, initial, onDone }: { orgId: string; masterId: string; initial: Array<{ title: string | null; body: string | null; opensAt: string }>; onDone: () => void }) {
  const pad = (n: number) => String(n).padStart(2, "0");
  const local = (iso: string) => { const d = new Date(iso); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
  const [rows, setRows] = useState(initial.length ? initial.map((p) => ({ title: p.title ?? "", body: p.body ?? "", opensAt: local(p.opensAt) })) : [{ title: "", body: "", opensAt: local(new Date().toISOString()) }]);
  const save = async () => {
    const r = await savePromptsAction(orgId, masterId, rows.filter((x) => x.title.trim()).map((x) => ({ title: x.title.trim(), body: x.body.trim() || null, opensAt: new Date(x.opensAt).toISOString() })));
    if (!r.success) return void toast.error(r.error);
    toast.success("Prompts saved. Each stays hidden until it opens.");
    onDone();
  };
  return (
    <fieldset className="space-y-2 rounded-md border border-border p-2" data-testid="prompt-editor">
      <legend className="px-1">Prompts by day</legend>
      {rows.map((r, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-muted-foreground">Day {i + 1}</span>
          <Input value={r.title} maxLength={120} placeholder="Prompt" aria-label={`Day ${i + 1} prompt`} onChange={(x) => setRows(rows.map((y, j) => (j === i ? { ...y, title: x.target.value } : y)))} className="min-w-0 flex-1" />
          <Input type="datetime-local" value={r.opensAt} aria-label={`Day ${i + 1} opens on`} onChange={(x) => setRows(rows.map((y, j) => (j === i ? { ...y, opensAt: x.target.value } : y)))} className="w-auto font-mono" />
        </div>
      ))}
      <span className="flex gap-2">
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => { const last = rows[rows.length - 1]; const next = new Date(new Date(last?.opensAt ?? Date.now()).getTime() + 86_400_000); setRows([...rows, { title: "", body: "", opensAt: local(next.toISOString()) }]); }}>Add a day</button>
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save prompts</button>
      </span>
    </fieldset>
  );
}
