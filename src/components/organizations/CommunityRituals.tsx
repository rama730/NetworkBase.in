"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MessageCircleQuestion, Repeat } from "lucide-react";

import { readRitualsAction, removeRitualAction, saveRitualAction } from "@/app/actions/community-rituals";
import { StatusBadge } from "@/components/organizations/org-ui";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Input } from "@/components/ui/input";
import { PixelBeat } from "@/components/ui/PixelBeat";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import type { Ritual } from "@/lib/organizations/rituals";

// Report 34.5 (plan B5.4d, M4 calls 7–8): Sprints → Rituals — Threads and Ask me anything on a schedule, each posted as
// an Update naming its host. Organisers add, pause and remove them; members see what's coming.
const key = (orgId: string) => ["community-rituals", orgId] as const;
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const full = (iso: string) => new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(new Date(iso));

export function CommunityRituals({ orgId, me }: { orgId: string; me: string | null }) {
  const client = useQueryClient();
  const [editing, setEditing] = useState<Partial<Ritual> | null>(null);
  const q = useQuery({ queryKey: key(orgId), queryFn: () => readRitualsAction(orgId), staleTime: 60_000 });
  if (q.isPending) return <p role="status" className="nb-waiting py-6 text-[13px] text-muted-foreground"><PixelBeat />Loading rituals…</p>;
  if (!q.data?.success) return <ErrorNotice what="Rituals" onRetry={() => void q.refetch()} />;
  const d = q.data;
  const refresh = () => void client.invalidateQueries({ queryKey: key(orgId) });
  const pause = async (r: (typeof d.rituals)[number], paused: boolean) => {
    // Only the fields a ritual is saved with (the list carries its post history and names too).
    const res = await saveRitualAction(orgId, { id: r.id, name: r.name, kind: r.kind, freq: r.freq, weekday: r.weekday, time: r.time, hostId: r.hostId, prompt: r.prompt, leadDays: r.leadDays, paused });
    if (!res.success) return void toast.error(res.error);
    toast.success(paused ? "Paused" : "Running again");
    refresh();
  };
  const remove = async (id: string) => {
    const res = await removeRitualAction(orgId, id);
    if (!res.success) return void toast.error(res.error);
    toast.success("Ritual removed. What it posted stays in Updates.");
    refresh();
  };
  const preset = (kind: "thread" | "ama"): Partial<Ritual> => kind === "ama"
    ? { name: "Ask me anything", kind: "ama", freq: "monthly", weekday: 4, time: "19:00", leadDays: 3, prompt: "", hostId: me ?? "" }
    : { name: "Weekly wins", kind: "thread", freq: "weekly", weekday: 5, time: "17:00", leadDays: 0, prompt: "What went well for you this week? Share a win, big or small.", hostId: me ?? "" };
  return (
    <section aria-label="Rituals" className="space-y-3 text-[13px]" data-testid="community-rituals">
      {d.canEdit ? <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setEditing(preset("ama"))}>Add Ask me anything</button>
        <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => setEditing(preset("thread"))}>Add a ritual</button>
      </div> : null}
      {d.rituals.length ? (
        <ul className="divide-y divide-border rounded-md border border-border bg-card" aria-label="Rituals list">
          {d.rituals.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2" data-testid="ritual-row">
              {r.kind === "ama" ? <MessageCircleQuestion className="size-4" aria-hidden="true" /> : <Repeat className="size-4" aria-hidden="true" />}
              <span className="min-w-[140px] flex-1"><span className="block font-medium">{r.name}</span>
                <span className="block text-muted-foreground">{r.kind === "ama" ? "Ask me anything" : "Thread"} · {r.repeat} · Host: {r.host}</span></span>
              {r.paused ? <StatusBadge state="neutral">Paused</StatusBadge> : r.next ? <span className="font-mono text-muted-foreground">Next {full(r.next)}</span> : null}
              {d.canEdit ? <span className="flex gap-2">
                <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setEditing(r)}>Edit</button>
                <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void pause(r, !r.paused)}>{r.paused ? "Resume" : "Pause"}</button>
                <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void remove(r.id)}>Remove</button>
              </span> : null}
            </li>
          ))}
        </ul>
      ) : <p className="py-4 text-muted-foreground">{d.canEdit ? "No rituals yet. Weekly wins and Ask me anything are ready to use." : "No rituals yet."}</p>}
      {editing ? <RitualForm orgId={orgId} initial={editing} onClose={() => setEditing(null)} onSaved={refresh} /> : null}
    </section>
  );
}

function RitualForm({ orgId, initial, onClose, onSaved }: { orgId: string; initial: Partial<Ritual>; onClose: () => void; onSaved: () => void }) {
  const [f, setF] = useState({ id: initial.id ?? `r-${Date.now().toString(36)}`, name: initial.name ?? "", kind: initial.kind ?? "thread", freq: initial.freq ?? "weekly", weekday: initial.weekday ?? 5,
    time: initial.time ?? "17:00", hostId: initial.hostId ?? "", prompt: initial.prompt ?? "", leadDays: initial.leadDays ?? 0, paused: initial.paused ?? false });
  const save = async () => {
    const r = await saveRitualAction(orgId, f);
    if (!r.success) return void toast.error(r.error);
    toast.success("Ritual saved");
    onSaved(); onClose();
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent size="form">
        <DialogHeader><DialogTitle>{initial.id ? "Edit ritual" : f.kind === "ama" ? "Add Ask me anything" : "Add a ritual"}</DialogTitle></DialogHeader>
        <div className="space-y-3 text-[13px]" data-testid="ritual-form">
          <label className="block">Name<Input value={f.name} maxLength={80} onChange={(x) => setF({ ...f, name: x.target.value })} /></label>
          <fieldset className="flex flex-wrap gap-4"><legend className="mb-1">Repeats</legend>
            <label className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name="freq" checked={f.freq === "weekly"} onChange={() => setF({ ...f, freq: "weekly" })} />Every week</label>
            <label className="flex items-center gap-1.5"><input type="radio" className="nb-radio" name="freq" checked={f.freq === "monthly"} onChange={() => setF({ ...f, freq: "monthly" })} />First of the month</label>
          </fieldset>
          <span className="flex flex-wrap gap-3">
            <label>Day<select className="nb-select mt-1 block" value={f.weekday} onChange={(x) => setF({ ...f, weekday: Number(x.target.value) })}>{DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</select></label>
            <label>Time<Input type="time" value={f.time} onChange={(x) => setF({ ...f, time: x.target.value })} className="w-[120px] font-mono" /></label>
            {f.kind === "ama" ? <label>Questions open<Input type="number" min={0} max={7} value={f.leadDays} onChange={(x) => setF({ ...f, leadDays: Number(x.target.value) })} className="w-[80px] font-mono" />days before</label> : null}
          </span>
          <label className="block">Prompt<textarea className="nb-textarea mt-1 w-full" rows={3} maxLength={2000} value={f.prompt} onChange={(x) => setF({ ...f, prompt: x.target.value })} /></label>
          <p className="text-muted-foreground">It posts in Updates from you, naming the host. Replies are comments.</p>
          <div className="flex justify-end gap-2"><button type="button" className={FORM_SECONDARY_CLASS} onClick={onClose}>Cancel</button><button type="button" className={FORM_PRIMARY_CLASS} disabled={!f.name.trim() || !f.hostId} onClick={() => void save()}>Save</button></div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
