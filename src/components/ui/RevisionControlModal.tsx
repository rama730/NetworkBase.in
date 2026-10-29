"use client";

import * as React from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Edit, FileText } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface RevisionControlModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  onSelectOption: (choice: { option: "overwrite" | "commit"; comment?: string }) => void;
}

export function RevisionControlModal({
  isOpen,
  onOpenChange,
  fileName,
  onSelectOption,
}: RevisionControlModalProps): React.JSX.Element {
  const [selected, setSelected] = React.useState<"overwrite" | "commit">("commit");
  const [comment, setComment] = React.useState("");

  const handleConfirm = () => {
    onSelectOption({ option: selected, comment: selected === "commit" ? comment : undefined });
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md bg-card p-6 rounded-[8px] border border-border shadow-xl">
        <DialogHeader className="mb-4">
          <DialogTitle className="text-sm font-semibold uppercase tracking-wider text-muted-foreground">
            Confirm Changes Application
          </DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            Choose how modifications to <span className="font-mono text-foreground font-semibold">{fileName}</span> should be saved.
          </DialogDescription>
        </DialogHeader>

        {/* Options grid */}
        <div role="radiogroup" aria-label="How to save this revision" className="flex flex-col gap-3 my-4">
          {/* Commit as New Revision */}
          <label
            className={`flex items-start gap-3 p-3 rounded-[6px] border cursor-pointer transition-[color,background-color,border-color,box-shadow,opacity,transform] focus-within:bg-muted/30 ${
              selected === "commit"
                ? "border-[#D14E24] bg-[#FCF0EA]/40 dark:bg-[#D14E24]/10"
                : "border-border hover:border-border/80"
            }`}
          >
            <input type="radio" name="file-revision-mode" value="commit" checked={selected === "commit"} onChange={() => setSelected("commit")} className="sr-only" aria-label="Commit as New Revision" />
            <div className={`p-1.5 rounded-[6px] ${selected === "commit" ? "bg-[#FCF0EA] dark:bg-[#D14E24]/20" : "bg-muted"}`}>
              <FileText className={`h-4 w-4 ${selected === "commit" ? "text-[#D14E24]" : "text-muted-foreground"}`} />
            </div>
            <div className="flex-1">
              <h4 className="text-xs font-semibold text-foreground">Commit as New Revision</h4>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Creates an incremental version log. Safe for tracking milestones and history.
              </p>
            </div>
          </label>

          {/* Overwrite Active Revision */}
          <label
            className={`flex items-start gap-3 p-3 rounded-[6px] border cursor-pointer transition-[color,background-color,border-color,box-shadow,opacity,transform] focus-within:bg-muted/30 ${
              selected === "overwrite"
                ? "border-amber-500/50 bg-amber-50/40 dark:bg-amber-950/20"
                : "border-border hover:border-border/80"
            }`}
          >
            <input type="radio" name="file-revision-mode" value="overwrite" checked={selected === "overwrite"} onChange={() => setSelected("overwrite")} className="sr-only" aria-label="Apply to Active Revision" />
            <div className={`p-1.5 rounded-[6px] ${selected === "overwrite" ? "bg-amber-100 dark:bg-amber-950" : "bg-muted"}`}>
              <Edit className={`h-4 w-4 ${selected === "overwrite" ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"}`} />
            </div>
            <div className="flex-1">
              <h4 className="text-xs font-semibold text-foreground">Apply to Active Revision</h4>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Replaces the contents of this version without preserving its previous contents. Use a new revision to keep that history.
              </p>
            </div>
          </label>
        </div>

        {/* Optional Comment for Commit */}
        {selected === "commit" && (
          <div className="my-3">
            <label htmlFor="commit-comment" className="block text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
              Changelog Comment (Optional)
            </label>
            <textarea
              id="commit-comment"
              rows={2}
              maxLength={200}
              placeholder="E.g., Updated section 4 layout improvements…"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              className="w-full text-xs p-2 rounded-[6px] border border-border bg-muted/50 text-foreground focus:outline-none resize-none"
            />
          </div>
        )}

        <DialogFooter className="mt-6 flex justify-end gap-2 shrink-0">
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            className="text-xs text-muted-foreground hover:bg-muted"
          >
            Cancel
          </Button>
          <Button
            type="button"
            onClick={handleConfirm}
            className={`text-xs font-semibold px-4 py-2 text-white ${
              selected === "commit"
                ? "bg-[#D14E24] hover:bg-[#B23F1C]"
                : "bg-amber-600 hover:bg-amber-700"
            }`}
          >
            Confirm
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
