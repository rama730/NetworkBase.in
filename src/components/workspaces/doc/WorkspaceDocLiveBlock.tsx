"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, MoreHorizontal, Plus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { addDocRowAction, detachDocRowAction, moveDocRowAction, readDocRowKeysAction, readDocRowsAction, type DocRow } from "@/app/actions/workspace/doc";
import { updateTaskStatusAction } from "@/app/actions/task";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, QuickChips, inputClassName, selectClassName } from "@/components/workspaces/v2/tasks/form-parts";
import { useWorkspaceMembers } from "@/hooks/workspaces/useWorkspaceMembers";
import { toast } from "@/lib/feedback";
import { subscribeBroadcast } from "@/lib/realtime/private-broadcast";
import { liveTopics } from "@/lib/realtime/subscriptions";
import { cn } from "@/lib/utils";
import { orderRows } from "@/lib/workspaces/doc-live-blocks";

const rowsKey = (projectId: string, docSlug: string, blockKey: string) => ["doc-rows", projectId, docSlug, blockKey] as const;
const addWord = (label: string) => (/action item/i.test(label) ? "action item" : /step/i.test(label) ? "step" : "item");
const dayIso = (offsetDays: number) => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); d.setUTCDate(d.getUTCDate() + offsetDays); return d.toISOString(); };
const shortDate = (iso: string) => new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Report 38.3 S3: a live task-rows block. Rows are tasks (call 1): ticking moves the task through the usual transition
 * (review where it's required), so the document's text never changes (B8). Editors add, reorder and detach rows.
 */
export function WorkspaceDocLiveBlock({ projectId, projectSlug, docSlug, blockKey, label, removed = false }: { projectId: string; projectSlug: string; docSlug: string; blockKey: string; label: string; removed?: boolean }) {
  const queryClient = useQueryClient();
  const key = rowsKey(projectId, docSlug, blockKey);
  const query = useQuery({ queryKey: key, queryFn: () => readDocRowsAction(projectId, docSlug, blockKey), staleTime: 15_000 });
  const [adding, setAdding] = useState(false);
  const [showFolded, setShowFolded] = useState(false);
  const refresh = () => queryClient.invalidateQueries({ queryKey: key });
  // W4: a tick on the board or in another tab shows here too. Members only (the topic is private); bursts are batched.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const live = subscribeBroadcast(liveTopics.tasks(projectId), () => {
      clearTimeout(timer);
      timer = setTimeout(() => void queryClient.invalidateQueries({ queryKey: ["doc-rows", projectId, docSlug] }), 400);
    });
    return () => { clearTimeout(timer); live.unsubscribe(); };
  }, [docSlug, projectId, queryClient]);
  const data = query.data?.success ? query.data : null;
  const { shown, folded } = useMemo(() => orderRows(data?.rows ?? []), [data?.rows]);
  const open = (data?.rows ?? []).filter((r) => r.status !== "done").length;
  const done = (data?.rows ?? []).length - open;
  const word = addWord(label);

  async function tick(row: DocRow) {
    const next = row.status === "done" ? "todo" : "done";
    // The box ticks at once; the refresh below brings the server's answer (In review, or back on failure).
    queryClient.setQueryData(key, (old: typeof query.data) => (old?.success
      ? { ...old, rows: old.rows.map((r) => (r.id === row.id ? { ...r, status: next, completedAt: next === "done" ? new Date().toISOString() : null } : r)) }
      : old));
    const result = await updateTaskStatusAction(row.id, next, projectId);
    await refresh();
    if (!result.success) return void toast.error(result.error ?? "Couldn’t change it.");
    toast(result.outcome === "submitted" ? "Sent for review" : next === "done" ? "Completed" : "Back to To do", {
      duration: 10_000,
      action: { label: "Undo", onClick: async () => { await updateTaskStatusAction(row.id, row.status as "todo", projectId); await refresh(); } },
    });
  }
  async function act(run: () => Promise<{ success: boolean; error?: string }>) {
    const result = await run();
    if (!result.success) toast.error(result.error ?? "Couldn’t change the list.");
    await refresh();
  }

  return (
    <section className="my-4 rounded-[8px] border border-border bg-card" aria-label={label} data-testid={`live-block-${blockKey}`}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <h3 className="nb-ui-label text-foreground">{label}</h3>
        {data?.canSeeTasks && data.rows.length ? <span className="font-mono text-[11px] text-muted-foreground">{open} open · {done} completed</span> : null}
      </header>
      <div className="px-2 py-1">
        {query.isLoading ? (
          <div className="space-y-1.5 p-2">{[0, 1, 2].map((i) => <div key={i} aria-hidden="true" className="nb-skeleton h-8 w-full rounded-[5px]" />)}</div>
        ) : !data ? (
          <p className="p-2 text-[13px] text-muted-foreground">Couldn’t load these items · <button type="button" className="text-primary underline-offset-2 hover:underline" onClick={() => void refresh()}>Try again</button></p>
        ) : !data.canSeeTasks ? (
          <p className="p-2 text-[13px] text-muted-foreground">{label} are visible to members.</p>
        ) : (
          <>
            {data.rows.length === 0 && !adding ? <p className="px-2 py-2 text-[13px] text-muted-foreground">No {label.toLowerCase()} yet</p> : null}
            <ul>
              {shown.map((row, i) => <Row key={row.id} row={row} projectSlug={projectSlug} canEdit={data.canAdd} first={i === 0} last={i === shown.length - 1}
                onTick={() => void tick(row)} onMove={(direction) => void act(() => moveDocRowAction(projectId, { docSlug, taskId: row.id, direction }))}
                onDetach={() => void act(() => detachDocRowAction(projectId, { docSlug, taskId: row.id }))} />)}
            </ul>
            {folded.length ? (
              <div className="px-2 py-1">
                <button type="button" aria-expanded={showFolded} onClick={() => setShowFolded(!showFolded)} className="flex items-center gap-1 text-[12px] text-muted-foreground hover:text-foreground">
                  <ChevronDown aria-hidden="true" className={cn("size-3 transition-transform duration-[180ms]", !showFolded && "-rotate-90")} />Completed ({folded.length})
                </button>
                {showFolded ? <ul>{folded.map((row) => <Row key={row.id} row={row} projectSlug={projectSlug} canEdit={false} first last onTick={() => void tick(row)} onMove={() => undefined} onDetach={() => undefined} />)}</ul> : null}
              </div>
            ) : null}
            {data.hidden ? <p className="px-2 py-1 text-[12px] text-muted-foreground">{data.hidden} more {data.hidden === 1 ? "item" : "items"} you can’t see</p> : null}
            {removed ? null : data.canAdd ? (adding
              ? <AddRow projectId={projectId} onCancel={() => setAdding(false)} word={word}
                  onAdd={async (row) => { const r = await addDocRowAction(projectId, { docSlug, blockKey, ...row }); if (!r.success) { toast.error(r.error); return false; } await refresh(); return true; }} />
              : <button type="button" onClick={() => setAdding(true)} className="nb-touch-target flex items-center gap-1.5 px-2 py-2 text-[13px] text-muted-foreground hover:text-foreground"><Plus aria-hidden="true" className="size-3.5" />Add {word}</button>)
              : <p className="px-2 py-1.5 text-[12px] text-muted-foreground">Only people who can edit this document add items here.</p>}
          </>
        )}
      </div>
    </section>
  );
}

function Row({ row, projectSlug, canEdit, first, last, onTick, onMove, onDetach }: {
  row: DocRow; projectSlug: string; canEdit: boolean; first: boolean; last: boolean; onTick: () => void; onMove: (direction: "up" | "down") => void; onDetach: () => void;
}) {
  const href = `/workspaces/${encodeURIComponent(projectSlug)}?tab=tasks&drawerType=task&drawerId=${row.id}`;
  const done = row.status === "done";
  const inReview = row.reviewStatus === "pending";
  return (
    <li className="group flex min-h-11 items-center gap-2.5 rounded-[5px] px-2 hover:bg-muted/40">
      <input type="checkbox" className="nb-check" checked={done && !inReview} ref={(el) => { if (el) el.indeterminate = inReview; }} disabled={!row.canTick}
        onChange={onTick} aria-label={`${done ? "Mark as not done" : "Complete"}: ${row.title}`} />
      <a href={href} className={cn("min-w-0 flex-1 truncate text-[13px] text-foreground hover:underline", done && !inReview && "text-muted-foreground line-through")}>{row.title}</a>
      {inReview ? <span className="text-[11px] text-muted-foreground">In review</span> : null}
      {row.number ? <span className="font-mono text-[11px] text-muted-foreground">#{row.number}</span> : null}
      {row.assignee ? <span className="max-w-[8rem] truncate text-[12px] text-muted-foreground">{row.assignee.name ?? "Someone"}</span> : null}
      {row.dueDate ? <span className="font-mono text-[11px] text-muted-foreground">{shortDate(row.dueDate)}</span> : null}
      {canEdit ? (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button type="button" aria-label={`Options for ${row.title}`} className="nb-touch-target inline-flex size-7 items-center justify-center rounded-md text-muted-foreground opacity-0 hover:bg-muted focus-visible:opacity-100 group-hover:opacity-100 pointer-coarse:opacity-100">
              <MoreHorizontal className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            {!first ? <DropdownMenuItem onSelect={() => onMove("up")}>Move up</DropdownMenuItem> : null}
            {!last ? <DropdownMenuItem onSelect={() => onMove("down")}>Move down</DropdownMenuItem> : null}
            <DropdownMenuItem asChild><a href={href}>Open task</a></DropdownMenuItem>
            <DropdownMenuItem onSelect={onDetach}>Remove from this list</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ) : null}
    </li>
  );
}

function AddRow({ projectId, word, onAdd, onCancel }: { projectId: string; word: string; onAdd: (row: { title: string; assigneeId: string | null; dueDate: string | null }) => Promise<boolean>; onCancel: () => void }) {
  const [title, setTitle] = useState("");
  const [assigneeId, setAssigneeId] = useState("");
  const [due, setDue] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const members = useWorkspaceMembers(projectId, [], { enabled: true });
  const people = (members.data?.pages ?? []).flatMap((p: { members?: Array<{ id: string; fullName?: string | null; username?: string | null; membershipRole?: string }> }) => p.members ?? [])
    .filter((m) => m.membershipRole !== "viewer");
  async function submit() {
    if (!title.trim()) return setError("Add a title");
    setBusy(true);
    const ok = await onAdd({ title: title.trim(), assigneeId: assigneeId || null, dueDate: due });
    setBusy(false);
    if (ok) { setTitle(""); setError(null); }
  }
  return (
    <div className="space-y-2 rounded-[6px] border border-border p-3" onKeyDown={(e) => { if (e.key === "Escape") onCancel(); }}>
      <input autoFocus value={title} maxLength={200} onChange={(e) => setTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void submit(); } }}
        placeholder={`New ${word}`} aria-label={`New ${word}`} aria-invalid={Boolean(error)} className={inputClassName(Boolean(error))} />
      {error ? <p className="text-xs text-[var(--status-danger)]">{error}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Assigned to" value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)} className={cn(selectClassName(), "h-8 w-auto text-[13px]")}>
          <option value="">Not assigned</option>
          {people.map((p) => <option key={p.id} value={p.id}>{p.fullName || p.username || "Member"}</option>)}
        </select>
        <QuickChips label="Due" items={[
          { label: "Today", active: due === dayIso(0), onClick: () => setDue(dayIso(0)) },
          { label: "1 week", active: due === dayIso(7), onClick: () => setDue(dayIso(7)) },
          { label: "2 weeks", active: due === dayIso(14), onClick: () => setDue(dayIso(14)) },
        ]} />
        <input type="date" aria-label="Pick a date" className={cn(inputClassName(false), "h-8 w-auto text-[13px]")} onChange={(e) => setDue(e.target.value ? new Date(`${e.target.value}T00:00:00Z`).toISOString() : null)} />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className={FORM_SECONDARY_CLASS} onClick={onCancel}>Cancel</button>
        <button type="button" className={FORM_PRIMARY_CLASS} disabled={busy} onClick={() => void submit()}>Add</button>
      </div>
    </div>
  );
}

/** W10: rows of lists whose line was deleted stay tasks; editors see a quiet note at the end with a way to show them. */
export function RemovedListsNote({ projectId, projectSlug, docSlug, presentKeys }: { projectId: string; projectSlug: string; docSlug: string; presentKeys: string[] }) {
  const query = useQuery({ queryKey: ["doc-row-keys", projectId, docSlug], queryFn: () => readDocRowKeysAction(projectId, docSlug), staleTime: 60_000 });
  const [shown, setShown] = useState(false);
  const removed = (query.data?.success ? query.data.keys : []).filter((k) => !presentKeys.includes(k.key));
  const total = removed.reduce((n, k) => n + k.count, 0);
  if (!total) return null;
  return (
    <div className="mt-6 border-t border-border pt-3 text-[12px] text-muted-foreground" data-testid="removed-lists-note">
      {total} {total === 1 ? "item" : "items"} from a removed list ·{" "}
      <button type="button" className="text-primary underline-offset-2 hover:underline" aria-expanded={shown} onClick={() => setShown(!shown)}>{shown ? "Hide" : "Show"}</button>
      {shown ? removed.map((k) => <WorkspaceDocLiveBlock key={k.key} projectId={projectId} projectSlug={projectSlug} docSlug={docSlug} blockKey={k.key} label="Items from a removed list" removed />) : null}
    </div>
  );
}
