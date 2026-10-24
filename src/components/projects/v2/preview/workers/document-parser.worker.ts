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
    if (cells.some((c) => c !== "")) {
      parsedRows.push(cells);
    }
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

  // 1. Shared Strings parsing (optimized forward scan)
  const sharedStrings: string[] = [];
  const sharedEntry = unzipped["xl/sharedStrings.xml"];
  if (sharedEntry) {
    const xml = new TextDecoder("utf-8").decode(sharedEntry);
    const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>/gi;
    let siMatch: RegExpExecArray | null;
    while ((siMatch = siRe.exec(xml)) !== null) {
      const siContent = siMatch[1] || "";
      const tRe = /<t\b[^>]*>([\s\S]*?)<\/t>/gi;
      let fullText = "";
      let tMatch: RegExpExecArray | null;
      while ((tMatch = tRe.exec(siContent)) !== null) {
        fullText += (tMatch[1] || "")
          .replace(/&amp;/g, "&")
          .replace(/&lt;/g, "<")
          .replace(/&gt;/g, ">")
          .replace(/&quot;/g, '"')
          .replace(/&apos;/g, "'");
      }
      sharedStrings.push(fullText);
    }
  }

  // 1.5. Styles parsing for precise OpenXML date resolution
  const BUILTIN_DATE_NUM_FMT_IDS = new Set([
    14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 30, 36, 45, 46, 47,
    50, 51, 52, 53, 54, 55, 56, 57, 58
  ]);
  const dateStyleIndices: boolean[] = [];
  const stylesEntry = unzipped["xl/styles.xml"];
  if (stylesEntry) {
    const stylesXml = new TextDecoder("utf-8").decode(stylesEntry);
    const customDateFmts = new Set<number>();
    const numFmtRe = /<numFmt\b([^>]*)\/?>/gi;
    let nfMatch: RegExpExecArray | null;
    while ((nfMatch = numFmtRe.exec(stylesXml)) !== null) {
      const tag = nfMatch[1] || "";
      const idStr = extractXmlAttribute(tag, "numFmtId");
      const code = extractXmlAttribute(tag, "formatCode") || "";
      if (idStr) {
        const id = parseInt(idStr, 10);
        const cleanCode = code.replace(/\[[^\]]*\]/g, ""); // strip [Red], [$-409], etc.
        if (/[ymdhs]/i.test(cleanCode)) {
          customDateFmts.add(id);
        }
      }
    }

    const cellXfsMatch = stylesXml.match(/<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/i);
    if (cellXfsMatch && cellXfsMatch[1]) {
      const xfsContent = cellXfsMatch[1];
      const xfRe = /<xf\b([^>]*)\/?>/gi;
      let xfMatch: RegExpExecArray | null;
      while ((xfMatch = xfRe.exec(xfsContent)) !== null) {
        const tag = xfMatch[1] || "";
        const numFmtIdStr = extractXmlAttribute(tag, "numFmtId");
        if (numFmtIdStr) {
          const numFmtId = parseInt(numFmtIdStr, 10);
          const isDate = BUILTIN_DATE_NUM_FMT_IDS.has(numFmtId) || customDateFmts.has(numFmtId);
          dateStyleIndices.push(isDate);
        } else {
          dateStyleIndices.push(false);
        }
      }
    }
  }

  // 2. Workbook Relationships
  const relsMap = new Map<string, string>();
  const relsEntry = unzipped["xl/_rels/workbook.xml.rels"];
  if (relsEntry) {
    const xml = new TextDecoder("utf-8").decode(relsEntry);
    const relRe = /<Relationship\b([^>]*)\/>/gi;
    let relMatch: RegExpExecArray | null;
    while ((relMatch = relRe.exec(xml)) !== null) {
      const tag = relMatch[1] || "";
      const id = extractXmlAttribute(tag, "Id");
      const target = extractXmlAttribute(tag, "Target");
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
    const sheetRe = /<sheet\b([^>]*)\/>/gi;
    let sheetMatch: RegExpExecArray | null;
    let idx = 0;
    while ((sheetMatch = sheetRe.exec(xml)) !== null) {
      idx++;
      const tag = sheetMatch[1] || "";
      const name = extractXmlAttribute(tag, "name") || `Sheet ${idx}`;
      const rId =
        extractXmlAttribute(tag, "r:id") ||
        extractXmlAttribute(tag, "id");
      const path = (rId && relsMap.get(rId)) || `xl/worksheets/sheet${idx}.xml`;
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

  // 4. Parse Worksheets with Fast Streaming Scanner & Empty Row Pruning
  const parsedSheets: SheetData[] = [];
  for (const sheetDef of workbookSheets) {
    const sheetBytes = unzipped[sheetDef.path];
    if (!sheetBytes) continue;

    const xml = new TextDecoder("utf-8").decode(sheetBytes);
    const matrix: string[][] = [];
    let maxCols = 0;

    // Single-pass forward regex scanner on rows
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/gi;
    let rowMatch: RegExpExecArray | null;

    while ((rowMatch = rowRe.exec(xml)) !== null) {
      // Skip empty self-closing row tags (e.g. <row r="172" customFormat="1"/>)
      const rowContent = rowMatch[1];
      if (!rowContent || rowContent.trim().length === 0) continue;

      const cellRe = /<c\b([^>]*)>(?:<is>[\s\S]*?<t\b[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>|<v>([\s\S]*?)<\/v>)?[\s\S]*?<\/c>|<c\b([^>]*)\/>/gi;
      let cellMatch: RegExpExecArray | null;
      const rowValues: string[] = [];
      let hasMeaningfulData = false;

      while ((cellMatch = cellRe.exec(rowContent)) !== null) {
        // Skip self-closing blank cells
        const openTag = cellMatch[1] || "";
        const inlineStr = cellMatch[2];
        const rawVal = cellMatch[3];
        if (!inlineStr && !rawVal) continue;

        const cellRef = extractXmlAttribute(openTag, "r") || "";
        const cellType = extractXmlAttribute(openTag, "t");
        const styleAttr = extractXmlAttribute(openTag, "s");
        const styleIdx = styleAttr ? parseInt(styleAttr, 10) : -1;
        const isDateStyle = styleIdx >= 0 && dateStyleIndices[styleIdx] === true;

        let cellValue = "";
        if (cellType === "s" && rawVal !== undefined) {
          const stringIndex = parseInt(rawVal, 10);
          cellValue = sharedStrings[stringIndex] || "";
        } else if (cellType === "inlineStr" && inlineStr !== undefined) {
          cellValue = inlineStr
            .replace(/&amp;/g, "&")
            .replace(/&lt;/g, "<")
            .replace(/&gt;/g, ">");
        } else if (cellType === "b" && rawVal !== undefined) {
          cellValue = rawVal === "1" ? "TRUE" : "FALSE";
        } else if (rawVal !== undefined) {
          cellValue = rawVal;
          if (isDateStyle) {
            const num = parseFloat(cellValue);
            if (!isNaN(num) && isFinite(num)) {
              cellValue = formatExcelDate(num);
            }
          }
        }

        if (cellValue.trim() !== "") {
          hasMeaningfulData = true;
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

      // ONLY push row if it contains actual data (eliminates 4,800+ blank formatted rows!)
      if (hasMeaningfulData && rowValues.some((v) => v && v.trim() !== "")) {
        if (rowValues.length > maxCols) maxCols = rowValues.length;
        matrix.push(rowValues);
      }
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
