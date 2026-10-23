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
  const [sortColumnIndex, setSortColumnIndex] = React.useState<number | null>(null);
  const [sortDirection, setSortDirection] = React.useState<"asc" | "desc">("asc");
  const [copiedCell, setCopiedCell] = React.useState<string | null>(null);

  const currentSheet = sheets[activeSheetIndex] || {
    name: "Sheet1",
    headers: [],
    rows: [],
  };

  // Filter rows based on search
  const filteredRows = React.useMemo(() => {
    let result = currentSheet.rows;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
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
        return sortDirection === "asc"
          ? valA.localeCompare(valB)
          : valB.localeCompare(valA);
      });
    }

    return result;
  }, [currentSheet.rows, searchQuery, sortColumnIndex, sortDirection]);

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
      toast.error("Failed to copy cell");
    }
  }, []);

  return (
    <div className="flex h-full w-full flex-col bg-background">
      {/* Top Search & Stats Toolbar */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border px-4">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <TableIcon className="h-4 w-4 text-emerald-500" />
            <span className="text-xs font-semibold text-foreground">{fileName}</span>
          </div>

          <div className="relative w-48 sm:w-64">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search table..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-7 pl-8 text-xs"
            />
          </div>

          <span className="text-[11px] text-muted-foreground">
            {filteredRows.length.toLocaleString()} rows · {currentSheet.headers.length} columns
          </span>
        </div>

        {signedUrl && (
          <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
            <a href={signedUrl} download={fileName}>
              <Download className="mr-1 h-3.5 w-3.5" />
              Download
            </a>
          </Button>
        )}
      </div>

      {/* Virtualized Table Body */}
      <div className="flex-1 overflow-hidden">
        {filteredRows.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 text-muted-foreground">
            <p className="text-xs">No matching rows found</p>
          </div>
        ) : (
          <TableVirtuoso
            style={{ height: "100%" }}
            data={filteredRows}
            fixedHeaderContent={() => (
              <tr className="border-b border-border bg-muted/90 backdrop-blur-sm">
                <th className="w-12 border-r border-border p-2 text-center text-[10px] font-semibold text-muted-foreground select-none">
                  #
                </th>
                {currentSheet.headers.map((header, colIndex) => (
                  <th
                    key={colIndex}
                    onClick={() => handleHeaderClick(colIndex)}
                    className="cursor-pointer border-r border-border p-2 text-left text-xs font-semibold text-foreground select-none hover:bg-muted"
                  >
                    <div className="flex items-center justify-between gap-1">
                      <span className="truncate">{header}</span>
                      {sortColumnIndex === colIndex ? (
                        sortDirection === "asc" ? (
                          <ArrowUp className="h-3 w-3 shrink-0 text-primary" />
                        ) : (
                          <ArrowDown className="h-3 w-3 shrink-0 text-primary" />
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
                  return (
                    <td
                      key={colIndex}
                      onClick={() => copyCell(cell, coord)}
                      className={cn(
                        "group cursor-pointer border-b border-r border-border p-2 text-xs text-foreground/90 transition-colors hover:bg-primary/5",
                        isCopied && "bg-emerald-500/10",
                      )}
                      title="Click to copy value"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate">{cell}</span>
                        {isCopied ? (
                          <Check className="h-3 w-3 shrink-0 text-emerald-500" />
                        ) : (
                          <Copy className="h-3 w-3 shrink-0 opacity-0 group-hover:opacity-40" />
                        )}
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
              }}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-medium transition-colors select-none",
                activeSheetIndex === idx
                  ? "bg-background text-foreground shadow-sm border border-border"
                  : "text-muted-foreground hover:text-foreground hover:bg-muted/60",
              )}
            >
              {sheet.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
