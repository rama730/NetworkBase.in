"use client";

import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import {
  MoreHorizontal,
  RotateCcw,
  Trash2,
  Search,
  X,
  Clock,
  Info,
} from "lucide-react";
import { toast } from "sonner";
import { useDebounce } from "use-debounce";
import {
  getTrashPage,
  restoreNode,
  bulkRestoreNodes,
} from "@/app/actions/files/mutations";
import {
  getBulkPermanentDeleteImpact,
  getPermanentDeleteImpact,
  permanentlyDeleteTrashedNode,
  permanentlyDeleteTrashedNodes,
} from "@/app/actions/files/trash";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useFilesWorkspaceStore } from "@/stores/filesWorkspaceStore";
import { useFilesWorkspaceView } from "./FilesWorkspaceViews";
import { useFilesTabRole } from "./FilesTabRoleContext";
import { formatRelativeTime, formatBytes, type NodeType } from "./folder/format";
import { FileTypeChip } from "./FileTypeChip";
import { FolderListHeader } from "./folder/FolderListHeader";
import {
  FolderListLoading,
  FolderListEmpty,
  FolderListError,
} from "./folder/FolderListStates";
import { FOLDER_LIST_GRID_TEMPLATE } from "./folder/layout";
import { FilesWorkspaceMenu, FilesHeaderSlot } from "./FilesWorkspaceHeader";
import { UserAvatar } from "@/components/ui/UserAvatar";
import styles from "./folder/FolderList.module.css";
import { cn } from "@/lib/utils";

function originalLocation(path: string) {
  const parts = path.split("/").filter(Boolean);
  if (parts.length <= 1) return "Project files";
  return `/${parts.slice(0, -1).join("/")}`;
}

type CategoryFilter = "all" | "files" | "folders";

export function TrashFilesCollection({ projectId }: { projectId: string }) {
  const { query } = useFilesWorkspaceView()!;
  const { canEdit, canManageFiles } = useFilesTabRole();
  const [busy, setBusy] = useState<string | null>(null);
  const [deletion, setDeletion] = useState<
    | ({ id: string } & Awaited<ReturnType<typeof getPermanentDeleteImpact>>)
    | null
  >(null);
  // Empty Trash and batch delete share one review: the aggregated impact is shown before anything is deleted.
  const [bulk, setBulk] = useState<{
    scope: "all" | "selected";
    impact: Awaited<ReturnType<typeof getBulkPermanentDeleteImpact>> | null;
  } | null>(null);
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Sorting & Filtering state
  const [sortColumn, setSortColumn] = useState<"name" | "updated" | "size">("updated");
  const [sortDirection, setSortDirection] = useState<"asc" | "desc">("desc");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");
  const [inlineQuery, setInlineQuery] = useState(query || "");

  // Debounced server search for 1M-scale fast database lookup
  const [debouncedServerQuery] = useDebounce(inlineQuery.trim(), 300);

  // Batch selection state
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchOperating, setBatchOperating] = useState(false);

  // Inspector right-drawer state
  const [inspectedNodeId, setInspectedNodeId] = useState<string | null>(null);

  const client = useQueryClient();
  const result = useInfiniteQuery({
    queryKey: ["files-trash", projectId, debouncedServerQuery],
    enabled: canEdit,
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) => getTrashPage(projectId, debouncedServerQuery, pageParam),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
    staleTime: 60_000,
  });

  function reconcile() {
    void client.invalidateQueries({ queryKey: ["files-trash", projectId] });
    void client.invalidateQueries({ queryKey: ["files-directory", projectId] });
    window.dispatchEvent(
      new CustomEvent("project:task-files-changed", { detail: { projectId } }),
    );
  }

  const nodes = useMemo(
    () => result.data?.pages.flatMap((page) => page.nodes) ?? [],
    [result.data?.pages],
  );

  const inspectedNode = useMemo(
    () => (inspectedNodeId ? nodes.find((n) => n.id === inspectedNodeId) ?? null : null),
    [nodes, inspectedNodeId],
  );

  // Synchronous live category counts over loaded nodes (0 latency)
  const categoryCounts = useMemo(() => {
    let files = 0;
    let folders = 0;
    for (const n of nodes) {
      if (n.type === "folder") folders++;
      else files++;
    }
    return {
      all: nodes.length,
      files,
      folders,
    };
  }, [nodes]);

  // Filtered and sorted nodes
  const filteredNodes = useMemo(() => {
    let list = [...nodes];

    if (categoryFilter === "files") {
      list = list.filter((n) => n.type !== "folder");
    } else if (categoryFilter === "folders") {
      list = list.filter((n) => n.type === "folder");
    }

    if (inlineQuery.trim()) {
      const q = inlineQuery.trim().toLowerCase();
      list = list.filter(
        (n) =>
          n.name.toLowerCase().includes(q) ||
          originalLocation(n.path).toLowerCase().includes(q) ||
          (n.deletedByName && n.deletedByName.toLowerCase().includes(q)),
      );
    }

    list.sort((a, b) => {
      let diff = 0;
      if (sortColumn === "name") {
        diff = a.name.localeCompare(b.name);
      } else if (sortColumn === "updated") {
        const timeA = a.deletedAt ? new Date(a.deletedAt).getTime() : 0;
        const timeB = b.deletedAt ? new Date(b.deletedAt).getTime() : 0;
        diff = timeA - timeB;
      } else if (sortColumn === "size") {
        const sizeA = a.type === "folder" ? -1 : a.size || 0;
        const sizeB = b.type === "folder" ? -1 : b.size || 0;
        diff = sizeA - sizeB;
      }
      return sortDirection === "asc" ? diff : -diff;
    });

    return list;
  }, [nodes, categoryFilter, inlineQuery, sortColumn, sortDirection]);

  const handleSort = useCallback((column: "name" | "updated" | "size") => {
    if (sortColumn === column) {
      setSortDirection((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortColumn(column);
      setSortDirection(column === "name" ? "asc" : "desc");
    }
  }, [sortColumn]);

  // Batch selection handlers
  const allSelected =
    filteredNodes.length > 0 &&
    filteredNodes.every((n) => selectedIds.has(n.id));

  const isPartiallySelected =
    !allSelected && filteredNodes.some((n) => selectedIds.has(n.id));

  const toggleSelectAll = useCallback(() => {
    if (allSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(filteredNodes.map((n) => n.id)));
    }
  }, [allSelected, filteredNodes]);

  const toggleSelect = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Infinite scroll sentinel observer for 1M-scale list navigation
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!result.hasNextPage || result.isFetchingNextPage || !sentinelRef.current) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry?.isIntersecting && result.hasNextPage && !result.isFetchingNextPage) {
          void result.fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );
    observer.observe(sentinelRef.current);
    return () => observer.disconnect();
  }, [result.hasNextPage, result.isFetchingNextPage, result.fetchNextPage]);

  async function restore(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      await restoreNode(id, projectId);
      toast.success("Restored to its original location");
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      if (inspectedNodeId === id) setInspectedNodeId(null);
      reconcile();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not restore file",
      );
    } finally {
      setBusy(null);
    }
  }

  async function handleBatchRestore() {
    if (selectedIds.size === 0 || batchOperating) return;
    setBatchOperating(true);
    const ids = Array.from(selectedIds);
    try {
      const res = await bulkRestoreNodes(ids, projectId);
      const count = res.restoredIds.length;
      toast.success(`Restored ${count} ${count === 1 ? "item" : "items"}`);
      setSelectedIds(new Set());
      reconcile();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Batch restoration failed",
      );
    } finally {
      setBatchOperating(false);
    }
  }

  async function reviewDeletion(id: string) {
    if (busy) return;
    setBusy(id);
    try {
      setDeletion({ id, ...(await getPermanentDeleteImpact(projectId, id)) });
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Could not review deletion",
      );
    } finally {
      setBusy(null);
    }
  }

  async function confirmDeletion() {
    if (!deletion || busy) return;
    setBusy(deletion.id);
    try {
      const response = await permanentlyDeleteTrashedNode(
        projectId,
        deletion.id,
        deletion.fingerprint,
      );
      if (response.status === "pending") {
        toast.warning(
          "Deletion is pending storage cleanup. It remains in Trash and will be retried automatically; you can also retry from its menu.",
        );
      } else {
        for (const id of response.deletedIds) {
          useFilesWorkspaceStore.getState().removeNodeFromCaches(projectId, id);
        }
        toast.success("Permanently deleted. This cannot be undone.");
      }
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(deletion.id);
        return next;
      });
      if (inspectedNodeId === deletion.id) setInspectedNodeId(null);
      setDeletion(null);
      reconcile();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Deletion failed");
    } finally {
      setBusy(null);
    }
  }

  async function openBulkReview(scope: "all" | "selected") {
    if (!canManageFiles || bulkDeleting) return;
    setBulk({ scope, impact: null });
    try {
      const impact = await getBulkPermanentDeleteImpact(projectId, scope === "all" ? "all" : Array.from(selectedIds));
      setBulk((current) => (current?.scope === scope ? { scope, impact } : current));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not review deletion");
      setBulk(null);
    }
  }

  async function confirmBulkDelete() {
    if (!bulk?.impact || bulkDeleting) return;
    setBulkDeleting(true);
    try {
      const reviewed = Object.keys(bulk.impact.fingerprints).length;
      const result = await permanentlyDeleteTrashedNodes(projectId, bulk.impact.fingerprints);
      for (const id of result.deletedIds) {
        useFilesWorkspaceStore.getState().removeNodeFromCaches(projectId, id);
      }
      const deletedRoots = reviewed - result.pendingIds.length - result.failed.length;
      const plural = (n: number) => `${n} ${n === 1 ? "item" : "items"}`;
      if (deletedRoots > 0) toast.success(`Permanently deleted ${plural(deletedRoots)}.`);
      if (result.pendingIds.length > 0) {
        toast.warning(`${plural(result.pendingIds.length)} pending storage cleanup; they stay in Trash and retry automatically.`);
      }
      if (result.failed.length > 0) {
        toast.error(`${plural(result.failed.length)} could not be deleted: ${result.failed[0]!.error}`);
      }
      setBulk(null);
      setSelectedIds(new Set());
      reconcile();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Deletion failed");
    } finally {
      setBulkDeleting(false);
    }
  }

  if (!canEdit) {
    return <p className="p-6">You do not have permission to view trash.</p>;
  }

  return (
    <div
      aria-label="Trash"
      className={cn(
        styles.container,
        "flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-card dark:bg-background relative",
      )}
    >
      <FilesWorkspaceMenu projectId={projectId} />

      {/* Header Slot Actions (Gated by canManageFiles) */}
      {canManageFiles && nodes.length > 0 && (
        <FilesHeaderSlot slot="actions">
          <div className="flex items-center gap-1.5 mr-1">
            <button
              type="button"
              onClick={() => void openBulkReview("all")}
              className="nb-touch-target flex h-8 items-center gap-1.5 rounded-[5px] border border-[#F2CAC5] bg-white px-2.5 text-xs font-semibold text-[#96201A] shadow-xs hover:bg-[#FCEDEB] hover:border-[#E8A59E] active:bg-[#F7D8D4] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#96201A] dark:border-red-900/50 dark:bg-card dark:text-red-400 dark:hover:bg-red-950/20"
              aria-label="Empty trash"
            >
              <Trash2 className="size-3.5 text-[#96201A] dark:text-red-400" aria-hidden="true" />
              <span className="hidden sm:inline">Empty trash</span>
            </button>
          </div>
        </FilesHeaderSlot>
      )}

      {/* Toolbar: Category Filters & Inline Search */}
      <div
        role="toolbar"
        aria-label="Trash filters"
        className="flex flex-wrap items-center justify-between gap-2 border-b border-[#DBD5C8] bg-[#FAF8F5] px-4 py-1.5 dark:border-border dark:bg-card"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 text-[11px] font-mono font-medium text-[#6B7880] dark:text-muted-foreground">
            Type:
          </span>
          {(
            [
              { id: "all", label: "All" },
              { id: "files", label: "Files" },
              { id: "folders", label: "Folders" },
            ] as const
          ).map((item) => (
            <button
              key={item.id}
              type="button"
              data-testid={`trash-filter-${item.id}`}
              onClick={() => setCategoryFilter(item.id)}
              className={cn(
                "inline-flex h-6 items-center gap-1.5 rounded-[3px] px-2 text-[11px] font-mono transition-colors",
                categoryFilter === item.id
                  ? "bg-primary font-semibold text-primary-foreground shadow-xs"
                  : "border border-[#DBD5C8]/70 bg-white text-[#4C5A61] hover:bg-[#E8E3D9] hover:text-[#141A1E] dark:border-border dark:bg-card dark:text-muted-foreground dark:hover:bg-white/10 dark:hover:text-foreground",
              )}
            >
              <span>{item.label}</span>
              <span
                className={cn(
                  "text-[10px] max-md:text-[11px] tabular-nums",
                  categoryFilter === item.id
                    ? "text-white/80"
                    : "text-[#8E9AA1] dark:text-muted-foreground",
                )}
              >
                {categoryCounts[item.id]}
              </span>
            </button>
          ))}

          {/* Result counter summary */}
          <span className="hidden md:inline ml-2 text-[11px] font-mono text-[#6B7880] dark:text-muted-foreground">
            {filteredNodes.length === nodes.length
              ? `${nodes.length} ${nodes.length === 1 ? "item" : "items"}`
              : `Showing ${filteredNodes.length} of ${nodes.length} items`}
          </span>
        </div>

        {/* Quick inline search with 0ms client filter + debounced server query */}
        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2 size-3 text-[#6B7880] dark:text-muted-foreground" />
          <input
            type="search"
            value={inlineQuery}
            onChange={(e) => setInlineQuery(e.target.value)}
            placeholder="Filter trash…"
            className="h-6 w-36 rounded-[3px] border border-[#DBD5C8] bg-white pl-6 pr-6 text-[11px] font-mono text-[#141A1E] placeholder:text-[#8E9AA1] focus:border-[#D14E24] focus:outline-none dark:border-border dark:bg-card dark:text-foreground sm:w-48"
          />
          {inlineQuery && (
            <button
              type="button"
              onClick={() => setInlineQuery("")}
              aria-label="Clear filter"
              className="absolute right-1.5 flex size-3.5 items-center justify-center rounded-[2px] text-[#6B7880] hover:text-[#141A1E] dark:text-muted-foreground dark:hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          )}
        </div>
      </div>

      {/* Main Table Structure */}
      <div
        role="table"
        aria-label="Trash files listing"
        className="flex min-h-0 flex-1 flex-col overflow-hidden"
      >
        <FolderListHeader
          sort={sortColumn}
          sortDirection={sortDirection}
          onSort={handleSort}
          updatedLabel="Deleted at"
          byLabel="Deleted by"
          hasCheckbox={true}
          allSelected={allSelected}
          indeterminate={isPartiallySelected}
          onToggleSelectAll={toggleSelectAll}
        />

        <div className="flex-1 min-h-0 overflow-y-auto">
          {result.isPending ? (
            <FolderListLoading />
          ) : result.isError && !result.data ? (
            <FolderListError onRetry={() => void result.refetch()} />
          ) : filteredNodes.length === 0 ? (
            <FolderListEmpty
              message={
                inlineQuery
                  ? "No deleted items match your search."
                  : categoryFilter !== "all"
                    ? "No deleted items match the selected type filter."
                    : "Trash is empty. Deleted files will appear here."
              }
            />
          ) : (
            <div role="rowgroup">
              {filteredNodes.map((node) => (
                <div
                  key={node.id}
                  role="row"
                  data-testid="files-tab-trash-row"
                  onClick={() => setInspectedNodeId(node.id)}
                  style={{ gridTemplateColumns: FOLDER_LIST_GRID_TEMPLATE }}
                  className={cn(
                    "grid items-center gap-x-3 border-b border-border/60 px-4 min-h-12 hover:bg-[#FAF8F5] dark:hover:bg-white/[0.02] text-xs transition-colors group cursor-pointer",
                    selectedIds.has(node.id) && "bg-[#FAF8F4] dark:bg-white/[0.04]",
                  )}
                >
                  {/* Column 1: Checkbox + FileTypeChip + Name & Original Location */}
                  <div
                    role="cell"
                    data-column="name"
                    className="flex min-w-0 items-center gap-2.5 py-1.5"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <input
                      type="checkbox"
                      aria-label={`Select ${node.name}`}
                      checked={selectedIds.has(node.id)}
                      onChange={() => toggleSelect(node.id)}
                      className="size-3.5 rounded-[3px] border-[#DBD5C8] text-[#D14E24] focus:ring-[#D14E24] cursor-pointer"
                    />
                    <div onClick={() => setInspectedNodeId(node.id)}>
                      <FileTypeChip
                        name={node.name}
                        mimeType={node.mimeType}
                        isFolder={node.type === "folder"}
                      />
                    </div>
                    <div
                      className="min-w-0 flex-1 cursor-pointer"
                      onClick={() => setInspectedNodeId(node.id)}
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className="truncate font-mono font-medium text-[#141A1E] dark:text-foreground text-xs group-hover:text-[#D14E24] transition-colors"
                          title={node.name}
                        >
                          {node.name}
                        </span>
                        {Boolean(node.metadata?.permanentDeleteRoot) && (
                          <span
                            className="shrink-0 inline-flex items-center gap-1 rounded-[3px] bg-[#FCF0EA] px-1.5 py-0.5 text-[10px] max-md:text-[11px] font-mono font-medium text-[#B23F1C] dark:bg-[#B23F1C]/20 dark:text-[#FCF0EA]"
                          >
                            <span className="size-1 rounded-[1px] bg-[#B23F1C]" />
                            Deletion pending
                          </span>
                        )}
                      </div>
                      <p
                        className="truncate text-[11px] font-mono text-[#6B7880] dark:text-muted-foreground mt-0.5"
                        title={`Original location: ${originalLocation(node.path)}`}
                      >
                        Original location: {originalLocation(node.path)}
                      </p>
                    </div>

                    {/* Responsive mobile meta: combines deletedAt and deletedBy on narrow screens */}
                    <span
                      data-file-mobile-meta
                      className="sm:hidden truncate text-xs text-[#6B7880] dark:text-muted-foreground"
                    >
                      {[
                        formatRelativeTime(node.deletedAt),
                        node.deletedByName ? `by ${node.deletedByName}` : null,
                        node.type !== "folder" ? formatBytes(node.size, "file") : null,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </span>
                  </div>

                  {/* Column 2: Deleted at */}
                  <div
                    role="cell"
                    data-column="updated"
                    className="min-w-0 truncate font-mono text-xs text-[#6B7880] dark:text-muted-foreground"
                    title={node.deletedAt ? new Date(node.deletedAt).toLocaleString() : undefined}
                  >
                    {formatRelativeTime(node.deletedAt)}
                  </div>

                  {/* Column 3: Size */}
                  <div
                    role="cell"
                    data-column="size"
                    className="min-w-0 text-right font-mono text-xs tabular-nums text-[#6B7880] dark:text-muted-foreground"
                    title={node.size ? `${node.size.toLocaleString()} bytes` : undefined}
                  >
                    {node.type === "folder" ? "—" : formatBytes(node.size, node.type as NodeType) || "—"}
                  </div>

                  {/* Column 4: Deleted by */}
                  <div
                    role="cell"
                    data-column="by"
                    className="flex min-w-0 items-center gap-1.5 truncate text-xs text-[#6B7880] dark:text-muted-foreground"
                    title={node.deletedByName || undefined}
                  >
                    {node.deletedByName ? (
                      <>
                        <UserAvatar
                          identity={{
                            fullName: node.deletedByName,
                            username: node.deletedByUsername,
                            avatarUrl: node.deletedByAvatarUrl,
                          }}
                          size={18}
                          roundedClassName="rounded-[3px]"
                          fallbackClassName="text-[9px] font-mono bg-[#E8E3D9] text-[#141A1E] dark:bg-white/10 dark:text-foreground"
                        />
                        <span className="truncate">{node.deletedByName}</span>
                      </>
                    ) : (
                      <span className="text-[#8E9AA1] dark:text-muted-foreground">—</span>
                    )}
                  </div>

                  {/* Column 5: Actions */}
                  <div
                    role="cell"
                    data-column="actions"
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center justify-end gap-1"
                  >
                    {/* Hover quick-restore for desktop efficiency */}
                    <button
                      type="button"
                      onClick={() => void restore(node.id)}
                      disabled={busy === node.id || !!node.metadata?.permanentDeleteRoot}
                      title="Restore to original location"
                      className="nb-touch-target hidden group-hover:inline-flex h-7 items-center gap-1 rounded-[4px] border border-[#DBD5C8] bg-white px-2 text-[11px] font-mono font-medium text-[#141A1E] hover:border-[#D14E24] hover:text-[#D14E24] dark:border-border dark:bg-card dark:text-foreground transition-colors disabled:opacity-50"
                    >
                      <RotateCcw className="size-3 text-[#D14E24]" />
                      <span>Restore</span>
                    </button>

                    <DropdownMenu modal={false}>
                      <DropdownMenuTrigger asChild>
                        <button
                          type="button"
                          disabled={!!busy}
                          aria-label={`Actions for ${node.name}`}
                          className="nb-touch-target flex size-8 shrink-0 items-center justify-center rounded-[5px] text-[#6B7880] hover:text-[#141A1E] hover:bg-[#FAF8F4] dark:hover:bg-white/10 focus-visible:ring-1 focus-visible:ring-[#D14E24] disabled:opacity-50"
                        >
                          <MoreHorizontal aria-hidden="true" className="size-4" />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          disabled={!!node.metadata?.permanentDeleteRoot}
                          onSelect={() => void restore(node.id)}
                        >
                          <RotateCcw className="mr-2 size-4" />
                          Restore
                        </DropdownMenuItem>
                        {canManageFiles && (
                          <DropdownMenuItem
                            className="text-[#96201A] focus:text-[#96201A]"
                            disabled={
                              !!node.metadata?.permanentDeleteRoot &&
                              node.metadata.permanentDeleteRoot !== node.id
                            }
                            onSelect={() => void reviewDeletion(node.id)}
                          >
                            <Trash2 className="mr-2 size-4" />
                            {node.metadata?.permanentDeleteRoot
                              ? "Retry permanent deletion…"
                              : "Delete permanently…"}
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Infinite Scroll Sentinel for 1M-scale list */}
          <div ref={sentinelRef} className="h-4 w-full" aria-hidden="true" />

          {result.hasNextPage && (
            <div className="p-4 text-center">
              <button
                type="button"
                disabled={result.isFetchingNextPage}
                onClick={() => void result.fetchNextPage()}
                className="min-h-9 rounded-[5px] border border-[#DBD5C8] bg-white px-4 text-xs font-medium text-[#141A1E] shadow-2xs hover:bg-[#FAF8F4] dark:border-border dark:bg-card dark:text-foreground dark:hover:bg-white/5 disabled:opacity-50"
              >
                {result.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Floating Batch Actions Bar */}
      {selectedIds.size > 0 && (
        <div className="sticky bottom-3 mx-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-[6px] border border-[#DBD5C8] bg-white p-2.5 shadow-md dark:border-border dark:bg-card">
          <div className="flex items-center gap-2">
            <span className="font-mono text-xs font-semibold text-[#141A1E] dark:text-foreground">
              {selectedIds.size} {selectedIds.size === 1 ? "item" : "items"} selected
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleBatchRestore()}
              disabled={batchOperating}
              className="nb-touch-target inline-flex h-8 items-center gap-1.5 rounded-[5px] bg-primary px-3 text-xs font-semibold text-primary-foreground shadow-xs transition-[background-color,color] duration-150 ease-in-out hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RotateCcw className="size-3.5" />
              <span>{batchOperating ? "Restoring…" : "Restore selected"}</span>
            </button>
            {canManageFiles && (
              <button
                type="button"
                onClick={() => void openBulkReview("selected")}
                disabled={batchOperating}
                className="nb-touch-target inline-flex h-8 items-center gap-1.5 rounded-[5px] border border-[#F2CAC5] bg-white px-3 text-xs font-semibold text-[#96201A] shadow-xs hover:bg-[#FCEDEB] active:bg-[#F7D8D4] disabled:opacity-50 cursor-pointer dark:border-red-900/50 dark:bg-card dark:text-red-400"
              >
                <Trash2 className="size-3.5" />
                <span>Delete permanently</span>
              </button>
            )}
            <button
              type="button"
              onClick={() => setSelectedIds(new Set())}
              disabled={batchOperating}
              className="nb-touch-target h-8 rounded-[5px] px-2.5 text-xs font-medium text-[#6B7880] hover:text-[#141A1E] dark:hover:text-foreground cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Trash Inspector Right-Drawer */}
      <Dialog
        open={!!inspectedNode}
        onOpenChange={(open) => {
          if (!open) setInspectedNodeId(null);
        }}
      >
        <DialogContent
          presentation="right-drawer"
          className="w-full max-w-md border-l border-[#DBD5C8] bg-card p-0 dark:border-border"
        >
          {inspectedNode && (
            <div className="flex h-full flex-col justify-between overflow-y-auto">
              <div>
                <DialogHeader className="border-b border-[#DBD5C8] p-5 dark:border-border">
                  <div className="flex items-center gap-3">
                    <FileTypeChip
                      name={inspectedNode.name}
                      mimeType={inspectedNode.mimeType}
                      isFolder={inspectedNode.type === "folder"}
                    />
                    <div className="min-w-0 flex-1">
                      <DialogTitle className="truncate font-mono text-sm font-semibold text-[#141A1E] dark:text-foreground">
                        {inspectedNode.name}
                      </DialogTitle>
                      <DialogDescription className="mt-0.5 text-xs text-[#6B7880] dark:text-muted-foreground">
                        {inspectedNode.type === "folder"
                          ? "Folder in Trash"
                          : `${formatBytes(inspectedNode.size, inspectedNode.type as NodeType)} · ${inspectedNode.mimeType || "File"}`}
                      </DialogDescription>
                    </div>
                  </div>
                </DialogHeader>

                <div className="space-y-4 p-5 text-xs">
                  {/* Original location */}
                  <div className="rounded-[4px] border border-[#DBD5C8] bg-[#FAF8F5] p-3 dark:border-border dark:bg-card/50">
                    <p className="font-mono text-[11px] uppercase tracking-wider text-[#6B7880] dark:text-muted-foreground">
                      Original Location
                    </p>
                    <p className="mt-1 font-mono font-medium text-[#141A1E] dark:text-foreground break-all">
                      {originalLocation(inspectedNode.path)}
                    </p>
                  </div>

                  {/* Deletion audit info */}
                  <div className="rounded-[4px] border border-[#DBD5C8] bg-[#FAF8F5] p-3 space-y-2.5 dark:border-border dark:bg-card/50">
                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-wider text-[#6B7880] dark:text-muted-foreground">
                        Deleted At
                      </p>
                      <p className="mt-0.5 font-mono text-[#141A1E] dark:text-foreground">
                        {inspectedNode.deletedAt
                          ? new Date(inspectedNode.deletedAt).toLocaleString()
                          : "Unknown"}
                        {inspectedNode.deletedAt && (
                          <span className="ml-1 text-[#6B7880] dark:text-muted-foreground">
                            ({formatRelativeTime(inspectedNode.deletedAt)})
                          </span>
                        )}
                      </p>
                    </div>

                    <div>
                      <p className="font-mono text-[11px] uppercase tracking-wider text-[#6B7880] dark:text-muted-foreground">
                        Deleted By
                      </p>
                      <div className="mt-1 flex items-center gap-2">
                        {inspectedNode.deletedByName ? (
                          <>
                            <UserAvatar
                              identity={{
                                fullName: inspectedNode.deletedByName,
                                username: inspectedNode.deletedByUsername,
                                avatarUrl: inspectedNode.deletedByAvatarUrl,
                              }}
                              size={20}
                              roundedClassName="rounded-[3px]"
                              fallbackClassName="text-[10px] max-md:text-[11px] font-mono bg-[#E8E3D9] text-[#141A1E] dark:bg-white/10 dark:text-foreground"
                            />
                            <span className="font-medium text-[#141A1E] dark:text-foreground">
                              {inspectedNode.deletedByName}
                            </span>
                            {inspectedNode.deletedByUsername && (
                              <span className="font-mono text-[#6B7880] dark:text-muted-foreground">
                                @{inspectedNode.deletedByUsername}
                              </span>
                            )}
                          </>
                        ) : (
                          <span className="text-[#8E9AA1] dark:text-muted-foreground">—</span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Notice */}
                  <div className="flex items-start gap-2 rounded-[4px] border border-[#DBD5C8] bg-[#FAF8F5] p-3 text-muted-foreground dark:border-border dark:bg-card/50">
                    <Info className="size-4 shrink-0 text-[#6B7880] mt-0.5" />
                    <p className="text-[11px] leading-relaxed">
                      Restoring will return this item to its original location. If the parent folder was deleted, restoring will recreate the directory structure automatically.
                    </p>
                  </div>
                </div>
              </div>

              {/* Action buttons at drawer footer */}
              <div className="border-t border-[#DBD5C8] p-4 flex flex-col gap-2 bg-[#FAF8F5] dark:border-border dark:bg-card">
                <button
                  type="button"
                  onClick={() => void restore(inspectedNode.id)}
                  disabled={busy === inspectedNode.id || !!inspectedNode.metadata?.permanentDeleteRoot}
                  className="nb-touch-target inline-flex h-9 w-full items-center justify-center gap-2 rounded-[5px] bg-primary px-4 text-xs font-semibold text-primary-foreground shadow-xs transition-[background-color,color] duration-150 ease-in-out hover:bg-[var(--primary-hover)] active:bg-[var(--primary-active)] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <RotateCcw className="size-3.5" />
                  <span>Restore to original location</span>
                </button>

                {canManageFiles && (
                  <button
                    type="button"
                    onClick={() => void reviewDeletion(inspectedNode.id)}
                    disabled={
                      busy === inspectedNode.id ||
                      (!!inspectedNode.metadata?.permanentDeleteRoot &&
                        inspectedNode.metadata.permanentDeleteRoot !== inspectedNode.id)
                    }
                    className="nb-touch-target inline-flex h-9 w-full items-center justify-center gap-2 rounded-[5px] border border-[#F2CAC5] bg-white px-4 text-xs font-semibold text-[#96201A] shadow-xs hover:bg-[#FCEDEB] active:bg-[#F7D8D4] disabled:opacity-50 cursor-pointer dark:border-red-900/50 dark:bg-card dark:text-red-400"
                  >
                    <Trash2 className="size-3.5" />
                    <span>
                      {inspectedNode.metadata?.permanentDeleteRoot
                        ? "Retry permanent deletion…"
                        : "Delete permanently…"}
                    </span>
                  </button>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Per-Item Deletion Impact Confirm Dialog */}
      <ConfirmDialog
        open={!!deletion}
        onOpenChange={(open) => {
          if (!open && !busy) setDeletion(null);
        }}
        title={`Permanently delete “${deletion?.name ?? ""}”?`}
        description="This cannot be undone. Shared storage objects used by other files are retained. GitHub is not modified."
        confirmLabel={busy ? "Deleting…" : "Delete permanently"}
        variant="destructive"
        loading={!!busy}
        autoCloseOnConfirm={false}
        onConfirm={confirmDeletion}
      >
        {deletion && (
          <p className="text-sm">
            {deletion.items} item(s), {deletion.versions} stored version(s), and{" "}
            {deletion.taskLinks} task link(s) will be removed.{" "}
            {deletion.documentLinks} linked document(s) will be disconnected
            from the file.
          </p>
        )}
      </ConfirmDialog>

      {/* Bulk permanent delete: Empty Trash or the selection, reviewed first */}
      <ConfirmDialog
        open={!!bulk}
        onOpenChange={(open) => {
          if (!open && !bulkDeleting) setBulk(null);
        }}
        title={bulk?.scope === "all" ? "Permanently empty trash?" : "Permanently delete the selected items?"}
        description="This cannot be undone. Shared storage objects used by other files are retained. GitHub is not modified."
        confirmLabel={bulkDeleting ? "Deleting…" : bulk?.scope === "all" ? "Empty trash" : "Delete permanently"}
        variant="destructive"
        loading={bulkDeleting || !bulk?.impact}
        pendingLabel={bulk?.impact ? undefined : "Reviewing…"}
        autoCloseOnConfirm={false}
        onConfirm={confirmBulkDelete}
      >
        {bulk?.impact ? (
          <p className="text-sm">
            {bulk.impact.roots} item(s) holding {bulk.impact.items} file(s) and folder(s),{" "}
            {bulk.impact.versions} stored version(s) and {bulk.impact.taskLinks} task link(s) will be removed.{" "}
            {bulk.impact.documentLinks} linked document(s) will be disconnected.
            {bulk.impact.truncated ? " Trash holds more; empty it again afterwards for the rest." : ""}
          </p>
        ) : (
          <p className="text-sm text-muted-foreground">Reviewing what will be deleted…</p>
        )}
      </ConfirmDialog>
    </div>
  );
}
