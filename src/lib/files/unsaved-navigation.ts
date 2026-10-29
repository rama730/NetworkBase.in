"use client";

import { useFilesStore } from "@/stores/filesStore";

/** Cross-tab/router navigation cannot use a dialog owned by an unmounting preview. */
export function confirmFileNavigation(projectId: string): boolean {
  const state = useFilesStore.getState();
  const dirty = state.byProjectId[projectId]?.dirtyFileId;
  if (!dirty) return true;
  if (!window.confirm("Discard unsaved file changes and leave this file?"))
    return false;
  window.dispatchEvent(
    new CustomEvent("project:discard-file-edits", {
      detail: { projectId, nodeId: dirty },
    }),
  );
  state.setDirtyFile(projectId, dirty, false);
  return true;
}
