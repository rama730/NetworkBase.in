"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, CalendarDays, ChevronLeft, ChevronRight, Clapperboard, FileText, Gamepad2, Gavel, Handshake, MessagesSquare, Mic, MoreHorizontal, RotateCcw, Rocket, Siren, Target, Timer, type LucideIcon } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";

import { createMeetingAction, endSeriesAction, finishMeetingAction, moveMeetingAction, readDocRowsAction, readMeetingAction, readMeetingsAction } from "@/app/actions/workspace/doc";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, selectClassName, SelectWrap } from "@/components/workspaces/v2/tasks/form-parts";
import { WORKSPACE_DOC_LIST_QUERY_KEY, WORKSPACE_DOCS_QUERY_KEY } from "@/hooks/workspaces/useWorkspaceDocData";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { BoardPanel } from "@/components/workspaces/doc/DocBoard";
import { cn } from "@/lib/utils";
import { newMeetingFeedAction, readMeetingFeedAction, stopMeetingFeedAction } from "@/app/actions/meeting-feed";
import { defaultTitle, isNow, MEETING_TYPES, meetingMarkdown, meetingType, meetingWhen, monthGrid, nextOccurrence, REPEAT_LABEL, REPEAT_RULES, type RepeatRule } from "@/lib/workflows/meetings";
import { zonedInstant, zonedParts } from "@/lib/workflows/request-clock";
import { localDayKey } from "@/lib/workflows/planner";

/** Report 38.11 D1 S1, S2, S4, S6 (plan A4.1): New meeting, the meeting header, Finish, Edit this meeting, Open action items. */
const meetingsKey = (projectId: string) => [...queryKeys.project.detail.tasksRoot(projectId), "meetings"];
const meetingKey = (projectId: string, docSlug: string) => [...queryKeys.project.detail.tasksRoot(projectId), "meeting", docSlug];
const CHIP = "inline-flex h-5 items-center rounded-[3px] border border-border px-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";
const fileFor = (title: string, day: string) => `${title.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "meeting"}-${day}.md`;
const useMeetings = (projectId: string, enabled = true) => useQuery({ queryKey: meetingsKey(projectId), queryFn: () => readMeetingsAction(projectId), enabled, staleTime: 30_000 });

function useOpenDocAfter(projectId: string) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  return (slug: string) => {
    void Promise.all([
      queryClient.invalidateQueries({ queryKey: WORKSPACE_DOC_LIST_QUERY_KEY(projectId) }),
      queryClient.invalidateQueries({ queryKey: WORKSPACE_DOCS_QUERY_KEY(projectId) }),
      queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) }),
    ]);
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", "docs");
    params.set("doc", slug);
    params.delete("view");
    router.push(`${pathname}?${params.toString()}`, { scroll: false });
  };
}

/** S1: each meeting type's card icon. */
const TYPE_ICON: Record<string, LucideIcon> = { weekly: CalendarDays, standup: Timer, planning: Target, retro: RotateCcw, kickoff: Rocket, client: Handshake,
  recording: Mic, shoot: Clapperboard, interview: MessagesSquare, incident: Siren, playtest: Gamepad2, board: Gavel, blank: FileText };

/** S1 and W1: type, title, date and time (the workspace's zone), length, attendees, repeat. */
export function NewMeetingDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const query = useMeetings(projectId, open);
  const data = query.data?.success ? query.data : null;
  const tz = data?.timeZone ?? "UTC";
  const openDoc = useOpenDocAfter(projectId);
  const [type, setType] = useState(MEETING_TYPES[0]!.id);
  const [day, setDay] = useState(localDayKey());
  const [time, setTime] = useState("10:00");
  const [title, setTitle] = useState("");
  const [length, setLength] = useState(30);
  const [attendees, setAttendees] = useState<string[]>([]);
  const [repeat, setRepeat] = useState<"none" | RepeatRule>("none");
  const [boardSize, setBoardSize] = useState(5);
  const [busy, setBusy] = useState(false);
  // A4.16: only the types switched on in Settings → Meetings, and its default length.
  const shownTypes = MEETING_TYPES.filter((t) => !data?.settings || data.settings.types.includes(t.id));
  const settingsKey = data?.settings ? `${data.settings.types.join(",")}|${data.settings.lengthMinutes}` : "";
  useEffect(() => {
    if (!data?.settings) return;
    setLength(data.settings.lengthMinutes);
    setType((t) => (data.settings.types.includes(t) ? t : data.settings.types[0] ?? "blank"));
  }, [settingsKey]);
  const chosen = meetingType(type)!;
  const shownTitle = title.trim() || defaultTitle(chosen, day);
  async function create() {
    setBusy(true);
    try {
      const { createDocFile } = await import("@/components/organizations/OrgDocParts");
      const names = (data?.people ?? []).filter((p) => attendees.includes(p.id)).map((p) => p.name);
      const made = await createDocFile(projectId, fileFor(shownTitle, day), meetingMarkdown(chosen, shownTitle, names));
      const r = await createMeetingAction(projectId, { docSlug: made.slug, type, title: shownTitle, startsAt: zonedInstant(day, time, tz).toISOString(), lengthMinutes: length, attendeeIds: attendees, repeat, ...(type === "board" ? { boardSize } : {}) });
      if (!r.success) throw new Error(r.error);
      toast("Meeting made · attendees are told");
      onOpenChange(false);
      openDoc(made.slug);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t make the meeting");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="new-meeting-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">New meeting</DialogTitle><DialogDescription className="text-xs text-muted-foreground">A dated document with notes and action items. {data?.settings?.reminderMinutes === 0 ? "No reminders (Settings → Meetings)." : `Attendees get a reminder ${data?.settings?.reminderMinutes ?? 15} minutes before.`}</DialogDescription></div>
        <div className="max-h-[65vh] space-y-3.5 overflow-y-auto px-6 py-4">
          {/* S1: type cards with an icon and one line. */}
          <fieldset className="space-y-1.5">
            <legend className="text-[13px] font-medium">Type</legend>
            <div role="radiogroup" aria-label="Type" className="grid grid-cols-1 gap-1.5 sm:grid-cols-2" data-testid="meeting-types">
              {shownTypes.map((t) => {
                const Icon = TYPE_ICON[t.id] ?? FileText;
                const on = t.id === type;
                return (
                  <button key={t.id} type="button" role="radio" aria-checked={on} onClick={() => setType(t.id)}
                    className={cn("flex min-h-11 items-start gap-2 rounded-[6px] border px-2.5 py-2 text-left transition-colors", on ? "border-foreground bg-muted/60" : "border-border hover:bg-muted/40")}>
                    <Icon aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0"><span className="block text-[13px] font-medium text-foreground">{t.name}</span><span className="block text-[12px] text-muted-foreground">{t.line}</span></span>
                  </button>
                );
              })}
            </div>
          </fieldset>
          <Field label="Title" htmlFor="meeting-title"><input id="meeting-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={defaultTitle(chosen, day)} className={inputClassName(false)} /></Field>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
            <Field label="Date" htmlFor="meeting-day"><input id="meeting-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} className={cn(inputClassName(false), "font-mono")} /></Field>
            <Field label={`Time (${tz})`} htmlFor="meeting-time"><input id="meeting-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={cn(inputClassName(false), "font-mono")} /></Field>
            <Field label="Length" htmlFor="meeting-length"><SelectWrap><select id="meeting-length" value={length} onChange={(e) => setLength(Number(e.target.value))} className={selectClassName()}>
              {[15, 30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} minutes</option>)}
            </select></SelectWrap></Field>
          </div>
          <Field label="Repeat" htmlFor="meeting-repeat"><SelectWrap><select id="meeting-repeat" value={repeat} onChange={(e) => setRepeat(e.target.value as "none" | RepeatRule)} className={selectClassName()}>
            <option value="none">Doesn’t repeat</option>{REPEAT_RULES.map((r) => <option key={r} value={r}>{REPEAT_LABEL[r]}</option>)}
          </select></SelectWrap></Field>
          {type === "board" ? (
            <Field label="Board size" htmlFor="meeting-board-size" hint="Quorum is a majority of the board.">
              <input id="meeting-board-size" type="number" min={1} max={100} inputMode="numeric" value={boardSize} onChange={(e) => setBoardSize(Math.min(100, Math.max(1, Math.floor(Number(e.target.value) || 1))))} className={cn(inputClassName(false), "font-mono")} />
            </Field>
          ) : null}
          <fieldset className="space-y-1.5">
            <legend className="text-[13px] font-medium">Attendees</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2" data-testid="meeting-attendees">
              {(data?.people ?? []).map((p) => (
                <label key={p.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={attendees.includes(p.id)} onChange={(e) => setAttendees(e.target.checked ? [...attendees, p.id] : attendees.filter((a) => a !== p.id))} />{p.name}</label>
              ))}
            </div>
          </fieldset>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => onOpenChange(false)}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !day || !time} onClick={() => void create()}>{busy ? "Making the meeting…" : "Create"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** S2: CalendarClock · when (mono, with the zone) · type · attendees · series · Now · Finish meeting / Finished. */
export function MeetingHeader({ projectId, docSlug }: { projectId: string; docSlug: string }) {
  const queryClient = useQueryClient();
  const openDoc = useOpenDocAfter(projectId);
  const query = useQuery({ queryKey: meetingKey(projectId, docSlug), queryFn: () => readMeetingAction(projectId, docSlug), refetchInterval: 60_000 });
  // A4.1 live check: the open count shares the Action items list's data (same key), so adding or ticking a row shows here.
  const rows = useQuery({ queryKey: ["doc-rows", projectId, docSlug, "actions"], queryFn: () => readDocRowsAction(projectId, docSlug, "actions"), staleTime: 15_000 });
  const base = query.data?.success ? query.data : null;
  const data = base && rows.data?.success ? { ...base, openActionItems: rows.data.rows.filter((r) => r.status !== "done").length } : base;
  const [dialog, setDialog] = useState<"finish" | "move" | null>(null);
  const [busy, setBusy] = useState(false);
  if (!data) return query.isLoading ? <div aria-hidden="true" className="nb-skeleton mb-3 h-12 rounded-[8px]" /> : null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
  const now = data.startsAt ? isNow(data.startsAt, data.lengthMinutes, new Date()) : false;
  const type = meetingType(data.type) ?? MEETING_TYPES[0]!;
  async function finish(carryOver: boolean) {
    setBusy(true);
    try {
      let nextDocSlug: string | undefined, nextTitle: string | undefined;
      if (data!.seriesRule && data!.startsAt) {
        // The browser makes the next meeting's file (as New meeting does); the server files it and carries items.
        const at = nextOccurrence(data!.seriesRule as RepeatRule, data!.startsAt, data!.timeZone);
        const day = zonedParts(new Date(at), data!.timeZone).day;
        nextTitle = `${data!.seriesTitle ?? data!.title.split(" · ")[0]} · ${new Date(`${day}T00:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" })}`;
        const { createDocFile } = await import("@/components/organizations/OrgDocParts");
        nextDocSlug = (await createDocFile(projectId, fileFor(nextTitle, day), meetingMarkdown(type, nextTitle, data!.attendees.map((a) => a.name)))).slug;
      }
      const r = await finishMeetingAction(projectId, { docSlug, carryOver, ...(nextDocSlug ? { nextDocSlug, nextTitle } : {}) });
      if (!r.success) throw new Error(r.error);
      setDialog(null);
      await refresh();
      if (r.next) { toast(`Finished · next meeting made${r.next.carried ? `, ${r.next.carried} action ${r.next.carried === 1 ? "item" : "items"} carried over` : ""}`); openDoc(r.next.docSlug); }
      else toast("Finished");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t finish the meeting");
    } finally {
      setBusy(false);
    }
  }
  async function run<T extends { success: boolean; error?: string }>(p: Promise<T>, done: string) {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.success) return void toast.error(r.error ?? "Couldn’t change the meeting");
    toast(done);
    setDialog(null);
    await refresh();
  }
  return (
    <section aria-label="Meeting" className="mb-4 space-y-2 rounded-[8px] border border-border bg-card p-3" data-testid="meeting-header">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <CalendarClock aria-hidden="true" className="size-4 text-muted-foreground" />
        {data.startsAt ? <span className="font-mono text-[12px]" data-testid="meeting-when">{meetingWhen(data.startsAt, data.lengthMinutes, data.timeZone)}</span> : null}
        <span className={CHIP}>{type.name}</span>
        {data.seriesRule ? <span className={CHIP}>{REPEAT_LABEL[data.seriesRule as RepeatRule]}</span> : null}
        {now && !data.finishedAt ? <span className="inline-flex h-5 items-center rounded-[3px] bg-primary px-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-primary-foreground">Now</span> : null}
        {data.finishedAt ? <span className={CHIP}>Finished</span> : null}
        <div className="ml-auto flex items-center gap-2">
          {data.canEdit && !data.finishedAt ? <button type="button" className={now ? FORM_PRIMARY_CLASS : FORM_SECONDARY_CLASS} disabled={busy} onClick={() => setDialog("finish")}>Finish meeting</button> : null}
          {data.canEdit && !data.finishedAt ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button type="button" aria-label="Meeting actions" className="nb-touch-target inline-flex size-8 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted"><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setDialog("move")}>Edit this meeting…</DropdownMenuItem>
                {data.seriesRule ? <DropdownMenuItem onSelect={() => void run(endSeriesAction(projectId, { docSlug }), "The series ends after this meeting")}>End the series</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
      {data.member ? (
        <p className="text-[12px] text-muted-foreground" data-testid="meeting-attendees-line">
          {data.attendees.length ? `Attendees: ${data.attendees.map((a) => a.name).join(", ")}` : "No attendees yet"} · <span className="font-mono">{data.openActionItems}</span> open action {data.openActionItems === 1 ? "item" : "items"}
        </p>
      ) : null}
      {"board" in data && data.board ? <BoardPanel projectId={projectId} docSlug={docSlug} title={data.title} board={data.board} attendees={data.attendees} canEdit={data.canEdit} onOpenDoc={openDoc} /> : null}
      {dialog === "finish" ? <FinishDialog openItems={data.openActionItems} next={data.seriesRule && data.startsAt ? meetingWhen(nextOccurrence(data.seriesRule as RepeatRule, data.startsAt, data.timeZone), data.lengthMinutes, data.timeZone) : null}
        busy={busy} onClose={() => setDialog(null)} onFinish={(carry) => void finish(carry)} /> : null}
      {dialog === "move" && data.startsAt ? <MoveMeetingDialog startsAt={data.startsAt} timeZone={data.timeZone} busy={busy} onClose={() => setDialog(null)}
        onSave={(startsAt) => void run(moveMeetingAction(projectId, { docSlug, startsAt }), "Meeting moved")} /> : null}
    </section>
  );
}

function FinishDialog({ openItems, next, busy, onClose, onFinish }: { openItems: number; next: string | null; busy: boolean; onClose: () => void; onFinish: (carryOver: boolean) => void }) {
  const [carry, setCarry] = useState(true);
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="finish-meeting-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">Finish meeting</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">{next ? `The next meeting is ${next}.` : "This meeting doesn’t repeat."}</DialogDescription></div>
        <div className="px-6 py-4 text-[13px]">
          {next && openItems ? <label className="flex items-center gap-2"><input type="checkbox" checked={carry} onChange={(e) => setCarry(e.target.checked)} />{openItems} action {openItems === 1 ? "item is" : "items are"} open: carry them to the next meeting</label>
            : <p className="text-muted-foreground">{openItems ? `${openItems} action ${openItems === 1 ? "item stays" : "items stay"} open on the Tasks board.` : "No open action items."}</p>}
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Not yet</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => onFinish(carry)}>{busy ? "Finishing…" : "Finish"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MoveMeetingDialog({ startsAt, timeZone, busy, onClose, onSave }: { startsAt: string; timeZone: string; busy: boolean; onClose: () => void; onSave: (startsAt: string) => void }) {
  const parts = zonedParts(new Date(startsAt), timeZone);
  const [day, setDay] = useState(parts.day);
  const [time, setTime] = useState(parts.time);
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="move-meeting-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">Edit this meeting</DialogTitle><DialogDescription className="text-xs text-muted-foreground">Only this meeting moves; the series keeps its time.</DialogDescription></div>
        <div className="grid grid-cols-2 gap-3.5 px-6 py-4">
          <Field label="Date" htmlFor="move-meeting-day"><input id="move-meeting-day" type="date" value={day} onChange={(e) => setDay(e.target.value)} className={cn(inputClassName(false), "font-mono")} /></Field>
          <Field label={`Time (${timeZone})`} htmlFor="move-meeting-time"><input id="move-meeting-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} className={cn(inputClassName(false), "font-mono")} /></Field>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !day || !time} onClick={() => onSave(zonedInstant(day, time, timeZone).toISOString())}>Move</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** S6 and W9: every open action item across meetings (title, assigned to, due, meeting). */
export function OpenActionItems({ projectId, projectSlug }: { projectId: string; projectSlug: string }) {
  const query = useMeetings(projectId);
  const data = query.data?.success ? query.data : null;
  if (!data) return query.isLoading ? <div aria-hidden="true" className="nb-skeleton h-24 rounded-[8px]" /> : null;
  const taskHref = (id: string) => `/workspaces/${encodeURIComponent(projectSlug)}?${new URLSearchParams({ tab: "tasks", drawerType: "task", drawerId: id }).toString()}`;
  const docHref = (slug: string) => `/workspaces/${encodeURIComponent(projectSlug)}?tab=docs&doc=${encodeURIComponent(slug)}`;
  const cell = "px-3 py-2";
  return (
    <section aria-label="Open action items" className="space-y-2" data-testid="open-action-items">
      <h2 className="text-[16px] font-semibold">Open action items <span className="font-mono text-[12px] font-normal text-muted-foreground">{data.openActionItems.length}</span></h2>
      {data.openActionItems.length ? (
        <div className="overflow-x-auto rounded-[8px] border border-border bg-card">
          <table className="w-full min-w-[520px] text-left text-[13px]">
            <caption className="sr-only">Open action items from every meeting</caption>
            <thead className="border-b border-border text-[12px] text-muted-foreground"><tr><th scope="col" className={cell}>Item</th><th scope="col" className={cell}>Assigned to</th><th scope="col" className={cell}>Due</th><th scope="col" className={cell}>Meeting</th></tr></thead>
            <tbody className="divide-y divide-border">
              {data.openActionItems.map((r) => (
                <tr key={r.id} data-testid="open-action-row">
                  <td className={cell}><a href={taskHref(r.id)} className="font-medium hover:underline">{r.title}</a></td>
                  <td className={cell}>{r.assigneeName ?? "—"}</td>
                  <td className={cn(cell, "font-mono text-[12px]")}>{r.dueDate ?? "—"}</td>
                  <td className={cell}>{r.meeting ? <a href={docHref(r.meeting.slug)} className="hover:underline">{r.meeting.title}</a> : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="py-6 text-center text-[13px] text-muted-foreground">No open action items. Items added in meetings show here until they’re done.</p>}
    </section>
  );
}

/** S7 and W10 (A4.1b): the Meetings calendar (meetings on their days, in the workspace's zone) and your .ics link. */
export function MeetingsCalendar({ projectId, projectSlug, canAdd, onNew }: { projectId: string; projectSlug: string; canAdd: boolean; onNew: () => void }) {
  const query = useMeetings(projectId);
  const data = query.data?.success ? query.data : null;
  const [month, setMonth] = useState(() => localDayKey().slice(0, 7));
  const shift = (n: number) => { const [y, m] = month.split("-").map(Number) as [number, number]; const d = new Date(Date.UTC(y, m - 1 + n, 1)); setMonth(d.toISOString().slice(0, 7)); };
  if (!data) return query.isLoading ? <div aria-hidden="true" className="nb-skeleton h-64 rounded-[8px]" /> : null;
  const today = localDayKey();
  const days = monthGrid(month, data.meetings, data.timeZone);
  const docHref = (slug: string) => `/workspaces/${encodeURIComponent(projectSlug)}?tab=docs&doc=${encodeURIComponent(slug)}`;
  const label = new Date(`${month}-01T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return (
    <section aria-label="Meetings calendar" className="space-y-3" data-testid="meetings-calendar">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="mr-2 text-[16px] font-semibold">Meetings</h2>
        <button type="button" aria-label="Previous month" onClick={() => shift(-1)} className="nb-touch-target inline-flex size-[30px] items-center justify-center rounded-[5px] border border-border bg-card hover:bg-muted"><ChevronLeft className="size-4" /></button>
        <span className="min-w-32 text-center text-[13px] font-medium" aria-live="polite">{label}</span>
        <button type="button" aria-label="Next month" onClick={() => shift(1)} className="nb-touch-target inline-flex size-[30px] items-center justify-center rounded-[5px] border border-border bg-card hover:bg-muted"><ChevronRight className="size-4" /></button>
        <button type="button" onClick={() => setMonth(today.slice(0, 7))} className={FORM_SECONDARY_CLASS}>Today</button>
        <div className="ml-auto flex items-center gap-2">{canAdd ? <button type="button" onClick={onNew} className={FORM_PRIMARY_CLASS}>New meeting</button> : null}</div>
      </div>
      <div className="grid grid-cols-7 overflow-hidden rounded-[8px] border border-border bg-card text-[12px] max-sm:hidden" role="group" aria-label={`Meetings in ${label}`}>
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <div key={d} aria-hidden="true" className="border-b border-border px-2 py-1.5 font-mono text-[11px] text-muted-foreground">{d}</div>)}
        {days.map((d) => (
          <div key={d.day} role="group" aria-label={new Date(`${d.day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}
            className={cn("min-h-20 space-y-1 border-b border-r border-border/60 p-1.5", !d.inMonth && "bg-muted/30 text-muted-foreground")}>
            <span className={cn("font-mono text-[11px]", d.day === today && "font-semibold text-primary")}>{Number(d.day.slice(8))}</span>
            {d.meetings.map((m) => (
              <a key={m.docId} href={docHref(m.slug)} data-testid="calendar-meeting" className={cn("block truncate rounded-[3px] border border-border px-1 py-0.5 hover:bg-muted", m.finished && "text-muted-foreground")}>
                <span className="font-mono">{m.time}</span> {m.title}
              </a>
            ))}
          </div>
        ))}
      </div>
      {/* Phone: the month as a list by date (W11). */}
      <ul className="space-y-1 sm:hidden" aria-label={`Meetings in ${label}`}>
        {days.filter((d) => d.inMonth && d.meetings.length).flatMap((d) => d.meetings.map((m) => (
          <li key={m.docId}><a href={docHref(m.slug)} className="flex gap-2 rounded-[5px] border border-border bg-card px-2 py-1.5 text-[13px]"><span className="font-mono text-[12px] text-muted-foreground">{d.day.slice(5)} {m.time}</span>{m.title}</a></li>
        )))}
      </ul>
      <p className="text-xs text-muted-foreground">Times in {data.timeZone}.</p>
      <FeedLink />
    </section>
  );
}

/** W10 and call 7: your personal, read-only .ics link (shown once; a new one stops the old). */
function FeedLink() {
  const query = useQuery({ queryKey: queryKeys.myWork.meetingFeed(), queryFn: () => readMeetingFeedAction() });
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const has = query.data?.success && query.data.hasLink;
  async function make() {
    setBusy(true);
    const r = await newMeetingFeedAction();
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    const url = `${window.location.origin}${r.path}`;
    setLink(url);
    const { copyText } = await import("@/lib/clipboard");
    try { await copyText(url); toast("Calendar link copied · add it to your calendar app as a subscription"); } catch { toast("Copy the link below into your calendar app"); }
    void query.refetch();
  }
  async function stop() {
    setBusy(true);
    const r = await stopMeetingFeedAction();
    setBusy(false);
    if (!r.success) return void toast.error(r.error);
    setLink(null);
    toast("Calendar link stopped");
    void query.refetch();
  }
  return (
    <div className="space-y-1.5 rounded-[8px] border border-border bg-card p-3" data-testid="meeting-feed">
      <p className="text-[13px] font-medium">Your calendar link</p>
      <p className="text-xs text-muted-foreground">Meetings you attend, in any calendar app that subscribes to a link. Times and titles only; read-only.{has && !link ? " A link is on; making a new one stops the old." : ""}</p>
      {link ? <input readOnly value={link} aria-label="Your calendar link" onFocus={(e) => e.currentTarget.select()} className={cn(inputClassName(false), "font-mono text-[12px]")} /> : null}
      <div className="flex gap-2">
        <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => void make()}>{has ? "New link" : "Get my link"}</button>
        {has ? <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => void stop()}>Stop the link</button> : null}
      </div>
    </div>
  );
}
