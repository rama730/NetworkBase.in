"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useState } from "react";

import { acceptRequestAction, archiveRequestTypeAction, declineRequestAction, readRequestAction, readRequestTypesAction, saveRequestTypeAction } from "@/app/actions/requests";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, SectionDivider, selectClassName, SelectWrap } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { activeTypes, MAX_TYPES, QUESTION_KINDS, requestFooter, workingTime, type Question, type RequestType } from "@/lib/workflows/requests";

/** Report 38.7 S5–S7 and W2–W4, W9 (plan A2.4): the ask form's section, the panel's section, Accept, Decline, types. */
const KIND_LABEL: Record<Question["kind"], string> = { text: "Short text", long_text: "Long text", choice: "Choice", date: "Date", file: "Files" };
export const typesKey = (projectId: string) => [...queryKeys.project.detail.tasksRoot(projectId), "request-types"];

function useTypes(projectId: string) {
  const q = useQuery({ queryKey: typesKey(projectId), queryFn: () => readRequestTypesAction(projectId), staleTime: 30_000 });
  return q.data?.success ? q.data : null;
}

/** S6: Request type, then the type's questions in order; file questions take the module's files. */
export function RequestDetailsFields({ projectId }: { projectId: string }) {
  const data = useTypes(projectId);
  const [typeId, setTypeId] = useState("");
  const active = data?.active ?? [];
  const type = active.find((t) => t.id === typeId) ?? active[0];
  if (!data) return <div aria-hidden="true" className="nb-skeleton h-24 rounded-[6px]" />;
  if (!type) return <p className="text-[13px] text-muted-foreground">No request types yet. An owner or admin adds them in Requests → ⋯ → Request types.</p>;
  return (
    <div className="space-y-3.5" data-testid="request-details">
      <SectionDivider title="Request details" />
      <Field label="Request type" htmlFor="request-type">
        <SelectWrap>
          <select id="request-type" name="requestTypeId" value={type.id} onChange={(e) => setTypeId(e.target.value)} className={selectClassName()}>
            {active.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
        </SelectWrap>
      </Field>
      {type.questions.map((q) => {
        const fid = `request-answer-${q.id}`;
        const label = `${q.label}${q.required ? "" : " (optional)"}`;
        // The module's files answer the type's first file question.
        if (q.kind === "file") return <p key={q.id} className="text-xs text-muted-foreground">{label}: add them under Subtasks and files below.{q === type.questions.find((x) => x.kind === "file") ? <input type="hidden" name="fileQuestion" value={q.id} /> : null}</p>;
        return (
          <Field key={`${type.id}-${q.id}`} label={label} htmlFor={fid}>
            {q.kind === "long_text" ? <textarea id={fid} name={`answer:${q.id}`} required={q.required} rows={3} maxLength={5000} className={cn(inputClassName(false), "min-h-[72px] resize-none py-2")} />
              : q.kind === "choice" ? (
                <SelectWrap><select id={fid} name={`answer:${q.id}`} required={q.required} defaultValue="" className={selectClassName()}>
                  <option value="" disabled={q.required}>{q.required ? "Pick one…" : "None"}</option>
                  {q.options?.map((o) => <option key={o} value={o}>{o}</option>)}
                </select></SelectWrap>)
              : <input id={fid} name={`answer:${q.id}`} type={q.kind === "date" ? "date" : "text"} required={q.required} maxLength={5000} className={inputClassName(false)} />}
          </Field>
        );
      })}
      {requestFooter(type) ? <p className="text-xs text-muted-foreground" data-testid="request-times">Response times: {requestFooter(type)}</p> : null}
    </div>
  );
}

/** The module's form → type_fields: the type and its answers; the files picked in the module answer a file question. */
export function readRequestFields(form: FormData, attachmentIds: string[]) {
  const answers: Record<string, string | string[]> = {};
  for (const [k, v] of form.entries()) if (k.startsWith("answer:") && typeof v === "string" && v.trim()) answers[k.slice(7)] = v.trim();
  const typeId = String(form.get("requestTypeId") ?? "");
  const fileQuestion = String(form.get("fileQuestion") ?? "");
  if (fileQuestion && attachmentIds.length) answers[fileQuestion] = attachmentIds.slice(0, 10);
  return { ...(typeId ? { requestTypeId: typeId } : {}), answers };
}

/** S5: the request's type and answers, and why it was declined. */
export function RequestPanelSection({ projectId, taskId }: { projectId: string; taskId: string }) {
  const query = useQuery({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "request", taskId], queryFn: () => readRequestAction(projectId, taskId) });
  const data = query.data?.success ? query.data : null;
  if (!data) return query.isLoading ? <div aria-hidden="true" className="nb-skeleton h-20 rounded-[6px]" /> : null;
  const answers = (data.fields.answers ?? {}) as Record<string, unknown>;
  return (
    <div className="space-y-2 pt-1" data-testid="request-panel">
      <div className="border-b border-border/60 pb-2"><h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Request details</h3></div>
      <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-muted-foreground">Request type</dt><dd>{data.type?.name ?? "A removed type"}</dd>
        {(data.type?.questions ?? []).map((q) => {
          const v = answers[q.id];
          return [<dt key={`${q.id}-l`} className="text-muted-foreground">{q.label}</dt>,
            <dd key={`${q.id}-v`} className="whitespace-pre-wrap">{Array.isArray(v) ? `${v.length} ${v.length === 1 ? "file" : "files"}` : v ? String(v) : "—"}</dd>];
        })}
        {data.fields.declineReason ? <><dt className="text-muted-foreground">Declined because</dt><dd>{String(data.fields.declineReason)}</dd></> : null}
      </dl>
    </div>
  );
}

type Member = { id: string; label: string };

/** W4.2: Accept with who handles it (required) and, for owners and admins, the sprint. */
export function AcceptRequestDialog({ projectId, request, label, members, sprints, canPlanSprints, onDone }: {
  projectId: string; request: { id: string; title: string }; label: string; members: Member[]; sprints: Array<{ id: string; name: string; status?: string | null }>; canPlanSprints: boolean; onDone: (done: boolean) => void;
}) {
  const [assignee, setAssignee] = useState("");
  const open = sprints.filter((s) => s.status === "active" || s.status === "planning");
  const [sprint, setSprint] = useState(open.find((s) => s.status === "active")?.id ?? "");
  const [busy, setBusy] = useState(false);
  async function accept() {
    if (!assignee) return;
    setBusy(true);
    const r = await acceptRequestAction({ projectId, taskId: request.id, assigneeId: assignee, sprintId: canPlanSprints && sprint ? sprint : null });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast(`${label} accepted`);
    onDone(true);
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onDone(false); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="accept-request-dialog">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">Accept {label}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">{request.title}</DialogDescription>
        </div>
        <div className="space-y-3.5 px-6 py-4">
          <Field label="Assigned to" htmlFor="accept-assignee">
            <SelectWrap><select id="accept-assignee" value={assignee} onChange={(e) => setAssignee(e.target.value)} className={selectClassName()}>
              <option value="">Pick who handles it…</option>
              {members.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
            </select></SelectWrap>
          </Field>
          {canPlanSprints ? (
            <Field label="Sprint" htmlFor="accept-sprint">
              <SelectWrap><select id="accept-sprint" value={sprint} onChange={(e) => setSprint(e.target.value)} className={selectClassName()}>
                <option value="">Backlog</option>
                {open.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></SelectWrap>
            </Field>
          ) : <p className="text-xs text-muted-foreground">Goes to the Backlog · owners and admins plan sprints</p>}
          <p className="text-xs text-muted-foreground">It joins the Tasks board at Accepted.</p>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => onDone(false)}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !assignee} onClick={() => void accept()}>Accept</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** W4.3: Decline with a reason the asker sees. */
export function DeclineRequestDialog({ projectId, request, label, onDone }: { projectId: string; request: { id: string; title: string }; label: string; onDone: (done: boolean) => void }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  async function decline() {
    if (!reason.trim()) return;
    setBusy(true);
    const r = await declineRequestAction({ projectId, taskId: request.id, reason: reason.trim() });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast(`${label} declined`);
    onDone(true);
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onDone(false); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="decline-request-dialog">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">Decline {label}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">{request.title}</DialogDescription>
        </div>
        <div className="px-6 py-4">
          <Field label="Why? (the asker sees this)" htmlFor="decline-reason">
            <textarea id="decline-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000} className={cn(inputClassName(false), "resize-none py-2")} placeholder="Out of scope this month; ask again in January." />
          </Field>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => onDone(false)}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !reason.trim()} onClick={() => void decline()}>Decline</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const ICONS = ["Inbox", "Palette", "PenLine", "Wrench", "Megaphone", "FileText", "Laptop", "Scale"];
type Draft = Omit<RequestType, "id" | "archivedAt"> & { id?: string };
const blank = (): Draft => ({ name: "", icon: "Inbox", questions: [{ id: "q1", label: "What do you need?", kind: "text", required: true }], triagerIds: [], firstReplyMinutes: 240, deliverMinutes: null });
const asTime = (m: number | null) => (m === null ? { n: "", unit: "off" } : m % 480 === 0 ? { n: String(m / 480), unit: "days" } : { n: String(Math.round(m / 60)), unit: "hours" });
const toMinutes = (n: string, unit: string) => (unit === "off" || !Number(n) ? null : Math.round(Number(n) * (unit === "days" ? 480 : 60)));

/** W9 and S7: the list of types and one type's editor (owners and admins). */
export function RequestTypesDialog({ projectId, members, onClose }: { projectId: string; members: Member[]; onClose: () => void }) {
  const queryClient = useQueryClient();
  const data = useTypes(projectId);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: typesKey(projectId) });
  const types = data?.types ?? [];
  async function archive(t: RequestType, archived: boolean) {
    const r = await archiveRequestTypeAction({ projectId, typeId: t.id, archived });
    if (!r.success) return void toast.error(r.error);
    toast(archived ? `${t.name} archived · its requests stay` : `${t.name} is back on the ask form`);
    await refresh();
  }
  async function save() {
    if (!draft) return;
    setBusy(true);
    const r = await saveRequestTypeAction({ projectId, type: { ...draft, name: draft.name.trim() } });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast(`${draft.name.trim()} saved`);
    setDraft(null);
    await refresh();
  }
  const setQ = (i: number, q: Partial<Question>) => setDraft((d) => d && { ...d, questions: d.questions.map((x, j) => (j === i ? { ...x, ...q } as Question : x)) });
  const moveQ = (i: number, by: number) => setDraft((d) => {
    if (!d) return d;
    const qs = [...d.questions]; const [q] = qs.splice(i, 1); qs.splice(Math.max(0, Math.min(qs.length, i + by)), 0, q!);
    return { ...d, questions: qs };
  });
  const time = (key: "firstReplyMinutes" | "deliverMinutes", label: string) => {
    const t = asTime(draft![key]);
    return (
      <Field label={label} htmlFor={`type-${key}`}>
        <div className="flex gap-2">
          <input id={`type-${key}`} type="number" min={1} max={999} value={t.n} disabled={t.unit === "off"} aria-label={`${label}, number`}
            onChange={(e) => setDraft((d) => d && { ...d, [key]: toMinutes(e.target.value, t.unit === "off" ? "hours" : t.unit) })} className={cn(inputClassName(false), "w-20")} />
          <SelectWrap><select value={t.unit} aria-label={`${label}, unit`} onChange={(e) => setDraft((d) => d && { ...d, [key]: toMinutes(t.n || "1", e.target.value) })} className={selectClassName()}>
            <option value="hours">working hours</option><option value="days">working days</option><option value="off">Off</option>
          </select></SelectWrap>
        </div>
      </Field>
    );
  };
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={cn(FORM_DIALOG_CLASS, "max-h-[90vh] overflow-y-auto")} data-testid="request-types-dialog">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">{draft ? (draft.id ? `Edit ${draft.name || "type"}` : "New request type") : "Request types"}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">Each type has its questions and response times. Up to {MAX_TYPES} types, 5 questions each.</DialogDescription>
        </div>
        {!draft ? (
          <div className="divide-y divide-border px-6 py-2">
            {types.map((t) => (
              <div key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-[13px]" data-testid="request-type-row">
                <span className={cn("min-w-0 flex-1 font-medium", t.archivedAt && "text-muted-foreground line-through")}>{t.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{t.questions.length} q · {t.firstReplyMinutes ? workingTime(t.firstReplyMinutes) : "Off"} · {t.deliverMinutes ? workingTime(t.deliverMinutes) : "Off"}</span>
                {t.archivedAt ? <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void archive(t, false)}>Restore</button> : (
                  <>
                    <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDraft({ ...t })}>Edit</button>
                    <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => void archive(t, true)}>Archive</button>
                  </>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="space-y-3.5 px-6 py-4">
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-[1fr_10rem]">
              <Field label="Name" htmlFor="type-name"><input id="type-name" value={draft.name} maxLength={40} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={inputClassName(false)} /></Field>
              <Field label="Icon" htmlFor="type-icon"><SelectWrap><select id="type-icon" value={draft.icon} onChange={(e) => setDraft({ ...draft, icon: e.target.value })} className={selectClassName()}>
                {ICONS.map((i) => <option key={i} value={i}>{i}</option>)}
              </select></SelectWrap></Field>
            </div>
            <SectionDivider title="Questions" />
            {draft.questions.map((q, i) => (
              <div key={i} className="space-y-2 rounded-[6px] border border-border p-2.5" data-testid="type-question">
                <div className="flex flex-wrap items-center gap-2">
                  <input value={q.label} maxLength={120} aria-label={`Question ${i + 1}`} onChange={(e) => setQ(i, { label: e.target.value })} className={cn(inputClassName(false), "min-w-0 flex-1")} />
                  <SelectWrap><select value={q.kind} aria-label={`Question ${i + 1} kind`} onChange={(e) => setQ(i, { kind: e.target.value as Question["kind"], ...(e.target.value === "choice" && !q.options?.length ? { options: ["Option 1", "Option 2"] } : {}) })} className={selectClassName()}>
                    {QUESTION_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                  </select></SelectWrap>
                  <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" checked={q.required} onChange={(e) => setQ(i, { required: e.target.checked })} />Required</label>
                  <button type="button" aria-label="Move up" disabled={i === 0} onClick={() => moveQ(i, -1)} className="nb-touch-target inline-flex size-8 items-center justify-center rounded-[5px] hover:bg-muted disabled:opacity-40"><ArrowUp className="size-3.5" /></button>
                  <button type="button" aria-label="Move down" disabled={i === draft.questions.length - 1} onClick={() => moveQ(i, 1)} className="nb-touch-target inline-flex size-8 items-center justify-center rounded-[5px] hover:bg-muted disabled:opacity-40"><ArrowDown className="size-3.5" /></button>
                  <button type="button" aria-label="Delete question" onClick={() => setDraft({ ...draft, questions: draft.questions.filter((_, j) => j !== i) })} className="nb-touch-target inline-flex size-8 items-center justify-center rounded-[5px] hover:bg-muted"><Trash2 className="size-3.5" /></button>
                </div>
                {q.kind === "choice" ? (
                  <input value={(q.options ?? []).join(", ")} aria-label={`Question ${i + 1} options, comma-separated`} placeholder="Options, comma-separated"
                    onChange={(e) => setQ(i, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean).slice(0, 12) })} className={inputClassName(false)} />
                ) : null}
              </div>
            ))}
            {draft.questions.length < 5 ? (
              <button type="button" className={FORM_SECONDARY_CLASS} onClick={() => setDraft({ ...draft, questions: [...draft.questions, { id: `q${Date.now().toString(36)}`, label: "", kind: "text", required: false }] })}>Add a question</button>
            ) : null}
            <SectionDivider title="Response times" />
            <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">{time("firstReplyMinutes", "First reply within")}{time("deliverMinutes", "Deliver within")}</div>
            <SectionDivider title="Who triages" />
            <div className="flex flex-wrap gap-x-4 gap-y-1.5" role="group" aria-label="Who triages">
              {members.map((m) => (
                <label key={m.id} className="inline-flex items-center gap-1.5 text-[13px]">
                  <input type="checkbox" checked={draft.triagerIds.includes(m.id)} onChange={(e) => setDraft({ ...draft, triagerIds: e.target.checked ? [...draft.triagerIds, m.id] : draft.triagerIds.filter((x) => x !== m.id) })} />{m.label}
                </label>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">None ticked: owners and admins triage.</p>
          </div>
        )}
        <div className={FORM_FOOTER_CLASS}>
          {draft ? (
            <>
              <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => setDraft(null)}>Back</button>
              <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !draft.name.trim() || draft.questions.some((q) => !q.label.trim())} onClick={() => void save()}>Save type</button>
            </>
          ) : (
            <>
              <button type="button" className={FORM_SECONDARY_CLASS} onClick={onClose}>Done</button>
              <button type="button" className={FORM_PRIMARY_CLASS} disabled={activeTypes(types).length >= MAX_TYPES} onClick={() => setDraft(blank())}>New type</button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
