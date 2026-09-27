// Task 3.2 — `MultiAttachmentPicker` wrapper.
//
// Wraps V3AttachmentPicker with a confirm/cancel flow for multi-file
// selection. Used in `CreateTaskModal` for attaching files during task
// creation.
//
// Requirements: 6.5
//
// Fix: Cancel/Confirm buttons are now rendered INSIDE the picker modal
// (as a footer), not as a separate fixed-position element floating at
// the bottom-right of the viewport.

"use client";

import React, { useCallback, useEffect, useState } from "react";

import type { ProjectNode } from "@/lib/db/schema";

import { V3AttachmentPicker } from "./V3AttachmentPicker";

// ─── Public API ──────────────────────────────────────────────────────

export interface MultiAttachmentPickerProps {
  projectId: string;
  projectName?: string;
  isOpen: boolean;
  onClose: () => void;
  initialAttachments: ProjectNode[];
  onConfirm: (nodes: ProjectNode[]) => void;
}

// ─── Component ───────────────────────────────────────────────────────

/**
 * Multi-file attachment picker with explicit confirm/cancel semantics.
 *
 * Renders the V3AttachmentPicker and tracks selection changes internally.
 * Selection is only committed when the user clicks "Confirm". Closing
 * via the X button or backdrop click discards uncommitted changes.
 */
export function MultiAttachmentPicker({
  projectId,
  projectName,
  isOpen,
  onClose,
  initialAttachments,
  onConfirm,
}: MultiAttachmentPickerProps): React.JSX.Element | null {
  // Track the current selection internally so we can commit only on confirm
  const [pendingSelection, setPendingSelection] =
    useState<ProjectNode[]>(initialAttachments);

  // Sync when picker opens with new initialAttachments
  useEffect(() => {
    if (isOpen) {
      setPendingSelection(initialAttachments);
    }
  }, [isOpen, initialAttachments]);

  const handleSelectionChange = useCallback((nodes: ProjectNode[]) => {
    setPendingSelection(nodes);
  }, []);

  const handleConfirm = useCallback(() => {
    onConfirm(pendingSelection);
    onClose();
  }, [onConfirm, onClose, pendingSelection]);

  // Close without committing (cancel)
  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  // Keyboard: Cmd/Ctrl+Enter to confirm when picker is open
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleConfirm();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, handleConfirm]);

  if (!isOpen) return null;

  return (
    <V3AttachmentPicker
      projectId={projectId}
      projectName={projectName}
      isOpen={true}
      onClose={handleCancel}
      initialSelection={initialAttachments}
      onSelectionChange={handleSelectionChange}
      footer={
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            data-testid="multi-attachment-picker-cancel"
            className="rounded-[5px] border border-border px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            data-testid="multi-attachment-picker-confirm"
            className="rounded-[5px] bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-[background-color,color] duration-150 ease-in-out hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)]"
          >
            Confirm{pendingSelection.length > 0 ? ` (${pendingSelection.length})` : ""}
          </button>
        </div>
      }
    />
  );
}

export default MultiAttachmentPicker;
