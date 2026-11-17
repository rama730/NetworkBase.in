"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, FilePlus2, GitBranch, Pencil, RefreshCw, Search, Trash2 } from "lucide-react";

import {
  branchByNameAction, branchChangesAction, branchDiffAction, branchFilesAction, branchFileTextAction, branchSavesAction, createBranchAction, deleteBranchAction,
  deleteOnBranchAction, listBranchesAction, renameBranchAction, restoreBranchAction, saveOnBranchAction, updateBranchAction,
} from "@/app/actions/files/branches";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { BranchView, UpdateConflict } from "@/lib/domain/branches";
import { downloadFile } from "@/lib/download";
import { feedbackError, toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { EmptyState, When } from "./ChangesCollection";
import { FilesViewsMenu } from "./FilesHeader";
import { useFilesTabRole } from "./FilesTabRoleContext";
import { DiffView } from "./HistoryCollection";

/**
 * Branches (report H2, decision 1 of the H-2 plan): the list with New branch, and one branch's page with the
 * "On branch" bar, its changes against main, its files (view, edit, add, delete), its saves and Update from main.
 * Open with ?tab=files&filesView=branches, or one branch with &branch=<name>.
 */
function readParam() {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("branch");
}
function writeParam(name: string | null) {
  const url = new URL(window.location.href);
  if (name) url.searchParams.set("branch", name);
  else url.searchParams.delete("branch");
  window.history.replaceState(window.history.state, "", url);
}
const aheadBehind = (b: BranchView) => b.isDefault ? "The workspace's files" : `${b.ahead} save${b.ahead === 1 ? "" : "s"} ahead, ${b.behind} behind main`;
const unwrap = async <T,>(p: Promise<{ success: true; data: T } | { success: false; error: string }>) => {
  const res = await p;
  if (!res.success) throw new Error(res.error);
  return res.data;
};

export function BranchesCollection({ projectId }: { projectId: string }) {
  const [name, setName] = useState<string | null>(() => readParam());
  const open = useCallback((next: string | null) => { setName(next); writeParam(next); }, []);
  return (
    <div aria-label="Branches" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card dark:bg-background">
      <FilesViewsMenu projectId={projectId} />
      {name ? <BranchPage key={name} projectId={projectId} name={name} onBack={() => open(null)} onOpen={open} /> : <BranchList projectId={projectId} onOpen={open} />}
    </div>
  );
}

function BranchList({ projectId, onOpen }: { projectId: string; onOpen: (name: string) => void }) {
  const { canEdit } = useFilesTabRole();
  const client = useQueryClient();
  const [filter, setFilter] = useState<"active" | "stale" | "deleted">("active");
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [from, setFrom] = useState("main");
  const [busy, setBusy] = useState(false);
  const list = useQuery({ queryKey: ["branches", projectId, filter], queryFn: () => unwrap(listBranchesAction(projectId, filter)), staleTime: 15_000 });
  const branches = useMemo(() => (list.data?.branches ?? []).filter((b) => !query || b.name.toLowerCase().includes(query.toLowerCase())), [list.data, query]);
  async function create() {
    setBusy(true);
    try {
      const res = await createBranchAction(projectId, newName.trim(), from);
      if (!res.success) { toast.error(res.error); return; }
      void client.invalidateQueries({ queryKey: ["branches", projectId] });
      toast.success(`Created ${res.data.branch.name}`);
      onOpen(res.data.branch.name);
    } finally { setBusy(false); }
  }
  async function restore(b: BranchView) {
    const res = await restoreBranchAction(b.id);
    if (!res.success) { toast.error(res.error); return; }
    void client.invalidateQueries({ queryKey: ["branches", projectId] });
    toast.success(`Restored ${b.name}`);
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <p className="mb-3 text-sm text-muted-foreground">Branches let you try changes without touching main. Update one from main to bring newer work in. <a href="/docs/files/branches" className="underline underline-offset-2 hover:text-foreground">What’s this?</a></p>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="relative min-w-0 flex-1 basis-48">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <label className="sr-only" htmlFor="branch-search">Find a branch</label>
          <input id="branch-search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a branch" className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-sm" />
        </div>
        <div role="tablist" aria-label="Which branches" className="flex gap-1">
          {(["active", "stale", "deleted"] as const).map((f) => (
            <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cn("rounded-md px-2.5 py-1 text-sm", filter === f ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {f === "active" ? "Active" : f === "stale" ? "Stale" : "Deleted"}
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
      {list.isLoading ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}</div>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-destructive">{feedbackError(list.error instanceof Error ? list.error.message : "", "Couldn’t load branches")} <button type="button" className="underline" onClick={() => void list.refetch()}>Retry</button></p>
      ) : branches.length === 0 ? (
        <EmptyState title={filter === "deleted" ? "No deleted branches" : filter === "stale" ? "No stale branches" : "No branches yet"} body={filter === "active" ? "Make one with New branch, or from your terminal:" : "Branches with no saves for 30 days show here."} command={filter === "active" ? "nb branch create ram/try-new-header" : undefined} />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {branches.map((b) => (
            <li key={b.id} className="flex items-center gap-3 px-3 py-2.5">
              <GitBranch className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              {b.status === "deleted" ? (
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-mono text-sm text-foreground">{b.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">Deleted <When at={b.deletedAt} /> · restorable for 30 days</span>
                </span>
              ) : (
                <button type="button" onClick={() => onOpen(b.isDefault ? "main" : b.name)} className="min-w-0 flex-1 text-left">
                  <span className="block truncate font-mono text-sm font-medium text-foreground">{b.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">
                    {aheadBehind(b)}{b.lastSave ? <> · {b.lastSave.message} · <When at={b.lastSave.createdAt} />{b.lastSave.madeWith ? ` ${b.lastSave.madeWith}` : ""}</> : null}
                  </span>
                </button>
              )}
              {b.stale ? <span className="shrink-0 rounded-[5px] border border-border px-1.5 py-0.5 text-xs text-muted-foreground">Stale</span> : null}
              {b.status === "deleted" && canEdit ? <Button size="sm" variant="outline" onClick={() => void restore(b)}>Restore</Button> : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Tab = "changes" | "files" | "saves";

function BranchPage({ projectId, name, onBack, onOpen }: { projectId: string; name: string; onBack: () => void; onOpen: (name: string | null) => void }) {
  const { canEdit } = useFilesTabRole();
  const client = useQueryClient();
  const view = useQuery({ queryKey: ["branch", projectId, name], queryFn: () => unwrap(branchByNameAction(projectId, name)) });
  const [tab, setTab] = useState<Tab>("changes");
  const [busy, setBusy] = useState<string | null>(null);
  const [conflicts, setConflicts] = useState<UpdateConflict[] | null>(null);
  const [choices, setChoices] = useState<Record<string, "branch" | "main">>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [rename, setRename] = useState(name);
  const b = view.data?.branch;
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["branch", projectId] });
    void client.invalidateQueries({ queryKey: ["branches", projectId] });
    void client.invalidateQueries({ queryKey: ["branch-changes"] });
    void client.invalidateQueries({ queryKey: ["branch-files"] });
    void client.invalidateQueries({ queryKey: ["branch-saves"] });
  };

  if (name.toLowerCase() === "main") return <MainNote onBack={onBack} />;
  if (view.isLoading) return <div className="space-y-2 p-4" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-muted" />)}</div>;
  if (view.isError || !b) return <div className="p-4 text-sm"><p role="alert" className="text-destructive">{view.error instanceof Error ? view.error.message : "Couldn’t open this branch"}</p><button type="button" className="mt-2 underline" onClick={onBack}>Back to branches</button></div>;

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
  async function doRename() {
    const res = await renameBranchAction(b!.id, rename.trim());
    if (!res.success) { toast.error(res.error); return; }
    setRenaming(false);
    refresh();
    onOpen(res.data.branch.name);
  }
  async function doDelete() {
    const res = await deleteBranchAction(b!.id);
    if (!res.success) { toast.error(res.error); return; }
    toast.success(`Deleted ${b!.name}; restorable for 30 days`);
    refresh();
    onBack();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 border-b border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
        <GitBranch className="size-4 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1">On branch <span className="font-mono font-semibold">{b.name}</span> · {b.ahead || b.changedFiles ? aheadBehind(b) : "nothing changed yet"}{b.ahead || b.changedFiles ? "" : ` · ${b.behind} behind main`}</span>
        {canEdit && b.behind > 0 ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void update()}><RefreshCw className="size-4" aria-hidden />{busy === "update" ? "Updating…" : "Update from main"}</Button> : null}
      </div>
      <header className="border-b border-border px-4 py-3">
        <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" aria-hidden />Branches</button>
        <div className="flex flex-wrap items-center gap-2">
          {renaming ? (
            <form className="flex min-w-0 flex-1 gap-2" onSubmit={(e) => { e.preventDefault(); void doRename(); }}>
              <label className="sr-only" htmlFor="branch-rename">New name</label>
              <input id="branch-rename" autoFocus value={rename} onChange={(e) => setRename(e.target.value)} className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-sm" />
              <Button size="sm" type="submit" disabled={!rename.trim()}>Rename</Button>
              <Button size="sm" variant="ghost" type="button" onClick={() => setRenaming(false)}>Cancel</Button>
            </form>
          ) : <h2 className="min-w-0 flex-1 truncate font-mono text-base font-semibold text-foreground">{b.name}</h2>}
          <Button size="sm" variant="outline" onClick={() => void downloadFile(`/api/v1/branches/${b.id}/zip`, { filename: `${b.name.replace(/[^A-Za-z0-9._-]+/g, "-")}.zip` })}><Download className="size-4" aria-hidden />Download zip</Button>
          {canEdit ? <Button size="sm" variant="outline" onClick={() => setRenaming(true)}><Pencil className="size-4" aria-hidden />Rename</Button> : null}
          {canEdit ? <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" aria-hidden />Delete</Button> : null}
        </div>
        <div role="tablist" aria-label="Branch" className="mt-3 flex gap-1">
          {(["changes", "files", "saves"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-md px-2.5 py-1 text-sm", tab === t ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {t === "changes" ? `Changes (${b.changedFiles})` : t === "files" ? "Files" : `Saves (${b.ahead})`}
            </button>
          ))}
        </div>
      </header>
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
      {tab === "changes" ? <BranchChanges branch={b} /> : tab === "files" ? <BranchFiles branch={b} canEdit={canEdit} onSaved={refresh} /> : <BranchSaves projectId={projectId} branch={b} />}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title={`Delete ${b.name}?`}
        description={`${b.ahead ? `${b.ahead} save${b.ahead === 1 ? " isn't" : "s aren't"} in main. ` : ""}You can restore it for 30 days.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={() => void doDelete()}
      />
    </div>
  );
}

function MainNote({ onBack }: { onBack: () => void }) {
  return (
    <div className="p-4 text-sm">
      <p className="text-foreground">Main is the workspace’s own files: All files shows it.</p>
      <button type="button" className="mt-2 underline" onClick={onBack}>Back to branches</button>
    </div>
  );
}

function BranchChanges({ branch }: { branch: BranchView }) {
  const changes = useQuery({ queryKey: ["branch-changes", branch.id], queryFn: () => unwrap(branchChangesAction(branch.id)) });
  const [selected, setSelected] = useState<string | null>(null);
  const files = changes.data?.files ?? [];
  const current = selected ?? files[0]?.path ?? null;
  const diff = useQuery({ queryKey: ["branch-diff", branch.id, current], enabled: Boolean(current), queryFn: () => unwrap(branchDiffAction(branch.id, current!)) });
  if (changes.isLoading) return <div className="m-4 h-24 animate-pulse rounded bg-muted" aria-busy="true" />;
  if (!files.length) return <p className="p-4 text-sm text-muted-foreground">Nothing on this branch differs from main yet. Edit a file under Files, or push from a folder on this branch.</p>;
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

function BranchFiles({ branch, canEdit, onSaved }: { branch: BranchView; canEdit: boolean; onSaved: () => void }) {
  const list = useInfiniteQuery({
    queryKey: ["branch-files", branch.id],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam }) => unwrap(branchFilesAction(branch.id, pageParam)),
    getNextPageParam: (last) => last.nextCursor,
  });
  const [filter, setFilter] = useState("");
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const files = (list.data?.pages.flatMap((p) => p.files) ?? []).filter((f) => !filter || f.path.toLowerCase().includes(filter.toLowerCase()));
  if (open || adding) return <FileEditor branch={branch} path={open} canEdit={canEdit} onClose={() => { setOpen(null); setAdding(false); }} onSaved={() => { void list.refetch(); onSaved(); }} />;
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="sr-only" htmlFor="branch-files-filter">Filter files</label>
        <input id="branch-files-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files" className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm" />
        {canEdit ? <Button size="sm" variant="outline" onClick={() => setAdding(true)}><FilePlus2 className="size-4" aria-hidden />New file</Button> : null}
      </div>
      {list.isLoading ? <div className="h-24 animate-pulse rounded bg-muted" aria-busy="true" /> : (
        <ul className="divide-y divide-border rounded-md border border-border font-mono text-xs">
          {files.map((f) => (
            <li key={f.path}>
              <button type="button" onClick={() => setOpen(f.path)} className="flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-accent">
                <span className="min-w-0 flex-1 truncate text-foreground">{f.path}</span>
                {f.own ? <span className="shrink-0 rounded-[4px] border border-amber-300 px-1 text-[10px] text-amber-900 dark:border-amber-800 dark:text-amber-200">on this branch</span> : null}
                <span className="shrink-0 text-muted-foreground">{f.size != null ? `${f.size.toLocaleString()} bytes` : ""}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage ? <div className="mt-3 text-center"><Button size="sm" variant="outline" onClick={() => void list.fetchNextPage()}>More files</Button></div> : null}
    </div>
  );
}

function FileEditor({ branch, path, canEdit, onClose, onSaved }: { branch: BranchView; path: string | null; canEdit: boolean; onClose: () => void; onSaved: () => void }) {
  const file = useQuery({ queryKey: ["branch-file", branch.id, path], enabled: Boolean(path), queryFn: () => unwrap(branchFileTextAction(branch.id, path!)) });
  const [newPath, setNewPath] = useState("");
  const [text, setText] = useState<string | null>(null);
  const [editing, setEditing] = useState(!path);
  const [busy, setBusy] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => { if (file.data?.text != null && text === null) setText(file.data.text); }, [file.data, text]);
  async function save() {
    setBusy(true);
    try {
      const res = await saveOnBranchAction(branch.id, { path: path ?? newPath, text: text ?? "", expectedHash: path ? file.data?.contentHash ?? null : null });
      if (!res.success) { toast.error(res.error); return; }
      toast.success(res.data.save ? `Saved on ${branch.name}` : "No changes to save");
      onSaved();
      onClose();
    } finally { setBusy(false); }
  }
  async function remove() {
    const res = await deleteOnBranchAction(branch.id, path!);
    if (!res.success) { toast.error(res.error); return; }
    toast.success(`Deleted on ${branch.name}`);
    onSaved();
    onClose();
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col px-4 py-3">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" aria-hidden />Files</button>
        {path ? <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{path}</span> : (
          <label className="flex min-w-0 flex-1 items-center gap-2 text-xs text-muted-foreground">Path
            <input autoFocus value={newPath} onChange={(e) => setNewPath(e.target.value)} placeholder="/docs/notes.md" className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 font-mono text-sm text-foreground" />
          </label>
        )}
        {canEdit && path && !editing && file.data?.text != null ? <Button size="sm" variant="outline" onClick={() => setEditing(true)}><Pencil className="size-4" aria-hidden />Edit</Button> : null}
        {canEdit && path ? <Button size="sm" variant="outline" onClick={() => setConfirmDelete(true)}><Trash2 className="size-4" aria-hidden />Delete</Button> : null}
        {editing ? <Button size="sm" disabled={busy || (!path && !newPath.trim())} onClick={() => void save()}>{busy ? "Saving…" : `Save on ${branch.name}`}</Button> : null}
      </div>
      {path && file.isLoading ? <div className="h-40 animate-pulse rounded bg-muted" aria-busy="true" /> : path && file.data?.text == null ? (
        <p className="text-sm text-muted-foreground">Not a text file ({file.data?.size?.toLocaleString() ?? "?"} bytes). Download the branch as a zip, or work on it from a folder on this branch.</p>
      ) : editing ? (
        <>
          <label className="sr-only" htmlFor="branch-editor">File content</label>
          <textarea id="branch-editor" value={text ?? ""} onChange={(e) => setText(e.target.value)} spellCheck={false} className="min-h-[18rem] flex-1 rounded-md border border-border bg-background p-2 font-mono text-xs leading-5 text-foreground" />
        </>
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto rounded-md border border-border p-2 font-mono text-xs leading-5 text-foreground">{file.data?.text}</pre>
      )}
      <ConfirmDialog open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete ${path} on ${branch.name}?`} description="Only on this branch; main keeps it. Revert the save to bring it back." confirmLabel="Delete" variant="destructive" onConfirm={() => void remove()} />
    </div>
  );
}

function BranchSaves({ projectId, branch }: { projectId: string; branch: BranchView }) {
  const list = useQuery({ queryKey: ["branch-saves", branch.id], queryFn: () => unwrap(branchSavesAction(projectId, branch.id)) });
  const openSave = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("branch");
    url.searchParams.set("filesView", "history");
    url.searchParams.set("save", id);
    window.location.href = url.toString();
  };
  if (list.isLoading) return <div className="m-4 h-24 animate-pulse rounded bg-muted" aria-busy="true" />;
  const saves = list.data?.saves ?? [];
  if (!saves.length) return <p className="p-4 text-sm text-muted-foreground">No saves on this branch yet.</p>;
  return (
    <ul className="m-4 divide-y divide-border rounded-md border border-border">
      {saves.map((s) => (
        <li key={s.id}>
          <button type="button" onClick={() => openSave(s.id)} className="block w-full px-3 py-2 text-left hover:bg-accent">
            <span className="block truncate text-sm font-medium text-foreground">{s.message}</span>
            <span className="block truncate text-xs text-muted-foreground">{s.author?.name ?? s.author?.username ?? "Someone"}{s.madeWith ? ` · ${s.madeWith}` : ""} · <When at={s.createdAt} />{s.kind === "merge" ? " · update from main" : ""}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
