"use client";

import { toast, feedbackError } from "@/lib/feedback";
import { useCallback } from "react";
import type { ExplorerOperation } from "./explorerTypes";
import { getErrorMessage } from "./explorerTypes";

export function useExplorerOperationLog() {
  // Reuse notifications: the previous in-memory log had no rendered consumer.
  const recordOperation = useCallback((operation: Omit<ExplorerOperation, "id" | "at">) => {
    if (!operation.undo) return; // Other operations already report their outcome.
    let running = false;
    let completed = false;
    const undo = async () => {
      if (running || completed) return;
      running = true;
      const id = toast.loading("Undoing change…", { id: feedbackId });
      try {
        await operation.undo!.run();
        completed = true;
        toast.success("Change undone", { id });
      } catch (error) {
        toast.error("Couldn’t undo that change", {
          id, description: "Change still applies.", action: { label: "Retry undo", onClick: () => undo() },
        });
      } finally {
        running = false;
      }
    };
    const feedbackId = toast(operation.label, {
      duration: 10000,
      action: { label: operation.undo.label, onClick: () => undo() },
    });
  }, []);
  return { recordOperation };
}
