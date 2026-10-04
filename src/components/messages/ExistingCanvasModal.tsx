"use client";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FileText, Search, X } from "lucide-react";

import { listProjectCanvases } from "@/app/actions/chat/canvas";
import { CanvasPreview } from "@/components/messages/CanvasEditor";
import { useChannelCanvas } from "@/components/messages/useConversation";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { queryKeys } from "@/lib/query-keys";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectExisting: (title: string, body: string) => void;
  projectId: string | null;
  currentChannelId: string;
  /** This channel's name, for the button ("Copy into #design"). */
  channelName?: string | null;
};

/** Copy a canvas from another channel of this project (one you're in) into this one. */
export function ExistingCanvasModal({ open, onOpenChange, onSelectExisting, projectId, currentChannelId, channelName = null }: Props) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const list = useQuery({
    queryKey: queryKeys.chat.projectCanvases(projectId ?? "none"),
    enabled: open && Boolean(projectId),
    queryFn: async () => {
      const result = await listProjectCanvases({ projectId: projectId!, exceptChannelId: currentChannelId });
      return result.success ? result.canvases : [];
    },
    staleTime: 30_000,
  });
  const canvases = useMemo(() => {
    const q = search.trim().toLowerCase();
    const all = list.data ?? [];
    return q ? all.filter((c) => `${c.title} ${c.preview} ${c.channel_name ?? ""}`.toLowerCase().includes(q)) : all;
  }, [list.data, search]);
  const selected = canvases.find((c) => c.channel_id === selectedId) ?? canvases[0] ?? null;
  const full = useChannelCanvas(selected?.channel_id ?? currentChannelId, open && Boolean(selected));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="flex h-[560px] max-h-[85vh] w-[860px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-border p-0 shadow-xl sm:max-w-3xl">
        <DialogTitle className="sr-only">Copy from another channel</DialogTitle>
        {/* Phones: the list on top, the preview below (side by side leaves ~90px for the preview). */}
        <div className="flex h-full min-h-0 flex-1 flex-col divide-y divide-border sm:flex-row sm:divide-x sm:divide-y-0">
          <div className="flex max-h-[40%] shrink-0 flex-col bg-muted/20 sm:max-h-none sm:w-72">
            <div className="border-b border-border/70 p-3">
              <h2 className="mb-2 text-[13px] font-semibold text-foreground">Copy from another channel</h2>
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search canvases…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
            <div className="app-scroll app-scroll-y flex-1 space-y-1 p-2">
              {canvases.map((item) => (
                <button
                  key={item.channel_id}
                  type="button"
                  onClick={() => setSelectedId(item.channel_id)}
                  className={`block w-full rounded-md p-2.5 text-left transition-colors ${selected?.channel_id === item.channel_id ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"}`}
                >
                  <p className="truncate text-[13px] font-medium">{item.title || "Untitled"}</p>
                  <p className={`mt-1 truncate text-[11px] ${selected?.channel_id === item.channel_id ? "text-primary-foreground/80" : "text-muted-foreground"}`}>
                    #{item.channel_name ?? "channel"} · {new Date(item.updated_at).toLocaleDateString()}
                  </p>
                </button>
              ))}
              {!list.isLoading && canvases.length === 0 ? (
                <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">
                  {search ? `No canvases match "${search}"` : projectId ? "No other canvases in this project yet." : "Canvases from other channels show here."}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col bg-background">
            <div className="flex h-12 flex-none items-center justify-between border-b border-border px-6">
              <div className="flex min-w-0 items-center gap-2">
                <FileText size={15} className="shrink-0 text-primary" />
                <h3 className="truncate text-[14px] font-semibold text-foreground">{selected?.title || "Canvas preview"}</h3>
              </div>
              <button type="button" onClick={() => onOpenChange(false)} aria-label="Close dialog" className="grid size-7 place-items-center rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <X size={16} />
              </button>
            </div>
            <div className="app-scroll app-scroll-y flex-1 p-6 sm:p-8">
              {selected && full.data ? <CanvasPreview markdown={full.data.body} /> : (
                <div className="grid h-full place-items-center text-[13px] text-muted-foreground">{selected ? "Loading…" : "Select a canvas to preview"}</div>
              )}
            </div>
            <div className="flex h-14 flex-none items-center justify-end gap-2 border-t border-border bg-card px-6">
              <button type="button" onClick={() => onOpenChange(false)} className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-[13px] font-medium text-foreground hover:bg-muted">Cancel</button>
              <button
                type="button"
                disabled={!full.data || !selected}
                onClick={() => {
                  if (!full.data) return;
                  onSelectExisting(full.data.title, full.data.body);
                  onOpenChange(false);
                }}
                className="inline-flex h-9 items-center justify-center rounded-lg bg-primary px-5 text-[13px] font-semibold text-primary-foreground shadow-2xs transition-colors hover:bg-primary/90 disabled:opacity-50"
              >
                {channelName ? `Copy into #${channelName}` : "Copy here"}
              </button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
