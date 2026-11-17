"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check, ChevronDown, ChevronRight, Download, FileText, Folder, FolderOpen, GitBranch, GitCompare, GitPullRequest, MoreHorizontal, Pencil, Plus, RefreshCw,
  Search, Trash2, Upload,
} from "lucide-react";

import {
  beginUploadOnBranchAction, branchByNameAction, branchFileTextAction, branchFolderAction, branchPathsAction, createBranchAction, deleteBranchAction,
  deleteOnBranchAction, finishUploadOnBranchAction, listBranchesAction, moveOnBranchAction, renameBranchAction, saveOnBranchAction, updateBranchAction,
  uploadContentOnBranchAction,
} from "@/app/actions/files/branches";
import { createMergeRequestAction } from "@/app/actions/files/merge-requests";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BranchView, UpdateConflict } from "@/lib/domain/branches";
import { downloadFile } from "@/lib/download";
import { feedbackError, toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { BranchChanges } from "./BranchesCollection";
import { FilesViewsMenu } from "./FilesHeader";
import { When } from "./ChangesCollection";
import { BRANCH_VIEWS, useFilesViews } from "./FilesViews";
import { useFilesTabRole } from "./FilesTabRoleContext";

/**
 * Branches like GitHub (report H2, the H-2b plan): the picker in the Files header switches the Files tab to a
 * branch; All files then shows the branch's tree (here, and in the sidebar), with the "On branch" bar above it.
 * Changes on a branch are saves on it: the app's edits through the branch writer, uploads through a change set.
 */
const unwrap = async <T,>(p: Promise<{ success: true; data: T } | { success: false; error: string }>) => {
  const res = await p;
  if (!res.success) throw new Error(res.error);
  return res.data;
};
const aheadBehind = (b: BranchView) => `${b.ahead} save${b.ahead === 1 ? "" : "s"} ahead, ${b.behind} behind main`;
const parentOf = (path: string) => path.slice(0, path.lastIndexOf("/")) || "/";
const join = (folder: string, name: string) => `${folder === "/" ? "" : folder}/${name.split("/").filter(Boolean).join("/")}`;
const zipName = (s: string) => s.replace(/[^A-Za-z0-9._-]+/g, "-");

/** The current branch's view (null on main). */
export function useCurrentBranch(projectId: string) {
  const views = useFilesViews();
  const name = views?.branch ?? null;
  return useQuery({ queryKey: ["branch", projectId, name], enabled: Boolean(name), queryFn: () => unwrap(branchByNameAction(projectId, name!)) });
}

function useRefreshBranch(projectId: string) {
  const client = useQueryClient();
  return () => {
    for (const key of ["branch", "branches", "branch-folder", "branch-paths", "branch-changes", "branch-file", "saves", "merge-requests"]) void client.invalidateQueries({ queryKey: [key] });
    void client.invalidateQueries({ queryKey: ["branch", projectId] });
  };
}

// ── The picker ("main ▾") ─────────────────────────────────────────────────────────────────────────────────────────

export function BranchPicker({ projectId }: { projectId: string }) {
  const views = useFilesViews();
  const { canEdit } = useFilesTabRole();
  const client = useQueryClient();
  const open = Boolean(views?.pickerOpen);
  const panel = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const list = useQuery({ queryKey: ["branches", projectId, "active"], enabled: open, queryFn: () => unwrap(listBranchesAction(projectId, "active")), staleTime: 15_000 });
  const current = views?.branch ?? null;
  const shown = useMemo(() => (list.data?.branches ?? []).filter((b) => !query || b.name.toLowerCase().includes(query.toLowerCase())).slice(0, 30), [list.data, query]);
  useEffect(() => {
    if (!open) { setQuery(""); setCreating(false); return; }
    const onDown = (e: MouseEvent) => {
      if (panel.current?.contains(e.target as Node) || button.current?.contains(e.target as Node)) return;
      views?.setPickerOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { views?.setPickerOpen(false); button.current?.focus(); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open, views]);
  if (!views?.historyEnabled || !BRANCH_VIEWS.includes(views.view)) return null;
  async function create() {
    const name = query.trim();
    if (!name) return;
    setBusy(true);
    try {
      const res = await createBranchAction(projectId, name, current ?? "main");
      if (!res.success) { toast.error(res.error); return; }
      void client.invalidateQueries({ queryKey: ["branches", projectId] });
      toast.success(`Created ${res.data.branch.name} from ${current ?? "main"}`);
      views!.setBranch(res.data.branch.name);
    } finally { setBusy(false); }
  }
  return (
    <div className="relative shrink-0">
      <button
        ref={button}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Branch: ${current ?? "main"}. Switch branch`}
        title="Switch branch (b)"
        onClick={() => views.setPickerOpen(!open)}
        className={cn(
          "flex min-h-8 max-w-[12rem] items-center gap-1.5 rounded-[5px] border px-2.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-[#D14E24]",
          current ? "border-amber-400 bg-amber-50 text-amber-950 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-100" : "border-border text-foreground hover:bg-muted",
        )}
      >
        <GitBranch className="size-3.5 shrink-0" aria-hidden />
        <span className="truncate font-mono">{current ?? "main"}</span>
        <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden />
      </button>
      {open ? (
        <div ref={panel} role="dialog" aria-label="Switch branch" className="absolute right-0 top-[calc(100%+6px)] z-50 w-[min(22rem,calc(100vw-16px))] rounded-md border border-border bg-popover p-2 text-popover-foreground shadow-lg">
          <p className="px-1 pb-2 text-xs font-semibold text-foreground">Switch branch</p>
          <label className="sr-only" htmlFor="branch-picker-search">Find or create a branch</label>
          <input
            id="branch-picker-search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && creating) void create(); }}
            placeholder={creating ? "New branch name, like ram/try-header" : "Find a branch"}
            className="mb-2 h-8 w-full rounded-md border border-border bg-background px-2 text-sm"
          />
          {creating ? (
            <div className="space-y-2 px-1 pb-1">
              <p className="text-xs text-muted-foreground">From <span className="font-mono">{current ?? "main"}</span>. Its files start as they are there.</p>
              <div className="flex gap-2">
                <Button size="sm" disabled={busy || !query.trim()} onClick={() => void create()}>{busy ? "Creating…" : "Create branch"}</Button>
                <Button size="sm" variant="ghost" onClick={() => setCreating(false)}>Cancel</Button>
              </div>
            </div>
          ) : (
            <>
              <ul aria-label="Branches" className="max-h-72 overflow-y-auto">
                {list.isLoading ? <li className="px-2 py-3 text-xs text-muted-foreground">Loading…</li> : shown.length === 0 ? (
                  <li className="px-2 py-3 text-xs text-muted-foreground">No branch matches{canEdit && query.trim() ? "; create it below" : ""}.</li>
                ) : shown.map((b) => {
                  const on = b.isDefault ? !current : current?.toLowerCase() === b.name.toLowerCase();
                  return (
                    <li key={b.id}>
                      <button type="button" onClick={() => views.setBranch(b.isDefault ? null : b.name)} aria-current={on} className={cn("flex w-full items-start gap-2 rounded px-2 py-1.5 text-left hover:bg-accent", on && "bg-accent")}>
                        <Check className={cn("mt-0.5 size-3.5 shrink-0", on ? "opacity-100" : "opacity-0")} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-mono text-sm text-foreground">{b.name}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{b.isDefault ? "The workspace's files" : aheadBehind(b)}{b.lastSave ? <> · <When at={b.lastSave.createdAt} /></> : null}</span>
                        </span>
                        {b.mergeRequest ? <span className="shrink-0 rounded-[4px] border border-sky-300 px-1 text-[10px] text-sky-900 dark:border-sky-800 dark:text-sky-200">MR !{b.mergeRequest.number}</span> : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
              <div className="mt-2 flex flex-wrap gap-2 border-t border-border pt-2">
                {canEdit ? <Button size="sm" variant="outline" onClick={() => setCreating(true)}><Plus className="size-4" aria-hidden />New branch</Button> : null}
                <Button size="sm" variant="ghost" onClick={() => { views.setPickerOpen(false); views.selectView("branches"); }}>View all branches</Button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </div>
  );
}

// ── The "On branch" bar ───────────────────────────────────────────────────────────────────────────────────────────

/** Ahead and behind, Compare with main, Update from main (with a choice per conflicting file), the merge request. */
export function BranchBar({ projectId, compare, onCompare }: { projectId: string; compare?: boolean; onCompare?: () => void }) {
  const views = useFilesViews();
  const { canEdit } = useFilesTabRole();
  const view = useCurrentBranch(projectId);
  const refresh = useRefreshBranch(projectId);
  const [busy, setBusy] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<UpdateConflict[] | null>(null);
  const [choices, setChoices] = useState<Record<string, "branch" | "main">>({});
  const [opening, setOpening] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [newName, setNewName] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  if (!views?.branch) return null;
  const b = view.data?.branch;
  if (view.isError) {
    return (
      <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
        <span className="min-w-0 flex-1">{view.error instanceof Error ? view.error.message : "This branch can't be opened"}</span>
        <Button size="sm" variant="outline" onClick={() => views.setBranch(null)}>Go to main</Button>
      </div>
    );
  }
  async function update(resolutions?: Record<string, "branch" | "main">) {
    setBusy("update");
    try {
      const res = await updateBranchAction(b!.id, resolutions);
      if (!res.success) { toast.error(res.error); return; }
      if (res.data.conflicts.length) { setConflicts(res.data.conflicts); return; }
      setConflicts(null);
      toast.success(res.data.upToDate ? "Already up to date with main" : "Updated from main");
      refresh();
    } finally { setBusy(null); }
  }
  async function rename() {
    const res = await renameBranchAction(b!.id, newName.trim());
    if (!res.success) { toast.error(res.error); return; }
    setRenaming(false);
    refresh();
    views!.setBranch(res.data.branch.name);
  }
  async function remove() {
    const res = await deleteBranchAction(b!.id);
    if (!res.success) { toast.error(res.error); return; }
    toast.success(`Deleted ${b!.name}; restorable for 30 days`);
    refresh();
    views!.setBranch(null);
  }
  const merged = b && b.status === "merged";
  return (
    <>
      <div role="status" aria-live="polite" aria-label="On branch" className="flex flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
        <GitBranch className="size-4 shrink-0" aria-hidden />
        {renaming ? (
          <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
            <label className="sr-only" htmlFor="branch-rename">New name</label>
            <input id="branch-rename" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-xs text-foreground" />
            <Button size="sm" type="submit" disabled={!newName.trim()}>Rename</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setRenaming(false)}>Cancel</Button>
          </form>
        ) : (
          <span className="min-w-0 flex-1">
            On branch <span className="font-mono font-semibold">{views.branch}</span>
            {b ? <> · {merged ? "merged into main" : b.ahead || b.changedFiles ? aheadBehind(b) : `nothing changed yet · ${b.behind} behind main`}</> : null}
          </span>
        )}
        {b && !renaming ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {onCompare && b.changedFiles > 0 ? <Button size="sm" variant="outline" aria-pressed={Boolean(compare)} onClick={onCompare}><GitCompare className="size-4" aria-hidden />{compare ? "Back to files" : "Compare with main"}</Button> : null}
            {canEdit && !merged && b.behind > 0 ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void update()}><RefreshCw className="size-4" aria-hidden />{busy === "update" ? "Updating…" : "Update from main"}</Button> : null}
            {b.mergeRequest ? (
              <Button size="sm" variant="outline" onClick={() => openMergeRequest(views, b.mergeRequest!.number)}><GitPullRequest className="size-4" aria-hidden />MR !{b.mergeRequest.number}</Button>
            ) : canEdit && !merged && b.changedFiles > 0 ? (
              <Button size="sm" onClick={() => setOpening((o) => !o)} aria-expanded={opening}><GitPullRequest className="size-4" aria-hidden />Open merge request</Button>
            ) : null}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={`More for ${b.name}`} className="nb-touch-target flex size-8 items-center justify-center rounded-[5px] border border-amber-300 hover:bg-amber-100 dark:border-amber-800 dark:hover:bg-amber-900/40"><MoreHorizontal className="size-4" aria-hidden /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => void downloadFile(`/api/v1/branches/${b.id}/zip`, { filename: `${zipName(b.name)}.zip` })}><Download className="size-4" />Download as zip</DropdownMenuItem>
                {canEdit ? <DropdownMenuItem onSelect={() => { setNewName(b.name); setRenaming(true); }}><Pencil className="size-4" />Rename</DropdownMenuItem> : null}
                {canEdit ? <DropdownMenuSeparator /> : null}
                {canEdit ? <DropdownMenuItem onSelect={() => setConfirmDelete(true)}><Trash2 className="size-4" />Delete branch</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        ) : null}
      </div>
      {opening && b ? <OpenMergeRequest projectId={projectId} branch={b} onDone={(n) => { setOpening(false); refresh(); openMergeRequest(views, n); }} /> : null}
      {conflicts ? (
        <section aria-label="Update conflicts" className="border-b border-border px-4 py-3">
          <p className="mb-2 text-sm text-foreground">{conflicts.length} file{conflicts.length === 1 ? "" : "s"} changed on both this branch and main. Choose for each, then update:</p>
          <ul className="space-y-1">
            {conflicts.map((c) => (
              <li key={c.path} className="flex flex-wrap items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate font-mono text-xs">{c.path}</span>
                {(["branch", "main"] as const).map((v) => (
                  <label key={v} className="inline-flex items-center gap-1 text-xs"><input type="radio" name={`conflict-${c.path}`} checked={choices[c.path] === v} onChange={() => setChoices((x) => ({ ...x, [c.path]: v }))} />{v === "branch" ? "Keep the branch's" : "Take main's"}</label>
                ))}
              </li>
            ))}
          </ul>
          <Button className="mt-2" size="sm" disabled={conflicts.some((c) => !choices[c.path]) || Boolean(busy)} onClick={() => void update(choices)}>Update from main</Button>
        </section>
      ) : null}
      {b ? (
        <ConfirmDialog
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${b.name}?`}
          description={`${b.ahead && !merged ? `${b.ahead} save${b.ahead === 1 ? " isn't" : "s aren't"} in main. ` : ""}${b.mergeRequest ? `Its merge request !${b.mergeRequest.number} closes. ` : ""}You can restore it for 30 days.`}
          confirmLabel="Delete"
          variant="destructive"
          onConfirm={() => void remove()}
        />
      ) : null}
    </>
  );
}

/** To a merge request's page: the view first (switching views clears ?mr=), then the number it opens on. */
function openMergeRequest(views: ReturnType<typeof useFilesViews>, n: number) {
  views?.selectView("merge-requests");
  const url = new URL(window.location.href);
  url.searchParams.set("mr", String(n));
  window.history.replaceState(window.history.state, "", url);
}

/** New merge request (H4): into main, pre-filled on the server (title from the task or branch, the saves listed). */
function OpenMergeRequest({ projectId, branch, onDone }: { projectId: string; branch: BranchView; onDone: (n: number) => void }) {
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [draft, setDraft] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit() {
    setBusy(true);
    try {
      const res = await createMergeRequestAction(projectId, { source: branch.name, title: title.trim() || null, description: description.trim() || null, draft });
      if (!res.success) { toast.error(res.error); return; }
      toast.success(`Opened !${res.data.mergeRequest.number}`);
      onDone(res.data.mergeRequest.number);
    } finally { setBusy(false); }
  }
  return (
    <form aria-label="New merge request" className="space-y-2 border-b border-border px-4 py-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p className="text-sm text-foreground">Merge <span className="font-mono">{branch.name}</span> into main, after review.</p>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Title
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={branch.task ? `Task #${branch.task.number}’s title` : "From the branch name"} className="h-8 rounded-md border border-border bg-background px-2 text-sm text-foreground" />
      </label>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Leave it empty to list the branch’s saves. “Closes #4” links a task, which moves when this merges." className="rounded-md border border-border bg-background p-2 text-sm text-foreground" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />Draft (reviewers aren’t asked yet)</label>
        <Button size="sm" type="submit" disabled={busy}>{busy ? "Opening…" : "Open merge request"}</Button>
      </div>
    </form>
  );
}

// ── All files on a branch ─────────────────────────────────────────────────────────────────────────────────────────

export function BranchExplorer({ projectId }: { projectId: string }) {
  const views = useFilesViews()!;
  const branch = useCurrentBranch(projectId);
  const [compare, setCompare] = useState(false);
  const b = branch.data?.branch;
  return (
    <section aria-label={`Files on ${views.branch}`} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card dark:bg-background">
      <FilesViewsMenu projectId={projectId} />
      <BranchBar projectId={projectId} compare={compare} onCompare={() => setCompare((c) => !c)} />
      {!b ? (
        branch.isLoading ? <div className="space-y-2 p-4" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-muted" />)}</div> : null
      ) : compare ? (
        <BranchChanges branch={b} />
      ) : views.branchFile ? (
        <BranchFileView key={views.branchFile} projectId={projectId} branch={b} path={views.branchFile} />
      ) : (
        <BranchFolder projectId={projectId} branch={b} folder={views.branchFolder} />
      )}
    </section>
  );
}

function Crumbs({ branch, path }: { branch: BranchView; path: string }) {
  const views = useFilesViews()!;
  const parts = path.split("/").filter(Boolean);
  return (
    <nav aria-label="Branch breadcrumb" className="flex min-w-0 flex-1 flex-wrap items-center gap-1 text-sm">
      <button type="button" onClick={() => views.openBranchPath("/")} className="font-mono font-medium text-foreground hover:underline">{branch.name}</button>
      {parts.map((p, i) => {
        const to = `/${parts.slice(0, i + 1).join("/")}`;
        const last = i === parts.length - 1;
        return (
          <span key={to} className="flex min-w-0 items-center gap-1">
            <span aria-hidden className="text-muted-foreground">/</span>
            {last ? <span className="truncate text-foreground" aria-current="page">{p}</span> : <button type="button" onClick={() => views.openBranchPath(to)} className="truncate text-muted-foreground hover:text-foreground hover:underline">{p}</button>}
          </span>
        );
      })}
    </nav>
  );
}

function BranchFolder({ projectId, branch, folder }: { projectId: string; branch: BranchView; folder: string }) {
  const views = useFilesViews()!;
  const { canEdit } = useFilesTabRole();
  const refresh = useRefreshBranch(projectId);
  const list = useQuery({ queryKey: ["branch-folder", branch.id, folder, branch.lastSave?.id], queryFn: () => unwrap(branchFolderAction(branch.id, folder)) });
  const [query, setQuery] = useState("");
  const paths = useQuery({ queryKey: ["branch-paths", branch.id, branch.lastSave?.id], enabled: Boolean(query.trim()), queryFn: () => unwrap(branchPathsAction(branch.id)) });
  const [adding, setAdding] = useState(false);
  const [moving, setMoving] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const files = useRef<HTMLInputElement>(null);
  const dir = useRef<HTMLInputElement>(null);
  const upload = useBranchUpload(branch, refresh);
  const merged = branch.status === "merged";
  const write = canEdit && !merged;
  const matches = query.trim() ? (paths.data?.paths ?? []).filter((p) => p.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 200) : null;

  async function move() {
    const res = await moveOnBranchAction(branch.id, moving!, moveTo.trim().startsWith("/") ? moveTo.trim() : join(parentOf(moving!), moveTo.trim()));
    if (!res.success) { toast.error(res.error); return; }
    toast.success(`Saved on ${branch.name}`);
    setMoving(null);
    refresh();
  }
  async function remove() {
    const res = await deleteOnBranchAction(branch.id, deleting!);
    if (!res.success) { toast.error(res.error); return; }
    toast.success(`Deleted on ${branch.name}; main keeps it`);
    setDeleting(null);
    refresh();
  }
  const rowMenu = (path: string, isFolder: boolean) => (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild>
        <button type="button" aria-label={`Actions for ${path.split("/").pop()}`} className="nb-touch-target flex size-7 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="size-4" aria-hidden /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onSelect={() => void downloadFile(isFolder ? `/api/v1/branches/${branch.id}/zip?path=${encodeURIComponent(path)}` : `/api/v1/branches/${branch.id}/raw?path=${encodeURIComponent(path)}`, { filename: isFolder ? `${zipName(branch.name)}-${zipName(path.split("/").pop()!)}.zip` : path.split("/").pop()! })}><Download className="size-4" />{isFolder ? "Download as zip" : "Download"}</DropdownMenuItem>
        {write ? <DropdownMenuItem onSelect={() => { setMoving(path); setMoveTo(path); }}><Pencil className="size-4" />Rename or move</DropdownMenuItem> : null}
        {write ? <DropdownMenuItem onSelect={() => setDeleting(path)}><Trash2 className="size-4" />Delete</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Crumbs branch={branch} path={folder} />
        <div className="relative min-w-0 basis-40">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label className="sr-only" htmlFor="branch-name-search">Find a file on this branch</label>
          <input id="branch-name-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Go to file" className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-sm" />
        </div>
        {write ? <Button size="sm" variant="outline" onClick={() => setAdding(true)}><Plus className="size-4" aria-hidden />New file</Button> : null}
        {write ? (
          <DropdownMenu modal={false}>
            <DropdownMenuTrigger asChild><Button size="sm" variant="outline" disabled={upload.busy}><Upload className="size-4" aria-hidden />{upload.busy ? "Uploading…" : "Upload"}</Button></DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => files.current?.click()}>Upload files</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => dir.current?.click()}>Upload a folder</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <input ref={files} type="file" multiple hidden aria-hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) void upload.send(f, folder); }} />
        <input ref={dir} type="file" multiple hidden aria-hidden {...{ webkitdirectory: "" }} onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) void upload.send(f, folder); }} />
      </div>
      {adding ? <NewFile branch={branch} folder={folder} onClose={() => setAdding(false)} onSaved={(path) => { setAdding(false); refresh(); views.openBranchPath(parentOf(path), path); }} /> : null}
      {moving ? (
        <form aria-label="Rename or move" className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-sm" onSubmit={(e) => { e.preventDefault(); void move(); }}>
          <label htmlFor="branch-move-to" className="text-xs text-muted-foreground">Rename or move <span className="font-mono">{moving}</span> to</label>
          <input id="branch-move-to" autoFocus value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-xs" />
          <Button size="sm" type="submit" disabled={!moveTo.trim() || moveTo.trim() === moving}>Save</Button>
          <Button size="sm" variant="ghost" type="button" onClick={() => setMoving(null)}>Cancel</Button>
        </form>
      ) : null}
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {matches ? (
          paths.isLoading ? <div className="h-16 animate-pulse rounded bg-muted" aria-busy="true" /> : (
            <ul aria-label="Matching files" className="divide-y divide-border rounded-md border border-border">
              {matches.length ? matches.map((p) => (
                <li key={p}><button type="button" onClick={() => views.openBranchPath(parentOf(p), p)} className="flex w-full items-center gap-2 px-3 py-1.5 text-left font-mono text-xs hover:bg-accent"><FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /><span className="truncate">{p}</span></button></li>
              )) : <li className="px-3 py-3 text-sm text-muted-foreground">No file on this branch matches “{query}”.</li>}
            </ul>
          )
        ) : list.isLoading ? (
          <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-9 animate-pulse rounded bg-muted" />)}</div>
        ) : list.isError ? (
          <p role="alert" className="text-sm text-destructive">{feedbackError(list.error instanceof Error ? list.error.message : "", "Couldn’t open this folder")} <button type="button" className="underline" onClick={() => views.openBranchPath("/")}>Go to the top</button></p>
        ) : (
          <table className="w-full table-fixed text-sm">
            <caption className="sr-only">Files in {folder} on {branch.name}</caption>
            <colgroup><col /><col className="w-24" /><col className="w-10" /></colgroup>
            <thead className="sr-only"><tr><th scope="col">Name</th><th scope="col">Size</th><th scope="col">Actions</th></tr></thead>
            <tbody className="divide-y divide-border">
              {folder !== "/" ? (
                <tr><td colSpan={3}><button type="button" onClick={() => views.openBranchPath(parentOf(folder))} className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-muted-foreground hover:text-foreground">..</button></td></tr>
              ) : null}
              {list.data!.folders.map((f) => (
                <tr key={f.path} className="hover:bg-accent/50">
                  <td className="py-1.5 pl-2"><button type="button" onClick={() => views.openBranchPath(f.path)} className="flex min-w-0 items-center gap-2 text-left"><Folder className="size-4 shrink-0 text-muted-foreground" aria-hidden /><span className="truncate text-foreground">{f.name}</span></button></td>
                  <td className="w-24 text-right text-xs text-muted-foreground">{f.files} file{f.files === 1 ? "" : "s"}</td>
                  <td className="w-10 text-right">{rowMenu(f.path, true)}</td>
                </tr>
              ))}
              {list.data!.files.map((f) => (
                <tr key={f.path} className="hover:bg-accent/50">
                  <td className="py-1.5 pl-2">
                    <button type="button" onClick={() => views.openBranchPath(folder, f.path)} className="flex min-w-0 items-center gap-2 text-left">
                      <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="truncate text-foreground">{f.name}</span>
                      {f.own ? <span className="shrink-0 rounded-[4px] border border-amber-300 px-1 text-[10px] text-amber-900 dark:border-amber-800 dark:text-amber-200">changed here</span> : null}
                    </button>
                  </td>
                  <td className="w-24 text-right text-xs text-muted-foreground">{f.size != null ? formatBytes(f.size) : ""}</td>
                  <td className="w-10 text-right">{rowMenu(f.path, false)}</td>
                </tr>
              ))}
              {!list.data!.folders.length && !list.data!.files.length ? <tr><td colSpan={3} className="px-2 py-6 text-center text-sm text-muted-foreground">No files here on this branch.</td></tr> : null}
            </tbody>
          </table>
        )}
      </div>
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => { if (!o) setDeleting(null); }} title={`Delete ${deleting?.split("/").pop()} on ${branch.name}?`} description="Only on this branch; main keeps it. Revert the save to bring it back." confirmLabel="Delete" variant="destructive" onConfirm={() => void remove()} />
      {upload.dialog}
    </div>
  );
}

function formatBytes(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function NewFile({ branch, folder, onClose, onSaved }: { branch: BranchView; folder: string; onClose: () => void; onSaved: (path: string) => void }) {
  const [name, setName] = useState("");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  async function save() {
    const path = name.trim().startsWith("/") ? name.trim() : join(folder, name.trim());
    setBusy(true);
    try {
      const res = await saveOnBranchAction(branch.id, { path, text, expectedHash: null });
      if (!res.success) { toast.error(res.error); return; }
      toast.success(`Saved on ${branch.name}`);
      onSaved(path);
    } finally { setBusy(false); }
  }
  return (
    <form aria-label="New file" className="space-y-2 border-b border-border px-4 py-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="flex flex-col gap-1 text-xs text-muted-foreground">Name (a/b.md makes folders)
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="notes.md" className="h-8 rounded-md border border-border bg-background px-2 font-mono text-sm text-foreground" />
      </label>
      <label className="sr-only" htmlFor="branch-new-file">File content</label>
      <textarea id="branch-new-file" value={text} onChange={(e) => setText(e.target.value)} rows={6} spellCheck={false} className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground" />
      <div className="flex gap-2">
        <Button size="sm" type="submit" disabled={busy || !name.trim()}>{busy ? "Saving…" : `Save on ${branch.name}`}</Button>
        <Button size="sm" variant="ghost" type="button" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

const PREVIEW_IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/;

function BranchFileView({ projectId, branch, path }: { projectId: string; branch: BranchView; path: string }) {
  const views = useFilesViews()!;
  const { canEdit } = useFilesTabRole();
  const refresh = useRefreshBranch(projectId);
  const file = useQuery({ queryKey: ["branch-file", branch.id, path, branch.lastSave?.id], queryFn: () => unwrap(branchFileTextAction(branch.id, path)) });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { if (file.data?.text != null && text === null) setText(file.data.text); }, [file.data, text]);
  const write = canEdit && branch.status !== "merged";
  const raw = `/api/v1/branches/${branch.id}/raw?path=${encodeURIComponent(path)}`;
  const mime = (file.data?.mimeType ?? "").toLowerCase();
  async function save() {
    setBusy(true);
    try {
      const res = await saveOnBranchAction(branch.id, { path, text: text ?? "", expectedHash: file.data?.contentHash ?? null });
      if (!res.success) { toast.error(res.error); return; }
      toast.success(res.data.save ? `Saved on ${branch.name}` : "No changes to save");
      setEditing(false);
      refresh();
    } finally { setBusy(false); }
  }
  async function remove() {
    const res = await deleteOnBranchAction(branch.id, path);
    if (!res.success) { toast.error(res.error); return; }
    toast.success(`Deleted on ${branch.name}; main keeps it`);
    refresh();
    views.openBranchPath(parentOf(path));
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2">
        <Crumbs branch={branch} path={path} />
        {file.data?.own ? <span className="rounded-[4px] border border-amber-300 px-1 text-[10px] text-amber-900 dark:border-amber-800 dark:text-amber-200">changed on this branch</span> : null}
        <Button size="sm" variant="outline" onClick={() => void downloadFile(raw, { filename: path.split("/").pop()! })}><Download className="size-4" aria-hidden />Download</Button>
        {write && file.data?.text != null && !editing ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden />Edit</Button> : null}
        {write ? <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" aria-hidden />Delete</Button> : null}
        {editing ? <Button size="sm" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : `Save on ${branch.name}`}</Button> : null}
        {editing ? <Button size="sm" variant="ghost" onClick={() => { setEditing(false); setText(file.data?.text ?? null); }}>Cancel</Button> : null}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto px-4 py-3">
        {file.isLoading ? <div className="h-40 animate-pulse rounded bg-muted" aria-busy="true" /> : file.isError ? (
          <p role="alert" className="text-sm text-destructive">{file.error instanceof Error ? file.error.message : "Couldn’t open this file"}</p>
        ) : editing ? (
          <>
            <label className="sr-only" htmlFor="branch-editor">File content</label>
            <textarea id="branch-editor" value={text ?? ""} onChange={(e) => setText(e.target.value)} spellCheck={false} className="min-h-[24rem] flex-1 rounded-md border border-border bg-background p-2 font-mono text-xs leading-5 text-foreground" />
          </>
        ) : file.data?.text != null ? (
          <pre aria-label={`Content of ${path}`} className="min-h-0 overflow-auto rounded-md border border-border font-mono text-xs leading-5 text-foreground">
            {file.data.text.split("\n").map((line, i) => (
              <div key={i} className="flex"><span aria-hidden className="w-12 shrink-0 select-none pr-3 text-right text-muted-foreground">{i + 1}</span><span className="whitespace-pre">{line || " "}</span></div>
            ))}
          </pre>
        ) : PREVIEW_IMAGE.test(mime) ? (
          <img src={`${raw}&inline=1`} alt={path.split("/").pop()} className="max-h-[70vh] max-w-full self-start rounded-md border border-border object-contain" />
        ) : mime === "application/pdf" ? (
          <iframe title={path.split("/").pop()} src={`${raw}&inline=1`} className="min-h-[70vh] w-full rounded-md border border-border" />
        ) : (
          <p className="text-sm text-muted-foreground">No preview for this file ({file.data?.size != null ? formatBytes(file.data.size) : "?"}). Download it, or work on it from a folder on this branch.</p>
        )}
      </div>
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${path.split("/").pop()} on ${branch.name}?`} description="Only on this branch; main keeps it. Revert the save to bring it back." confirmLabel="Delete" variant="destructive" onConfirm={() => void remove()} />
    </div>
  );
}

// ── Uploads on a branch: a change set on the branch, like the CLI's ───────────────────────────────────────────────

const INLINE_LIMIT = 2 * 1024 * 1024; // base64 grows a third; server actions take 4 MB
const FILE_LIMIT = 25 * 1024 * 1024;

async function sha256(file: Blob) {
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function base64(file: Blob) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function useBranchUpload(branch: BranchView, refresh: () => void) {
  const [busy, setBusy] = useState(false);
  const [held, setHeld] = useState<{ setId: string; files: Array<{ file: File; hash: string }>; paths: string[] } | null>(null);
  async function sendContent(setId: string, entries: Array<{ file: File; hash: string }>, confirmSecrets = false) {
    let batch: Array<{ hash: string; base64: string }> = [];
    let size = 0;
    const flush = async () => {
      if (!batch.length) return;
      const res = await uploadContentOnBranchAction(setId, { files: batch, confirmSecrets });
      if (!res.success) throw new Error(res.error);
      batch = [];
      size = 0;
    };
    for (const e of entries) {
      if (e.file.size > INLINE_LIMIT) {
        const first = await uploadContentOnBranchAction(setId, { hash: e.hash, confirmSecrets });
        if (!first.success) throw new Error(first.error);
        const up = (first.data as { upload?: { url: string; contentType?: string } }).upload;
        if (up) {
          const put = await fetch(up.url, { method: "PUT", body: e.file, headers: { "content-type": up.contentType ?? "application/octet-stream" } });
          if (!put.ok) throw new Error(`Couldn’t upload ${e.file.name}`);
          const check = await uploadContentOnBranchAction(setId, { hash: e.hash, confirmSecrets });
          if (!check.success) throw new Error(check.error);
        }
        continue;
      }
      if (size + e.file.size > INLINE_LIMIT) await flush();
      batch.push({ hash: e.hash, base64: await base64(e.file) });
      size += e.file.size;
    }
    await flush();
  }
  async function finish(setId: string, confirmSecrets = false) {
    const res = await finishUploadOnBranchAction(setId, confirmSecrets);
    if (!res.success) return res;
    toast.success(`Saved on ${branch.name}`);
    refresh();
    return res;
  }
  async function send(files: File[], folder: string) {
    const big = files.find((f) => f.size > FILE_LIMIT);
    if (big) { toast.error(`${big.name} is over the 25 MB per-file limit`); return; }
    setBusy(true);
    try {
      const entries = await Promise.all(files.map(async (file) => ({ file, hash: await sha256(file), path: join(folder, (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name) })));
      const begun = await beginUploadOnBranchAction(branch.id, entries.map((e) => ({ path: e.path, hash: e.hash, size: e.file.size, mimeType: e.file.type || null })));
      if (!begun.success) { toast.error(begun.error); return; }
      const setId = begun.data.changeSetId;
      await sendContent(setId, entries);
      const done = await finish(setId);
      if (!done.success && done.code === "SECRET_DETECTED") {
        const findings = (done.details?.findings ?? []) as Array<{ path?: string }>;
        const paths = [...new Set(findings.map((f) => f.path ?? "a file"))];
        setHeld({ setId, files: entries.filter((e) => paths.includes(e.path)), paths });
        return;
      }
      if (!done.success) toast.error(done.error);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The upload didn’t finish");
    } finally { setBusy(false); }
  }
  const dialog = (
    <ConfirmDialog
      open={Boolean(held)}
      onOpenChange={(o) => { if (!o) setHeld(null); }}
      title="Upload files that look like they hold a key?"
      description={`${(held?.paths ?? []).join(", ")} ${held?.paths.length === 1 ? "looks" : "look"} like ${held?.paths.length === 1 ? "it holds" : "they hold"} a password or key. Upload only if it’s safe for everyone in the workspace to see.`}
      confirmLabel="Upload anyway"
      variant="destructive"
      onConfirm={() => {
        const h = held!;
        setHeld(null);
        setBusy(true);
        void (async () => {
          try {
            await sendContent(h.setId, h.files, true);
            const done = await finish(h.setId, true);
            if (!done.success) toast.error(done.error);
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "The upload didn’t finish");
          } finally { setBusy(false); }
        })();
      }}
    />
  );
  return { busy, send, dialog };
}

// ── The sidebar tree on a branch ──────────────────────────────────────────────────────────────────────────────────

type TreeNode = { name: string; path: string; folders: Map<string, TreeNode>; files: string[] };

export function BranchTree({ projectId }: { projectId: string }) {
  const views = useFilesViews()!;
  const branch = useCurrentBranch(projectId);
  const b = branch.data?.branch;
  const paths = useQuery({ queryKey: ["branch-paths", b?.id, b?.lastSave?.id], enabled: Boolean(b), queryFn: () => unwrap(branchPathsAction(b!.id)) });
  const [open, setOpen] = useState<Set<string>>(() => new Set(ancestors(views.branchFolder)));
  useEffect(() => { setOpen((o) => new Set([...o, ...ancestors(views.branchFolder)])); }, [views.branchFolder]);
  const root = useMemo(() => {
    const top: TreeNode = { name: "", path: "/", folders: new Map(), files: [] };
    for (const p of paths.data?.paths ?? []) {
      const parts = p.split("/").filter(Boolean);
      let at = top;
      for (let i = 0; i < parts.length - 1; i++) {
        const path = `/${parts.slice(0, i + 1).join("/")}`;
        if (!at.folders.has(parts[i]!)) at.folders.set(parts[i]!, { name: parts[i]!, path, folders: new Map(), files: [] });
        at = at.folders.get(parts[i]!)!;
      }
      at.files.push(p);
    }
    return top;
  }, [paths.data]);
  if (paths.isLoading || branch.isLoading) return <div className="space-y-1 p-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-6 animate-pulse rounded bg-muted" />)}</div>;
  if (paths.isError) return <p role="alert" className="p-3 text-xs text-destructive">Couldn’t load this branch’s files.</p>;
  const toggle = (path: string) => setOpen((o) => { const n = new Set(o); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  const render = (node: TreeNode, depth: number): React.ReactNode[] => [
    ...[...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name)).flatMap((f) => [
      <li key={f.path} role="treeitem" aria-expanded={open.has(f.path)} aria-level={depth + 1} aria-selected={views.branchFolder === f.path && !views.branchFile}>
        <button type="button" onClick={() => { toggle(f.path); views.openBranchPath(f.path); }} style={{ paddingLeft: 8 + depth * 14 }} className={cn("flex w-full items-center gap-1 py-1 pr-2 text-left text-xs hover:bg-accent", views.branchFolder === f.path && !views.branchFile && "bg-accent")}>
          {open.has(f.path) ? <ChevronDown className="size-3 shrink-0" aria-hidden /> : <ChevronRight className="size-3 shrink-0" aria-hidden />}
          {open.has(f.path) ? <FolderOpen className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <Folder className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
          <span className="truncate">{f.name}</span>
        </button>
      </li>,
      ...(open.has(f.path) ? render(f, depth + 1) : []),
    ]),
    ...node.files.sort().map((p) => (
      <li key={p} role="treeitem" aria-level={depth + 1} aria-selected={views.branchFile === p}>
        <button type="button" onClick={() => views.openBranchPath(parentOf(p), p)} style={{ paddingLeft: 22 + depth * 14 }} className={cn("flex w-full items-center gap-1 py-1 pr-2 text-left text-xs hover:bg-accent", views.branchFile === p && "bg-accent")}>
          <FileText className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
          <span className="truncate">{p.split("/").pop()}</span>
        </button>
      </li>
    )),
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-xs text-amber-900 dark:text-amber-200"><GitBranch className="size-3.5" aria-hidden /><span className="truncate font-mono">{views.branch}</span></p>
      <ul role="tree" aria-label={`Files on ${views.branch}`} className="min-h-0 flex-1 overflow-y-auto py-1">{render(root, 0)}</ul>
    </div>
  );
}

function ancestors(folder: string) {
  const parts = folder.split("/").filter(Boolean);
  return parts.map((_, i) => `/${parts.slice(0, i + 1).join("/")}`);
}
