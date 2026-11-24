"use client";

import * as React from "react";
import { AlertTriangle, Download, FileSpreadsheet } from "@/components/ui/icons";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkspaceNode } from "@/lib/db/schema";
import { extOf } from "../../utils/fileKind";
import { formatBytes } from "../../files-tab/folder/format";
import { DataGridDriver, type SheetData } from "./DataGridDriver";
import * as fflate from "fflate";
import { DownloadLink } from "@/components/ui/download-link";

interface SheetViewerDriverProps {
  node: WorkspaceNode;
  fileUrl: string;
}

const MAX_SHEET_CACHE_ENTRIES = 2;
const sheetPreviewCache = new Map<string, { sheets: SheetData[]; isLegacy: boolean }>();

function getCachedSheetPreview(url: string): { sheets: SheetData[]; isLegacy: boolean } | null {
  const existing = sheetPreviewCache.get(url);
  if (!existing) return null;
  sheetPreviewCache.delete(url);
  sheetPreviewCache.set(url, existing);
  return existing;
}

function setCachedSheetPreview(url: string, value: { sheets: SheetData[]; isLegacy: boolean }) {
  sheetPreviewCache.delete(url);
  while (sheetPreviewCache.size >= MAX_SHEET_CACHE_ENTRIES) {
    const oldestKey = sheetPreviewCache.keys().next().value;
    if (!oldestKey) break;
    sheetPreviewCache.delete(oldestKey);
  }
  sheetPreviewCache.set(url, value);
}

/** Converts an Excel column reference (e.g. 'A', 'D', 'AA') to 0-based index */
function colRefToIndex(cellRef: string): number {
  const match = cellRef.match(/^[A-Z]+/i);
  if (!match) return -1;
  const letters = match[0].toUpperCase();
  let col = 0;
  for (let i = 0; i < letters.length; i++) {
    col = col * 26 + (letters.charCodeAt(i) - 64);
  }
  return col - 1;
}

/** Offloads heavy decompression and XML parsing to a background Web Worker */
async function parseWithWorker(
  buffer: ArrayBuffer,
): Promise<{ sheets: SheetData[]; isLegacy?: boolean } | null> {
  if (typeof window === "undefined" || typeof Worker === "undefined") {
    return null;
  }
  return new Promise((resolve) => {
    try {
      const worker = new Worker(
        new URL("../workers/document-parser.worker.ts", import.meta.url)
      );
      const id = Math.random().toString(36).slice(2);
      const timer = setTimeout(() => {
        try {
          worker.terminate();
        } catch {}
        resolve(null);
      }, 15000);

      worker.onmessage = (e: MessageEvent<any>) => {
        if (e.data?.id === id) {
          clearTimeout(timer);
          try {
            worker.terminate();
          } catch {}
          if (e.data.success) {
            resolve({ sheets: e.data.sheets, isLegacy: e.data.isLegacy });
          } else {
            resolve(null);
          }
        }
      };

      worker.onerror = () => {
        clearTimeout(timer);
        try {
          worker.terminate();
        } catch {}
        resolve(null);
      };

      worker.postMessage({ id, type: "xlsx", buffer }, [buffer]);
    } catch {
      resolve(null);
    }
  });
}

export function SheetViewerDriver({
  node,
  fileUrl,
}: SheetViewerDriverProps): React.JSX.Element {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [sheets, setSheets] = React.useState<SheetData[]>([]);
  const [isLegacy, setIsLegacy] = React.useState(false);

  const ext = React.useMemo(() => extOf(node.name), [node.name]);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setIsLegacy(false);

    async function loadSpreadsheet() {
      try {
        const cached = getCachedSheetPreview(fileUrl);
        if (cached) {
          if (active) {
            setIsLegacy(cached.isLegacy);
            setSheets(cached.sheets);
            setLoading(false);
          }
          return;
        }

        const res = await fetch(fileUrl);
        if (!res.ok) throw new Error("Couldn’t fetch spreadsheet file");

        // CSV / TSV text parsing
        if (ext === "csv" || ext === "tsv") {
          const text = await res.text();
          const delimiter = ext === "tsv" ? "\t" : ",";
          const parsed = parseDelimitedText(text, delimiter);
          const csvSheets = [{ name: "Data", headers: parsed.headers, rows: parsed.rows }];
          setCachedSheetPreview(fileUrl, { sheets: csvSheets, isLegacy: false });
          if (active) {
            setSheets(csvSheets);
            setLoading(false);
          }
          return;
        }

        const buffer = await res.arrayBuffer();

        // Safety limit: 60 MB buffer
        if (buffer.byteLength > 60 * 1024 * 1024) {
          throw new Error("File exceeds client-side preview safety limit (60 MB). Download to view.");
        }

        // Check for legacy Excel 97-2003 OLE2 binary header (0xD0 0xCF 0x11 0xE0)
        const uint8 = new Uint8Array(buffer);
        if (
          uint8.length >= 4 &&
          uint8[0] === 0xd0 &&
          uint8[1] === 0xcf &&
          uint8[2] === 0x11 &&
          uint8[3] === 0xe0
        ) {
          setCachedSheetPreview(fileUrl, { sheets: [], isLegacy: true });
          if (active) {
            setIsLegacy(true);
            setLoading(false);
          }
          return;
        }

        // Delegate heavy decompression & parsing to background Web Worker
        const workerResult = await parseWithWorker(buffer.slice(0));
        if (workerResult) {
          setCachedSheetPreview(fileUrl, {
            sheets: workerResult.sheets,
            isLegacy: Boolean(workerResult.isLegacy),
          });
          if (active) {
            if (workerResult.isLegacy) {
              setIsLegacy(true);
            } else {
              setSheets(workerResult.sheets);
            }
            setLoading(false);
          }
          return;
        }

        // Fallback: in-thread XLSX workbook parsing via fflate
        let unzipped: fflate.Unzipped | null = null;
        try {
          unzipped = fflate.unzipSync(uint8);
        } catch {
          // If unzip fails, check if the file is plain text (like an unencoded CSV with .xlsx extension)
          const textDecoder = new TextDecoder("utf-8");
          const text = textDecoder.decode(buffer);
          if (/^[\x20-\x7E\s\r\n\t]+$/.test(text.slice(0, 1024))) {
            const parsed = parseDelimitedText(text, ",");
            if (active) {
              setSheets([{ name: "Text content", headers: parsed.headers, rows: parsed.rows }]);
              setLoading(false);
            }
            return;
          }

          if (active) {
            setIsLegacy(true);
            setLoading(false);
          }
          return;
        }

        // 1. Parse shared strings if present
        const sharedStrings: string[] = [];
        const sharedEntry = unzipped["xl/sharedStrings.xml"];
        if (sharedEntry) {
          const decoder = new TextDecoder("utf-8");
          const xml = decoder.decode(sharedEntry);
          const parser = new DOMParser();
          const doc = parser.parseFromString(xml, "application/xml");
          const siNodes = doc.getElementsByTagName("si");
          for (let i = 0; i < siNodes.length; i++) {
            const si = siNodes[i];
            const textNodes = si?.getElementsByTagName("t");
            let str = "";
            if (textNodes) {
              for (let t = 0; t < textNodes.length; t++) {
                str += textNodes[t]?.textContent || "";
              }
            }
            sharedStrings.push(str);
          }
        }

        // 2. Parse workbook relationship mapping (rId -> physical sheet path)
        const relsMap = new Map<string, string>();
        const relsEntry = unzipped["xl/_rels/workbook.xml.rels"];
        if (relsEntry) {
          const decoder = new TextDecoder("utf-8");
          const xml = decoder.decode(relsEntry);
          const parser = new DOMParser();
          const doc = parser.parseFromString(xml, "application/xml");
          const relNodes = doc.getElementsByTagName("Relationship");
          for (let i = 0; i < relNodes.length; i++) {
            const rel = relNodes[i];
            const id = rel?.getAttribute("Id");
            const target = rel?.getAttribute("Target");
            if (id && target) {
              const fullPath = target.startsWith("xl/") ? target : `xl/${target}`;
              relsMap.set(id, fullPath.replace(/\\/g, "/"));
            }
          }
        }

        // 3. Parse workbook sheet definitions
        const workbookSheets: { name: string; path: string }[] = [];
        const wbEntry = unzipped["xl/workbook.xml"];
        if (wbEntry) {
          const decoder = new TextDecoder("utf-8");
          const xml = decoder.decode(wbEntry);
          const parser = new DOMParser();
          const doc = parser.parseFromString(xml, "application/xml");
          const sheetNodes = doc.getElementsByTagName("sheet");
          for (let i = 0; i < sheetNodes.length; i++) {
            const s = sheetNodes[i];
            const name = s?.getAttribute("name") || `Sheet${i + 1}`;
            const rId = s?.getAttribute("r:id") || s?.getAttribute("id") || "";
            const resolvedPath = relsMap.get(rId) || `xl/worksheets/sheet${i + 1}.xml`;
            workbookSheets.push({ name, path: resolvedPath });
          }
        }

        if (workbookSheets.length === 0) {
          // Fallback: search for any sheet XML files in zip
          for (const key of Object.keys(unzipped)) {
            if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(key)) {
              workbookSheets.push({ name: `Sheet ${workbookSheets.length + 1}`, path: key });
            }
          }
        }

        // 4. Parse rows & cells for each sheet with coordinate-based column mapping
        const parsedSheets: SheetData[] = [];
        for (let sIdx = 0; sIdx < workbookSheets.length; sIdx++) {
          const wsInfo = workbookSheets[sIdx];
          if (!wsInfo) continue;
          const sheetFile = unzipped[wsInfo.path] || unzipped[`xl/worksheets/sheet${sIdx + 1}.xml`];
          if (!sheetFile) continue;

          const decoder = new TextDecoder("utf-8");
          const xml = decoder.decode(sheetFile);
          const parser = new DOMParser();
          const doc = parser.parseFromString(xml, "application/xml");

          const rowElements = doc.getElementsByTagName("row");
          const allRows: string[][] = [];

          for (let r = 0; r < rowElements.length; r++) {
            const rowEl = rowElements[r];
            if (!rowEl) continue;
            const cellElements = rowEl.getElementsByTagName("c");
            const rowValues: string[] = [];

            for (let c = 0; c < cellElements.length; c++) {
              const cell = cellElements[c];
              if (!cell) continue;

              const cellRef = cell.getAttribute("r") || "";
              const colIdx = colRefToIndex(cellRef);
              const type = cell.getAttribute("t");
              const valEl = cell.getElementsByTagName("v")[0];
              const rawVal = valEl?.textContent || "";

              let finalVal = rawVal;

              // Shared string
              if (type === "s") {
                const sIndex = parseInt(rawVal, 10);
                finalVal = !isNaN(sIndex) && sharedStrings[sIndex] !== undefined ? sharedStrings[sIndex]! : rawVal;
              }
              // Inline string (<is><t>)
              else if (type === "inlineStr") {
                const isEl = cell.getElementsByTagName("is")[0];
                const tEls = isEl?.getElementsByTagName("t");
                if (tEls) {
                  let str = "";
                  for (let t = 0; t < tEls.length; t++) str += tEls[t]?.textContent || "";
                  finalVal = str;
                }
              }
              // Boolean
              else if (type === "b") {
                finalVal = rawVal === "1" ? "TRUE" : "FALSE";
              }
              // Error
              else if (type === "e") {
                finalVal = rawVal || "#ERROR";
              }

              // Place at exact column index (no sparse shifting)
              const targetCol = colIdx >= 0 ? colIdx : rowValues.length;
              while (rowValues.length < targetCol) {
                rowValues.push("");
              }
              rowValues[targetCol] = finalVal;
            }

            if (rowValues.some((v) => v.trim() !== "")) {
              allRows.push(rowValues);
            }
          }

          if (allRows.length > 0) {
            const maxCols = Math.max(...allRows.map((r) => r.length));
            const headers = (allRows[0] || []).map((h, i) => (h.trim() ? h : `Col ${i + 1}`));
            while (headers.length < maxCols) {
              headers.push(`Col ${headers.length + 1}`);
            }

            const dataRows = allRows.slice(1).map((r) => {
              const row = [...r];
              while (row.length < maxCols) row.push("");
              return row;
            });

            parsedSheets.push({
              name: wsInfo.name,
              headers,
              rows: dataRows,
            });
          }
        }

        if (active) {
          if (parsedSheets.length === 0) {
            throw new Error("No readable spreadsheet data found in workbook");
          }
          setCachedSheetPreview(fileUrl, { sheets: parsedSheets, isLegacy: false });
          setSheets(parsedSheets);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (active) {
          const msg = err instanceof Error ? err.message : "Couldn’t parse spreadsheet";
          setError(msg);
          setLoading(false);
        }
      }
    }

    loadSpreadsheet();

    return () => {
      active = false;
    };
  }, [ext, fileUrl]);

  if (loading) {
    return <SheetSkeleton />;
  }

  // Graceful card for legacy .xls binary format
  if (isLegacy) {

    return (
      <div className="flex h-full w-full items-center justify-center bg-muted/10 p-6">
        <div className="flex max-w-md flex-col items-center rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <FileSpreadsheet className="h-8 w-8" />
          </div>

          <h3 className="max-w-sm truncate text-base font-semibold text-card-foreground" title={node.name}>
            {node.name}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Excel 97-2003 Workbook (.xls) • {formatBytes(node.size)}
          </p>

          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            This workbook uses the legacy binary format. You can download the file or open it in web spreadsheet viewers.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <Button asChild size="sm" className="h-9 px-4 text-xs font-medium">
              <DownloadLink href={fileUrl} filename={node.name}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download spreadsheet
              </DownloadLink>
            </Button>


          </div>
        </div>
      </div>
    );
  }

  if (error || sheets.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <p className="text-sm font-semibold text-foreground">Couldn’t render spreadsheet preview</p>
        <p className="max-w-md text-xs text-muted-foreground">{error}</p>
        <Button asChild size="sm" variant="outline" className="mt-2">
          <DownloadLink href={fileUrl} filename={node.name}>
            <Download className="mr-1.5 h-4 w-4" />
            Download spreadsheet
          </DownloadLink>
        </Button>
      </div>
    );
  }

  return <DataGridDriver fileName={node.name} sheets={sheets} fileUrl={fileUrl} />;
}

/** Robust CSV / TSV text parsing with quotation handling */
function parseDelimitedText(
  text: string,
  delimiter: string,
): { headers: string[]; rows: string[][] } {
  const lines: string[][] = [];
  let currentRow: string[] = [];
  let currentVal = "";
  let insideQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (char === '"') {
      if (insideQuotes && nextChar === '"') {
        currentVal += '"';
        i++;
      } else {
        insideQuotes = !insideQuotes;
      }
    } else if (char === delimiter && !insideQuotes) {
      currentRow.push(currentVal.trim());
      currentVal = "";
    } else if ((char === "\r" || char === "\n") && !insideQuotes) {
      if (char === "\r" && nextChar === "\n") i++;
      currentRow.push(currentVal.trim());
      if (currentRow.some((c) => c !== "")) {
        lines.push(currentRow);
      }
      currentRow = [];
      currentVal = "";
    } else {
      currentVal += char;
    }
  }

  if (currentVal || currentRow.length > 0) {
    currentRow.push(currentVal.trim());
    if (currentRow.some((c) => c !== "")) {
      lines.push(currentRow);
    }
  }

  if (lines.length === 0) {
    return { headers: ["Column 1"], rows: [] };
  }

  const maxCols = Math.max(...lines.map((r) => r.length));
  const rawHeaders = lines[0] || [];
  const headers = rawHeaders.map((h, i) => (h ? h : `Col ${i + 1}`));
  while (headers.length < maxCols) {
    headers.push(`Col ${headers.length + 1}`);
  }

  const rows = lines.slice(1).map((r) => {
    const row = [...r];
    while (row.length < maxCols) row.push("");
    return row;
  });

  return { headers, rows };
}

function SheetSkeleton(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading spreadsheet"
      className="flex h-full w-full flex-col bg-background p-4 gap-3 select-none"
    >
      <div className="flex items-center justify-between border-b border-border/40 pb-3">
        <Skeleton className="h-5 w-48 rounded-[3px]" />
        <div className="flex items-center gap-2">
          <Skeleton className="h-8 w-24 rounded-md" />
          <Skeleton className="h-8 w-24 rounded-md" />
        </div>
      </div>
      <div className="flex-1 rounded-md border border-border/60 p-3 space-y-2.5 overflow-hidden">
        <div className="grid grid-cols-6 gap-2 border-b border-border/40 pb-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-4 w-full rounded-[3px]" />
          ))}
        </div>
        {Array.from({ length: 12 }).map((_, r) => (
          <div key={r} className="grid grid-cols-6 gap-2 py-1">
            {Array.from({ length: 6 }).map((_, c) => (
              <Skeleton key={c} className="h-3.5 w-full rounded-[3px]" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
