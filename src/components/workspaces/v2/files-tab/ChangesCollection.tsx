"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Copy, FileDiff, GitMerge, MessageSquare, RefreshCw, Search, Undo2, X } from "lucide-react";
import { Virtuoso } from "react-virtuoso";

import {
  addChangeSetCommentAction, applyChangeSetAction, askForChangesAction, resolveChangeSetCommentAction, changeSetDiffAction, conflictSidesAction, copyChangeSetAction, discardChangeSetAction, getChangeSetAction, listChangeSetsAction, resolveItemAction, undoChangeSetAction, updateDraftAction,
} from "@/app/actions/files/change-sets";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { copyWithToast } from "@/lib/clipboard";
import { feedbackError, toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";
import { useStepUp } from "@/components/trust/StepUp";
import { FilesViewsMenu } from "./FilesHeader";
import { useFilesTabRole } from "./FilesTabRoleContext";

/**
 * The Changes view (report G12): an agent's or a person's multi-file work, reviewed and applied at once. Open with
 * ?tab=files&filesView=changes, or one directly with &changes=<id>.
 */
type Set = { id: string; title: string; message: string | null; status: string; taskId: string | null; filesAdded: number; filesChanged: number; filesDeleted: number; filesRenamed: number; linesAdded: number; linesRemoved: number; updatedAt: string | Date; readyAt: string | Date | null; createdAt: string | Date; madeWith: string | null };
type Item = { id: string; op: "add" | "change" | "delete" | "rename"; path: string; fromPath: string | null; state: string; linesAdded: number | null; linesRemoved: number | null; conflict: { kind?: string; onto?: number } | null };

type Comment = { id: string; path: string; line: number | null; body: string; createdAt: string | Date; resolvedAt: string | Date | null; author: string | null; username: string | null };

const GROUPS: Array<{ key: string; label: string; test: (i: Item) => boolean }> = [
  { key: "conflict", label: "Changed since", test: (i) => i.state === "conflict" },
  { key: "add", label: "Added", test: (i) => i.state !== "conflict" && i.op === "add" },
  { key: "change", label: "Changed", test: (i) => i.state !== "conflict" && i.op === "change" },
  { key: "rename", label: "Renamed", test: (i) => i.state !== "conflict" && i.op === "rename" },
  { key: "delete", label: "Deleted", test: (i) => i.state !== "conflict" && i.op === "delete" },
];
const STATUS_WORDS: Record<string, string> = { open: "Draft", ready: "Ready", applying: "Applying", applied: "Applied", discarded: "Discarded", undone: "Undone" };

/** Local time, with the exact time on hover (0.8 #9). */
function When({ at }: { at: string | Date | null }) {
  if (!at) return null;
  const d = new Date(at);
  const short = d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return <time dateTime={d.toISOString()} title={d.toLocaleString(undefined, { dateStyle: "full", timeStyle: "long" })}>{short}</time>;
}

const counts = (s: Set) => [s.filesAdded && `${s.filesAdded} added`, s.filesChanged && `${s.filesChanged} changed`, s.filesDeleted && `${s.filesDeleted} deleted`, s.filesRenamed && `${s.filesRenamed} renamed`].filter(Boolean).join(" · ") || "No files yet";
const who = (s: Set) => s.madeWith ?? "in the app";

function readParam() {
  if (typeof window === "undefined") return null;
  return new URLSearchParams(window.location.search).get("changes");
}
function writeParam(id: string | null) {
  const url = new URL(window.location.href);
  if (id) url.searchParams.set("changes", id);
  else url.searchParams.delete("changes");
  window.history.replaceState(window.history.state, "", url);
}

export function ChangesCollection({ projectId }: { projectId: string }) {
  const [openId, setOpenId] = useState<string | null>(() => readParam());
  const open = useCallback((id: string | null) => { setOpenId(id); writeParam(id); }, []);
  return (
    <div aria-label="Changes" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card dark:bg-background">
      <FilesViewsMenu projectId={projectId} />
      {openId ? <ChangeSetPage projectId={projectId} id={openId} onBack={() => open(null)} onOpen={open} /> : <ChangeSetList projectId={projectId} onOpen={open} />}
    </div>
  );
}

function ChangeSetList({ projectId, onOpen }: { projectId: string; onOpen: (id: string) => void }) {
  const [filter, setFilter] = useState<"open" | "all">("open");
  const list = useQuery({
    queryKey: ["change-sets", projectId, filter],
    queryFn: async () => {
      const res = await listChangeSetsAction(projectId, filter === "open" ? "open,ready" : undefined);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    staleTime: 15_000,
  });
  const sets = (list.data?.changeSets ?? []) as Set[];
  return (
    <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
      <div className="mb-3 flex items-center gap-2" role="tablist" aria-label="Which change sets">
        {(["open", "all"] as const).map((f) => (
          <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}
            className={cn("rounded-md px-2.5 py-1 text-sm", filter === f ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}>
            {f === "open" ? "Drafts and ready" : "All"}
          </button>
        ))}
      </div>
      {list.isLoading ? (
        <div className="space-y-2" aria-busy="true">{[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-md bg-muted" />)}</div>
      ) : list.isError ? (
        <p role="alert" className="text-sm text-destructive">{feedbackError(list.error instanceof Error ? list.error.message : "", "Couldn’t load change sets")} <button type="button" className="underline" onClick={() => void list.refetch()}>Retry</button></p>
      ) : !list.data?.enabled ? (
        <EmptyState title="Change sets aren’t on for this workspace yet" body="When they are, an agent’s multi-file work shows up here to review and apply in one step." />
      ) : sets.length === 0 ? (
        <EmptyState title={filter === "open" ? "Nothing waiting for review" : "No change sets yet"} body="Ask an agent for a multi-file change, or start one from your terminal:" command={'nb change start "Redesign the sign-in page"'} />
      ) : (
        <ul className="divide-y divide-border rounded-md border border-border">
          {sets.map((s) => (
            <li key={s.id}>
              <button type="button" onClick={() => onOpen(s.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left hover:bg-accent focus-visible:bg-accent focus-visible:outline-none">
                <FileDiff className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-foreground">{s.title}</span>
                  <span className="block truncate text-xs text-muted-foreground">{counts(s)} · {who(s)} · <When at={s.updatedAt} /></span>
                </span>
                <StatusChip status={s.status} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function EmptyState({ title, body, command }: { title: string; body: string; command?: string }) {
  return (
    <div className="mx-auto max-w-md py-12 text-center">
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{body} <a href="/docs/files/changes" className="underline underline-offset-2 hover:text-foreground">What’s this?</a></p>
      {command ? (
        <button type="button" onClick={() => void copyWithToast(command, "Copied")}
          className="mt-3 inline-flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-1.5 font-mono text-xs text-foreground hover:bg-accent" aria-label={`Copy ${command}`}>
          {command}<Copy className="size-3.5" aria-hidden />
        </button>
      ) : null}
    </div>
  );
}

function StatusChip({ status }: { status: string }) {
  const tone = status === "ready" ? "border-emerald-300 text-emerald-800 dark:border-emerald-800 dark:text-emerald-300" : status === "applied" ? "border-border text-foreground" : "border-border text-muted-foreground";
  return <span className={cn("shrink-0 rounded-[5px] border px-1.5 py-0.5 text-xs", tone)}>{STATUS_WORDS[status] ?? status}</span>;
}

function ChangeSetPage({ projectId, id, onBack, onOpen }: { projectId: string; id: string; onBack: () => void; onOpen: (id: string | null) => void }) {
  const { canEdit } = useFilesTabRole();
  const client = useQueryClient();
  const view = useQuery({
    queryKey: ["change-set", id],
    queryFn: async () => {
      const res = await getChangeSetAction(id);
      if (!res.success) throw new Error(res.error);
      return res.data as unknown as { changeSet: Set; items: Item[]; overlaps?: Array<{ id: string; title: string; agent: string | null; files: number }>; comments?: Comment[] };
    },
  });
  const [filter, setFilter] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [only, setOnly] = useState<globalThis.Set<string>>(new globalThis.Set());
  const [busy, setBusy] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<null | "discard" | "undo">(null);
  const [partial, setPartial] = useState<string[] | null>(null);
  const [asking, setAsking] = useState(false);
  const [note, setNote] = useState("");

  const items = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return (view.data?.items ?? []).filter((i) => !q || i.path.toLowerCase().includes(q));
  }, [view.data?.items, filter]);
  const ordered = useMemo(() => GROUPS.flatMap((g) => items.filter(g.test)), [items]);
  const current = selected ?? ordered[0]?.path ?? null;

  // j / k between files (G12).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      if (e.key !== "j" && e.key !== "k") return;
      const at = ordered.findIndex((i) => i.path === current);
      const next = ordered[Math.min(ordered.length - 1, Math.max(0, at + (e.key === "j" ? 1 : -1)))];
      if (next) setSelected(next.path);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [ordered, current]);

  const refresh = () => {
    void client.invalidateQueries({ queryKey: ["change-set", id] });
    void client.invalidateQueries({ queryKey: ["change-sets", projectId] });
    void client.invalidateQueries({ queryKey: ["files-directory", projectId] });
    window.dispatchEvent(new CustomEvent("project:task-files-changed", { detail: { projectId } }));
  };
  // Final files and docs: "Verify it's you" first (G12), then the same apply again.
  const { needs: needsStepUp, dialog: stepUpDialog } = useStepUp("These files include final files or a doc, so confirm it’s you before applying them.");
  async function act(name: string, run: () => Promise<{ success: boolean; error?: string; data?: any; stepUp?: any }>, done: string): Promise<any> {
    if (busy) return;
    setBusy(name);
    try {
      const res = await run();
      if (needsStepUp(res as never, () => void act(name, run, done))) return;
      if (!res.success) { toast.error(res.error ?? "That didn’t work"); return; }
      toast.success(done);
      refresh();
      return res.data;
    } finally {
      setBusy(null);
    }
  }

  if (view.isLoading) return <div className="space-y-2 p-4" aria-busy="true">{[0, 1, 2, 3].map((i) => <div key={i} className="h-8 animate-pulse rounded bg-muted" />)}</div>;
  if (view.isError || !view.data) return <div className="p-4 text-sm"><p role="alert" className="text-destructive">{view.error instanceof Error ? view.error.message : "Couldn’t open this change set"}</p><button type="button" className="mt-2 underline" onClick={onBack}>Back to Changes</button></div>;
  const s = view.data.changeSet;
  const conflicts = view.data.items.filter((i) => i.state === "conflict").length;
  const draft = s.status === "open" || s.status === "ready";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-border px-4 py-3">
        <button type="button" onClick={onBack} className="mb-2 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"><ArrowLeft className="size-3.5" aria-hidden />Changes</button>
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-base font-semibold text-foreground">{s.title}</h2>
            <p className="text-xs text-muted-foreground">{counts(s)}{s.linesAdded || s.linesRemoved ? ` · +${s.linesAdded} −${s.linesRemoved}` : ""} · {who(s)} · <When at={s.createdAt} /></p>
            <p className="mt-1 text-xs text-foreground" role="status">
              {STATUS_WORDS[s.status] ?? s.status}
              {s.readyAt && draft ? <> · based on files as of <When at={s.readyAt} /></> : null}
              {conflicts ? ` · ${conflicts} file${conflicts === 1 ? "" : "s"} changed since: choose for each before applying` : ""}
            </p>
            {(view.data.overlaps ?? []).map((o) => (
              <p key={o.id} className="mt-1 text-xs text-muted-foreground">
                {o.agent ?? "Another draft"} also has a draft on {o.files} of these file{o.files === 1 ? "" : "s"}: <button type="button" className="underline underline-offset-2 hover:text-foreground" onClick={() => onOpen(o.id)}>{o.title}</button>
              </p>
            ))}
            {s.message ? <p className="mt-2 whitespace-pre-wrap text-sm text-foreground">{s.message}</p> : null}
          </div>
          {canEdit ? (
            <div className="flex flex-wrap gap-2">
              {s.status === "ready" ? (
                <Button size="sm" disabled={Boolean(busy) || conflicts > 0} onClick={() => void act("apply", () => applyChangeSetAction(id, only.size ? [...only] : null), only.size ? `Applied ${only.size} file${only.size === 1 ? "" : "s"}` : "Applied").then((d) => { if (d?.changeSet && d.changeSet.id !== id) setOnly(new globalThis.Set()); })}>
                  <GitMerge className="size-4" aria-hidden />{busy === "apply" ? "Applying…" : only.size ? `Apply ${only.size} selected` : "Apply"}
                </Button>
              ) : null}
              {draft ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void act("update", () => updateDraftAction(id), "Updated with the latest files")}><RefreshCw className="size-4" aria-hidden />Update</Button> : null}
              {draft ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => setConfirm("discard")}>Discard</Button> : null}
              {draft && s.taskId ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => setAsking(true)}><MessageSquare className="size-4" aria-hidden />Ask for changes</Button> : null}
              {s.status === "applied" ? <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => setConfirm("undo")}><Undo2 className="size-4" aria-hidden />Undo</Button> : null}
              {s.status === "undone" || s.status === "discarded" ? (
                <Button size="sm" variant="outline" disabled={Boolean(busy)} onClick={() => void act("copy", () => copyChangeSetAction(id), "Copied as a new draft").then((d) => d?.id && onOpen(d.id))}><Copy className="size-4" aria-hidden />Copy as new draft</Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {asking ? (
          <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void act("ask", () => askForChangesAction(id, note), "Sent: the agent reads it next session").then(() => { setAsking(false); setNote(""); }); }}>
            <label className="sr-only" htmlFor="ask-changes">What should change</label>
            <input id="ask-changes" autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What should change?" className="h-8 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-sm" />
            <Button size="sm" type="submit" disabled={!note.trim() || Boolean(busy)}>Send</Button>
            <Button size="sm" variant="ghost" type="button" onClick={() => setAsking(false)} aria-label="Cancel"><X className="size-4" /></Button>
          </form>
        ) : null}
      </header>

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <nav aria-label="Files in this change set" className="flex min-h-[12rem] flex-col border-b border-border md:w-80 md:border-b-0 md:border-r">
          <div className="relative p-2">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <label className="sr-only" htmlFor="changes-filter">Filter files</label>
            <input id="changes-filter" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Filter files" className="h-8 w-full rounded-md border border-border bg-background pl-7 pr-2 text-sm" />
          </div>
          <Virtuoso
            className="min-h-0 flex-1"
            data={ordered}
            computeItemKey={(_, i) => i.id}
            itemContent={(index, item) => {
              const group = GROUPS.find((g) => g.test(item))!;
              const first = index === 0 || !group.test(ordered[index - 1]!);
              return (
                <div>
                  {first ? <p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">{group.label} ({items.filter(group.test).length})</p> : null}
                  <div className={cn("flex items-center gap-2 px-2", current === item.path && "bg-accent")}>
                    {s.status === "ready" && canEdit ? (
                      <input type="checkbox" aria-label={`Apply only ${item.path}`} checked={only.has(item.path)} onChange={(e) => setOnly((prev) => { const next = new globalThis.Set(prev); if (e.target.checked) next.add(item.path); else next.delete(item.path); return next; })} />
                    ) : null}
                    <button type="button" onClick={() => setSelected(item.path)} aria-current={current === item.path} className="min-w-0 flex-1 truncate py-1.5 text-left font-mono text-xs text-foreground">
                      {item.fromPath ? `${item.fromPath} → ${item.path}` : item.path}
                    </button>
                    {item.linesAdded != null ? <span className="shrink-0 font-mono text-[11px] text-muted-foreground">+{item.linesAdded} −{item.linesRemoved}</span> : null}
                  </div>
                </div>
              );
            }}
          />
        </nav>
        <section aria-label="Diff" className="min-h-0 min-w-0 flex-1 overflow-auto">
          {current ? <ItemDiffView id={id} path={current} item={view.data.items.find((i) => i.path === current) ?? null} canResolve={canEdit && draft} onResolved={refresh} comments={(view.data.comments ?? []).filter((c) => c.path === current)} canComment={canEdit} /> : <p className="p-4 text-sm text-muted-foreground">No files match.</p>}
        </section>
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(o) => { if (!o) setConfirm(null); }}
        title={confirm === "undo" ? `Undo “${s.title}”?` : `Discard “${s.title}”?`}
        description={confirm === "undo" ? `Every file goes back to its version from before the apply (${counts(s)}). Files someone changed since are named, and you can undo the rest.` : "Its files aren’t applied. Copy it as a new draft later if you need it."}
        confirmLabel={confirm === "undo" ? "Undo" : "Discard"}
        variant="destructive"
        loading={Boolean(busy)}
        onConfirm={async () => {
          if (confirm === "discard") await act("discard", () => discardChangeSetAction(id), "Discarded");
          if (confirm === "undo") {
            const res = await undoChangeSetAction(id, false);
            if (!res.success && res.code === "UNDO_BLOCKED") setPartial((res.details?.blocked as Array<{ path: string }> | undefined)?.map((b) => b.path) ?? []);
            else if (!res.success) toast.error(res.error);
            else { toast.success("Undone"); refresh(); }
          }
          setConfirm(null);
        }}
      />
      {stepUpDialog}
      <ConfirmDialog
        open={partial !== null}
        onOpenChange={(o) => { if (!o) setPartial(null); }}
        title="Undo the other files?"
        description={`${(partial ?? []).join(", ")} changed since the apply, so ${partial?.length === 1 ? "it stays" : "they stay"} as ${partial?.length === 1 ? "it is" : "they are"}. The other files go back.`}
        confirmLabel="Undo the rest"
        variant="destructive"
        loading={Boolean(busy)}
        onConfirm={async () => { await act("undo", () => undoChangeSetAction(id, true), "Undid the rest"); setPartial(null); }}
      />
    </div>
  );
}

function ItemDiffView({ id, path, item, canResolve, onResolved, comments, canComment }: { id: string; path: string; item: Item | null; canResolve: boolean; onResolved: () => void; comments: Comment[]; canComment: boolean }) {
  if (item?.state === "conflict") return <MergeEditor id={id} path={path} item={item} canResolve={canResolve} onResolved={onResolved} />;
  return <DiffBody id={id} path={path} item={item} comments={comments} canComment={canComment} onCommented={onResolved} />;
}

/** An unsent comment stays in this browser until it's sent (0.8 #5). */
function useDraft(key: string) {
  const [text, setText] = useState(() => { try { return window.localStorage.getItem(key) ?? ""; } catch { return ""; } });
  useEffect(() => { try { setText(window.localStorage.getItem(key) ?? ""); } catch { setText(""); } }, [key]);
  const save = (value: string) => { setText(value); try { if (value) window.localStorage.setItem(key, value); else window.localStorage.removeItem(key); } catch { /* private mode */ } };
  return [text, save] as const;
}

/** Review comments on one file (G12): on a line of the new content, or on the file. */
function FileComments({ id, path, comments, canComment, line, setLine, onCommented }: { id: string; path: string; comments: Comment[]; canComment: boolean; line: number | null; setLine: (n: number | null) => void; onCommented: () => void }) {
  const [draft, setDraft] = useDraft(`nb:change-set-comment:${id}:${path}`);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    setBusy(true);
    try {
      const res = await addChangeSetCommentAction(id, { path, line, body: draft });
      if (!res.success) { toast.error(res.error); return; }
      setDraft("");
      setLine(null);
      onCommented();
    } finally {
      setBusy(false);
    }
  };
  return (
    <section aria-label="Comments" className="mt-3 space-y-2">
      {comments.map((c) => (
        <article key={c.id} className={cn("rounded-md border border-border p-2 text-sm", c.resolvedAt && "opacity-60")}>
          <p className="text-xs text-muted-foreground">{c.author || (c.username ? `@${c.username}` : "Someone")}{c.line ? ` · line ${c.line}` : ""} · <When at={c.createdAt} />{c.resolvedAt ? " · resolved" : ""}</p>
          <p className="mt-1 whitespace-pre-wrap text-foreground">{c.body}</p>
          {canComment ? (
            <button type="button" className="mt-1 text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground" onClick={() => void resolveChangeSetCommentAction(id, c.id, !c.resolvedAt).then(onCommented)}>{c.resolvedAt ? "Reopen" : "Resolve"}</button>
          ) : null}
        </article>
      ))}
      {canComment ? (
        <form className="space-y-1" onSubmit={(e) => { e.preventDefault(); if (draft.trim()) void send(); }}>
          <label htmlFor={`comment-${path}`} className="block text-xs text-muted-foreground">{line ? `Comment on line ${line}` : "Comment on this file"}{line ? <button type="button" className="ml-2 underline" onClick={() => setLine(null)}>on the file instead</button> : null}</label>
          <textarea id={`comment-${path}`} value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} className="w-full rounded-md border border-border bg-background p-2 text-sm" />
          <Button size="sm" type="submit" disabled={busy || !draft.trim()}>Comment</Button>
        </form>
      ) : null}
    </section>
  );
}

const CONFLICT_WORDS: Record<string, string> = {
  edit: "Someone changed the same lines since this change set started.",
  deleted: "This file was deleted since. Keep yours to bring it back.",
  moved: "This file was moved since. Keep yours to apply the edit where it is now.",
  exists: "A file with this name was added since. Keep yours to make yours its new version.",
};

/** The merge editor (G9, G12): base, theirs and yours side by side; keep one, or edit the result. */
function MergeEditor({ id, path, item, canResolve, onResolved }: { id: string; path: string; item: Item; canResolve: boolean; onResolved: () => void }) {
  const sides = useQuery({
    queryKey: ["change-set-sides", id, path],
    queryFn: async () => {
      const res = await conflictSidesAction(id, path);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
  });
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const choose = async (choice: "mine" | "theirs" | "content") => {
    setBusy(true);
    try {
      const res = await resolveItemAction(id, path, choice, choice === "content" ? editing ?? "" : undefined);
      if (!res.success) { toast.error(res.error); return; }
      toast.success(choice === "theirs" ? "Kept theirs: this file leaves the change set" : "Resolved: finish the change set again to apply it");
      setEditing(null);
      onResolved();
    } finally {
      setBusy(false);
    }
  };
  const kind = item.conflict?.kind ?? "edit";
  const column = (label: string, text: string | null | undefined) => (
    <figure className="min-w-0 rounded-md border border-border">
      <figcaption className="border-b border-border px-2 py-1 text-xs text-muted-foreground">{label}</figcaption>
      <pre className="max-h-[50vh] overflow-auto whitespace-pre p-2 font-mono text-xs leading-5 text-foreground">{text ?? "(not a text file, or none)"}</pre>
    </figure>
  );
  return (
    <div className="p-3">
      <p className="mb-2 truncate font-mono text-xs text-muted-foreground">{path}</p>
      <p role="status" className="mb-3 text-sm text-foreground">{CONFLICT_WORDS[kind] ?? CONFLICT_WORDS.edit}</p>
      {sides.isLoading ? <div className="h-40 animate-pulse rounded bg-muted" aria-busy="true" /> : sides.isError || !sides.data ? (
        <p role="alert" className="text-sm text-destructive">{sides.error instanceof Error ? sides.error.message : "Couldn’t load the versions"}</p>
      ) : editing !== null ? (
        <div>
          <label htmlFor="merge-result" className="mb-1 block text-xs text-muted-foreground">The result</label>
          <textarea id="merge-result" value={editing} onChange={(e) => setEditing(e.target.value)} spellCheck={false} className="h-[50vh] w-full rounded-md border border-border bg-background p-2 font-mono text-xs" />
          <div className="mt-2 flex gap-2">
            <Button size="sm" disabled={busy} onClick={() => void choose("content")}>Use this result</Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(null)}>Cancel</Button>
          </div>
        </div>
      ) : (
        <>
          <div className="grid gap-2 lg:grid-cols-3">
            {column("Base (where it started)", sides.data.base)}
            {column("Theirs (now in the workspace)", sides.data.theirs)}
            {column("Yours (this change set)", sides.data.mine)}
          </div>
          {canResolve ? (
            <div className="mt-3 flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => void choose("mine")}>Keep yours</Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void choose("theirs")}>Keep theirs</Button>
              {sides.data.mine != null ? <Button size="sm" variant="outline" disabled={busy} onClick={() => setEditing(sides.data.mine ?? "")}>Edit the result</Button> : null}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function DiffBody({ id, path, item, comments, canComment, onCommented }: { id: string; path: string; item: Item | null; comments: Comment[]; canComment: boolean; onCommented: () => void }) {
  const [line, setLine] = useState<number | null>(null);
  const diff = useQuery({
    queryKey: ["change-set-diff", id, path],
    queryFn: async () => {
      const res = await changeSetDiffAction(id, path);
      if (!res.success) throw new Error(res.error);
      return res.data;
    },
    staleTime: 60_000,
  });
  return (
    <div className="p-3">
      <p className="mb-2 truncate font-mono text-xs text-muted-foreground">{item?.fromPath ? `${item.fromPath} → ${path}` : path}{item?.conflict?.kind === "merged" ? ` · merged automatically with v${item.conflict.onto} (shown against it)` : ""}</p>
      {diff.isLoading ? <div className="h-40 animate-pulse rounded bg-muted" aria-busy="true" /> : diff.isError || !diff.data ? (
        <p role="alert" className="text-sm text-destructive">{diff.error instanceof Error ? diff.error.message : "Couldn’t load the diff"}</p>
      ) : diff.data.kind === "text" ? (
        <pre className="overflow-x-auto rounded-md border border-border font-mono text-xs leading-5">
          {diff.data.lines.length ? numbered(diff.data.lines).map((l, i) => (
            <div key={i} className={cn("group flex whitespace-pre pr-3", l.kind === "+" && "bg-emerald-50 text-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200", l.kind === "-" && "bg-red-50 text-red-900 dark:bg-red-950/40 dark:text-red-200", l.kind === "@" && "bg-muted text-muted-foreground", line != null && l.n === line && "ring-1 ring-inset ring-[#D14E24]")}>
              {canComment && l.n ? (
                <button type="button" onClick={() => setLine(l.n)} aria-label={`Comment on line ${l.n}`} className="w-10 shrink-0 select-none pr-1 text-right text-muted-foreground/70 hover:text-foreground focus-visible:text-foreground">{comments.some((c) => c.line === l.n) ? "●" : l.n}</button>
              ) : <span aria-hidden className="w-10 shrink-0 select-none pr-1 text-right text-muted-foreground/70">{l.n ?? ""}</span>}
              <span aria-hidden className="select-none pr-2">{l.kind === "@" ? "" : l.kind}</span>{l.text}
            </div>
          )) : <div className="px-3 py-2 text-muted-foreground">No line changes{item?.op === "rename" ? ": renamed only" : ""}.</div>}
        </pre>
      ) : diff.data.kind === "image" ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {(["before", "after"] as const).map((side) => (
            <figure key={side} className="rounded-md border border-border p-2">
              <figcaption className="mb-1 text-xs text-muted-foreground">{side === "before" ? "Before" : "After"}</figcaption>
              {diff.data.kind === "image" && diff.data[side] ? <img src={diff.data[side]!} alt={`${path} ${side}`} className="max-h-80 w-full object-contain" /> : <p className="text-xs text-muted-foreground">None</p>}
            </figure>
          ))}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          {diff.data.kind === "too_large" ? "Too large to show here. " : "Not a text file. "}
          Size {diff.data.beforeSize == null ? "—" : `${diff.data.beforeSize.toLocaleString()} bytes`} → {diff.data.afterSize == null ? "deleted" : `${diff.data.afterSize.toLocaleString()} bytes`}.
        </p>
      )}
      <FileComments id={id} path={path} comments={comments} canComment={canComment} line={line} setLine={setLine} onCommented={onCommented} />
    </div>
  );
}

/** Line numbers of the new content for each diff line (none on removed lines), from the @@ headers. */
function numbered(lines: Array<{ kind: " " | "-" | "+" | "@"; text: string }>) {
  let n = 0;
  return lines.map((l) => {
    if (l.kind === "@") { n = Number(/\+(\d+)/.exec(l.text)?.[1] ?? 1); return { ...l, n: null as number | null }; }
    if (l.kind === "-") return { ...l, n: null as number | null };
    return { ...l, n: n++ };
  });
}
