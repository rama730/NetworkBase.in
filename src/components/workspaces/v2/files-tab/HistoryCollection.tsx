"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, FolderTree, GitCommitHorizontal, Undo2 } from "lucide-react";

import { filesAtSaveAction, getSaveAction, listSavesAction, revertSaveAction, saveDiffAction } from "@/app/actions/files/saves";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { RailSectionHeading } from "@/components/ui/rail-section";
import type { SaveFile, SaveView } from "@/lib/domain/saves";
import type { ItemDiff } from "@/lib/domain/change-sets";
import { downloadFile } from "@/lib/download";
import { toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { When, numbered } from "./ChangesCollection";
import { FileTypeChip } from "./FileTypeChip";
import {
  Cell, FilesHeaderTitle, FilesStrip, GridRow, HeaderCrumbs, IconChip, LineCounts, NameCell, Person, StatusBadge, StripNote, StripSearch, headerButton,
  stripButton, type BadgeTone,
} from "./FilesChrome";
import { openRevertRequest } from "./SaveToBranch";
import { FilesHeaderSlot, FilesViewsMenu } from "./FilesHeader";
import { useFilesTabRole } from "./FilesTabRoleContext";
import { useFilesViews } from "./FilesViews";
import { BranchBar } from "./BranchExplorer";
import listStyles from "./folder/FolderList.module.css";
import { FolderListHeader } from "./folder/FolderListHeader";
import { FolderListEmpty, FolderListError, FolderListLoading } from "./folder/FolderListStates";

export { LineCounts };

/**
 * History (report H3), like GitHub's commit list (H-2b) on the explorer's grid (design audit S2, S5, S6, C2, C3, C8):
 * the saves of the branch in the picker, newest first, grouped by day under the spec's section labels. A save opens
 * with its title and actions in the header, one meta strip, then its files with their +/− and diffs.
 * Open with ?tab=files&filesView=history, or one save with &save=<id>.
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

const fileCounts = (s: SaveView) => [s.files.added && `${s.files.added} added`, s.files.changed && `${s.files.changed} changed`, s.files.deleted && `${s.files.deleted} deleted`, s.files.renamed && `${s.files.renamed} moved`].filter(Boolean).join(" · ");
const fileTotal = (s: SaveView) => s.files.added + s.files.changed + s.files.deleted + s.files.renamed;
const KIND: Record<string, { label: string; tone: BadgeTone }> = {
  start: { label: "Start", tone: "neutral" }, revert: { label: "Revert", tone: "warning" }, sync: { label: "GitHub", tone: "info" }, restore: { label: "Restore", tone: "neutral" },
  merge: { label: "Merge", tone: "success" }, squash: { label: "Squash", tone: "success" },
};
const OP: Record<SaveFile["op"], { label: string; tone: BadgeTone }> = { add: { label: "Added", tone: "success" }, change: { label: "Changed", tone: "warning" }, delete: { label: "Deleted", tone: "danger" }, rename: { label: "Moved", tone: "info" } };
/** "17 Nov 2026", in the person's time zone (0.8 #9). */
const dayOf = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

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

/** A save on the grid: message and kind; who, how and the task under it; when; lines; the save number. */
function SaveRow({ s, onOpen }: { s: SaveView; onOpen: () => void }) {
  return (
    <GridRow onClick={onOpen}>
      <NameCell
        chip={<IconChip><GitCommitHorizontal /></IconChip>}
        name={s.message}
        onOpen={onOpen}
        nameLabel={`Open save ${s.number}: ${s.message}`}
        after={KIND[s.kind] ? <StatusBadge tone={KIND[s.kind]!.tone}>{KIND[s.kind]!.label}</StatusBadge> : null}
        sub={<span className="inline-flex min-w-0 items-center gap-1.5"><Person person={s.author} />{s.madeWith ? <span>{s.madeWith}</span> : null}{s.task?.number ? <span>· #{s.task.number}{s.task.title ? ` ${s.task.title}` : ""}</span> : null}</span>}
      />
      <Cell column="updated"><When at={s.createdAt} /></Cell>
      <Cell column="size" align="right">{s.lines ? <LineCounts lines={s.lines} /> : null}</Cell>
      <Cell column="by">{`${fileTotal(s)} file${fileTotal(s) === 1 ? "" : "s"}`}</Cell>
      <div role="cell" className="text-right font-mono text-[11px] text-[#6B7880] dark:text-muted-foreground" aria-label={`Save ${s.number}`}>{s.number}</div>
    </GridRow>
  );
}

function SaveList({ projectId, onOpen }: { projectId: string; onOpen: (id: string) => void }) {
  const views = useFilesViews();
  const branch = views?.branch ?? null;
  // A file's History button (on a branch too, H8) opens this list filtered to it: ?hpath=/src/a.ts.
  const [draft, setDraft] = useState(() => (typeof window === "undefined" ? "" : new URLSearchParams(window.location.search).get("hpath") ?? ""));
  const [path, setPath] = useState(draft);
  const [showMain, setShowMain] = useState(false);
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has("hpath")) { url.searchParams.delete("hpath"); window.history.replaceState(window.history.state, "", url); }
  }, []);
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
  // On a branch, main's saves from before it began follow its own (H8).
  const mainBefore = branch ? list.data?.pages[0]?.mainBefore ?? null : null;
  const before = useInfiniteQuery({
    queryKey: ["saves", projectId, null, path, "before", mainBefore],
    enabled: showMain && Boolean(mainBefore),
    initialPageParam: mainBefore,
    queryFn: async ({ pageParam }) => {
      const res = await listSavesAction(projectId, { branch: null, path: path || null, cursor: pageParam });
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    getNextPageParam: (last) => last.nextCursor,
  });
  const mainSaves = before.data?.pages.flatMap((p) => p.saves) ?? [];
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
    <>
      <FilesStrip label="History filters">
        <StripNote>{saves.length ? `${saves.length}${list.hasNextPage ? "+" : ""} save${saves.length === 1 ? "" : "s"} on ${branch ?? "main"}` : `Saves on ${branch ?? "main"}`}</StripNote>
        <StripSearch id="history-path" value={draft} onChange={setDraft} onSubmit={(v) => setPath(v.trim())} placeholder="File or folder, like /src" label="Only saves that touched a file or folder" />
      </FilesStrip>
      <div role="table" aria-label={`Saves on ${branch ?? "main"}`} className={cn(listStyles.container, "flex min-h-0 flex-1 flex-col overflow-hidden")}>
        <FolderListHeader updatedLabel="When" sizeLabel="Lines" byLabel="Files" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.isLoading ? <FolderListLoading /> : list.isError ? <FolderListError onRetry={() => void list.refetch()} /> : saves.length === 0 ? (
            <FolderListEmpty plain message={path ? `No saves touched ${path}` : branch ? `No saves on ${branch} yet` : "No saves yet. Every change to the files shows up here."} />
          ) : (
            <>
              {days.map((d) => (
                <section key={d.day} role="rowgroup" aria-label={`Saves on ${d.day}`}>
                  <div className="px-4 pb-1 pt-3"><RailSectionHeading title={`Saves on ${d.day}`} /></div>
                  {d.saves.map((s) => <SaveRow key={s.id} s={s} onOpen={() => onOpen(s.id)} />)}
                </section>
              ))}
              {list.hasNextPage ? (
                <div className="flex justify-center py-3">
                  <button type="button" className={stripButton} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>{list.isFetchingNextPage ? "Loading…" : "Older saves"}</button>
                </div>
              ) : null}
            </>
          )}
          {mainBefore && !list.hasNextPage && !list.isLoading ? (
            showMain ? (
              <section role="rowgroup" aria-label={`On main before ${branch} began`}>
                <div className="px-4 pb-1 pt-3"><RailSectionHeading title={`On main before ${branch} began`} /></div>
                {before.isLoading ? <FolderListLoading /> : mainSaves.length ? mainSaves.map((s) => <SaveRow key={s.id} s={s} onOpen={() => onOpen(s.id)} />) : <FolderListEmpty plain message={path ? `No saves on main touched ${path}` : "No saves on main before it"} />}
                {before.hasNextPage ? <div className="flex justify-center py-3"><button type="button" className={stripButton} disabled={before.isFetchingNextPage} onClick={() => void before.fetchNextPage()}>{before.isFetchingNextPage ? "Loading…" : "Older saves"}</button></div> : null}
              </section>
            ) : (
              <div className="flex justify-center py-3"><button type="button" className={stripButton} onClick={() => setShowMain(true)}>Main’s saves before {branch} began</button></div>
            )
          ) : null}
        </div>
      </div>
    </>
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
  const s = view.data?.save;

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
      else if (res.data.outcome === "merge_request") openRevertRequest(res.data);
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
      <FilesHeaderTitle>
        <HeaderCrumbs
          items={[{ label: "History", onClick: onBack }, { label: s ? `Save ${s.number}: ${s.message}` : "Save", title: s?.message }]}
          after={s && KIND[s.kind] ? <StatusBadge tone={KIND[s.kind]!.tone}>{KIND[s.kind]!.label}</StatusBadge> : s?.branch ? <StatusBadge tone="warning">On {s.branch.name}</StatusBadge> : null}
        />
      </FilesHeaderTitle>
      {s ? (
        <FilesHeaderSlot slot="actions">
          <div className="mr-1 flex items-center gap-1.5">
            {s.branch ? null : <button type="button" className={headerButton} onClick={() => setBrowsing((b) => !b)} aria-pressed={browsing} aria-label={browsing ? "Show changes" : "Browse files at this save"}><FolderTree className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">{browsing ? "Show changes" : "Browse files at this save"}</span></button>}
            {s.branch ? null : <button type="button" className={headerButton} disabled={zipping} aria-label="Download zip" onClick={() => { setZipping(true); void downloadFile(`/api/v1/saves/${id}/zip`, { filename: `save-${s.number}.zip` }).finally(() => setZipping(false)); }}><Download className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">{zipping ? "Preparing…" : "Download zip"}</span></button>}
            {canEdit && s.kind !== "start" ? <button type="button" className={headerButton} disabled={busy} aria-label="Revert" onClick={() => setConfirm(true)}><Undo2 className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">Revert</span></button> : null}
          </div>
        </FilesHeaderSlot>
      ) : null}
      {view.isLoading ? <FolderListLoading /> : view.isError || !s ? (
        <div className="p-4 text-sm"><p role="alert" className="text-destructive">{view.error instanceof Error ? view.error.message : "Couldn’t open this save"}</p><button type="button" className="mt-2 underline" onClick={onBack}>Back to History</button></div>
      ) : (
        <>
          <FilesStrip label="About this save" role="region">
            <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 font-mono text-[11px] text-[#4C5A61] dark:text-muted-foreground">
              <Person person={s.author} nameClassName="text-foreground" />
              {s.madeWith ? <span>{s.madeWith}</span> : null}
              <span>· <When at={s.createdAt} /></span>
              {s.task?.number ? <span>· #{s.task.number}{s.task.title ? ` ${s.task.title}` : ""}</span> : null}
              {fileCounts(s) ? <span>· {fileCounts(s)}</span> : null}
            </span>
            <LineCounts lines={s.lines} />
          </FilesStrip>
          {browsing ? <FilesAtSave id={id} /> : (
            <div className="flex min-h-0 flex-1 flex-col md:flex-row">
              <nav aria-label="Files in this save" className="max-h-64 overflow-y-auto border-b border-border md:max-h-none md:w-80 md:border-b-0 md:border-r">
                {files.length === 0 ? <p className="p-3 text-xs text-muted-foreground">{s.kind === "start" ? "History starts here: the files as they were then are under Browse files." : "No files."}</p> : (
                  <ul>
                    {files.map((f) => (
                      <li key={f.path}>
                        <button type="button" onClick={() => setSelected(f.path)} aria-current={current === f.path} className={cn("flex min-h-12 w-full items-center gap-2.5 border-b border-border/60 px-3 text-left hover:bg-[#FAF8F5] dark:hover:bg-white/[0.02]", current === f.path && "bg-[#F3F0EA] dark:bg-white/[0.06]")}>
                          <FileTypeChip name={f.path.split("/").pop()!} mimeType={f.mimeType} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate font-mono text-xs font-medium text-foreground">{f.path.split("/").pop()}</span>
                            <span className="block truncate font-mono text-[11px] text-muted-foreground">{f.fromPath ? `${f.fromPath} → ${f.path}` : f.path}</span>
                          </span>
                          <span className="flex shrink-0 flex-col items-end gap-1">
                            <StatusBadge tone={OP[f.op].tone}>{OP[f.op].label}</StatusBadge>
                            <LineCounts lines={f.lines} />
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {view.data!.truncated ? <p className="px-3 py-2 font-mono text-[11px] text-muted-foreground">Showing the first 2,000 files.</p> : null}
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
        </>
      )}
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
      <p className="mb-2 truncate font-mono text-[11px] text-muted-foreground">{label}</p>
      {query.isLoading ? <div className="h-40 animate-pulse rounded-[5px] bg-muted" aria-busy="true" /> : query.isError || !data ? (
        <p role="alert" className="text-sm text-destructive">{query.error instanceof Error ? query.error.message : "Couldn’t load the diff"}</p>
      ) : data.kind === "text" ? (
        <pre className="overflow-x-auto rounded-[5px] border border-border font-mono text-xs leading-5">
          {lines.length ? lines.map((l, i) => (
            <div key={i} className={cn("flex whitespace-pre pr-3", l.kind === "+" && "bg-[var(--status-success-soft)] text-[var(--status-success)]", l.kind === "-" && "bg-[var(--status-danger-soft)] text-[var(--status-danger)]", l.kind === "@" && "bg-muted text-muted-foreground")}>
              <span aria-hidden className="w-10 shrink-0 select-none pr-1 text-right text-muted-foreground/70">{l.n ?? ""}</span>
              <span className="sr-only">{l.kind === "+" ? "added line: " : l.kind === "-" ? "removed line: " : ""}</span>
              <span aria-hidden className="select-none pr-2">{l.kind === "@" ? "" : l.kind}</span>{l.text}
            </div>
          )) : <div className="px-3 py-2 text-muted-foreground">No line changes{renamedOnly ? ": moved only" : ""}.</div>}
        </pre>
      ) : data.kind === "image" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["before", "after"] as const).map((side) => (
            <figure key={side} className="rounded-[5px] border border-border p-2">
              <figcaption className="mb-1 font-mono text-[11px] text-muted-foreground">{side === "before" ? "Before" : "After"}</figcaption>
              {data[side] ? <img src={data[side]!} alt={`${path} ${side}`} className="max-h-80 w-full object-contain" /> : <p className="text-xs text-muted-foreground">None</p>}
            </figure>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {data.kind === "too_large" ? "Too large to show here. " : "Not a text file. "}
          Size {data.beforeSize == null ? "—" : `${data.beforeSize.toLocaleString()} bytes`} → {data.afterSize == null ? "deleted" : `${data.afterSize.toLocaleString()} bytes`}.
        </p>
      )}
    </div>
  );
}

/** The files as they were at this save (read-only), 5,000 a page, on the explorer's grid. */
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
    <div role="table" aria-label="Files at this save" className={cn(listStyles.container, "flex min-h-0 flex-1 flex-col overflow-hidden")}>
      <FolderListHeader updatedLabel="Version" byLabel="—" />
      <div className="min-h-0 flex-1 overflow-y-auto">
        {list.isLoading ? <FolderListLoading /> : list.isError ? <FolderListError onRetry={() => void list.refetch()} /> : (
          <div role="rowgroup">
            {files.map((f) => (
              <GridRow key={f.path}>
                <NameCell chip={<FileTypeChip name={f.path.split("/").pop()!} mimeType={null} />} name={f.path.split("/").pop()} sub={f.path} />
                <Cell column="updated">v{f.version}</Cell>
                <Cell column="size" align="right">{f.size != null ? `${f.size.toLocaleString()} B` : null}</Cell>
                <Cell column="by" /><div role="cell" />
              </GridRow>
            ))}
            {list.hasNextPage ? <div className="flex justify-center py-3"><button type="button" className={stripButton} disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>More files</button></div> : null}
          </div>
        )}
      </div>
    </div>
  );
}
