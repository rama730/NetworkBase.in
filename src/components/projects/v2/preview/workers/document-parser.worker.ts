import * as fflate from "fflate";

export interface SheetData {
  name: string;
  headers: string[];
  rows: string[][];
}

export type ParseWorkerRequest =
  | { id: string; type: "xlsx"; buffer: ArrayBuffer }
  | { id: string; type: "csv" | "tsv"; text: string; delimiter: string };

export type ParseWorkerResponse =
  | { id: string; success: true; sheets: SheetData[]; isLegacy?: boolean }
  | { id: string; success: false; error: string; isLegacy?: boolean };

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

/** Formats an Excel date serial number (e.g. 45228.65) to YYYY-MM-DD */
function formatExcelDate(serial: number): string {
  const excelEpoch = new Date(Date.UTC(1899, 11, 30));
  const ms = Math.round(serial * 86400000);
  const date = new Date(excelEpoch.getTime() + ms);
  if (isNaN(date.getTime())) return String(serial);
  return date.toISOString().split("T")[0] || String(serial);
}

/** Fast regex-based XML value extractor safe in Web Workers */
function extractXmlAttribute(tagText: string, attrName: string): string | null {
  const re = new RegExp(`${attrName}=["']([^"']*)["']`, "i");
  const m = tagText.match(re);
  return m && m[1] !== undefined ? m[1] : null;
}

function parseDelimitedText(text: string, delimiter: string): { headers: string[]; rows: string[][] } {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return { headers: [], rows: [] };

  const parsedRows: string[][] = [];
  const maxRows = Math.min(lines.length, 5000);

  for (let i = 0; i < maxRows; i++) {
    const line = lines[i];
    if (!line) continue;
    const cells: string[] = [];
    let cur = "";
    let inQuotes = false;
    for (let c = 0; c < line.length; c++) {
      const ch = line[c];
      if (ch === '"') {
        if (inQuotes && line[c + 1] === '"') {
          cur += '"';
          c++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        cells.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cells.push(cur.trim());
    parsedRows.push(cells);
  }

  const firstRow = parsedRows[0] || [];
  const headers = firstRow.map((h, i) => (h && h.length > 0 ? h : `Column ${i + 1}`));
  const rows = parsedRows.slice(1);
  return { headers, rows };
}

function parseXlsxInWorker(buffer: ArrayBuffer): { sheets: SheetData[]; isLegacy?: boolean } {
  const uint8 = new Uint8Array(buffer);

  // Check for legacy Excel 97-2003 OLE2 binary header (0xD0 0xCF 0x11 0xE0)
  if (
    uint8.length >= 4 &&
    uint8[0] === 0xd0 &&
    uint8[1] === 0xcf &&
    uint8[2] === 0x11 &&
    uint8[3] === 0xe0
  ) {
    return { sheets: [], isLegacy: true };
  }

  let unzipped: fflate.Unzipped;
  try {
    unzipped = fflate.unzipSync(uint8);
  } catch {
    const textDecoder = new TextDecoder("utf-8");
    const text = textDecoder.decode(buffer);
    if (/^[\x20-\x7E\s\r\n\t]+$/.test(text.slice(0, 1024))) {
      const parsed = parseDelimitedText(text, ",");
      return { sheets: [{ name: "Text Content", headers: parsed.headers, rows: parsed.rows }] };
    }
    return { sheets: [], isLegacy: true };
  }

  // 1. Shared Strings parsing
  const sharedStrings: string[] = [];
  const sharedEntry = unzipped["xl/sharedStrings.xml"];
  if (sharedEntry) {
    const xml = new TextDecoder("utf-8").decode(sharedEntry);
    const siMatches = xml.match(/<si[\s\S]*?<\/si>/gi) || [];
    for (const si of siMatches) {
      let fullText = "";
      const tMatches = si.match(/<t[\s\S]*?>([\s\S]*?)<\/t>/gi) || [];
      for (const t of tMatches) {
        const textVal = t.replace(/<[\s\S]*?>/g, "");
        fullText += textVal
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'");
      }
      sharedStrings.push(fullText);
    }
  }

  // 2. Workbook Relationships
  const relsMap = new Map<string, string>();
  const relsEntry = unzipped["xl/_rels/workbook.xml.rels"];
  if (relsEntry) {
    const xml = new TextDecoder("utf-8").decode(relsEntry);
    const relMatches = xml.match(/<Relationship[\s\S]*?\/>/gi) || [];
    for (const rel of relMatches) {
      const id = extractXmlAttribute(rel, "Id");
      const target = extractXmlAttribute(rel, "Target");
      if (id && target) {
        const fullPath = target.startsWith("xl/") ? target : `xl/${target}`;
        relsMap.set(id, fullPath.replace(/\\/g, "/"));
      }
    }
  }

  // 3. Workbook Sheets
  const workbookSheets: { name: string; path: string }[] = [];
  const wbEntry = unzipped["xl/workbook.xml"];
  if (wbEntry) {
    const xml = new TextDecoder("utf-8").decode(wbEntry);
    const sheetMatches = xml.match(/<sheet[\s\S]*?\/>/gi) || [];
    for (let idx = 0; idx < sheetMatches.length; idx++) {
      const sheetTag = sheetMatches[idx]!;
      const name = extractXmlAttribute(sheetTag, "name") || `Sheet ${idx + 1}`;
      const rId =
        extractXmlAttribute(sheetTag, "r:id") ||
        extractXmlAttribute(sheetTag, "id");
      const path = (rId && relsMap.get(rId)) || `xl/worksheets/sheet${idx + 1}.xml`;
      workbookSheets.push({ name, path });
    }
  }

  // Fallback: discover any sheet XMLs if workbook.xml is empty
  if (workbookSheets.length === 0) {
    const sheetPaths = Object.keys(unzipped).filter(
      (k) => k.startsWith("xl/worksheets/sheet") && k.endsWith(".xml")
    );
    sheetPaths.sort().forEach((p, idx) => {
      workbookSheets.push({ name: `Sheet ${idx + 1}`, path: p });
    });
  }

  // 4. Parse Worksheets
  const parsedSheets: SheetData[] = [];
  for (const sheetDef of workbookSheets) {
    const sheetBytes = unzipped[sheetDef.path];
    if (!sheetBytes) continue;

    const xml = new TextDecoder("utf-8").decode(sheetBytes);
    const rowMatches = xml.match(/<row[\s\S]*?<\/row>/gi) || [];
    const matrix: string[][] = [];
    let maxCols = 0;

    for (let rIdx = 0; rIdx < Math.min(rowMatches.length, 5000); rIdx++) {
      const rowXml = rowMatches[rIdx]!;
      const cellMatches = rowXml.match(/<c[\s\S]*?<\/c>|<c[\s\S]*?\/>/gi) || [];
      const rowValues: string[] = [];

      for (const cellXml of cellMatches) {
        const cellRef = extractXmlAttribute(cellXml, "r");
        const cellType = extractXmlAttribute(cellXml, "t");

        let cellValue = "";
        const vMatch = cellXml.match(/<v>([\s\S]*?)<\/v>/i);
        const isMatch = cellXml.match(/<is>[\s\S]*?<t[\s\S]*?>([\s\S]*?)<\/t>[\s\S]*?<\/is>/i);

        if (cellType === "s" && vMatch && vMatch[1]) {
          const stringIndex = parseInt(vMatch[1], 10);
          cellValue = sharedStrings[stringIndex] || "";
        } else if (cellType === "inlineStr" && isMatch && isMatch[1]) {
          cellValue = isMatch[1]
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">");
        } else if (cellType === "b" && vMatch && vMatch[1]) {
          cellValue = vMatch[1] === "1" ? "TRUE" : "FALSE";
        } else if (vMatch && vMatch[1]) {
          cellValue = vMatch[1];
          const num = parseFloat(cellValue);
          if (num > 30000 && num < 60000 && Number.isInteger(num)) {
            cellValue = formatExcelDate(num);
          }
        }

        const targetCol = cellRef ? colRefToIndex(cellRef) : rowValues.length;
        if (targetCol >= 0) {
          while (rowValues.length < targetCol) {
            rowValues.push("");
          }
          rowValues[targetCol] = cellValue;
        } else {
          rowValues.push(cellValue);
        }
      }

      if (rowValues.length > maxCols) maxCols = rowValues.length;
      matrix.push(rowValues);
    }

    if (matrix.length > 0) {
      const headers = matrix[0]!.map((h, i) => (h && h.trim().length > 0 ? h : `Column ${i + 1}`));
      const dataRows = matrix.slice(1).map((row) => {
        while (row.length < maxCols) row.push("");
        return row;
      });
      parsedSheets.push({ name: sheetDef.name, headers, rows: dataRows });
    }
  }

  if (parsedSheets.length === 0) {
    parsedSheets.push({ name: "Empty", headers: ["A", "B", "C"], rows: [] });
  }

  return { sheets: parsedSheets };
}

self.onmessage = (e: MessageEvent<ParseWorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === "xlsx") {
      const res = parseXlsxInWorker(req.buffer);
      self.postMessage({
        id: req.id,
        success: true,
        sheets: res.sheets,
        isLegacy: res.isLegacy,
      } as ParseWorkerResponse);
    } else if (req.type === "csv" || req.type === "tsv") {
      const res = parseDelimitedText(req.text, req.delimiter);
      self.postMessage({
        id: req.id,
        success: true,
        sheets: [{ name: "Data", headers: res.headers, rows: res.rows }],
      } as ParseWorkerResponse);
    }
  } catch (err: any) {
    self.postMessage({
      id: req.id,
      success: false,
      error: err?.message || "Worker parse failure",
    } as ParseWorkerResponse);
  }
};
