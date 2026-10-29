import React from "react";
import { ProjectNode } from "@/lib/db/schema";
import { type VisibleRow } from "./utils/buildVisibleRows";
import { FileTreeRow } from "./FileTreeRow";
import { Button } from "@/components/ui/button";
import {
    ChevronDown,
    FolderPlus,
    Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskLinkPopover } from "../files-tab/TaskLinkPopover";

export interface FileTreeItemContext {
    projectId: string;
    nodesById: Record<string, ProjectNode>;
    selectedNodeId: string | null;
    selectedNodeIds: string[]; // For multi-select
    expandedFolderIds: Record<string, boolean>;
    favorites: Record<string, boolean>;
    taskLinkCounts: Record<string, number>;
    locksByNodeId: Record<string, { lockedBy: string; lockedByName?: string | null; clientKind?: "web" | "vscode"; expiresAt: number }>;
    mode: "default" | "select";
    canEdit: boolean;
    canMove: boolean;
    projectName?: string; // For empty state

    // Inline rename
    renameNodeId: string | null;
    renameValue: string;
    onRenameChange: (v: string) => void;
    onRenameConfirm: () => void;
    onRenameCancel: () => void;

    // Desktop drop upload
    onDesktopFileDrop?: (files: File[], targetFolderId: string) => void;

    // Folder sizes
    folderSizes: Record<string, number>;
    treeItemMetaByNodeId: Record<
      string,
      { ariaLevel: number; ariaPosInSet: number; ariaSetSize: number }
    >;
    
    // Handlers
    onToggle: (node: ProjectNode) => void;
    onSelect: (node: ProjectNode, e?: React.MouseEvent) => void;
    onDragStart: (nodeId: string) => void;
    onDragEnd: () => void;
    onDrop: (targetId: string, draggedId: string) => void;
    onLoadMore: (parentId: string | null) => void;
    openCreate: (kind: "file" | "folder") => void;
    createInFolder: (folderId: string | null, kind: "file" | "folder") => void;
    uploadToFolder: (folderId: string | null) => void;
    uploadFolderToFolder: (folderId: string | null) => void;
    downloadFolder: (folderId: string) => void;
    openNode: (node: ProjectNode) => void;
    renameNode: (node: ProjectNode) => void;
    moveNode: (node: ProjectNode) => void;
    deleteNode: (node: ProjectNode) => void;
    toggleFavorite: (nodeId: string) => void;
    onTaskLinksClick: (node: ProjectNode) => void;
    onContextMenu: (node: ProjectNode, e: React.MouseEvent) => void;
    isTrashMode: boolean;
    firstNodeId?: string;
}

export function FileTreeItem({
    row,
    context
}: {
    row: VisibleRow;
    context: FileTreeItemContext;
}) {
    if (row.kind === "empty") {
      return (
        <div className="p-4">
          <div className="nb-empty-state nb-grid-ground p-6 text-center" role="status">
            <div className="nb-empty-state-icon-box mb-3">
              <FolderPlus className="nb-empty-state-icon" />
            </div>
            <div className="nb-card-title text-foreground">{context.projectName || "Workspace"}</div>
            <div className="nb-compact mt-1 text-muted-foreground">No files yet. Create a folder or a file to start.</div>
            <div className="mt-4 flex items-center justify-center gap-2">
              <Button size="sm" onClick={() => context.openCreate("folder")} disabled={!context.canEdit}>
                <Plus className="w-4 h-4 mr-2" />
                New folder
              </Button>
              <Button size="sm" variant="outline" onClick={() => context.openCreate("file")} disabled={!context.canEdit}>
                <Plus className="w-4 h-4 mr-2" />
                New file
              </Button>
            </div>
          </div>
        </div>
      );
    }

    // Indentation guides rendering
    const guides = row.indentationGuides?.map((active, i) => (
      <div
        key={i}
        className={cn(
          "w-4 h-full flex-shrink-0 border-l transition-colors",
          active ? "border-[#DBD5C8] dark:border-white/10" : "border-transparent"
        )}
      />
    ));

    // Loading Row
    if (row.kind === "loading") {
      return (
        <div className="flex items-center h-8 [@media(pointer:coarse)]:h-11 pointer-events-none opacity-60">
          {guides}
          <div className="w-4 h-full" />
          <div className="flex items-center gap-2 ml-1 mt-0.5 w-full max-w-[140px]">
             <div aria-hidden="true" className="nb-skeleton h-3.5 w-3.5 shrink-0 rounded-[3px]" />
             <div aria-hidden="true" className="nb-skeleton h-2.5 w-full rounded-[2px]" />
          </div>
        </div>
      );
    }

    if (row.kind === "load-more") {
        return (
        <div 
            className="flex items-center h-8 [@media(pointer:coarse)]:h-11 hover:bg-[#F3F0EA] dark:hover:bg-white/5 cursor-pointer text-[#D14E24] hover:text-[#B23F1C]"
            onClick={(e) => {
                e.stopPropagation();
                const pid = row.parentId === "root" ? null : row.parentId;
                context.onLoadMore(pid);
            }}
        >
            {guides}
            <div className="w-4 h-full" />
            <div className="ml-2 flex items-center gap-1 text-xs font-mono font-medium">
            <ChevronDown className="w-3 h-3 opacity-70" />
                Load more…
            </div>
        </div>
        );
    }

    // Node Row
    const node = context.nodesById[row.nodeId];
    // A virtualized row must always have measurable height. A node
    // can disappear between the row calculation and the next context update.
    if (!node) return <div aria-hidden="true" className="h-8 [@media(pointer:coarse)]:h-11" />;

    const expanded = !!context.expandedFolderIds[node.id];
    // Multi-select check + Single select check
    const isSelected = context.selectedNodeIds.includes(node.id) || context.selectedNodeId === node.id;
    const linkCount = context.taskLinkCounts[node.id] ?? 0;
    const lock = context.locksByNodeId[node.id];
    const isRenaming = context.renameNodeId === node.id;
    const treeItemMeta = context.treeItemMetaByNodeId[node.id];

    // Removed inline Context Menu memory hog - now delegates globally to O(1) Portal

    return (
        <FileTreeRow 
            node={node}
            indentationGuides={row.indentationGuides}
            isSelected={isSelected}
            isExpanded={expanded}
            canEdit={context.canEdit}
            canMove={context.canMove}
            isInSelectionMode={context.mode === "select"}
            isSelectedInMode={context.mode === "select" ? context.selectedNodeIds.includes(node.id) : false}
            
            // Inline rename
            isRenaming={isRenaming}
            isFirstNode={context.firstNodeId === node.id}
            renameValue={isRenaming ? context.renameValue : undefined}
            onRenameChange={isRenaming ? context.onRenameChange : undefined}
            onRenameConfirm={isRenaming ? context.onRenameConfirm : undefined}
            onRenameCancel={isRenaming ? context.onRenameCancel : undefined}
            ariaLevel={treeItemMeta?.ariaLevel ?? row.level + 1}
            ariaPosInSet={treeItemMeta?.ariaPosInSet ?? 1}
            ariaSetSize={treeItemMeta?.ariaSetSize ?? 1}

            // Desktop drop upload
            onDesktopDrop={context.onDesktopFileDrop}
            
            // Interaction
            onToggle={context.onToggle}
            onSelect={context.onSelect}
            onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
                context.onContextMenu(node, e);
            }}
            
            // Drag
            onDragStart={context.onDragStart}
            onDragEnd={context.onDragEnd}
            onDrop={context.onDrop}

            // Badge: Link Count + Lock
            badge={
                <div className="flex items-center gap-1">
                  {lock ? (
                    <span
                      className="text-[11px] px-1 rounded-[3px] border border-[#F6E7C2] bg-[#FBF4E2] text-[#9A6B00] dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60 flex-shrink-0 font-mono"
                      title={`Being edited ${lock.clientKind === "vscode" ? "in VS Code " : ""}by ${lock.lockedByName?.trim() || "another member"}`}
                    >
                      {lock.clientKind === "vscode" ? "VS Code" : "editing"}
                    </span>
                  ) : null}
                  {linkCount > 0 ? (
                    <TaskLinkPopover
                      projectId={context.projectId}
                      nodeId={node.id}
                      count={linkCount}
                    />
                  ) : null}
                </div>
            }
        />
    );
}
