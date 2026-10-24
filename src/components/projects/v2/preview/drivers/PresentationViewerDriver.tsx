"use client";

import * as React from "react";
import * as fflate from "fflate";
import {
  ChevronLeft,
  ChevronRight,
  Maximize2,
  Minimize2,
  FileText,
  Download,
  AlertTriangle,
  Loader2,
  ExternalLink,
  Presentation,
  Sliders,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProjectNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { formatBytes } from "../../files-tab/folder/format";
import { extOf } from "../../utils/fileKind";

interface PresentationViewerDriverProps {
  node: ProjectNode;
  signedUrl: string;
}

interface SlideData {
  index: number;
  title: string;
  texts: string[];
  notes?: string;
  imageUrls: string[];
}

export function PresentationViewerDriver({
  node,
  signedUrl,
}: PresentationViewerDriverProps): React.JSX.Element {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [slides, setSlides] = React.useState<SlideData[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = React.useState(0);
  const [aspectRatio, setAspectRatio] = React.useState<"16/9" | "4/3">("16/9");
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [showNotes, setShowNotes] = React.useState(false);
  const [showThumbnails, setShowThumbnails] = React.useState(true);
  const [isLegacy, setIsLegacy] = React.useState(false);

  const ext = React.useMemo(() => extOf(node.name), [node.name]);
  const blobUrlsRef = React.useRef<Set<string>>(new Set());

  // Revoke any created blob URLs on unmount
  React.useEffect(() => {
    const urls = blobUrlsRef.current;
    return () => {
      urls.forEach((url) => URL.revokeObjectURL(url));
      urls.clear();
    };
  }, []);

  React.useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setIsLegacy(false);

    async function loadPresentation() {
      try {
        const res = await fetch(signedUrl);
        if (!res.ok) throw new Error("Failed to fetch presentation file");

        const buffer = await res.arrayBuffer();

        // Safety limit: 60 MB
        if (buffer.byteLength > 60 * 1024 * 1024) {
          throw new Error("File exceeds client-side preview safety limit (60 MB). Please download to view.");
        }

        const uint8 = new Uint8Array(buffer);

        // Check for legacy PPT binary header (0xD0 0xCF 0x11 0xE0)
        if (
          uint8.length >= 4 &&
          uint8[0] === 0xd0 &&
          uint8[1] === 0xcf &&
          uint8[2] === 0x11 &&
          uint8[3] === 0xe0
        ) {
          if (active) {
            setIsLegacy(true);
            setLoading(false);
          }
          return;
        }

        let unzipped: fflate.Unzipped | null = null;
        try {
          unzipped = fflate.unzipSync(uint8);
        } catch {
          if (active) {
            setIsLegacy(true);
            setLoading(false);
          }
          return;
        }

        // 1. Determine aspect ratio from ppt/presentation.xml
        const presEntry = unzipped["ppt/presentation.xml"];
        if (presEntry) {
          const decoder = new TextDecoder("utf-8");
          const xml = decoder.decode(presEntry);
          const parser = new DOMParser();
          const doc = parser.parseFromString(xml, "application/xml");
          const sldSz = doc.getElementsByTagName("p:sldSz")[0];
          if (sldSz) {
            const cx = parseInt(sldSz.getAttribute("cx") || "0", 10);
            const cy = parseInt(sldSz.getAttribute("cy") || "1", 10);
            if (cx > 0 && cy > 0) {
              const ratio = cx / cy;
              setAspectRatio(Math.abs(ratio - 16 / 9) < Math.abs(ratio - 4 / 3) ? "16/9" : "4/3");
            }
          }
        }

        // 2. Map presentation relationships (rId -> slide XML path)
        const relsMap = new Map<string, string>();
        const relsEntry = unzipped["ppt/_rels/presentation.xml.rels"];
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
              const fullPath = target.startsWith("ppt/") ? target : `ppt/${target}`;
              relsMap.set(id, fullPath.replace(/\\/g, "/"));
            }
          }
        }

        // 3. Find slide sequence in order
        const slideFiles: string[] = [];
        if (presEntry) {
          const decoder = new TextDecoder("utf-8");
          const xml = decoder.decode(presEntry);
          const parser = new DOMParser();
          const doc = parser.parseFromString(xml, "application/xml");
          const sldIdNodes = doc.getElementsByTagName("p:sldId");
          for (let i = 0; i < sldIdNodes.length; i++) {
            const rId = sldIdNodes[i]?.getAttribute("r:id") || "";
            const path = relsMap.get(rId);
            if (path && unzipped[path]) {
              slideFiles.push(path);
            }
          }
        }

        // Fallback: search zip directly for slide*.xml
        if (slideFiles.length === 0) {
          const keys = Object.keys(unzipped).filter((k) => /^ppt\/slides\/slide\d+\.xml$/i.test(k));
          keys.sort((a, b) => {
            const numA = parseInt(a.replace(/\D/g, ""), 10) || 0;
            const numB = parseInt(b.replace(/\D/g, ""), 10) || 0;
            return numA - numB;
          });
          slideFiles.push(...keys);
        }

        if (slideFiles.length === 0) {
          throw new Error("No readable slides found in presentation");
        }

        // 4. Parse text and media from slides
        const parsedSlides: SlideData[] = [];
        for (let i = 0; i < slideFiles.length; i++) {
          const path = slideFiles[i]!;
          const slideBytes = unzipped[path];
          if (!slideBytes) continue;

          const decoder = new TextDecoder("utf-8");
          const xml = decoder.decode(slideBytes);
          const parser = new DOMParser();
          const doc = parser.parseFromString(xml, "application/xml");

          // Extract paragraphs and text runs
          const paragraphs = doc.getElementsByTagName("a:p");
          const texts: string[] = [];
          let title = `Slide ${i + 1}`;

          for (let p = 0; p < paragraphs.length; p++) {
            const para = paragraphs[p];
            if (!para) continue;
            const textNodes = para.getElementsByTagName("a:t");
            let line = "";
            for (let t = 0; t < textNodes.length; t++) {
              line += textNodes[t]?.textContent || "";
            }
            line = line.trim();
            if (line) {
              texts.push(line);
              if (title === `Slide ${i + 1}`) {
                title = line.slice(0, 48);
              }
            }
          }

          // Check for slide relationships (images)
          const slideRelPath = path.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
          const slideRelBytes = unzipped[slideRelPath];
          const imageUrls: string[] = [];

          if (slideRelBytes) {
            const relXml = decoder.decode(slideRelBytes);
            const relDoc = parser.parseFromString(relXml, "application/xml");
            const relNodes = relDoc.getElementsByTagName("Relationship");
            for (let r = 0; r < relNodes.length; r++) {
              const rel = relNodes[r];
              const target = rel?.getAttribute("Target");
              const type = rel?.getAttribute("Type") || "";
              if (target && type.includes("image")) {
                const imgPath = target.startsWith("../")
                  ? `ppt/${target.replace("../", "")}`
                  : `ppt/slides/${target}`;
                const imgBytes = unzipped[imgPath];
                if (imgBytes) {
                  const blob = new Blob([imgBytes as unknown as BlobPart]);
                  const blobUrl = URL.createObjectURL(blob);
                  blobUrlsRef.current.add(blobUrl);
                  imageUrls.push(blobUrl);
                }
              }
            }
          }

          parsedSlides.push({
            index: i + 1,
            title,
            texts,
            imageUrls,
          });
        }

        if (active) {
          setSlides(parsedSlides);
          setCurrentSlideIndex(0);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (active) {
          const msg = err instanceof Error ? err.message : "Failed to parse presentation";
          setError(msg);
          setLoading(false);
        }
      }
    }

    loadPresentation();

    return () => {
      active = false;
    };
  }, [signedUrl]);

  // Keyboard navigation shortcuts
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent | KeyboardEvent) => {
      if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
        e.preventDefault();
        setCurrentSlideIndex((prev) => Math.min(slides.length - 1, prev + 1));
      } else if (e.key === "ArrowLeft" || e.key === "PageUp") {
        e.preventDefault();
        setCurrentSlideIndex((prev) => Math.max(0, prev - 1));
      } else if (e.key === "Home") {
        e.preventDefault();
        setCurrentSlideIndex(0);
      } else if (e.key === "End") {
        e.preventDefault();
        setCurrentSlideIndex(slides.length - 1);
      } else if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        toggleFullscreen();
      } else if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        setShowNotes((prev) => !prev);
      }
    },
    [slides.length],
  );

  React.useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const toggleFullscreen = React.useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {});
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {});
    }
  }, []);

  React.useEffect(() => {
    const onFsChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  if (loading) {
    return (
      <div className="flex h-64 flex-col items-center justify-center gap-3">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Parsing presentation slides...</p>
      </div>
    );
  }

  // Legacy .ppt binary card
  if (isLegacy) {
    const officeViewerUrl = `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(signedUrl)}`;
    const googleViewerUrl = `https://docs.google.com/gview?url=${encodeURIComponent(signedUrl)}&embedded=true`;

    return (
      <div className="flex h-full w-full items-center justify-center bg-muted/10 p-6">
        <div className="flex max-w-md flex-col items-center rounded-2xl border border-border bg-card p-8 text-center shadow-sm">
          <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <Presentation className="h-8 w-8" />
          </div>

          <h3 className="max-w-sm truncate text-base font-semibold text-card-foreground" title={node.name}>
            {node.name}
          </h3>
          <p className="mt-1 text-xs text-muted-foreground">
            PowerPoint 97-2003 Presentation (.ppt) • {formatBytes(node.size)}
          </p>

          <p className="mt-4 text-xs leading-relaxed text-muted-foreground">
            This slide deck uses an earlier binary format. You can download the presentation or preview it with web productivity suites.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-2.5">
            <Button asChild size="sm" className="h-9 px-4 text-xs font-medium">
              <a href={signedUrl} download={node.name}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download Presentation
              </a>
            </Button>

            <Button asChild variant="outline" size="sm" className="h-9 px-3 text-xs">
              <a href={officeViewerUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                PowerPoint Online
              </a>
            </Button>

            <Button asChild variant="outline" size="sm" className="h-9 px-3 text-xs">
              <a href={googleViewerUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                Google Slides
              </a>
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (error || slides.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
        <AlertTriangle className="h-8 w-8 text-amber-500" />
        <p className="text-sm font-semibold text-foreground">Unable to render presentation preview</p>
        <p className="max-w-md text-xs text-muted-foreground">{error}</p>
        <Button asChild size="sm" variant="outline" className="mt-2">
          <a href={signedUrl} download={node.name}>
            <Download className="mr-1.5 h-4 w-4" />
            Download Presentation
          </a>
        </Button>
      </div>
    );
  }

  const currentSlide = slides[currentSlideIndex] || slides[0]!;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative flex h-full w-full flex-col bg-background select-none overflow-hidden",
        isFullscreen && "bg-black text-white p-4",
      )}
    >
      {/* Top Slide Header Bar */}
      {!isFullscreen && (
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-border bg-card/60 px-4 backdrop-blur-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Presentation className="h-4 w-4 text-primary shrink-0" />
            <span className="text-xs font-semibold text-foreground truncate max-w-[200px]" title={node.name}>
              {node.name}
            </span>
            <span className="text-[11px] text-muted-foreground">
              · Slide {currentSlideIndex + 1} of {slides.length} ({aspectRatio})
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setShowThumbnails((prev) => !prev)}
              className="h-7 px-2 text-xs"
              title="Toggle Thumbnails"
            >
              <Sliders className="mr-1 h-3.5 w-3.5" />
              <span className="hidden sm:inline">Thumbnails</span>
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={toggleFullscreen}
              className="h-7 px-2 text-xs"
              title="Fullscreen (F)"
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline ml-1">{isFullscreen ? "Exit" : "Present"}</span>
            </Button>

            <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-xs">
              <a href={signedUrl} download={node.name}>
                <Download className="mr-1 h-3.5 w-3.5" />
                <span className="hidden sm:inline">Download</span>
              </a>
            </Button>
          </div>
        </div>
      )}

      {/* Main Slide Stage + Left Thumbnails */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Left Thumbnails Strip */}
        {showThumbnails && !isFullscreen && (
          <div className="w-48 shrink-0 border-r border-border bg-muted/20 p-2 overflow-y-auto app-scroll flex flex-col gap-2">
            {slides.map((slide, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => setCurrentSlideIndex(idx)}
                className={cn(
                  "flex flex-col gap-1 rounded-md border p-1.5 text-left transition-all",
                  currentSlideIndex === idx
                    ? "border-primary bg-primary/10 ring-1 ring-primary shadow-xs"
                    : "border-border/60 bg-card hover:border-border hover:bg-muted/50",
                )}
              >
                <div className="flex items-center justify-between text-[10px] text-muted-foreground font-mono">
                  <span>#{slide.index}</span>
                  <span className="truncate max-w-[100px]">{slide.title}</span>
                </div>
                <div className="aspect-video w-full rounded-[3px] bg-muted flex items-center justify-center overflow-hidden border border-border/40 p-1">
                  {slide.imageUrls.length > 0 ? (
                    <img src={slide.imageUrls[0]} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-[9px] text-muted-foreground text-center line-clamp-2 px-1">
                      {slide.texts[0] || "Slide"}
                    </span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}

        {/* Center Proportional Slide Stage */}
        <div className="flex flex-1 items-center justify-center p-4 sm:p-8 overflow-auto bg-muted/10">
          <div
            style={{
              aspectRatio: aspectRatio === "16/9" ? "16 / 9" : "4 / 3",
            }}
            className={cn(
              "relative flex flex-col justify-between w-full max-w-5xl rounded-xl border border-border bg-card p-8 sm:p-12 shadow-md overflow-hidden transition-all",
              isFullscreen && "border-zinc-800 bg-zinc-950 text-white max-w-7xl",
            )}
          >
            {/* Slide Title */}
            <div className="border-b border-border/40 pb-4">
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground truncate">
                {currentSlide.title}
              </h2>
            </div>

            {/* Slide Body Elements */}
            <div className="flex-1 my-6 flex flex-col sm:flex-row gap-6 overflow-hidden">
              <div className="flex-1 space-y-3 overflow-y-auto app-scroll pr-2">
                {currentSlide.texts.slice(1).map((para, pIdx) => (
                  <p key={pIdx} className="text-sm sm:text-base leading-relaxed text-foreground/90">
                    {para}
                  </p>
                ))}
                {currentSlide.texts.length <= 1 && currentSlide.imageUrls.length === 0 && (
                  <div className="flex h-full items-center justify-center text-xs text-muted-foreground italic">
                    (Slide contains title only or custom vector shapes)
                  </div>
                )}
              </div>

              {/* Embedded Media / Slide Images */}
              {currentSlide.imageUrls.length > 0 && (
                <div className="sm:w-1/2 flex items-center justify-center p-2 rounded-lg bg-muted/20 border border-border/40 overflow-hidden">
                  <img
                    src={currentSlide.imageUrls[0]}
                    alt="Slide asset"
                    className="max-h-64 sm:max-h-80 w-auto object-contain rounded-md"
                  />
                </div>
              )}
            </div>

            {/* Slide Number Watermark */}
            <div className="flex items-center justify-between text-xs text-muted-foreground pt-4 border-t border-border/40 font-mono">
              <span>{node.name}</span>
              <span>{currentSlide.index} / {slides.length}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Floating Bottom Navigation HUD */}
      <div className="flex h-12 shrink-0 items-center justify-center gap-2 border-t border-border bg-background/95 px-4 backdrop-blur-md">
        <Button
          size="sm"
          variant="outline"
          disabled={currentSlideIndex === 0}
          onClick={() => setCurrentSlideIndex((prev) => Math.max(0, prev - 1))}
          className="h-8 px-2.5 text-xs"
        >
          <ChevronLeft className="mr-1 h-3.5 w-3.5" />
          Previous
        </Button>

        <span className="font-mono text-xs text-muted-foreground px-2">
          {currentSlideIndex + 1} / {slides.length}
        </span>

        <Button
          size="sm"
          variant="outline"
          disabled={currentSlideIndex === slides.length - 1}
          onClick={() => setCurrentSlideIndex((prev) => Math.min(slides.length - 1, prev + 1))}
          className="h-8 px-2.5 text-xs"
        >
          Next
          <ChevronRight className="ml-1 h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
