"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Check, ChevronDown, ChevronRight, Download, FileText, Folder, FolderInput, FolderOpen, GitBranch, GitCompare, GitPullRequest, History, MoreHorizontal, Pencil, Plus,
  RefreshCw, Trash2, Upload,
} from "lucide-react";

import {
  beginUploadOnBranchAction, branchByNameAction, branchFileTextAction, branchFolderAction, branchPathsAction, createBranchAction, deleteBranchAction, restoreBranchAction,
  deleteOnBranchAction, finishUploadOnBranchAction, listBranchesAction, moveOnBranchAction, renameBranchAction, saveOnBranchAction, updateBranchAction,
  uploadContentOnBranchAction,
} from "@/app/actions/files/branches";
import { createMergeRequestAction } from "@/app/actions/files/merge-requests";
import { useStepUp } from "@/components/trust/StepUp";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { BranchView, UpdateConflict } from "@/lib/domain/branches";
import { downloadFile } from "@/lib/download";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { useMediaQuery } from "@/hooks/useMediaQuery";
import { toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import MarkdownPreview from "../preview/MarkdownPreview";
import { BranchChanges } from "./BranchesCollection";
import { FileTypeChip } from "./FileTypeChip";
import {
  Cell, FilesHeaderTitle, FilesStrip, GridRow, HeaderCrumbs, NameCell, StatusBadge, headerButton, headerPrimary, stripButton, stripPrimary,
} from "./FilesChrome";
import { FilesHeaderSlot, FilesViewsMenu } from "./FilesHeader";
import { BRANCH_VIEWS, useFilesViews } from "./FilesViews";
import { useFilesTabRole } from "./FilesTabRoleContext";
import { CodeMirrorEditor } from "./file/TextViewer";
import { readEditDraft, useEditDraft } from "./useDraft";
import { ProtectedUploadOffer, takePendingUpload } from "./SaveToBranch";
import listStyles from "./folder/FolderList.module.css";
import { FolderListHeader } from "./folder/FolderListHeader";
import { FolderListEmpty, FolderListError, FolderListLoading } from "./folder/FolderListStates";

/**
 * Branches like GitHub (report H2, the H-2b plan; design audit 17 Nov 2026): the picker in the Files header switches
 * the Files tab to a branch. All files then shows the branch on the explorer's own grid, with the branch's path in
 * the header, its actions in the header, and the "On branch" strip flush under it. Changes on a branch are saves on it.
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
const MAIN_ONLY_NOTE = "Task files, Recent, Starred, Trash and Changes are always main’s";
const fieldClass = "h-8 rounded-[5px] border border-border bg-background px-2 text-xs text-foreground focus:border-[#D14E24] focus:outline-none";
const menuClass = "rounded-[8px] border border-border bg-card p-1 shadow-md";
const itemClass = "rounded-[5px] text-xs";

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

// ── The picker ("main ▾"), on the app's dropdown menu ────────────────────────────────────────────────────────────

const NEW_KEY = "nb:new:branches";

export function BranchPicker({ projectId }: { projectId: string }) {
  const views = useFilesViews();
  const { canEdit } = useFilesTabRole();
  const client = useQueryClient();
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);
  const open = Boolean(views?.pickerOpen);
  const list = useQuery({ queryKey: ["branches", projectId, "active"], enabled: open, queryFn: () => unwrap(listBranchesAction(projectId, "active")), staleTime: 15_000 });
  const current = views?.branch ?? null;
  const shown = useMemo(() => (list.data?.branches ?? []).filter((b) => !query || b.name.toLowerCase().includes(query.toLowerCase())).slice(0, 30), [list.data, query]);
  useEffect(() => { if (!open) { setQuery(""); setCreating(false); } }, [open]);
  // H23 / 0.8 #3: a "New" dot until the picker is first opened; that first time it says what branches are.
  const [fresh, setFresh] = useState(false);
  const [intro, setIntro] = useState(false);
  useEffect(() => { try { setFresh(!window.localStorage.getItem(NEW_KEY)); } catch { /* private mode: no dot */ } }, []);
  useEffect(() => {
    if (!open || !fresh) return;
    setFresh(false);
    setIntro(true);
    try { window.localStorage.setItem(NEW_KEY, "1"); } catch { /* private mode */ }
  }, [open, fresh]);
  const phone = useMediaQuery("(max-width: 639px)") === true;
  if (!views?.historyEnabled) return null;
  // Main-only views keep the picker in its place, on main (design audit F6).
  const mainOnly = !BRANCH_VIEWS.includes(views.view);
  const onBranch = Boolean(current) && !mainOnly;
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
  const trigger = (
    <button
      type="button"
      aria-label={mainOnly ? `Branch: main. ${MAIN_ONLY_NOTE}` : `Branch: ${current ?? "main"}. Switch branch`}
      title={mainOnly ? MAIN_ONLY_NOTE : "Switch branch (b)"}
      disabled={mainOnly}
      onClick={phone ? () => views.setPickerOpen(true) : undefined}
      className={cn(
        headerButton, "max-w-[13rem] font-mono",
        onBranch && "border-[color-mix(in_srgb,var(--status-warning)_45%,transparent)] bg-[var(--status-warning-soft)] text-[var(--status-warning)] hover:bg-[var(--status-warning-soft)]",
      )}
    >
      <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{onBranch ? current : "main"}</span>
      <ChevronDown className="size-3.5 shrink-0 opacity-70" aria-hidden="true" />
      {fresh && !mainOnly ? <span className="size-1.5 shrink-0 rounded-full bg-[#D14E24]" role="img" aria-label="New" /> : null}
    </button>
  );
  const introLine = intro ? <p className="px-2 pb-1.5 pt-1 text-xs text-muted-foreground">Branches let you try changes without touching main. Merge when you’re happy.</p> : null;
  const search = (
    <div className="px-1 pb-1 pt-0.5">
      <label htmlFor="branch-picker-search" className="sr-only">Find or create a branch</label>
      <input
        id="branch-picker-search"
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        // The menu's own keys (type-ahead, arrows) stay out of the field; Enter creates when creating.
        onKeyDown={(e) => { if (e.key !== "Escape" && e.key !== "ArrowDown") e.stopPropagation(); if (e.key === "Enter" && creating) void create(); }}
        placeholder={creating ? "New branch name, like ram/try-header" : "Find a branch"}
        className={cn(fieldClass, "w-full")}
      />
    </div>
  );
  const createForm = (
    <div className="space-y-2 px-2 pb-2 pt-1">
      <p className="text-xs text-muted-foreground">From <span className="font-mono text-foreground">{current ?? "main"}</span>: its files start as they are there.</p>
      <div className="flex gap-2">
        <button type="button" className={stripPrimary} disabled={busy || !query.trim()} onClick={() => void create()}>{busy ? "Creating…" : "Create branch"}</button>
        <button type="button" className={stripButton} onClick={() => setCreating(false)}>Cancel</button>
      </div>
    </div>
  );
  const loading = list.isLoading ? <div role="status" aria-label="Loading branches" className="space-y-2 px-2 py-2">{[64, 44, 56].map((w) => <Skeleton key={w} className="h-3.5 rounded-[3px]" style={{ width: `${w}%` }} />)}</div> : null;
  const none = <p className="px-2 py-2 text-xs text-muted-foreground">No branch matches{canEdit && query.trim() ? "; create it below" : ""}.</p>;
  const isOn = (b: BranchView) => (b.isDefault ? !current : current?.toLowerCase() === b.name.toLowerCase());
  const rowBody = (b: BranchView) => (
    <>
      <Check className={cn("mt-0.5 size-3.5 shrink-0", isOn(b) ? "opacity-100" : "opacity-0")} aria-hidden="true" />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono">{b.name}</span>
        <span className="block truncate font-mono text-[11px]">{b.isDefault ? "The workspace’s files" : aheadBehind(b)}</span>
      </span>
      {b.mergeRequest ? <StatusBadge tone="info">MR !{b.mergeRequest.number}</StatusBadge> : null}
    </>
  );
  // On a phone the picker is a bottom sheet with search (H23 journey 8); the rows are plain buttons there.
  if (phone) return (
    <>
      <ProtectedUploadOffer projectId={projectId} onBranch={(name) => { views.selectView("project"); views.setBranch(name); }} />
      {trigger}
      <Dialog open={open && !mainOnly} onOpenChange={(o) => views.setPickerOpen(o)}>
        <DialogContent presentation="bottom-sheet" className="max-h-[80dvh] overflow-y-auto p-3">
          <DialogTitle className="px-1 text-sm">Switch branch</DialogTitle>
          <DialogDescription className="sr-only">Find a branch, switch to it, or make a new one.</DialogDescription>
          {introLine}{search}
          {creating ? createForm : (
            <>
              <div role="list" aria-label="Branches">
                {loading ?? (shown.length === 0 ? none : shown.map((b) => (
                  <button key={b.id} type="button" role="listitem" aria-current={isOn(b) || undefined} onClick={() => { views.setBranch(b.isDefault ? null : b.name); views.setPickerOpen(false); }}
                    className="flex min-h-11 w-full items-start gap-2 rounded-[5px] px-2 py-1.5 text-left text-xs hover:bg-muted">{rowBody(b)}</button>
                )))}
              </div>
              <div className="mt-2 flex flex-col gap-1 border-t border-border pt-2">
                {canEdit ? <button type="button" className={cn(stripButton, "min-h-11 justify-start")} onClick={() => setCreating(true)}><Plus className="size-3.5" aria-hidden="true" />New branch…</button> : null}
                <button type="button" className={cn(stripButton, "min-h-11 justify-start")} onClick={() => { views.setPickerOpen(false); views.selectView("branches"); }}><GitBranch className="size-3.5" aria-hidden="true" />View all branches</button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
  return (
    <>
    <ProtectedUploadOffer projectId={projectId} onBranch={(name) => { views.selectView("project"); views.setBranch(name); }} />
    <DropdownMenu modal={false} open={open && !mainOnly} onOpenChange={(o) => views.setPickerOpen(o)}>
      <DropdownMenuTrigger asChild disabled={mainOnly}>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="end" collisionPadding={8} role="dialog" aria-orientation={undefined} aria-label="Switch branch" className={cn(menuClass, "w-80 max-w-[calc(100vw-16px)]")}>
        {introLine}{search}
        {creating ? createForm : (
          <>
            <div role="menu" aria-label="Branches" className="max-h-72 overflow-y-auto">
              {loading ?? (shown.length === 0 ? none : shown.map((b) => (
                <DropdownMenuItem key={b.id} onSelect={() => views.setBranch(b.isDefault ? null : b.name)} aria-current={isOn(b) || undefined} className={cn(itemClass, "items-start gap-2 py-1.5")}>{rowBody(b)}</DropdownMenuItem>
              )))}
            </div>
            <DropdownMenuSeparator />
            <div role="menu" aria-label="Branch actions">
              {canEdit ? <DropdownMenuItem onSelect={(e) => { e.preventDefault(); setCreating(true); }} className={itemClass}><Plus className="mr-2 size-3.5" />New branch…</DropdownMenuItem> : null}
              <DropdownMenuItem onSelect={() => views.selectView("branches")} className={itemClass}><GitBranch className="mr-2 size-3.5" />View all branches</DropdownMenuItem>
            </div>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
    </>
  );
}

// ── The "On branch" strip ─────────────────────────────────────────────────────────────────────────────────────────

/** Flush under the header: ahead and behind, Compare with main, Update from main, the merge request, the branch's ⋯. */
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
      <FilesStrip role="status" label="On branch" tone="warning">
        <span className="min-w-0 flex-1 text-xs">{view.error instanceof Error ? view.error.message : "This branch can’t be opened"}</span>
        <button type="button" className={stripButton} onClick={() => views.setBranch(null)}>Go to main</button>
      </FilesStrip>
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
  const merged = b?.status === "merged";
  return (
    <>
      <FilesStrip role="status" label="On branch" tone="warning">
        {renaming ? (
          <form className="flex min-w-0 flex-1 items-center gap-2" onSubmit={(e) => { e.preventDefault(); void rename(); }}>
            <label className="sr-only" htmlFor="branch-rename">New name</label>
            <input id="branch-rename" autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} className="h-7 min-w-0 flex-1 rounded-[5px] border border-border bg-card px-2 font-mono text-xs text-foreground focus:border-[#D14E24] focus:outline-none" />
            <button type="submit" className={stripPrimary} disabled={!newName.trim()}>Rename</button>
            <button type="button" className={stripButton} onClick={() => setRenaming(false)}>Cancel</button>
          </form>
        ) : (
          <span className="flex min-w-0 flex-1 items-center gap-2 text-xs">
            <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">On branch <span className="font-mono font-semibold">{views.branch}</span>{b ? <span className="font-mono"> · {merged ? "merged into main" : b.ahead || b.changedFiles ? aheadBehind(b) : `nothing changed yet · ${b.behind} behind main`}</span> : null}</span>
          </span>
        )}
        {b && !renaming ? (
          <span className="flex flex-wrap items-center gap-1.5">
            {onCompare && b.changedFiles > 0 ? <button type="button" className={stripButton} aria-pressed={Boolean(compare)} onClick={onCompare}><GitCompare className="size-3.5" aria-hidden="true" />Compare with main</button> : null}
            {canEdit && !merged && b.behind > 0 ? <button type="button" className={stripButton} disabled={Boolean(busy)} onClick={() => void update()}><RefreshCw className="size-3.5" aria-hidden="true" />{busy === "update" ? "Updating…" : "Update from main"}</button> : null}
            {b.mergeRequest ? (
              <button type="button" className={stripButton} onClick={() => openMergeRequest(views, b.mergeRequest!.number)}><GitPullRequest className="size-3.5" aria-hidden="true" />MR !{b.mergeRequest.number}</button>
            ) : canEdit && !merged && b.changedFiles > 0 ? (
              <button type="button" className={stripPrimary} onClick={() => setOpening((o) => !o)} aria-expanded={opening}><GitPullRequest className="size-3.5" aria-hidden="true" />Open merge request</button>
            ) : null}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <button type="button" aria-label={`More for ${b.name}`} className={cn(stripButton, "w-7 justify-center px-0")}><MoreHorizontal className="size-3.5" aria-hidden="true" /></button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={cn(menuClass, "w-48")}>
                <DropdownMenuItem className={itemClass} onSelect={() => void downloadFile(`/api/v1/branches/${b.id}/zip`, { filename: `${zipName(b.name)}.zip` })}><Download className="mr-2 size-3.5" />Download as zip</DropdownMenuItem>
                {canEdit ? <DropdownMenuItem className={itemClass} onSelect={() => { setNewName(b.name); setRenaming(true); }}><Pencil className="mr-2 size-3.5" />Rename</DropdownMenuItem> : null}
                {canEdit ? <DropdownMenuSeparator /> : null}
                {canEdit ? <DropdownMenuItem variant="destructive" className={cn(itemClass, "")} onSelect={() => setConfirmDelete(true)}><Trash2 className="mr-2 size-3.5" />Delete branch</DropdownMenuItem> : null}
              </DropdownMenuContent>
            </DropdownMenu>
          </span>
        ) : null}
      </FilesStrip>
      {opening && b ? <OpenMergeRequest projectId={projectId} branch={b} onCancel={() => setOpening(false)} onDone={(n) => { setOpening(false); refresh(); openMergeRequest(views, n); }} /> : null}
      {conflicts ? (
        <section aria-label="Update conflicts" className="shrink-0 border-b border-border bg-card px-4 py-3">
          <p className="mb-2 text-xs text-foreground">{conflicts.length} file{conflicts.length === 1 ? "" : "s"} changed on both this branch and main. Choose for each, then update:</p>
          <ul className="space-y-1">
            {conflicts.map((c) => (
              <li key={c.path} className="flex flex-wrap items-center gap-3 text-xs">
                <span className="min-w-0 flex-1 truncate font-mono">{c.path}</span>
                {(["branch", "main"] as const).map((v) => (
                  <label key={v} className="inline-flex items-center gap-1"><input type="radio" name={`conflict-${c.path}`} checked={choices[c.path] === v} onChange={() => setChoices((x) => ({ ...x, [c.path]: v }))} />{v === "branch" ? "Keep the branch's" : "Take main's"}</label>
                ))}
              </li>
            ))}
          </ul>
          <button type="button" className={cn(stripPrimary, "mt-2")} disabled={conflicts.some((c) => !choices[c.path]) || Boolean(busy)} onClick={() => void update(choices)}>Update from main</button>
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
function OpenMergeRequest({ projectId, branch, onDone, onCancel }: { projectId: string; branch: BranchView; onDone: (n: number) => void; onCancel: () => void }) {
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
    <form aria-label="New merge request" className="shrink-0 space-y-2 border-b border-border bg-card px-4 py-3" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
      <p className="text-xs text-foreground">Merge <span className="font-mono">{branch.name}</span> into main, after review.</p>
      <label className="flex flex-col gap-1 font-mono text-[11px] text-muted-foreground">Title
        <input autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder={branch.task ? `Task #${branch.task.number}’s title` : "From the branch name"} className={cn(fieldClass, "font-sans")} />
      </label>
      <label className="flex flex-col gap-1 font-mono text-[11px] text-muted-foreground">Description
        <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} placeholder="Leave it empty to list the branch’s saves. “Closes #4” links a task, which moves when this merges." className="rounded-[5px] border border-border bg-background p-2 font-sans text-xs text-foreground focus:border-[#D14E24] focus:outline-none" />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <label className="inline-flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={draft} onChange={(e) => setDraft(e.target.checked)} />Draft (reviewers aren’t asked yet)</label>
        <button type="submit" className={stripPrimary} disabled={busy}>{busy ? "Opening…" : "Open merge request"}</button>
        <button type="button" className={stripButton} onClick={onCancel}>Cancel</button>
      </div>
    </form>
  );
}

// ── All files on a branch ─────────────────────────────────────────────────────────────────────────────────────────

/** The branch's path in the header, as All files shows main's (design audit F2). */
function BranchCrumbs({ branch, path, extra }: { branch: string; path: string; extra?: string }) {
  const views = useFilesViews()!;
  const parts = path.split("/").filter(Boolean);
  return (
    <FilesHeaderTitle>
      <HeaderCrumbs
        label="Branch breadcrumb"
        items={[
          // Icon and name on one line, the name shortened when long (T16 live test: it wrapped at the branch's top).
          { label: <><GitBranch className="size-3.5 shrink-0" aria-hidden="true" /><span className="truncate">{branch}</span></>, mono: true, onClick: () => views.openBranchPath("/") },
          ...parts.map((p, i) => ({ label: p, onClick: () => views.openBranchPath(`/${parts.slice(0, i + 1).join("/")}`) })),
          ...(extra ? [{ label: extra }] : []),
        ]}
      />
    </FilesHeaderTitle>
  );
}

export function BranchExplorer({ projectId }: { projectId: string }) {
  const views = useFilesViews()!;
  const branch = useCurrentBranch(projectId);
  const [compare, setCompare] = useState(false);
  const b = branch.data?.branch;
  const name = views.branch ?? "";
  // A link with a renamed branch's old name (H26) moves onto its name now.
  useEffect(() => { if (b && b.status === "active" && name && b.name.toLowerCase() !== name.toLowerCase()) views.setBranch(b.name); }, [b, name, views]);
  // An old link to a deleted branch, or one that's gone (H24): say so, with Restore or Go to main.
  if (branch.isError || b?.status === "deleted") return <section aria-label={`Branch ${name}`} className="flex h-full min-h-0 flex-col bg-card dark:bg-background"><FilesViewsMenu projectId={projectId} /><GoneBranch projectId={projectId} name={name} branch={b ?? null} /></section>;
  return (
    <section aria-label={`Files on ${name}`} className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card dark:bg-background">
      <FilesViewsMenu projectId={projectId} />
      {compare ? <BranchCrumbs branch={name} path="/" extra="Compare with main" /> : <BranchCrumbs branch={name} path={views.branchFile ?? views.branchFolder} />}
      <BranchBar projectId={projectId} compare={compare} onCompare={() => setCompare((c) => !c)} />
      {!b ? (
        branch.isLoading ? <FolderListLoading /> : null
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

/** "This branch was deleted on <date>", with Restore (30 days, writers) or Go to main (H24). */
function GoneBranch({ projectId, name, branch }: { projectId: string; name: string; branch: BranchView | null }) {
  const views = useFilesViews()!;
  const { canEdit } = useFilesTabRole();
  const client = useQueryClient();
  const [busy, setBusy] = useState(false);
  const deletedAt = branch?.deletedAt ? new Date(branch.deletedAt) : null;
  const restorable = Boolean(deletedAt && canEdit && Date.now() - deletedAt.getTime() < 30 * 86_400_000);
  async function restore() {
    setBusy(true);
    try {
      const res = await restoreBranchAction(branch!.id);
      if (!res.success) { toast.error(res.error); return; }
      toast.success(`Restored ${branch!.name}`);
      void client.invalidateQueries({ queryKey: ["branch", projectId] });
      void client.invalidateQueries({ queryKey: ["branches", projectId] });
    } finally { setBusy(false); }
  }
  return (
    <div role="status" className="m-auto max-w-sm px-6 py-12 text-center">
      <GitBranch className="mx-auto mb-3 size-5 text-muted-foreground" aria-hidden="true" />
      <p className="text-sm font-medium text-foreground">{deletedAt ? <>This branch was deleted on {deletedAt.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}</> : <>There’s no branch <span className="font-mono">{name}</span> here</>}</p>
      <p className="mt-1 text-xs text-muted-foreground">{deletedAt ? (restorable ? "It can be restored for 30 days after it was deleted." : "Its saves stay in History.") : "It may have been renamed or deleted more than 30 days ago."}</p>
      <div className="mt-4 flex justify-center gap-2">
        {restorable ? <button type="button" className={stripPrimary} disabled={busy} onClick={() => void restore()}>{busy ? "Restoring…" : "Restore"}</button> : null}
        <button type="button" className={stripButton} onClick={() => views.setBranch(null)}>Go to main</button>
      </div>
    </div>
  );
}

function formatBytes(n: number) {
  return n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;
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
  const write = canEdit && branch.status !== "merged";
  // Files someone uploaded on a protected main land here once the new branch opens (H5, H24).
  useEffect(() => {
    const p = takePendingUpload(branch.id);
    if (!p) return;
    if (p.folder !== folder) views.openBranchPath(p.folder);
    void upload.send(p.files, p.folder);
  }, [branch.id]); // once per branch
  const matches = query.trim() ? (paths.data?.paths ?? []).filter((p) => p.toLowerCase().includes(query.trim().toLowerCase())).slice(0, 200) : null;
  // 0.8 #8: each folder keeps its scroll when you switch branch (keyed by path, the same folder on every branch).
  const scroller = useRef<HTMLDivElement>(null);
  const scrollKey = `branch:${folder}`;
  const ready = list.isSuccess;
  useEffect(() => { if (ready && scroller.current) scroller.current.scrollTop = views.scrollOffsets.current.get(scrollKey) ?? 0; }, [ready, scrollKey, branch.id, views.scrollOffsets]);

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
        <button type="button" onClick={(e) => e.stopPropagation()} aria-label={`Actions for ${path.split("/").pop()}`} className="nb-touch-target flex size-7 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="size-4" aria-hidden="true" /></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={cn(menuClass, "w-48")}>
        <DropdownMenuItem className={itemClass} onSelect={() => void downloadFile(isFolder ? `/api/v1/branches/${branch.id}/zip?path=${encodeURIComponent(path)}` : `/api/v1/branches/${branch.id}/raw?path=${encodeURIComponent(path)}`, { filename: isFolder ? `${zipName(branch.name)}-${zipName(path.split("/").pop()!)}.zip` : path.split("/").pop()! })}><Download className="mr-2 size-3.5" />{isFolder ? "Download as zip" : "Download"}</DropdownMenuItem>
        {write ? <DropdownMenuItem className={itemClass} onSelect={() => { setMoving(path); setMoveTo(path); }}><Pencil className="mr-2 size-3.5" />Rename or move</DropdownMenuItem> : null}
        {write ? <DropdownMenuItem variant="destructive" className={cn(itemClass, "")} onSelect={() => setDeleting(path)}><Trash2 className="mr-2 size-3.5" />Delete</DropdownMenuItem> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilesHeaderSlot slot="actions">
        <div className="mr-1 flex items-center gap-1.5">
          <label htmlFor="branch-name-search" className="sr-only">Find a file on this branch</label>
          <input id="branch-name-search" type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Go to file" className={cn(fieldClass, "w-28 sm:w-40")} />
          {write ? <button type="button" className={headerButton} onClick={() => setAdding(true)} aria-label="New file"><Plus className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">New file</span></button> : null}
          {write ? (
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild><button type="button" className={headerPrimary} disabled={upload.busy} aria-label="Upload files or folder"><Upload className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">{upload.busy ? "Uploading…" : "Upload"}</span></button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className={cn(menuClass, "w-44")}>
                <DropdownMenuItem onSelect={() => files.current?.click()} className={itemClass}><Upload className="mr-2 size-3.5" />Upload files…</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => dir.current?.click()} className={itemClass}><FolderInput className="mr-2 size-3.5" />Upload folder…</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
        </div>
      </FilesHeaderSlot>
      <input ref={files} type="file" multiple hidden aria-hidden onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) void upload.send(f, folder); }} />
      <input ref={dir} type="file" multiple hidden aria-hidden {...{ webkitdirectory: "" }} onChange={(e) => { const f = [...(e.target.files ?? [])]; e.target.value = ""; if (f.length) void upload.send(f, folder); }} />
      {adding ? <NewFile branch={branch} folder={folder} onClose={() => setAdding(false)} onSaved={(path) => { setAdding(false); refresh(); views.openBranchPath(parentOf(path), path); }} /> : null}
      {moving ? (
        <form aria-label="Rename or move" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2" onSubmit={(e) => { e.preventDefault(); void move(); }}>
          <label htmlFor="branch-move-to" className="font-mono text-[11px] text-muted-foreground">Rename or move <span className="text-foreground">{moving}</span> to</label>
          <input id="branch-move-to" autoFocus value={moveTo} onChange={(e) => setMoveTo(e.target.value)} className={cn(fieldClass, "min-w-0 flex-1 font-mono")} />
          <button type="submit" className={stripPrimary} disabled={!moveTo.trim() || moveTo.trim() === moving}>Save</button>
          <button type="button" className={stripButton} onClick={() => setMoving(null)}>Cancel</button>
        </form>
      ) : null}
      <div role="table" aria-label={`Files in ${folder} on ${branch.name}`} className={cn(listStyles.container, "flex min-h-0 flex-1 flex-col overflow-hidden")}>
        <FolderListHeader updatedLabel="On this branch" byLabel="Last save" />
        <div ref={scroller} onScroll={(e) => { if (ready && !matches) views.scrollOffsets.current.set(scrollKey, e.currentTarget.scrollTop); }} className="min-h-0 flex-1 overflow-y-auto">
          {matches ? (
            paths.isLoading ? <FolderListLoading /> : matches.length ? (
              <div role="rowgroup" aria-label="Matching files">
                {matches.map((p) => (
                  <GridRow key={p} onClick={() => views.openBranchPath(parentOf(p), p)} label={p}>
                    <NameCell chip={<FileTypeChip name={p.split("/").pop()!} mimeType={null} />} name={p.split("/").pop()} sub={parentOf(p)} />
                    <Cell column="updated" /><Cell column="size" align="right" /><Cell column="by" /><div role="cell" />
                  </GridRow>
                ))}
              </div>
            ) : <FolderListEmpty message={`No file on this branch matches “${query}”.`} />
          ) : list.isLoading ? <FolderListLoading /> : list.isError ? (
            <FolderListError onRetry={() => void list.refetch()} />
          ) : !list.data!.folders.length && !list.data!.files.length ? (
            <FolderListEmpty message="No files here on this branch." />
          ) : (
            <div role="rowgroup">
              {list.data!.folders.map((f) => (
                <GridRow key={f.path} onClick={() => views.openBranchPath(f.path)}>
                  <NameCell chip={<FileTypeChip name={f.name} mimeType={null} isFolder />} name={f.name} sub={`${f.files} file${f.files === 1 ? "" : "s"}`} onOpen={() => views.openBranchPath(f.path)} nameLabel={`Open folder ${f.name}`} />
                  <Cell column="updated" /><Cell column="size" align="right" /><Cell column="by" />
                  <div role="cell" className="flex justify-end" onClick={(e) => e.stopPropagation()}>{rowMenu(f.path, true)}</div>
                </GridRow>
              ))}
              {list.data!.files.map((f) => (
                <GridRow key={f.path} onClick={() => views.openBranchPath(folder, f.path)}>
                  <NameCell chip={<FileTypeChip name={f.name} mimeType={f.mimeType} />} name={f.name} onOpen={() => views.openBranchPath(folder, f.path)} nameLabel={`Open ${f.name}`} after={f.own ? <span data-file-mobile-meta><StatusBadge tone="warning">Changed</StatusBadge></span> : null} />
                  <Cell column="updated">{f.own ? <StatusBadge tone="warning">Changed</StatusBadge> : "From main"}</Cell>
                  <Cell column="size" align="right">{f.size != null ? formatBytes(f.size) : null}</Cell>
                  <Cell column="by">{f.own && f.save ? `Save ${f.save}` : null}</Cell>
                  <div role="cell" className="flex justify-end" onClick={(e) => e.stopPropagation()}>{rowMenu(f.path, false)}</div>
                </GridRow>
              ))}
            </div>
          )}
        </div>
      </div>
      <ConfirmDialog open={Boolean(deleting)} onOpenChange={(o) => { if (!o) setDeleting(null); }} title={`Delete ${deleting?.split("/").pop()} on ${branch.name}?`} description="Only on this branch; main keeps it. Revert the save to bring it back." confirmLabel="Delete" variant="destructive" onConfirm={() => void remove()} />
      {upload.dialog}
    </div>
  );
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
    <form aria-label="New file" className="shrink-0 space-y-2 border-b border-border bg-card px-4 py-3" onSubmit={(e) => { e.preventDefault(); void save(); }}>
      <label className="flex flex-col gap-1 font-mono text-[11px] text-muted-foreground">Name (a/b.md makes folders)
        <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="notes.md" className={cn(fieldClass, "font-mono")} />
      </label>
      <label className="sr-only" htmlFor="branch-new-file">File content</label>
      <textarea id="branch-new-file" value={text} onChange={(e) => setText(e.target.value)} rows={6} spellCheck={false} className="w-full rounded-[5px] border border-border bg-background p-2 font-mono text-xs text-foreground focus:border-[#D14E24] focus:outline-none" />
      <div className="flex gap-2">
        <button type="submit" className={stripPrimary} disabled={busy || !name.trim()}>{busy ? "Saving…" : `Save on ${branch.name}`}</button>
        <button type="button" className={stripButton} onClick={onClose}>Cancel</button>
      </div>
    </form>
  );
}

const PREVIEW_IMAGE = /^image\/(png|jpe?g|gif|webp|avif|bmp)$/;
const isMarkdown = (path: string) => /\.(md|markdown)$/i.test(path);

/** A file on a branch through the app's own viewer: Markdown rendered, text in the code view, images and PDFs (C7). */
function BranchFileView({ projectId, branch, path }: { projectId: string; branch: BranchView; path: string }) {
  const views = useFilesViews()!;
  const { canEdit } = useFilesTabRole();
  const refresh = useRefreshBranch(projectId);
  const file = useQuery({ queryKey: ["branch-file", branch.id, path, branch.lastSave?.id], queryFn: () => unwrap(branchFileTextAction(branch.id, path)) });
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const draftKey = `nb:edit:branch:${branch.id}:${path}`;
  useEffect(() => {
    if (file.data?.text == null || text !== null) return;
    const draft = readEditDraft(draftKey, file.data.contentHash ?? null);
    setText(draft ?? file.data.text);
    if (draft !== null && draft !== file.data.text) { setEditing(true); toast.info("Your unsaved edit is back. Save it, or Cancel to drop it."); }
  }, [file.data, text, draftKey]);
  useEditDraft(file.data?.text != null ? draftKey : null, file.data?.contentHash ?? null, text, file.data?.text ?? null);
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
      <FilesHeaderSlot slot="actions">
        <div className="mr-1 flex items-center gap-1.5">
          {file.data?.own ? <StatusBadge tone="warning">Changed here</StatusBadge> : null}
          {editing ? (
            <>
              <button type="button" className={headerButton} onClick={() => { setEditing(false); setText(file.data?.text ?? null); }}>Cancel</button>
              <button type="button" className={headerPrimary} disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : `Save on ${branch.name}`}</button>
            </>
          ) : (
            <>
              <button type="button" className={headerButton} aria-label="History" onClick={() => { const url = new URL(window.location.href); url.searchParams.set("hpath", path); window.history.replaceState(window.history.state, "", url); views.selectView("history"); }}><History className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">History</span></button>
              <button type="button" className={headerButton} aria-label="Download" onClick={() => void downloadFile(raw, { filename: path.split("/").pop()! })}><Download className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">Download</span></button>
              {write && file.data?.text != null ? <button type="button" className={headerButton} aria-label="Edit" onClick={() => setEditing(true)}><Pencil className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">Edit</span></button> : null}
              {write ? <button type="button" className={headerButton} aria-label="Delete" onClick={() => setConfirmDelete(true)}><Trash2 className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">Delete</span></button> : null}
            </>
          )}
        </div>
      </FilesHeaderSlot>
      <div className="flex min-h-0 flex-1 flex-col overflow-auto">
        {file.isLoading ? <FolderListLoading /> : file.isError ? (
          <p role="alert" className="p-4 text-sm text-destructive">{file.error instanceof Error ? file.error.message : "Couldn’t open this file"}</p>
        ) : editing ? (
          <div className="min-h-0 flex-1" role="group" aria-label="File content">
            <CodeMirrorEditor value={text ?? ""} onChange={(v: string) => setText(v)} height="100%" width="100%" className="h-full font-mono text-[13px] leading-[1.55]" basicSetup={{ foldGutter: false, autocompletion: false, highlightActiveLine: false }} />
          </div>
        ) : file.data?.text != null && isMarkdown(path) ? (
          <div className="px-6 py-4"><MarkdownPreview content={file.data.text} projectId={projectId} /></div>
        ) : file.data?.text != null ? (
          <div className="min-h-0 flex-1" role="group" aria-label={`Content of ${path}`}>
            <CodeMirrorEditor value={file.data.text} editable={false} readOnly height="100%" width="100%" className="h-full font-mono text-[13px] leading-[1.55]" basicSetup={{ foldGutter: false, highlightActiveLine: false, highlightActiveLineGutter: false, autocompletion: false }} />
          </div>
        ) : PREVIEW_IMAGE.test(mime) ? (
          <img src={`${raw}&inline=1`} alt={path.split("/").pop()} className="m-4 max-h-[70vh] max-w-full self-start rounded-[5px] border border-border object-contain" />
        ) : mime === "application/pdf" ? (
          <iframe title={path.split("/").pop()} src={`${raw}&inline=1`} className="min-h-[70vh] w-full border-0" />
        ) : (
          <FolderListEmpty message={`No preview for this file (${file.data?.size != null ? formatBytes(file.data.size) : "?"}). Download it, or work on it from a folder on this branch.`} />
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
  const { needs: needsStepUp, dialog: stepUpDialog } = useStepUp("This upload includes a doc or final files, so confirm it’s you before saving it.");
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
  async function finish(setId: string, confirmSecrets = false): Promise<Awaited<ReturnType<typeof finishUploadOnBranchAction>>> {
    const res = await finishUploadOnBranchAction(setId, confirmSecrets);
    // Docs and final files: "Verify it's you", then the same finish again.
    if (needsStepUp(res as never, () => void finish(setId, confirmSecrets).then((r) => { if (!r.success && r.code !== "STEP_UP_REQUIRED") toast.error(r.error); }))) return res;
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
      if (!done.success && done.code !== "STEP_UP_REQUIRED") toast.error(done.error);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The upload didn’t finish");
    } finally { setBusy(false); }
  }
  const dialog = (
    <>
      {stepUpDialog}
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
              if (!done.success && done.code !== "STEP_UP_REQUIRED") toast.error(done.error);
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "The upload didn’t finish");
            } finally { setBusy(false); }
          })();
        }}
      />
    </>
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
  if (paths.isLoading || branch.isLoading) return <div className="space-y-1 p-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-6 nb-skeleton rounded-[3px]" />)}</div>;
  if (paths.isError) return <p role="alert" className="p-3 text-xs text-destructive">Couldn’t load this branch’s files.</p>;
  const toggle = (path: string) => setOpen((o) => { const n = new Set(o); if (n.has(path)) n.delete(path); else n.add(path); return n; });
  const rowClass = (on: boolean) => cn("flex w-full items-center gap-1.5 py-1 pr-2 text-left text-xs text-foreground hover:bg-[#F3F0EA] dark:hover:bg-white/5", on && "bg-[#F3F0EA] font-medium dark:bg-white/10");
  const render = (node: TreeNode, depth: number): React.ReactNode[] => [
    ...[...node.folders.values()].sort((a, b) => a.name.localeCompare(b.name)).flatMap((f) => [
      <li key={f.path} role="treeitem" aria-expanded={open.has(f.path)} aria-level={depth + 1} aria-selected={views.branchFolder === f.path && !views.branchFile}>
        <button type="button" onClick={() => { toggle(f.path); views.openBranchPath(f.path); }} style={{ paddingLeft: 8 + depth * 14 }} className={rowClass(views.branchFolder === f.path && !views.branchFile)}>
          {open.has(f.path) ? <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" /> : <ChevronRight className="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />}
          {open.has(f.path) ? <FolderOpen strokeWidth={1.75} className="size-3.5 shrink-0 fill-[#FCF0EA] text-[#D14E24] dark:fill-[#D14E24]/20" aria-hidden="true" /> : <Folder strokeWidth={1.75} className="size-3.5 shrink-0 fill-[#FCF0EA] text-[#D14E24] dark:fill-[#D14E24]/20" aria-hidden="true" />}
          <span className="truncate">{f.name}</span>
        </button>
      </li>,
      ...(open.has(f.path) ? render(f, depth + 1) : []),
    ]),
    ...node.files.sort().map((p) => (
      <li key={p} role="treeitem" aria-level={depth + 1} aria-selected={views.branchFile === p}>
        <button type="button" onClick={() => views.openBranchPath(parentOf(p), p)} style={{ paddingLeft: 22 + depth * 14 }} className={rowClass(views.branchFile === p)}>
          <FileText strokeWidth={1.75} className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <span className="truncate">{p.split("/").pop()}</span>
        </button>
      </li>
    )),
  ];
  return (
    <div className="flex h-full min-h-0 flex-col">
      <p className="flex min-h-[37px] items-center gap-1.5 border-b border-[color-mix(in_srgb,var(--status-warning)_35%,transparent)] bg-[var(--status-warning-soft)] px-3 font-mono text-[11px] text-[var(--status-warning)]"><GitBranch className="size-3.5" aria-hidden="true" /><span className="truncate">{views.branch}</span></p>
      <ul role="tree" aria-label={`Files on ${views.branch}`} className="min-h-0 flex-1 overflow-y-auto py-1">{render(root, 0)}</ul>
    </div>
  );
}

function ancestors(folder: string) {
  const parts = folder.split("/").filter(Boolean);
  return parts.map((_, i) => `/${parts.slice(0, i + 1).join("/")}`);
}
