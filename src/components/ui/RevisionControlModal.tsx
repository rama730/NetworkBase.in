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
import { Button } from "@/components/ui/button";

export interface RevisionControlModalProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  fileName: string;
  /** Every save is a new version; versions are never overwritten (2026-11-11). */
  onSelectOption: (choice: { option: "commit"; comment?: string }) => void;
}

export function RevisionControlModal({
  isOpen,
  onOpenChange,
  fileName,
  onSelectOption,
}: RevisionControlModalProps): React.JSX.Element {
  const [comment, setComment] = React.useState("");

  const handleConfirm = () => {
    onSelectOption({ option: "commit", comment });
    onOpenChange(false);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onOpenChange}>
      <DialogContent size="confirm" className="bg-card p-6 rounded-[8px] border border-border shadow-xl">
        <DialogHeader className="mb-2">
          <DialogTitle className="text-sm font-semibold text-foreground">Save a new version</DialogTitle>
          <DialogDescription className="text-xs text-muted-foreground">
            <span className="font-mono text-foreground font-semibold">{fileName}</span> gets a new version. Earlier versions stay in its history, and any of them can be used again.
          </DialogDescription>
        </DialogHeader>

        <div className="my-3">
          <label htmlFor="commit-comment" className="block text-xs font-medium text-muted-foreground mb-1">
            What changed (optional)
          </label>
          <textarea
            id="commit-comment"
            rows={2}
            maxLength={200}
            placeholder="E.g., Updated the install steps"
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            className="w-full text-xs p-2 rounded-[6px] border border-border bg-muted/50 text-foreground focus:outline-none resize-none"
          />
        </div>

        <DialogFooter className="mt-4 flex justify-end gap-2 shrink-0">
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} className="text-xs text-muted-foreground hover:bg-muted">
            Cancel
          </Button>
          <Button type="button" onClick={handleConfirm} className="text-xs font-semibold px-4 py-2 text-white bg-[#D14E24] hover:bg-[#B23F1C]">
            Save version
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
