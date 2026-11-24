"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { useState } from "react";

import { answerOffsiteAction, createOffsiteAction, readMeetingsAction, readOffsiteAction } from "@/app/actions/workspace/doc";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useOpenDocAfter } from "@/components/workspaces/doc/DocMeeting";
import { Field, FORM_DIALOG_CLASS, FORM_FOOTER_CLASS, FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { offsiteMarkdown } from "@/lib/workflows/offsite";
import { localDayKey } from "@/lib/workflows/planner";

const offsiteKey = (projectId: string, docSlug: string) => [...queryKeys.project.detail.tasksRoot(projectId), "offsite", docSlug];
const short = (day: string | null) => (day ? new Date(`${day}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" }).replace(",", "") : "");

/** Report 38.14 S1 (A5.4): MapPin · name · dates (mono) · place · "6 going · 1 can't go · 2 not answered", then Who's coming. */
export function OffsiteHeader({ projectId, docSlug }: { projectId: string; docSlug: string }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: offsiteKey(projectId, docSlug), queryFn: () => readOffsiteAction(projectId, docSlug), staleTime: 30_000 });
  const [busy, setBusy] = useState(false);
  const data = query.data?.success ? query.data : null;
  if (!data) return query.isLoading ? <div aria-hidden="true" className="nb-skeleton mb-3 h-16 rounded-[8px]" /> : null;
  async function answer(value: "going" | "cant") {
    setBusy(true);
    try {
      const r = await answerOffsiteAction(projectId, { docSlug, answer: value });
      if (!r.success) throw new Error(r.error);
      await queryClient.invalidateQueries({ queryKey: queryKeys.project.detail.tasksRoot(projectId) });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t save your answer");
    } finally {
      setBusy(false);
    }
  }
  const group = (a: "going" | "cant" | null) => data.people.filter((p) => p.answer === a).map((p) => p.name);
  const groups = [["Going", group("going")], ["Can’t go", group("cant")], ["Not answered", group(null)]] as const;
  return (
    <section aria-label="Off-site" className="mb-4 space-y-2 rounded-[8px] border border-border bg-card p-3" data-testid="offsite-header">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <MapPin aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="font-mono text-[12px]">{short(data.dateFrom)}{data.dateTo && data.dateTo !== data.dateFrom ? ` – ${short(data.dateTo)}` : ""}</span>
        {data.place ? <span className="text-[13px]">{data.place}</span> : null}
        <span className="text-[12px] text-muted-foreground" data-testid="offsite-counts"><span className="font-mono">{data.counts.going}</span> going · <span className="font-mono">{data.counts.cant}</span> can’t go · <span className="font-mono">{data.counts.unanswered}</span> not answered</span>
      </div>
      <div className="border-t border-border pt-2" data-testid="offsite-whos-coming">
        <h3 className="mb-1 text-[12px] font-semibold">Who’s coming</h3>
        <dl className="grid grid-cols-1 gap-1 text-[12px] sm:grid-cols-3">
          {groups.map(([label, names]) => <div key={label}><dt className="text-muted-foreground">{label} <span className="font-mono">{names.length}</span></dt><dd>{names.join(", ") || "—"}</dd></div>)}
        </dl>
        {data.mine ? (
          <div className="mt-2 flex gap-2" role="group" aria-label="Your answer">
            {(["going", "cant"] as const).map((a) => (
              <button key={a} type="button" aria-pressed={data.mine === a} disabled={busy} onClick={() => void answer(a)}
                className={cn("min-h-11 flex-1 rounded-[6px] border px-3 text-[13px] font-medium sm:flex-none", data.mine === a ? "border-foreground bg-muted/60" : "border-border hover:bg-muted/40")}>
                {a === "going" ? "Going" : "Can’t go"}
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </section>
  );
}

/** W1: name, dates, place, invite → the document with its agenda by day and the four checklists. */
export function NewOffsiteDialog({ projectId, open, onOpenChange }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void }) {
  const openDoc = useOpenDocAfter(projectId);
  const people = useQuery({ queryKey: [...queryKeys.project.detail.tasksRoot(projectId), "meetings"], queryFn: () => readMeetingsAction(projectId), enabled: open, staleTime: 30_000 });
  const [v, setV] = useState({ name: "Team off-site", from: localDayKey(), to: localDayKey(), place: "" });
  const [invited, setInvited] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  if (!open) return null;
  async function create() {
    if (!v.name.trim()) return void toast.error("Name the off-site");
    if (v.to < v.from) return void toast.error("The end date is before the start");
    setBusy(true);
    try {
      const { createDocFile } = await import("@/components/organizations/OrgDocParts");
      const made = await createDocFile(projectId, `${v.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "off-site"}-${v.from}.md`, offsiteMarkdown(v.name.trim(), v.from, v.to));
      const r = await createOffsiteAction(projectId, { docSlug: made.slug, name: v.name.trim(), dateFrom: v.from, dateTo: v.to, ...(v.place.trim() ? { place: v.place.trim() } : {}), invitedIds: invited });
      if (!r.success) {
        const { unlinkWorkspaceDocAction } = await import("@/app/actions/workspace/doc");
        await unlinkWorkspaceDocAction(projectId, made.slug).catch(() => undefined);
        throw new Error(r.error);
      }
      toast("Off-site planned · invitees are asked");
      onOpenChange(false);
      openDoc(made.slug);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t plan the off-site");
    } finally {
      setBusy(false);
    }
  }
  const list = people.data?.success ? people.data.people : [];
  return (
    <Dialog open onOpenChange={(o) => { if (!o && !busy) onOpenChange(false); }}>
      <DialogContent showCloseButton={false} className={FORM_DIALOG_CLASS} data-testid="new-offsite-dialog">
        <div className="border-b border-border px-6 py-4"><DialogTitle className="text-base font-semibold">Plan an off-site</DialogTitle><DialogDescription className="text-xs text-muted-foreground">A document with the agenda by day and checklists for what to book. Members only.</DialogDescription></div>
        <div className="max-h-[65vh] space-y-3.5 overflow-y-auto px-6 py-4">
          <Field label="Name" htmlFor="offsite-name" required><input id="offsite-name" maxLength={120} value={v.name} onChange={(e) => setV({ ...v, name: e.target.value })} className={inputClassName(false)} /></Field>
          <div className="grid grid-cols-2 gap-3.5">
            <Field label="From" htmlFor="offsite-from"><input id="offsite-from" type="date" value={v.from} onChange={(e) => setV({ ...v, from: e.target.value, to: e.target.value > v.to ? e.target.value : v.to })} className={cn(inputClassName(false), "font-mono")} /></Field>
            <Field label="To" htmlFor="offsite-to"><input id="offsite-to" type="date" min={v.from} value={v.to} onChange={(e) => setV({ ...v, to: e.target.value })} className={cn(inputClassName(false), "font-mono")} /></Field>
          </div>
          <Field label="Place" htmlFor="offsite-place"><input id="offsite-place" maxLength={200} value={v.place} onChange={(e) => setV({ ...v, place: e.target.value })} placeholder="Goa" className={inputClassName(false)} /></Field>
          <fieldset className="space-y-1.5">
            <legend className="text-[13px] font-medium">Invite</legend>
            <div className="grid grid-cols-1 gap-1 sm:grid-cols-2" data-testid="offsite-invite">
              {list.map((p) => <label key={p.id} className="flex items-center gap-2 text-[13px]"><input type="checkbox" checked={invited.includes(p.id)} onChange={(e) => setInvited(e.target.checked ? [...invited, p.id] : invited.filter((x) => x !== p.id))} />{p.name}</label>)}
            </div>
          </fieldset>
        </div>
        <div className={FORM_FOOTER_CLASS}>
          <button type="button" className={FORM_SECONDARY_CLASS} disabled={busy} onClick={() => onOpenChange(false)}>Cancel</button>
          <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => void create()}>{busy ? "Planning…" : "Plan off-site"}</button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
