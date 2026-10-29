"use client";

import * as React from "react";
import * as docx from "docx-preview";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  Search,
  Download,
  Printer,
  FileText,
  AlertTriangle,
  RefreshCw,
  ExternalLink,
  ListTree,
  BookOpen,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { formatBytes } from "../../files-tab/folder/format";
import { extOf } from "../../utils/fileKind";

interface DocxViewerDriverProps {
  node: ProjectNode;
  signedUrl: string;
}

export function DocxViewerDriver({
  node,
  signedUrl,
}: DocxViewerDriverProps): React.JSX.Element {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const bufferCacheRef = React.useRef<{ url: string; buffer: ArrayBuffer } | null>(null);
  const abortControllerRef = React.useRef<AbortController | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [viewMode, setViewMode] = React.useState<"paginated" | "fluid">("paginated");
  const [isTwoPageSpread, setIsTwoPageSpread] = React.useState(false);
  const [zoom, setZoom] = React.useState<number>(100);
  const [searchQuery, setSearchQuery] = React.useState("");
  const [showSearch, setShowSearch] = React.useState(false);
  const [searchMatchCount, setSearchMatchCount] = React.useState(0);
  const [headings, setHeadings] = React.useState<{ id: string; level: number; text: string }[]>([]);
  const [showOutline, setShowOutline] = React.useState(false);

  const jumpToHeading = React.useCallback((id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  }, []);

  const ext = React.useMemo(() => extOf(node.name), [node.name]);
  const isLegacy = ext === "doc" || ext === "rtf" || ext === "odt";

  // Render modern .docx file via docx-preview with in-memory buffer caching
  const renderDocx = React.useCallback(async () => {
    if (isLegacy) {
      setLoading(false);
      return;
    }

    if (!containerRef.current) return;
    setLoading(true);
    setError(null);
    containerRef.current.innerHTML = "";

    try {
      let buffer: ArrayBuffer;
      if (bufferCacheRef.current && bufferCacheRef.current.url === signedUrl) {
        buffer = bufferCacheRef.current.buffer;
      } else {
        if (abortControllerRef.current) {
          abortControllerRef.current.abort();
        }
        const controller = new AbortController();
        abortControllerRef.current = controller;

        const res = await fetch(signedUrl, { signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}: Failed to download document`);

        buffer = await res.arrayBuffer();

        // Decompression safety guard: max 60 MB buffer
        if (buffer.byteLength > 60 * 1024 * 1024) {
          throw new Error("File exceeds client-side preview safety limit (60 MB). Download to view.");
        }

        bufferCacheRef.current = { url: signedUrl, buffer };
      }

      await docx.renderAsync(buffer, containerRef.current, undefined, {
        inWrapper: viewMode === "paginated",
        breakPages: viewMode === "paginated",
        ignoreLastRenderedPageBreak: false,
        ignoreWidth: viewMode === "fluid",
        ignoreHeight: viewMode === "fluid",
        experimental: false,
        trimXmlDeclaration: true,
        useBase64URL: false,
      });

      // Post-rendering Security Sanitization Pass
      const links = containerRef.current.querySelectorAll<HTMLAnchorElement>("a[href]");
      links.forEach((a) => {
        const href = a.getAttribute("href") || "";
        const lower = href.trim().toLowerCase();
        if (lower.startsWith("javascript:") || lower.startsWith("data:") || lower.startsWith("vbscript:")) {
          a.removeAttribute("href");
          a.style.cursor = "not-allowed";
          a.title = "Blocked unsafe link";
        } else {
          a.setAttribute("target", "_blank");
          a.setAttribute("rel", "noopener noreferrer");
        }
      });

      // Extract document headings for Outline / Table of Contents
      const headingElements = containerRef.current.querySelectorAll<HTMLElement>(
        "h1, h2, h3, h4, h5, h6, [class*='Heading'], [class*='heading']"
      );
      const extractedHeadings: { id: string; level: number; text: string }[] = [];
      headingElements.forEach((el, idx) => {
        const text = el.textContent?.trim() || "";
        if (text && text.length > 0 && text.length < 120) {
          const anchorId = `doc-heading-${idx}`;
          el.id = anchorId;
          const tagName = el.tagName.toLowerCase();
          const levelMatch = tagName.match(/^h([1-6])$/);
          let level = levelMatch && levelMatch[1] ? parseInt(levelMatch[1], 10) : 2;
          const className = el.className || "";
          const classMatch = className.match(/heading\s*([1-6])/i);
          if (classMatch && classMatch[1]) {
            level = parseInt(classMatch[1], 10);
          }
          extractedHeadings.push({ id: anchorId, level, text });
        }
      });
      setHeadings(extractedHeadings);

      setLoading(false);
    } catch (err: unknown) {
      if (err instanceof Error && err.name === "AbortError") {
        return;
      }
      const msg = err instanceof Error ? err.message : "Couldn’t parse Word document.";
      setError(msg);
      setLoading(false);
    }
  }, [isLegacy, signedUrl, viewMode]);

  React.useEffect(() => {
    renderDocx();
    return () => {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, [renderDocx]);

  const handlePrint = React.useCallback(() => {
    const container = containerRef.current;
    if (!container) return;

    // Create an isolated hidden iframe for pure document printing
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "none";
    iframe.style.opacity = "0";
    iframe.style.pointerEvents = "none";
    iframe.setAttribute("aria-hidden", "true");
    iframe.title = "Print document preview";
    document.body.appendChild(iframe);

    const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
    if (!iframeDoc) {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
      return;
    }

    // Clone rendered document content and strip out UI search marks
    const cloned = container.cloneNode(true) as HTMLElement;
    const marks = cloned.querySelectorAll("mark[data-docx-search]");
    marks.forEach((m) => {
      const parent = m.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(m.textContent || ""), m);
      }
    });

    // Extract all <style> elements generated by docx-preview into <head>
    const styleTags = Array.from(cloned.querySelectorAll("style"))
      .map((s) => {
        const html = s.outerHTML;
        s.remove();
        return html;
      })
      .join("\n");

    const printHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <title>${node.name}</title>
  ${styleTags}
  <style>
    @page {
      margin: 0;
      size: auto;
    }
    * {
      box-sizing: border-box;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    html, body {
      margin: 0 !important;
      padding: 0 !important;
      background: #ffffff !important;
      color: #111827 !important;
    }
    .docx-wrapper {
      background: transparent !important;
      padding: 0 !important;
      margin: 0 !important;
      display: block !important;
    }
    section.docx {
      box-shadow: none !important;
      margin: 0 auto !important;
      background: #ffffff !important;
      color: #111827 !important;
      page-break-after: always;
      break-after: page;
    }
    section.docx:last-child {
      page-break-after: auto;
      break-after: auto;
    }
  </style>
</head>
<body>
  ${cloned.innerHTML}
</body>
</html>`;

    iframeDoc.open();
    iframeDoc.write(printHtml);
    iframeDoc.close();

    const iframeWin = iframe.contentWindow;
    if (!iframeWin) {
      if (document.body.contains(iframe)) document.body.removeChild(iframe);
      return;
    }

    const triggerAndCleanup = () => {
      try {
        iframeWin.focus();
        iframeWin.print();
      } catch {
        // Ignore print cancellation
      } finally {
        setTimeout(() => {
          if (document.body.contains(iframe)) {
            document.body.removeChild(iframe);
          }
        }, 1500);
      }
    };

    const images = Array.from(iframeDoc.images);
    if (images.length === 0) {
      setTimeout(triggerAndCleanup, 150);
    } else {
      let pending = images.length;
      const timer = setTimeout(triggerAndCleanup, 2000);
      const onDone = () => {
        pending--;
        if (pending <= 0) {
          if (timer) clearTimeout(timer);
          setTimeout(triggerAndCleanup, 150);
        }
      };
      images.forEach((img) => {
        if (img.complete) {
          onDone();
        } else {
          img.onload = onDone;
          img.onerror = onDone;
        }
      });
    }
  }, [node.name]);

  // Intercept Cmd+P / Ctrl+P to trigger isolated document printing
  React.useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "p") {
        e.preventDefault();
        handlePrint();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handlePrint]);

  const searchTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);

  // In-document text search & highlight with debouncing and multi-occurrence support
  const executeHighlight = React.useCallback((query: string) => {
    const container = containerRef.current;
    if (!container) return;

    // Clear previous highlights
    const oldMarks = container.querySelectorAll("mark[data-docx-search]");
    oldMarks.forEach((m) => {
      const parent = m.parentNode;
      if (parent) {
        parent.replaceChild(document.createTextNode(m.textContent || ""), m);
        parent.normalize();
      }
    });

    if (!query.trim()) {
      setSearchMatchCount(0);
      return;
    }

    let matches = 0;
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    const textNodes: Text[] = [];
    let current = walker.nextNode();
    while (current) {
      textNodes.push(current as Text);
      current = walker.nextNode();
    }

    const lowerQuery = query.toLowerCase();
    for (const textNode of textNodes) {
      const text = textNode.nodeValue || "";
      const lower = text.toLowerCase();
      let matchIdx = lower.indexOf(lowerQuery);
      if (matchIdx >= 0 && textNode.parentNode) {
        const fragment = document.createDocumentFragment();
        let lastIdx = 0;
        while (matchIdx !== -1) {
          matches++;
          if (matchIdx > lastIdx) {
            fragment.appendChild(document.createTextNode(text.slice(lastIdx, matchIdx)));
          }
          const mark = document.createElement("mark");
          mark.setAttribute("data-docx-search", "true");
          mark.className = "rounded-xs bg-amber-300 dark:bg-amber-600/70 text-foreground px-0.5";
          mark.textContent = text.slice(matchIdx, matchIdx + query.length);
          fragment.appendChild(mark);
          lastIdx = matchIdx + query.length;
          matchIdx = lower.indexOf(lowerQuery, lastIdx);
        }
        if (lastIdx < text.length) {
          fragment.appendChild(document.createTextNode(text.slice(lastIdx)));
        }
        textNode.parentNode.replaceChild(fragment, textNode);
      }
    }
    setSearchMatchCount(matches);
  }, []);

  const handleSearch = React.useCallback(
    (query: string) => {
      setSearchQuery(query);
      if (searchTimeoutRef.current) clearTimeout(searchTimeoutRef.current);
      searchTimeoutRef.current = setTimeout(() => {
        executeHighlight(query);
      }, 150);
    },
    [executeHighlight],
  );

  // Legacy Document View (.doc, .rtf, .odt)
  if (isLegacy) {
    const formatName = ext === "doc" ? "Word 97-2003 Document (.doc)" : ext === "rtf" ? "Rich Text Document (.rtf)" : "OpenDocument Text (.odt)";
    const officeViewerUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(signedUrl)}`;
    const googleViewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(signedUrl)}&embedded=true`;

    return (
      <div className="flex h-full w-full items-center justify-center bg-muted/10 p-6">
        <div className="flex max-w-md flex-col items-center rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <FileText className="h-8 w-8" />
          </div>

          <h3 className="max-w-sm truncate text-base font-semibold text-card-foreground" title={node.name}>
            {node.name}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {formatName} • {formatBytes(node.size)}
          </p>

          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            This document uses an earlier binary format. You can download the file directly, or preview it with web productivity suites.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <Button asChild size="sm" className="h-9 px-4 text-xs font-medium">
              <a href={signedUrl} download={node.name}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download document
              </a>
            </Button>

            {ext === "doc" && (
              <Button asChild variant="outline" size="sm" className="h-9 px-3 text-xs">
                <a href={officeViewerUrl} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                  Office Online
                </a>
              </Button>
            )}

            <Button asChild variant="outline" size="sm" className="h-9 px-3 text-xs">
              <a href={googleViewerUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Google Docs
              </a>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  // Modern .docx Preview View
  return (
    <div className="relative flex h-full w-full flex-col bg-muted/20 overflow-hidden">
      {/* Top Controls Toolbar */}
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-background px-4">
        {/* View Mode & Metadata */}
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 text-primary" />
          <span className="text-xs font-semibold text-foreground truncate max-w-[200px]" title={node.name}>
            {node.name}
          </span>

          <div className="ml-2 flex items-center rounded-md border border-border p-0.5">
            <button
              type="button"
              onClick={() => setViewMode("paginated")}
              className={cn(
                "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                viewMode === "paginated" ? "bg-muted text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Paginated
            </button>
            <button
              type="button"
              onClick={() => setViewMode("fluid")}
              className={cn(
                "rounded px-2 py-0.5 text-[11px] font-medium transition-colors",
                viewMode === "fluid" ? "bg-muted text-foreground shadow-xs" : "text-muted-foreground hover:text-foreground"
              )}
            >
              Fluid
            </button>
          </div>

          {viewMode === "paginated" && (
            <Button
              size="sm"
              variant={isTwoPageSpread ? "secondary" : "ghost"}
              onClick={() => setIsTwoPageSpread((v) => !v)}
              className="h-7 px-2 text-xs ml-1"
              title="Toggle Two-Page Book Spread (Facing Pages)"
            >
              <BookOpen className="mr-1 h-3.5 w-3.5" />
              <span className="hidden sm:inline">{isTwoPageSpread ? "2-Page" : "1-Page"}</span>
            </Button>
          )}
        </div>

        {/* Zoom & Action Controls */}
        <div className="flex items-center gap-1.5">
          {headings.length > 0 && (
            <Button
              size="sm"
              variant={showOutline ? "secondary" : "ghost"}
              onClick={() => setShowOutline((v) => !v)}
              className="h-7 px-2 text-xs"
              title="Toggle table of contents"
            >
              <ListTree className="mr-1 h-3.5 w-3.5" />
              <span className="hidden sm:inline">Outline</span>
              <span className="ml-1 text-[10px] text-muted-foreground">({headings.length})</span>
            </Button>
          )}

          {showSearch ? (
            <div className="flex items-center gap-1 rounded-md border border-border bg-card px-2 py-0.5">
              <Search className="h-3 w-3 text-muted-foreground" />
              <Input
                type="text"
                placeholder="Find in doc…"
                value={searchQuery}
                onChange={(e) => handleSearch(e.target.value)}
                className="h-6 w-28 border-0 bg-transparent p-0 text-xs focus-visible:ring-0"
                autoFocus
              />
              {searchQuery && (
                <span className="text-[10px] text-muted-foreground">
                  {searchMatchCount} found
                </span>
              )}
              <button
                type="button"
                onClick={() => {
                  setShowSearch(false);
                  handleSearch("");
                }}
                className="text-[10px] text-muted-foreground hover:text-foreground ml-1"
              >
                ✕
              </button>
            </div>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowSearch(true)}
              className="h-7 w-7 p-0"
              title="Find in document"
            >
              <Search className="h-3.5 w-3.5" />
            </Button>
          )}

          <div className="h-4 w-px bg-border mx-0.5" />

          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoom((z) => Math.max(50, z - 15))}
            className="h-7 w-7 p-0"
            title="Zoom out"
          >
            <ZoomOut className="h-3.5 w-3.5" />
          </Button>
          <span className="min-w-9 text-center text-[11px] text-muted-foreground">{zoom}%</span>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setZoom((z) => Math.min(200, z + 15))}
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

          <div className="h-4 w-px bg-border mx-1" />

          <Button size="sm" variant="ghost" onClick={handlePrint} className="h-7 px-2 text-xs" title="Print document">
            <Printer className="mr-1 h-3.5 w-3.5" />
            Print
          </Button>

          <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
            <a href={signedUrl} download={node.name}>
              <Download className="mr-1 h-3.5 w-3.5" />
              Download
            </a>
          </Button>
        </div>
      </div>

      {/* Main Document Layout with Collapsible Outline */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Collapsible Document Outline (Table of Contents) Sidebar */}
        {showOutline && headings.length > 0 && (
          <div className="w-64 shrink-0 border-r border-border bg-card/60 backdrop-blur-xs p-3 overflow-y-auto app-scroll flex flex-col gap-1 select-none">
            <div className="flex items-center justify-between pb-2 mb-1 border-b border-border/60">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <ListTree className="h-3.5 w-3.5 text-primary" />
                Table of contents
              </span>
              <button
                type="button"
                onClick={() => setShowOutline(false)}
                className="text-xs text-muted-foreground hover:text-foreground p-0.5 rounded-[3px]"
              >
                ✕
              </button>
            </div>
            {headings.map((h, i) => (
              <button
                key={i}
                type="button"
                onClick={() => jumpToHeading(h.id)}
                className={cn(
                  "text-left text-xs truncate py-1 px-1.5 rounded-[4px] hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer",
                  h.level === 1 && "font-semibold text-foreground",
                  h.level === 2 && "pl-3 text-foreground/90",
                  h.level >= 3 && "pl-5 text-muted-foreground text-[11px]",
                )}
                title={h.text}
              >
                {h.text}
              </button>
            ))}
          </div>
        )}

        {/* Main Document Scroll Viewport */}
        <div className="flex-1 overflow-auto p-4 sm:p-8 flex">
        {loading && (
          <div className="w-full max-w-3xl m-auto space-y-4 p-8 bg-card rounded-xl border border-border/60 shadow-xs animate-pulse">
            <Skeleton className="h-7 w-2/3 rounded-md mb-6" />
            <Skeleton className="h-4 w-full rounded-[3px]" />
            <Skeleton className="h-4 w-11/12 rounded-[3px]" />
            <Skeleton className="h-4 w-4/5 rounded-[3px]" />
            <div className="pt-4 space-y-3">
              <Skeleton className="h-4 w-full rounded-[3px]" />
              <Skeleton className="h-4 w-5/6 rounded-[3px]" />
              <Skeleton className="h-4 w-3/4 rounded-[3px]" />
            </div>
            <div className="pt-4 space-y-3">
              <Skeleton className="h-4 w-full rounded-[3px]" />
              <Skeleton className="h-4 w-4/6 rounded-[3px]" />
            </div>
          </div>
        )}

        {error && (
          <div className="flex flex-col items-center justify-center gap-3 text-center max-w-md my-auto">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <p className="text-sm font-semibold">Unable to preview document</p>
            <p className="text-xs text-muted-foreground">{error}</p>
            <Button asChild size="sm" className="mt-2">
              <a href={signedUrl} download={node.name}>
                <Download className="mr-1.5 h-3.5 w-3.5" /> Download file
              </a>
            </Button>
          </div>
        )}

        <div
          ref={containerRef}
          style={{
            transform: zoom === 100 ? undefined : `scale(${zoom / 100})`,
            transformOrigin: "top center",
            display: loading || error ? "none" : "block",
          }}
          className={cn(
            "docx-preview-content transition-transform duration-100 m-auto",
            viewMode === "fluid" ? "w-full max-w-4xl" : "",
            isTwoPageSpread && viewMode === "paginated" ? "docx-two-page-spread w-full max-w-none" : "",
          )}
        />
        </div>
      </div>

      {/* Scoped styling ensuring crisp white paper sheet contrast in dark & light modes */}
      <style
        dangerouslySetInnerHTML={{
          __html: `
            .docx-preview-content .docx-wrapper {
              background: transparent !important;
              padding: 0 !important;
              display: flex !important;
              flex-direction: column !important;
              align-items: center !important;
              gap: 24px;
            }
            .docx-two-page-spread .docx-wrapper {
              display: flex !important;
              flex-direction: row !important;
              flex-wrap: wrap !important;
              justify-content: center !important;
              gap: 24px !important;
            }
            .docx-preview-content section.docx,
            .docx-preview-content .docx-wrapper > section.docx {
              background-color: #ffffff !important;
              color: #111827 !important;
              box-shadow: 0 4px 24px -2px rgba(0, 0, 0, 0.35), 0 0 0 1px rgba(0, 0, 0, 0.08) !important;
              border-radius: 2px;
              box-sizing: border-box;
              content-visibility: auto;
              contain-intrinsic-size: 816px 1056px;
            }
            .docx-preview-content mark[data-docx-search] {
              background-color: #fde047 !important;
              color: #000000 !important;
              padding: 0 2px;
              border-radius: 2px;
            }
          `,
        }}
      />
    </div>
  );
}
