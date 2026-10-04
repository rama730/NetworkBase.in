"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { CanvasPreview } from "@/components/messages/CanvasEditor";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { CANVAS_TEMPLATES, type CanvasTemplate } from "@/lib/messaging/canvas-store";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectTemplate: (template: CanvasTemplate) => void;
  channelName?: string;
  projectName?: string | null;
};

export function CanvasTemplateModal({
  open,
  onOpenChange,
  onSelectTemplate,
  channelName = "general",
  projectName = null,
}: Props) {
  const [selectedId, setSelectedId] = useState<string>(CANVAS_TEMPLATES[0]!.id);
  const [searchQuery, setSearchQuery] = useState("");

  const filteredTemplates = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return CANVAS_TEMPLATES;
    return CANVAS_TEMPLATES.filter(
      (t) => t.name.toLowerCase().includes(q) || t.description.toLowerCase().includes(q),
    );
  }, [searchQuery]);

  const selectedTemplate = useMemo(() => {
    return (
      filteredTemplates.find((t) => t.id === selectedId) ||
      filteredTemplates[0] ||
      CANVAS_TEMPLATES[0]!
    );
  }, [filteredTemplates, selectedId]);

  const generatedDoc = useMemo(() => {
    if (!selectedTemplate) return { title: "", content: "" };
    return selectedTemplate.generate(channelName, projectName);
  }, [channelName, projectName, selectedTemplate]);

  const handleUseTemplate = () => {
    if (selectedTemplate) {
      onSelectTemplate(selectedTemplate);
      onOpenChange(false);
    }
  };

  const groups = (["Team", "Meetings", "Projects", "Operations"] as const)
    .map((category) => ({ category, items: filteredTemplates.filter((t) => t.category === category) }))
    .filter((group) => group.items.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="flex h-[600px] max-h-[88vh] w-[880px] max-w-[95vw] flex-col overflow-hidden rounded-xl border border-border p-0 shadow-xl sm:max-w-4xl">
        <DialogTitle className="sr-only">Canvas templates</DialogTitle>
        <div className="flex h-full min-h-0 flex-1 divide-x divide-border">
          <div className="flex min-h-0 w-60 shrink-0 flex-col bg-muted/20 sm:w-64">
            <div className="border-b border-border/70 p-3">
              <div className="relative">
                <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <input
                  type="text"
                  placeholder="Search all templates"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/60 focus:border-ring focus:ring-1 focus:ring-ring"
                />
              </div>
            </div>
            <div className="app-scroll app-scroll-y min-h-0 flex-1 space-y-3 p-2">
              {groups.map(({ category, items }) => (
                <div key={category}>
                  <p className="px-2.5 pb-1 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{category}</p>
                  {items.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setSelectedId(template.id)}
                      onDoubleClick={() => { onSelectTemplate(template); onOpenChange(false); }}
                      className={`block w-full truncate rounded-md px-3 py-2 text-left text-[13px] font-medium transition-colors ${
                        selectedTemplate?.id === template.id ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
                      }`}
                    >
                      {template.name}
                    </button>
                  ))}
                </div>
              ))}
              {groups.length === 0 ? (
                <p className="px-3 py-6 text-center text-[12px] text-muted-foreground">No templates match &ldquo;{searchQuery}&rdquo;</p>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
            <div className="flex flex-none items-start justify-between gap-4 border-b border-border px-6 py-3">
              <div className="min-w-0">
                <h3 className="truncate text-[14px] font-semibold text-foreground">{selectedTemplate?.name}</h3>
                <p className="truncate text-[12px] text-muted-foreground">{selectedTemplate?.description}</p>
              </div>
              <button type="button" onClick={() => onOpenChange(false)} aria-label="Close dialog" className="grid size-7 flex-none place-items-center rounded-[5px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">
                <X size={16} />
              </button>
            </div>
            <div className="app-scroll app-scroll-y min-h-0 flex-1 space-y-4 p-6 sm:p-8">
              <h1 className="text-[24px] font-bold tracking-tight text-foreground">{generatedDoc.title}</h1>
              <CanvasPreview markdown={generatedDoc.content} />
            </div>
            <div className="flex h-14 flex-none items-center justify-end gap-2 border-t border-border bg-card px-6">
              <button type="button" onClick={() => onOpenChange(false)} className="inline-flex h-9 items-center rounded-lg border border-border px-4 text-[13px] font-medium text-foreground hover:bg-muted">Cancel</button>
              <button type="button" onClick={handleUseTemplate} className="inline-flex h-9 items-center rounded-lg bg-primary px-5 text-[13px] font-semibold text-primary-foreground hover:bg-primary/90">Use template</button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
