"use client";

import { useEffect, useMemo, useState, useTransition } from "react";

import { addTasksToSprintAction } from "@/app/actions/task";
import { readSprintBacklogAction } from "@/app/actions/workspace";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/lib/feedback";
import type { SprintBacklogRow } from "@/lib/workspaces/sprint-detail";
import { cn } from "@/lib/utils";

// Sprint redesign §8.6: plan from the backlog — tick tasks, see the points against what the team usually finishes, add.

/** More than usual: above the recent average, or the last sprint when there's no average. */
export function planWarning(planned: number, velocity: { last: number | null; average: number | null } | null | undefined) {
  const usual = velocity?.average ?? velocity?.last ?? null;
  return usual !== null && planned > usual ? "More than you usually finish." : null;
}

export function SprintAddWork({ projectId, sprintId, sprintName, open, onClose, onAdded, plannedPoints, velocity }: {
  projectId: string; sprintId: string; sprintName: string; open: boolean; onClose: () => void; onAdded: () => void
  plannedPoints: number; velocity?: { last: number | null; average: number | null } | null
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<SprintBacklogRow[] | null>(null);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  useEffect(() => {
    if (!open) return;
    let live = true;
    const timer = setTimeout(() => void readSprintBacklogAction({ projectId, query }).then((r) => {
      if (!live) return;
      setRows(r.success ? r.rows : []);
      setError(r.success ? null : r.error);
    }), 200);
    return () => { live = false; clearTimeout(timer); };
  }, [open, projectId, query]);
  useEffect(() => { if (!open) { setPicked(new Set()); setQuery(""); } }, [open]);
  const chosen = useMemo(() => (rows ?? []).filter((r) => picked.has(r.id)), [rows, picked]);
  const total = plannedPoints + chosen.reduce((n, r) => n + (r.storyPoints ?? 0), 0);
  const noPoints = chosen.filter((r) => r.storyPoints == null).length;
  const warning = planWarning(total, velocity);
  const add = () => startTransition(async () => {
    const result = await addTasksToSprintAction({ projectId, sprintId, taskIds: [...picked] });
    if (result.added) toast.success(`Added ${result.added} to ${sprintName}.`);
    if (result.failed.length) setError(result.failed[0]!.error);
    else onClose();
    onAdded();
  });
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-2xl">
        <DialogHeader>
          <DialogTitle>Add work to {sprintName}</DialogTitle>
          <DialogDescription>Open work that isn’t in a sprint yet.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_220px]">
          <div className="min-w-0 space-y-2">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the backlog" aria-label="Search the backlog"
              className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-background px-3 text-[13px]" />
            <ul aria-label="Backlog" className="max-h-80 divide-y divide-border overflow-y-auto rounded-[6px] border border-border">
              {rows === null ? <li className="px-3 py-4 text-sm text-muted-foreground">Loading the backlog…</li> : null}
              {rows?.length === 0 ? <li className="px-3 py-4 text-sm text-muted-foreground">{query ? "Nothing matches." : "The backlog is empty."}</li> : null}
              {rows?.map((r) => (
                <li key={r.id}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted/40">
                    <input type="checkbox" checked={picked.has(r.id)} onChange={(e) => setPicked((cur) => { const next = new Set(cur); if (e.target.checked) next.add(r.id); else next.delete(r.id); return next; })} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate">{r.title}</span>
                      <span className="block text-[12px] text-muted-foreground">{r.kind === "assignment" ? "Assignment" : r.assignee ?? "Nobody yet"}</span>
                    </span>
                    <span className="rounded-[3px] border border-border px-1.5 font-mono text-[11px] text-muted-foreground">{r.storyPoints ?? "—"}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
          <div className="space-y-2">
            <div className="rounded-[6px] bg-muted/50 p-3">
              <p className="text-[12px] text-muted-foreground">In {sprintName} after this</p>
              <p className="text-[20px] font-semibold leading-tight">{total} points</p>
              <p className="text-[12px] text-muted-foreground">
                {velocity?.last != null ? `Last sprint finished ${velocity.last}.` : "No closed sprint to compare with yet."}
                {velocity?.average != null ? ` Recent average ${velocity.average}.` : ""}
              </p>
              {warning ? <p className="mt-1 text-[12px] text-[var(--status-warning)]">{warning}</p> : null}
            </div>
            {noPoints ? <p className="text-[12px] text-muted-foreground">{noPoints} {noPoints === 1 ? "task has" : "tasks have"} no points.</p> : null}
          </div>
        </div>
        {error ? <p role="alert" className="text-sm text-destructive">{error}</p> : null}
        <div className="flex justify-end gap-2 border-t border-border pt-3">
          <button type="button" onClick={onClose} className="nb-touch-target nb-ui-label inline-flex h-[34px] items-center rounded-[5px] border border-border bg-card px-3 hover:bg-muted">Cancel</button>
          <button type="button" disabled={pending || picked.size === 0} onClick={add}
            className={cn("nb-touch-target nb-ui-label inline-flex h-[34px] items-center rounded-[5px] border border-primary bg-primary px-3 text-primary-foreground hover:bg-[var(--primary-hover)] disabled:opacity-50")}>
            {picked.size ? `Add ${picked.size} ${picked.size === 1 ? "task" : "tasks"}` : "Add tasks"}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
