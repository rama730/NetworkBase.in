"use client";

import { useState } from "react";
import { ArrowDown, ArrowUp, SlidersHorizontal, Trash2 } from "lucide-react";
import { TAB_ICONS } from "@/components/messages/ChannelTabBar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ChannelTabItem } from "@/lib/messaging/channel-tabs";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tabs: ChannelTabItem[];
  onSaveTabs: (nextTabs: ChannelTabItem[]) => void;
};

/** The same icon as in the tab bar. */
function getTabIcon(kind: ChannelTabItem["kind"]) {
  const Icon = TAB_ICONS[kind];
  return <Icon size={16} className="text-muted-foreground" />;
}

export function EditTabsDialog({ open, onOpenChange, tabs, onSaveTabs }: Props) {
  const [draftTabs, setDraftTabs] = useState<ChannelTabItem[]>(tabs);
  // Reset only when it opens: the parent passes a new `tabs` array on every render, and
  // resetting on that wiped whatever you were typing.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setDraftTabs(tabs);
  }

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

  // A blank name would leave a blank tab for everyone.
  const blankTitle = draftTabs.some((t) => t.shared && !t.title.trim());
  const handleSave = () => {
    if (blankTitle) return;
    onSaveTabs(draftTabs.map((t) => ({ ...t, title: t.title.trim() })));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[460px]">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="grid size-8 place-items-center rounded-md bg-muted text-muted-foreground">
              <SlidersHorizontal size={16} />
            </div>
            <DialogTitle>Edit tabs</DialogTitle>
          </div>
          <DialogDescription>
            Rename, reorder or remove Files, Tasks and channel links. Changes apply for everyone in the channel.
          </DialogDescription>
        </DialogHeader>

        <div className="max-h-[360px] overflow-y-auto py-2 space-y-2">
          {draftTabs.length === 0 ? (
            <p className="py-6 text-center text-[13px] text-muted-foreground">
              No shared tabs yet. Use + in the tab bar to add Files, Tasks or a link.
            </p>
          ) : (
            draftTabs.map((item, index) => (
              <div
                key={item.id}
                className="flex items-center gap-2 rounded-md border border-border bg-card p-2 text-[13px]"
              >
                <div className="grid size-7 flex-none place-items-center rounded-sm bg-muted">
                  {getTabIcon(item.kind)}
                </div>

                <div className="min-w-0 flex-1">
                  {item.shared ? (
                    <input
                      type="text"
                      value={item.title}
                      onChange={(e) => updateTitle(item.id, e.target.value.slice(0, 60))}
                      placeholder="Tab name"
                      aria-label={`Name of the ${item.kind === "link" ? "bookmark" : item.kind} tab`}
                      aria-invalid={!item.title.trim() || undefined}
                      className={`h-7 w-full rounded-md border bg-card px-2 text-[13px] outline-none focus:border-ring pointer-coarse:h-11 ${item.title.trim() ? "border-input" : "border-destructive"}`}
                    />
                  ) : (
                    <span className="font-medium">{item.title}</span>
                  )}
                  {item.url ? (
                    <p className="nb-meta truncate">{item.url}</p>
                  ) : null}
                </div>

                <div className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => moveUp(index)}
                    disabled={index === 0}
                    aria-label={`Move ${item.title} tab up`}
                    className="nb-icon-button size-7 disabled:opacity-50 pointer-coarse:size-11"
                  >
                    <ArrowUp size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveDown(index)}
                    disabled={index === draftTabs.length - 1}
                    aria-label={`Move ${item.title} tab down`}
                    className="nb-icon-button size-7 disabled:opacity-50 pointer-coarse:size-11"
                  >
                    <ArrowDown size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => removeTab(item.id)}
                    aria-label={`Remove ${item.title} tab`}
                    className="nb-icon-button size-7 text-destructive hover:bg-destructive/10 hover:text-destructive pointer-coarse:size-11"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>

        {blankTitle ? <p role="alert" className="text-[13px] text-destructive">Every tab needs a name.</p> : null}
        <DialogFooter paper>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="button" onClick={handleSave} disabled={blankTitle}>Save changes</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
