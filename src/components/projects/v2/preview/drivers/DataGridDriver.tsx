"use client";

import * as React from "react";
import { TableVirtuoso } from "react-virtuoso";
import {
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Copy,
  Check,
  Download,
  Table as TableIcon,
  ClipboardList,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { toast } from "@/lib/feedback";
import { cn } from "@/lib/utils";

export interface SheetData {
  name: string;
  headers: string[];
  rows: string[][];
}

interface DataGridDriverProps {
  fileName: string;
  sheets: SheetData[];
  signedUrl?: string;
}

const TableComponent = React.forwardRef<HTMLTableElement, React.ComponentPropsWithoutRef<"table">>(
  ({ style, className, ...props }, ref) => (
    <table
      ref={ref}
      role="grid"
      aria-label="Spreadsheet data table"
      {...props}
      style={{ ...style, tableLayout: "fixed", width: "100%" }}
      className={cn("w-full border-collapse border-spacing-0", className)}
    />
  ),
);
TableComponent.displayName = "TableComponent";

const TableRowComponent = React.forwardRef<HTMLTableRowElement, React.ComponentPropsWithoutRef<"tr">>(
  ({ className, ...props }, ref) => (
    <tr
      ref={ref}
      role="row"
      {...props}
      className={cn("hover:bg-muted/30 transition-colors", className)}
    />
  ),
);
TableRowComponent.displayName = "TableRowComponent";

export function DataGridDriver({
  fileName,
  sheets,
  signedUrl,
}: DataGridDriverProps): React.JSX.Element {
  const [activeSheetIndex, setActiveSheetIndex] = React.useState(0);
  const [searchQuery, setSearchQuery] = React.useState("");
  const deferredSearch = React.useDeferredValue(searchQuery);

  const [sortColumnIndex, setSortColumnIndex] = React.useState<number | null>(null);
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">("asc");
  const [copiedCell, setCopiedCell] = React.useState<string | null>(null);
  const [selectedCell, setSelectedCell] = React.useState<{ coord: string; val: string } | null>(null);
  const [colWidths, setColWidths] = React.useState<Record<number, number>>({});
  const [resizingCol, setResizingCol] = React.useState<{
    colIndex: number;
    startX: number;
    startWidth: number;
  } | null>(null);

  // Reset custom column widths and selection on sheet switch
  React.useEffect(() => {
    setColWidths({});
    setSelectedCell(null);
  }, [activeSheetIndex]);

  const startResize = React.useCallback(
    (colIndex: number, e: React.MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
      const currentWidth = colWidths[colIndex] || 150;
      setResizingCol({ colIndex, startX: e.clientX, startWidth: currentWidth });
    },
    [colWidths],
  );

  React.useEffect(() => {
    if (!resizingCol) return;

    const onMouseMove = (e: MouseEvent) => {
      const delta = e.clientX - resizingCol.startX;
      const nextWidth = Math.max(70, Math.min(600, resizingCol.startWidth + delta));
      setColWidths((prev) => ({ ...prev, [resizingCol.colIndex]: nextWidth }));
    };

    const onMouseUp = () => {
      setResizingCol(null);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [resizingCol]);

  const currentSheet = sheets[activeSheetIndex] || {
    name: "Sheet1",
    headers: [],
    rows: [],
  };

  // Strip trailing completely empty rows so sheet only displays meaningful records
  const cleanedRows = React.useMemo(() => {
    const raw = currentSheet.rows;
    let lastIdx = raw.length - 1;
    while (lastIdx >= 0) {
      const row = raw[lastIdx];
      if (row && row.some((c) => c && c.trim() !== "")) {
        break;
      }
      lastIdx--;
    }
    return lastIdx >= 0 ? raw.slice(0, lastIdx + 1) : [];
  }, [currentSheet.rows]);

  const autoFitCol = React.useCallback(
    (colIndex: number, e: React.MouseEvent) => {
      e.stopPropagation();
      const headerLen = (currentSheet.headers[colIndex] || "").length;
      let maxLen = headerLen;
      for (let r = 0; r < Math.min(60, cleanedRows.length); r++) {
        const cellLen = (cleanedRows[r]?.[colIndex] || "").length;
        if (cellLen > maxLen) maxLen = cellLen;
      }
      const computedWidth = Math.max(90, Math.min(450, maxLen * 8.5 + 36));
      setColWidths((prev) => ({ ...prev, [colIndex]: computedWidth }));
    },
    [cleanedRows, currentSheet.headers],
  );

  // Filter rows based on search with deferred value to prevent main-thread freezing
  const filteredRows = React.useMemo(() => {
    let result = cleanedRows;
    if (deferredSearch.trim()) {
      const q = deferredSearch.toLowerCase();
      result = result.filter((row) =>
        row.some((cell) => cell.toLowerCase().includes(q)),
      );
    }

    if (sortColumnIndex !== null) {
      result = [...result].sort((a, b) => {
        const valA = a[sortColumnIndex] || "";
        const valB = b[sortColumnIndex] || "";
        const numA = Number(valA);
        const numB = Number(valB);
        if (!isNaN(numA) && !isNaN(numB)) {
          return sortDirection === "asc" ? numA - numB : numB - numA;
        }
        if (valA === valB) return 0;
        return sortDirection === "asc"
          ? (valA > valB ? 1 : -1)
          : (valA < valB ? 1 : -1);
      });
    }

    return result;
  }, [cleanedRows, deferredSearch, sortColumnIndex, sortDirection]);

  const handleHeaderClick = React.useCallback(
    (index: number) => {
      if (sortColumnIndex === index) {
        if (sortDirection === "asc") {
          setSortDirection("desc");
        } else {
          setSortColumnIndex(null);
          setSortDirection("asc");
        }
      } else {
        setSortColumnIndex(index);
        setSortDirection("asc");
      }
    },
    [sortColumnIndex, sortDirection],
  );

  const copyCell = React.useCallback(async (text: string, coord: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCell(coord);
      toast.success("Cell value copied");
      setTimeout(() => setCopiedCell(null), 1500);
    } catch {
      toast.error("Couldn’t copy the cell");
    }
  }, []);

  const copyTableAsTsv = React.useCallback(async () => {
    try {
      const headerLine = currentSheet.headers.join("\t");
      const dataLines = filteredRows.map((r) => r.join("\t")).join("\n");
      const tsv = `${headerLine}\n${dataLines}`;
      await navigator.clipboard.writeText(tsv);
      toast.success(`Table copied`);
    } catch {
      toast.error("Couldn’t copy the table");
    }
  }, [currentSheet.headers, filteredRows]);

  // Keyboard shortcut: Cmd/Ctrl + C copies the selected cell; Shift + Cmd/Ctrl + C copies whole table as TSV
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)
      ) {
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "c") {
        if (e.shiftKey) {
          e.preventDefault();
          copyTableAsTsv();
        } else if (selectedCell) {
          e.preventDefault();
          copyCell(selectedCell.val, selectedCell.coord);
        }
      }
    },
    [copyCell, copyTableAsTsv, selectedCell],
  );

  const virtuosoComponents = React.useMemo(
    () => ({
      Table: TableComponent,
      TableRow: TableRowComponent,
    }),
    [],
  );

  const selectedInfo = React.useMemo(() => {
    if (!selectedCell) return null;
    const [rStr, cStr] = selectedCell.coord.split("-");
    const r = parseInt(rStr ?? "0", 10);
    const c = parseInt(cStr ?? "0", 10);
    const colName = currentSheet.headers[c] || `Col ${c + 1}`;
    return {
      row: r + 1,
      col: c + 1,
      colName,
      val: selectedCell.val,
    };
  }, [selectedCell, currentSheet.headers]);

  const fixedHeaderContent = React.useCallback(() => (
    <tr role="row" className="bg-muted border-b border-border text-left shadow-xs">
      <th
        role="columnheader"
        aria-label="Row Number"
        className="sticky left-0 z-40 w-12 border-b border-r border-border bg-muted p-2 text-center font-mono text-[10px] font-semibold text-muted-foreground select-none"
      >
        #
      </th>
      {currentSheet.headers.map((header, idx) => {
        const width = colWidths[idx] || 150;
        return (
          <th
            key={idx}
            role="columnheader"
            aria-sort={
              sortColumnIndex === idx
                ? sortDirection === "asc"
                  ? "ascending"
                  : "descending"
                : "none"
            }
            onClick={() => handleHeaderClick(idx)}
            style={{ width, minWidth: width, maxWidth: width }}
            className="relative border-b border-r border-border p-2 text-xs font-semibold text-foreground select-none cursor-pointer hover:bg-muted/80 transition-colors"
          >
            <div className="flex items-center justify-between gap-1.5 pr-2 overflow-hidden">
              <span className="truncate">{header}</span>
              {sortColumnIndex === idx ? (
                sortDirection === "asc" ? (
                  <ArrowUp className="h-3.5 w-3.5 shrink-0 text-primary" />
                ) : (
                  <ArrowDown className="h-3.5 w-3.5 shrink-0 text-primary" />
                )
              ) : (
                <ArrowUpDown className="h-3 w-3 shrink-0 opacity-20 hover:opacity-100" />
              )}
            </div>
            {/* Draggable Column Divider with Auto-fit Double Click */}
            <div
              onMouseDown={(e) => startResize(idx, e)}
              onDoubleClick={(e) => autoFitCol(idx, e)}
              onClick={(e) => e.stopPropagation()}
              className="absolute right-0 top-0 bottom-0 w-2 cursor-col-resize hover:bg-primary/50 transition-colors z-30"
              title="Drag to resize column · Double-click to auto-fit"
            />
          </th>
        );
      })}
    </tr>
  ), [autoFitCol, colWidths, currentSheet.headers, handleHeaderClick, sortColumnIndex, sortDirection, startResize]);

  const itemContent = React.useCallback((rowIndex: number, row: string[]) => (
    <>
      <td
        role="gridcell"
        className="sticky left-0 z-10 w-12 border-b border-r border-border bg-muted/95 backdrop-blur-xs p-2 text-center font-mono text-[10px] text-muted-foreground select-none"
      >
        {rowIndex + 1}
      </td>
      {row.map((cell, colIndex) => {
        const coord = `${rowIndex}-${colIndex}`;
        const isCopied = copiedCell === coord;
        const isSelected = selectedCell?.coord === coord;
        const width = colWidths[colIndex] || 150;
        return (
          <td
            key={colIndex}
            role="gridcell"
            aria-selected={isSelected}
            onClick={() => setSelectedCell({ coord, val: cell })}
            onDoubleClick={() => copyCell(cell, coord)}
            style={{ width, minWidth: width, maxWidth: width }}
            className={cn(
              "group border-b border-r border-border p-2 text-xs text-foreground/90 select-text cursor-cell truncate",
              isSelected ? "bg-primary/10 ring-1 ring-inset ring-primary" : "",
              isCopied && "bg-emerald-500/10",
            )}
            title="Click to select · Double-click or Cmd+C to copy"
          >
            <div className="flex items-center justify-between gap-2 overflow-hidden">
              <span className={cn("truncate", !isNaN(Number(cell.trim())) && cell.trim() !== "" ? "font-mono text-right" : "")}>
                {cell}
              </span>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  copyCell(cell, coord);
                }}
                className="opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity p-0.5 rounded-[3px] hover:bg-muted shrink-0"
                title="Copy cell"
              >
                {isCopied ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3 text-muted-foreground" />
                )}
              </button>
            </div>
          </td>
        );
      })}
    </>
  ), [colWidths, copiedCell, copyCell, selectedCell]);

  return (
    <div
      onKeyDown={handleKeyDown}
      tabIndex={0}
      className="flex h-full w-full flex-col bg-background outline-none select-none"
    >
      {/* Top Search & Action Bar */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4 bg-card/60 backdrop-blur-xs">
        <div className="flex items-center gap-2 min-w-0">
          <TableIcon className="h-4 w-4 text-primary shrink-0" />
          <span className="text-xs font-semibold text-foreground truncate max-w-[200px]" title={fileName}>
            {fileName}
          </span>
          <span className="text-[11px] text-muted-foreground hidden sm:inline">
            ({filteredRows.length} {filteredRows.length === 1 ? "row" : "rows"})
          </span>
        </div>

        <div className="flex items-center gap-2">
          {/* Fast Search Input */}
          <div className="relative flex items-center">
            <Search className="absolute left-2.5 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              type="text"
              placeholder="Search table…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 w-36 sm:w-48 pl-8 text-xs bg-muted/40 border-border"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 text-[10px] text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            )}
          </div>

          <Button
            size="sm"
            variant="outline"
            onClick={copyTableAsTsv}
            className="h-7 px-2.5 text-xs"
            title="Copy entire filtered table to clipboard as TSV (Shift+Cmd+C)"
          >
            <ClipboardList className="mr-1 h-3.5 w-3.5" />
            <span className="hidden sm:inline">Copy TSV</span>
          </Button>

          {signedUrl && (
            <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-xs">
              <a href={signedUrl} download={fileName} title="Download file">
                <Download className="mr-1 h-3.5 w-3.5" />
                <span className="hidden sm:inline">Download</span>
              </a>
            </Button>
          )}
        </div>
      </div>

      {/* Virtualized Table Grid */}
      <div className="flex-1 min-h-0 overflow-hidden relative">
        {filteredRows.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center p-8 text-center text-muted-foreground">
            <p className="text-sm font-medium">No matching records found</p>
            {searchQuery && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSearchQuery("")}
                className="mt-2 text-xs text-primary"
              >
                Clear filter
              </Button>
            )}
          </div>
        ) : (
          <TableVirtuoso
            className="app-scroll h-full w-full"
            data={filteredRows}
            components={virtuosoComponents}
            overscan={200}
            fixedItemHeight={37}
            defaultItemHeight={37}
            fixedHeaderContent={fixedHeaderContent}
            itemContent={itemContent}
          />
        )}
      </div>

      {/* Multi-Sheet Tab Navigation (if XLSX has multiple sheets) */}
      {sheets.length > 1 && (
        <div className="flex h-9 shrink-0 items-center gap-1 border-t border-border bg-muted/40 px-3 overflow-x-auto">
          {sheets.map((sheet, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => {
                setActiveSheetIndex(idx);
                setSearchQuery("");
                setSortColumnIndex(null);
                setSelectedCell(null);
              }}
              className={cn(
                "flex items-center gap-1.5 rounded-t-md border-t border-x border-border px-3 py-1 text-xs font-medium transition-colors shrink-0",
                activeSheetIndex === idx
                  ? "bg-background text-primary border-b-0 shadow-2xs"
                  : "bg-muted/60 text-muted-foreground hover:bg-background/60 hover:text-foreground",
              )}
            >
              <TableIcon className="h-3 w-3" />
              <span>{sheet.name}</span>
              <span className="text-[10px] text-muted-foreground opacity-70">
                ({sheet.rows.length})
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Enterprise Status Bar Footer */}
      <div className="flex h-7 shrink-0 items-center justify-between border-t border-border bg-card/80 px-3 text-[11px] text-muted-foreground select-none">
        <div className="flex items-center gap-3 overflow-hidden">
          <span className="flex items-center gap-1 font-medium text-foreground">
            <TableIcon className="h-3 w-3 text-primary" />
            {currentSheet.name}
          </span>
          <span>•</span>
          <span>
            {filteredRows.length.toLocaleString()} of {cleanedRows.length.toLocaleString()} rows
            {searchQuery && " (filtered)"}
          </span>
          <span>•</span>
          <span>{currentSheet.headers.length} columns</span>
        </div>

        <div className="flex items-center gap-3 shrink-0">
          {selectedInfo ? (
            <span className="font-mono text-[10px] text-foreground bg-muted/60 px-1.5 py-0.5 rounded-[3px] border border-border/50">
              Row {selectedInfo.row}, {selectedInfo.colName}
            </span>
          ) : (
            <span className="text-[10px] text-muted-foreground/80 hidden sm:inline">
              Click cell to select · Cmd+C copy
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
