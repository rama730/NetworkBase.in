"use client";

import { useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag } from "lucide-react";

import { createAssignmentAction } from "@/app/actions/assignments";
import { joinChallengeAction, leaveChallengeAction, readChallengesAction } from "@/app/actions/community-challenges";
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
      <p className="font-mono text-muted-foreground">{c.joined} joined · {c.entries} {c.entries === 1 ? "entry" : "entries"}</p>
      <span className="flex flex-wrap gap-2">
        {c.mine ? <a href={`${base}?tab=tasks&taskId=${c.mine.id}`} className={FORM_PRIMARY_CLASS}>{c.mine.handedIn ? "Your entry" : "Hand in"}</a>
          : c.open && d.canJoin ? <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void join(c.id)}>Join the challenge</button> : null}
        {c.mine && !c.mine.handedIn && c.open ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void leave(c.id)}>Leave</button> : null}
      </span>
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
