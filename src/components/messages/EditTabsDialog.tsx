"use client";

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Bookmark, CheckSquare, SlidersHorizontal, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ChannelTabItem } from "@/lib/messaging/channel-tabs";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabs: ChannelTabItem[];
  onSaveTabs: (nextTabs: ChannelTabItem[]) => void;
};

function getTabIcon(kind: ChannelTabItem["kind"]) {
  return kind === "tasks" ? <CheckSquare size={15} className="text-muted-foreground" /> : <Bookmark size={15} className="text-muted-foreground" />;
}

export function EditTabsDialog({ open, onOpenChange, tabs, onSaveTabs }: Props) {
  const [draftTabs, setDraftTabs] = useState<ChannelTabItem[]>(tabs);

  useEffect(() => {
    setDraftTabs(tabs);
  }, [tabs, open]);

  const moveUp = (index: number) => {
    if (index <= 0 || index >= draftTabs.length) return;
    setDraftTabs((prev) => {
      const copy = [...prev];
      const prevItem = copy[index - 1];
      const currentItem = copy[index];
      if (!prevItem || !currentItem) return prev;
      copy[index - 1] = currentItem;
      copy[index] = prevItem;
      return copy;
    });
  };

  const moveDown = (index: number) => {
    if (index < 0 || index >= draftTabs.length - 1) return;
    setDraftTabs((prev) => {
      const copy = [...prev];
      const nextItem = copy[index + 1];
      const currentItem = copy[index];
      if (!nextItem || !currentItem) return prev;
      copy[index + 1] = currentItem;
      copy[index] = nextItem;
      return copy;
    });
  };

  const removeTab = (id: string) => {
    setDraftTabs((prev) => prev.filter((t) => t.id !== id));
  };

  const updateTitle = (id: string, nextTitle: string) => {
    setDraftTabs((prev) => prev.map((t) => (t.id === id ? { ...t, title: nextTitle } : t)));
  };

  const handleSave = () => {
    onSaveTabs(draftTabs);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-[5px] bg-muted text-muted-foreground">
              <SlidersHorizontal size={16} />
            </div>
            <DialogTitle>Edit tabs</DialogTitle>
          </div>
          <DialogDescription>
            Rename, reorder or remove Tasks and bookmarks. Changes apply for everyone in the channel.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[360px] overflow-y-auto py-2 space-y-2">
          {draftTabs.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">
              No shared tabs yet. Use + in the tab bar to add Tasks or a bookmark.
            </p>
          ) : (
            draftTabs.map((item, index) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-[6px] border border-border bg-card p-2 text-[13px]"
              >
                <div className="grid size-7 flex-none place-items-center rounded-[4px] bg-muted">
                  {getTabIcon(item.kind)}
                </div>

                <div className="min-w-0 flex-1">
                  {item.shared ? (
                    <input
                      type="text"
                      value={item.title}
                      onChange={(e) => updateTitle(item.id, e.target.value.slice(0, 60))}
                      placeholder="Tab title"
                      className="w-full rounded-[4px] border border-border bg-background px-2 py-0.5 text-[13px] outline-none focus:border-ring"
                    />
                  ) : (
                    <span className="font-medium">{item.title}</span>
                  )}
                  {item.url ? (
                    <p className="truncate font-mono text-[11px] text-muted-foreground">{item.url}</p>
                  ) : null}
                </div>

                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveUp(index)}
                    disabled={index === 0}
                    aria-label={`Move ${item.title} tab up`}
                    className="grid size-7 place-items-center rounded-[4px] text-muted-foreground hover:bg-muted disabled:opacity-30"
                  >
                    <ArrowUp size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(index)}
                    disabled={index === draftTabs.length - 1}
                    aria-label={`Move ${item.title} tab down`}
                    className="grid size-7 place-items-center rounded-[4px] text-muted-foreground hover:bg-muted disabled:opacity-30"
                  >
                    <ArrowDown size={14} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeTab(item.id)}
                    aria-label={`Remove ${item.title} tab`}
                    className="grid size-7 place-items-center rounded-[4px] text-destructive hover:bg-destructive/10"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        <DialogFooter className="pt-2">
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded-[5px] border border-border px-3 py-1.5 text-[13px] font-medium hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            className="rounded-[5px] bg-primary px-3.5 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90"
          >
            Save changes
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
