"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, Eraser, FileDown, FileText, ImagePlus, Link2, MoreHorizontal, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "@/lib/feedback";

import { saveCanvas, type ChannelCanvas as CanvasRow } from "@/app/actions/chat/canvas";
import type { ChannelDetails } from "@/app/actions/chat/channels";
import { CanvasBody, insertCanvasImages, printCanvas, setCanvasContent, useCanvasEditor } from "@/components/messages/CanvasEditor";
import { CanvasTemplateModal } from "@/components/messages/CanvasTemplateModal";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChannelCanvas } from "@/components/messages/useConversation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { CANVAS_MAX_TITLE, CANVAS_TEMPLATES, type CanvasTemplate } from "@/lib/messaging/canvas-store";
import { chatErrorMessage } from "@/lib/messaging/errors";
import { formatChatTime } from "@/lib/messaging/channel-view";
import { conversationHref } from "@/lib/messaging/routes";
import { queryKeys } from "@/lib/query-keys";
import { copyWithToast } from "@/lib/clipboard";

export type CanvasSeed = { title: string; body: string; nonce: number };

const SAVE_DELAY_MS = 800;
const QUICK_TEMPLATES = ["channel-overview", "meeting-notes", "project-brief"];

type Props = {
  channel: ChannelDetails;
  channelId: string;
  /** Content to load (a template or an existing canvas), applied once per nonce. */
  seed?: CanvasSeed | null;
  /** Delete the canvas for everyone (asks first). */
  onDelete?: () => void;
};

export function ChannelCanvas({ channel, channelId, seed, onDelete }: Props) {
  // Your version when someone else saved first (shown with a Copy you click).
  const [conflict, setConflict] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const { user, profile } = useAuth();
  const query = useChannelCanvas(channelId);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<"idle" | "saving" | "error">("idle");
  const [trayHidden, setTrayHidden] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [hasBody, setHasBody] = useState(false);
  // Clearing or applying a template rewrites the canvas for everyone: ask first when it has content.
  const [pendingReplace, setPendingReplace] = useState<{ kind: "clear" } | { kind: "template"; template: CanvasTemplate } | null>(null);
  const version = useRef(0);
  const loaded = useRef(false);
  const dirty = useRef(false);
  const titleRef = useRef("");
  const bodyRef = useRef("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedSeed = useRef<number | null>(null);
  const imageInput = useRef<HTMLInputElement>(null);

  const patchCache = useCallback((patch: Partial<CanvasRow>) => {
    queryClient.setQueryData<CanvasRow | null>(queryKeys.chat.canvas(channelId), (prev) => ({
      channel_id: channelId, title: "", body: "", version: 0, updated_by: null, updated_by_name: null, updated_at: new Date().toISOString(),
      ...prev, ...patch,
    }));
  }, [channelId, queryClient]);

  const save = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    setStatus("saving");
    const body = bodyRef.current;
    const nextTitle = titleRef.current.trim();
    // Opening a blank canvas must not create one: nothing is stored until there is content.
    if (version.current === 0 && !nextTitle && !body.trim()) {
      setStatus("idle");
      return;
    }
    const result = await saveCanvas({ channelId, title: nextTitle, body, baseVersion: version.current });
    if (result.success) {
      version.current = result.version;
      patchCache({ title: nextTitle, body, version: result.version, updated_by: user?.id ?? null, updated_by_name: profile?.fullName || profile?.username || null, updated_at: new Date().toISOString() });
      setStatus("idle");
      return;
    }
    if (result.error === "chat_canvas_conflict") {
      // Someone saved first: keep your version for a Copy you click (a copy started after a save
      // isn't a user gesture, so Safari refuses it), then show theirs.
      setConflict(`${nextTitle ? `# ${nextTitle}\n\n` : ""}${body}`);
      loaded.current = false;
      void query.refetch();
      setStatus("idle");
      return;
    }
    dirty.current = true;
    setStatus("error");
    toast.error(chatErrorMessage(result.error), { id: `canvas-save-${channelId}` });
  }, [channelId, patchCache, profile?.fullName, profile?.username, query, user?.id]);

  const schedule = useCallback(() => {
    dirty.current = true;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => void save(), SAVE_DELAY_MS);
  }, [save]);

  const editor = useCanvasEditor({
    content: "",
    onChange: (markdown) => {
      bodyRef.current = markdown;
      setHasBody(Boolean(markdown.trim()));
      patchCache({ body: markdown });
      schedule();
    },
  });

  // Server content: first load, and later versions from teammates while we have no unsaved edits.
  useEffect(() => {
    const canvas = query.data;
    if (!editor || canvas === undefined) return;
    if (loaded.current && (dirty.current || (canvas?.version ?? 0) <= version.current)) return;
    loaded.current = true;
    version.current = canvas?.version ?? 0;
    titleRef.current = canvas?.title ?? "";
    bodyRef.current = canvas?.body ?? "";
    setTitle(titleRef.current);
    setHasBody(Boolean(bodyRef.current.trim()));
    setCanvasContent(editor, bodyRef.current);
  }, [editor, query.data]);

  const apply = useCallback((nextTitle: string, body: string) => {
    if (!editor) return;
    titleRef.current = nextTitle;
    bodyRef.current = body;
    setTitle(nextTitle);
    setHasBody(Boolean(body.trim()));
    patchCache({ title: nextTitle });
    setCanvasContent(editor, body);
    dirty.current = true;
    void save();
  }, [editor, patchCache, save]);

  useEffect(() => {
    if (!seed || !editor || !loaded.current || appliedSeed.current === seed.nonce) return;
    appliedSeed.current = seed.nonce;
    apply(seed.title, seed.body);
  }, [apply, editor, seed, query.data]);

  // Leaving the tab or the channel saves at once.
  const saveRef = useRef(save);
  useEffect(() => {
    saveRef.current = save;
  });
  useEffect(() => () => {
    if (queryClient.getQueryData(queryKeys.chat.canvas(channelId)) === null) return; // canvas was just removed
    void saveRef.current();
  }, [channelId, queryClient]);

  const writeTemplate = (template: CanvasTemplate) => {
    const generated = template.generate(channel.name || "general", channel.project_title);
    apply(generated.title, generated.content);
    toast.success(`"${template.name}" template applied`);
  };
  const applyTemplate = (template: CanvasTemplate) => {
    if (hasBody || titleRef.current.trim()) setPendingReplace({ kind: "template", template });
    else writeTemplate(template);
  };
  const confirmReplace = () => {
    const pending = pendingReplace;
    setPendingReplace(null);
    if (pending?.kind === "template") writeTemplate(pending.template);
    else if (pending?.kind === "clear") {
      apply("", "");
      setTrayHidden(false);
    }
  };

  const copyLink = () => {
    void copyWithToast(`${window.location.origin}${conversationHref(channelId, { tab: "canvas" })}`, "Canvas link copied").then((ok) => {
      if (!ok) return;
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  const copyMarkdown = () => {
    const body = bodyRef.current.replace(/\]\(\/api\//g, `](${window.location.origin}/api/`);
    void copyWithToast(`${titleRef.current.trim() ? `# ${titleRef.current.trim()}\n\n` : ""}${body}`, "Canvas copied as Markdown");
  };

  const canvas = query.data;
  const empty = !title.trim() && !hasBody && query.data !== undefined;
  const edited = status === "saving"
    ? "Saving…"
    : status === "error"
      ? "Not saved"
      : canvas?.updated_at && canvas.version > 0
        ? `Edited ${formatChatTime(canvas.updated_at, "at")}${canvas.updated_by_name ? ` by ${canvas.updated_by_name}` : ""}`
        : null;

  // Inside the conversation's tab panel already: no second tabpanel.
  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background">
      <div className="flex h-11 flex-none items-center justify-between border-b border-border px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-muted-foreground">
          <FileText size={14} className="flex-none" />
          <span className="truncate">{channel.name ? `#${channel.name}` : "Channel"} canvas</span>
          {/* "Saving…" and "Not saved" show on phones too; the edit time only where there's room. */}
          {edited ? <span className={`truncate text-[12px] ${status === "error" ? "text-destructive" : "text-muted-foreground"} ${status === "idle" ? "hidden sm:inline" : ""}`}>· {edited}</span> : null}
          {/* Only a failed save is announced (not every "Saving…" while you type). */}
          <span className="sr-only" aria-live="polite">{status === "error" ? "Canvas not saved" : ""}</span>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={copyLink} className="pointer-coarse:h-11">
            {copied ? <Check size={14} className="text-primary" /> : <Link2 size={14} />}
            <span>{copied ? "Copied" : "Copy link"}</span>
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger className="nb-icon-button nb-touch-target size-7" aria-label="More canvas options">
              <MoreHorizontal size={16} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => imageInput.current?.click()}><ImagePlus /> Upload image</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTemplatesOpen(true)}><Sparkles /> Templates…</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={copyMarkdown}><Copy /> Copy as Markdown</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor && printCanvas(titleRef.current.trim(), editor.getHTML())}><FileDown /> Download as PDF</DropdownMenuItem>
              <DropdownMenuSeparator />
              {/* Clearing wipes it for everyone: it reads as destructive, but isn't Delete. */}
              <DropdownMenuItem variant="destructive" onSelect={() => setPendingReplace({ kind: "clear" })}><Eraser /> Clear canvas</DropdownMenuItem>
              {onDelete ? <DropdownMenuItem variant="destructive" onSelect={onDelete}><Trash2 /> Delete canvas</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
      {conflict ? (
        <div role="alert" className="flex flex-none flex-wrap items-center gap-2 border-b border-border bg-[var(--status-warning-soft)] px-4 py-2 text-[13px] text-foreground sm:px-6">
          <span className="min-w-0 flex-1">Someone else saved this canvas first. You’re seeing their version; copy yours to paste back what you need.</span>
          <Button type="button" variant="outline" size="sm" onClick={() => { void copyWithToast(conflict, "Your version copied"); }} className="pointer-coarse:h-11">Copy your version</Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => setConflict(null)} className="pointer-coarse:h-11">Dismiss</Button>
        </div>
      ) : null}

      <div className="app-scroll app-scroll-y flex-1 overflow-x-hidden">
        <div className="mx-auto max-w-3xl space-y-4 py-8 pr-4 sm:pr-8">
          <input
            type="text"
            value={title}
            maxLength={CANVAS_MAX_TITLE}
            placeholder="Your canvas title"
            aria-label="Canvas title"
            onChange={(event) => {
              titleRef.current = event.target.value;
              setTitle(event.target.value);
              patchCache({ title: event.target.value });
              schedule();
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                editor?.commands.focus("start");
              }
            }}
            className="nb-page-title w-full border-none bg-transparent pl-12 text-foreground outline-none placeholder:text-muted-foreground"
          />
          {query.error ? (
            <p role="alert" className="ml-12 rounded-md bg-[var(--status-danger-soft)] px-3 py-2 text-[13px] text-[var(--status-danger)]">
              {chatErrorMessage(query.error.message)}
            </p>
          ) : null}
          <CanvasBody editor={editor} channelId={channelId} />
        </div>
      </div>

      {empty && !trayHidden ? (
        <div className="flex-none px-4 pb-4 sm:px-8">
          <div className="mx-auto w-full max-w-3xl rounded-lg border border-border bg-card p-4">
            <div className="flex items-center justify-between pb-3">
              <span className="nb-ui-label text-foreground">Start from a template</span>
              <button
                type="button"
                onClick={() => setTrayHidden(true)}
                aria-label="Dismiss template suggestions"
                className="nb-icon-button nb-touch-target size-7"
              >
                <X size={16} />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {QUICK_TEMPLATES.map((id) => CANVAS_TEMPLATES.find((t) => t.id === id)).filter(Boolean).map((template) => (
                <Button key={template!.id} type="button" variant="outline" size="sm" onClick={() => applyTemplate(template!)} className="pointer-coarse:h-11">
                  {template!.name}
                </Button>
              ))}
              <Button type="button" variant="link" size="sm" onClick={() => setTemplatesOpen(true)} className="pointer-coarse:h-11">
                More templates…
              </Button>
            </div>
          </div>
        </div>
      ) : null}

      <input
        ref={imageInput}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(event) => {
          if (editor) insertCanvasImages(editor, channelId, Array.from(event.target.files ?? []), editor.state.doc.content.size);
          event.target.value = "";
        }}
      />
      <CanvasTemplateModal
        open={templatesOpen}
        onOpenChange={setTemplatesOpen}
        onSelectTemplate={applyTemplate}
        channelName={channel.name || "general"}
        projectName={channel.project_title ?? null}
      />
      <ConfirmDialog
        open={pendingReplace !== null}
        onOpenChange={(open) => !open && setPendingReplace(null)}
        title={pendingReplace?.kind === "clear" ? "Clear the canvas for everyone?" : "Replace the canvas?"}
        description="Everyone in the channel sees the change. Copy it first if you want to keep it."
        confirmLabel={pendingReplace?.kind === "clear" ? "Clear canvas" : "Replace"}
        variant="destructive"
        onConfirm={confirmReplace}
      />
    </div>
  );
}
