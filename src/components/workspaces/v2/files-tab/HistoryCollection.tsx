"use client";

import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, FolderTree, GitCommitHorizontal, Search, Undo2 } from "lucide-react";

import { filesAtSaveAction, getSaveAction, listSavesAction, revertSaveAction, saveDiffAction } from "@/app/actions/files/saves";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { SaveFile, SaveView } from "@/lib/domain/saves";
import { downloadFile } from "@/lib/download";
import { feedbackError, toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { EmptyState, When, numbered } from "./ChangesCollection";
import { FilesViewsMenu } from "./FilesHeader";
import { useFilesTabRole } from "./FilesTabRoleContext";

/**
 * History (report H3): main's saves, newest first. Open with ?tab=files&filesView=history, or one save with &save=<id>:
 * its files and diffs, the files as they were then, a zip, and Revert.
 */
function readParam() {
  return typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("save");
}
function writeParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("save", id);
  else url.searchParams.delete("save");
  window.history.replaceState(window.history.state, "", url);
}

const byWhom = (s: SaveView) => `${s.author?.name ?? s.author?.username ?? "Someone"}${s.madeWith ? ` · ${s.madeWith}` : ""}`;
const fileCounts = (s: SaveView) => [s.files.added && `${s.files.added} added`, s.files.changed && `${s.files.changed} changed`, s.files.deleted && `${s.files.deleted} deleted`, s.files.renamed && `${s.files.renamed} moved`].filter(Boolean).join(" · ");
const OP_WORDS: Record<SaveFile["op"], string> = { add: "Added", change: "Changed", delete: "Deleted", rename: "Moved" };

export function HistoryCollection({ projectId }: { projectId: string }) {
  const [openId, setOpenId] = useState<string | null>(() => readParam());
  const open = useCallback((id: string | null) => { setOpenId(id); writeParam(id); }, []);
  return (
    <div aria-label="History" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card dark:bg-background">
      <FilesViewsMenu projectId={projectId} />
      {openId ? <SavePage key={openId} projectId={projectId} id={openId} onBack={() => open(null)} onOpen={open} /> : <SaveList projectId={projectId} onOpen={open} />}
    </div>
  );
}

function SaveList({ projectId, onOpen }: { projectId: string; onOpen: (id: string) => void }) {
  const [draft, setDraft] = useState("");
  const [path, setPath] = useState("");
  const list = useInfiniteQuery({
    queryKey: ["saves", projectId, path],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const res = await listSavesAction(projectId, { path: path || null, cursor: pageParam });
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 15_000,
  });
  const saves = list.data?.pages.flatMap((p) => p.saves) ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <form className="relative mb-3 max-w-sm" onSubmit={(e) => { e.preventDefault(); setPath(draft.trim()); }}>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
        <label className="sr-only" htmlFor="history-path">Only saves that touched a file or folder</label>
        <input id="history-path" value={draft} onChange={(e) => setDraft(e.target.value)} onBlur={() => setPath(draft.trim())} placeholder="Filter by file or folder, like /src" className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-sm" />
      </form>
      {list.isLoading ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}</div>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-destructive">{feedbackError(list.error instanceof Error ? list.error.message : "", "Couldn’t load history")} <button type="button" className="underline" onClick={() => void list.refetch()}>Retry</button></p>
      ) : saves.length === 0 ? (
        <EmptyState title={path ? `No saves touched ${path}` : "No saves yet"} body="Every change to the files shows up here." />
      ) : (
        <>
          <ul className="divide-y divide-border rounded-md border border-border">
            {saves.map((s) => (
              <li key={s.id}>
                <button type="button" onClick={() => onOpen(s.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                  <GitCommitHorizontal className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground">{s.message}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {byWhom(s)} · <When at={s.createdAt} />{fileCounts(s) ? ` · ${fileCounts(s)}` : ""}{s.task?.number ? ` · #${s.task.number}` : ""}
                    </span>
                  </span>
                  {s.kind !== "save" ? <span className="shrink-0 rounded-[5px] border border-border px-1.5 py-0.5 text-xs text-muted-foreground">{s.kind === "start" ? "Start" : s.kind === "revert" ? "Revert" : s.kind === "sync" ? "GitHub" : s.kind === "restore" ? "Restore" : s.kind}</span> : null}
                </button>
              </li>
            ))}
          </ul>
          {list.hasNextPage ? (
            <div className="mt-3 text-center">
              <Button size="sm" variant="outline" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{list.isFetchingNextPage ? "Loading…" : "Older saves"}</Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function SavePage({ projectId, id, onBack, onOpen }: { projectId: string; id: string; onBack: () => void; onOpen: (id: string) => void }) {
  const { canEdit } = useFilesTabRole();
  const client = useQueryClient();
  const view = useQuery({
    queryKey: ["save", id],
    queryFn: async () => {
      const res = await getSaveAction(id);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
  const [selected, setSelected] = useState<string | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [zipping, setZipping] = useState(false);
  const files = view.data?.files ?? [];
  const current = selected ?? files[0]?.path ?? null;

  if (view.isLoading) return <div className="space-y-2 p-4" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-muted" />)}</div>;
  if (view.isError || !view.data) return <div className="p-4 text-sm"><p role="alert" className="text-destructive">{view.error instanceof Error ? view.error.message : "Couldn’t open this save"}</p><button type="button" className="mt-2 underline" onClick={onBack}>Back to History</button></div>;
  const s = view.data.save;

  async function revert() {
    setBusy(true);
    try {
      const res = await revertSaveAction(id);
      if (!res.success) { toast.error(res.error); return; }
      void client.invalidateQueries({ queryKey: ["saves", projectId] });
      void client.invalidateQueries({ queryKey: ["files-directory", projectId] });
      if (res.data.outcome === "reverted" && res.data.saveId) { toast.success("Reverted"); onOpen(res.data.saveId); }
      else if (res.data.outcome === "nothing") toast.success("Nothing to revert: the files are already as they were before");
      else {
        toast.error("Some files changed since: choose for each in Changes");
        const url = new URL(window.location.href);
        url.searchParams.delete("save");
        url.searchParams.set("changes", res.data.changeSetId!);
        window.location.href = url.toString();
      }
    } finally {
      setBusy(false);
      setConfirm(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-border px-4 py-3">
        <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" aria-hidden />History</button>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-foreground">{s.message}</h2>
            <p className="text-xs text-muted-foreground">Save {s.number} · {byWhom(s)} · <When at={s.createdAt} />{fileCounts(s) ? ` · ${fileCounts(s)}` : ""}{s.task?.number ? ` · #${s.task.number}` : ""}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={() => setBrowsing((b) => !b)} aria-pressed={browsing}><FolderTree className="size-4" aria-hidden />{browsing ? "Show changes" : "Browse files at this save"}</Button>
            <Button size="sm" variant="outline" disabled={zipping} onClick={() => { setZipping(true); void downloadFile(`/api/v1/saves/${id}/zip`, { filename: `save-${s.number}.zip` }).finally(() => setZipping(false)); }}><Download className="size-4" aria-hidden />{zipping ? "Preparing…" : "Download zip"}</Button>
            {canEdit && s.kind !== "start" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => setConfirm(true)}><Undo2 className="size-4" aria-hidden />Revert</Button> : null}
          </div>
        </div>
      </header>
      {browsing ? <FilesAtSave id={id} /> : (
        <div className="flex min-h-0 flex-1 flex-col md:flex-row">
          <nav aria-label="Files in this save" className="max-h-64 overflow-y-auto border-b border-border md:max-h-none md:w-80 md:border-b-0 md:border-r">
            {files.length === 0 ? <p className="p-3 text-sm text-muted-foreground">{s.kind === "start" ? "History starts here: the files as they were then are under Browse files." : "No files."}</p> : (
              <ul className="py-1">
                {files.map((f) => (
                  <li key={f.path}>
                    <button type="button" onClick={() => setSelected(f.path)} aria-current={current === f.path} className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left", current === f.path && "bg-accent")}>
                      <span className="w-14 shrink-0 text-[11px] text-muted-foreground">{OP_WORDS[f.op]}</span>
                      <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{f.fromPath ? `${f.fromPath} → ${f.path}` : f.path}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {view.data.truncated ? <p className="px-3 pb-2 text-xs text-muted-foreground">Showing the first 2,000 files.</p> : null}
          </nav>
          <section aria-label="Diff" className="min-h-0 min-w-0 flex-1 overflow-auto">
            {current ? <SaveDiff id={id} file={files.find((f) => f.path === current)!} /> : null}
          </section>
        </div>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={`Revert “${s.message}”?`}
        description="A new save puts these files back as they were before it. Later changes to them are kept where they don’t overlap; if they do, you choose in Changes."
        confirmLabel="Revert"
        loading={busy}
        onConfirm={() => void revert()}
      />
    </div>
  );
}

function SaveDiff({ id, file }: { id: string; file: SaveFile }) {
  const diff = useQuery({
    queryKey: ["save-diff", id, file.path],
    queryFn: async () => {
      const res = await saveDiffAction(id, file.path);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    staleTime: 5 * 60_000,
  });
  const lines = useMemo(() => (diff.data?.kind === "text" ? numbered(diff.data.lines) : []), [diff.data]);
  return (
    <div className="p-3">
      <p className="mb-2 truncate font-mono text-xs text-muted-foreground">{file.fromPath ? `${file.fromPath} → ${file.path}` : file.path}</p>
      {diff.isLoading ? <div className="h-40 animate-pulse rounded bg-muted" aria-busy="true" /> : diff.isError || !diff.data ? (
        <p role="alert" className="text-sm text-destructive">{diff.error instanceof Error ? diff.error.message : "Couldn’t load the diff"}</p>
      ) : diff.data.kind === "text" ? (
        <pre className="overflow-x-auto rounded-md border border-border font-mono text-xs leading-5">
          {lines.length ? lines.map((l, i) => (
            <div key={i} className={cn("flex whitespace-pre pr-3", l.kind === "+" && "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200", l.kind === "-" && "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200", l.kind === "@" && "bg-muted text-muted-foreground")}>
              <span aria-hidden className="w-10 shrink-0 select-none pr-1 text-right text-muted-foreground/70">{l.n ?? ""}</span>
              <span className="sr-only">{l.kind === "+" ? "added line: " : l.kind === "-" ? "removed line: " : ""}</span>
              <span aria-hidden className="select-none pr-2">{l.kind === "@" ? "" : l.kind}</span>{l.text}
            </div>
          )) : <div className="px-3 py-2 text-muted-foreground">No line changes{file.op === "rename" ? ": moved only" : ""}.</div>}
        </pre>
      ) : diff.data.kind === "image" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["before", "after"] as const).map((side) => (
            <figure key={side} className="rounded-md border border-border p-2">
              <figcaption className="mb-1 text-xs text-muted-foreground">{side === "before" ? "Before" : "After"}</figcaption>
              {diff.data.kind === "image" && diff.data[side] ? <img src={diff.data[side]!} alt={`${file.path} ${side}`} className="max-h-80 w-full object-contain" /> : <p className="text-xs text-muted-foreground">None</p>}
            </figure>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {diff.data.kind === "too_large" ? "Too large to show here. " : "Not a text file. "}
          Size {diff.data.beforeSize == null ? "—" : `${diff.data.beforeSize.toLocaleString()} bytes`} → {diff.data.afterSize == null ? "deleted" : `${diff.data.afterSize.toLocaleString()} bytes`}.
        </p>
      )}
    </div>
  );
}

/** The files as they were at this save (read-only), 5,000 a page. */
function FilesAtSave({ id }: { id: string }) {
  const list = useInfiniteQuery({
    queryKey: ["save-files", id],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const res = await filesAtSaveAction(id, pageParam);
      if (!res.success) throw new Error(res.error);
      return res.data.files;
    },
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 5 * 60_000,
  });
  const files = list.data?.pages.flatMap((p) => p.files) ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {list.isLoading ? <div className="h-40 animate-pulse rounded bg-muted" aria-busy="true" /> : list.isError ? (
        <p role="alert" className="text-sm text-destructive">{list.error instanceof Error ? list.error.message : "Couldn’t load the files"}</p>
      ) : (
        <>
          <p className="mb-2 text-xs text-muted-foreground">{files.length.toLocaleString()}{list.hasNextPage ? "+" : ""} files as they were at this save (read-only).</p>
          <ul className="divide-y divide-border rounded-md border border-border font-mono text-xs">
            {files.map((f) => (
              <li key={f.path} className="flex items-center gap-3 px-3 py-1.5">
                <span className="min-w-0 flex-1 truncate text-foreground">{f.path}</span>
                <span className="shrink-0 text-muted-foreground">v{f.version}{f.size != null ? ` · ${f.size.toLocaleString()} bytes` : ""}</span>
              </li>
            ))}
          </ul>
          {list.hasNextPage ? <div className="mt-3 text-center"><Button size="sm" variant="outline" disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>More files</Button></div> : null}
        </>
      )}
    </div>
  );
}
