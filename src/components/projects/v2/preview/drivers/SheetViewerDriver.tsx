"use client";

import * as React from "react";
import { Loader2, AlertTriangle, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectNode } from "@/lib/db/schema";
import { extOf } from "../../utils/fileKind";
import { DataGridDriver, type SheetData } from "./DataGridDriver";
import * as fflate from "fflate";

interface SheetViewerDriverProps {
  node: ProjectNode;
  signedUrl: string;
}

export function SheetViewerDriver({
  node,
  signedUrl,
}: SheetViewerDriverProps): React.JSX.Element {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [sheets, setSheets] = React.useState<SheetData[]>([]);

  const ext = React.useMemo(() => extOf(node.name), [node.name]);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    async function loadSpreadsheet() {
      try {
        const res = await fetch(signedUrl);
        if (!res.ok) throw new Error("Failed to fetch spreadsheet file");

        if (ext === "csv" || ext === "tsv") {
          const text = await res.text();
          const delimiter = ext === "tsv" ? "\t" : ",";
          const parsed = parseDelimitedText(text, delimiter);
          if (active) {
            setSheets([{ name: "Data", headers: parsed.headers, rows: parsed.rows }]);
            setLoading(false);
          }
          return;
        }

        // XLSX workbook parsing via fflate
        const buffer = await res.arrayBuffer();
        const unzipped = fflate.unzipSync(new Uint8Array(buffer));

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

        // 2. Parse workbook sheet names
        const workbookSheets: { name: string; sheetId: string }[] = [];
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
            workbookSheets.push({ name, sheetId: `${i + 1}` });
          }
        }

        if (workbookSheets.length === 0) {
          workbookSheets.push({ name: "Sheet1", sheetId: "1" });
        }

        // 3. Parse each sheet
        const parsedSheets: SheetData[] = [];
        for (let sIdx = 0; sIdx < workbookSheets.length; sIdx++) {
          const wsInfo = workbookSheets[sIdx];
          if (!wsInfo) continue;
          const sheetFile = unzipped[`xl/worksheets/sheet${sIdx + 1}.xml`] || unzipped[`xl/worksheets/sheet1.xml`];
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
              const type = cell.getAttribute("t");
              const valEl = cell.getElementsByTagName("v")[0];
              const rawVal = valEl?.textContent || "";

              let finalVal = rawVal;
              if (type === "s") {
                const sIndex = parseInt(rawVal, 10);
                finalVal = !isNaN(sIndex) && sharedStrings[sIndex] !== undefined ? sharedStrings[sIndex]! : rawVal;
              }
              rowValues.push(finalVal);
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
          setSheets(parsedSheets);
          setLoading(false);
        }
      } catch (err: any) {
        if (active) {
          setError(err?.message || "Failed to parse spreadsheet");
          setLoading(false);
        }
      }
    }

    loadSpreadsheet();

    return () => {
      active = false;
    };
  }, [ext, signedUrl]);

  if (loading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Parsing spreadsheet data...</p>
      </div>
    );
  }

  if (error || sheets.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <p className="text-sm font-semibold text-foreground">Unable to render spreadsheet preview</p>
        <p className="max-w-md text-xs text-muted-foreground">{error}</p>
        <Button asChild size="sm" variant="outline" className="mt-2">
          <a href={signedUrl} download={node.name}>
            <Download className="mr-1.5 h-4 w-4" />
            Download Spreadsheet
          </a>
        </Button>
      </div>
    );
  }

  return <DataGridDriver fileName={node.name} sheets={sheets} signedUrl={signedUrl} />;
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
