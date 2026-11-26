"use client";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Lock, NotebookPen } from "lucide-react";

import { amendEntryAction, readNotebookAction, readProtocolStepsAction, saveEntryAction, saveExperimentAction } from "@/app/actions/lab-notebook";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { Input } from "@/components/ui/input";
import { UnderlineTabs } from "@/components/ui/UnderlineTabs";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { EXPERIMENT_WORDS } from "@/lib/organizations/lab-notebook";
import { addDaysToDay, formatInZone, todayInZone } from "@/lib/organizations/zoned-time";

// Report 35.5 (plan B6.2b, R4): a lab workspace's Notebook on its Overview — entries by day with Locked and
// amendments, Run this protocol, and experiments. Members of the workspace and the lab's PI and Researchers see it.
const key = (id: string) => ["lab-notebook", id] as const;
type Data = Extract<Awaited<ReturnType<typeof readNotebookAction>>, { success: true }>;
type Entry = Data["entries"][number];
const FIELDS = [["aim", "Aim"], ["inputs", "Samples or inputs"], ["steps", "Steps done"], ["deviations", "Deviations"], ["results", "Results"], ["next", "Next"]] as const;

export function LabNotebook({ workspaceId }: { workspaceId: string }) {
  const q = useQuery({ queryKey: key(workspaceId), queryFn: () => readNotebookAction(workspaceId), staleTime: 30_000 });
  const [view, setView] = useState<"entries" | "experiments">("entries");
  const [writing, setWriting] = useState(false);
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  return (
    <OrgCard title="Notebook" testId="lab-notebook" action={d.writer && !writing ? <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => setWriting(true)}>+ Entry</button> : null}>
      <div className="space-y-3 text-[13px]">
        <UnderlineTabs tabs={[{ key: "entries" as const, label: "Entries", count: d.entries.length }, { key: "experiments" as const, label: "Experiments", count: d.experiments.length }]}
          value={view} onChange={setView} label="Notebook views" idPrefix="lab-notebook" />
        {writing ? <EntryForm workspaceId={workspaceId} d={d} onDone={() => setWriting(false)} /> : null}
        <div id={`lab-notebook-panel-${view}`} role="tabpanel">
          {view === "experiments" ? <Experiments workspaceId={workspaceId} d={d} />
            : d.entries.length ? <ol className="space-y-3">{d.entries.map((e) => <EntryCard key={e.id} workspaceId={workspaceId} e={e} d={d} />)}</ol>
            : <p className="text-muted-foreground">No entries yet. An entry is a dated record: aim, steps, deviations and results. It locks at the end of its day.</p>}
        </div>
      </div>
    </OrgCard>
  );
}

function EntryCard({ workspaceId, e, d }: { workspaceId: string; e: Entry; d: Data }) {
  const client = useQueryClient();
  const [amending, setAmending] = useState(false);
  const [text, setText] = useState("");
  const [editing, setEditing] = useState(false);
  const body = e.body as Record<string, unknown>;
  const amend = async () => {
    const r = await amendEntryAction(workspaceId, e.id, text).catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));
    if (!r.success) return void toast.error(r.error);
    toast.success("Amendment added");
    setText(""); setAmending(false);
    void client.invalidateQueries({ queryKey: key(workspaceId) });
  };
  if (editing) return <li><EntryForm workspaceId={workspaceId} d={d} entry={e} onDone={() => setEditing(false)} /></li>;
  return (
    <li className="space-y-1.5 rounded-md border border-border p-3" data-testid="lab-entry">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-muted-foreground">{e.day}</span><span className="font-medium">{e.title}</span>
        <span className="text-muted-foreground">by {e.author}</span>
        {e.locked ? <StatusBadge state="neutral"><Lock className="mr-1 inline size-3" aria-hidden="true" />Locked</StatusBadge> : <StatusBadge state="active">Open until {formatInZone(e.locksAt, { hour: "numeric", minute: "2-digit" }, d.tz)}</StatusBadge>}
        {e.amendments.length ? <StatusBadge state="draft">Amended</StatusBadge> : null}
        {e.writtenLater ? <StatusBadge state="draft">Written later</StatusBadge> : null}
      </p>
      {e.protocol ? <p>Protocol: {e.protocol.title} v{e.protocol.version}{e.protocol.state === "retired" ? " (since retired)" : ""}{e.untrained ? <span className="text-destructive"> · Not trained on this protocol</span> : null}</p> : null}
      {e.experiment ? <p>Experiment: {e.experiment}</p> : null}
      {FIELDS.map(([k, label]) => (typeof body[k] === "string" && body[k] ? (
        <div key={k}><p className={k === "deviations" ? "font-medium text-destructive" : "font-medium"}>{label}</p><p className="whitespace-pre-wrap">{body[k] as string}</p></div>
      ) : null))}
      {Array.isArray(body.links) && body.links.length ? <p>Data links (never opened by NetworkBase): {(body.links as string[]).map((l, i) => <span key={l}>{i ? ", " : ""}<a href={l} target="_blank" rel="noreferrer noopener" className="nb-link">{l}</a></span>)}</p> : null}
      {e.amendments.length ? (
        <ul className="space-y-1 border-t border-border pt-1.5" aria-label="Amendments">
          {e.amendments.map((a) => <li key={a.id}><span className="text-muted-foreground">Amendment {formatInZone(a.at, { dateStyle: "medium", timeStyle: "short" }, d.tz)} ({a.by}):</span> {a.body}</li>)}
        </ul>
      ) : null}
      <span className="flex flex-wrap gap-2">
        {!e.locked && e.authorId === d.me ? <button type="button" className="nb-link" onClick={() => setEditing(true)}>Edit</button> : null}
        {e.locked && d.canAmend && !amending ? <button type="button" className="nb-link" onClick={() => setAmending(true)}>Add an amendment</button> : null}
      </span>
      {amending ? (
        <span className="flex flex-wrap items-center gap-2">
          <Input value={text} maxLength={4000} onChange={(x) => setText(x.target.value)} aria-label={`Amendment to ${e.title}`} placeholder="What changes, and why" className="min-w-[260px] flex-1" />
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={!text.trim()} onClick={() => void amend()}>Add</button>
          <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setAmending(false)}>Cancel</button>
        </span>
      ) : null}
    </li>
  );
}

function EntryForm({ workspaceId, d, entry, onDone }: { workspaceId: string; d: Data; entry?: Entry; onDone: () => void }) {
  const client = useQueryClient();
  const today = todayInZone(d.tz);
  const b = (entry?.body ?? {}) as Record<string, string | string[]>;
  const [f, setF] = useState({ title: entry?.title ?? "", day: entry?.day ?? today, aim: (b.aim as string) ?? "", inputs: (b.inputs as string) ?? "", steps: (b.steps as string) ?? "",
    deviations: (b.deviations as string) ?? "", results: (b.results as string) ?? "", next: (b.next as string) ?? "", links: ((b.links as string[]) ?? []).join("\n"),
    protocolDocId: "", experimentId: entry?.experimentId ?? "" });
  const run = async (docId: string) => {
    setF((x) => ({ ...x, protocolDocId: docId }));
    if (!docId) return;
    const r = await readProtocolStepsAction(workspaceId, docId);
    if (!r.success) return void toast.error(r.error);
    setF((x) => ({ ...x, title: x.title || `${r.title} (v${r.version})`, steps: r.steps.map((s, i) => `${i + 1}. ${s}`).join("\n") }));
  };
  const chosen = d.protocols.find((p) => p.id === f.protocolDocId);
  const save = async () => {
    const r = await saveEntryAction(workspaceId, entry?.id ?? null, { ...f, links: f.links.split(/\s+/).map((x) => x.trim()).filter(Boolean), protocolDocId: entry ? null : f.protocolDocId || null, experimentId: f.experimentId || null }).catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));
    if (!r.success) return void toast.error(r.error);
    toast.success(r.untrained ? "Entry saved. It says you’re not trained on this protocol." : "Entry saved");
    void client.invalidateQueries({ queryKey: key(workspaceId) });
    onDone();
  };
  return (
    <fieldset className="space-y-2 rounded-md border border-border bg-card p-3" data-testid="lab-entry-form">
      <legend className="px-1 font-medium"><NotebookPen className="mr-1 inline size-3.5" aria-hidden="true" />{entry ? "Edit entry" : "New entry"}</legend>
      {!entry && d.protocols.length ? (
        <label className="block">Run this protocol (optional)
          <select className="nb-select mt-1 block" value={f.protocolDocId} onChange={(e) => void run(e.target.value)}>
            <option value="">No protocol</option>{d.protocols.map((p) => <option key={p.id} value={p.id}>{p.title} v{p.version}</option>)}
          </select></label>
      ) : null}
      {chosen?.needsTraining && !chosen.trained ? <p role="status" className="text-destructive">You’re not trained on this protocol yet. You can still run it; the entry will say so.</p> : null}
      <span className="flex flex-wrap gap-2">
        <label className="min-w-[220px] flex-1">Title<Input value={f.title} maxLength={160} onChange={(e) => setF({ ...f, title: e.target.value })} className="mt-1" /></label>
        {!entry ? <label>Day<select className="nb-select mt-1 block" value={f.day} onChange={(e) => setF({ ...f, day: e.target.value })}>
          <option value={today}>Today</option><option value={addDaysToDay(today, -1)}>Yesterday (written later)</option></select></label> : null}
        {d.experiments.length ? <label>Experiment<select className="nb-select mt-1 block" value={f.experimentId} onChange={(e) => setF({ ...f, experimentId: e.target.value })}>
          <option value="">None</option>{d.experiments.map((x) => <option key={x.id} value={x.id}>{x.title}</option>)}</select></label> : null}
      </span>
      {FIELDS.map(([k, label]) => (
        <label key={k} className="block">{label}<textarea className="nb-textarea mt-1 w-full" rows={k === "steps" || k === "results" ? 4 : 2} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} /></label>
      ))}
      <label className="block">Data links, one per line (outside storage; never opened by NetworkBase)<textarea className="nb-textarea mt-1 w-full font-mono" rows={2} value={f.links} onChange={(e) => setF({ ...f, links: e.target.value })} /></label>
      <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!f.title.trim()} onClick={() => void save()}>Save entry</button>
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={onDone}>Cancel</button></span>
      <p className="text-muted-foreground">It locks at the end of its day; after that, changes are amendments and nothing is removed.</p>
    </fieldset>
  );
}

function Experiments({ workspaceId, d }: { workspaceId: string; d: Data }) {
  const client = useQueryClient();
  const [edit, setEdit] = useState<{ id: string | null; title: string; hypothesis: string; status: keyof typeof EXPERIMENT_WORDS; conclusion: string } | null>(null);
  const save = async () => {
    if (!edit) return;
    const { id, ...rest } = edit;
    const r = await saveExperimentAction(workspaceId, id, rest).catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." }));
    if (!r.success) return void toast.error(r.error);
    toast.success("Experiment saved");
    setEdit(null);
    void client.invalidateQueries({ queryKey: key(workspaceId) });
  };
  return (
    <div className="space-y-2" data-testid="lab-experiments">
      {d.experiments.length ? <ul className="divide-y divide-border">{d.experiments.map((x) => (
        <li key={x.id} className="py-2"><p className="flex flex-wrap items-center gap-2"><span className="font-medium">{x.title}</span><StatusBadge state={x.status === "running" ? "active" : x.status === "done" ? "done" : "neutral"}>{EXPERIMENT_WORDS[x.status]}</StatusBadge>
          <span className="font-mono text-muted-foreground">{x.entries} {x.entries === 1 ? "entry" : "entries"}</span>
          {d.writer ? <button type="button" className="nb-link" onClick={() => setEdit({ id: x.id, title: x.title, hypothesis: x.hypothesis, status: x.status, conclusion: x.conclusion })}>Edit<span className="sr-only"> {x.title}</span></button> : null}</p>
          {x.hypothesis ? <p className="text-muted-foreground">Hypothesis: {x.hypothesis}</p> : null}
          {x.conclusion ? <p>Conclusion: {x.conclusion}</p> : null}</li>))}</ul>
        : <p className="text-muted-foreground">No experiments yet. An experiment groups entries under a hypothesis.</p>}
      {d.writer && !edit ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setEdit({ id: null, title: "", hypothesis: "", status: "planned", conclusion: "" })}>+ Experiment</button> : null}
      {edit ? (
        <fieldset className="space-y-2 rounded-md border border-border p-3" data-testid="lab-experiment-form">
          <legend className="px-1 font-medium">{edit.id ? "Edit experiment" : "New experiment"}</legend>
          <label className="block">Title<Input value={edit.title} maxLength={120} onChange={(e) => setEdit({ ...edit, title: e.target.value })} className="mt-1" /></label>
          <label className="block">Hypothesis<textarea className="nb-textarea mt-1 w-full" rows={2} value={edit.hypothesis} onChange={(e) => setEdit({ ...edit, hypothesis: e.target.value })} /></label>
          <label className="block">Status<select className="nb-select mt-1 block" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value as keyof typeof EXPERIMENT_WORDS })}>
            {(Object.keys(EXPERIMENT_WORDS) as Array<keyof typeof EXPERIMENT_WORDS>).map((s) => <option key={s} value={s}>{EXPERIMENT_WORDS[s]}</option>)}</select></label>
          <label className="block">Conclusion<textarea className="nb-textarea mt-1 w-full" rows={2} value={edit.conclusion} onChange={(e) => setEdit({ ...edit, conclusion: e.target.value })} /></label>
          <span className="flex gap-2"><button type="button" className={FORM_PRIMARY_CLASS} disabled={!edit.title.trim()} onClick={() => void save()}>Save experiment</button>
            <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setEdit(null)}>Cancel</button></span>
        </fieldset>
      ) : null}
    </div>
  );
}
