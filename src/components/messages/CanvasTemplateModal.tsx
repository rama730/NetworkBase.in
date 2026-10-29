"use client";

import { useMemo, useState } from "react";
import { Search, X } from "lucide-react";
import { CanvasPreview } from "@/components/messages/CanvasEditor";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  const groups = (["Team", "Meetings", "Planning", "Operations"] as const)
    .map((category) => ({ category, items: filteredTemplates.filter((t) => t.category === category) }))
    .filter((group) => group.items.length);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} className="flex h-[600px] max-h-[88vh] w-[880px] max-w-[95vw] flex-col overflow-hidden border border-border p-0 sm:max-w-4xl">
        <DialogTitle className="sr-only">Canvas templates</DialogTitle>
        {/* Phones: the list on top, the preview below. */}
        <div className="flex h-full min-h-0 flex-1 flex-col divide-y divide-border sm:flex-row sm:divide-x sm:divide-y-0">
          <div className="flex max-h-[40%] min-h-0 shrink-0 flex-col bg-muted sm:max-h-none sm:w-64">
            <div className="border-b border-border p-3">
              <div className="relative">
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search all templates"
                  aria-label="Search templates"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 text-[13px]"
                />
              </div>
            </div>
            <div className="app-scroll app-scroll-y min-h-0 flex-1 space-y-3 p-2">
              {groups.map(({ category, items }) => (
                <div key={category}>
                  <p className="nb-micro px-2.5 pb-1 pt-1.5">{category}</p>
                  {items.map((template) => (
                    <button
                      key={template.id}
                      type="button"
                      onClick={() => setSelectedId(template.id)}
                      onDoubleClick={() => { onSelectTemplate(template); onOpenChange(false); }}
                      aria-pressed={selectedTemplate?.id === template.id}
                      // Selected = the paper well, never a clay fill (spec).
                      className={`block w-full truncate rounded-md px-3 py-2 text-left text-[13px] font-medium text-foreground transition-colors duration-[130ms] pointer-coarse:min-h-11 ${
                        selectedTemplate?.id === template.id ? "bg-card shadow-xs" : "hover:bg-card"
                      }`}
                    >
                      {template.name}
                    </button>
                  ))}
                </div>
              ))}
              {groups.length === 0 ? (
                <p className="px-3 py-6 text-center text-[13px] text-muted-foreground">No templates match &ldquo;{searchQuery}&rdquo;</p>
              ) : null}
            </div>
          </div>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col bg-background">
            <div className="flex flex-none items-start justify-between gap-4 border-b border-border px-6 py-3">
              <div className="min-w-0">
                <h3 className="nb-ui-label truncate text-foreground">{selectedTemplate?.name}</h3>
                <p className="truncate text-[13px] text-muted-foreground">{selectedTemplate?.description}</p>
              </div>
              <button type="button" onClick={() => onOpenChange(false)} aria-label="Close dialog" className="nb-icon-button nb-touch-target size-8 flex-none">
                <X size={16} />
              </button>
            </div>
            <div className="app-scroll app-scroll-y min-h-0 flex-1 space-y-4 p-6 sm:p-8">
              <h1 className="nb-section-title text-foreground">{generatedDoc.title}</h1>
              <CanvasPreview markdown={generatedDoc.content} />
            </div>
            <div className="flex h-14 flex-none items-center justify-end gap-2 border-t border-border bg-muted px-6">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="button" onClick={handleUseTemplate}>Use template</Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
