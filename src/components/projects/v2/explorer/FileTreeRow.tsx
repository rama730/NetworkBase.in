import React from "react";
import {
    ChevronRight,
    ChevronDown,
    CheckSquare,
    Square,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { FileIcon } from "./FileIcons";
import { ProjectNode } from "@/lib/db/schema";
import { extractFoldersFromDataTransfer } from "@/lib/files/folder-drop";
import { VersionPill } from "../files-tab/VersionPill";

const NODE_DRAG_MIME = "application/x-nb-node";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function extractDraggedNodeId(dataTransfer: DataTransfer): string | null {
    const raw = dataTransfer.getData(NODE_DRAG_MIME).trim();
    if (!raw) return null;
    return UUID_PATTERN.test(raw) ? raw : null;
}

// ─── Inline Rename Input ─────────────────────────────────────────────
function InlineRenameInput({
    value,
    onChange,
    onConfirm,
    onCancel,
}: {
    value: string;
    onChange: (v: string) => void;
    onConfirm: () => void;
    onCancel: () => void;
}) {
    const inputRef = React.useRef<HTMLInputElement>(null);
    const cancelledRef = React.useRef(false);

    React.useEffect(() => {
        const el = inputRef.current;
        if (!el) return;
        el.focus();
        // Select filename without extension
        const dotIdx = value.lastIndexOf(".");
        el.setSelectionRange(0, dotIdx > 0 ? dotIdx : value.length);
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    return (
        <input
            ref={inputRef}
            value={value}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === "Enter") { e.preventDefault(); onConfirm(); }
                if (e.key === "Escape") {
                    e.preventDefault();
                    cancelledRef.current = true;
                    onCancel();
                }
            }}
            onBlur={() => {
                // Skip onConfirm if Escape was pressed (race condition guard)
                if (cancelledRef.current) return;
                onConfirm();
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-xs font-mono bg-white dark:bg-card border border-[#D14E24] rounded-[3px] px-1.5 py-0.5 outline-none ring-1 ring-[#D14E24]/30 w-full min-w-[60px] mr-auto"
        />
    );
}

// ─── FileTreeRow ─────────────────────────────────────────────────────
interface FileTreeRowProps {
    node: ProjectNode;
    indentationGuides: boolean[];
    ariaLevel?: number;
    ariaPosInSet?: number;
    ariaSetSize?: number;
    isSelected?: boolean;
    isExpanded?: boolean;
    isInSelectionMode?: boolean;
    isSelectedInMode?: boolean;
    canEdit: boolean;
    canMove: boolean;

    // Inline rename
    isRenaming?: boolean;
    renameValue?: string;
    onRenameChange?: (v: string) => void;
    onRenameConfirm?: () => void;
    onRenameCancel?: () => void;
    
    isFirstNode?: boolean;

    // Slots
    badge?: React.ReactNode;

    // Desktop drop upload
    onDesktopDrop?: (files: File[], targetFolderId: string) => void;

    // Actions
    onToggle: (node: ProjectNode) => void;
    onSelect: (node: ProjectNode, e?: React.MouseEvent) => void;
    onContextMenu: (e: React.MouseEvent) => void;
    onDragStart: (nodeId: string) => void;
    onDragEnd: () => void;
    onDrop: (targetId: string, draggedId: string) => void;
}

function arePropsEqual(prev: FileTreeRowProps, next: FileTreeRowProps) {
    if (
        prev.node !== next.node || 
        prev.ariaLevel !== next.ariaLevel ||
        prev.ariaPosInSet !== next.ariaPosInSet ||
        prev.ariaSetSize !== next.ariaSetSize ||
        prev.isSelected !== next.isSelected ||
        prev.isFirstNode !== next.isFirstNode ||
        prev.isExpanded !== next.isExpanded ||
        prev.isInSelectionMode !== next.isInSelectionMode ||
        prev.isSelectedInMode !== next.isSelectedInMode ||
        prev.canEdit !== next.canEdit ||
        prev.canMove !== next.canMove ||
        prev.badge !== next.badge || 
        prev.isRenaming !== next.isRenaming ||
        prev.renameValue !== next.renameValue ||
        prev.onToggle !== next.onToggle ||
        prev.onSelect !== next.onSelect ||
        prev.onContextMenu !== next.onContextMenu ||
        prev.onDragStart !== next.onDragStart ||
        prev.onDragEnd !== next.onDragEnd ||
        prev.onDrop !== next.onDrop
    ) {
        return false;
    }

    if (prev.indentationGuides.length !== next.indentationGuides.length) return false;
    for (let i = 0; i < prev.indentationGuides.length; i++) {
        if (prev.indentationGuides[i] !== next.indentationGuides[i]) return false;
    }

    return true;
}

export const FileTreeRow = React.memo(function FileTreeRow({
    node,
    indentationGuides,
    ariaLevel,
    ariaPosInSet,
    ariaSetSize,
    isSelected,
    isExpanded,
    isInSelectionMode,
    isSelectedInMode,
    canEdit,
    canMove,
    isRenaming,
    renameValue,
    onRenameChange,
    onRenameConfirm,
    onRenameCancel,
    badge,
    onDesktopDrop,
    isFirstNode,
    onToggle,
    onSelect,
    onContextMenu,
    onDragStart,
    onDragEnd,
    onDrop
}: FileTreeRowProps) {
    const isFolder = node.type === "folder";
    const hasAnySelection = isSelected || isInSelectionMode;
    const effectiveTabIndex = isSelected ? 0 : (!hasAnySelection && isFirstNode) ? 0 : -1;

    const [dropHighlight, setDropHighlight] = React.useState(false);

    const handleMouseEnter = () => {
        if (isRenaming) return;
    };

    const handleMouseLeave = () => {
    };

    const guides = indentationGuides.map((active, i) => (
        <div
            key={i}
            className={cn(
                "w-4 h-full flex-shrink-0 border-l transition-colors",
                active ? "border-[#DBD5C8] dark:border-white/10" : "border-transparent"
            )}
        />
    ));

    return (
        <div
            data-workspace-file-item="true"
            data-node-id={node.id}
            role="treeitem"
            aria-level={ariaLevel}
            aria-posinset={ariaPosInSet}
            aria-setsize={ariaSetSize}
            aria-selected={isSelected ? "true" : "false"}
            aria-expanded={isFolder ? (isExpanded ? "true" : "false") : undefined}
            tabIndex={effectiveTabIndex}
            className={cn(
                "group relative flex items-center h-8 [@media(pointer:coarse)]:h-11 min-w-0 cursor-pointer select-none transition-colors pr-2 text-sm",
                isSelected
                    ? "bg-[#F3F0EA] dark:bg-white/10 text-[#141A1E] dark:text-foreground font-medium"
                    : "hover:bg-[#F3F0EA]/60 dark:hover:bg-white/5 text-[#374349] dark:text-muted-foreground",
                dropHighlight && "ring-1 ring-inset ring-[#D14E24] bg-[#FCF0EA]/75 dark:bg-[#D14E24]/20"
            )}
            style={{ paddingLeft: 0 }} 
            onClick={(e) => {
                if (isRenaming) return;
                e.stopPropagation();
                onSelect(node, e);
            }}
            onKeyDown={(e) => {
                if (isRenaming) return;
                const tree = e.currentTarget.closest('[role="tree"]');
                const items = Array.from(
                    tree?.querySelectorAll<HTMLElement>('[data-workspace-file-item="true"]') ?? []
                );
                const index = items.indexOf(e.currentTarget as HTMLElement);
                if (e.key === "ArrowDown") {
                    e.preventDefault();
                    items[index + 1]?.focus();
                } else if (e.key === "ArrowUp") {
                    e.preventDefault();
                    items[index - 1]?.focus();
                } else if (e.key === "Home") {
                    e.preventDefault();
                    items[0]?.focus();
                } else if (e.key === "End") {
                    e.preventDefault();
                    items[items.length - 1]?.focus();
                } else if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    onSelect(node);
                } else if (e.key === "ArrowRight") {
                    if (isFolder) {
                        e.preventDefault();
                        if (!isExpanded) {
                            onToggle(node);
                        } else {
                            items[index + 1]?.focus();
                        }
                    }
                } else if (e.key === "ArrowLeft") {
                    if (isFolder && isExpanded) {
                        e.preventDefault();
                        onToggle(node);
                    }
                }
            }}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            onContextMenu={onContextMenu}
            draggable={canMove && !isRenaming}
            onDragStart={(e) => {
                if (!canMove || isRenaming) return;
                e.dataTransfer.setData(NODE_DRAG_MIME, node.id);
                e.dataTransfer.effectAllowed = "move";
                onDragStart(node.id);
            }}
            onDragEnd={onDragEnd}
            onDragOver={(e) => {
                // Accept desktop file drops on folders
                const hasFiles =
                    canEdit &&
                    Boolean(onDesktopDrop) &&
                    e.dataTransfer.types.includes("Files");
                const hasNodeDrag =
                    canMove && e.dataTransfer.types.includes(NODE_DRAG_MIME);
                if (!isFolder || (!hasFiles && !hasNodeDrag)) return;
                e.preventDefault();
                if (isFolder && hasFiles) {
                    e.dataTransfer.dropEffect = "copy";
                } else if (isFolder && hasNodeDrag) {
                    e.dataTransfer.dropEffect = "move";
                } else {
                    e.dataTransfer.dropEffect = "move";
                }
                if (isFolder && (hasFiles || hasNodeDrag) && !dropHighlight) setDropHighlight(true);
            }}
            onDragLeave={() => setDropHighlight(false)}
            onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setDropHighlight(false);
 
                // Desktop file drop → upload into this folder
                if (isFolder && onDesktopDrop && (e.dataTransfer.files.length > 0 || (e.dataTransfer.items && e.dataTransfer.items.length > 0))) {
                    void extractFoldersFromDataTransfer(e.dataTransfer).then((extracted) => {
                        const allFiles: File[] = [
                            ...extracted.looseFiles,
                            ...extracted.folders.flatMap((folder) =>
                              folder.files.map((item) => {
                                const fullRelativePath = item.relativePath
                                  ? `${folder.name}/${item.relativePath}`
                                  : `${folder.name}/${item.file.name}`;
                                try {
                                  Object.defineProperty(item.file, "webkitRelativePath", {
                                    value: fullRelativePath,
                                    configurable: true,
                                  });
                                } catch {}
                                return item.file;
                              }),
                            ),
                        ];
                        const files = allFiles.length > 0 ? allFiles : Array.from(e.dataTransfer.files || []);
                        if (files.length > 0) onDesktopDrop(files, node.id);
                    }).catch(() => {
                        const files = Array.from(e.dataTransfer.files || []);
                        if (files.length > 0) onDesktopDrop(files, node.id);
                    });
                    return;
                }
 
                if (!e.dataTransfer.types.includes(NODE_DRAG_MIME)) return;
                if (!canMove) return;
                const draggedId = extractDraggedNodeId(e.dataTransfer);
                if (!draggedId || draggedId === node.id) return;
                onDrop(node.id, draggedId);
            }}
        >
            {guides}
            
            {isFolder ? (
                <button
                    type="button"
                    tabIndex={-1}
                    aria-label={isExpanded ? "Collapse folder" : "Expand folder"}
                    className={cn(
                        "w-5 h-full flex items-center justify-center shrink-0 text-[#4C5A61] dark:text-muted-foreground hover:text-foreground",
                    )}
                    onClick={(e) => {
                        e.stopPropagation();
                        onToggle(node);
                    }}
                >
                    {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" strokeWidth={1.75} />
                    ) : (
                        <ChevronRight className="w-3.5 h-3.5" strokeWidth={1.75} />
                    )}
                </button>
            ) : (
                <div className="w-5 h-full shrink-0" aria-hidden="true" />
            )}
 
            {isInSelectionMode && (
                <div className="mr-2 shrink-0">
                    {isSelectedInMode ? (
                        <CheckSquare className="w-4 h-4 text-[#D14E24]" strokeWidth={1.75} />
                    ) : (
                        <Square className="w-4 h-4 text-[#DBD5C8] dark:text-muted-foreground/40" strokeWidth={1.75} />
                    )}
                </div>
            )}
 
            <FileIcon name={node.name} mimeType={node.mimeType} isFolder={isFolder} isOpen={isExpanded} className="w-4 h-4 mr-2 flex-shrink-0" />
            
            {isRenaming && onRenameChange && onRenameConfirm && onRenameCancel ? (
                <InlineRenameInput
                    value={renameValue ?? ""}
                    onChange={onRenameChange}
                    onConfirm={onRenameConfirm}
                    onCancel={onRenameCancel}
                />
            ) : (
                <div className="flex items-center gap-1.5 min-w-0 mr-auto">
                    <span className={cn(
                        "text-[13px] leading-[1.4] whitespace-nowrap overflow-hidden text-ellipsis font-normal",
                        isSelected ? "text-[#141A1E] dark:text-foreground font-medium" : "text-[#374349] dark:text-muted-foreground"
                    )}>
                        {node.name}
                    </span>
                    <VersionPill v={node.currentVersion} className="h-4 px-1 text-[11px]" />
                </div>
            )}
 
            {badge}
        </div>
    );
}, arePropsEqual);
