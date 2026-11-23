"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createElement, useState } from "react";

import { planContentAction, readContentAction, saveContentSettingsAction, starterContentSettingsAction } from "@/app/actions/content";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { channelIcon } from "@/components/workspaces/workflows/channel-icons";
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, SectionDivider, selectClassName, SelectWrap } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import type { ContentChannel, ContentSettings, Setup } from "@/lib/workflows/content";

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

/** S7: the piece's channels, publish time in the workspace's zone, type, keyword, audience and brief. */
export function ContentPanelSection({ projectId, taskId }: { projectId: string; taskId: string }) {
  const { data, query } = useContent(projectId);
  if (!data) return query.isLoading ? <div aria-hidden="true" className="nb-skeleton h-20 rounded-[6px]" /> : null;
  const piece = data.items.find((i) => i.id === taskId);
  if (!piece) return null;
  const f = piece.typeFields;
  const channels = (Array.isArray(f.channels) ? (f.channels as string[]) : []).map((c) => data.settings?.channels.find((x) => x.id === c)).filter(Boolean) as ContentChannel[];
  const type = data.settings?.types.find((t) => t.id === f.contentType);
  const when = typeof f.publishAt === "string" ? new Date(f.publishAt).toLocaleString(undefined, { timeZone: data.timeZone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : null;
  return (
    <div className="space-y-2 pt-1" data-testid="content-panel">
      <div className="border-b border-border/60 pb-2"><h3 className="text-xs font-semibold uppercase tracking-[0.06em] text-muted-foreground">Content details</h3></div>
      <dl className="grid grid-cols-[minmax(0,10rem)_1fr] gap-x-3 gap-y-1.5 text-[13px]">
        <dt className="text-muted-foreground">Channels</dt><dd className="flex flex-wrap gap-2">{channels.length ? channels.map((c) => <ChannelMark key={c.id} channel={c} />) : "—"}</dd>
        <dt className="text-muted-foreground">Publishes</dt><dd>{when ? `${when} (${data.timeZone})` : "No date yet"}</dd>
        <dt className="text-muted-foreground">Type</dt><dd>{type?.name ?? "—"}</dd>
        {f.keyword ? <><dt className="text-muted-foreground">Keyword</dt><dd>{String(f.keyword)}</dd></> : null}
        {f.audience ? <><dt className="text-muted-foreground">Audience</dt><dd>{String(f.audience)}</dd></> : null}
        {f.brief ? <><dt className="text-muted-foreground">Brief</dt><dd className="whitespace-pre-wrap">{String(f.brief)}</dd></> : null}
      </dl>
    </div>
  );
}
