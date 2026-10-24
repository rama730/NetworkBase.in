"use client";

import * as React from "react";
import {
  ZoomIn,
  ZoomOut,
  RotateCcw,
  RotateCw,
  ExternalLink,
  Code2,
  Image as ImageIcon,
  Grid,
  Copy,
  Check,
  AlertTriangle,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { ProjectNode } from "@/lib/db/schema";
import { extOf } from "../../utils/fileKind";
import { toast } from "@/lib/feedback";

interface ImageViewerDriverProps {
  node: ProjectNode;
  signedUrl: string;
}

export function ImageViewerDriver({
  node,
  signedUrl,
}: ImageViewerDriverProps): React.JSX.Element {
  const ext = React.useMemo(() => extOf(node.name), [node.name]);
  const isSvg = ext === "svg" || (node.mimeType || "").includes("svg");

  const [scale, setScale] = React.useState(1);
  const [position, setPosition] = React.useState({ x: 0, y: 0 });
  const [rotation, setRotation] = React.useState(0);
  const [isDragging, setIsDragging] = React.useState(false);
  const [backdropMode, setBackdropMode] = React.useState<"checkerboard" | "dark" | "white" | "gray">("checkerboard");
  const [imageError, setImageError] = React.useState(false);
  const [svgSource, setSvgSource] = React.useState<string | null>(null);
  const [viewMode, setViewMode] = React.useState<"render" | "code">("render");
  const [copied, setCopied] = React.useState(false);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const imageStageRef = React.useRef<HTMLDivElement>(null);
  const dragStart = React.useRef({ x: 0, y: 0 });
  const positionRef = React.useRef({ x: 0, y: 0 });
  const rafIdRef = React.useRef<number | null>(null);

  // Sync position ref when state changes
  React.useEffect(() => {
    positionRef.current = position;
  }, [position]);

  // Fetch SVG text if it is an SVG file to support viewing source
  React.useEffect(() => {
    if (!isSvg || !signedUrl) return;
    let active = true;
    fetch(signedUrl)
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error("Failed to fetch SVG"))))
      .then((text) => {
        if (active) setSvgSource(text);
      })
      .catch(() => {
        // Non-blocking fallback
      });
    return () => {
      active = false;
    };
  }, [isSvg, signedUrl]);

  const handleZoomIn = React.useCallback(() => {
    setScale((s) => Math.min(Number((s + 0.25).toFixed(2)), 8));
  }, []);

  const handleZoomOut = React.useCallback(() => {
    setScale((s) => Math.max(Number((s - 0.25).toFixed(2)), 0.1));
  }, []);

  const handleReset = React.useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
    setRotation(0);
  }, []);

  const handleRotate = React.useCallback(() => {
    setRotation((r) => (r + 90) % 360);
  }, []);

  const handleActualSize = React.useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  // Trackpad pinch-to-zoom & wheel zoom with focal cursor anchor
  React.useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const onWheel = (e: WheelEvent) => {
      if (e.ctrlKey || e.metaKey || e.altKey) {
        e.preventDefault();
        const rect = el.getBoundingClientRect();
        const cursorX = e.clientX - rect.left - rect.width / 2;
        const cursorY = e.clientY - rect.top - rect.height / 2;
        const factor = e.deltaY < 0 ? 1.15 : 0.85;

        setScale((prevScale) => {
          const newScale = Math.min(Math.max(Number((prevScale * factor).toFixed(2)), 0.1), 16);
          // Focal zoom math: preserve the image point under the cursor
          positionRef.current = {
            x: cursorX - (cursorX - positionRef.current.x) * (newScale / prevScale),
            y: cursorY - (cursorY - positionRef.current.y) * (newScale / prevScale),
          };
          setPosition({ ...positionRef.current });
          return newScale;
        });
      }
    };

    // Safari trackpad gestures
    const onGestureStart = (e: Event) => e.preventDefault();
    const onGestureChange = (e: any) => {
      e.preventDefault();
      if (typeof e.scale === "number") {
        setScale((s) => Math.min(Math.max(Number((s * e.scale).toFixed(2)), 0.1), 16));
      }
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("gesturestart", onGestureStart, { passive: false });
    el.addEventListener("gesturechange", onGestureChange, { passive: false });

    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onGestureStart);
      el.removeEventListener("gesturechange", onGestureChange);
    };
  }, []);

  const updateStageTransform = React.useCallback(() => {
    if (imageStageRef.current) {
      imageStageRef.current.style.transform = `translate3d(${positionRef.current.x}px, ${positionRef.current.y}px, 0) scale(${scale}) rotate(${rotation}deg)`;
    }
  }, [scale, rotation]);

  const handleMouseDown = React.useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      setIsDragging(true);
      dragStart.current = { x: e.clientX - positionRef.current.x, y: e.clientY - positionRef.current.y };
    },
    [],
  );

  const handleMouseMove = React.useCallback(
    (e: React.MouseEvent) => {
      if (!isDragging) return;
      positionRef.current = {
        x: e.clientX - dragStart.current.x,
        y: e.clientY - dragStart.current.y,
      };
      if (!rafIdRef.current) {
        rafIdRef.current = requestAnimationFrame(() => {
          rafIdRef.current = null;
          updateStageTransform();
        });
      }
    },
    [isDragging, updateStageTransform],
  );

  const handleMouseUp = React.useCallback(() => {
    if (isDragging) {
      setIsDragging(false);
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = null;
      }
      setPosition({ ...positionRef.current });
    }
  }, [isDragging]);

  const handleDoubleClick = React.useCallback(() => {
    if (scale !== 1) {
      handleReset();
    } else {
      setScale(2);
    }
  }, [handleReset, scale]);

  const copySvgSource = React.useCallback(async () => {
    if (!svgSource) return;
    try {
      await navigator.clipboard.writeText(svgSource);
      setCopied(true);
      toast.success("SVG code copied to clipboard");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Failed to copy SVG code");
    }
  }, [svgSource]);

  if (imageError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <p className="text-sm font-medium text-foreground">Failed to display image preview</p>
        <p className="max-w-md text-xs text-muted-foreground">
          The file may be corrupted or in an unsupported format.
        </p>
        <Button asChild size="sm" variant="outline">
          <a href={signedUrl} target="_blank" rel="noreferrer">
            <ExternalLink className="mr-2 h-4 w-4" />
            Open directly
          </a>
        </Button>
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-background">
      {/* Floating Toolbar */}
      <div className="absolute right-4 top-4 z-20 flex items-center gap-1 rounded-lg border border-border/80 bg-background/90 px-2 py-1 shadow-md backdrop-blur-md">
        {isSvg && (
          <>
            <Button
              size="sm"
              variant={viewMode === "render" ? "secondary" : "ghost"}
              onClick={() => setViewMode("render")}
              className="h-7 px-2 text-xs"
              title="Rendered image"
            >
              <ImageIcon className="mr-1 h-3.5 w-3.5" />
              Preview
            </Button>
            <Button
              size="sm"
              variant={viewMode === "code" ? "secondary" : "ghost"}
              onClick={() => setViewMode("code")}
              className="h-7 px-2 text-xs"
              title="SVG Source Code"
            >
              <Code2 className="mr-1 h-3.5 w-3.5" />
              Source
            </Button>
            <div className="mx-1 h-4 w-px bg-border" />
          </>
        )}

        {viewMode === "render" ? (
          <>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleZoomOut}
              disabled={scale <= 0.15}
              className="h-7 w-7 p-0"
              title="Zoom out (-)"
            >
              <ZoomOut className="h-3.5 w-3.5" />
            </Button>
            <button
              type="button"
              onClick={handleActualSize}
              className="w-12 select-none text-center text-[11px] font-semibold text-foreground hover:underline"
              title="Click for 100% actual size"
            >
              {Math.round(scale * 100)}%
            </button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleZoomIn}
              disabled={scale >= 7.5}
              className="h-7 w-7 p-0"
              title="Zoom in (+)"
            >
              <ZoomIn className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleReset}
              className="h-7 w-7 p-0"
              title="Reset view"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={handleRotate}
              className="h-7 w-7 p-0"
              title="Rotate 90°"
            >
              <RotateCw className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setBackdropMode((prev) => {
                  if (prev === "checkerboard") return "dark";
                  if (prev === "dark") return "white";
                  if (prev === "white") return "gray";
                  return "checkerboard";
                });
              }}
              className="h-7 w-7 p-0"
              title={`Backdrop Mode: ${backdropMode} (Click to cycle)`}
            >
              <Grid className="h-3.5 w-3.5" />
            </Button>
          </>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            onClick={copySvgSource}
            className="h-7 px-2 text-xs"
            title="Copy SVG"
          >
            {copied ? (
              <Check className="mr-1 h-3.5 w-3.5 text-emerald-500" />
            ) : (
              <Copy className="mr-1 h-3.5 w-3.5" />
            )}
            {copied ? "Copied" : "Copy SVG"}
          </Button>
        )}

        <div className="mx-1 h-4 w-px bg-border" />
        <Button asChild size="sm" variant="ghost" className="h-7 px-2 text-xs">
          <a href={signedUrl} target="_blank" rel="noreferrer" title="Open in new window">
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </Button>
      </div>

      {/* Main Canvas View with GPU-accelerated translate3d */}
      {viewMode === "render" ? (
        <div
          ref={containerRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onDoubleClick={handleDoubleClick}
          className={cn(
            "relative flex-1 cursor-grab overflow-hidden active:cursor-grabbing",
            backdropMode === "checkerboard" && "bg-[linear-gradient(45deg,#f0f0f0_25%,transparent_25%),linear-gradient(-45deg,#f0f0f0_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#f0f0f0_75%),linear-gradient(-45deg,transparent_75%,#f0f0f0_75%)] bg-[size:20px_20px] bg-[position:0_0,0_10px,10px_-10px,-10px_0px] dark:bg-[linear-gradient(45deg,#1f1f1f_25%,transparent_25%),linear-gradient(-45deg,#1f1f1f_25%,transparent_25%),linear-gradient(45deg,transparent_75%,#1f1f1f_75%),linear-gradient(-45deg,transparent_75%,#1f1f1f_75%)]",
            backdropMode === "dark" && "bg-[#111111]",
            backdropMode === "white" && "bg-[#ffffff]",
            backdropMode === "gray" && "bg-[#7f7f7f]",
          )}
        >
          <div
            ref={imageStageRef}
            className="flex h-full w-full items-center justify-center p-6 select-none"
            style={{
              transform: `translate3d(${position.x}px, ${position.y}px, 0) scale(${scale}) rotate(${rotation}deg)`,
              transformOrigin: "center center",
              transition: isDragging ? "none" : "transform 100ms ease-out",
            }}
          >
            {/* Native img tag with cross-browser GPU acceleration */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={signedUrl}
              alt={node.name}
              draggable={false}
              onError={() => setImageError(true)}
              className="max-h-[85vh] max-w-[85vw] object-contain shadow-sm pointer-events-none"
            />
          </div>
        </div>
      ) : (
        /* SVG Source Code Mode */
        <div className="flex-1 overflow-auto p-4 bg-muted/30 font-mono text-xs">
          <pre className="whitespace-pre-wrap break-all text-foreground">
            {svgSource || "Loading SVG source..."}
          </pre>
        </div>
      )}
    </div>
  );
}
