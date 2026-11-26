"use client";

import Link from "next/link";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ClipboardList } from "lucide-react";

import { approveProtocolAction, askApproveProtocolAction, readProtocolAction, readProtocolsAction, retireProtocolAction, saveProtocolSettingsAction, signOffTrainingAction } from "@/app/actions/lab-protocols";
import { OrgCard, StatusBadge } from "@/components/organizations/org-ui";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";

// Report 35.5 (plan B6.2a, R4): a lab's protocols — the list on the lab Overview, and a panel on each protocol's page
// with its versions (Draft · Approved · Retired), Ask to approve, Approve, Needs training and trainers, and sign-offs.
const listKey = (orgId: string) => ["lab-protocols", orgId] as const;
const oneKey = (orgId: string, docId: string) => ["lab-protocol", orgId, docId] as const;
const STATE_WORD = { draft: "Draft", approved: "Approved", retired: "Retired" } as const;
const STATE_BADGE = { draft: "draft", approved: "active", retired: "neutral" } as const;

/** Lab Overview → Protocols (members): version and state, Needs training with my status, owner, Review by. */
export function LabProtocolsCard({ orgId }: { orgId: string }) {
  const q = useQuery({ queryKey: listKey(orgId), queryFn: () => readProtocolsAction(orgId), staleTime: 60_000 });
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  return (
    <OrgCard title="Protocols" testId="lab-protocols">
      {d.protocols.length ? (
        <ul className="divide-y divide-border text-[13px]">
          {d.protocols.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
              <ClipboardList className="size-4 text-muted-foreground" aria-hidden="true" />
              <Link href={`/org/${encodeURIComponent(d.slug)}?tab=docs&doc=${encodeURIComponent(p.slug)}`} className="nb-link min-w-[160px] flex-1 font-medium">{p.title}</Link>
              {p.approved ? <StatusBadge state="active">v{p.approved} Approved</StatusBadge> : <StatusBadge state="neutral">Not approved yet</StatusBadge>}
              {p.draft ? <StatusBadge state="draft">v{p.draft} Draft</StatusBadge> : null}
              {p.needsTraining ? <span className={p.trained ? "text-foreground" : "text-muted-foreground"}>Needs training: {p.trained ? "you’re Trained" : "not yet"}</span> : null}
              {p.owner ? <span className="text-muted-foreground">Owner: {p.owner}</span> : null}
            </li>
          ))}
        </ul>
      ) : <p className="text-[13px] text-muted-foreground">No protocols yet. In Documents, Add a page from the Protocol template.</p>}
    </OrgCard>
  );
}

/** On a protocol's page: versions, Ask to approve, Approve, training settings and sign-offs. */
export function ProtocolPanel({ orgId, docId }: { orgId: string; docId: string }) {
  const client = useQueryClient();
  const q = useQuery({ queryKey: oneKey(orgId, docId), queryFn: () => readProtocolAction(orgId, docId), staleTime: 30_000 });
  const [editing, setEditing] = useState(false);
  const [ticked, setTicked] = useState<Record<string, boolean>>({});
  const d = q.data?.success ? q.data : null;
  if (!d) return null;
  const refresh = () => { void q.refetch(); void client.invalidateQueries({ queryKey: listKey(orgId) }); };
  const run = async (p: Promise<{ success: boolean; error?: string }>, ok: string) => { const r = await p; if (!r.success) return void toast.error(r.error ?? "Couldn’t save that. Try again."); toast.success(ok); refresh(); };
  const draft = d.versions.find((v) => v.state === "draft");
  const approved = d.versions.find((v) => v.state === "approved");
  return (
    <section aria-label="Protocol" className="space-y-2 rounded-md border border-border bg-card p-3 text-[13px]" data-testid="protocol-panel">
      <p className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Protocol</span>
        {approved ? <StatusBadge state="active">v{approved.version} Approved{approved.by ? ` by ${approved.by}` : ""}</StatusBadge> : <StatusBadge state="neutral">No approved version: it can’t be run yet</StatusBadge>}
        {draft ? <StatusBadge state="draft">v{draft.version} Draft, waiting for approval</StatusBadge> : null}
        {d.needsTraining ? <span>Needs training · {d.trained ? "you’re Trained" : "you’re not trained yet"}</span> : null}
      </p>
      <span className="flex flex-wrap gap-2">
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(askApproveProtocolAction(orgId, docId), "Asked to approve")}>{draft ? "Update the draft to approve" : "Ask to approve"}</button>
        {draft && d.approver ? <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void run(approveProtocolAction(orgId, docId, draft.version, draft.created), `v${draft.version} approved`)}>Approve v{draft.version}</button> : null}
        {approved && d.approver ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void run(retireProtocolAction(orgId, docId, approved.version), `v${approved.version} retired`)}>Retire v{approved.version}</button> : null}
        {d.canEdit ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setEditing(!editing)}>{editing ? "Close training" : "Training"}</button> : null}
      </span>
      {approved && d.pageDraft ? <p role="status" className="text-muted-foreground">This page is still a draft, so only the PI and Researchers can run it. Publish the page from its menu so members can run it too.</p> : null}
      {draft && d.approver && draft.content ? (
        <details data-testid="protocol-draft-text"><summary className="cursor-pointer">Read v{draft.version} as it will be approved</summary>
          <pre className="mt-1 max-h-72 overflow-auto whitespace-pre-wrap rounded-sm bg-muted p-2 font-mono text-[12px]">{draft.content}</pre></details>
      ) : null}
      {d.versions.length ? (
        <details><summary className="cursor-pointer text-muted-foreground">All versions</summary>
          <ol className="mt-1 space-y-0.5">{d.versions.map((v) => <li key={v.id}>v{v.version} · {STATE_WORD[v.state]}{v.at ? ` · approved ${new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(v.at))}${v.by ? ` by ${v.by}` : ""}` : ""}</li>)}</ol>
        </details>
      ) : null}
      {editing && d.canEdit ? <TrainingSettings orgId={orgId} docId={docId} initial={{ needsTraining: d.needsTraining, trainers: d.trainers }} people={d.people} onSaved={refresh} /> : null}
      {d.canTrain && d.needsTraining ? (
        <div className="space-y-1" data-testid="protocol-trainings">
          <p className="font-medium">Trained</p>
          <ul className="space-y-1">{d.people.filter((p) => p.id !== d.me).map((p) => (
            <li key={p.id}><label className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={ticked[p.id] ?? p.trained} onChange={(e) => { const on = e.target.checked; setTicked((x) => ({ ...x, [p.id]: on }));
              void signOffTrainingAction(orgId, docId, p.id, on).catch(() => ({ success: false as const, error: "Couldn’t save that. Try again." })).then((r) => {
                if (!r.success) { toast.error(r.error); setTicked((x) => ({ ...x, [p.id]: !on })); return; }
                toast.success(on ? `${p.name} signed off` : "Sign-off removed"); refresh(); }); }} />
              {p.name}{p.trained && p.signedAt ? <span className="text-muted-foreground"> · {new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(p.signedAt))}{p.trainer ? ` by ${p.trainer}` : ""}</span> : null}</label></li>))}</ul>
        </div>
      ) : null}
    </section>
  );
}

function TrainingSettings({ orgId, docId, initial, people, onSaved }: { orgId: string; docId: string; initial: { needsTraining: boolean; trainers: string[] }; people: Array<{ id: string; name: string }>; onSaved: () => void }) {
  const [f, setF] = useState(initial);
  const save = async () => {
    const r = await saveProtocolSettingsAction(orgId, docId, f);
    if (!r.success) return void toast.error(r.error);
    toast.success("Training saved");
    onSaved();
  };
  return (
    <fieldset className="space-y-1.5 rounded-sm border border-border p-2" data-testid="protocol-training-settings">
      <legend className="px-1 font-medium">Training</legend>
      <label className="flex items-center gap-2"><input type="checkbox" className="nb-check" checked={f.needsTraining} onChange={(e) => setF({ ...f, needsTraining: e.target.checked })} />Needs training (running untrained only warns; equipment that needs it can’t be booked untrained)</label>
      {people.length ? <p className="text-muted-foreground">Trainers</p> : null}
      <ul className="flex flex-wrap gap-x-4 gap-y-1">{people.map((p) => (
        <li key={p.id}><label className="flex items-center gap-1.5"><input type="checkbox" className="nb-check" checked={f.trainers.includes(p.id)}
          onChange={(e) => setF({ ...f, trainers: e.target.checked ? [...f.trainers, p.id] : f.trainers.filter((x) => x !== p.id) })} />{p.name}</label></li>))}</ul>
      <button type="button" className={FORM_PRIMARY_CLASS} onClick={() => void save()}>Save training</button>
    </fieldset>
  );
}
