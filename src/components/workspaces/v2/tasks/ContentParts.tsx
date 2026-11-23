"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createElement, useState } from "react";

import { approveContentAction, changesNeededAction, linkContentDraftAction, markPublishedAction, planContentAction, readContentAction, readRecentUpdatesAction, readyForEditAction, saveContentSettingsAction, saveResultsAction, starterContentSettingsAction } from "@/app/actions/content";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { channelIcon } from "@/components/workspaces/workflows/channel-icons";
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, SectionDivider, selectClassName, SelectWrap } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { performanceRows, postsPerWeek as postsPerWeekFor, type ChannelResults, type ContentChannel, type ContentSettings, type Setup } from "@/lib/workflows/content";

/** Report 38.8 W1–W4, S7, S10 (plan A2.7): the setup and channels editor, the New module's section, Plan, the panel. */
export const contentKey = (projectId: string) => [...queryKeys.project.detail.tasksRoot(projectId), "content"];
export const useContent = (projectId: string) => {
  const q = useQuery({ queryKey: contentKey(projectId), queryFn: () => readContentAction(projectId), refetchInterval: 30_000 });
  return { query: q, data: q.data?.success ? q.data : null };
};

export function ChannelMark({ channel, withName = true }: { channel: Pick<ContentChannel, "icon" | "name">; withName?: boolean }) {
  return <span className="inline-flex items-center gap-1" title={channel.name}>{createElement(channelIcon(channel.icon), { "aria-hidden": true, className: "size-3 shrink-0" })}{withName ? <span>{channel.name}</span> : <span className="sr-only">{channel.name}</span>}</span>;
}

/** W1 and S10: Blog and Social, then the channels (audience typed, Blog on Updates), add your own; types' checklists. */
export function ContentSettingsEditor({ projectId, current, onDone, inline = false }: { projectId: string; current: ContentSettings | null; onDone: (saved: boolean) => void; inline?: boolean }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState<ContentSettings | null>(current);
  const [own, setOwn] = useState("");
  const [busy, setBusy] = useState(false);
  async function pick(setups: Setup[]) {
    if (!setups.length) return setDraft(null);
    const r = await starterContentSettingsAction(setups);
    if (!r.success) return void toast.error(r.error);
    // Keep channels already chosen or added; add the new setup's ones.
    setDraft((d) => d ? { ...r.settings, channels: [...d.channels, ...r.settings.channels.filter((c) => !d.channels.some((x) => x.id === c.id))], types: [...d.types, ...r.settings.types.filter((t) => !d.types.some((x) => x.id === t.id))], defaultTime: d.defaultTime } : r.settings);
  }
  const setups = draft?.setups ?? [];
  const toggleSetup = (s: Setup) => void pick(setups.includes(s) ? setups.filter((x) => x !== s) : [...setups, s]);
  const setChannel = (id: string, patch: Partial<ContentChannel>) => setDraft((d) => d && { ...d, channels: d.channels.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  function addOwn() {
    const name = own.trim();
    if (!name || !draft) return;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "channel";
    const id = draft.channels.some((c) => c.id === slug) ? `${slug}-${draft.channels.length}` : slug;
    setDraft({ ...draft, channels: [...draft.channels, { id, name: name.slice(0, 40), icon: "Globe", audience: null, updates: false, archived: false }] });
    setOwn("");
  }
  async function save() {
    if (!draft) return;
    setBusy(true);
    const r = await saveContentSettingsAction({ projectId, settings: draft });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast("Channels saved");
    await queryClient.invalidateQueries({ queryKey: contentKey(projectId) });
    onDone(true);
  }
  const body = (
    <div className="space-y-3.5" data-testid="content-settings">
      <div role="group" aria-label="What you publish" className="flex flex-wrap gap-1.5">
        {(["blog", "social"] as const).map((s) => (
          <button key={s} type="button" aria-pressed={setups.includes(s)} onClick={() => toggleSetup(s)}
            className={cn("h-8 rounded-[5px] border px-3 text-xs font-medium", setups.includes(s) ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-muted")}>{s === "blog" ? "Blog" : "Social"}</button>
        ))}
      </div>
      {draft ? (
        <>
          <SectionDivider title="Pick your channels" />
          <div className="space-y-2">
            {draft.channels.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]" data-testid="content-channel-row">
                <label className="inline-flex min-w-36 items-center gap-1.5"><input type="checkbox" checked={!c.archived} onChange={(e) => setChannel(c.id, { archived: !e.target.checked })} /><ChannelMark channel={c} /></label>
                <input type="number" min={0} value={c.audience ?? ""} placeholder="Audience" aria-label={`${c.name} audience`} onChange={(e) => setChannel(c.id, { audience: e.target.value === "" ? null : Math.max(0, Math.floor(Number(e.target.value))) })} className={cn(inputClassName(false), "h-8 w-28")} />
                {c.id === "blog" || c.updates ? <label className="inline-flex items-center gap-1.5 text-xs"><input type="checkbox" checked={c.updates} onChange={(e) => setChannel(c.id, { updates: e.target.checked })} />Posts on NetworkBase Updates</label> : null}
              </div>
            ))}
            <div className="flex gap-2">
              <input value={own} onChange={(e) => setOwn(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addOwn(); } }} placeholder="Add your own (e.g. Podcast feed)" aria-label="Add your own channel" maxLength={40} className={cn(inputClassName(false), "h-8")} />
              <button type="button" className={FORM_SECONDARY_CLASS} disabled={!own.trim()} onClick={addOwn}>Add</button>
            </div>
          </div>
          <SectionDivider title="Types and checklists" />
          <div className="space-y-2">
            {draft.types.map((t) => (
              <div key={t.id} className="grid grid-cols-[8rem_1fr] items-center gap-2 text-[13px]">
                <span className="font-medium">{t.name}</span>
                <input value={t.checklist.join(", ")} aria-label={`${t.name} checklist, comma-separated`} placeholder="Checklist steps, comma-separated" className={cn(inputClassName(false), "h-8")}
                  onChange={(e) => setDraft({ ...draft, types: draft.types.map((x) => (x.id === t.id ? { ...x, checklist: e.target.value.split(",").map((v) => v.trim()).filter(Boolean).slice(0, 10) } : x)) })} />
              </div>
            ))}
          </div>
          <Field label="Default publish time" htmlFor="content-default-time">
            <input id="content-default-time" type="time" value={draft.defaultTime} onChange={(e) => setDraft({ ...draft, defaultTime: e.target.value || "10:00" })} className={cn(inputClassName(false), "w-32")} />
          </Field>
        </>
      ) : <p className="text-[13px] text-muted-foreground">Pick Blog, Social or both to see their channels.</p>}
    </div>
  );
  const footer = (
    <div className={inline ? "flex justify-end gap-2 pt-2" : FORM_FOOTER_CLASS}>
      {inline ? null : <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => onDone(false)}>Cancel</button>}
      <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !draft || !draft.channels.some((c) => !c.archived)} onClick={() => void save()}>Save channels</button>
    </div>
  );
  if (inline) return <div className="rounded-[8px] border border-border bg-card p-4">{body}{footer}</div>;
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onDone(false); }}>
      <DialogContent showCloseButton={false} className={cn(FORM_DIALOG_CLASS, "max-h-[90vh] overflow-y-auto")} data-testid="content-settings-dialog">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">Channels and types</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">Turning a channel off keeps its pieces and links.</DialogDescription>
        </div>
        <div className="px-6 py-4">{body}</div>
        {footer}
      </DialogContent>
    </Dialog>
  );
}

/** W4.2 and S6 of the New module: channels, type, format, keyword, audience, brief, and the publish time. */
export function ContentDetailsFields({ projectId, initialChannels = [], publishDay = null }: { projectId: string; initialChannels?: string[]; publishDay?: string | null }) {
  const { data } = useContent(projectId);
  const [picked, setPicked] = useState<string[]>(initialChannels);
  const [time, setTime] = useState<string | null>(null);
  if (!data) return <div aria-hidden="true" className="nb-skeleton h-24 rounded-[6px]" />;
  if (!data.settings) return <p className="text-[13px] text-muted-foreground">An owner or admin sets up Content’s channels first.</p>;
  const live = data.settings.channels.filter((c) => !c.archived);
  return (
    <div className="space-y-3.5" data-testid="content-details">
      <SectionDivider title="Content details" />
      <div role="group" aria-label="Channels" className="flex flex-wrap gap-1.5">
        {live.map((c) => {
          const on = picked.includes(c.id);
          return <button key={c.id} type="button" aria-pressed={on} onClick={() => setPicked(on ? picked.filter((x) => x !== c.id) : [...picked, c.id])}
            className={cn("inline-flex h-8 items-center rounded-[5px] border px-2.5 text-xs font-medium", on ? "border-primary bg-primary/10" : "border-border text-muted-foreground hover:bg-muted")}><ChannelMark channel={c} /></button>;
        })}
      </div>
      {picked.map((c) => <input key={c} type="hidden" name="contentChannel" value={c} />)}
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Field label="Type" htmlFor="content-type">
          <SelectWrap><select id="content-type" name="contentType" defaultValue="" className={selectClassName()}>
            <option value="">None</option>
            {data.settings.types.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select></SelectWrap>
        </Field>
        <Field label={`Publish time (${data.timeZone})`} htmlFor="content-time">
          <input id="content-time" name="contentTime" type="time" value={time ?? data.settings.defaultTime} onChange={(e) => setTime(e.target.value)} className={inputClassName(false)} />
        </Field>
        <Field label="Keyword (optional)" htmlFor="content-keyword"><input id="content-keyword" name="contentKeyword" maxLength={120} className={inputClassName(false)} /></Field>
        <Field label="Audience (optional)" htmlFor="content-audience"><input id="content-audience" name="contentAudience" maxLength={120} className={inputClassName(false)} /></Field>
      </div>
      {/* W4.3: when it publishes, in words. */}
      <p className="text-xs text-muted-foreground" data-testid="content-publishes">{publishDay
        ? `Publishes ${new Date(`${publishDay.slice(0, 10)}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })} at ${time ?? data.settings.defaultTime} (${data.timeZone})`
        : "No publish date yet: it waits in To schedule."}</p>
      <Field label="Brief (optional)" htmlFor="content-brief"><textarea id="content-brief" name="contentBrief" rows={2} maxLength={5000} className={cn(inputClassName(false), "resize-none py-2")} /></Field>
    </div>
  );
}

/** The module's form → type_fields. The server makes the publish time from the Publish date and this time (call 7). */
export function readContentFields(form: FormData, dueDate: string | null) {
  const text = (k: string) => String(form.get(k) ?? "").trim();
  return {
    channels: form.getAll("contentChannel").map(String),
    ...(text("contentType") ? { contentType: text("contentType") } : {}),
    ...(text("contentKeyword") ? { keyword: text("contentKeyword") } : {}),
    ...(text("contentAudience") ? { audience: text("contentAudience") } : {}),
    ...(text("contentBrief") ? { brief: text("contentBrief") } : {}),
    ...(dueDate && text("contentTime") ? { publishTime: text("contentTime") } : {}),
  };
}

/** W3.2 and W10: plan a piece onto a day: the day, the time, and the sprint for owners and admins (members: Backlog). */
export function PlanContentDialog({ projectId, piece, day: initialDay, defaultTime, timeZone, sprints, canPlanSprints, onDone }: {
  projectId: string; piece: { id: string; title: string; stage: string | null }; day: string | null; defaultTime: string; timeZone: string;
  sprints: Array<{ id: string; name: string; status?: string | null }>; canPlanSprints: boolean; onDone: (done: boolean) => void;
}) {
  const [day, setDay] = useState(initialDay ?? "");
  const [time, setTime] = useState(defaultTime);
  const open = sprints.filter((s) => s.status === "active" || s.status === "planning");
  const [sprint, setSprint] = useState(open.find((s) => s.status === "active")?.id ?? "");
  const [busy, setBusy] = useState(false);
  const joins = piece.stage === "idea";
  async function plan() {
    if (!day) return;
    setBusy(true);
    const r = await planContentAction({ projectId, taskId: piece.id, day, time, sprintId: joins && canPlanSprints && sprint ? sprint : null });
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    toast(joins ? `${piece.title} is in Drafting` : `${piece.title} moved`);
    onDone(true);
  }
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onDone(false); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="plan-content-dialog">
        <div className="border-b border-border px-6 py-4">
          <DialogTitle className="text-base font-semibold">{joins ? "Plan this idea" : "Set the publish date"}</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">{piece.title}</DialogDescription>
        </div>
        <div className="space-y-3.5 px-6 py-4">
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="Publish date" htmlFor="plan-day"><input id="plan-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} className={inputClassName(false)} /></Field>
            <Field label={`Time (${timeZone})`} htmlFor="plan-time"><input id="plan-time" type="time" value={time} onChange={(e) => setTime(e.target.value || defaultTime)} className={inputClassName(false)} /></Field>
          </div>
          {joins ? (canPlanSprints ? (
            <Field label="Sprint" htmlFor="plan-sprint"><SelectWrap><select id="plan-sprint" value={sprint} onChange={(e) => setSprint(e.target.value)} className={selectClassName()}>
              <option value="">Backlog</option>{open.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select></SelectWrap></Field>
          ) : <p className="text-xs text-muted-foreground">Goes to the Backlog · owners and admins plan sprints</p>) : null}
          {joins ? <p className="text-xs text-muted-foreground">It joins the Tasks board at Drafting, with you as the writer.</p> : null}
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => onDone(false)}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !day} onClick={() => void plan()}>{joins ? "Plan" : "Save"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * S7: the piece's channels, publish time in the workspace's zone, type, keyword, audience and brief; and A2.8's
 * Write draft, Ready for edit, the editor's Approve / Changes needed, Mark published and what was published where.
 */
export function ContentPanelSection({ projectId, taskId }: { projectId: string; taskId: string }) {
  const queryClient = useQueryClient();
  const { data, query } = useContent(projectId);
  const [dialog, setDialog] = useState<"edit" | "changes" | "publish" | "results" | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return query.isLoading ? <div aria-hidden="true" className="nb-skeleton h-20 rounded-[6px]" /> : null;
  const piece = data.items.find((i) => i.id === taskId);
  if (!piece) return null;
  const f = piece.typeFields;
  const channels = (Array.isArray(f.channels) ? (f.channels as string[]) : []).map((c) => data.settings?.channels.find((x) => x.id === c)).filter(Boolean) as ContentChannel[];
  const type = data.settings?.types.find((t) => t.id === f.contentType);
  const when = typeof f.publishAt === "string" ? new Date(f.publishAt).toLocaleString(undefined, { timeZone: data.timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  const published = (f.published ?? {}) as Record<string, { link?: string; updateId?: string }>;
  const editor = data.people.find((p) => p.id === f.editorId);
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
  async function run(p: Promise<{ success: boolean; error?: string }>, done: string) {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.success) return void toast.error(r.error ?? "Couldn’t update the piece");
    toast(done);
    setDialog(null);
    await refresh();
  }
  async function writeDraft() {
    setBusy(true);
    try {
      const { createDocFile } = await import("@/components/organizations/OrgDocParts");
      const slug = piece!.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "draft";
      const made = await createDocFile(projectId, `${slug}.md`, `# ${piece!.title}\n\n${f.brief ? `> ${String(f.brief)}\n\n` : ""}`);
      const r = await linkContentDraftAction({ projectId, taskId, docId: made.id, slug: made.slug });
      if (!r.success) return void toast.error(r.error);
      toast("Draft made · it’s in Documents");
      await refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t make the draft");
    } finally {
      setBusy(false);
    }
  }
  const isEditor = f.editorId === data.viewerId || data.canManage;
  return (
    <div className="space-y-2 pt-1" data-testid="content-panel">
      <div className="border-b border-border/60 pb-2"><h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Content details</h3></div>
      <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-muted-foreground">Channels</dt><dd className="flex flex-wrap gap-2">{channels.length ? channels.map((c) => <ChannelMark key={c.id} channel={c} />) : "—"}</dd>
        <dt className="text-muted-foreground">Publishes</dt><dd>{when ? `${when} (${data.timeZone})` : "No date yet"}</dd>
        <dt className="text-muted-foreground">Type</dt><dd>{type?.name ?? "—"}</dd>
        {f.draftSlug ? <><dt className="text-muted-foreground">Draft</dt><dd><a href={`/workspaces/${encodeURIComponent(projectId)}?tab=docs&doc=${encodeURIComponent(String(f.draftSlug))}`} className="text-primary hover:underline">Open the draft</a></dd></> : null}
        {editor ? <><dt className="text-muted-foreground">Editor</dt><dd>{editor.name}</dd></> : null}
        {f.keyword ? <><dt className="text-muted-foreground">Keyword</dt><dd>{String(f.keyword)}</dd></> : null}
        {f.audience ? <><dt className="text-muted-foreground">Audience</dt><dd>{String(f.audience)}</dd></> : null}
        {f.brief ? <><dt className="text-muted-foreground">Brief</dt><dd className="whitespace-pre-wrap">{String(f.brief)}</dd></> : null}
        {Object.keys(published).length ? <><dt className="text-muted-foreground">Published at</dt><dd className="space-y-0.5" data-testid="content-published">
          {channels.map((c) => <p key={c.id} className="flex items-center gap-1.5"><ChannelMark channel={c} />{published[c.id]?.link ? <a href={published[c.id]!.link} target="_blank" rel="noreferrer" className="truncate text-primary hover:underline">{published[c.id]!.link}</a> : published[c.id]?.updateId ? <span>an Update here</span> : <span className="text-muted-foreground">not yet</span>}</p>)}
        </dd></> : null}
        {(() => {
          // W8 (A2.9): Results per published channel; an Update's likes and comments are live (call 3).
          const rows = performanceRows([piece]);
          if (!rows.length) return null;
          const n = (v: number | null) => (v == null ? "—" : v.toLocaleString());
          return <><dt className="text-muted-foreground">Results</dt><dd className="space-y-0.5" data-testid="content-results">
            {rows.map((r) => { const c = channels.find((x) => x.id === r.channel); return (
              <p key={r.channel} className="flex flex-wrap items-center gap-x-2">{c ? <ChannelMark channel={c} /> : r.channel}
                <span className="font-mono text-[12px] text-muted-foreground">{n(r.views)} views · {n(r.likes)} likes · {n(r.comments)} comments · {n(r.clicks)} clicks</span></p>
            ); })}
          </dd></>;
        })()}
      </dl>
      {data.canEdit ? (
        <div className="flex flex-wrap gap-1.5" data-testid="content-panel-actions">
          {piece.stage === "drafting" && !f.draftSlug ? <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => void writeDraft()}>Write draft</button> : null}
          {piece.stage === "drafting" ? <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => setDialog("edit")}>Ready for edit…</button> : null}
          {piece.stage === "editing" && isEditor ? <>
            <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => void run(approveContentAction({ projectId, taskId }), "Approved · Scheduled")}>Approve</button>
            <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => setDialog("changes")}>Changes needed…</button>
          </> : null}
          {piece.stage === "editing" && !isEditor ? <p className="text-xs text-muted-foreground">With {editor?.name ?? "the editor"} for edit</p> : null}
          {piece.stage === "scheduled" || piece.stage === "published" ? <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => setDialog("publish")}>Mark published…</button> : null}
          {channels.some((c) => published[c.id]?.link) ? <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => setDialog("results")}>Results…</button> : null}
        </div>
      ) : null}
      {data.canEdit && (piece.stage === "scheduled" || piece.stage === "published") && !f.results ? (
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <input type="checkbox" checked={f.resultsReminder !== false} disabled={busy} onChange={(e) => void run(saveResultsAction({ projectId, taskId, reminder: e.target.checked }), e.target.checked ? "You’ll be reminded" : "No results reminder")} />
          Remind the writer to add results a week after publishing
        </label>
      ) : null}
      {dialog === "edit" ? <EditorDialog people={data.people.filter((p) => p.id !== piece.assigneeId || data.canManage)} busy={busy} onClose={() => setDialog(null)}
        onSave={(editorId, note) => void run(readyForEditAction({ projectId, taskId, editorId, ...(note ? { note } : {}) }), "Sent for edit")} /> : null}
      {dialog === "changes" ? <NoteDialog title="Changes needed" label="What needs changing?" action="Send back" busy={busy} onClose={() => setDialog(null)}
        onSave={(note) => void run(changesNeededAction({ projectId, taskId, note }), "Sent back to Drafting")} /> : null}
      {dialog === "publish" ? <PublishDialog projectId={projectId} channels={channels} published={published} busy={busy} onClose={() => setDialog(null)}
        onSave={(links) => void run(markPublishedAction({ projectId, taskId, links }), "Marked published")} /> : null}
      {dialog === "results" ? <ResultsDialog channels={channels.filter((c) => published[c.id]?.link)} current={(f.results ?? {}) as Record<string, ChannelResults>} busy={busy} onClose={() => setDialog(null)}
        onSave={(results) => void run(saveResultsAction({ projectId, taskId, results }), "Results saved")} /> : null}
    </div>
  );
}

function EditorDialog({ people, busy, onClose, onSave }: { people: Array<{ id: string; name: string }>; busy: boolean; onClose: () => void; onSave: (editorId: string, note: string) => void }) {
  const [editor, setEditor] = useState("");
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="ready-for-edit-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">Ready for edit</DialogTitle><DialogDescription className="text-xs text-muted-foreground">The editor approves it to Scheduled or sends it back with a note.</DialogDescription></div>
        <div className="space-y-3.5 px-6 py-4">
          <Field label="Editor" htmlFor="edit-editor"><SelectWrap><select id="edit-editor" value={editor} onChange={(e) => setEditor(e.target.value)} className={selectClassName()}>
            <option value="">Pick the editor…</option>{people.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></SelectWrap></Field>
          <Field label="Note (optional)" htmlFor="edit-note"><textarea id="edit-note" value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={2000} className={cn(inputClassName(false), "resize-none py-2")} /></Field>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !editor} onClick={() => onSave(editor, note.trim())}>Send for edit</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function NoteDialog({ title, label, action, busy, onClose, onSave }: { title: string; label: string; action: string; busy: boolean; onClose: () => void; onSave: (note: string) => void }) {
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="content-note-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">{title}</DialogTitle><DialogDescription className="sr-only">{label}</DialogDescription></div>
        <div className="px-6 py-4"><Field label={label} htmlFor="content-note"><textarea id="content-note" value={note} onChange={(e) => setNote(e.target.value)} rows={3} maxLength={2000} className={cn(inputClassName(false), "resize-none py-2")} /></Field></div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !note.trim()} onClick={() => onSave(note.trim())}>{action}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** W7.2–7.3: a link per channel (http or https; NetworkBase never opens it), or an Update for an Updates channel. */
function PublishDialog({ projectId, channels, published, busy, onClose, onSave }: {
  projectId: string; channels: ContentChannel[]; published: Record<string, { link?: string; updateId?: string }>; busy: boolean; onClose: () => void;
  onSave: (links: Record<string, { link: string } | { updateId: string }>) => void;
}) {
  const updates = useQuery({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "recent-updates"], queryFn: () => readRecentUpdatesAction(projectId), enabled: channels.some((c) => c.updates) });
  const [values, setValues] = useState<Record<string, string>>(() => Object.fromEntries(channels.map((c) => [c.id, published[c.id]?.link ?? published[c.id]?.updateId ?? ""])));
  const filled = Object.entries(values).filter(([id, v]) => v.trim() && !published[id]);
  const send = () => onSave(Object.fromEntries(filled.map(([id, v]) => [id, channels.find((c) => c.id === id)?.updates && !/^https?:/i.test(v) ? { updateId: v } : { link: v.trim() }])));
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="mark-published-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">Mark published</DialogTitle><DialogDescription className="text-xs text-muted-foreground">Post it yourself, then add where it went. Channels can be marked later.</DialogDescription></div>
        <div className="space-y-3 px-6 py-4">
          {channels.map((c) => (
            <Field key={c.id} label={c.name} htmlFor={`publish-${c.id}`}>
              {c.updates ? (
                <SelectWrap><select id={`publish-${c.id}`} value={values[c.id] ?? ""} disabled={Boolean(published[c.id])} onChange={(e) => setValues({ ...values, [c.id]: e.target.value })} className={selectClassName()}>
                  <option value="">Pick the Update you posted…</option>
                  {(updates.data?.success ? updates.data.updates : []).map((u) => <option key={u.id} value={u.id}>{u.text}</option>)}
                </select></SelectWrap>
              ) : <input id={`publish-${c.id}`} value={values[c.id] ?? ""} disabled={Boolean(published[c.id])} onChange={(e) => setValues({ ...values, [c.id]: e.target.value })} placeholder="https://…" className={inputClassName(false)} />}
            </Field>
          ))}
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !filled.length} onClick={send}>Mark published</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const METRICS = ["views", "likes", "comments", "clicks"] as const;
/** W8.2 and S8: four optional numbers per published channel (an Updates channel fills its own). */
function ResultsDialog({ channels, current, busy, onClose, onSave }: {
  channels: ContentChannel[]; current: Record<string, ChannelResults>; busy: boolean; onClose: () => void; onSave: (results: Record<string, ChannelResults>) => void;
}) {
  const [values, setValues] = useState<Record<string, Record<string, string>>>(() => Object.fromEntries(channels.map((c) => [c.id, Object.fromEntries(METRICS.map((m) => [m, current[c.id]?.[m] != null ? String(current[c.id]![m]) : ""]))])));
  const bad = Object.values(values).some((v) => Object.values(v).some((x) => x.trim() && !/^\d{1,12}$/.test(x.trim())));
  const send = () => onSave(Object.fromEntries(channels.map((c) => [c.id, Object.fromEntries(METRICS.map((m) => [m, values[c.id]![m]!.trim() ? Number(values[c.id]![m]) : null]))])));
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="results-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">Results</DialogTitle><DialogDescription className="text-xs text-muted-foreground">Type what each channel shows. Every number is optional.</DialogDescription></div>
        <div className="space-y-4 px-6 py-4">
          {channels.map((c) => (
            <fieldset key={c.id} className="space-y-1.5">
              <legend className="text-[13px] font-medium"><ChannelMark channel={c} /></legend>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {METRICS.map((m) => (
                  <Field key={m} label={m[0]!.toUpperCase() + m.slice(1)} htmlFor={`results-${c.id}-${m}`}>
                    <input id={`results-${c.id}-${m}`} inputMode="numeric" value={values[c.id]![m]} onChange={(e) => setValues({ ...values, [c.id]: { ...values[c.id]!, [m]: e.target.value } })} className={cn(inputClassName(false), "font-mono")} />
                  </Field>
                ))}
              </div>
            </fieldset>
          ))}
          {bad ? <p className="text-xs text-destructive">Results are whole numbers, 0 or more.</p> : null}
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || bad} onClick={send}>Save results</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const CHART = ["var(--chart-1)", "var(--chart-2)", "var(--chart-3)", "var(--chart-4)", "var(--chart-5)", "var(--muted-foreground)"];
type SortKey = "title" | "channel" | "at" | "views" | "likes" | "comments" | "clicks";
/**
 * S9 (A2.9): Performance. A table of every published channel (column sort) and a posts-per-week chart by channel (plain
 * stacked bars with a count on each week, legend with icons and names; the table is the readable version). Covers the tab's read: pieces published in the last 60 days.
 */
export function ContentPerformance({ items, channels, timeZone, thisMonday, href }: {
  items: Parameters<typeof performanceRows>[0]; channels: ContentChannel[]; timeZone: string; thisMonday: string; href: (id: string) => string;
}) {
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "at", desc: true });
  const rows = performanceRows(items);
  const name = (id: string) => channels.find((c) => c.id === id)?.name ?? id;
  const sorted = [...rows].sort((a, b) => {
    const x = sort.key === "channel" ? name(a.channel) : a[sort.key], y = sort.key === "channel" ? name(b.channel) : b[sort.key];
    const c = x == null ? (y == null ? 0 : -1) : y == null ? 1 : typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
    return sort.desc ? -c : c;
  });
  const weeks = postsPerWeekFor(rows, timeZone, thisMonday);
  const used = channels.filter((c) => rows.some((r) => r.channel === c.id));
  const max = Math.max(1, ...weeks.map((w) => Object.values(w.counts).reduce((a, b) => a + b, 0)));
  if (!rows.length) return <p className="py-8 text-center text-[13px] text-muted-foreground" data-testid="content-performance">Results show here once pieces are published.</p>;
  const head = (key: SortKey, label: string, num = false) => (
    <th scope="col" aria-sort={sort.key === key ? (sort.desc ? "descending" : "ascending") : "none"} className={cn("px-3 py-2 font-medium", num && "text-right")}>
      <button type="button" className="hover:underline" onClick={() => setSort({ key, desc: sort.key === key ? !sort.desc : num || key === "at" })}>{label}{sort.key === key ? (sort.desc ? " ↓" : " ↑") : ""}</button>
    </th>
  );
  const n = (v: number | null) => (v == null ? "—" : v.toLocaleString());
  return (
    <div className="space-y-4" data-testid="content-performance">
      <figure className="space-y-2 rounded-[8px] border border-border bg-card p-3">
        <figcaption className="text-[13px] font-semibold">Posts per week</figcaption>
        <div className="flex h-40 items-end gap-2" role="img" aria-label={`Posts per week by channel, last ${weeks.length} weeks`}>
          {weeks.map((w) => {
            const total = Object.values(w.counts).reduce((x, y) => x + y, 0);
            return (
              <div key={w.week} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
                {total ? <span className="font-mono text-[11px] text-muted-foreground">{total}</span> : null}
                <div className="flex w-full max-w-10 flex-col-reverse overflow-hidden rounded-[3px]" style={{ height: `${(total / max) * 80}%` }}>
                  {used.map((c, ci) => (w.counts[c.id] ? <div key={c.id} title={`${c.name}: ${w.counts[c.id]} in the week of ${w.week}`} style={{ height: `${(w.counts[c.id]! / total) * 100}%`, background: CHART[ci % CHART.length] }} /> : null))}
                </div>
                <span className="truncate font-mono text-[10px] text-muted-foreground">{new Date(`${w.week}T00:00:00`).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
              </div>
            );
          })}
        </div>
        <ul className="flex flex-wrap gap-3 text-[12px]" aria-label="Channels">
          {used.map((c, ci) => <li key={c.id} className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="size-2.5 rounded-[2px]" style={{ background: CHART[ci % CHART.length] }} /><ChannelMark channel={c} /></li>)}
        </ul>
      </figure>
      <div className="overflow-x-auto rounded-[8px] border border-border bg-card">
        <table className="w-full min-w-[640px] text-left text-[13px]">
          <caption className="sr-only">Results by piece and channel</caption>
          <thead className="border-b border-border text-[12px] text-muted-foreground"><tr>
            {head("title", "Piece")}{head("channel", "Channel")}{head("at", "Published")}{head("views", "Views", true)}{head("likes", "Likes", true)}{head("comments", "Comments", true)}{head("clicks", "Clicks", true)}
          </tr></thead>
          <tbody className="divide-y divide-border">
            {sorted.map((r) => { const c = channels.find((x) => x.id === r.channel); return (
              <tr key={`${r.taskId}:${r.channel}`} data-testid="performance-row">
                <td className="px-3 py-2"><a href={href(r.taskId)} className="font-medium hover:underline">{r.title}</a></td>
                <td className="px-3 py-2">{c ? <ChannelMark channel={c} /> : r.channel}</td>
                <td className="px-3 py-2 font-mono text-[12px]">{new Date(r.at).toLocaleDateString(undefined, { timeZone, day: "numeric", month: "short" })}</td>
                {(["views", "likes", "comments", "clicks"] as const).map((m) => <td key={m} className="px-3 py-2 text-right font-mono text-[12px]">{n(r[m])}</td>)}
              </tr>
            ); })}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-muted-foreground">Pieces published in the last 60 days. An Update’s likes and comments are live; everything else is typed in Results.</p>
    </div>
  );
}
