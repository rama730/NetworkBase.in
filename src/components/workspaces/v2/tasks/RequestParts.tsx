"use client";

import { timeZoneOptions } from "@/lib/organizations/zoned-time";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { useState } from "react";

import { acceptRequestAction, answerSolvedAction, archiveRequestTypeAction, declineRequestAction, deliverRequestAction, readRequestAction, readRequestTypesAction, resumeRequestAction, saveRequestTypeAction, saveWorkingHoursAction, setWaitingAction } from "@/app/actions/requests";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, SectionDivider, selectClassName, SelectWrap } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { clockText, hoursLine, type WorkingHours } from "@/lib/workflows/request-clock";
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

/**
 * S5: the request's type and answers, the clock, Waiting on and Resume, Deliver, and Did this solve it? for the asker
 * (A2.6). Why it was declined, when it was.
 */
export function RequestPanelSection({ projectId, taskId }: { projectId: string; taskId: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "request", taskId], queryFn: () => readRequestAction(projectId, taskId) });
  const data = query.data?.success ? query.data : null;
  const [dialog, setDialog] = useState<"wait" | "deliver" | "no" | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return query.isLoading ? <div aria-hidden="true" className="nb-skeleton h-20 rounded-[6px]" /> : null;
  const answers = (data.fields.answers ?? {}) as Record<string, unknown>;
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
  const working = ["accepted", "in_progress", "in_review"].includes(data.stage ?? "");
  const waiting = Boolean(data.waitingName);
  const delivered = data.fields.delivered as { kind?: string; ref?: string } | null | undefined;
  async function run(p: Promise<{ success: boolean; error?: string }>, done: string) {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.success) return void toast.error(r.error ?? "Couldn’t update the request");
    toast(done);
    setDialog(null);
    await refresh();
  }
  const clockWords = data.clock && data.clock.state !== "off" ? clockText(data.clock, data.clock.kind === "first" ? "Replied" : "Delivered") : null;
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
        {clockWords ? <><dt className="text-muted-foreground">{data.clock!.kind === "first" ? "First reply" : "Deliver"}</dt><dd className="font-mono text-[12px]" data-testid="request-panel-clock">{waiting ? `Waiting on ${data.waitingName} · ` : ""}{clockWords}</dd></> : null}
        {!clockWords && waiting ? <><dt className="text-muted-foreground">Waiting on</dt><dd data-testid="request-panel-waiting">{data.waitingName} · paused</dd></> : null}
        {delivered?.ref ? <><dt className="text-muted-foreground">What was delivered</dt><dd><a href={delivered.ref} target="_blank" rel="noreferrer" className="break-all text-primary hover:underline">{delivered.ref}</a></dd></> : null}
        {data.fields.solved ? <><dt className="text-muted-foreground">Did this solve it?</dt><dd>{data.fields.solved === "yes" ? "Yes" : "No · reopened"}</dd></> : null}
        {data.fields.declineReason ? <><dt className="text-muted-foreground">Declined because</dt><dd>{String(data.fields.declineReason)}</dd></> : null}
      </dl>
      {data.canTriage && working ? (
        <div className="flex flex-wrap gap-1.5" data-testid="request-panel-actions">
          {waiting
            ? <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => void run(resumeRequestAction({ projectId, taskId }), "Clock running again")}>Resume</button>
            : <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => setDialog("wait")}>Waiting on…</button>}
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => setDialog("deliver")}>Deliver…</button>
        </div>
      ) : null}
      {data.mine && data.stage === "delivered" && !data.fields.solved ? (
        <div className="flex flex-wrap items-center gap-1.5 rounded-[6px] border border-border bg-muted/40 p-2.5" data-testid="request-solved">
          <span className="mr-auto text-[13px] font-medium">Did this solve it?</span>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => void run(answerSolvedAction({ projectId, taskId, solved: "yes" }), "Thanks · marked solved")}>Yes</button>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => setDialog("no")}>No</button>
        </div>
      ) : null}
      {dialog === "wait" ? <WaitDialog people={data.people} busy={busy} onClose={() => setDialog(null)}
        onSave={(onUserId, question) => void run(setWaitingAction({ projectId, taskId, onUserId, question }), "Question sent · clock paused")} /> : null}
      {dialog === "deliver" ? <TextDialog title="Deliver" label="What was delivered (a link, optional)" placeholder="https://…" optional busy={busy} action="Deliver" onClose={() => setDialog(null)}
        onSave={(link) => void run(deliverRequestAction({ projectId, taskId, ...(link ? { link } : {}) }), "Delivered · the asker is asked if it solved it")} /> : null}
      {dialog === "no" ? <TextDialog title="Not solved yet" label="What’s still missing?" placeholder="The dark version too" busy={busy} action="Reopen" onClose={() => setDialog(null)}
        onSave={(note) => void run(answerSolvedAction({ projectId, taskId, solved: "no", note }), "Reopened · the handler is told")} /> : null}
    </div>
  );
}

function WaitDialog({ people, busy, onClose, onSave }: { people: Array<{ id: string; name: string }>; busy: boolean; onClose: () => void; onSave: (onUserId: string, question: string) => void }) {
  const [who, setWho] = useState(people[0]?.id ?? "");
  const [question, setQuestion] = useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="wait-dialog">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">Waiting on someone</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">Your question goes to them as a comment. The clock pauses until they reply.</DialogDescription>
        </div>
        <div className="space-y-3.5 px-6 py-4">
          <Field label="Waiting on" htmlFor="wait-who"><SelectWrap><select id="wait-who" value={who} onChange={(e) => setWho(e.target.value)} className={selectClassName()}>
            {people.map((p, i) => <option key={p.id} value={p.id}>{p.name}{i === 0 ? " (asked)" : ""}</option>)}
          </select></SelectWrap></Field>
          <Field label="Your question" htmlFor="wait-question"><textarea id="wait-question" value={question} onChange={(e) => setQuestion(e.target.value)} rows={3} maxLength={2000} className={cn(inputClassName(false), "resize-none py-2")} placeholder="Which logo should it use?" /></Field>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !who || !question.trim()} onClick={() => onSave(who, question.trim())}>Ask and pause</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function TextDialog({ title, label, placeholder, optional = false, busy, action, onClose, onSave }: {
  title: string; label: string; placeholder: string; optional?: boolean; busy: boolean; action: string; onClose: () => void; onSave: (text: string) => void;
}) {
  const [text, setText] = useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="request-text-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">{title}</DialogTitle><DialogDescription className="sr-only">{label}</DialogDescription></div>
        <div className="px-6 py-4">
          <Field label={label} htmlFor="request-text"><textarea id="request-text" value={text} onChange={(e) => setText(e.target.value)} rows={2} maxLength={2000} className={cn(inputClassName(false), "resize-none py-2")} placeholder={placeholder} /></Field>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || (!optional && !text.trim())} onClick={() => onSave(text.trim())}>{action}</button>
        </div>
      </DialogContent>
    </Dialog>
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
          <input id={`type-${key}`} type="number" min={1} max={t.unit === "days" ? 30 : 240} value={t.n} disabled={t.unit === "off"} aria-label={`${label}, number`}
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

const DAYS = [{ n: 1, label: "Mon" }, { n: 2, label: "Tue" }, { n: 3, label: "Wed" }, { n: 4, label: "Thu" }, { n: 5, label: "Fri" }, { n: 6, label: "Sat" }, { n: 7, label: "Sun" }];

/** W10 and S8: days, from and to, the time zone and holidays; saving recalculates every open clock. */
export function WorkingHoursDialog({ projectId, hours, timeZone, onClose }: { projectId: string; hours: WorkingHours; timeZone: string | null; onClose: (saved: boolean) => void }) {
  const zones = timeZoneOptions(timeZone);
  const [draft, setDraft] = useState<WorkingHours>(hours);
  const [zone, setZone] = useState(timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [holiday, setHoliday] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    const r = await saveWorkingHoursAction({ projectId, hours: draft, timeZone: zone });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast("Working hours saved · open clocks are being recalculated");
    onClose(true);
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(false); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="working-hours-dialog">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">Working hours</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">Response times count only these hours. Changing them recalculates every open clock from its start.</DialogDescription>
        </div>
        <div className="space-y-3.5 px-6 py-4">
          <div role="group" aria-label="Days" className="flex flex-wrap gap-1.5">
            {DAYS.map((d) => {
              const on = draft.days.includes(d.n);
              return <button key={d.n} type="button" aria-pressed={on} onClick={() => setDraft({ ...draft, days: on ? draft.days.filter((x) => x !== d.n) : [...draft.days, d.n].sort() })}
                className={cn("h-8 min-w-11 rounded-[5px] border px-2 text-xs font-medium", on ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-muted")}>{d.label}</button>;
            })}
          </div>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="From" htmlFor="hours-from"><input id="hours-from" type="time" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} className={inputClassName(false)} /></Field>
            <Field label="To" htmlFor="hours-to"><input id="hours-to" type="time" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} className={inputClassName(false)} /></Field>
          </div>
          <Field label="Time zone" htmlFor="hours-zone">
            <SelectWrap><select id="hours-zone" value={zone} onChange={(e) => setZone(e.target.value)} className={selectClassName()}>
              {(zones.includes(zone) ? zones : [zone, ...zones]).map((z) => <option key={z} value={z}>{z}</option>)}
            </select></SelectWrap>
          </Field>
          <Field label="Holidays (optional)" htmlFor="hours-holiday">
            <div className="flex gap-2">
              <input id="hours-holiday" type="date" value={holiday} onChange={(e) => setHoliday(e.target.value)} className={inputClassName(false)} />
              <button type="button" className={FORM_SECONDARY_CLASS} disabled={!holiday || draft.holidays.includes(holiday)}
                onClick={() => { setDraft({ ...draft, holidays: [...draft.holidays, holiday].sort() }); setHoliday(""); }}>Add</button>
            </div>
          </Field>
          {draft.holidays.length ? (
            <ul className="flex flex-wrap gap-1.5" aria-label="Holidays">
              {draft.holidays.map((h) => (
                <li key={h} className="inline-flex h-7 items-center gap-1 rounded-[5px] border border-border px-2 font-mono text-[11px]">{h}
                  <button type="button" aria-label={`Remove ${h}`} className="text-muted-foreground hover:text-foreground" onClick={() => setDraft({ ...draft, holidays: draft.holidays.filter((x) => x !== h) })}>×</button>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs text-muted-foreground" data-testid="hours-preview">{hoursLine(draft, zone)}</p>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => onClose(false)}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !draft.days.length || draft.from >= draft.to} onClick={() => void save()}>Save</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
