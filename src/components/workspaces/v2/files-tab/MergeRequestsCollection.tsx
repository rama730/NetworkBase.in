"use client";

import { useCallback, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Check, CircleDot, GitMerge, GitPullRequest, MessageSquare, X } from "lucide-react";

import { branchDiffAction } from "@/app/actions/files/branches";
import {
  applySuggestionAction, commentMergeRequestAction, getMergeRequestAction, listMergeRequestsAction, mergeMergeRequestAction, reviewMergeRequestAction,
  updateMergeRequestAction,
} from "@/app/actions/files/merge-requests";
import { revertSaveAction } from "@/app/actions/files/saves";
import { useStepUp } from "@/components/trust/StepUp";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import type { getMergeRequest, MergeRequestSummary } from "@/lib/domain/merge-requests";
import { feedbackError, toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { EmptyState, When } from "./ChangesCollection";
import { FilesViewsMenu } from "./FilesHeader";
import { useFilesTabRole } from "./FilesTabRoleContext";
import { DiffView } from "./HistoryCollection";

/**
 * Merge requests (report H4, phase H-3): the list (open, merged, closed; waiting on you), and one merge request with
 * its conversation, saves and files changed (diffs, line comments, suggested edits), reviews and merging.
 * Open with ?tab=files&filesView=merge-requests, or one with &mr=<number>.
 */
type Detail = Awaited<ReturnType<typeof getMergeRequest>>;
type Person = { id: string; name: string | null; username: string | null } | null;

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
const nameOf = (p: Person) => p?.name || (p?.username ? `@${p.username}` : "Someone");
const STATE_LABEL: Record<string, string> = { draft: "Draft", open: "Open", approved: "Approved", changes_requested: "Changes requested", merged: "Merged", closed: "Closed" };
const STATE_CLASS: Record<string, string> = {
  draft: "border-border text-muted-foreground",
  open: "border-sky-300 text-sky-900 dark:border-sky-800 dark:text-sky-200",
  approved: "border-emerald-300 text-emerald-900 dark:border-emerald-800 dark:text-emerald-200",
  changes_requested: "border-amber-300 text-amber-900 dark:border-amber-800 dark:text-amber-200",
  merged: "border-violet-300 text-violet-900 dark:border-violet-800 dark:text-violet-200",
  closed: "border-border text-muted-foreground",
};
function StateChip({ state }: { state: string }) {
  return <span className={cn("shrink-0 rounded-[5px] border px-1.5 py-0.5 text-xs", STATE_CLASS[state] ?? STATE_CLASS.open)}>{STATE_LABEL[state] ?? state}</span>;
}
/** Leaves the merge requests view for a branch page or a save (full navigation, like the branch page's saves). */
function go(params: Record<string, string | null>) {
  const url = new URL(window.location.href);
  for (const [k, v] of Object.entries(params)) {
    if (v == null) url.searchParams.delete(k);
    else url.searchParams.set(k, v);
  }
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

function MergeRequestList({ projectId, onOpen }: { projectId: string; onOpen: (n: number) => void }) {
  const [filter, setFilter] = useState<"open" | "review" | "merged" | "closed">("open");
  const list = useQuery({
    queryKey: ["merge-requests", projectId, filter],
    queryFn: () => unwrap(listMergeRequestsAction(projectId, filter === "review" ? "open" : filter, filter === "review")),
    staleTime: 15_000,
  });
  const rows: MergeRequestSummary[] = list.data?.mergeRequests ?? [];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <p className="mb-3 text-sm text-muted-foreground">A merge request asks for review of a branch before it goes into main. Open one from a branch’s page. <a href="/docs/files/branches#merge-requests" className="underline underline-offset-2 hover:text-foreground">What’s this?</a></p>
      <div role="tablist" aria-label="Which merge requests" className="mb-3 flex flex-wrap gap-1">
        {(["open", "review", "merged", "closed"] as const).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)} className={cn("rounded-md px-2.5 py-1 text-sm", filter === f ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {f === "open" ? "Open" : f === "review" ? "Waiting on me" : f === "merged" ? "Merged" : "Closed"}
          </button>
        ))}
      </div>
      {list.isLoading ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-md bg-muted" />)}</div>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-destructive">{feedbackError(list.error instanceof Error ? list.error.message : "", "Couldn’t load merge requests")} <button type="button" className="underline" onClick={() => void list.refetch()}>Retry</button></p>
      ) : rows.length === 0 ? (
        <EmptyState
          title={filter === "review" ? "Nothing waiting on you" : `No ${filter === "open" ? "open" : filter} merge requests`}
          body={filter === "open" ? "Open one from a branch’s page, or from a folder on the branch:" : "They show here once there are some."}
          command={filter === "open" ? "nb merge-request create" : undefined}
        />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {rows.map((m) => {
            const shown = m.state === "open" && m.changesRequested ? "changes_requested" : m.state === "open" && m.approvals ? "approved" : m.state;
            return (
              <li key={m.id}>
                <button type="button" onClick={() => onOpen(m.number)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent">
                  <GitPullRequest className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-foreground"><span className="text-muted-foreground">!{m.number}</span> {m.title}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      <span className="font-mono">{m.source.name}</span> → main · {nameOf(m.author)}{m.madeWith ? ` ${m.madeWith}` : ""} · <When at={m.updatedAt} />{m.comments ? ` · ${m.comments} comment${m.comments === 1 ? "" : "s"}` : ""}
                    </span>
                  </span>
                  {m.reviewRequested ? <span className="shrink-0 rounded-[5px] border border-sky-300 px-1.5 py-0.5 text-xs text-sky-900 dark:border-sky-800 dark:text-sky-200">Your review</span> : null}
                  <StateChip state={shown} />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

type Tab = "conversation" | "saves" | "files";

function MergeRequestPage({ projectId, number, onBack }: { projectId: string; number: number; onBack: () => void }) {
  const { canEdit } = useFilesTabRole();
  const client = useQueryClient();
  const view = useQuery({ queryKey: ["merge-request", projectId, number], queryFn: () => unwrap(getMergeRequestAction(projectId, number)) });
  const [tab, setTab] = useState<Tab>("conversation");
  const [busy, setBusy] = useState<string | null>(null);
  const [method, setMethod] = useState<"merge" | "squash">("merge");
  const [conflicts, setConflicts] = useState<Array<{ path: string; kind: string }> | null>(null);
  const [secretFiles, setSecretFiles] = useState<string[] | null>(null);
  const { needs: needsStepUp, dialog: stepUpDialog } = useStepUp("This merge changes a doc or final files, so confirm it’s you before merging.");
  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["merge-request", projectId, number] });
    void client.invalidateQueries({ queryKey: ["merge-requests", projectId] });
    void client.invalidateQueries({ queryKey: ["branches", projectId] });
    void client.invalidateQueries({ queryKey: ["files-directory", projectId] });
  };
  const d = view.data;
  if (view.isLoading) return <div className="space-y-2 p-4" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-muted" />)}</div>;
  if (view.isError || !d) return <div className="p-4 text-sm"><p role="alert" className="text-destructive">{view.error instanceof Error ? view.error.message : "Couldn’t open this merge request"}</p><button type="button" className="mt-2 underline" onClick={onBack}>Back to merge requests</button></div>;
  const m = d.mergeRequest;
  const isOpen = m.state === "open" || m.state === "draft";

  async function act<T>(name: string, run: () => Promise<{ success: true; data: T } | { success: false; error: string; stepUp?: unknown }>, done?: string): Promise<T | null> {
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
  }
  async function merge(confirmSecrets = false) {
    setSecretFiles(null);
    const res = await act("merge", async () => {
      const r = await mergeMergeRequestAction(projectId, number, method, confirmSecrets);
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
    toast.success(`Merged !${number} into main${res.task && res.task.outcome !== "unchanged" ? `; task #${res.task.number} ${res.task.outcome === "review" ? "went for review" : "is done"}` : ""}`);
    if (res.branchMoved) toast.error(`Saves reached ${res.branch.name} while it merged; they aren’t in main yet. Open another merge request for them.`);
  }
  async function revertMerge() {
    if (!m.merged?.saveId) return;
    const res = await act("revert", () => revertSaveAction(m.merged!.saveId!));
    if (res && res.outcome === "reverted") toast.success("Reverted the merge: main is as it was before");
    else if (res && res.outcome === "conflicts") toast.error("Files changed since the merge; open History to revert it by hand");
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-border px-4 py-3">
        <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" aria-hidden />Merge requests</button>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="min-w-0 flex-1 text-base font-semibold text-foreground"><span className="text-muted-foreground">!{m.number}</span> {m.title}</h2>
          <StateChip state={m.shownState} />
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          <button type="button" className="font-mono underline-offset-2 hover:underline" onClick={() => go({ filesView: null, filesNav: "tree", branch: m.source.name, mr: null })}>{m.source.name}</button> → main · opened by {nameOf(m.author)}{m.madeWith ? ` ${m.madeWith}` : ""} <When at={m.createdAt} />
          {m.task ? <> · task #{m.task.number} {m.task.title}</> : null}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
          <span className="text-muted-foreground">Reviewers:</span>
          {m.reviewers.length ? m.reviewers.map((r) => (
            <span key={r.person.id} className="inline-flex items-center gap-1 text-foreground">
              {r.state === "approved" ? <Check className="size-3.5 text-emerald-600" aria-hidden /> : r.state === "changes_requested" ? <X className="size-3.5 text-amber-600" aria-hidden /> : <CircleDot className="size-3.5 text-muted-foreground" aria-hidden />}
              {nameOf(r.person)} <span className="text-muted-foreground">{r.state === "requested" ? "asked" : r.state.replace("_", " ")}{r.earlierSave ? " (an earlier save)" : ""}</span>
            </span>
          )) : <span className="text-muted-foreground">none</span>}
          {m.checks.length ? <span className="text-muted-foreground">Checks:</span> : null}
          {m.checks.map((c) => (
            <span key={c.name} className={cn("inline-flex items-center gap-1", c.state === "failed" ? "text-destructive" : c.state === "passed" ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
              {c.url ? <a href={c.url} target="_blank" rel="noreferrer noopener" className="underline-offset-2 hover:underline">{c.name}</a> : c.name} {c.state}
            </span>
          ))}
        </div>
        {isOpen ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            {m.bothChanged.length ? (
              <p className="min-w-0 flex-1 text-xs text-amber-800 dark:text-amber-300">Main also changed {m.bothChanged.length} of these files; it may not merge. Update the branch from main first.</p>
            ) : <p className="min-w-0 flex-1 text-xs text-muted-foreground">{m.behind ? `${m.behind} save${m.behind === 1 ? "" : "s"} behind main, no files in common: merges cleanly.` : "Up to date with main."}</p>}
            {canEdit && m.state === "draft" ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void act("ready", () => updateMergeRequestAction(projectId, number, { draft: false }), "Marked ready; reviewers were asked")}>Ready for review</Button> : null}
            {d.viewer.canMerge ? (
              <span className="inline-flex items-center gap-1">
                <label className="sr-only" htmlFor="merge-method">How to merge</label>
                <select id="merge-method" value={method} onChange={(e) => setMethod(e.target.value as "merge" | "squash")} className="h-8 rounded-md border border-border bg-background px-2 text-sm">
                  <option value="merge">Merge</option>
                  <option value="squash">Squash and merge</option>
                </select>
                <Button size="sm" disabled={Boolean(busy)} onClick={() => void merge()}><GitMerge className="size-4" aria-hidden />{busy === "merge" ? "Merging…" : method === "squash" ? "Squash and merge" : "Merge"}</Button>
              </span>
            ) : null}
            {canEdit ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void act("close", () => updateMergeRequestAction(projectId, number, { state: "closed" }), "Closed")}>Close</Button> : null}
          </div>
        ) : m.state === "closed" && canEdit && m.source.status === "active" ? (
          <div className="mt-3"><Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void act("reopen", () => updateMergeRequestAction(projectId, number, { state: "open" }), "Reopened")}>Reopen</Button></div>
        ) : m.merged ? (
          <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <span className="min-w-0 flex-1">Merged{m.merged.method === "squash" ? " as one save" : ""} by {nameOf(m.merged.by)} <When at={m.merged.at} />.</span>
            {canEdit && m.merged.saveId ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void revertMerge()}>Revert merge</Button> : null}
            {canEdit && m.source.status !== "deleted" ? <Button size="sm" variant="outline" onClick={() => go({ filesView: null, filesNav: "tree", branch: m.source.name, mr: null })}>Delete the branch…</Button> : null}
          </div>
        ) : null}
        {conflicts ? (
          <div role="alert" className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
            <p>Can’t merge yet: {conflicts.length} file{conflicts.length === 1 ? "" : "s"} changed on both the branch and main.</p>
            <ul className="my-1 font-mono text-xs">{conflicts.map((c) => <li key={c.path}>{c.path}</li>)}</ul>
            <Button size="sm" variant="outline" onClick={() => go({ filesView: null, filesNav: "tree", branch: m.source.name, mr: null })}>Update the branch from main</Button>
          </div>
        ) : null}
        <div role="tablist" aria-label="Merge request" className="mt-3 flex gap-1">
          {(["conversation", "saves", "files"] as const).map((t) => (
            <button key={t} type="button" role="tab" aria-selected={tab === t} onClick={() => setTab(t)} className={cn("rounded-md px-2.5 py-1 text-sm", tab === t ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
              {t === "conversation" ? "Conversation" : t === "saves" ? `Saves (${d.saves.length}${d.moreSaves ? "+" : ""})` : `Files changed${d.files ? ` (${d.files.files.length})` : ""}`}
            </button>
          ))}
        </div>
      </header>
      {tab === "conversation" ? <Conversation projectId={projectId} detail={d} busy={busy} act={act} /> : tab === "saves" ? <SavesList detail={d} /> : <FilesChanged projectId={projectId} detail={d} busy={busy} act={act} />}
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
    </div>
  );
}

type Act = <T>(name: string, run: () => Promise<{ success: true; data: T } | { success: false; error: string; stepUp?: unknown }>, done?: string) => Promise<T | null>;

function Conversation({ projectId, detail, busy, act }: { projectId: string; detail: Detail; busy: string | null; act: Act }) {
  const m = detail.mergeRequest;
  const [text, setText] = useState("");
  const items = useMemo(() => [
    ...detail.events.map((e) => ({ at: e.createdAt, key: `e${e.id}`, node: <EventLine e={e} /> })),
    ...detail.comments.filter((c) => !c.path).map((c) => ({ at: c.createdAt, key: c.id, node: <CommentCard c={c} /> })),
  ].sort((a, b) => a.at.localeCompare(b.at)), [detail]);
  const open = m.state === "open" || m.state === "draft";
  async function send(kind: "comment" | "approve" | "request_changes") {
    const done = kind === "approve" ? "Approved" : kind === "request_changes" ? "Asked for changes" : "Commented";
    const res = kind === "comment" && !detail.viewer.canReview
      ? await act("comment", () => commentMergeRequestAction(projectId, m.number, { body: text }), done)
      : await act(kind, () => reviewMergeRequestAction(projectId, m.number, kind, text), done);
    if (res) setText("");
  }
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      {m.description ? <div className="mb-4 whitespace-pre-wrap rounded-md border border-border p-3 text-sm text-foreground">{m.description}</div> : null}
      <ol className="space-y-2">{items.map((i) => <li key={i.key}>{i.node}</li>)}</ol>
      {open ? (
        <form className="mt-4 space-y-2" onSubmit={(e) => { e.preventDefault(); void send("comment"); }}>
          <label htmlFor="mr-comment" className="sr-only">Comment</label>
          <textarea id="mr-comment" value={text} onChange={(e) => setText(e.target.value)} placeholder="Leave a comment" rows={3} className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" type="submit" variant="outline" disabled={Boolean(busy) || !text.trim()}><MessageSquare className="size-4" aria-hidden />Comment</Button>
            {detail.viewer.canReview ? <Button size="sm" type="button" disabled={Boolean(busy)} onClick={() => void send("approve")}><Check className="size-4" aria-hidden />Approve</Button> : null}
            {detail.viewer.canReview ? <Button size="sm" type="button" variant="outline" disabled={Boolean(busy) || !text.trim()} onClick={() => void send("request_changes")}>Request changes</Button> : null}
          </div>
          {detail.viewer.canReview && !text.trim() ? <p className="text-xs text-muted-foreground">Say what to change before requesting changes.</p> : null}
        </form>
      ) : null}
    </div>
  );
}

function EventLine({ e }: { e: Detail["events"][number] }) {
  const reason = (e.data as { reason?: string }).reason;
  const what = e.kind === "opened" ? "opened this merge request" : e.kind === "ready" ? "marked it ready for review" : e.kind === "draft" ? "marked it as a draft"
    : e.kind === "closed" ? (reason === "branch_deleted" ? "closed it: the branch was deleted" : "closed it") : e.kind === "reopened" ? (reason === "branch_restored" ? "reopened it: the branch was restored" : "reopened it")
    : e.kind === "merged" ? `merged it${(e.data as { method?: string }).method === "squash" ? " as one save" : ""}` : e.kind === "reviewers" ? "changed the reviewers" : "edited it";
  return <p className="text-xs text-muted-foreground">{nameOf(e.actor)}{e.madeWith ? ` ${e.madeWith}` : ""} {what} · <When at={e.createdAt} /></p>;
}

function CommentCard({ c, children }: { c: Detail["comments"][number]; children?: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border p-2.5">
      <p className="mb-1 text-xs text-muted-foreground">
        <span className="font-medium text-foreground">{nameOf(c.author)}</span>{c.madeWith ? ` ${c.madeWith}` : ""}
        {c.reviewState === "approved" ? <span className="text-emerald-700 dark:text-emerald-400"> approved</span> : c.reviewState === "changes_requested" ? <span className="text-amber-700 dark:text-amber-400"> requested changes</span> : null}
        {c.path ? <span className="font-mono"> · {c.path}:{c.line}{c.endLine && c.endLine !== c.line ? `–${c.endLine}` : ""}</span> : null}
        {c.onEarlierSave ? " · on an earlier save" : ""} · <When at={c.createdAt} />
      </p>
      {c.body ? <p className="whitespace-pre-wrap text-sm text-foreground">{c.body}</p> : null}
      {c.suggestion != null ? (
        <div className="mt-2 overflow-x-auto rounded border border-border font-mono text-xs leading-5">
          {(c.original ?? "").split("\n").map((l, i) => <div key={`o${i}`} className="whitespace-pre bg-red-50 px-2 text-red-900 dark:bg-red-950/40 dark:text-red-200">- {l}</div>)}
          {c.suggestion.split("\n").map((l, i) => <div key={`s${i}`} className="whitespace-pre bg-emerald-50 px-2 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200">+ {l}</div>)}
        </div>
      ) : null}
      {children}
    </div>
  );
}

function SavesList({ detail }: { detail: Detail }) {
  if (!detail.saves.length) return <p className="p-4 text-sm text-muted-foreground">No saves on this branch.</p>;
  return (
    <ul className="m-4 divide-y divide-border rounded-md border border-border">
      {detail.saves.map((s) => (
        <li key={s.id}>
          <button type="button" onClick={() => go({ filesView: "history", save: s.id, mr: null })} className="block w-full px-3 py-2 text-left hover:bg-accent">
            <span className="block truncate text-sm font-medium text-foreground">{s.message}</span>
            <span className="block truncate text-xs text-muted-foreground">{nameOf(s.author)}{s.madeWith ? ` · ${s.madeWith}` : ""} · <When at={s.createdAt} />{s.kind === "merge" ? " · update from main" : ""}</span>
          </button>
        </li>
      ))}
      {detail.moreSaves ? <li className="px-3 py-2 text-xs text-muted-foreground">Older saves are on the branch’s page.</li> : null}
    </ul>
  );
}

function FilesChanged({ projectId, detail, busy, act }: { projectId: string; detail: Detail; busy: string | null; act: Act }) {
  const m = detail.mergeRequest;
  const files = detail.files?.files ?? [];
  const [selected, setSelected] = useState<string | null>(null);
  const current = selected ?? files[0]?.path ?? null;
  const diff = useQuery({ queryKey: ["branch-diff", m.source.id, current, m.source.headSaveId], enabled: Boolean(current), queryFn: () => unwrap(branchDiffAction(m.source.id, current!)) });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [body, setBody] = useState("");
  const [suggest, setSuggest] = useState(false);
  const [suggestion, setSuggestion] = useState("");
  const open = m.state === "open" || m.state === "draft";
  if (!detail.files) return <p className="p-4 text-sm text-muted-foreground">{m.state === "merged" ? "Merged: the changes are in main now. Its saves are under Saves." : "The branch was deleted, so its files can’t be shown."}</p>;
  if (!files.length) return <p className="p-4 text-sm text-muted-foreground">Nothing on the branch differs from main.</p>;
  const comments = detail.comments.filter((c) => c.path === current);
  async function send() {
    const line = Number(from);
    const end = Number(to || from);
    const res = await act("line-comment", () => commentMergeRequestAction(projectId, m.number, { body, path: current, line, endLine: end, suggestion: suggest ? suggestion : null }), suggest ? "Suggested an edit" : "Commented");
    if (res) { setBody(""); setSuggestion(""); setFrom(""); setTo(""); setSuggest(false); }
  }
  return (
    <div className="flex min-h-0 flex-1 flex-col md:flex-row">
      <nav aria-label="Files changed" className="max-h-64 overflow-y-auto border-b border-border md:max-h-none md:w-80 md:border-b-0 md:border-r">
        <ul className="py-1">
          {files.map((f) => (
            <li key={f.path}>
              <button type="button" onClick={() => setSelected(f.path)} aria-current={current === f.path} className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left", current === f.path && "bg-accent")}>
                <span className="w-14 shrink-0 text-[11px] text-muted-foreground">{f.op === "add" ? "Added" : f.op === "delete" ? "Deleted" : "Changed"}</span>
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">{f.path}</span>
                {detail.comments.some((c) => c.path === f.path) ? <MessageSquare className="size-3.5 shrink-0 text-muted-foreground" aria-label="Has comments" /> : null}
              </button>
            </li>
          ))}
        </ul>
      </nav>
      <section aria-label="Diff and comments" className="min-h-0 min-w-0 flex-1 overflow-auto">
        {current ? <DiffView query={diff} label={`${current} · against main`} path={current} /> : null}
        <div className="space-y-2 px-3 pb-4">
          {comments.map((c) => (
            <CommentCard key={c.id} c={c}>
              {c.suggestion != null ? (
                c.appliedSaveId ? <p className="mt-2 text-xs text-emerald-700 dark:text-emerald-400">Applied</p>
                  : open && detail.viewer.canWrite ? <Button className="mt-2" size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void act("apply", () => applySuggestionAction(projectId, m.number, c.id), "Applied the suggestion on the branch")}>Apply suggestion</Button> : null
              ) : null}
            </CommentCard>
          ))}
          {open && current ? (
            <form className="space-y-2 rounded-md border border-dashed border-border p-2.5" onSubmit={(e) => { e.preventDefault(); void send(); }}>
              <p className="text-xs font-medium text-foreground">Comment on lines of {current}</p>
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <label className="inline-flex items-center gap-1">Line <input inputMode="numeric" value={from} onChange={(e) => setFrom(e.target.value.replace(/\D/g, ""))} className="h-7 w-16 rounded border border-border bg-background px-1.5 text-foreground" /></label>
                <label className="inline-flex items-center gap-1">to <input inputMode="numeric" value={to} onChange={(e) => setTo(e.target.value.replace(/\D/g, ""))} placeholder={from || ""} className="h-7 w-16 rounded border border-border bg-background px-1.5 text-foreground" /></label>
                <label className="inline-flex items-center gap-1"><input type="checkbox" checked={suggest} onChange={(e) => setSuggest(e.target.checked)} />Suggest an edit</label>
              </div>
              <label className="sr-only" htmlFor="mr-line-comment">Comment</label>
              <textarea id="mr-line-comment" value={body} onChange={(e) => setBody(e.target.value)} rows={2} placeholder="What about these lines?" className="w-full rounded-md border border-border bg-background p-2 text-sm text-foreground" />
              {suggest ? (
                <>
                  <label className="sr-only" htmlFor="mr-suggestion">Replacement lines</label>
                  <textarea id="mr-suggestion" value={suggestion} onChange={(e) => setSuggestion(e.target.value)} rows={3} placeholder="The lines as they should be" spellCheck={false} className="w-full rounded-md border border-border bg-background p-2 font-mono text-xs text-foreground" />
                </>
              ) : null}
              <Button size="sm" type="submit" disabled={Boolean(busy) || !from || (!body.trim() && !suggest)}>{suggest ? "Suggest" : "Comment"}</Button>
            </form>
          ) : null}
        </div>
      </section>
    </div>
  );
}
