"use client";

import { useEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  children?: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "default" | "destructive";
  onConfirm: () => void | Promise<void>;
  /** The cancel button only (not Esc or a click outside), when it means more than closing. */
  onCancel?: () => void;
  onError?: (error: unknown) => void;
  loading?: boolean;
  pendingLabel?: string;
  errorMessage?: string;
  autoCloseOnConfirm?: boolean;
  size?: "short" | "wide";
  showCloseButton?: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  contentClassName?: string;
  overlayClassName?: string;
}

export function ConfirmDialog({
  onCancel,
  open,
  onOpenChange,
  title,
  description,
  children,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
  onConfirm,
  onError,
  loading = false,
  pendingLabel,
  errorMessage,
  autoCloseOnConfirm = true,
  size = "short",
  showCloseButton = false,
  returnFocusRef,
  contentClassName,
  overlayClassName,
}: ConfirmDialogProps) {
  const cancelButtonRef = useRef<HTMLButtonElement>(null);
  const [internalLoading, setInternalLoading] = useState(false);
  const [internalError, setInternalError] = useState<string | null>(null);
  const busy = loading || internalLoading;

  useEffect(() => {
    if (!open) {
      setInternalError(null);
      setInternalLoading(false);
    }
  }, [open]);

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && busy) return;
    onOpenChange(nextOpen);
  };

  const handleConfirm = async () => {
    if (busy) return;
    setInternalError(null);
    setInternalLoading(true);

    try {
      await onConfirm();
      if (autoCloseOnConfirm) {
        onOpenChange(false);
      }
    } catch (error) {
      setInternalError(
        errorMessage
          ?? (error instanceof Error && error.message.trim()
            ? error.message
            : "Couldn’t complete this action. Try again."),
      );
      onError?.(error);
    } finally {
      setInternalLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent
        role="alertdialog"
        data-confirm-dialog=""
        showCloseButton={showCloseButton}
        overlayClassName={overlayClassName}
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          cancelButtonRef.current?.focus();
        }}
        onCloseAutoFocus={(event) => {
          if (!returnFocusRef?.current) return;
          event.preventDefault();
          returnFocusRef.current.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (busy) event.preventDefault();
        }}
        onPointerDownOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (busy) event.preventDefault();
        }}
        className={cn(
          "flex max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[86dvh]",
          size === "wide" ? "sm:max-w-2xl" : "sm:max-w-[460px]",
          contentClassName,
        )}
      >
        <DialogHeader
          className={cn(
            "shrink-0 px-6 pt-6",
            children || internalError ? "pb-4" : "pb-6",
            showCloseButton && "pr-14",
          )}
        >
          <DialogTitle className="text-[20px] leading-[1.28] font-semibold tracking-[-0.01em]">
            {title}
          </DialogTitle>
          {description && (
            <DialogDescription className="max-w-[64ch] text-[15px] leading-[1.5]">
              {description}
            </DialogDescription>
          )}
        </DialogHeader>
        {children || internalError ? (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-6 pb-6">
            {children}
            {internalError ? (
              <p
                role="alert"
                className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-[13px] leading-[1.5] text-destructive"
              >
                {internalError}
              </p>
            ) : null}
          </div>
        ) : null}
        <DialogFooter className="shrink-0 flex-col gap-2 border-t bg-muted px-6 py-4 sm:flex-row sm:gap-2">
          <Button
            ref={cancelButtonRef}
            type="button"
            variant="outline"
            className="w-full sm:w-auto"
            onClick={() => { if (busy) return; onCancel?.(); handleOpenChange(false); }}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={variant === "destructive" ? "destructive" : "default"}
            className="w-full sm:min-w-[96px] sm:w-auto"
            onClick={() => void handleConfirm()}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? <Loader2 className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" /> : null}
            {busy ? (pendingLabel ?? confirmLabel) : confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
