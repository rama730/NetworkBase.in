"use client";

import * as React from "react";
import {
  FileText,
  Download,
  ExternalLink,
  AlertTriangle,
  Loader2,
  ZoomIn,
  ZoomOut,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectNode } from "@/lib/db/schema";
import { formatBytes } from "../../files-tab/folder/format";
import * as fflate from "fflate";

interface DocxViewerDriverProps {
  node: ProjectNode;
  signedUrl: string;
}

export function DocxViewerDriver({
  node,
  signedUrl,
}: DocxViewerDriverProps): React.JSX.Element {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [htmlContent, setHtmlContent] = React.useState<string | null>(null);
  const [zoom, setZoom] = React.useState(100);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);

    async function parseDocx() {
      try {
        const response = await fetch(signedUrl);
        if (!response.ok) throw new Error("Failed to download document content");
        const buffer = await response.arrayBuffer();

        // Decompress the DOCX archive
        const unzipped = fflate.unzipSync(new Uint8Array(buffer));

        // Locate word/document.xml
        const docXmlEntry = unzipped["word/document.xml"];
        if (!docXmlEntry) {
          throw new Error("Invalid or legacy DOC format. DOCX container missing document.xml");
        }

        const textDecoder = new TextDecoder("utf-8");
        const xmlText = textDecoder.decode(docXmlEntry);

        // Parse XML using browser native DOMParser
        const parser = new DOMParser();
        const xmlDoc = parser.parseFromString(xmlText, "application/xml");

        const body = xmlDoc.getElementsByTagName("w:body")[0];
        if (!body) throw new Error("Document body is empty");

        const elements: string[] = [];

        // Iterate through paragraphs and tables
        for (let i = 0; i < body.children.length; i++) {
          const child = body.children[i];
          if (!child) continue;
          const tagName = child.tagName;

          if (tagName === "w:p") {
            // Paragraph
            const pStyle = child.querySelector("w\\:pStyle")?.getAttribute("w:val") || "";
            const isHeading1 = /heading\s*1/i.test(pStyle);
            const isHeading2 = /heading\s*2/i.test(pStyle);
            const isHeading3 = /heading\s*3/i.test(pStyle);
            const isList = child.querySelector("w\\:numPr") !== null;

            let pText = "";
            const runs = child.getElementsByTagName("w:r");
            for (let r = 0; r < runs.length; r++) {
              const run = runs[r];
              if (!run) continue;
              const isBold = run.querySelector("w\\:b") !== null;
              const isItalic = run.querySelector("w\\:i") !== null;
              const isUnderline = run.querySelector("w\\:u") !== null;

              const textNodes = run.getElementsByTagName("w:t");
              let runText = "";
              for (let t = 0; t < textNodes.length; t++) {
                runText += textNodes[t]?.textContent || "";
              }

              // Handle line breaks
              if (run.querySelector("w\\:br")) {
                runText += "<br/>";
              }

              if (runText) {
                let styled = escapeHtml(runText);
                if (isBold) styled = `<strong>${styled}</strong>`;
                if (isItalic) styled = `<em>${styled}</em>`;
                if (isUnderline) styled = `<u>${styled}</u>`;
                pText += styled;
              }
            }

            if (pText.trim()) {
              if (isHeading1) {
                elements.push(`<h1 class="text-2xl font-bold mt-6 mb-3 text-foreground">${pText}</h1>`);
              } else if (isHeading2) {
                elements.push(`<h2 class="text-xl font-bold mt-5 mb-2 text-foreground">${pText}</h2>`);
              } else if (isHeading3) {
                elements.push(`<h3 class="text-lg font-semibold mt-4 mb-2 text-foreground">${pText}</h3>`);
              } else if (isList) {
                elements.push(`<li class="ml-6 list-disc mb-1.5 text-foreground/90">${pText}</li>`);
              } else {
                elements.push(`<p class="mb-3 leading-relaxed text-foreground/90">${pText}</p>`);
              }
            } else {
              elements.push('<div class="h-2"></div>');
            }
          } else if (tagName === "w:tbl") {
            // Table
            let tableHtml = '<div class="my-4 overflow-x-auto"><table class="w-full border-collapse border border-border text-xs">';
            const rows = child.getElementsByTagName("w:tr");
            for (let r = 0; r < rows.length; r++) {
              const row = rows[r];
              if (!row) continue;
              tableHtml += "<tr>";
              const cells = row.getElementsByTagName("w:tc");
              for (let c = 0; c < cells.length; c++) {
                const cell = cells[c];
                if (!cell) continue;
                const cellText = cell.textContent || "";
                tableHtml += `<td class="border border-border p-2 bg-card/50 text-foreground">${escapeHtml(cellText)}</td>`;
              }
              tableHtml += "</tr>";
            }
            tableHtml += "</table></div>";
            elements.push(tableHtml);
          }
        }

        if (active) {
          setHtmlContent(elements.join("\n"));
          setLoading(false);
        }
      } catch (err: any) {
        if (active) {
          setError(err?.message || "Unable to parse Word document format");
          setLoading(false);
        }
      }
    }

    parseDocx();

    return () => {
      active = false;
    };
  }, [signedUrl]);

  return (
    <div className="relative flex h-full w-full flex-col bg-muted/10">
      {/* Top Controls Toolbar */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-background px-4">
        <div className="flex items-center gap-2 overflow-hidden">
          <FileText className="h-4 w-4 shrink-0 text-blue-500" />
          <span className="truncate text-xs font-medium text-foreground">{node.name}</span>
          <span className="text-[11px] text-muted-foreground">({formatBytes(node.size)})</span>
        </div>

        <div className="flex items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoom((z) => Math.max(z - 10, 50))}
            className="h-7 w-7 p-0"
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="w-10 text-center text-[11px] font-medium text-foreground">
            {zoom}%
          </span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoom((z) => Math.min(z + 10, 200))}
            className="h-7 w-7 p-0"
            title="Zoom in"
          >
            <ZoomIn className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoom(100)}
            className="h-7 w-7 p-0"
            title="Reset zoom"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          <div className="mx-1 h-4 w-px bg-border" />
          <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
            <a href={signedUrl} download={node.name}>
              <Download className="mr-1 h-3.5 w-3.5" />
              Download
            </a>
          </Button>
        </div>
      </div>

      {/* Main Document Body */}
      <div className="flex-1 overflow-auto p-6 md:p-10">
        {loading ? (
          <div className="flex h-64 flex-col items-center justify-center gap-3">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            <p className="text-xs text-muted-foreground">Parsing Word document in-browser...</p>
          </div>
        ) : error ? (
          <div className="mx-auto flex max-w-md flex-col items-center justify-center gap-3 rounded-lg border border-border bg-card p-8 text-center shadow-sm">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <p className="text-sm font-semibold text-foreground">Document Preview Fallback</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button asChild size="sm" variant="default" className="mt-2">
              <a href={signedUrl} download={node.name}>
                <Download className="mr-1.5 h-4 w-4" />
                Download Document
              </a>
            </Button>
          </div>
        ) : (
          <div
            className="mx-auto max-w-3xl rounded-lg border border-border bg-card p-8 md:p-12 shadow-sm transition-all"
            style={{ zoom: `${zoom}%` }}
            dangerouslySetInnerHTML={{ __html: htmlContent || "" }}
          />
        )}
      </div>
    </div>
  );
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}
