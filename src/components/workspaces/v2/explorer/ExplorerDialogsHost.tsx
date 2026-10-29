"use client";

import React, { useEffect, useState } from "react";
import {
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  Loader2,
  Plus,
  Search,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { WorkspaceNode } from "@/lib/db/schema";
import { getWorkspaceNodes } from "@/app/actions/files/nodes";
import { createFolder } from "@/app/actions/files/mutations";
import { readOrgFileUsageAction } from "@/app/actions/org-files";
import { isInternalTaskWorkingFilesNode } from "@/lib/files/task-working-files";
import { useFilesStore } from "@/stores/filesStore";

// --- FolderPicker (standalone sub-component) ---

export function FolderPicker({
  projectId,
  selectedFolderId,
  onSelectFolder,
  sourceNodes = [],
  canCreateFolder = false,
  allowTaskWorkingFiles = false,
  className,
}: {
  projectId: string;
  selectedFolderId: string | null;
  onSelectFolder: (folderId: string | null) => void;
  sourceNodes?: WorkspaceNode[];
  canCreateFolder?: boolean;
  allowTaskWorkingFiles?: boolean;
  className?: string;
}) {
  type FolderPage = {
    nodes: WorkspaceNode[];
    nextCursor: string | null;
    loading: boolean;
    error: string | null;
  };
  const [pages, setPages] = useState<Record<string, FolderPage>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<WorkspaceNode[]>([]);
  const [searchNextCursor, setSearchNextCursor] = useState<string | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const keyFor = (parentId: string | null) => parentId ?? "__root__";
  const eligibleFolders = (nodes: WorkspaceNode[]) =>
    nodes.filter(
      (node) =>
        node.type === "folder" && !isInternalTaskWorkingFilesNode(node),
    );

  const loadPage = async (
    parentId: string | null,
    cursor?: string | null,
    append = false,
  ) => {
    const key = keyFor(parentId);
    setPages((current) => ({
      ...current,
      [key]: {
        nodes: append ? current[key]?.nodes ?? [] : [],
        nextCursor: current[key]?.nextCursor ?? null,
        loading: true,
        error: null,
      },
    }));
    try {
      const result = await getWorkspaceNodes(
        projectId,
        parentId,
        undefined,
        100,
        cursor ?? undefined,
        { itemType: "folder" },
      );
      setPages((current) => ({
        ...current,
        [key]: {
          nodes: append
            ? [...(current[key]?.nodes ?? []), ...eligibleFolders(result.nodes)]
            : eligibleFolders(result.nodes),
          nextCursor: result.nextCursor,
          loading: false,
          error: null,
        },
      }));
    } catch (error) {
      setPages((current) => ({
        ...current,
        [key]: {
          nodes: current[key]?.nodes ?? [],
          nextCursor: current[key]?.nextCursor ?? null,
          loading: false,
          error:
            error instanceof Error ? error.message : "Couldn’t load folders",
        },
      }));
    }
  };

  useEffect(() => {
    setPages({});
    const initialExpanded: Record<string, boolean> = {};
    if (selectedFolderId) {
      const nodesById =
        useFilesStore.getState().byProjectId[projectId]?.nodesById ??
        {};
      const visited = new Set<string>();
      let curr = nodesById[selectedFolderId];
      while (curr?.parentId && !visited.has(curr.parentId)) {
        visited.add(curr.parentId);
        initialExpanded[curr.parentId] = true;
        curr = nodesById[curr.parentId];
      }
    }
    setExpanded(initialExpanded);
    setQuery("");
    void loadPage(null);
    Object.keys(initialExpanded).forEach((ancestorId) => {
      void loadPage(ancestorId);
    });
    // loadPage is intentionally reset with the project identity and target.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, selectedFolderId]);

  useEffect(() => {
    const normalized = query.trim();
    if (normalized.length < 2) {
      setSearchResults([]);
      setSearchNextCursor(null);
      setSearchError(null);
      setSearching(false);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      setSearching(true);
      setSearchError(null);
      void getWorkspaceNodes(projectId, null, normalized, 100, undefined, { itemType: "folder" })
        .then((result) => {
          if (!cancelled) {
            setSearchResults(eligibleFolders(result.nodes));
            setSearchNextCursor(result.nextCursor);
          }
        })
        .catch((error) => {
          if (!cancelled)
            setSearchError(
              error instanceof Error ? error.message : "Search failed",
            );
        })
        .finally(() => {
          if (!cancelled) setSearching(false);
        });
    }, 250);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [projectId, query]);

  const disabledReason = (node: WorkspaceNode | null) => {
    if (!allowTaskWorkingFiles && sourceNodes.some((source) => source.taskId))
      return "Publish task draft files before relocating them";
    if (node && sourceNodes.some((source) => source.id === node.id))
      return "An item cannot be moved into itself";
    if (
      node &&
      sourceNodes.some(
        (source) =>
          source.type === "folder" && node.path.startsWith(`${source.path}/`),
      )
    )
      return "A folder cannot be moved into its descendant";
    const targetId = node?.id ?? null;
    if (
      sourceNodes.length > 0 &&
      sourceNodes.every((source) => (source.parentId ?? null) === targetId)
    )
      return "Items are already in this location";
    return null;
  };

  const loadMoreSearchResults = async () => {
    if (!searchNextCursor || searching) return;
    setSearching(true);
    try {
      const result = await getWorkspaceNodes(
        projectId,
        null,
        query.trim(),
        100,
        searchNextCursor,
        { itemType: "folder" },
      );
      setSearchResults((current) => [
        ...current,
        ...eligibleFolders(result.nodes),
      ]);
      setSearchNextCursor(result.nextCursor);
    } catch (error) {
      setSearchError(error instanceof Error ? error.message : "Search failed");
    } finally {
      setSearching(false);
    }
  };

  const toggle = async (node: WorkspaceNode) => {
    const isOpen = !!expanded[node.id];
    if (isOpen) {
      setExpanded((p) => ({ ...p, [node.id]: false }));
      return;
    }
    setExpanded((p) => ({ ...p, [node.id]: true }));
    if (pages[keyFor(node.id)]) return;
    await loadPage(node.id);
  };

  const focusSibling = (event: React.KeyboardEvent, offset: number) => {
    const tree = event.currentTarget.closest('[role="tree"]');
    const items = Array.from(
      tree?.querySelectorAll<HTMLElement>('[data-folder-tree-item="true"]') ??
        [],
    );
    const index = items.indexOf(event.currentTarget as HTMLElement);
    items[index + offset]?.focus();
  };

  const renderNode = (
    node: WorkspaceNode,
    level: number,
    position = 1,
    setSize = 1,
  ) => {
    const isOpen = !!expanded[node.id];
    const isSelected = selectedFolderId === node.id;
    const page = pages[keyFor(node.id)];
    const reason = disabledReason(node);
    return (
      <div key={node.id}>
        <div
          className={cn(
            "flex items-center gap-1 rounded-[3px]",
            isSelected && "bg-[#F3F0EA] dark:bg-white/10 font-medium",
            reason && "opacity-55",
          )}
          style={{ paddingLeft: `${level * 14 + 8}px` }}
        >
          <button
            type="button"
            className="nb-touch-target inline-flex h-8 w-5 items-center justify-center text-[#4C5A61]"
            onClick={() => void toggle(node)}
            aria-label={isOpen ? "Collapse" : "Expand"}
          >
            {isOpen ? (
              <ChevronDown className="w-4 h-4" />
            ) : (
              <ChevronRight className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            role="treeitem"
            data-folder-tree-item="true"
            aria-level={level + 1}
            aria-posinset={position}
            aria-setsize={setSize}
            aria-expanded={isOpen}
            aria-selected={isSelected}
            aria-disabled={Boolean(reason)}
            title={reason ?? node.path}
            onClick={() => !reason && onSelectFolder(node.id)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault();
                focusSibling(event, 1);
              } else if (event.key === "ArrowUp") {
                event.preventDefault();
                focusSibling(event, -1);
              } else if (event.key === "ArrowRight" && !isOpen) {
                event.preventDefault();
                void toggle(node);
              } else if (event.key === "ArrowLeft" && isOpen) {
                event.preventDefault();
                void toggle(node);
              }
            }}
            className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pr-2 text-left text-sm"
          >
            {isOpen ? (
              <FolderOpen className="h-4 w-4 shrink-0 text-[#D14E24]" />
            ) : (
              <Folder className="h-4 w-4 shrink-0 text-[#D14E24]" />
            )}
            <span className="truncate">{node.name}</span>
            {isSelected ? (
              <Check className="ml-auto h-4 w-4 shrink-0 text-[#D14E24]" />
            ) : null}
          </button>
        </div>
        {isOpen ? (
          page?.loading && page.nodes.length === 0 ? (
            <div
              className="px-2 py-1.5 text-xs text-zinc-500"
              style={{ paddingLeft: `${(level + 1) * 14 + 8}px` }}
            >
              <Loader2 className="w-3.5 h-3.5 animate-spin inline-block mr-2" />
              Loading…
            </div>
          ) : page?.error ? (
            <button
              type="button"
              onClick={() => void loadPage(node.id)}
              className="flex items-center gap-2 py-1.5 text-xs text-rose-600"
              style={{ paddingLeft: `${(level + 1) * 14 + 8}px` }}
            >
              <AlertCircle className="h-3.5 w-3.5" /> {page.error}. Retry
            </button>
          ) : (
            <>
              {(page?.nodes ?? []).map((child, index, siblings) =>
                renderNode(child, level + 1, index + 1, siblings.length),
              )}
              {page?.nextCursor ? (
                <button
                  type="button"
                  disabled={page.loading}
                  onClick={() =>
                    void loadPage(node.id, page.nextCursor, true)
                  }
                  className="py-1.5 text-xs text-[#D14E24] hover:underline disabled:opacity-50"
                  style={{ marginLeft: `${(level + 1) * 14 + 8}px` }}
                >
                  {page.loading ? "Loading…" : "Load more folders"}
                </button>
              ) : null}
            </>
          )
        ) : null}
      </div>
    );
  };

  const allLoadedNodes = Object.values(pages).flatMap((page) => page.nodes);
  const selectedNode =
    allLoadedNodes.find((node) => node.id === selectedFolderId) ??
    searchResults.find((node) => node.id === selectedFolderId);
  const rootPage = pages[keyFor(null)];
  const rootReason = disabledReason(null);

  const createSelectedFolder = async () => {
    const name = newFolderName.trim();
    if (!name || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createFolder(projectId, selectedFolderId, name);
      setNewFolderName("");
      await loadPage(selectedFolderId);
      onSelectFolder(created.id);
    } catch (error) {
      setCreateError(error instanceof Error ? error.message : "Couldn’t create folder");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      className={cn(
        "flex max-h-[32rem] min-h-64 flex-col overflow-hidden rounded-[8px] border border-[#DBD5C8] dark:border-zinc-800",
        className,
      )}
    >
      <div className="border-b border-[#DBD5C8] p-2 dark:border-zinc-800">
        <label className="relative block">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-[#4C5A61]/70" />
          <Input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search workspace folders"
            aria-label="Search workspace folders"
            className="pl-8 rounded-[5px] border-[#DBD5C8] focus-visible:ring-[#D14E24]"
          />
        </label>
      </div>
      <div
        role="tree"
        aria-label="Destination folders"
        className="min-h-0 flex-1 overflow-auto py-1"
      >
        {query.trim().length >= 2 ? (
          searching ? (
            <div className="flex items-center gap-2 p-3 text-sm text-zinc-500">
              <Loader2 className="h-4 w-4 animate-spin" /> Searching…
            </div>
          ) : searchError ? (
            <div className="p-3 text-sm text-rose-600">{searchError}</div>
          ) : searchResults.length ? (
            <>
              {searchResults.map((node, index) =>
                renderNode(node, 0, index + 1, searchResults.length)
              )}
              {searchNextCursor ? (
                <button type="button" onClick={() => void loadMoreSearchResults()} className="mx-3 my-2 text-xs text-[#D14E24] hover:underline">
                  Load more matches
                </button>
              ) : null}
            </>
          ) : (
            <div className="p-3 text-sm text-zinc-500">
              No eligible folders found.
            </div>
          )
        ) : (
          <>
            <button
              type="button"
              role="treeitem"
              data-folder-tree-item="true"
              aria-level={1}
              aria-posinset={1}
              aria-setsize={(rootPage?.nodes.length ?? 0) + 1}
              aria-selected={selectedFolderId === null}
              aria-disabled={Boolean(rootReason)}
              title={rootReason ?? "All files"}
              className={cn(
                "flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-[#F3F0EA]/60 dark:hover:bg-zinc-900 rounded-[3px]",
                selectedFolderId === null &&
                  "bg-[#F3F0EA] dark:bg-white/10 font-medium",
                rootReason && "opacity-55",
              )}
              onClick={() => !rootReason && onSelectFolder(null)}
              onKeyDown={(event) => {
                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  focusSibling(event, 1);
                }
              }}
            >
              <Folder className="h-4 w-4 text-[#D14E24]" /> All files
              {selectedFolderId === null ? (
                <Check className="ml-auto h-4 w-4 text-[#D14E24]" />
              ) : null}
            </button>
            {rootPage?.loading && rootPage.nodes.length === 0 ? (
              <div className="flex items-center gap-2 p-3 text-sm text-zinc-500">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading folders…
              </div>
            ) : rootPage?.error ? (
              <button
                type="button"
                onClick={() => void loadPage(null)}
                className="flex items-center gap-2 p-3 text-sm text-rose-600"
              >
                <AlertCircle className="h-4 w-4" /> {rootPage.error}. Retry
              </button>
            ) : (
              rootPage?.nodes.map((node, index, siblings) =>
                renderNode(node, 0, index + 2, siblings.length + 1),
              )
            )}
            {rootPage?.nextCursor ? (
              <button
                type="button"
                disabled={rootPage.loading}
                onClick={() =>
                  void loadPage(null, rootPage.nextCursor, true)
                }
                className="mx-3 my-2 text-xs text-[#D14E24] hover:underline disabled:opacity-50"
              >
                {rootPage.loading ? "Loading…" : "Load more folders"}
              </button>
            ) : null}
          </>
        )}
      </div>
      <div className="border-t border-[#DBD5C8] px-3 py-2 text-xs text-[#4C5A61] dark:border-zinc-800">
        Destination:{" "}
        <span className="font-medium text-[#141A1E] dark:text-zinc-200">
          {selectedFolderId === null
            ? "All files"
            : selectedNode?.path ?? "Select a folder"}
        </span>
      </div>
      {canCreateFolder ? (
        <div className="border-t border-[#DBD5C8] p-2 dark:border-zinc-800">
          <div className="flex gap-2">
            <Input
              value={newFolderName}
              onChange={(event) => setNewFolderName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void createSelectedFolder();
              }}
              placeholder="New folder name"
              aria-label="New folder name"
              className="rounded-[5px] border-[#DBD5C8] focus-visible:ring-[#D14E24]"
            />
            <Button
              type="button"
              variant="outline"
              disabled={
                !newFolderName.trim() ||
                creating ||
                Boolean(disabledReason(selectedNode ?? null))
              }
              onClick={() => void createSelectedFolder()}
              className="nb-touch-target h-[34px] rounded-[5px] border-[#DBD5C8] hover:bg-[#F3F0EA] dark:border-zinc-700"
            >
              <Plus className="mr-1 h-4 w-4" /> Create
            </Button>
          </div>
          {createError ? <p role="alert" className="mt-1 text-xs text-rose-600">{createError}</p> : null}
        </div>
      ) : null}
    </div>
  );
}

// --- Dialog components (inlined from deleted ExplorerBatchOps) ---

export function CreateDialog({
  createDialog,
  setCreateDialog,
  confirmCreate,
  canEdit,
}: {
  createDialog:
    | { open: false }
    | { open: true; kind: "file" | "folder"; parentId: string | null; name: string };
  setCreateDialog: React.Dispatch<
    React.SetStateAction<
      | { open: false }
      | { open: true; kind: "file" | "folder"; parentId: string | null; name: string }
    >
  >;
  confirmCreate: () => Promise<void>;
  canEdit: boolean;
}) {
  return (
    <Dialog
      open={createDialog.open}
      onOpenChange={(open) => setCreateDialog(open ? createDialog : { open: false })}
    >
      {createDialog.open ? (
        <DialogContent
          className="z-[301] sm:max-w-[460px] rounded-[12px] p-6 shadow-2xl"
          overlayClassName="z-[300] bg-transparent backdrop-blur-none"
        >
          <DialogHeader>
            <DialogTitle>
              {createDialog.kind === "folder" ? "Create folder" : "Create file"}
            </DialogTitle>
            <DialogDescription>
              {createDialog.kind === "folder"
                ? "Create a new folder in the current location."
                : "Create a new file in the current location."}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder={
                createDialog.kind === "folder" ? "Folder name" : "File name (e.g. index.tsx)"
              }
              value={createDialog.name}
              onChange={(e) =>
                setCreateDialog((d) => (d.open ? { ...d, name: e.target.value } : d))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter" && createDialog.name.trim()) void confirmCreate();
              }}
              className="h-9 rounded-[5px] border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:outline-none"
              autoFocus
            />
          </div>
          <DialogFooter className="bg-[#F3F0EA] dark:bg-white/5 border-t border-[#DBD5C8] dark:border-white/10 -mx-6 -mb-6 px-6 py-3 rounded-b-[12px] flex items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setCreateDialog({ open: false })}
              className="nb-touch-target h-[34px] rounded-[5px] border-[#DBD5C8] hover:bg-[#DBD5C8]/30"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void confirmCreate()}
              disabled={!canEdit || !createDialog.name.trim()}
              className="nb-touch-target h-[34px] rounded-[5px] bg-[#D14E24] hover:bg-[#B23F1C] text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

export function RenameDialog({
  renameState,
  setRenameState,
  confirmRename,
  canEdit,
}: {
  renameState: { nodeId: string | null; value: string; original: string };
  setRenameState: React.Dispatch<
    React.SetStateAction<{ nodeId: string | null; value: string; original: string }>
  >;
  confirmRename: () => Promise<void>;
  canEdit: boolean;
}) {
  return (
    <Dialog
      open={!!renameState.nodeId}
      onOpenChange={(open) => {
        if (!open) setRenameState({ nodeId: null, value: "", original: "" });
      }}
    >
      {renameState.nodeId ? (
        <DialogContent
          className="z-[301] sm:max-w-[460px] rounded-[12px] p-6 shadow-2xl"
          overlayClassName="z-[300] bg-transparent backdrop-blur-none"
          onCloseAutoFocus={(e) => {
            e.preventDefault();
            const nextTarget =
              document.querySelector<HTMLElement>('[data-file-item="true"][tabindex="0"]') ??
              document.querySelector<HTMLElement>('[data-file-item="true"]') ??
              document.querySelector<HTMLElement>('[role="tree"]');
            nextTarget?.focus();
          }}
        >
          <DialogHeader>
            <DialogTitle>Rename</DialogTitle>
            <DialogDescription className="sr-only">
              Enter a new name for the item.
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <Input
              placeholder="New name"
              value={renameState.value}
              onChange={(e) => setRenameState((s) => ({ ...s, value: e.target.value }))}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  renameState.value.trim() &&
                  renameState.value.trim() !== renameState.original
                ) {
                  void confirmRename();
                }
              }}
              className="h-9 rounded-[5px] border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground focus-visible:border-primary focus-visible:ring-1 focus-visible:ring-primary/40 focus-visible:outline-none"
              autoFocus
            />
          </div>
          <DialogFooter className="bg-[#F3F0EA] dark:bg-white/5 border-t border-[#DBD5C8] dark:border-white/10 -mx-6 -mb-6 px-6 py-3 rounded-b-[12px] flex items-center justify-end gap-2">
            <Button
              variant="outline"
              onClick={() => setRenameState({ nodeId: null, value: "", original: "" })}
              className="nb-touch-target h-[34px] rounded-[5px] border-[#DBD5C8] hover:bg-[#DBD5C8]/30"
            >
              Cancel
            </Button>
            <Button
              onClick={() => void confirmRename()}
              disabled={
                !canEdit ||
                !renameState.value.trim() ||
                renameState.value.trim() === renameState.original
              }
              className="nb-touch-target h-[34px] rounded-[5px] bg-[#D14E24] hover:bg-[#B23F1C] text-white disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Save
            </Button>
          </DialogFooter>
        </DialogContent>
      ) : null}
    </Dialog>
  );
}

export function DeleteDialog({
  deleteDialog,
  setDeleteDialog,
  confirmDelete,
  canEdit,
}: {
  deleteDialog: { open: boolean; nodes: WorkspaceNode[] };
  setDeleteDialog: React.Dispatch<React.SetStateAction<{ open: boolean; nodes: WorkspaceNode[] }>>;
  confirmDelete: () => Promise<void>;
  canEdit: boolean;
}) {
  // Org files in use (sprint materials, references, template folders, docs) warn before Trash (report §23.9 #11).
  const [usage, setUsage] = useState<string[]>([]);
  const projectId = deleteDialog.nodes[0]?.projectId ?? null;
  const ids = deleteDialog.open ? deleteDialog.nodes.map((n) => n.id).join(",") : "";
  useEffect(() => {
    setUsage([]);
    if (!projectId || !ids) return;
    let live = true;
    void readOrgFileUsageAction(projectId, ids.split(",")).then((labels) => { if (live) setUsage(labels); }).catch(() => undefined);
    return () => { live = false; };
  }, [projectId, ids]);
  return (
    <Dialog
      open={deleteDialog.open}
      onOpenChange={(open) =>
        setDeleteDialog((d) => ({ ...d, open, nodes: open ? d.nodes : [] }))
      }
    >
      <DialogContent
        className="z-[301] sm:max-w-[460px] rounded-[12px] p-6 shadow-2xl"
        overlayClassName="z-[300] bg-transparent backdrop-blur-none"
        onCloseAutoFocus={(e) => {
          e.preventDefault();
          const nextTarget =
            document.querySelector<HTMLElement>('[data-file-item="true"][tabindex="0"]') ??
            document.querySelector<HTMLElement>('[data-file-item="true"]') ??
            document.querySelector<HTMLElement>('[role="tree"]');
          nextTarget?.focus();
        }}
      >
        <DialogHeader>
          <DialogTitle>Move to Trash</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            This will move{" "}
            <span className="font-mono font-semibold text-foreground">
              {deleteDialog.nodes.length > 1
                ? `${deleteDialog.nodes.length} items`
                : deleteDialog.nodes[0]?.name}
            </span>{" "}
            to Trash.
          </DialogDescription>
        </DialogHeader>
        {usage.length > 0 ? (
          <div role="alert" className="rounded-[5px] border border-amber-500/30 bg-amber-500/10 p-3 text-[13px] text-foreground">
            <p className="font-medium">Still in use</p>
            <ul className="mt-1 list-disc pl-5">{usage.map((label) => <li key={label}>{label}</li>)}</ul>
            <p className="mt-1 text-muted-foreground">References will show “File in Trash”; a trashed template leaves the workspace wizard.</p>
          </div>
        ) : null}
        <DialogFooter className="bg-muted/50 border-t border-border -mx-6 -mb-6 px-6 py-3 rounded-b-[12px] flex items-center justify-end gap-2">
          <Button
            variant="outline"
            onClick={() => setDeleteDialog({ open: false, nodes: [] })}
            className="nb-touch-target h-[34px] rounded-[5px] border-[#DBD5C8] hover:bg-[#DBD5C8]/30"
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            onClick={() => void confirmDelete()}
            disabled={!canEdit}
            className="nb-touch-target h-[34px] rounded-[5px]"
          >
            Move to Trash
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function MoveDialog({
  moveDialog,
  setMoveDialog,
  confirmMove,
  canEdit,
  projectId,
  mode = "move",
}: {
  moveDialog: {
    open: boolean;
    nodes: WorkspaceNode[];
    targetFolderId: string | null;
  };
  setMoveDialog: React.Dispatch<
    React.SetStateAction<{
      open: boolean;
      nodes: WorkspaceNode[];
      targetFolderId: string | null;
    }>
  >;
  confirmMove: () => Promise<void>;
  canEdit: boolean;
  projectId: string;
  mode?: "move" | "publish";
}) {
  const [isMoving, setIsMoving] = useState(false);
  const [moveError, setMoveError] = useState<string | null>(null);
  const sourceLabel =
    moveDialog.nodes.length > 1
      ? `${moveDialog.nodes.length} items`
      : moveDialog.nodes[0]?.name ?? "item";
  const invalidReason = mode === "move" && moveDialog.nodes.some((node) => node.taskId)
    ? "Add draft files to Files before moving them."
    : moveDialog.nodes.length > 0 &&
        moveDialog.nodes.every(
          (node) => (node.parentId ?? null) === moveDialog.targetFolderId,
        )
      ? "The selected items are already in this location."
      : moveDialog.nodes.some((node) => node.id === moveDialog.targetFolderId)
        ? "An item cannot be moved into itself."
        : null;

  const runMove = async () => {
    if (invalidReason || isMoving) return;
    setMoveError(null);
    setIsMoving(true);
    try {
      await confirmMove();
    } catch (error) {
      setMoveError(error instanceof Error ? error.message : "Move failed");
    } finally {
      setIsMoving(false);
    }
  };

  return (
    <Dialog
      open={moveDialog.open}
      onOpenChange={(open) =>
        setMoveDialog((d) => ({ ...d, open, nodes: open ? d.nodes : [] }))
      }
    >
      <DialogContent
        className="z-[301] flex max-h-[88vh] flex-col sm:max-w-[460px] rounded-[12px] p-6 shadow-2xl"
        overlayClassName="z-[300] bg-transparent backdrop-blur-none"
      >
        <DialogHeader>
          <DialogTitle>
            {mode === "publish" ? "Publish" : "Move"}{" "}
            {moveDialog.nodes.length > 1 ? "items" : moveDialog.nodes[0]?.type ?? "item"}
          </DialogTitle>
          <DialogDescription>
            {mode === "publish"
              ? "Choose a folder in Files. The file stays a draft on the task."
              : "Choose a new location in Workspace Files. Task role and final-file status are unchanged."}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <div className="text-sm text-zinc-600 dark:text-zinc-300">
            Moving <span className="font-mono font-semibold">{sourceLabel}</span>
            {moveDialog.nodes.length === 1 && moveDialog.nodes[0]?.path ? (
              <span className="mt-1 block truncate text-xs text-zinc-500">
                Current location: {moveDialog.nodes[0].path}
              </span>
            ) : null}
          </div>
          <FolderPicker
            projectId={projectId}
            selectedFolderId={moveDialog.targetFolderId}
            onSelectFolder={(id) => setMoveDialog((d) => ({ ...d, targetFolderId: id }))}
            sourceNodes={moveDialog.nodes}
            canCreateFolder={canEdit}
            allowTaskWorkingFiles={mode === "publish"}
            className="h-[min(58vh,28rem)] max-h-none"
          />
          {invalidReason || moveError ? (
            <p role="alert" className="text-sm text-rose-600">
              {moveError ?? invalidReason}
            </p>
          ) : null}
        </div>
        <DialogFooter className="bg-[#F3F0EA] dark:bg-white/5 border-t border-[#DBD5C8] dark:border-white/10 -mx-6 -mb-6 px-6 py-3 rounded-b-[12px] flex items-center justify-end gap-2">
          <Button
            variant="outline"
            onClick={() =>
              setMoveDialog({ open: false, nodes: [], targetFolderId: null })
            }
            className="nb-touch-target h-[34px] rounded-[5px] border-[#DBD5C8] hover:bg-[#DBD5C8]/30"
          >
            Cancel
          </Button>
          <Button
            onClick={() => void runMove()}
            disabled={!canEdit || isMoving || Boolean(invalidReason)}
            className="nb-touch-target h-[34px] rounded-[5px] bg-[#D14E24] hover:bg-[#B23F1C] text-white"
          >
            {isMoving ? (mode === "publish" ? "Publishing…" : "Moving…") : mode === "publish" ? "Publish" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// --- Main ExplorerDialogsHost ---

interface ExplorerDialogsHostProps {
  canEdit: boolean;
  canManageFiles?: boolean;
  projectId: string;
  createDialog: { open: false } | { open: true; kind: "file" | "folder"; parentId: string | null; name: string };
  setCreateDialog: React.Dispatch<
    React.SetStateAction<{ open: false } | { open: true; kind: "file" | "folder"; parentId: string | null; name: string }>
  >;
  confirmCreate: () => Promise<void>;
  renameState: { nodeId: string | null; value: string; original: string };
  setRenameState: React.Dispatch<
    React.SetStateAction<{ nodeId: string | null; value: string; original: string }>
  >;
  confirmRename: () => Promise<void>;
  deleteDialog: { open: boolean; nodes: WorkspaceNode[] };
  setDeleteDialog: React.Dispatch<React.SetStateAction<{ open: boolean; nodes: WorkspaceNode[] }>>;
  confirmDelete: () => Promise<void>;
  moveDialog: { open: boolean; nodes: WorkspaceNode[]; targetFolderId: string | null };
  setMoveDialog: React.Dispatch<
    React.SetStateAction<{ open: boolean; nodes: WorkspaceNode[]; targetFolderId: string | null }>
  >;
  confirmMove: () => Promise<void>;
}

// FW10: Memoize to prevent re-renders from unrelated ExplorerShell state changes
export const ExplorerDialogsHost = React.memo(function ExplorerDialogsHost({
  canEdit,
  canManageFiles = canEdit,
  projectId,
  createDialog,
  setCreateDialog,
  confirmCreate,
  renameState,
  setRenameState,
  confirmRename,
  deleteDialog,
  setDeleteDialog,
  confirmDelete,
  moveDialog,
  setMoveDialog,
  confirmMove,
}: ExplorerDialogsHostProps) {
  return (
    <>
      <CreateDialog
        createDialog={createDialog}
        setCreateDialog={setCreateDialog}
        confirmCreate={confirmCreate}
        canEdit={canEdit}
      />

      <RenameDialog
        renameState={renameState}
        setRenameState={setRenameState}
        confirmRename={confirmRename}
        canEdit={canEdit}
      />

      <DeleteDialog
        deleteDialog={deleteDialog}
        setDeleteDialog={setDeleteDialog}
        confirmDelete={confirmDelete}
        canEdit={canEdit}
      />

      <MoveDialog
        moveDialog={moveDialog}
        setMoveDialog={setMoveDialog}
        confirmMove={confirmMove}
        canEdit={canManageFiles}
        projectId={projectId}
      />
    </>
  );
});
