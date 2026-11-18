"use client";

import { useCallback, useMemo, useState } from "react";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, CircleDot, GitMerge, GitPullRequest, MessageSquare, Paperclip, Trash2, Undo2, X } from "lucide-react";

import { branchDiffAction, deleteBranchAction } from "@/app/actions/files/branches";
import {
  applySuggestionAction, attachMergeResultAction, commentMergeRequestAction, getMergeRequestAction, listMergeRequestsAction, mergeMergeRequestAction, reviewMergeRequestAction,
  updateMergeRequestAction,
} from "@/app/actions/files/merge-requests";
import { getSaveAction, revertSaveAction } from "@/app/actions/files/saves";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Virtuoso } from "react-virtuoso";
import { useStepUp } from "@/components/trust/StepUp";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { mergeRequestHref, openRevertRequest } from "@/components/workspaces/v2/files-tab/SaveToBranch";
import { RailSectionHeading } from "@/components/ui/rail-section";
import type { getMergeRequest, MergeRequestSummary } from "@/lib/domain/merge-requests";
import { toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { When } from "./ChangesCollection";
import { FileTypeChip } from "./FileTypeChip";
import {
  Cell, FilesHeaderTitle, FilesStrip, FilterChip, GridRow, HeaderCrumbs, IconChip, LineCounts, NameCell, Person, StatusBadge, UnderlineTabs, headerButton, headerPrimary,
  personName, stripButton, stripPrimary, type BadgeTone,
} from "./FilesChrome";
import { FilesHeaderSlot, FilesViewsMenu } from "./FilesHeader";
import { useFilesViews } from "./FilesViews";
import { useFilesTabRole } from "./FilesTabRoleContext";
import { DiffView } from "./HistoryCollection";
import listStyles from "./folder/FolderList.module.css";
import { FolderListHeader } from "./folder/FolderListHeader";
import { FolderListEmpty, FolderListError, FolderListLoading } from "./folder/FolderListStates";
import { useDraft } from "./useDraft";

/**
 * Merge requests (report H4, phase H-3; design audit 17 Nov 2026): the list on the explorer's grid with Trash's filter
 * chips, and one merge request with its title, state and actions in the Files header, tabs under it, and a feed of
 * what happened with square avatars. Open with ?tab=files&filesView=merge-requests, or one with &mr=<number>.
 */
type Detail = Awaited<ReturnType<typeof getMergeRequest>>;
type PersonView = { id: string; name: string | null; username: string | null; avatarUrl?: string | null; former?: boolean } | null;

function readParam() {
  if (typeof window === "undefined") return null;
  const n = Number(new URLSearchParams(window.location.search).get("mr"));
  return Number.isInteger(n) && n > 0 ? n : null;
}
function writeParam(n: number | null) {
  const url = new URL(window.location.href);
  if (n) url.searchParams.set("mr", String(n));
  else url.searchParams.delete("mr");
  window.history.replaceState(window.history.state, "", url);
}
const unwrap = async <T,>(p: Promise<{ success: true; data: T } | { success: false; error: string }>) => {
  const res = await p;
  if (!res.success) throw new Error(res.error);
  return res.data;
};
const STATE: Record<string, { label: string; tone: BadgeTone }> = {
  draft: { label: "Draft", tone: "neutral" }, open: { label: "Open", tone: "info" }, approved: { label: "Approved", tone: "success" },
  changes_requested: { label: "Changes requested", tone: "warning" }, merged: { label: "Merged", tone: "success" }, closed: { label: "Closed", tone: "neutral" },
};
function StateBadge({ state }: { state: string }) {
  const s = STATE[state] ?? STATE.open!;
  return <StatusBadge tone={s.tone}>{s.label}</StatusBadge>;
}
/** To the branch in All files (it takes the picker with it). */
function toBranch(name: string) {
  const url = new URL(window.location.href);
  for (const k of ["filesView", "mr", "save", "bpath", "bfile"]) url.searchParams.delete(k);
  url.searchParams.set("branch", name);
  url.searchParams.set("filesNav", "tree");
  window.location.href = url.toString();
}

export function MergeRequestsCollection({ projectId }: { projectId: string }) {
  const [number, setNumber] = useState<number | null>(() => readParam());
  const open = useCallback((n: number | null) => { setNumber(n); writeParam(n); }, []);
  return (
    <div aria-label="Merge requests" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card dark:bg-background">
      <FilesViewsMenu projectId={projectId} />
      {number ? <MergeRequestPage key={number} projectId={projectId} number={number} onBack={() => open(null)} /> : <MergeRequestList projectId={projectId} onOpen={open} />}
    </div>
  );
}

const FILTERS = [["open", "Open"], ["review", "Waiting on me"], ["merged", "Merged"], ["closed", "Closed"]] as const;
type Filter = (typeof FILTERS)[number][0];

function MergeRequestList({ projectId, onOpen }: { projectId: string; onOpen: (n: number) => void }) {
  const [filter, setFilter] = useState<Filter>("open");
  // One list per filter, so each chip shows its count (Trash's filters).
  const client = useQueryClient();
  const lists = useQueries({ queries: FILTERS.map(([f]) => ({ queryKey: ["merge-requests", projectId, f], queryFn: () => unwrap(listMergeRequestsAction(projectId, f === "review" ? "open" : f, f === "review")), staleTime: 15_000 })) });
  const list = lists[FILTERS.findIndex(([f]) => f === filter)]!;
  const rows: MergeRequestSummary[] = list.data?.mergeRequests ?? [];
  return (
    <>
      <FilesStrip label="Merge request filters">
        <div className="flex flex-wrap items-center gap-1.5">
          {FILTERS.map(([f, label], i) => <FilterChip key={f} on={filter === f} label={label} count={lists[i]?.data?.mergeRequests.length ?? null} onClick={() => setFilter(f)} testId={`mr-filter-${f}`} />)}
        </div>
      </FilesStrip>
      <div role="table" aria-label="Merge requests" className={cn(listStyles.container, "flex min-h-0 flex-1 flex-col overflow-hidden")}>
        <FolderListHeader updatedLabel="Updated" sizeLabel="Reviews" byLabel="Opened by" />
        <div className="min-h-0 flex-1 overflow-y-auto">
          {list.isLoading ? <FolderListLoading /> : list.isError ? <FolderListError onRetry={() => void list.refetch()} /> : rows.length === 0 ? (
            <FolderListEmpty plain message={filter === "review" ? "Nothing waiting on you." : filter === "open" ? "No open merge requests. Open one from a branch’s bar, or nb merge-request create." : `No ${filter} merge requests.`} />
          ) : (
            <div role="rowgroup" aria-keyshortcuts="j k a" onKeyDown={(e) => {
              // H23 journey 4: j/k move through the list, Enter opens, a approves one waiting on your review.
              const buttons = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('button[aria-label^="Open merge request !"]')];
              const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
              if (e.key === "j" || e.key === "k") { e.preventDefault(); buttons[Math.min(Math.max(at + (e.key === "j" ? 1 : -1), 0), buttons.length - 1)]?.focus(); }
              else if (e.key === "a" && at >= 0) {
                const m = rows.find((r) => r.number === Number(/!(\d+)/.exec(buttons[at]!.getAttribute("aria-label") ?? "")?.[1]));
                if (m?.reviewRequested) { e.preventDefault(); void reviewMergeRequestAction(projectId, m.number, "approve", "").then((res) => { if (res.success) { toast.success(`Approved !${m.number}`); void client.invalidateQueries({ queryKey: ["merge-requests", projectId] }); } else toast.error(res.error); }); }
              }
            }}>
              {rows.map((m) => {
                const shown = m.state === "open" && m.changesRequested ? "changes_requested" : m.state === "open" && m.approvals ? "approved" : m.state;
                return (
                  <GridRow key={m.id} onClick={() => onOpen(m.number)}>
                    <NameCell
                      chip={<IconChip><GitPullRequest /></IconChip>}
                      name={<>!{m.number} {m.title}</>}
                      onOpen={() => onOpen(m.number)}
                      nameLabel={`Open merge request !${m.number}: ${m.title}`}
                      after={<><StateBadge state={shown} />{m.reviewRequested ? <StatusBadge tone="info">Your review</StatusBadge> : null}</>}
                      sub={<>{m.source.name} → main{m.comments ? ` · ${m.comments} comment${m.comments === 1 ? "" : "s"}` : ""}{m.madeWith ? ` · ${m.madeWith}` : ""}</>}
                    />
                    <Cell column="updated"><When at={m.updatedAt} /></Cell>
                    <Cell column="size" align="right">{m.approvals || m.changesRequested ? `${m.approvals} ✓ · ${m.changesRequested} ✗` : null}</Cell>
                    <Cell column="by"><Person person={m.author} /></Cell>
                    <div role="cell" />
                  </GridRow>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

type Tab = "conversation" | "saves" | "files";
type Act = <T>(name: string, run: () => Promise<{ success: true; data: T } | { success: false; error: string; stepUp?: unknown }>, done?: string) => Promise<T | null>;
const selectClass = "h-8 rounded-[5px] border border-border bg-card px-2 text-xs text-foreground focus:border-[#D14E24] focus:outline-none";

function MergeRequestPage({ projectId, number, onBack }: { projectId: string; number: number; onBack: () => void }) {
  const { canEdit } = useFilesTabRole();
  const client = useQueryClient();
  const views = useFilesViews();
  const view = useQuery({ queryKey: ["merge-request", projectId, number], queryFn: () => unwrap(getMergeRequestAction(projectId, number)) });
  const [tab, setTab] = useState<Tab>("conversation");
  const [busy, setBusy] = useState<string | null>(null);
  const [method, setMethod] = useState<"merge" | "squash">("merge");
  const [conflicts, setConflicts] = useState<Array<{ path: string; kind: string }> | null>(null);
  const [secretFiles, setSecretFiles] = useState<string[] | null>(null);
  const [confirmRevert, setConfirmRevert] = useState(false);
  const [confirmDeleteBranch, setConfirmDeleteBranch] = useState(false);
  const [confirmOverride, setConfirmOverride] = useState(false);
  const { needs: needsStepUp, dialog: stepUpDialog } = useStepUp("This merge changes a doc or final files, so confirm it’s you before merging.");
  const refresh = () => {
    for (const key of [["merge-request", projectId, number], ["merge-requests", projectId], ["branches", projectId], ["branch", projectId], ["saves", projectId], ["files-directory", projectId]]) void client.invalidateQueries({ queryKey: key });
  };
  const d = view.data;
  const m = d?.mergeRequest;
  const isOpen = m?.state === "open" || m?.state === "draft";

  const act: Act = async (name, run, done) => {
    if (busy) return null;
    setBusy(name);
    try {
      const res = await run();
      if (needsStepUp(res as never, () => void act(name, run, done))) return null;
      if (!res.success) { toast.error(res.error); return null; }
      if (done) toast.success(done);
      refresh();
      return res.data;
    } finally { setBusy(null); }
  };
  async function merge(confirmSecrets = false, override = false) {
    setSecretFiles(null);
    const res = await act("merge", async () => {
      const r = await mergeMergeRequestAction(projectId, number, method, confirmSecrets, override);
      // Files that look like they hold a key: say which, and merge only on the person's yes (as Apply does).
      if (!r.success && r.code === "SECRET_DETECTED") {
        const findings = (r.details?.findings ?? []) as Array<{ path?: string }>;
        setSecretFiles([...new Set(findings.map((f) => f.path ?? "a file"))]);
        return { success: true as const, data: null };
      }
      return r;
    });
    if (!res) return;
    if (res.outcome === "conflicts") { setConflicts(res.conflicts); return; }
    setConflicts(null);
    // One Undo right after merging (H8): it reverts the merge's save, as Revert merge does.
    const mergedSave = res.save?.id ?? null;
    toast.success(`Merged !${number} into main${res.task && res.task.outcome !== "unchanged" ? `; task #${res.task.number} ${res.task.outcome === "review" ? "went for review" : "is done"}` : ""}`,
      mergedSave ? { action: { label: "Undo", onClick: () => void undoMerge(mergedSave) } } : undefined);
    if (res.branchMoved) toast.error(`Saves reached ${res.branch.name} while it merged; they aren’t in main yet. Open another merge request for them.`);
  }
  async function revertMerge() {
    if (m?.merged?.saveId) await undoMerge(m.merged.saveId);
  }
  async function undoMerge(saveId: string) {
    const res = await act("revert", () => revertSaveAction(saveId));
    if (res && res.outcome === "reverted") toast.success("Reverted the merge: main is as it was before");
    else if (res && res.outcome === "merge_request") openRevertRequest(res);
    else if (res && res.outcome === "conflicts") toast.error("Files changed since the merge; choose for each in Changes");
  }
  async function deleteBranch() {
    const res = await act("delete-branch", () => deleteBranchAction(m!.source.id), `Deleted ${m!.source.name}; restorable for 30 days`);
    if (res && views?.branch?.toLowerCase() === m!.source.name.toLowerCase()) views.setBranch(null);
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <FilesHeaderTitle>
        <HeaderCrumbs items={[{ label: "Merge requests", onClick: onBack }, { label: m ? `!${m.number} ${m.title}` : `!${number}`, title: m?.title }]} after={m ? <StateBadge state={m.shownState} /> : null} />
      </FilesHeaderTitle>
      {m && canEdit ? (
        <FilesHeaderSlot slot="actions">
          <div className="mr-1 flex items-center gap-1.5">
            {isOpen ? (
              <>
                {m.state === "draft" ? <button type="button" className={headerButton} disabled={Boolean(busy)} onClick={() => void act("ready", () => updateMergeRequestAction(projectId, number, { draft: false }), "Marked ready; reviewers were asked")}>Ready for review</button> : null}
                <button type="button" className={headerButton} disabled={Boolean(busy)} aria-label="Close" onClick={() => void act("close", () => updateMergeRequestAction(projectId, number, { state: "closed" }), "Closed")}><X className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">Close</span></button>
                {d!.viewer.canMerge ? (
                  <>
                    <label htmlFor="merge-method" className="sr-only">How to merge</label>
                    <select id="merge-method" value={method} onChange={(e) => setMethod(e.target.value as "merge" | "squash")} className={selectClass}>
                      <option value="merge">Merge</option>
                      <option value="squash">Squash and merge</option>
                    </select>
                    <button type="button" className={headerPrimary} disabled={Boolean(busy) || d!.protection.needs.length > 0} title={d!.protection.needs.length ? `main is protected: ${d!.protection.needs.join("; ")}` : undefined} onClick={() => void merge()}><GitMerge className="size-3.5" aria-hidden="true" />{busy === "merge" ? "Merging…" : method === "squash" ? "Squash and merge" : "Merge"}</button>
                  </>
                ) : null}
              </>
            ) : m.state === "closed" && m.source.status === "active" ? (
              <button type="button" className={headerButton} disabled={Boolean(busy)} onClick={() => void act("reopen", () => updateMergeRequestAction(projectId, number, { state: "open" }), "Reopened")}>Reopen</button>
            ) : m.merged ? (
              <>
                {m.merged.revertedBy ? <StatusBadge tone="warning">Reverted in save {m.merged.revertedBy.number}</StatusBadge> : m.merged.saveId ? <button type="button" className={headerButton} disabled={Boolean(busy)} aria-label="Revert merge" onClick={() => setConfirmRevert(true)}><Undo2 className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">Revert merge</span></button> : null}
                {m.task && m.merged.saveId && !m.merged.revertedBy ? <AttachResult projectId={projectId} number={number} saveId={m.merged.saveId} taskNumber={m.task.number} /> : null}
                {m.source.status !== "deleted" ? <button type="button" className={headerButton} disabled={Boolean(busy)} aria-label="Delete branch" onClick={() => setConfirmDeleteBranch(true)}><Trash2 className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">Delete branch</span></button> : null}
              </>
            ) : null}
          </div>
        </FilesHeaderSlot>
      ) : null}
      {view.isLoading ? <FolderListLoading /> : view.isError || !d || !m ? (
        <div className="p-4 text-sm"><p role="alert" className="text-destructive">{view.error instanceof Error ? view.error.message : "Couldn’t open this merge request"}</p><button type="button" className="mt-2 underline" onClick={onBack}>Back to merge requests</button></div>
      ) : (
        <>
          {isOpen && d.protection.needs.length ? (
            <FilesStrip role="region" label="What main needs" tone="warning">
              <span className="min-w-0 flex-1 text-xs"><span className="font-medium">main is protected:</span> {d.protection.needs.join(" · ")}</span>
              {d.viewer.canOverride && d.viewer.canMerge ? <button type="button" className={stripButton} disabled={Boolean(busy)} onClick={() => setConfirmOverride(true)}>Merge without approval</button> : null}
            </FilesStrip>
          ) : null}
          {conflicts ? (
            <FilesStrip role="region" label="Can’t merge yet" tone="warning">
              <span className="min-w-0 flex-1 text-xs">Can’t merge yet: {conflicts.length} file{conflicts.length === 1 ? "" : "s"} changed on both the branch and main (<span className="font-mono">{conflicts.map((c) => c.path).join(", ")}</span>).</span>
              <span className="w-full text-[11px] text-muted-foreground sm:hidden">Settling them is easier on a larger screen; on the branch you can still keep the branch’s or main’s copy of each file.</span>
              <button type="button" className={stripButton} onClick={() => toBranch(m.source.name)}>Update the branch from main</button>
            </FilesStrip>
          ) : null}
          <UnderlineTabs<Tab>
            label="Merge request"
            value={tab}
            onChange={setTab}
            tabs={[{ id: "conversation", label: "Conversation" }, { id: "saves", label: `Saves (${d.saves.length}${d.moreSaves ? "+" : ""})` }, { id: "files", label: `Files changed${d.files ? ` (${d.files.files.length})` : ""}` }]}
          />
          <div className="min-h-0 flex-1 overflow-y-auto">
            {tab === "conversation" ? <Conversation projectId={projectId} detail={d} busy={busy} act={act} /> : tab === "saves" ? <SavesList detail={d} /> : <FilesChanged projectId={projectId} detail={d} busy={busy} act={act} />}
          </div>
          {/* On a phone (H23 journey 8), Merge is a full-width button at the bottom. */}
          {m.state === "open" && d.viewer.canMerge ? (
            <div className="border-t border-border bg-card p-3 sm:hidden">
              <button type="button" className={cn(headerPrimary, "h-11 w-full justify-center")} disabled={Boolean(busy) || d.protection.needs.length > 0} onClick={() => void merge()}><GitMerge className="size-4" aria-hidden="true" />{busy === "merge" ? "Merging…" : method === "squash" ? "Squash and merge" : "Merge"}</button>
            </div>
          ) : null}
        </>
      )}
      {stepUpDialog}
      <ConfirmDialog
        open={Boolean(secretFiles)}
        onOpenChange={(o) => { if (!o) setSecretFiles(null); }}
        title="Merge files that look like they hold a key?"
        description={`${(secretFiles ?? []).join(", ")} ${secretFiles?.length === 1 ? "looks" : "look"} like ${secretFiles?.length === 1 ? "it holds" : "they hold"} a password or key. Merge only if it’s safe for everyone in the workspace to see.`}
        confirmLabel="Merge anyway"
        variant="destructive"
        onConfirm={() => void merge(true)}
      />
      {m ? (
        <>
          <ConfirmDialog open={confirmRevert} onOpenChange={setConfirmRevert} title={`Revert the merge of !${m.number}?`} description="A new save on main puts the files back as they were before the merge. Later changes to them are kept where they don’t overlap; if they do, you choose in Changes." confirmLabel="Revert merge" onConfirm={() => void revertMerge()} />
          <ConfirmDialog open={confirmOverride} onOpenChange={setConfirmOverride} title={`Merge !${m.number} without approval?`} description={`main’s protection still needs: ${d?.protection.needs.join("; ") ?? ""}. As an owner you can merge anyway after you verify it’s you; it’s recorded on this merge request and in your security log.`} confirmLabel="Merge without approval" variant="destructive" onConfirm={() => void merge(false, true)} />
          <ConfirmDialog open={confirmDeleteBranch} onOpenChange={setConfirmDeleteBranch} title={`Delete ${m.source.name}?`} description="It was merged into main. You can restore it for 30 days." confirmLabel="Delete" variant="destructive" onConfirm={() => void deleteBranch()} />
        </>
      ) : null}
    </div>
  );
}

/** One line of what happened: the square avatar, who, what, when; a comment's text under it. */
/** "Attach as final file" (H8): one of the merged files goes on the merge request's task as a final file. */
function AttachResult({ projectId, number, saveId, taskNumber }: { projectId: string; number: number; saveId: string; taskNumber: number | null }) {
  const [open, setOpen] = useState(false);
  const files = useQuery({ queryKey: ["save", saveId, "files"], enabled: open, queryFn: () => unwrap(getSaveAction(saveId)) });
  const shown = (files.data?.files ?? []).filter((f) => f.op !== "delete").slice(0, 30);
  async function attach(path: string) {
    const res = await attachMergeResultAction(projectId, number, path);
    if (!res.success) { toast.error(res.error); return; }
    toast.success(`${path.split("/").pop()} is a final file on #${res.data.task ?? taskNumber}`);
  }
  return (
    <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button type="button" className={headerButton} aria-label={`Attach to #${taskNumber ?? ""} as final file`}><Paperclip className="size-3.5" aria-hidden="true" /><span className="hidden sm:inline">Attach to #{taskNumber}</span></button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className={"w-72 max-w-[calc(100vw-16px)] rounded-[8px] border border-border bg-card p-1 shadow-md"}>
        <p className="px-2 pb-1 pt-1 text-xs text-muted-foreground">Attach as a final file on #{taskNumber}</p>
        {files.isLoading ? <p className="px-2 py-1.5 text-xs text-muted-foreground">Loading…</p> : shown.length ? shown.map((f) => (
          <DropdownMenuItem key={f.path} className="rounded-[5px] text-xs" onSelect={() => void attach(f.path)}><span className="truncate font-mono text-xs">{f.path}</span></DropdownMenuItem>
        )) : <p className="px-2 py-1.5 text-xs text-muted-foreground">No files to attach</p>}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** "!3" in a comment opens merge request 3 (H26 reference words); the rest is plain text. */
function WithRefs({ text }: { text: string }) {
  return <>{text.split(/(?<![\w!])(![0-9]{1,7})\b/).map((part, i) => (/^![0-9]+$/.test(part)
    ? <a key={i} href={mergeRequestHref(Number(part.slice(1)))} className="font-mono text-foreground underline underline-offset-2">{part}</a>
    : part))}</>;
}

function FeedRow({ person, madeWith, action, at, children }: { person: PersonView; madeWith?: string | null; action: React.ReactNode; at: string; children?: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 border-b border-border/60 px-4 py-2.5">
      <span className="pt-0.5"><Person person={person} size={20} nameClassName="sr-only" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground"><span className="font-medium text-foreground">{personName(person)}</span>{person?.former ? " (former member)" : ""}{madeWith ? ` ${madeWith}` : ""} {action} <span className="font-mono text-[11px]">· <When at={at} /></span></p>
        {children}
      </div>
    </li>
  );
}

function Conversation({ projectId, detail, busy, act }: { projectId: string; detail: Detail; busy: string | null; act: Act }) {
  const m = detail.mergeRequest;
  const [text, setText] = useDraft(`nb:mr-comment:${projectId}:${m.number}`);
  const open = m.state === "open" || m.state === "draft";
  const items = useMemo(() => [
    ...detail.events.map((e) => ({ at: e.createdAt, key: `e${e.id}`, node: <EventRow key={`e${e.id}`} e={e} /> })),
    ...detail.comments.filter((c) => !c.path).map((c) => ({ at: c.createdAt, key: c.id, node: <CommentRow key={c.id} c={c} /> })),
  ].sort((a, b) => a.at.localeCompare(b.at)), [detail]);
  async function send(kind: "comment" | "approve" | "request_changes") {
    const done = kind === "approve" ? "Approved" : kind === "request_changes" ? "Asked for changes" : "Commented";
    const res = kind === "comment" && !detail.viewer.canReview
      ? await act("comment", () => commentMergeRequestAction(projectId, m.number, { body: text }), done)
      : await act(kind, () => reviewMergeRequestAction(projectId, m.number, kind, text), done);
    if (res) setText("");
  }
  return (
    <div className="pb-6">
      <section aria-label="Details" className="px-4 pt-4">
        <RailSectionHeading title="Details" />
        <dl className="grid grid-cols-[96px_1fr] gap-x-3 gap-y-2 text-xs">
          <dt className="font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground">Branch</dt>
          <dd className="min-w-0 font-mono"><button type="button" className="underline-offset-2 hover:underline" onClick={() => toBranch(m.source.name)}>{m.source.name}</button> → main{m.state !== "merged" ? <span className="text-muted-foreground"> · {m.bothChanged.length ? `main also changed ${m.bothChanged.length} of these files` : m.behind ? `${m.behind} behind main, merges cleanly` : "up to date with main"}</span> : null}</dd>
          <dt className="font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground">Opened by</dt>
          <dd className="min-w-0"><Person person={m.author} size={20} />{m.madeWith ? <span className="text-muted-foreground"> {m.madeWith}</span> : null} <span className="font-mono text-[11px] text-muted-foreground">· <When at={m.createdAt} /></span></dd>
          {m.task ? <><dt className="font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground">Task</dt><dd className="min-w-0">#{m.task.number} {m.task.title}</dd></> : null}
          <dt className="font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground">Reviewers</dt>
          <dd className="flex min-w-0 flex-wrap gap-x-4 gap-y-1.5">
            {m.reviewers.length ? m.reviewers.map((r) => (
              <span key={r.person.id} className="inline-flex items-center gap-1.5">
                <Person person={r.person} size={20} />
                {r.state === "approved" ? <StatusBadge tone="success" title={r.earlierSave ? "Approved an earlier save" : undefined}>Approved{r.earlierSave ? " · earlier save" : ""}</StatusBadge> : r.state === "changes_requested" ? <StatusBadge tone="warning">Changes requested</StatusBadge> : r.state === "commented" ? <StatusBadge>Commented</StatusBadge> : <StatusBadge>Asked</StatusBadge>}
              </span>
            )) : <span className="text-muted-foreground">None</span>}
          </dd>
          {m.checks.length ? (
            <>
              <dt className="font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground">Checks</dt>
              <dd className="flex min-w-0 flex-wrap gap-2">
                {m.checks.map((c) => (
                  <span key={c.name} className="inline-flex items-center gap-1.5">
                    <StatusBadge tone={c.state === "passed" ? "success" : c.state === "failed" ? "danger" : "neutral"}>{c.state}</StatusBadge>
                    {c.url ? <a href={c.url} target="_blank" rel="noreferrer noopener" className="font-mono underline-offset-2 hover:underline">{c.name}</a> : <span className="font-mono">{c.name}</span>}
                  </span>
                ))}
              </dd>
            </>
          ) : null}
          {m.merged ? <><dt className="font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground">Merged</dt><dd className="min-w-0">{m.merged.method === "squash" ? "As one save" : "With its saves"} by {personName(m.merged.by)} <span className="font-mono text-[11px] text-muted-foreground">· <When at={m.merged.at} /></span>{m.merged.revertedBy ? <span className="text-muted-foreground"> · reverted in save {m.merged.revertedBy.number}</span> : null}</dd></> : null}
        </dl>
      </section>
      {m.description ? (
        <section aria-label="Description" className="px-4 pt-5">
          <RailSectionHeading title="Description" />
          <p className="whitespace-pre-wrap text-sm text-foreground">{m.description}</p>
        </section>
      ) : null}
      <section aria-label="Activity" className="pt-5">
        <div className="px-4"><RailSectionHeading title="Activity" /></div>
        <ol className="border-t border-border/60">{items.map((i) => i.node)}</ol>
      </section>
      {open ? (
        <form className="space-y-2 px-4 pt-4" onSubmit={(e) => { e.preventDefault(); void send("comment"); }}>
          <label htmlFor="mr-comment" className="sr-only">Comment</label>
          <textarea id="mr-comment" value={text} onChange={(e) => setText(e.target.value)} placeholder="Leave a comment" rows={3} className="w-full rounded-[5px] border border-border bg-background p-2 text-sm text-foreground focus:border-[#D14E24] focus:outline-none" />
          <div className="flex flex-wrap items-center gap-2 max-sm:flex-col max-sm:items-stretch [&>button]:max-sm:h-11 [&>button]:max-sm:w-full [&>button]:max-sm:justify-center">
            <button type="submit" className={stripButton} disabled={Boolean(busy) || !text.trim()}><MessageSquare className="size-3.5" aria-hidden="true" />Comment</button>
            {detail.viewer.canReview ? <button type="button" className={stripPrimary} disabled={Boolean(busy)} onClick={() => void send("approve")}><Check className="size-3.5" aria-hidden="true" />Approve</button> : null}
            {detail.viewer.canReview ? <button type="button" className={stripButton} disabled={Boolean(busy) || !text.trim()} onClick={() => void send("request_changes")}><CircleDot className="size-3.5" aria-hidden="true" />Request changes</button> : null}
            {detail.viewer.canReview && !text.trim() ? <span className="font-mono text-[11px] text-muted-foreground">Say what to change before requesting changes.</span> : null}
          </div>
        </form>
      ) : null}
    </div>
  );
}

function EventRow({ e }: { e: Detail["events"][number] }) {
  const reason = (e.data as { reason?: string }).reason;
  const what = e.kind === "opened" ? "opened this merge request" : e.kind === "ready" ? "marked it ready for review" : e.kind === "draft" ? "marked it as a draft"
    : e.kind === "closed" ? (reason === "branch_deleted" ? "closed it: the branch was deleted" : "closed it") : e.kind === "reopened" ? (reason === "branch_restored" ? "reopened it: the branch was restored" : "reopened it")
    : e.kind === "merged" ? `merged it${(e.data as { method?: string }).method === "squash" ? " as one save" : ""}${(e.data as { override?: boolean }).override ? " without approval" : ""}` : e.kind === "reviewers" ? "changed the reviewers" : "edited it";
  return <FeedRow person={e.actor} madeWith={e.madeWith} action={what} at={e.createdAt} />;
}

function CommentRow({ c, children }: { c: Detail["comments"][number]; children?: React.ReactNode }) {
  const action = c.reviewState === "approved" ? "approved" : c.reviewState === "changes_requested" ? "requested changes" : c.path ? <>commented on <span className="font-mono">{c.path}:{c.line}{c.endLine && c.endLine !== c.line ? `–${c.endLine}` : ""}</span></> : "commented";
  return (
    <FeedRow person={c.author} madeWith={c.madeWith} action={<>{action}{c.onEarlierSave ? " (an earlier save)" : ""}</>} at={c.createdAt}>
      {c.body ? <p className="mt-1 whitespace-pre-wrap text-sm text-foreground"><WithRefs text={c.body} /></p> : null}
      {c.suggestion != null ? (
        <div className="mt-2 overflow-x-auto rounded-[5px] border border-border font-mono text-xs leading-5">
          {(c.original ?? "").split("\n").map((l, i) => <div key={`o${i}`} className="whitespace-pre bg-[var(--status-danger-soft)] px-2 text-[var(--status-danger)]">- {l}</div>)}
          {c.suggestion.split("\n").map((l, i) => <div key={`s${i}`} className="whitespace-pre bg-[var(--status-success-soft)] px-2 text-[var(--status-success)]">+ {l}</div>)}
        </div>
      ) : null}
      {children}
    </FeedRow>
  );
}

function SavesList({ detail }: { detail: Detail }) {
  const toSave = (id: string) => {
    const url = new URL(window.location.href);
    url.searchParams.delete("mr");
    url.searchParams.set("filesView", "history");
    url.searchParams.set("save", id);
    window.location.href = url.toString();
  };
  if (!detail.saves.length) return <FolderListEmpty plain message="No saves on this branch." />;
  return (
    <div role="table" aria-label="Saves on this branch" className={listStyles.container}>
      <FolderListHeader updatedLabel="When" sizeLabel="Files" byLabel="Saved by" />
      <div role="rowgroup">
        {detail.saves.map((s) => (
          <GridRow key={s.id} onClick={() => toSave(s.id)}>
            <NameCell chip={<IconChip><GitMerge /></IconChip>} name={s.message} onOpen={() => toSave(s.id)} nameLabel={`Open save ${s.number}: ${s.message}`} after={s.kind === "merge" ? <StatusBadge>Update from main</StatusBadge> : null} sub={s.madeWith ?? `Save ${s.number}`} />
            <Cell column="updated"><When at={s.createdAt} /></Cell>
            <Cell column="size" align="right">{`${s.added + s.changed + s.deleted + s.renamed}`}</Cell>
            <Cell column="by"><Person person={s.author} /></Cell>
            <div role="cell" className="text-right font-mono text-[11px] text-muted-foreground">{s.number}</div>
          </GridRow>
        ))}
      </div>
      {detail.moreSaves ? <p className="px-4 py-2 font-mono text-[11px] text-muted-foreground">Older saves are in History on the branch.</p> : null}
    </div>
  );
}

const fieldClass = "h-7 w-16 rounded-[5px] border border-border bg-background px-1.5 font-mono text-xs text-foreground focus:border-[#D14E24] focus:outline-none";

function FilesChanged({ projectId, detail, busy, act }: { projectId: string; detail: Detail; busy: string | null; act: Act }) {
  const m = detail.mergeRequest;
  const files = detail.files?.files ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const current = selected ?? files[0]?.path ?? null;
  const diff = useQuery({ queryKey: ["branch-diff", m.source.id, current, m.source.headSaveId], enabled: Boolean(current), queryFn: () => unwrap(branchDiffAction(m.source.id, current!)) });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [body, setBody] = useDraft(`nb:mr-line-comment:${projectId}:${m.number}:${current}`);
  const [suggest, setSuggest] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const open = m.state === "open" || m.state === "draft";
  if (!detail.files) return <FolderListEmpty plain message={m.state === "merged" ? "Merged: the changes are in main now. Its saves are under Saves." : "The branch was deleted, so its files can’t be shown."} />;
  if (!files.length) return <FolderListEmpty plain message="Nothing on the branch differs from main." />;
  const comments = detail.comments.filter((c) => c.path === current);
  const OP: Record<string, { label: string; tone: BadgeTone }> = { add: { label: "Added", tone: "success" }, change: { label: "Changed", tone: "warning" }, delete: { label: "Deleted", tone: "danger" } };
  async function send() {
    const line = Number(from);
    const end = Number(to || from);
    const res = await act("line-comment", () => commentMergeRequestAction(projectId, m.number, { body, path: current, line, endLine: end, suggestion: suggest ? suggestion : null }), suggest ? "Suggested an edit" : "Commented");
    if (res) { setBody(""); setSuggestion(""); setFrom(""); setTo(""); setSuggest(false); }
  }
  const fileRow = (f: (typeof files)[number]) => (
    <button type="button" onClick={() => setSelected(f.path)} aria-current={current === f.path} className={cn("flex min-h-12 w-full items-center gap-2.5 border-b border-border/60 px-3 text-left hover:bg-[#FAF8F5] dark:hover:bg-white/[0.02]", current === f.path && "bg-[#F3F0EA] dark:bg-white/[0.06]")}>
      <FileTypeChip name={f.path.split("/").pop()!} mimeType={null} />
      <span className="min-w-0 flex-1">
        <span className="block truncate font-mono text-xs font-medium text-foreground">{f.path.split("/").pop()}</span>
        <span className="block truncate font-mono text-[11px] text-muted-foreground">{f.path}</span>
      </span>
      {detail.comments.some((c) => c.path === f.path) ? <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-label="Has comments" /> : null}
      <StatusBadge tone={OP[f.op]?.tone ?? "neutral"}>{OP[f.op]?.label ?? f.op}</StatusBadge>
    </button>
  );
  return (
    <div className="flex min-h-full flex-col md:flex-row">
      {/* On a phone (H23 journey 8): the list, then one file at a time with a way back. */}
      <nav aria-label="Files changed" className={cn("max-h-64 overflow-y-auto border-b border-border md:max-h-none md:w-80 md:border-b-0 md:border-r max-sm:max-h-none", selected && "max-sm:hidden")}>
        {/* Up to 2,000 files (H25): past 200 only the rows in view are drawn. */}
        {files.length > 200 ? (
          <Virtuoso style={{ height: "70vh" }} data={files} computeItemKey={(_, f) => f.path} itemContent={(_, f) => fileRow(f)} />
        ) : <ul>{files.map((f) => <li key={f.path}>{fileRow(f)}</li>)}</ul>}
      </nav>
      <section aria-label="Diff and comments" className={cn("min-h-0 min-w-0 flex-1", !selected && "max-sm:hidden")}>
        {selected ? <button type="button" className={cn(stripButton, "m-3 sm:hidden")} onClick={() => setSelected(null)}>← All {files.length} files</button> : null}
        {current ? <DiffView query={diff} label={`${current} · against main`} path={current} /> : null}
        {comments.length ? (
          <ol className="border-t border-border/60">
            {comments.map((c) => (
              <CommentRow key={c.id} c={c}>
                {c.suggestion != null ? (
                  c.appliedSaveId ? <p className="mt-2"><StatusBadge tone="success">Applied</StatusBadge></p>
                    : open && detail.viewer.canWrite ? <button type="button" className={cn(stripButton, "mt-2")} disabled={Boolean(busy)} onClick={() => void act("apply", () => applySuggestionAction(projectId, m.number, c.id), "Applied the suggestion on the branch")}>Apply suggestion</button> : null
                ) : null}
              </CommentRow>
            ))}
          </ol>
        ) : null}
        {open && current ? (
          <form className="space-y-2 border-t border-border/60 px-4 py-3" onSubmit={(e) => { e.preventDefault(); void send(); }}>
            <RailSectionHeading title={`Comment on lines of ${current.split("/").pop()}`} />
            <div className="flex flex-wrap items-center gap-2 font-mono text-[11px] text-muted-foreground">
              <label className="inline-flex items-center gap-1">Line <input inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ""))} className={fieldClass} /></label>
              <label className="inline-flex items-center gap-1">to <input inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ""))} placeholder={from || ""} className={fieldClass} /></label>
              <label className="inline-flex items-center gap-1"><input type="checkbox" checked={suggest} onChange={(e) => setSuggest(e.target.checked)} />Suggest an edit</label>
            </div>
            <label className="sr-only" htmlFor="mr-line-comment">Comment</label>
            <textarea id="mr-line-comment" value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="What about these lines?" className="w-full rounded-[5px] border border-border bg-background p-2 text-sm text-foreground focus:border-[#D14E24] focus:outline-none" />
            {suggest ? (
              <>
                <label className="sr-only" htmlFor="mr-suggestion">Replacement lines</label>
                <textarea id="mr-suggestion" value={suggestion} onChange={(e) => setSuggestion(e.target.value)} rows={3} placeholder="The lines as they should be" spellCheck={false} className="w-full rounded-[5px] border border-border bg-background p-2 font-mono text-xs text-foreground focus:border-[#D14E24] focus:outline-none" />
              </>
            ) : null}
            <button type="submit" className={stripPrimary} disabled={Boolean(busy) || !from || (!body.trim() && !suggest)}>{suggest ? "Suggest" : "Comment"}</button>
          </form>
        ) : null}
      </section>
    </div>
  );
}

export { LineCounts };

