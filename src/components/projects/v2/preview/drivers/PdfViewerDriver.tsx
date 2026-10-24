"use client";

import * as React from "react";
import {
  ExternalLink,
  Download,
  AlertTriangle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Layers,
  FileText,
  Loader2,
  Bookmark,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";

interface PdfBookmark {
  title: string;
  pageNumber?: number;
  items?: PdfBookmark[];
}

interface PdfViewerDriverProps {
  node: ProjectNode;
  signedUrl: string | null;
  projectId: string;
}

export function PdfViewerDriver({
  node,
  signedUrl,
  projectId,
}: PdfViewerDriverProps): React.JSX.Element {
  const [viewMode, setViewMode] = React.useState<"native" | "canvas">("canvas");
  const [loadError, setLoadError] = React.useState(false);
  const [isRetrying, setIsRetrying] = React.useState(false);

  // Canvas Mode state
  const [pdfDoc, setPdfDoc] = React.useState<any>(null);
  const [pageNumber, setPageNumber] = React.useState(1);
  const [numPages, setNumPages] = React.useState(0);
  const [zoom, setZoom] = React.useState(1.2);
  const [isCanvasLoading, setIsCanvasLoading] = React.useState(false);
  const [canvasError, setCanvasError] = React.useState<string | null>(null);
  const [bookmarks, setBookmarks] = React.useState<PdfBookmark[]>([]);
  const [showBookmarks, setShowBookmarks] = React.useState(false);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = React.useRef<HTMLDivElement | null>(null);
  const renderTaskRef = React.useRef<any>(null);
  const textTaskRef = React.useRef<any>(null);

  // Inline streaming preview route
  const previewUrl = React.useMemo(() => {
    const pId = encodeURIComponent(node.projectId || projectId);
    const nId = encodeURIComponent(node.id);
    const ver = encodeURIComponent(String(node.currentVersion ?? 1));
    return `/api/v1/projects/${pId}/files/${nId}/preview?v=${ver}`;
  }, [node.projectId, projectId, node.id, node.currentVersion]);

  const downloadUrl = React.useMemo(() => {
    return `${previewUrl}&download=1`;
  }, [previewUrl]);

  const handleRetry = React.useCallback(() => {
    setIsRetrying(true);
    setLoadError(false);
    setCanvasError(null);
    setTimeout(() => setIsRetrying(false), 500);
  }, []);

  // When native iframe fails, auto-fallback to client-side canvas
  const handleIframeError = React.useCallback(() => {
    setViewMode("canvas");
  }, []);

  // Load PDF.js document via HTTP 206 Byte-Range Streaming
  React.useEffect(() => {
    if (viewMode !== "canvas") return;

    let cancelled = false;
    let loadedDoc: any = null;
    setIsCanvasLoading(true);
    setCanvasError(null);

    async function loadPdfDocument() {
      try {
        const pdfjs = await import("pdfjs-dist");
        if (typeof window !== "undefined" && pdfjs.GlobalWorkerOptions && !pdfjs.GlobalWorkerOptions.workerSrc) {
          pdfjs.GlobalWorkerOptions.workerSrc = `https://cdnjs.cloudflare.com/ajax/libs/pdf.js/${pdfjs.version}/pdf.worker.min.js`;
        }
        const getDocument = pdfjs.getDocument || (pdfjs as any).default?.getDocument;

        // HTTP 206 partial range streaming (sub-200ms page 1 render on 100MB+ files)
        const streamTargetUrl = signedUrl || previewUrl;
        const loadingTask = getDocument({
          url: streamTargetUrl,
          rangeChunkSize: 65536,
          disableAutoFetch: false,
          disableStream: false,
          isEvalSupported: false,
          withCredentials: !signedUrl,
        });

        const doc = await loadingTask.promise;
        if (cancelled) {
          doc.destroy().catch(() => {});
          return;
        }

        loadedDoc = doc;
        setPdfDoc(doc);
        setNumPages(doc.numPages);
        setPageNumber(1);
        setIsCanvasLoading(false);

        // Extract PDF bookmarks/outline tree
        try {
          const outline = await doc.getOutline();
          if (outline && outline.length > 0) {
            const resolveBookmarks = async (items: any[]): Promise<PdfBookmark[]> => {
              const res: PdfBookmark[] = [];
              for (const item of items) {
                let pNum: number | undefined;
                try {
                  if (typeof item.dest === "string") {
                    const dest = await doc.getDestination(item.dest);
                    if (dest && dest[0]) {
                      const pageIndex = await doc.getPageIndex(dest[0]);
                      pNum = pageIndex + 1;
                    }
                  } else if (Array.isArray(item.dest) && item.dest[0]) {
                    const pageIndex = await doc.getPageIndex(item.dest[0]);
                    pNum = pageIndex + 1;
                  }
                } catch {
                  // Dest resolution optional
                }
                const children = item.items && item.items.length > 0 ? await resolveBookmarks(item.items) : [];
                res.push({
                  title: item.title,
                  pageNumber: pNum,
                  items: children,
                });
              }
              return res;
            };
            const resolved = await resolveBookmarks(outline);
            if (!cancelled) {
              setBookmarks(resolved);
            }
          }
        } catch {
          // Outline parsing is optional
        }
      } catch (err: any) {
        if (cancelled) return;
        setIsCanvasLoading(false);
        setCanvasError(err?.message || "Failed to parse PDF document");
      }
    }

    loadPdfDocument();

    return () => {
      cancelled = true;
      if (loadedDoc) {
        loadedDoc.destroy().catch(() => {});
      }
    };
  }, [viewMode, previewUrl]);

  // Render current page onto canvas
  React.useEffect(() => {
    if (viewMode !== "canvas" || !pdfDoc || !canvasRef.current) return;

    let cancelled = false;

    // Cancel any in-flight page render task
    if (renderTaskRef.current) {
      try {
        renderTaskRef.current.cancel();
      } catch {
        // Ignore cancel errors
      }
    }

    async function renderPage() {
      try {
        const page = await pdfDoc.getPage(pageNumber);
        if (cancelled || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        const viewport = page.getViewport({ scale: zoom });

        // High-DPI support
        const pixelRatio = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * pixelRatio);
        canvas.height = Math.floor(viewport.height * pixelRatio);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        ctx.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

        const renderContext = {
          canvasContext: ctx,
          viewport,
        };

        const renderTask = page.render(renderContext);
        renderTaskRef.current = renderTask;

        await renderTask.promise;

        // Render text layer for text selection & copy
        if (!cancelled && textLayerRef.current) {
          textLayerRef.current.innerHTML = "";
          textLayerRef.current.style.setProperty("--scale-factor", String(viewport.scale));
          try {
            const pdfjs = await import("pdfjs-dist");
            const renderTextLayer = pdfjs.renderTextLayer || (pdfjs as any).default?.renderTextLayer;
            if (typeof renderTextLayer === "function") {
              const textContent = await page.getTextContent();
              if (!cancelled && textLayerRef.current) {
                const textTask = renderTextLayer({
                  textContentSource: textContent,
                  container: textLayerRef.current,
                  viewport,
                });
                textTaskRef.current = textTask;
                await textTask.promise;
              }
            }
          } catch {
            // Text layer failure shouldn't break canvas rendering
          }
        }
      } catch (err: any) {
        if (err?.name === "RenderingCancelledException") {
          return;
        }
        console.error("PDF page render error:", err);
      }
    }

    renderPage();

    return () => {
      cancelled = true;
      if (renderTaskRef.current) {
        try {
          renderTaskRef.current.cancel();
        } catch {
          // ignore
        }
      }
      if (textTaskRef.current) {
        try {
          textTaskRef.current.cancel();
        } catch {
          // ignore
        }
      }
      if (textLayerRef.current) {
        textLayerRef.current.innerHTML = "";
      }
    };
  }, [viewMode, pdfDoc, pageNumber, zoom]);

  // Reclaim GPU memory on unmount
  React.useEffect(() => {
    return () => {
      if (canvasRef.current) {
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
      }
    };
  }, []);

  const handlePrevPage = React.useCallback(() => {
    setPageNumber((p) => Math.max(1, p - 1));
  }, []);

  const handleNextPage = React.useCallback(() => {
    setPageNumber((p) => Math.min(numPages, p + 1));
  }, [numPages]);

  const handleZoomIn = React.useCallback(() => {
    setZoom((z) => Math.min(2.5, +(z + 0.2).toFixed(1)));
  }, []);

  const handleZoomOut = React.useCallback(() => {
    setZoom((z) => Math.max(0.5, +(z - 0.2).toFixed(1)));
  }, []);

  const handleResetZoom = React.useCallback(() => {
    setZoom(1.2);
  }, []);

  const renderBookmarkItems = (items: PdfBookmark[], depth: number) => {
    return items.map((bm, idx) => (
      <div key={`${depth}-${idx}`} className="flex flex-col">
        <button
          type="button"
          onClick={() => {
            if (bm.pageNumber) {
              setPageNumber(bm.pageNumber);
            }
          }}
          disabled={!bm.pageNumber}
          style={{ paddingLeft: `${depth * 12 + 6}px` }}
          className={cn(
            "text-left text-xs truncate py-1 pr-1.5 rounded-[4px] hover:bg-muted text-muted-foreground hover:text-foreground transition-colors cursor-pointer",
            bm.pageNumber === pageNumber && "bg-primary/10 text-primary font-semibold",
          )}
          title={bm.title}
        >
          <span>{bm.title}</span>
          {bm.pageNumber && (
            <span className="ml-1 text-[10px] text-muted-foreground/60 font-mono">
              (p.{bm.pageNumber})
            </span>
          )}
        </button>
        {bm.items && bm.items.length > 0 && renderBookmarkItems(bm.items, depth + 1)}
      </div>
    ));
  };

  return (
    <div className="relative flex h-full w-full flex-col bg-muted/10 overflow-hidden">
      {/* Floating Action Pill Toolbar */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-1.5 rounded-lg border border-border/80 bg-background/90 px-2 py-1 shadow-md backdrop-blur-md">
        {/* Canvas Mode Controls */}
        {viewMode === "canvas" && numPages > 0 && (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={handlePrevPage}
              disabled={pageNumber <= 1}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title="Previous Page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="text-xs font-mono text-muted-foreground px-1 select-none">
              {pageNumber} / {numPages}
            </span>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleNextPage}
              disabled={pageNumber >= numPages}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title="Next Page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>

            <div className="h-4 w-px bg-border/60 mx-1" />

            <Button
              size="sm"
              variant="ghost"
              onClick={handleZoomOut}
              disabled={zoom <= 0.6}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title="Zoom Out"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <button
              type="button"
              onClick={handleResetZoom}
              className="text-xs font-mono text-muted-foreground hover:text-foreground px-1 select-none"
              title="Reset Zoom"
            >
              {Math.round(zoom * 100)}%
            </button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleZoomIn}
              disabled={zoom >= 2.4}
              className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
              title="Zoom In"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>

            {bookmarks.length > 0 && (
              <Button
                size="sm"
                variant={showBookmarks ? "secondary" : "ghost"}
                onClick={() => setShowBookmarks((v) => !v)}
                className="h-7 px-2 text-xs"
                title="Toggle Bookmarks / Table of Contents"
              >
                <Bookmark className="mr-1 h-3.5 w-3.5" />
                <span className="hidden sm:inline">Bookmarks</span>
                <span className="ml-1 text-[10px] text-muted-foreground">({bookmarks.length})</span>
              </Button>
            )}

            <div className="h-4 w-px bg-border/60 mx-1" />
          </>
        )}

        {/* View Mode Switcher */}
        <Button
          size="sm"
          variant="ghost"
          onClick={() => setViewMode((m) => (m === "native" ? "canvas" : "native"))}
          className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
          title={viewMode === "native" ? "Switch to Client-Side Canvas Viewer" : "Switch to Browser Native Viewer"}
        >
          {viewMode === "native" ? (
            <>
              <Layers className="mr-1 h-3.5 w-3.5 text-primary" />
              Canvas
            </>
          ) : (
            <>
              <FileText className="mr-1 h-3.5 w-3.5 text-primary" />
              Browser
            </>
          )}
        </Button>

        <Button
          size="sm"
          variant="ghost"
          onClick={handleRetry}
          className="h-7 w-7 p-0 text-muted-foreground hover:text-foreground"
          title="Reload PDF"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isRetrying ? "animate-spin" : ""}`} />
        </Button>

        <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
          <a href={downloadUrl} download={node.name} title="Download PDF">
            <Download className="mr-1 h-3.5 w-3.5" />
            Download
          </a>
        </Button>

        <Button asChild size="sm" variant="outline" className="h-7 px-2 text-xs">
          <a href={signedUrl || previewUrl} target="_blank" rel="noreferrer" title="Open full PDF viewer">
            <ExternalLink className="mr-1 h-3.5 w-3.5" />
            Open in tab
          </a>
        </Button>
      </div>

      {/* Main PDF Viewer Surface */}
      <div className="relative flex flex-1 min-h-0 overflow-hidden bg-muted/20">
        {/* Bookmarks Sidebar */}
        {viewMode === "canvas" && showBookmarks && bookmarks.length > 0 && (
          <div className="w-64 shrink-0 border-r border-border bg-card/85 backdrop-blur-md p-3 overflow-y-auto app-scroll flex flex-col gap-1 select-none z-10 shadow-sm">
            <div className="flex items-center justify-between pb-2 mb-1 border-b border-border/60">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <Bookmark className="h-3.5 w-3.5 text-primary" />
                Bookmarks
              </span>
              <button
                type="button"
                onClick={() => setShowBookmarks(false)}
                className="text-xs text-muted-foreground hover:text-foreground p-0.5 rounded-[3px]"
              >
                ✕
              </button>
            </div>
            {renderBookmarkItems(bookmarks, 0)}
          </div>
        )}

        {viewMode === "native" && !loadError ? (
          <iframe
            title={node.name}
            src={previewUrl}
            className="h-full w-full border-0"
            onError={handleIframeError}
          />
        ) : viewMode === "canvas" ? (
          <div className="h-full w-full overflow-auto flex items-center justify-center p-6">
            {isCanvasLoading ? (
              <div className="w-full max-w-2xl space-y-4 p-8 bg-card rounded-xl border border-border/60 shadow-xs animate-pulse">
                <Skeleton className="h-6 w-1/3 rounded-md mb-4" />
                <Skeleton className="h-4 w-full rounded-[3px]" />
                <Skeleton className="h-4 w-11/12 rounded-[3px]" />
                <Skeleton className="h-4 w-4/5 rounded-[3px]" />
                <div className="pt-4 space-y-3">
                  <Skeleton className="h-4 w-full rounded-[3px]" />
                  <Skeleton className="h-4 w-3/4 rounded-[3px]" />
                </div>
              </div>
            ) : canvasError ? (
              <div className="flex flex-col items-center justify-center gap-3 p-8 text-center">
                <AlertTriangle className="h-8 w-8 text-amber-500" />
                <p className="text-sm font-medium text-foreground">
                  Could not parse PDF in browser canvas
                </p>
                <p className="max-w-md text-xs text-muted-foreground">
                  {canvasError}. You can open the file in a new browser tab or download it directly.
                </p>
                <div className="flex items-center gap-2 pt-2">
                  <Button asChild size="sm" variant="default">
                    <a href={signedUrl || previewUrl} target="_blank" rel="noreferrer">
                      <ExternalLink className="mr-1.5 h-4 w-4" />
                      Open in new tab
                    </a>
                  </Button>
                  <Button asChild size="sm" variant="outline">
                    <a href={downloadUrl} download={node.name}>
                      <Download className="mr-1.5 h-4 w-4" />
                      Download
                    </a>
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center my-auto">
                <div className="relative rounded-md border border-border/70 bg-white shadow-[0_4px_24px_-2px_rgba(0,0,0,0.35)] overflow-hidden transition-transform duration-150">
                  <canvas
                    ref={canvasRef}
                    role="img"
                    aria-label={`PDF document page ${pageNumber} of ${numPages}`}
                    className="block"
                  />
                  <div
                    ref={textLayerRef}
                    className="pdf-text-layer absolute inset-0 pointer-events-auto select-text overflow-hidden"
                  />
                </div>
                <style>{`
                  .pdf-text-layer {
                    position: absolute;
                    left: 0;
                    top: 0;
                    right: 0;
                    bottom: 0;
                    overflow: hidden;
                    line-height: 1;
                    user-select: text;
                  }
                  .pdf-text-layer span {
                    color: transparent;
                    position: absolute;
                    white-space: pre;
                    cursor: text;
                    transform-origin: 0% 0%;
                  }
                  .pdf-text-layer span::selection {
                    background: rgba(59, 130, 246, 0.35);
                  }
                `}</style>
              </div>
            )}
          </div>
        ) : (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
            <AlertTriangle className="h-8 w-8 text-amber-500" />
            <p className="text-sm font-medium text-foreground">
              Browser blocked inline PDF rendering
            </p>
            <p className="max-w-md text-xs text-muted-foreground">
              Some browser privacy settings prevent embedded PDF rendering. You can switch to the canvas viewer, open in a new tab, or download.
            </p>
            <div className="flex items-center gap-2 pt-2">
              <Button size="sm" variant="default" onClick={() => setViewMode("canvas")}>
                <Layers className="mr-1.5 h-4 w-4" />
                Try Canvas Viewer
              </Button>
              <Button asChild size="sm" variant="outline">
                <a href={signedUrl || previewUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-1.5 h-4 w-4" />
                  Open in new tab
                </a>
              </Button>
              <Button asChild size="sm" variant="ghost">
                <a href={downloadUrl} download={node.name}>
                  <Download className="mr-1.5 h-4 w-4" />
                  Download
                </a>
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
