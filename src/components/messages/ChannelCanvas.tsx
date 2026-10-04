"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy, FileDown, FileText, ImagePlus, Link2, MoreHorizontal, Sparkles, Trash2, X } from "lucide-react";
import { toast } from "sonner";

import { saveCanvas, type ChannelCanvas as CanvasRow } from "@/app/actions/chat/canvas";
import type { ChannelDetails } from "@/app/actions/chat/channels";
import { CanvasBody, insertCanvasImages, printCanvas, setCanvasContent, useCanvasEditor } from "@/components/messages/CanvasEditor";
import { CanvasTemplateModal } from "@/components/messages/CanvasTemplateModal";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useChannelCanvas } from "@/components/messages/useConversation";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { useAuth } from "@/hooks/useAuth";
import { CANVAS_MAX_TITLE, CANVAS_TEMPLATES, type CanvasTemplate } from "@/lib/messaging/canvas-store";
import { chatErrorMessage } from "@/lib/messaging/errors";
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
      toast.message(chatErrorMessage(result.error));
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
    void copyWithToast(`${window.location.origin}/messages/${channelId}?tab=canvas`, "Canvas link copied").then((ok) => {
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
        ? `Edited ${new Date(canvas.updated_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}${canvas.updated_by_name ? ` by ${canvas.updated_by_name}` : ""}`
        : null;

  return (
    <div className="flex flex-1 flex-col overflow-hidden bg-background" role="tabpanel" aria-label="Channel canvas">
      <div className="flex h-11 flex-none items-center justify-between border-b border-border/70 px-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-2 text-[12px] font-medium text-muted-foreground">
          <FileText size={14} className="flex-none text-primary" />
          <span className="truncate">{channel.name ? `#${channel.name}` : "Channel"} canvas</span>
          {edited ? <span className="hidden truncate text-[11px] text-muted-foreground/70 sm:inline" aria-live="polite">· {edited}</span> : null}
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={copyLink}
            className="inline-flex h-7 items-center gap-1.5 rounded-[5px] border border-border px-2.5 text-[12px] font-medium text-foreground transition-colors hover:bg-muted"
          >
            {copied ? <Check size={13} className="text-primary" /> : <Link2 size={13} />}
            <span>{copied ? "Copied" : "Share"}</span>
          </button>
          <DropdownMenu>
            <DropdownMenuTrigger className="grid size-7 place-items-center rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground" aria-label="More canvas options">
              <MoreHorizontal size={15} />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-52">
              <DropdownMenuItem onSelect={() => imageInput.current?.click()}><ImagePlus size={14} /> Upload image</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={copyLink}><Link2 size={14} /> Copy link</DropdownMenuItem>
              <DropdownMenuItem onSelect={copyMarkdown}><Copy size={14} /> Copy as Markdown</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => editor && printCanvas(titleRef.current.trim(), editor.getHTML())}><FileDown size={14} /> Download as PDF</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setTemplatesOpen(true)}><Sparkles size={14} className="text-primary" /> Template gallery</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setPendingReplace({ kind: "clear" })}><Trash2 size={14} /> Clear canvas</DropdownMenuItem>
              {onDelete ? <DropdownMenuItem onSelect={onDelete} className="text-destructive focus:text-destructive"><Trash2 size={14} /> Delete canvas</DropdownMenuItem> : null}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

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
            className="w-full border-none bg-transparent pl-12 text-[28px] font-bold tracking-tight text-foreground outline-none placeholder:text-muted-foreground/40 sm:text-[34px]"
          />
          {query.error ? (
            <p role="alert" className="ml-12 rounded-[5px] bg-[var(--status-danger-soft)] px-3 py-2 text-[13px] text-[var(--status-danger)]">
              {chatErrorMessage(query.error.message)}
            </p>
          ) : null}
          <CanvasBody editor={editor} channelId={channelId} />
        </div>
      </div>

      {empty && !trayHidden ? (
        <div className="flex-none px-4 pb-4 sm:px-8">
          <div className="mx-auto w-full max-w-3xl rounded-xl border border-border bg-card p-4 shadow-2xs">
            <div className="flex items-center justify-between pb-3">
              <span className="text-[13px] font-semibold text-foreground">Explore templates</span>
              <button
                type="button"
                onClick={() => setTrayHidden(true)}
                aria-label="Dismiss template suggestions"
                className="grid size-6 place-items-center rounded-[4px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
              >
                <X size={15} />
              </button>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {QUICK_TEMPLATES.map((id) => CANVAS_TEMPLATES.find((t) => t.id === id)).filter(Boolean).map((template) => (
                <button
                  key={template!.id}
                  type="button"
                  onClick={() => applyTemplate(template!)}
                  className="inline-flex h-8 items-center rounded-lg border border-border bg-background px-3 text-[13px] font-medium text-foreground transition-colors hover:border-primary/50 hover:bg-muted"
                >
                  {template!.name}
                </button>
              ))}
              <button type="button" onClick={() => setTemplatesOpen(true)} className="inline-flex h-8 items-center px-1.5 text-[13px] font-medium text-primary hover:underline">
                Explore more…
              </button>
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
