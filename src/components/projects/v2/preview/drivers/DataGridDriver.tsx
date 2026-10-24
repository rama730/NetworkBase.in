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
  }, [currentSheet.rows, deferredSearch, sortColumnIndex, sortDirection]);

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
      toast.error("Failed to copy cell value");
    }
  }, []);

  // Keyboard shortcut: Cmd/Ctrl + C copies the selected cell
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "c" && selectedCell) {
        e.preventDefault();
        copyCell(selectedCell.val, selectedCell.coord);
      }
    },
    [copyCell, selectedCell],
  );

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
              placeholder="Search table..."
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
            fixedHeaderContent={() => (
              <tr className="bg-muted/90 text-left backdrop-blur-md">
                <th className="w-12 border-b border-r border-border p-2 text-center font-mono text-[10px] font-semibold text-muted-foreground select-none">
                  #
                </th>
                {currentSheet.headers.map((header, idx) => (
                  <th
                    key={idx}
                    onClick={() => handleHeaderClick(idx)}
                    className="min-w-32 border-b border-r border-border p-2 text-xs font-semibold text-foreground select-none cursor-pointer hover:bg-muted transition-colors"
                  >
                    <div className="flex items-center justify-between gap-1.5">
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
                  </th>
                ))}
              </tr>
            )}
            itemContent={(rowIndex, row) => (
              <>
                <td className="w-12 border-b border-r border-border bg-muted/20 p-2 text-center font-mono text-[10px] text-muted-foreground select-none">
                  {rowIndex + 1}
                </td>
                {row.map((cell, colIndex) => {
                  const coord = `${rowIndex}-${colIndex}`;
                  const isCopied = copiedCell === coord;
                  const isSelected = selectedCell?.coord === coord;
                  return (
                    <td
                      key={colIndex}
                      onClick={() => setSelectedCell({ coord, val: cell })}
                      onDoubleClick={() => copyCell(cell, coord)}
                      className={cn(
                        "group border-b border-r border-border p-2 text-xs text-foreground/90 transition-colors select-text cursor-cell",
                        isSelected ? "bg-primary/10 ring-1 ring-inset ring-primary" : "hover:bg-muted/30",
                        isCopied && "bg-emerald-500/10",
                      )}
                      title="Click to select · Double-click or Cmd+C to copy"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{cell}</span>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            copyCell(cell, coord);
                          }}
                          className="opacity-0 group-hover:opacity-60 hover:opacity-100 transition-opacity p-0.5 rounded-[3px] hover:bg-muted"
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
            )}
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
    </div>
  );
}
