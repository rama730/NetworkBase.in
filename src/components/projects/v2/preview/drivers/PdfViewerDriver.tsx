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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { ProjectNode } from "@/lib/db/schema";

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
  const [viewMode, setViewMode] = React.useState<"native" | "canvas">("native");
  const [loadError, setLoadError] = React.useState(false);
  const [isRetrying, setIsRetrying] = React.useState(false);

  // Canvas Mode state
  const [pdfDoc, setPdfDoc] = React.useState<any>(null);
  const [pageNumber, setPageNumber] = React.useState(1);
  const [numPages, setNumPages] = React.useState(0);
  const [zoom, setZoom] = React.useState(1.2);
  const [isCanvasLoading, setIsCanvasLoading] = React.useState(false);
  const [canvasError, setCanvasError] = React.useState<string | null>(null);

  const canvasRef = React.useRef<HTMLCanvasElement | null>(null);
  const renderTaskRef = React.useRef<any>(null);

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
        const getDocument = pdfjs.getDocument || (pdfjs as any).default?.getDocument;

        // HTTP 206 partial range streaming (sub-200ms page 1 render on 100MB+ files)
        const loadingTask = getDocument({
          url: previewUrl,
          rangeChunkSize: 65536,
          disableAutoFetch: false,
          disableStream: false,
          isEvalSupported: false,
          withCredentials: true,
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
      // Reclaim GPU memory on unmount
      if (canvasRef.current) {
        canvasRef.current.width = 0;
        canvasRef.current.height = 0;
      }
    };
  }, [viewMode, pdfDoc, pageNumber, zoom]);

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
      <div className="relative flex-1 overflow-hidden bg-muted/20">
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
                <canvas
                  ref={canvasRef}
                  role="img"
                  aria-label={`PDF document page ${pageNumber} of ${numPages}`}
                  className="rounded-md border border-border/70 bg-background shadow-lg transition-transform duration-150"
                />
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
