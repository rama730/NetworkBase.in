// Task 5.1 — `FolderListHeader`.
//
// Column header row for `FolderListView`. Renders the four GitHub-style
// columns (Name, Last updated, Size, By) as a sticky `<thead>`-equivalent
// row. The layout is a CSS grid rather than a native `<table>` so the
// body rows can use the same template without a wrapper `<tr>` in
// virtualized contexts.
//
// Requirements: Req 4.3 (column order / names), Req 4.9 (header always
// visible during loading / empty / error states), design.md § FolderListView.

"use client";

import * as React from "react";
import { ArrowDown, ArrowUp } from "@/components/ui/icons";

import { cn } from "@/lib/utils";

import { FOLDER_LIST_GRID_TEMPLATE } from "./layout";

export interface FolderListHeaderProps {
  className?: string;
  sort?: "name" | "updated" | "size" | "type";
  sortDirection?: "asc" | "desc";
  onSort?: (column: "name" | "updated" | "size") => void;
  updatedLabel?: string;
  byLabel?: string;
  /** Files report §1: Submissions counts files in this column. */
  sizeLabel?: string;
  hasCheckbox?: boolean;
  allSelected?: boolean;
  indeterminate?: boolean;
  onToggleSelectAll?: () => void;
}

/**
 * Sticky header row for the folder list. The grid template is shared
 * with `FolderListRow` via `layout.ts` so columns stay aligned.
 */
export function FolderListHeader({
  className,
  sort,
  sortDirection,
  onSort,
  updatedLabel = "Last updated",
  byLabel = "Updated by",
  sizeLabel = "Size",
  hasCheckbox = false,
  allSelected = false,
  indeterminate = false,
  onToggleSelectAll,
}: FolderListHeaderProps): React.JSX.Element {
  const checkboxRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (checkboxRef.current) {
      checkboxRef.current.indeterminate = Boolean(indeterminate && !allSelected);
    }
  }, [indeterminate, allSelected]);

  const getSortArrow = (column: "name" | "updated" | "size") => {
    if (sort !== column) return null;
    if (column === "name") {
      return sortDirection === "desc" ? <ArrowDown size={12} aria-hidden="true" /> : <ArrowUp size={12} aria-hidden="true" />;
    }
    return sortDirection === "asc" ? <ArrowUp size={12} aria-hidden="true" /> : <ArrowDown size={12} aria-hidden="true" />;
  };

  return (
    <div
      role="row"
      data-testid="files-tab-folder-list-header"
      style={{ gridTemplateColumns: FOLDER_LIST_GRID_TEMPLATE }}
      className={cn(
        "sticky top-0 z-10 grid items-center gap-x-3 border-b border-[#DBD5C8] bg-[#F3F0EA] px-4 py-2 font-mono text-[11px] font-semibold uppercase tracking-[0.09em] text-[#4C5A61]",
        "dark:border-border dark:bg-card dark:text-muted-foreground",
        className,
      )}
    >
      <div role="columnheader" data-column="name" aria-sort={sort === "name" ? (sortDirection === "desc" ? "descending" : "ascending") : sort === "type" ? "other" : undefined} className="min-w-0">
        <div className="flex items-center gap-2">
          {hasCheckbox && (
            <input
              ref={checkboxRef}
              type="checkbox"
              aria-label="Select all items"
              checked={allSelected}
              onChange={onToggleSelectAll}
              className="size-3.5 rounded-[3px] border-[#DBD5C8] text-[#D14E24] focus:ring-[#D14E24] cursor-pointer"
            />
          )}
          {onSort ? (
            <button
              type="button"
              onClick={() => onSort("name")}
              className="inline-flex items-center gap-1 uppercase tracking-[0.09em] hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D14E24]"
            >
              Name {getSortArrow("name")}
            </button>
          ) : (
            <>Name {sort === "name" ? <ArrowUp size={12} aria-hidden="true" /> : sort === "type" ? <span className="normal-case">(by type)</span> : null}</>
          )}
        </div>
      </div>
      <div role="columnheader" data-column="updated" aria-sort={sort === "updated" ? (sortDirection === "asc" ? "ascending" : "descending") : undefined} className="min-w-0">
        {onSort ? (
          <button
            type="button"
            onClick={() => onSort("updated")}
            className="inline-flex items-center gap-1 uppercase tracking-[0.09em] hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D14E24]"
          >
            {updatedLabel} {getSortArrow("updated")}
          </button>
        ) : (
          <>{updatedLabel} {sort === "updated" && <ArrowDown size={12} aria-hidden="true" />}</>
        )}
      </div>
      <div
        role="columnheader"
        data-column="size"
        aria-sort={sort === "size" ? (sortDirection === "asc" ? "ascending" : "descending") : undefined}
        className="min-w-0 text-right"
      >
        {onSort ? (
          <button
            type="button"
            onClick={() => onSort("size")}
            className="inline-flex items-center gap-1 uppercase tracking-[0.09em] hover:text-foreground focus:outline-none focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#D14E24]"
          >
            {sizeLabel} {getSortArrow("size")}
          </button>
        ) : (
          sizeLabel
        )}
      </div>
      <div role="columnheader" data-column="by" className="min-w-0 uppercase tracking-[0.09em]">
        {byLabel}
      </div>
      <div role="columnheader" data-column="actions"><span className="sr-only">Actions</span></div>
    </div>
  );
}

export default FolderListHeader;
