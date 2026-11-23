"use client";
import { PixelBeat } from "@/components/ui/PixelBeat";

import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { FileText, Search, X } from "lucide-react";

import { listWorkspaceCanvases } from "@/app/actions/chat/canvas";
import { CanvasPreview } from "@/components/messages/CanvasEditor";
import { useChannelCanvas } from "@/components/messages/useConversation";
import { ErrorNotice } from "@/components/ui/ErrorNotice";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
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
      const result = await listWorkspaceCanvases({ projectId: projectId!, exceptChannelId: currentChannelId });
      // A failure isn't "no canvases": it shows Retry.
      if (!result.success) throw new Error(result.error);
      return result.canvases;
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
      <DialogContent size="wide" showCloseButton={false} className="flex h-[560px] max-h-[85vh] w-[860px] max-w-[95vw] flex-col overflow-hidden border border-border p-0 sm:max-w-3xl">
        <DialogTitle className="sr-only">Copy from another channel</DialogTitle>
        {/* Phones: the list on top, the preview below (side by side leaves ~90px for the preview). */}
        <div className="flex h-full min-h-0 flex-1 flex-col divide-y divide-border sm:flex-row sm:divide-x sm:divide-y-0">
          <div className="flex max-h-[40%] shrink-0 flex-col bg-muted sm:max-h-none sm:w-72">
            <div className="border-b border-border p-3">
              <h2 className="nb-ui-label mb-2 text-foreground">Copy from another channel</h2>
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search channel notes…"
                  aria-label="Search channel notes"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 text-[13px]"
                />
              </div>
            </div>
            <div className="app-scroll app-scroll-y flex-1 space-y-1 p-2">
              {canvases.map((item) => (
                <button
                  key={item.channel_id}
                  type="button"
                  onClick={() => setSelectedId(item.channel_id)}
                  aria-pressed={selected?.channel_id === item.channel_id}
                  // Selected = the paper well, never a clay fill (spec).
                  className={`block w-full rounded-md p-2.5 text-left text-foreground transition-colors duration-[130ms] ${selected?.channel_id === item.channel_id ? "bg-card shadow-xs" : "hover:bg-card"}`}
                >
                  <p className="truncate text-[13px] font-medium">{item.title || "Untitled"}</p>
                  <p className="nb-meta mt-1 truncate">
                    #{item.channel_name ?? "channel"} · {new Date(item.updated_at).toLocaleDateString()}
                  </p>
                </button>
              ))}
              {list.isError ? <ErrorNotice what="Channel notes" onRetry={() => void list.refetch()} /> : null}
              {!list.isLoading && !list.isError && canvases.length === 0 ? (
                <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">
                  {search ? `No channel notes match "${search}"` : projectId ? "No other channel notes in this workspace yet." : "Channel notes from other channels show here."}
                </p>
              ) : null}
            </div>
          </div>
          <div className="flex min-w-0 flex-1 flex-col bg-background">
            <div className="flex h-12 flex-none items-center justify-between border-b border-border px-6">
              <div className="flex min-w-0 items-center gap-2">
                <FileText size={16} className="shrink-0 text-muted-foreground" />
                <h3 className="nb-ui-label truncate text-foreground">{selected?.title || "Note preview"}</h3>
              </div>
              <button type="button" onClick={() => onOpenChange(false)} aria-label="Close dialog" className="nb-icon-button nb-touch-target size-8">
                <X size={16} />
              </button>
            </div>
            <div className="app-scroll app-scroll-y flex-1 p-6 sm:p-8">
              {selected && full.data ? <CanvasPreview markdown={full.data.body} /> : selected && full.isError ? (
                <ErrorNotice what="This note" onRetry={() => void full.refetch()} />
              ) : (
                <div role={selected ? "status" : undefined} className="grid h-full place-items-center text-[13px] text-muted-foreground">{selected ? <span className="nb-waiting"><PixelBeat />Loading…</span> : "Select a note to preview"}</div>
              )}
            </div>
            <div className="flex h-14 flex-none items-center justify-end gap-2 border-t border-border bg-muted px-6">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button
                type="button"
                disabled={!full.data || !selected}
                onClick={() => {
                  if (!full.data) return;
                  onSelectExisting(full.data.title, full.data.body);
                  onOpenChange(false);
                }}
              >
                {channelName ? `Copy into #${channelName}` : "Copy here"}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
