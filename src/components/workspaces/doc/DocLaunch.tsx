"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Rocket } from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { readRoadmapAction } from "@/app/actions/roadmap";
import { cancelLaunchAction, closeLaunchAction, createLaunchAction, launchAction, moveLaunchDateAction, readLaunchAction, setLaunchShipsAction } from "@/app/actions/workspace/doc";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName, selectClassName, SelectWrap } from "@/components/workspaces/v2/tasks/form-parts";
import { useAddedWorkflows } from "@/components/workspaces/workflows/useWorkspaceWorkflows";
import { WORKSPACE_DOC_LIST_QUERY_KEY, WORKSPACE_DOCS_QUERY_KEY } from "@/hooks/workspaces/useWorkspaceDocData";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { closeSuggested, countdown, LAUNCH_PRESETS, LAUNCH_STAGE_LABEL, launchMarkdown, launchPreset, type LaunchStage } from "@/lib/workflows/launches";
import { localDayKey } from "@/lib/workflows/planner";

/** Report 38.10 D2 S1–S7 (plan A3.1): the New launch sheet, the launch header, Ships and What's new, and its dialogs. */
const launchKey = (projectId: string, docSlug: string) => [...queryKeys.project.detail.tasksRoot(projectId), "launch", docSlug];
const BADGE = "inline-flex h-5 items-center rounded-[3px] border border-border px-1.5 font-mono text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";
const docFile = (name: string) => `${name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "launch"}.md`;

/** S7 and W1: name, date, preset (with its stages), version label; makes the document and its steps. */
export function NewLaunchDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [date, setDate] = useState("");
  const [preset, setPreset] = useState(LAUNCH_PRESETS[0]!.id);
  const [version, setVersion] = useState("");
  const [busy, setBusy] = useState(false);
  const chosen = launchPreset(preset)!;
  async function create() {
    setBusy(true);
    try {
      const { createDocFile } = await import("@/components/organizations/OrgDocParts");
      const made = await createDocFile(projectId, docFile(name), launchMarkdown(chosen, name.trim()));
      const r = await createLaunchAction(projectId, { docSlug: made.slug, date, preset, title: name.trim(), ...(version.trim() ? { versionLabel: version.trim() } : {}) });
      if (!r.success) throw new Error(r.error);
      // A3 live check: refresh the document lists and task data only (refetching every query took ~25 s).
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: WORKSPACE_DOC_LIST_QUERY_KEY(projectId) }),
        queryClient.invalidateQueries({ queryKey: WORKSPACE_DOCS_QUERY_KEY(projectId) }),
        queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) }),
      ]);
      const params = new URLSearchParams(searchParams?.toString() ?? "");
      params.set("tab", "docs");
      params.set("doc", made.slug);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
      toast("Launch made · its steps are in the checklist");
      onOpenChange(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn’t make the launch");
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="new-launch-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">New launch</DialogTitle><DialogDescription className="text-xs text-muted-foreground">A document with a checklist; every step is a task.</DialogDescription></div>
        <div className="space-y-3.5 px-6 py-4">
          <Field label="Name" htmlFor="launch-name"><input id="launch-name" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} placeholder="v2.4: Faster sign-in" className={inputClassName(false)} /></Field>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Field label="Launch date" htmlFor="launch-date"><input id="launch-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(inputClassName(false), "font-mono")} /></Field>
            <Field label="Version (optional)" htmlFor="launch-version"><input id="launch-version" value={version} onChange={(e) => setVersion(e.target.value)} maxLength={40} placeholder="v2.4" className={cn(inputClassName(false), "font-mono")} /></Field>
          </div>
          <Field label="Preset" htmlFor="launch-preset"><SelectWrap><select id="launch-preset" value={preset} onChange={(e) => setPreset(e.target.value)} className={selectClassName()}>
            {LAUNCH_PRESETS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></SelectWrap></Field>
          <p className="text-xs text-muted-foreground" data-testid="launch-preset-preview">Stages: {chosen.stages.map((s) => s.name).join(" · ")} · {chosen.stages.reduce((n, s) => n + s.steps.length, 0)} steps, unassigned and undated</p>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => onOpenChange(false)}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !name.trim() || !date} onClick={() => void create()}>{busy ? `Making ${chosen.stages.reduce((n, s) => n + s.steps.length, 0)} steps…` : "Create"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** S1–S4: the launch header above the document, with Ships and What's new. */
export function LaunchHeader({ projectId, docSlug }: { projectId: string; docSlug: string }) {
  const queryClient = useQueryClient();
  const roadmapAdded = useAddedWorkflows().includes("roadmap");
  const query = useQuery({ queryKey: launchKey(projectId, docSlug), queryFn: () => readLaunchAction(projectId, docSlug), refetchInterval: 30_000 });
  const data = query.data?.success ? query.data : null;
  const [dialog, setDialog] = useState<"launch" | "close" | "date" | "cancel" | null>(null);
  const [busy, setBusy] = useState(false);
  const items = useQuery({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "roadmap"], queryFn: () => readRoadmapAction(projectId), enabled: roadmapAdded && Boolean(data?.canEdit) });
  if (!data) return query.isLoading ? <div aria-hidden="true" className="nb-skeleton mb-3 h-16 rounded-[8px]" /> : null;
  const refresh = () => queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
  async function run<T extends { success: boolean; error?: string }>(p: Promise<T>, done: string) {
    setBusy(true);
    const r = await p;
    setBusy(false);
    if (!r.success) { toast.error(r.error ?? "Couldn’t change the launch"); return null; }
    toast(done);
    setDialog(null);
    await refresh();
    return r;
  }
  const stage = data.stage as LaunchStage;
  const open = stage === "planning" || stage === "getting_ready";
  const pct = data.progress.total ? Math.round((100 * data.progress.done) / data.progress.total) : 0;
  const shippable = (items.data?.success ? items.data.items : []).filter((i) => i.stage !== "launched" && i.stage !== "wont_do" && !data.ships.some((s) => s.id === i.id) && !i.typeFields.launchDocId);
  return (
    <section aria-label="Launch" className="mb-4 space-y-3 rounded-[8px] border border-border bg-card p-3" data-testid="launch-header">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Rocket aria-hidden="true" className="size-4 text-muted-foreground" />
        {data.date ? <span className="font-mono text-[12px]">{data.date}</span> : null}
        {data.date && stage !== "cancelled" ? <span className="font-mono text-[12px] text-muted-foreground" data-testid="launch-countdown">{countdown(data.date, localDayKey(), data.launchedAt)}</span> : null}
        <span className={BADGE}>{LAUNCH_STAGE_LABEL[stage]}</span>
        {data.versionLabel ? <span className="font-mono text-[11px] text-muted-foreground">{data.versionLabel}</span> : null}
        <div className="ml-auto flex items-center gap-2">
          {data.canEdit && open ? <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => setDialog("launch")}>Launch now</button> : null}
          {data.canEdit && stage === "launched" ? <button type="button" className={closeSuggested(data.launchedAt, new Date()) ? FORM_PRIMARY_CLASS : FORM_SECONDARY_CLASS} disabled={busy} onClick={() => setDialog("close")}>Close launch</button> : null}
          {data.canEdit && open ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild><button type="button" aria-label="Launch actions" className="nb-touch-target inline-flex size-8 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted"><MoreHorizontal className="size-4" /></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setDialog("date")}>Move the date…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setDialog("cancel")}>Cancel launch…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-2" aria-label={`${data.progress.text} done`}>
        <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted"><div className="h-full bg-primary" style={{ width: `${pct}%` }} /></div>
        <span className="font-mono text-[11px] text-muted-foreground" data-testid="launch-progress">{data.progress.text}{data.overdue ? ` · ${data.overdue} overdue` : ""}</span>
      </div>
      {data.member ? (
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1.5" data-testid="launch-ships">
            <h3 className="text-[12px] font-semibold">Ships <span className="font-mono font-normal text-muted-foreground">{data.ships.length}</span></h3>
            <ul className="space-y-1" aria-label="Roadmap items that ship">
              {data.ships.map((s) => (
                <li key={s.id} className="flex items-center gap-2 text-[13px]">
                  <span className="min-w-0 flex-1 truncate">{s.title}</span><span className={BADGE}>{s.itemType}</span>
                  {data.canEdit && open ? <button type="button" className="text-[12px] text-muted-foreground hover:underline" disabled={busy} onClick={() => void run(setLaunchShipsAction(projectId, { docSlug, itemId: s.id, on: false }), "Removed from this launch")}>Remove</button> : null}
                </li>
              ))}
              {!data.ships.length ? <li className="text-[12px] text-muted-foreground">{roadmapAdded ? "No roadmap items ship in this launch yet." : "Add Roadmap to say what ships."}</li> : null}
            </ul>
            {data.canEdit && open && shippable.length ? (
              <SelectWrap><select aria-label="Add item" value="" disabled={busy} className={cn(selectClassName(), "h-8 text-[13px]")} onChange={(e) => { if (e.target.value) void run(setLaunchShipsAction(projectId, { docSlug, itemId: e.target.value, on: true }), "Ships in this launch"); }}>
                <option value="">Add item…</option>{shippable.map((i) => <option key={i.id} value={i.id}>{i.title}</option>)}
              </select></SelectWrap>
            ) : null}
          </div>
          <div className="space-y-1.5" data-testid="launch-whats-new">
            <h3 className="text-[12px] font-semibold">What’s new <span className="font-normal text-muted-foreground">(draft from what ships and bugs fixed in {data.versionLabel ?? "this version"})</span></h3>
            {(["added", "improved", "fixed"] as const).map((g) => data.whatsNew[g].length ? (
              <div key={g}><p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{g === "added" ? "Added" : g === "improved" ? "Improved" : "Fixed"}</p>
                <ul className="list-disc pl-5 text-[13px]">{data.whatsNew[g].map((t) => <li key={t}>{t}</li>)}</ul></div>
            ) : null)}
            {!data.whatsNew.added.length && !data.whatsNew.improved.length && !data.whatsNew.fixed.length ? <p className="text-[12px] text-muted-foreground">Fills in as items ship and bugs are fixed.</p> : null}
          </div>
        </div>
      ) : null}

      {dialog === "launch" ? <LaunchDialog openSteps={data.openSteps} openTitles={data.openTitles} ships={data.ships.length} busy={busy} onClose={() => setDialog(null)} onLaunch={async (markItems, postUpdate) => {
        const r = await run(launchAction(projectId, { docSlug, markItems }), "Launched");
        if (r && "update" in r && typeof r.update === "string" && postUpdate) {
          try { await navigator.clipboard.writeText(r.update); toast("The release notes are copied · paste them into an Update"); } catch { toast("Write the release Update from What’s new"); }
        }
      }} /> : null}
      {dialog === "close" ? <ChoiceDialog title="Close launch" text={data.openSteps ? `${data.openSteps} steps are still open.` : "Every step is done."} choices={data.openSteps ? [["leave", "Leave them"], ["backlog", "Move them to the Backlog"]] : [["leave", "Close"]]} busy={busy}
        onClose={() => setDialog(null)} onPick={(remaining) => void run(closeLaunchAction(projectId, { docSlug, remaining }), "Closed")} /> : null}
      {dialog === "cancel" ? <ChoiceDialog title="Cancel launch" text="Items that ship in it go back to Planned." choices={data.openSteps ? [["keep", "Keep the steps"], ["backlog", "Move open steps to the Backlog"]] : [["keep", "Cancel launch"]]} busy={busy}
        onClose={() => setDialog(null)} onPick={(c) => void run(cancelLaunchAction(projectId, { docSlug, backlogSteps: c === "backlog" }), "Launch canceled")} /> : null}
      {dialog === "date" ? <MoveDateDialog current={data.date ?? ""} busy={busy} onClose={() => setDialog(null)} onSave={(date, shiftSteps) => void run(moveLaunchDateAction(projectId, { docSlug, date, shiftSteps }), "Date moved")} /> : null}
    </section>
  );
}

function LaunchDialog({ openSteps, openTitles, ships, busy, onClose, onLaunch }: { openSteps: number; openTitles: string[]; ships: number; busy: boolean; onClose: () => void; onLaunch: (markItems: boolean, postUpdate: boolean) => void }) {
  const [mark, setMark] = useState(true);
  const [post, setPost] = useState(true);
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="launch-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">Launch now</DialogTitle><DialogDescription className="text-xs text-muted-foreground">{openSteps ? `${openSteps} ${openSteps === 1 ? "step is" : "steps are"} still open.` : "Every step is done."}</DialogDescription></div>
        <div className="space-y-2.5 px-6 py-4 text-[13px]">
          {openTitles.length ? <ul className="list-disc pl-5 text-xs text-muted-foreground" aria-label="Open steps" data-testid="launch-open-steps">{openTitles.map((t) => <li key={t}>{t}</li>)}{openSteps > openTitles.length ? <li>and {openSteps - openTitles.length} more</li> : null}</ul> : null}
          <label className="flex items-center gap-2"><input type="checkbox" checked={mark} onChange={(e) => setMark(e.target.checked)} disabled={!ships} />Mark the {ships} roadmap {ships === 1 ? "item" : "items"} Launched</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={post} onChange={(e) => setPost(e.target.checked)} />Copy release notes for an Update (nothing is posted)</label>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Not yet</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => onLaunch(mark && ships > 0, post)}>Launch</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ChoiceDialog<T extends string>({ title, text, choices, busy, onClose, onPick }: { title: string; text: string; choices: Array<[T, string]>; busy: boolean; onClose: () => void; onPick: (choice: T) => void }) {
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="launch-choice-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">{title}</DialogTitle><DialogDescription className="text-xs text-muted-foreground">{text}</DialogDescription></div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Back</button>
          {choices.map(([k, label], i) => <button key={k} type="button" className={i === choices.length - 1 ? FORM_PRIMARY_CLASS : FORM_SECONDARY_CLASS} disabled={busy} onClick={() => onPick(k)}>{label}</button>)}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function MoveDateDialog({ current, busy, onClose, onSave }: { current: string; busy: boolean; onClose: () => void; onSave: (date: string, shiftSteps: boolean) => void }) {
  const [date, setDate] = useState(current);
  const [shift, setShift] = useState(true);
  const days = current && date ? Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${current}T00:00:00Z`)) / 86_400_000) : 0;
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="launch-date-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">Move the date</DialogTitle><DialogDescription className="sr-only">A new launch date</DialogDescription></div>
        <div className="space-y-3 px-6 py-4 text-[13px]">
          <Field label="Launch date" htmlFor="launch-new-date"><input id="launch-new-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className={cn(inputClassName(false), "font-mono")} /></Field>
          {days ? <label className="flex items-center gap-2"><input type="checkbox" checked={shift} onChange={(e) => setShift(e.target.checked)} />Also move the steps’ due dates by {Math.abs(days)} {Math.abs(days) === 1 ? "day" : "days"}</label> : null}
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={onClose}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy || !date || !days} onClick={() => onSave(date, shift)}>Move</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
