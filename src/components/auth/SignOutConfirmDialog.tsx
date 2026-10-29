"use client";

import type { RefObject } from "react";

import { ConfirmDialog } from "@/components/ui/ConfirmDialog";

interface SignOutConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void | Promise<void>;
  returnFocusRef?: RefObject<HTMLElement | null>;
}

export function SignOutConfirmDialog({
  open,
  onOpenChange,
  onConfirm,
  returnFocusRef,
}: SignOutConfirmDialogProps) {
  return (
    <ConfirmDialog
      open={open}
      onOpenChange={onOpenChange}
      title="Sign out on this device?"
      description="You’ll need to sign in again to use NetworkBase on this device. Any unsaved offline changes or drafts may be lost."
      confirmLabel="Sign out"
      pendingLabel="Signing out…"
      errorMessage="Failed to sign out. Try again."
      variant="destructive"
      returnFocusRef={returnFocusRef}
      onConfirm={onConfirm}
    />
  );
}
