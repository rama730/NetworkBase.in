"use client";

import { create } from "zustand";
import { persist } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";
import type { WorkspaceFilesState, FilesStoreState } from "./types";
import {
  defaultFilesState,
  FALLBACK_FILES_STATE,
  ROOT_KEY,
  parentKey,
} from "./types";
import { createExplorerSlice } from "./explorerSlice";
import { createNavigationSlice } from "./navigationSlice";
import { createEditorSlice } from "./editorSlice";
import { createGitSlice } from "./gitSlice";


export const useFilesStore = create<FilesStoreState>()(
  persist(
    (set, get, api) => ({
      byProjectId: {},

      _get: (projectId) => get().byProjectId[projectId] ?? FALLBACK_FILES_STATE,

      ensureProjectFilesState: (projectId) =>
        set((state) => {
          if (state.byProjectId[projectId]) return state;
          return {
            byProjectId: {
              ...state.byProjectId,
              [projectId]: defaultFilesState(),
            },
          };
        }),

      ...createExplorerSlice(set, get, api),
      ...createNavigationSlice(set, get, api),
      ...createEditorSlice(set, get, api),
      ...createGitSlice(set, get, api),
    }),
    {
      name: "files-workspace-v3",
      partialize: (state) => ({
        byProjectId: Object.fromEntries(
          Object.entries(state.byProjectId).map(([projectId, ws]: [string, WorkspaceFilesState]) => [
            projectId,
            // Files tab v3 persist shape (Req 15.19, Req 21.7; design § Migration Note).
            // Persist ONLY the fields listed below. Any legacy key from a
            // `files-workspace-v2` blob is ignored by the updated merge function,
            // which overlays the persisted partial onto a fresh `defaultFilesState()`.
            {
              currentLocationId: ws.currentLocationId,
              expandedFolderIds: ws.expandedFolderIds,
              favorites: ws.favorites,
              recents: ws.recents,
              sort: ws.sort,
              foldersFirst: ws.foldersFirst,
              ui: {
                sidebarCollapsed: ws.ui.sidebarCollapsed,
                quickOpenOpen: ws.ui.quickOpenOpen,
              },
            } as Partial<WorkspaceFilesState>,
          ])
        ),
      }),
      merge: (persistedState: unknown, currentState) => {
        if (
          !persistedState ||
          typeof persistedState !== "object" ||
          !("byProjectId" in persistedState)
        ) {
          return currentState;
        }

        const persisted = persistedState as { byProjectId?: Record<string, Partial<WorkspaceFilesState>> };
        if (!persisted.byProjectId) return currentState;

        const mergedByProjectId: Record<string, WorkspaceFilesState> = { ...currentState.byProjectId };

        for (const [projectId, persistedProjectState] of Object.entries(persisted.byProjectId)) {
          const fresh = defaultFilesState();
          const partial = (persistedProjectState ?? {}) as Partial<WorkspaceFilesState> & {
            ui?: Partial<WorkspaceFilesState["ui"]>;
          };
          // Merge `ui` separately so we only accept the two persisted ui keys
          // and keep every other default ui value untouched.
          const mergedUi = partial.ui
            ? {
                ...fresh.ui,
                sidebarCollapsed:
                  typeof partial.ui.sidebarCollapsed === "boolean"
                    ? partial.ui.sidebarCollapsed
                    : fresh.ui.sidebarCollapsed,
                quickOpenOpen:
                  typeof partial.ui.quickOpenOpen === "boolean"
                    ? partial.ui.quickOpenOpen
                    : fresh.ui.quickOpenOpen,
              }
            : fresh.ui;
          mergedByProjectId[projectId] = {
            ...fresh,
            ...partial,
            ui: mergedUi,
          };
        }

        return {
          ...currentState,
          byProjectId: mergedByProjectId,
        };
      },
      storage: {
        getItem: (name) => {
          if (typeof window === "undefined") return null;
          try {
            const raw = window.localStorage.getItem(name);
            return raw ? JSON.parse(raw) : null;
          } catch {
            return null;
          }
        },
        setItem: (name, value) => {
          if (typeof window !== "undefined") {
            try {
              window.localStorage.setItem(name, JSON.stringify(value));
            } catch {}
          }
        },
        removeItem: (name) => {
          if (typeof window !== "undefined") {
            try {
              window.localStorage.removeItem(name);
            } catch {}
          }
        },
      },
    }
  )
);

export const FILES_ROOT_KEY = ROOT_KEY;
export const filesParentKey = parentKey;

export const useFilesActions = () =>
  useFilesStore(
    useShallow((s) => ({
      upsertNodes: s.upsertNodes,
      setChildren: s.setChildren,
      markChildrenLoaded: s.markChildrenLoaded,
      toggleExpanded: s.toggleExpanded,
      setSelectedNode: s.setSelectedNode,
    }))
  );

export function useFilesWorkspaceSlice(projectId: string) {
  return useFilesStore((s) => s.byProjectId[projectId]);
}

export type {
  ExplorerSort,
  ExplorerMode,
  FilesViewMode,
  SavedExplorerView,
  EditorPreferences,
  EditorTab,
  EditorPane,
  SoftLock,
  NodeEventSummary,
  FileState,
  EditorSymbol,
  WorkspaceFilesState,
  FilesStoreState,
  GitState,
  UiState,
} from "./types";

export {
  defaultFilesState,
  symbolsEqual,
  FALLBACK_FILES_STATE,
  DEFAULT_PREFS,
  DEFAULT_GIT_STATE,
  DEFAULT_UI_STATE,
  ROOT_KEY,
  parentKey,
} from "./types";

export {
  contentKey,
  getFileContent,
  setFileContent,
  deleteFileContent,
  clearWorkspaceContent,
  contentMapSize,
} from "./contentMap";
