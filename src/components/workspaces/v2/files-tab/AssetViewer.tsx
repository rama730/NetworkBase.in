"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { MapPin } from "lucide-react";
import { useRef, useState } from "react";

import { addFileCommentAction, changeFileCommentAction, readFileCommentsAction } from "@/app/actions/file-comments";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { FORM_PRIMARY_CLASS, FORM_SECONDARY_CLASS, inputClassName } from "@/components/workspaces/v2/tasks/form-parts";
import { toast } from "@/lib/feedback";
import { queryKeys } from "@/lib/query-keys";
import { cn } from "@/lib/utils";
import { formatMoment, otherVersionCount, versionComments, type Anchor } from "@/lib/workflows/file-comments";

const commentsKey = (projectId: string, nodeId: string) => [...queryKeys.project.detail.tasksRoot(projectId), "file-comments", nodeId];
const small = cn(FORM_SECONDARY_CLASS, "h-7 px-2 text-[12px]");

/**
 * Report 38.16 W3–W5, W9 (plan A7.2): an asset opened large with its comments. Images take pinned comments (Pin a
 * comment → click a spot); video and audio take comments at the current moment, shown as markers. Comments belong to
 * the version they were made on; older versions' comments show on request.
 */
export function AssetViewer({ projectId, asset, onClose }: { projectId: string; asset: { id: string; name: string; mimeType: string | null; version: number }; onClose: () => void }) {
  const queryClient = useQueryClient();
  const query = useQuery({ queryKey: commentsKey(projectId, asset.id), queryFn: () => readFileCommentsAction(projectId, asset.id), staleTime: 10_000 });
  const media = useRef<HTMLVideoElement & HTMLAudioElement>(null);
  const [pinning, setPinning] = useState(false);
  const [draft, setDraft] = useState<{ anchor: Anchor | null; text: string } | null>(null);
  const [showOld, setShowOld] = useState(false);
  const [busy, setBusy] = useState(false);
  const data = query.data?.success ? query.data : null;
  const version = data?.version ?? asset.version;
  const src = `/api/v1/workspaces/${projectId}/files/${asset.id}/preview?v=${version}`;
  const threads = data ? versionComments(data.comments, version) : [];
  const olderAll = data ? [...new Set(data.comments.filter((c) => c.version !== version && !c.parentId).map((c) => c.version))].sort((a, b) => b - a).flatMap((v) => versionComments(data.comments, v).map((c) => ({ ...c, onVersion: v }))) : [];
  const refresh = () => queryClient.invalidateQueries({ queryKey: commentsKey(projectId, asset.id) });

  async function post(anchor: Anchor | null, text: string, parentId?: string) {
    setBusy(true);
    try {
      const r = await addFileCommentAction({ projectId, nodeId: asset.id, version, anchor, content: text, ...(parentId ? { parentId } : {}),
        ...(media.current && Number.isFinite(media.current.duration) ? { duration: media.current.duration } : {}) });
      if (!r.success) throw new Error(r.error);
      setDraft(null);
      await refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn’t add the comment");
    } finally {
      setBusy(false);
    }
  }
  async function change(commentId: string, action: "resolve" | "reopen" | "delete") {
    const r = await changeFileCommentAction({ projectId, nodeId: asset.id, commentId, action });
    if (!r.success) toast.error(r.error); else await refresh();
  }
  function placePin(e: React.MouseEvent<HTMLDivElement>) {
    if (!pinning) return;
    const box = e.currentTarget.getBoundingClientRect();
    const x = Math.min(1, Math.max(0, (e.clientX - box.left) / box.width)), y = Math.min(1, Math.max(0, (e.clientY - box.top) / box.height));
    setPinning(false);
    setDraft({ anchor: { x: Math.round(x * 1000) / 1000, y: Math.round(y * 1000) / 1000 }, text: "" });
  }
  const jump = (t: number) => { if (media.current) { media.current.currentTime = t; void media.current.play().catch(() => undefined); } };
  const kind = data?.kind ?? "other";
  const label = (a: Anchor | null, pin: number | null) => (a && "t" in a ? `At ${formatMoment(a.t)}` : pin ? `Pin ${pin}` : null);

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-h-[92vh] w-[96vw] max-w-[1100px] overflow-y-auto p-0 sm:max-w-[1100px]" data-testid="asset-viewer">
        <div className="border-b border-border px-5 py-3">
          <DialogTitle className="text-base font-semibold">{asset.name} <span className="font-mono text-[12px] font-normal text-muted-foreground">v{version}</span></DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">Comments stay on the version they were made on.</DialogDescription>
        </div>
        <div className="grid gap-4 p-5 md:grid-cols-[minmax(0,1fr)_320px]">
          <div className="min-w-0 space-y-2">
            {kind === "image" ? (
              <div className={cn("relative inline-block max-w-full", pinning && "cursor-crosshair")} onClick={placePin} data-testid="asset-stage">
                <img src={src} alt={asset.name} className="block max-h-[60vh] max-w-full" />
                {threads.filter((c) => c.anchor && "x" in c.anchor).map((c) => (
                  <span key={c.id} aria-hidden="true" className={cn("absolute flex size-6 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-2 border-background font-mono text-[11px] font-semibold text-white", c.resolvedAt ? "bg-muted-foreground" : "bg-primary")}
                    style={{ left: `${(c.anchor as { x: number }).x * 100}%`, top: `${(c.anchor as { y: number }).y * 100}%` }}>{c.pin}</span>
                ))}
                {draft?.anchor && "x" in draft.anchor ? <span aria-hidden="true" className="absolute size-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-primary bg-background" style={{ left: `${draft.anchor.x * 100}%`, top: `${draft.anchor.y * 100}%` }} /> : null}
              </div>
            ) : kind === "media" ? (
              <div className="space-y-1">
                {(asset.mimeType ?? "").startsWith("audio/") ? <audio ref={media} src={src} controls className="w-full" /> : <video ref={media} src={src} controls className="max-h-[60vh] w-full" />}
                <div className="relative h-2 rounded bg-muted" aria-hidden="true" data-testid="moment-markers">
                  {media.current && Number.isFinite(media.current.duration) ? threads.filter((c) => c.anchor && "t" in c.anchor).map((c) => (
                    <span key={c.id} className="absolute top-0 h-2 w-1 bg-primary" style={{ left: `${((c.anchor as { t: number }).t / media.current!.duration) * 100}%` }} />
                  )) : null}
                </div>
              </div>
            ) : <p className="text-[13px] text-muted-foreground">No preview for this kind of file; comments still work.</p>}
            {data?.canComment ? (
              <div className="flex flex-wrap gap-2">
                {kind === "image" ? <button type="button" className={small} aria-pressed={pinning} onClick={() => setPinning((v) => !v)}><MapPin aria-hidden="true" className="mr-1 inline size-3.5" />{pinning ? "Click a spot on the image" : "Pin a comment"}</button> : null}
                {kind === "media" ? <button type="button" className={small} onClick={() => setDraft({ anchor: { t: Math.round((media.current?.currentTime ?? 0) * 10) / 10 }, text: "" })}>Comment at {formatMoment(media.current?.currentTime ?? 0)}</button> : null}
                <button type="button" className={small} onClick={() => setDraft({ anchor: null, text: "" })}>Comment</button>
              </div>
            ) : null}
          </div>
          <section aria-label="Comments" className="space-y-3" data-testid="file-comments">
            {draft ? (
              <form className="space-y-2 rounded-[8px] border border-border p-2" onSubmit={(e) => { e.preventDefault(); if (draft.text.trim()) void post(draft.anchor, draft.text.trim()); }}>
                <p className="text-[12px] font-medium">{draft.anchor ? ("t" in draft.anchor ? `At ${formatMoment(draft.anchor.t)}` : "On the spot you picked") : "Comment"}</p>
                <textarea aria-label="Comment" autoFocus rows={3} maxLength={4000} value={draft.text} onChange={(e) => setDraft({ ...draft, text: e.target.value })} className={cn(inputClassName(false), "h-auto py-2")} />
                <div className="flex justify-end gap-2"><button type="button" className={small} onClick={() => setDraft(null)}>Cancel</button><button type="submit" className={cn(FORM_PRIMARY_CLASS, "h-7 px-3 text-[12px]")} disabled={busy || !draft.text.trim()}>Post</button></div>
              </form>
            ) : null}
            {query.isLoading ? <p className="text-[12px] text-muted-foreground">Loading comments…</p> : !threads.length && !draft ? <p className="text-[12px] text-muted-foreground">No comments on version {version} yet.</p> : null}
            <ol className="space-y-2">
              {threads.map((c) => <Thread key={c.id} c={c} label={label(c.anchor as Anchor | null, c.pin)} canComment={Boolean(data?.canComment)} canResolve={Boolean(data?.canResolve) || c.authorId === data?.me} mine={c.authorId === data?.me}
                onJump={c.anchor && "t" in c.anchor ? () => jump((c.anchor as { t: number }).t) : undefined} onReply={(text) => post(null, text, c.id)} onChange={(a) => void change(c.id, a)} />)}
            </ol>
            {data && otherVersionCount(data.comments, version) ? (
              <div className="border-t border-border pt-2">
                <button type="button" className="text-[12px] font-medium underline underline-offset-4" onClick={() => setShowOld((v) => !v)}>{showOld ? "Hide" : "Show"} {otherVersionCount(data.comments, version)} on earlier versions</button>
                {showOld ? <ol className="mt-2 space-y-2 opacity-80">{olderAll.map((c) => <li key={c.id} className="rounded-[6px] border border-border p-2 text-[12px]"><span className="font-mono text-[11px] text-muted-foreground">on version {c.onVersion}{label(c.anchor as Anchor | null, c.pin) ? ` · ${label(c.anchor as Anchor | null, c.pin)}` : ""}</span><p className="mt-0.5 font-medium">{c.authorName}</p><p className="whitespace-pre-wrap">{c.content}</p></li>)}</ol> : null}
              </div>
            ) : null}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

type ThreadComment = { id: string; content: string; authorName: string; createdAt: string; resolvedAt: string | null; replies: Array<{ id: string; content: string; authorName: string }> };
function Thread({ c, label, canComment, canResolve, mine, onJump, onReply, onChange }: { c: ThreadComment; label: string | null; canComment: boolean; canResolve: boolean; mine: boolean;
  onJump?: () => void; onReply: (text: string) => Promise<void>; onChange: (a: "resolve" | "reopen" | "delete") => void }) {
  const [reply, setReply] = useState<string | null>(null);
  return (
    <li className={cn("rounded-[6px] border border-border p-2 text-[12px]", c.resolvedAt && "opacity-70")} data-testid="file-comment">
      <div className="flex items-center gap-2">
        {label ? (onJump ? <button type="button" onClick={onJump} className="font-mono text-[11px] font-semibold underline">{label}</button> : <span className="font-mono text-[11px] font-semibold">{label}</span>) : null}
        <span className="font-medium">{c.authorName}</span>
        {c.resolvedAt ? <span className="text-muted-foreground">Resolved</span> : null}
      </div>
      <p className="mt-0.5 whitespace-pre-wrap">{c.content}</p>
      {c.replies.map((r) => <div key={r.id} className="mt-1.5 border-l-2 border-border pl-2"><span className="font-medium">{r.authorName}</span><p className="whitespace-pre-wrap">{r.content}</p></div>)}
      <div className="mt-1.5 flex flex-wrap gap-2 text-[11px] text-muted-foreground">
        {canComment ? <button type="button" className="underline" onClick={() => setReply(reply == null ? "" : null)}>Reply</button> : null}
        {canResolve ? <button type="button" className="underline" onClick={() => onChange(c.resolvedAt ? "reopen" : "resolve")}>{c.resolvedAt ? "Reopen" : "Resolve"}</button> : null}
        {mine ? <button type="button" className="underline" onClick={() => onChange("delete")}>Delete</button> : null}
      </div>
      {reply != null ? (
        <form className="mt-1.5 flex gap-1" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) void onReply(reply.trim()).then(() => setReply(null)); }}>
          <input aria-label="Reply" autoFocus value={reply} onChange={(e) => setReply(e.target.value)} className={cn(inputClassName(false), "h-7 text-[12px]")} />
          <button type="submit" className={small}>Send</button>
        </form>
      ) : null}
    </li>
  );
}
