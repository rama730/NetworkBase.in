"use client";

import { useFilesStore } from "@/stores/filesStore";
import { askConfirm } from "@/lib/ui/ask-confirm";

export const fileHasUnsavedEdits = (projectId: string) => Boolean(useFilesStore.getState().byProjectId[projectId]?.dirtyFileId);

/**
 * Cross-tab/router navigation cannot use a dialog owned by an unmounting preview, so it asks in the shared one
 * (report §32.3). `go` runs now when nothing is unsaved, or after Discard; Keep editing leaves everything as it was.
 */
export function confirmFileNavigation(projectId: string, go: () => void) {
  const dirty = useFilesStore.getState().byProjectId[projectId]?.dirtyFileId;
  if (!dirty) return go();
  void askConfirm({ title: "Discard unsaved file changes and leave this file?", confirmLabel: "Discard and leave", cancelLabel: "Keep editing", destructive: true }).then((ok) => {
    if (!ok) return;
    window.dispatchEvent(
      new CustomEvent("project:discard-file-edits", {
        detail: { projectId, nodeId: dirty },
      }),
    );
    useFilesStore.getState().setDirtyFile(projectId, dirty, false);
    go();
  });
}
