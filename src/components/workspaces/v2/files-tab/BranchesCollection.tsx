"use client";

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, MoreHorizontal, Pencil, Search, Trash2 } from "lucide-react";

import {
  branchChangesAction, branchDiffAction, createBranchAction, deleteBranchAction, listBranchesAction, renameBranchAction, restoreBranchAction,
} from "@/app/actions/files/branches";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { BranchView } from "@/lib/domain/branches";
import { feedbackError, toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { EmptyState, When } from "./ChangesCollection";
import { FilesViewsMenu } from "./FilesHeader";
import { useFilesViews } from "./FilesViews";
import { useFilesTabRole } from "./FilesTabRoleContext";
import { DiffView } from "./HistoryCollection";

/**
 * All branches (report H2's branch list; "View all branches" in the picker, ?filesView=branches): filters, New
 * branch, rename, delete and restore. Picking one switches the Files tab to it, like the picker (H-2b).
 */
const aheadBehind = (b: BranchView) => b.isDefault ? "The workspace's files" : `${b.ahead} save${b.ahead === 1 ? "" : "s"} ahead, ${b.behind} behind main`;
const unwrap = async <T,>(p: Promise<{ success: true; data: T } | { success: false; error: string }>) => {
  const res = await p;
  if (!res.success) throw new Error(res.error);
  return res.data;
};

export function BranchesCollection({ projectId }: { projectId: string }) {
  const views = useFilesViews();
  const { canEdit } = useFilesTabRole();
  const client = useQueryClient();
  const [filter, setFilter] = useState<"active" | "stale" | "merged" | "deleted">("active");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [from, setFrom] = useState("main");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<BranchView | null>(null);
  const [rename, setRename] = useState("");
  const [deleting, setDeleting] = useState<BranchView | null>(null);
  const list = useQuery({ queryKey: ["branches", projectId, filter], queryFn: () => unwrap(listBranchesAction(projectId, filter)), staleTime: 15_000 });
  const branches = useMemo(() => (list.data?.branches ?? []).filter((b) => !query || b.name.toLowerCase().includes(query.toLowerCase())), [list.data, query]);
  const refresh = () => { void client.invalidateQueries({ queryKey: ["branches", projectId] }); void client.invalidateQueries({ queryKey: ["branch", projectId] }); };
  const open = (b: BranchView) => views?.setBranch(b.isDefault ? null : b.name);
  async function create() {
    setBusy(true);
    try {
      const res = await createBranchAction(projectId, newName.trim(), from);
      if (!res.success) { toast.error(res.error); return; }
      refresh();
      toast.success(`Created ${res.data.branch.name}`);
      views?.setBranch(res.data.branch.name);
    } finally { setBusy(false); }
  }
  async function restore(b: BranchView) {
    const res = await restoreBranchAction(b.id);
    if (!res.success) { toast.error(res.error); return; }
    refresh();
    toast.success(`Restored ${b.name}`);
  }
  async function doRename() {
    const res = await renameBranchAction(renaming!.id, rename.trim());
    if (!res.success) { toast.error(res.error); return; }
    if (views?.branch?.toLowerCase() === renaming!.name.toLowerCase()) views.setBranch(res.data.branch.name);
    setRenaming(null);
    refresh();
  }
  async function doDelete() {
    const b = deleting!;
    const res = await deleteBranchAction(b.id);
    if (!res.success) { toast.error(res.error); return; }
    toast.success(`Deleted ${b.name}; restorable for 30 days`);
    if (views?.branch?.toLowerCase() === b.name.toLowerCase()) views.setBranch(null);
    setDeleting(null);
    refresh();
  }
  return (
    <div aria-label="Branches" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card dark:bg-background">
      <FilesViewsMenu projectId={projectId} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        <p className="mb-3 text-sm text-muted-foreground">Branches let you try changes without touching main. Pick one to switch the Files tab to it; merge it back with a merge request. <a href="/docs/files/branches" className="underline underline-offset-2 hover:text-foreground">What’s this?</a></p>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="relative min-w-0 flex-1 basis-48">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <label className="sr-only" htmlFor="branch-search">Find a branch</label>
            <input id="branch-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a branch" className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-sm" />
          </div>
          <div role="tablist" aria-label="Which branches" className="flex gap-1">
            {(["active", "stale", "merged", "deleted"] as const).map((f) => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cn("rounded-md px-2.5 py-1 text-sm", filter === f ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {f[0]!.toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          {canEdit ? <Button size="sm" onClick={() => setCreating((c) => !c)} aria-expanded={creating}><GitBranch className="size-4" aria-hidden />New branch</Button> : null}
        </div>
        {creating ? (
          <form className="mb-3 flex flex-wrap items-end gap-2 rounded-md border border-border p-3" onSubmit={(e) => { e.preventDefault(); void create(); }}>
            <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1 text-xs text-muted-foreground">Name
              <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ram/try-new-header" className="h-8 rounded-md border border-border bg-background px-2 font-mono text-sm text-foreground" />
            </label>
            <label className="flex flex-col gap-1 text-xs text-muted-foreground">From
              <select value={from} onChange={(e) => setFrom(e.target.value)} className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground">
                {(list.data?.branches ?? []).filter((b) => b.status === "active").map((b) => <option key={b.id} value={b.isDefault ? "main" : b.name}>{b.name}</option>)}
              </select>
            </label>
            <Button size="sm" type="submit" disabled={busy || !newName.trim()}>{busy ? "Creating…" : "Create branch"}</Button>
          </form>
        ) : null}
        {renaming ? (
          <form aria-label="Rename branch" className="mb-3 flex flex-wrap items-center gap-2 rounded-md border border-border p-3" onSubmit={(e) => { e.preventDefault(); void doRename(); }}>
            <label htmlFor="branch-rename-to" className="text-xs text-muted-foreground">Rename <span className="font-mono">{renaming.name}</span> to</label>
            <input id="branch-rename-to" autoFocus value={rename} onChange={(e) => setRename(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-sm" />
            <Button size="sm" type="submit" disabled={!rename.trim()}>Rename</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setRenaming(null)}>Cancel</Button>
          </form>
        ) : null}
        {list.isLoading ? (
          <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}</div>
        ) : list.isError ? (
          <p role="alert" className="text-sm text-destructive">{feedbackError(list.error instanceof Error ? list.error.message : "", "Couldn’t load branches")} <button type="button" className="underline" onClick={() => void list.refetch()}>Retry</button></p>
        ) : branches.length === 0 ? (
          <EmptyState title={`No ${filter === "active" ? "" : `${filter} `}branches${filter === "active" ? " yet" : ""}`} body={filter === "active" ? "Make one with New branch, or from your terminal:" : filter === "stale" ? "Branches with no saves for 30 days show here." : filter === "merged" ? "Branches merged into main show here, ready to delete." : "Deleted branches can be restored for 30 days."} command={filter === "active" ? "nb branch create ram/try-new-header" : undefined} />
        ) : (
          <ul className="divide-y divide-border rounded-md border border-border">
            {branches.map((b) => {
              const on = b.isDefault ? !views?.branch : views?.branch?.toLowerCase() === b.name.toLowerCase();
              return (
                <li key={b.id} className="flex items-center gap-3 px-3 py-2.5">
                  <GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  {b.status === "deleted" ? (
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-mono text-sm text-foreground">{b.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">Deleted <When at={b.deletedAt} /> · restorable for 30 days</span>
                    </span>
                  ) : (
                    <button type="button" onClick={() => open(b)} aria-current={on} className="min-w-0 flex-1 text-left">
                      <span className="block truncate font-mono text-sm font-medium text-foreground">{b.name}{on ? <span className="ml-2 font-sans text-xs font-normal text-muted-foreground">(you’re on it)</span> : null}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {b.status === "merged" ? "Merged into main" : aheadBehind(b)}{b.createdBy && !b.isDefault ? ` · ${b.createdBy.name ?? `@${b.createdBy.username}`}` : ""}{b.lastSave ? <> · {b.lastSave.message} · <When at={b.lastSave.createdAt} />{b.lastSave.madeWith ? ` ${b.lastSave.madeWith}` : ""}</> : null}
                      </span>
                    </button>
                  )}
                  {b.mergeRequest ? <span className="shrink-0 rounded-[5px] border border-sky-300 px-1.5 py-0.5 text-xs text-sky-900 dark:border-sky-800 dark:text-sky-200">MR !{b.mergeRequest.number}{b.mergeRequest.state === "draft" ? " draft" : ""}</span> : null}
                  {b.stale ? <span className="shrink-0 rounded-[5px] border border-border px-1.5 py-0.5 text-xs text-muted-foreground">Stale</span> : null}
                  {b.status === "deleted" && canEdit ? <Button size="sm" variant="outline" onClick={() => void restore(b)}>Restore</Button> : null}
                  {b.status !== "deleted" && !b.isDefault && canEdit ? (
                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <button type="button" aria-label={`More for ${b.name}`} className="nb-touch-target flex size-8 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="size-4" aria-hidden /></button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => { setRenaming(b); setRename(b.name); }}><Pencil className="size-4" />Rename</DropdownMenuItem>
                        <DropdownMenuItem onSelect={() => setDeleting(b)}><Trash2 className="size-4" />Delete</DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title={`Delete ${deleting?.name}?`}
        description={`${deleting?.ahead && deleting.status !== "merged" ? `${deleting.ahead} save${deleting.ahead === 1 ? " isn't" : "s aren't"} in main. ` : ""}${deleting?.mergeRequest ? `Its merge request !${deleting.mergeRequest.number} closes. ` : ""}You can restore it for 30 days.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void doDelete()}
      />
    </div>
  );
}

/** A branch against main (Compare with main, on the bar): the files it changes, and each one's diff. */
export function BranchChanges({ branch }: { branch: BranchView }) {
  const changes = useQuery({ queryKey: ["branch-changes", branch.id, branch.lastSave?.id], queryFn: () => unwrap(branchChangesAction(branch.id)) });
  const [selected, setSelected] = useState<string | null>(null);
  const files = changes.data?.files ?? [];
  const current = selected ?? files[0]?.path ?? null;
  const diff = useQuery({ queryKey: ["branch-diff", branch.id, current, branch.lastSave?.id], enabled: Boolean(current), queryFn: () => unwrap(branchDiffAction(branch.id, current!)) });
  if (changes.isLoading) return <div className="m-4 h-24 animate-pulse rounded bg-muted" aria-busy="true" />;
  if (!files.length) return <p className="p-4 text-sm text-muted-foreground">Nothing on this branch differs from main yet.</p>;
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav aria-label="Files changed on this branch" className="max-h-64 overflow-y-auto border-b border-border md:max-h-none md:w-80 md:border-b-0 md:border-r">
        <ul className="py-1">
          {files.map((f) => (
            <li key={f.path}>
              <button type="button" onClick={() => setSelected(f.path)} aria-current={current === f.path} className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left", current === f.path && "bg-accent")}>
                <span className="w-14 shrink-0 text-[11px] text-muted-foreground">{f.op === "add" ? "Added" : f.op === "delete" ? "Deleted" : "Changed"}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{f.path}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section aria-label="Diff" className="min-h-0 min-w-0 flex-1 overflow-auto">
        {current ? <DiffView query={diff} label={`${current} · against main`} path={current} /> : null}
      </section>
    </div>
  );
}
