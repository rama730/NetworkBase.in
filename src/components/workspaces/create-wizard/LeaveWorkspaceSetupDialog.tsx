"use client";

import { AlertTriangle, Save, X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

type LeaveProjectSetupDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onLeave: () => void;
};

/** A deliberate, task-specific exit decision for the project-creation flow. */
export default function LeaveWorkspaceSetupDialog({ open, onOpenChange, onLeave }: LeaveProjectSetupDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="confirm"
        showCloseButton={false}
        aria-describedby="leave-project-setup-description"
        className="w-[calc(100vw-2rem)] gap-0 overflow-hidden rounded-xl border border-border bg-card p-0 shadow-[0_24px_70px_rgba(23,27,30,0.18)]"
      >
        <DialogHeader className="px-5 pb-5 pt-5 text-left sm:px-6 sm:pb-6 sm:pt-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-3">
              <div className="flex size-9 shrink-0 items-center justify-center rounded-md border border-destructive/25 bg-destructive/10 text-destructive">
                <AlertTriangle className="size-4" aria-hidden="true" />
              </div>
              <div className="min-w-0">
                <p className="nb-meta font-mono text-[11px] font-medium uppercase tracking-[0.14em] text-muted-foreground">
                  Unsaved changes
                </p>
                <DialogTitle className="mt-1 text-[19px] tracking-[-0.02em] text-foreground">
                  Leave workspace setup?
                </DialogTitle>
              </div>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              onClick={() => onOpenChange(false)}
              aria-label="Keep editing"
              className="-mr-1 -mt-1 text-muted-foreground"
            >
              <X className="size-4" aria-hidden="true" />
            </Button>
          </div>
          <DialogDescription id="leave-project-setup-description" className="mt-4 max-w-[37ch] text-[14px] leading-6 text-muted-foreground">
            What you entered is kept on this device as a draft, so you can pick it up later. Keep editing, or leave.
          </DialogDescription>
        </DialogHeader>

        <div className="mx-5 flex items-center gap-2 border-t border-border py-3 text-[12px] leading-5 text-muted-foreground sm:mx-6">
          <Save className="size-3.5 shrink-0" aria-hidden="true" />
          Saved drafts can be resumed from the same workspace-creation flow.
        </div>

        <DialogFooter className="border-t border-border bg-secondary/35 px-5 py-4 sm:px-6 sm:py-4">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} autoFocus>
            Keep editing
          </Button>
          <Button type="button" variant="destructive" onClick={onLeave}>
            Leave setup
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
