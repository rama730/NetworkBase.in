"use client";

import { useCallback, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Download, FolderTree, GitCommitHorizontal, Search, Undo2 } from "lucide-react";

import { filesAtSaveAction, getSaveAction, listSavesAction, revertSaveAction, saveDiffAction } from "@/app/actions/files/saves";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { SaveFile, SaveView } from "@/lib/domain/saves";
import type { ItemDiff } from "@/lib/domain/change-sets";
import { downloadFile } from "@/lib/download";
import { feedbackError, toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { EmptyState, When, numbered } from "./ChangesCollection";
import { FilesViewsMenu } from "./FilesHeader";
import { useFilesTabRole } from "./FilesTabRoleContext";
import { useFilesViews } from "./FilesViews";
import { BranchBar } from "./BranchExplorer";

/**
 * History (report H3), like GitHub's commit list (H-2b): the saves of the branch in the picker (main by default),
 * newest first and grouped by day, each with who, when, its files and lines added and removed. Open with
 * ?tab=files&filesView=history, or one save with &save=<id>: its files with their +/−, diffs, the files as they were
 * then, a zip, and Revert.
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
      <BranchBar projectId={projectId} />
      {openId ? <SavePage key={openId} projectId={projectId} id={openId} onBack={() => open(null)} onOpen={open} /> : <SaveList projectId={projectId} onOpen={open} />}
    </div>
  );
}

/** "Saves on 17 Nov 2026", the way GitHub groups commits; in the person's time zone (0.8 #9). */
const dayOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

function Avatar({ person }: { person: SaveView["author"] }) {
  const name = person?.name ?? person?.username ?? "?";
  return person?.avatarUrl
    ? <img src={person.avatarUrl} alt="" className="size-6 shrink-0 rounded-full object-cover" />
    : <span aria-hidden className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-semibold text-muted-foreground">{name.replace(/^@/, "")[0]?.toUpperCase()}</span>;
}

/** +12 −3, GitHub's colours; nothing when the lines weren't counted (binary files, saves over 200 files). */
export function LineCounts({ lines, className }: { lines: { added: number; removed: number } | null; className?: string }) {
  if (!lines) return null;
  return (
    <span className={cn("shrink-0 font-mono text-xs", className)} aria-label={`${lines.added} line${lines.added === 1 ? "" : "s"} added, ${lines.removed} removed`}>
      <span className="text-emerald-700 dark:text-emerald-400">+{lines.added}</span> <span className="text-red-700 dark:text-red-400">−{lines.removed}</span>
    </span>
  );
}

const fileTotal = (s: SaveView) => s.files.added + s.files.changed + s.files.deleted + s.files.renamed;

function SaveList({ projectId, onOpen }: { projectId: string; onOpen: (id: string) => void }) {
  const views = useFilesViews();
  const branch = views?.branch ?? null;
  const [draft, setDraft] = useState("");
  const [path, setPath] = useState("");
  const list = useInfiniteQuery({
    queryKey: ["saves", projectId, branch, path],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam }) => {
      const res = await listSavesAction(projectId, { branch, path: path || null, cursor: pageParam });
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    getNextPageParam: (last) => last.nextCursor,
    staleTime: 15_000,
  });
  const saves = list.data?.pages.flatMap((p) => p.saves) ?? [];
  const days = useMemo(() => {
    const out: Array<{ day: string; saves: SaveView[] }> = [];
    for (const s of saves) {
      const day = dayOf(s.createdAt);
      if (out.at(-1)?.day === day) out.at(-1)!.saves.push(s);
      else out.push({ day, saves: [s] });
    }
    return out;
  }, [saves]);
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
        <EmptyState title={path ? `No saves touched ${path}` : branch ? `No saves on ${branch} yet` : "No saves yet"} body="Every change to the files shows up here." />
      ) : (
        <>
          {days.map((d) => (
            <section key={d.day} aria-label={`Saves on ${d.day}`} className="mb-4">
              <h3 className="mb-1.5 flex items-center gap-2 text-xs font-medium text-muted-foreground"><GitCommitHorizontal className="size-3.5" aria-hidden />Saves on {d.day}</h3>
              <ul className="divide-y divide-border rounded-md border border-border">
                {d.saves.map((s) => (
                  <li key={s.id}>
                    <button type="button" onClick={() => onOpen(s.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="truncate text-sm font-medium text-foreground">{s.message}</span>
                          {s.kind !== "save" ? <span className="shrink-0 rounded-[5px] border border-border px-1.5 py-0.5 text-[11px] text-muted-foreground">{s.kind === "start" ? "Start" : s.kind === "revert" ? "Revert" : s.kind === "sync" ? "GitHub" : s.kind === "restore" ? "Restore" : s.kind === "merge" ? "Merge" : s.kind === "squash" ? "Squash" : s.kind}</span> : null}
                        </span>
                        <span className="mt-1 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                          <Avatar person={s.author} />
                          <span className="truncate"><span className="font-medium text-foreground/80">{s.author?.name ?? s.author?.username ?? "Someone"}</span>{s.madeWith ? ` ${s.madeWith}` : ""} saved <When at={s.createdAt} />{s.task?.number ? ` · #${s.task.number}${s.task.title ? ` ${s.task.title}` : ""}` : ""}</span>
                        </span>
                      </span>
                      <span className="hidden shrink-0 flex-col items-end gap-0.5 sm:flex">
                        <LineCounts lines={s.lines} />
                        <span className="text-[11px] text-muted-foreground">{fileTotal(s)} file{fileTotal(s) === 1 ? "" : "s"}</span>
                      </span>
                      <span className="shrink-0 rounded-[4px] border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground" aria-label={`Save ${s.number}`}>#{s.number}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
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
      if (!res.success && res.code === "STEP_UP_REQUIRED" && res.details?.changeSetId) {
        // Apply in Changes asks "Verify it's you" first, then applies the revert.
        toast.error(res.error);
        const url = new URL(window.location.href);
        url.searchParams.delete("save");
        url.searchParams.set("changes", String(res.details.changeSetId));
        window.location.href = url.toString();
        return;
      }
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
            <p className="flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground"><Avatar person={s.author} /><span>Save {s.number} · {byWhom(s)} · <When at={s.createdAt} />{fileCounts(s) ? ` · ${fileCounts(s)}` : ""}{s.task?.number ? ` · #${s.task.number}${s.task.title ? ` ${s.task.title}` : ""}` : ""}</span><LineCounts lines={s.lines} /></p>
          </div>
          <div className="flex flex-wrap gap-2">
            {s.branch ? <span className="self-center rounded-[5px] border border-amber-300 px-1.5 py-0.5 text-xs text-amber-900 dark:border-amber-800 dark:text-amber-200">On {s.branch.name}</span> : null}
            {s.branch ? null : <Button size="sm" variant="outline" onClick={() => setBrowsing((b) => !b)} aria-pressed={browsing}><FolderTree className="size-4" aria-hidden />{browsing ? "Show changes" : "Browse files at this save"}</Button>}
            {s.branch ? null : <Button size="sm" variant="outline" disabled={zipping} onClick={() => { setZipping(true); void downloadFile(`/api/v1/saves/${id}/zip`, { filename: `save-${s.number}.zip` }).finally(() => setZipping(false)); }}><Download className="size-4" aria-hidden />{zipping ? "Preparing…" : "Download zip"}</Button>}
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
                      <LineCounts lines={f.lines} className="text-[11px]" />
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
  return <DiffView query={diff} label={file.fromPath ? `${file.fromPath} → ${file.path}` : file.path} path={file.path} renamedOnly={file.op === "rename"} />;
}

/** One file's diff (a save's, or a branch's against main): text with line numbers, images side by side, or sizes. */
export function DiffView({ query, label, path, renamedOnly = false }: { query: { isLoading: boolean; isError: boolean; error: unknown; data?: ItemDiff }; label: string; path: string; renamedOnly?: boolean }) {
  const lines = useMemo(() => (query.data?.kind === "text" ? numbered(query.data.lines) : []), [query.data]);
  const data = query.data;
  return (
    <div className="p-3">
      <p className="mb-2 truncate font-mono text-xs text-muted-foreground">{label}</p>
      {query.isLoading ? <div className="h-40 animate-pulse rounded bg-muted" aria-busy="true" /> : query.isError || !data ? (
        <p role="alert" className="text-sm text-destructive">{query.error instanceof Error ? query.error.message : "Couldn’t load the diff"}</p>
      ) : data.kind === "text" ? (
        <pre className="overflow-x-auto rounded-md border border-border font-mono text-xs leading-5">
          {lines.length ? lines.map((l, i) => (
            <div key={i} className={cn("flex whitespace-pre pr-3", l.kind === "+" && "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200", l.kind === "-" && "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200", l.kind === "@" && "bg-muted text-muted-foreground")}>
              <span aria-hidden className="w-10 shrink-0 select-none pr-1 text-right text-muted-foreground/70">{l.n ?? ""}</span>
              <span className="sr-only">{l.kind === "+" ? "added line: " : l.kind === "-" ? "removed line: " : ""}</span>
              <span aria-hidden className="select-none pr-2">{l.kind === "@" ? "" : l.kind}</span>{l.text}
            </div>
          )) : <div className="px-3 py-2 text-muted-foreground">No line changes{renamedOnly ? ": moved only" : ""}.</div>}
        </pre>
      ) : data.kind === "image" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["before", "after"] as const).map((side) => (
            <figure key={side} className="rounded-md border border-border p-2">
              <figcaption className="mb-1 text-xs text-muted-foreground">{side === "before" ? "Before" : "After"}</figcaption>
              {data[side] ? <img src={data[side]!} alt={`${path} ${side}`} className="max-h-80 w-full object-contain" /> : <p className="text-xs text-muted-foreground">None</p>}
            </figure>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {data.kind === "too_large" ? "Too large to show here. " : "Not a text file. "}
          Size {data.beforeSize == null ? "—" : `${data.beforeSize.toLocaleString()} bytes`} → {data.afterSize == null ? "deleted" : `${data.afterSize.toLocaleString()} bytes`}.
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
