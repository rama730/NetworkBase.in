"use client";

import { useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { GitBranch, MoreHorizontal, Pencil, RotateCcw, Trash2 } from "lucide-react";

import {
  branchChangesAction, branchDiffAction, createBranchAction, deleteBranchAction, listBranchesAction, renameBranchAction, restoreBranchAction,
} from "@/app/actions/files/branches";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import type { BranchView } from "@/lib/domain/branches";
import { toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { When } from "./ChangesCollection";
import { FileTypeChip } from "./FileTypeChip";
import {
  Cell, FilesStrip, FilterChip, GridRow, IconChip, NameCell, Person, StatusBadge, StripSearch, headerPrimary, stripButton, stripPrimary,
} from "./FilesChrome";
import { FilesHeaderSlot, FilesViewsMenu } from "./FilesHeader";
import { useFilesViews } from "./FilesViews";
import { useFilesTabRole } from "./FilesTabRoleContext";
import { DiffView } from "./HistoryCollection";
import listStyles from "./folder/FolderList.module.css";
import { FolderListHeader } from "./folder/FolderListHeader";
import { FolderListEmpty, FolderListError, FolderListLoading } from "./folder/FolderListStates";

/**
 * All branches (report H2's branch list; "View all branches" in the picker, ?filesView=branches), on the explorer's
 * grid like Trash: filters with counts in the strip, New branch in the header. Picking one switches the Files tab
 * to it, like the picker (H-2b; design audit S5, S6, C1–C5).
 */
const unwrap = async <T,>(p: Promise<{ success: true; data: T } | { success: false; error: string }>) => {
  const res = await p;
  if (!res.success) throw new Error(res.error);
  return res.data;
};
const FILTERS = [["active", "Active"], ["stale", "Stale"], ["merged", "Merged"], ["deleted", "Deleted"]] as const;
type Filter = (typeof FILTERS)[number][0];
const fieldClass = "h-8 rounded-[5px] border border-border bg-background px-2 text-xs text-foreground focus:border-[#D14E24] focus:outline-none";

export function BranchesCollection({ projectId }: { projectId: string }) {
  const views = useFilesViews();
  const { canEdit } = useFilesTabRole();
  const client = useQueryClient();
  const [filter, setFilter] = useState<Filter>("active");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [from, setFrom] = useState("main");
  const [busy, setBusy] = useState(false);
  const [renaming, setRenaming] = useState<BranchView | null>(null);
  const [rename, setRename] = useState("");
  const [deleting, setDeleting] = useState<BranchView | null>(null);
  // One list per filter, so each chip shows its count (Trash's filters).
  const lists = useQueries({ queries: FILTERS.map(([f]) => ({ queryKey: ["branches", projectId, f], queryFn: () => unwrap(listBranchesAction(projectId, f)), staleTime: 15_000 })) });
  const list = lists[FILTERS.findIndex(([f]) => f === filter)]!;
  const count = (f: Filter) => lists[FILTERS.findIndex(([x]) => x === f)]?.data?.branches.filter((b) => !b.isDefault).length ?? null;
  const branches = useMemo(() => (list.data?.branches ?? []).filter((b) => !query || b.name.toLowerCase().includes(query.toLowerCase())), [list.data, query]);
  const active = lists[0]?.data?.branches ?? [];
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
      {canEdit ? (
        <FilesHeaderSlot slot="actions">
          <div className="mr-1 flex items-center gap-1.5">
            <button type="button" className={headerPrimary} aria-label="New branch" onClick={() => setCreating((c) => !c)} aria-expanded={creating}><GitBranch className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">New branch</span></button>
          </div>
        </FilesHeaderSlot>
      ) : null}
      <FilesStrip label="Branch filters">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map(([f, label]) => <FilterChip key={f} on={filter === f} label={label} count={count(f)} onClick={() => setFilter(f)} testId={`branches-filter-${f}`} />)}
        </div>
        <StripSearch id="branch-search" value={query} onChange={setQuery} placeholder="Find a branch…" label="Find a branch" />
      </FilesStrip>
      {creating ? (
        <form aria-label="New branch" className="flex shrink-0 flex-wrap items-end gap-2 border-b border-border bg-card px-4 py-3" onSubmit={(e) => { e.preventDefault(); void create(); }}>
          <label className="flex min-w-0 flex-1 basis-56 flex-col gap-1 font-mono text-[11px] text-muted-foreground">Name
            <input autoFocus value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="ram/try-new-header" className={cn(fieldClass, "font-mono")} />
          </label>
          <label className="flex flex-col gap-1 font-mono text-[11px] text-muted-foreground">From
            <select value={from} onChange={(e) => setFrom(e.target.value)} className={fieldClass}>
              {active.map((b) => <option key={b.id} value={b.isDefault ? "main" : b.name}>{b.name}</option>)}
            </select>
          </label>
          <button type="submit" className={stripPrimary} disabled={busy || !newName.trim()}>{busy ? "Creating…" : "Create branch"}</button>
          <button type="button" className={stripButton} onClick={() => setCreating(false)}>Cancel</button>
        </form>
      ) : null}
      {renaming ? (
        <form aria-label="Rename branch" className="flex shrink-0 flex-wrap items-center gap-2 border-b border-border bg-card px-4 py-2" onSubmit={(e) => { e.preventDefault(); void doRename(); }}>
          <label htmlFor="branch-rename-to" className="font-mono text-[11px] text-muted-foreground">Rename <span className="text-foreground">{renaming.name}</span> to</label>
          <input id="branch-rename-to" autoFocus value={rename} onChange={(e) => setRename(e.target.value)} className={cn(fieldClass, "min-w-0 flex-1 font-mono")} />
          <button type="submit" className={stripPrimary} disabled={!rename.trim()}>Rename</button>
          <button type="button" className={stripButton} onClick={() => setRenaming(null)}>Cancel</button>
        </form>
      ) : null}
      <div role="table" aria-label="Branches" className={cn(listStyles.container, "flex min-h-0 flex-1 flex-col overflow-hidden")}>
        <FolderListHeader updatedLabel="Last save" sizeLabel="Ahead · behind" byLabel="Made by" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.isLoading ? <FolderListLoading /> : list.isError ? <FolderListError onRetry={() => void list.refetch()} /> : branches.length === 0 ? (
            <FolderListEmpty plain message={query ? "No branch matches." : filter === "active" ? "No branches yet. Make one with New branch, or nb branch create ram/try-new-header." : filter === "stale" ? "Branches with no saves for 30 days show here." : filter === "merged" ? "Branches merged into main show here, ready to delete." : "Deleted branches can be restored for 30 days."} />
          ) : (
            <div role="rowgroup">
              {branches.map((b) => {
                const on = b.isDefault ? !views?.branch : views?.branch?.toLowerCase() === b.name.toLowerCase();
                const deleted = b.status === "deleted";
                return (
                  <GridRow key={b.id} onClick={deleted ? undefined : () => open(b)} selected={on}>
                    <NameCell
                      chip={<IconChip><GitBranch /></IconChip>}
                      name={b.name}
                      onOpen={deleted ? undefined : () => open(b)}
                      nameLabel={`Switch to ${b.name}`}
                      after={<>
                        {on ? <StatusBadge tone="info">You’re on it</StatusBadge> : null}
                        {b.mergeRequest ? <StatusBadge tone="info">MR !{b.mergeRequest.number}{b.mergeRequest.state === "draft" ? " draft" : ""}</StatusBadge> : null}
                        {b.status === "merged" ? <StatusBadge tone="success">Merged</StatusBadge> : null}
                        {b.stale ? <StatusBadge>Stale</StatusBadge> : null}
                      </>}
                      sub={deleted ? <>Deleted <When at={b.deletedAt} /> · restorable for 30 days</> : b.isDefault ? "The workspace’s files" : b.lastSave?.message ?? "No saves yet"}
                    />
                    <Cell column="updated">{b.lastSave ? <When at={b.lastSave.createdAt} /> : null}</Cell>
                    <Cell column="size" align="right">{b.isDefault || deleted ? null : `${b.ahead} · ${b.behind}`}</Cell>
                    <Cell column="by">{!b.isDefault ? <Person person={b.createdBy} /> : null}</Cell>
                    <div role="cell" className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                      {deleted && canEdit ? (
                        <button type="button" className={stripButton} onClick={() => void restore(b)}><RotateCcw className="size-3.5" aria-hidden="true" />Restore</button>
                      ) : !b.isDefault && canEdit ? (
                        <DropdownMenu modal={false}>
                          <DropdownMenuTrigger asChild>
                            <button type="button" aria-label={`More for ${b.name}`} className="nb-touch-target flex size-7 items-center justify-center rounded-[5px] text-muted-foreground hover:bg-muted hover:text-foreground"><MoreHorizontal className="size-4" aria-hidden="true" /></button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-44 rounded-[8px] border border-border bg-card p-1 shadow-md">
                            <DropdownMenuItem className="rounded-[5px] text-xs" onSelect={() => { setRenaming(b); setRename(b.name); }}><Pencil className="mr-2 size-3.5" />Rename</DropdownMenuItem>
                            <DropdownMenuItem variant="destructive" className="rounded-[5px] text-xs" onSelect={() => setDeleting(b)}><Trash2 className="mr-2 size-3.5" />Delete</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      ) : null}
                    </div>
                  </GridRow>
                );
              })}
            </div>
          )}
        </div>
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

const OP: Record<string, { label: string; tone: "success" | "warning" | "danger" }> = { add: { label: "Added", tone: "success" }, change: { label: "Changed", tone: "warning" }, delete: { label: "Deleted", tone: "danger" } };

/** A branch against main (Compare with main, on the bar): the files it changes on the explorer's rows, and each diff. */
export function BranchChanges({ branch }: { branch: BranchView }) {
  const changes = useQuery({ queryKey: ["branch-changes", branch.id, branch.lastSave?.id], queryFn: () => unwrap(branchChangesAction(branch.id)) });
  const [selected, setSelected] = useState<string | null>(null);
  const files = changes.data?.files ?? [];
  const current = selected ?? files[0]?.path ?? null;
  const diff = useQuery({ queryKey: ["branch-diff", branch.id, current, branch.lastSave?.id], enabled: Boolean(current), queryFn: () => unwrap(branchDiffAction(branch.id, current!)) });
  if (changes.isLoading) return <FolderListLoading />;
  if (!files.length) return <FolderListEmpty plain message="Nothing on this branch differs from main yet." />;
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav aria-label="Files changed on this branch" className="max-h-64 overflow-y-auto border-b border-border md:max-h-none md:w-80 md:border-b-0 md:border-r">
        <ul>
          {files.map((f) => (
            <li key={f.path}>
              <button type="button" onClick={() => setSelected(f.path)} aria-current={current === f.path} className={cn("flex min-h-12 w-full items-center gap-2.5 border-b border-border/60 px-3 text-left hover:bg-[#FAF8F5] dark:hover:bg-white/[0.02]", current === f.path && "bg-[#F3F0EA] dark:bg-white/[0.06]")}>
                <FileTypeChip name={f.path.split("/").pop()!} mimeType={null} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-xs font-medium text-foreground">{f.path.split("/").pop()}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{f.path}</span>
                </span>
                <StatusBadge tone={OP[f.op]?.tone ?? "neutral"}>{OP[f.op]?.label ?? f.op}</StatusBadge>
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
