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
  Presentation,
  Sliders,
  ZoomIn,
  ZoomOut,
  LayoutGrid,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import type { WorkspaceNode } from "@/lib/db/schema";
import { cn } from "@/lib/utils";
import { formatBytes } from "../../files-tab/folder/format";
import { extOf } from "../../utils/fileKind";
import { DownloadLink } from "@/components/ui/download-link";

interface PresentationViewerDriverProps {
  node: WorkspaceNode;
  fileUrl: string;
}

interface SlideBox {
  left: number; // percentage (0-100)
  top: number;  // percentage (0-100)
  width: number; // percentage (0-100)
  height: number; // percentage (0-100)
  rotation?: number; // degrees
}

interface SlideElement {
  id: string;
  type: "text" | "image" | "table";
  box: SlideBox;
  texts?: string[];
  imageUrl?: string;
  table?: string[][];
  isTitle?: boolean;
}

interface SlideData {
  index: number;
  title: string;
  texts: string[];
  notes?: string;
  imageUrls: string[];
  tables?: string[][][];
  elements?: SlideElement[];
}

function parseXfrm(container: Element, slideWidthEmu: number, slideHeightEmu: number): SlideBox | undefined {
  const xfrms = container.getElementsByTagName("a:xfrm");
  const xfrm = xfrms.length > 0 ? xfrms[0] : container.getElementsByTagName("p:xfrm")[0];
  if (!xfrm) return undefined;
  const off = xfrm.getElementsByTagName("a:off")[0];
  const ext = xfrm.getElementsByTagName("a:ext")[0];
  if (!off || !ext) return undefined;
  const x = parseInt(off.getAttribute("x") || "0", 10);
  const y = parseInt(off.getAttribute("y") || "0", 10);
  const cx = parseInt(ext.getAttribute("cx") || "0", 10);
  const cy = parseInt(ext.getAttribute("cy") || "0", 10);
  if (cx <= 0 || cy <= 0 || slideWidthEmu <= 0 || slideHeightEmu <= 0) return undefined;
  const left = Math.max(0, Math.min(100, (x / slideWidthEmu) * 100));
  const top = Math.max(0, Math.min(100, (y / slideHeightEmu) * 100));
  const width = Math.max(2, Math.min(100 - left, (cx / slideWidthEmu) * 100));
  const height = Math.max(2, Math.min(100 - top, (cy / slideHeightEmu) * 100));
  const rotStr = xfrm.getAttribute("rot");
  const rotation = rotStr ? Math.round(parseInt(rotStr, 10) / 60000) : undefined;
  return { left, top, width, height, rotation };
}

const MAX_CACHED_PRESENTATION_BYTES = 25 * 1024 * 1024;
const presentationBufferCache = new Map<string, ArrayBuffer>();

function getCachedPresentationBuffer(url: string): ArrayBuffer | undefined {
  const existing = presentationBufferCache.get(url);
  if (existing) {
    presentationBufferCache.delete(url);
    presentationBufferCache.set(url, existing);
  }
  return existing;
}

function setCachedPresentationBuffer(url: string, buffer: ArrayBuffer) {
  if (buffer.byteLength > MAX_CACHED_PRESENTATION_BYTES) return;
  while (presentationBufferCache.size >= 2) {
    const oldest = presentationBufferCache.keys().next().value;
    if (oldest === undefined) break;
    presentationBufferCache.delete(oldest);
  }
  presentationBufferCache.set(url, buffer);
}

export function PresentationViewerDriver({
  node,
  fileUrl,
}: PresentationViewerDriverProps): React.JSX.Element {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [slides, setSlides] = React.useState<SlideData[]>([]);
  const [currentSlideIndex, setCurrentSlideIndex] = React.useState(0);
  const [aspectRatio, setAspectRatio] = React.useState<"16/9" | "4/3">("16/9");
  const [zoom, setZoom] = React.useState<number>(100);
  const [isFullscreen, setIsFullscreen] = React.useState(false);
  const [isHudVisible, setIsHudVisible] = React.useState(false);
  const hudTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
  const [showNotes, setShowNotes] = React.useState(false);
  const [showThumbnails, setShowThumbnails] = React.useState(true);
  const [showGrid, setShowGrid] = React.useState(false);
  const [layoutMode, setLayoutMode] = React.useState<"canvas" | "flow">("canvas");
  const [blankScreen, setBlankScreen] = React.useState<"none" | "black" | "white">("none");
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
        let buffer = getCachedPresentationBuffer(fileUrl);
        if (!buffer) {
          const res = await fetch(fileUrl);
          if (!res.ok) throw new Error("Couldn’t fetch presentation file");
          buffer = await res.arrayBuffer();
          setCachedPresentationBuffer(fileUrl, buffer);
        }

        // Safety limit: 60 MB
        if (buffer.byteLength > 60 * 1024 * 1024) {
          throw new Error("File exceeds client-side preview safety limit (60 MB). Download to view.");
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

        // 1. Determine aspect ratio and dimensions from ppt/presentation.xml
        let slideWidthEmu = 9144000;
        let slideHeightEmu = 5143500;
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
              slideWidthEmu = cx;
              slideHeightEmu = cy;
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
          const relImageMap = new Map<string, string>();

          if (slideRelBytes) {
            const relXml = decoder.decode(slideRelBytes);
            const relDoc = parser.parseFromString(relXml, "application/xml");
            const relNodes = relDoc.getElementsByTagName("Relationship");
            for (let r = 0; r < relNodes.length; r++) {
              const rel = relNodes[r];
              const rId = rel?.getAttribute("Id") || "";
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
                  if (rId) {
                    relImageMap.set(rId, blobUrl);
                  }
                }
              }
            }
          }

          // Extract structured tables from slide
          const tables: string[][][] = [];
          const tableNodes = doc.getElementsByTagName("a:tbl");
          for (let tblIdx = 0; tblIdx < tableNodes.length; tblIdx++) {
            const tblNode = tableNodes[tblIdx];
            if (!tblNode) continue;
            const rows: string[][] = [];
            const trNodes = tblNode.getElementsByTagName("a:tr");
            for (let rIdx = 0; rIdx < trNodes.length; rIdx++) {
              const trNode = trNodes[rIdx];
              if (!trNode) continue;
              const rowCells: string[] = [];
              const tcNodes = trNode.getElementsByTagName("a:tc");
              for (let cIdx = 0; cIdx < tcNodes.length; cIdx++) {
                const tcNode = tcNodes[cIdx];
                const textNodes = tcNode ? tcNode.getElementsByTagName("a:t") : [];
                let cellText = "";
                for (let t = 0; t < textNodes.length; t++) {
                  cellText += textNodes[t]?.textContent || "";
                }
                rowCells.push(cellText.trim());
              }
              if (rowCells.some((c) => c !== "")) {
                rows.push(rowCells);
              }
            }
            if (rows.length > 0) {
              tables.push(rows);
            }
          }

          // Extract EMU percentage-positioned slide elements for high-fidelity canvas layout
          // Traverse <p:spTree> children sequentially to preserve natural document visual z-order
          const elements: SlideElement[] = [];
          const spTree = doc.getElementsByTagName("p:spTree")[0];
          const rawChildren = spTree ? Array.from(spTree.children) : [];
          const shapeNodes = rawChildren.length > 0
            ? rawChildren
            : [...Array.from(doc.getElementsByTagName("p:sp")), ...Array.from(doc.getElementsByTagName("p:pic")), ...Array.from(doc.getElementsByTagName("p:graphicFrame"))];

          let elementCounter = 0;
          for (const sNode of shapeNodes) {
            const tagName = sNode.nodeName;
            if (tagName === "p:sp") {
              const box = parseXfrm(sNode, slideWidthEmu, slideHeightEmu);
              const pNodes = sNode.getElementsByTagName("a:p");
              const spTexts: string[] = [];
              for (let pIdx = 0; pIdx < pNodes.length; pIdx++) {
                const p = pNodes[pIdx];
                if (!p) continue;
                const pPr = p.getElementsByTagName("a:pPr")[0];
                const lvlAttr = pPr?.getAttribute("lvl");
                const lvl = lvlAttr ? parseInt(lvlAttr, 10) : 0;
                const bulletPrefix = lvl > 0 ? "  ".repeat(lvl) + "• " : "";
                const tNodes = p.getElementsByTagName("a:t");
                let line = "";
                for (let t = 0; t < tNodes.length; t++) {
                  line += tNodes[t]?.textContent || "";
                }
                line = line.trim();
                if (line) spTexts.push(bulletPrefix + line);
              }
              if (spTexts.length > 0 && box) {
                elements.push({
                  id: `el-${elementCounter++}`,
                  type: "text",
                  box,
                  texts: spTexts,
                  isTitle: elementCounter === 1 || box.top < 25,
                });
              }
            } else if (tagName === "p:pic") {
              const box = parseXfrm(sNode, slideWidthEmu, slideHeightEmu);
              const blip = sNode.getElementsByTagName("a:blip")[0];
              const rEmbed = blip?.getAttribute("r:embed") || "";
              const imgUrl = relImageMap.get(rEmbed) || imageUrls[elements.filter((e) => e.type === "image").length];
              if (box && imgUrl) {
                elements.push({
                  id: `el-${elementCounter++}`,
                  type: "image",
                  box,
                  imageUrl: imgUrl,
                });
              }
            } else if (tagName === "p:graphicFrame") {
              const box = parseXfrm(sNode, slideWidthEmu, slideHeightEmu);
              const tbl = sNode.getElementsByTagName("a:tbl")[0];
              if (tbl && box) {
                const rows: string[][] = [];
                const trNodes = tbl.getElementsByTagName("a:tr");
                for (let rIdx = 0; rIdx < trNodes.length; rIdx++) {
                  const tr = trNodes[rIdx];
                  if (!tr) continue;
                  const rowCells: string[] = [];
                  const tcNodes = tr.getElementsByTagName("a:tc");
                  for (let cIdx = 0; cIdx < tcNodes.length; cIdx++) {
                    const tc = tcNodes[cIdx];
                    const tNodes = tc ? tc.getElementsByTagName("a:t") : [];
                    let cellText = "";
                    for (let t = 0; t < tNodes.length; t++) {
                      cellText += tNodes[t]?.textContent || "";
                    }
                    rowCells.push(cellText.trim());
                  }
                  if (rowCells.some((c) => c !== "")) {
                    rows.push(rowCells);
                  }
                }
                if (rows.length > 0) {
                  elements.push({
                    id: `el-${elementCounter++}`,
                    type: "table",
                    box,
                    table: rows,
                  });
                }
              }
            }
          }

          // Extract speaker notes if available
          let notesText: string | undefined = undefined;
          const notesPath = `ppt/notesSlides/notesSlide${i + 1}.xml`;
          if (unzipped[notesPath]) {
            try {
              const notesXml = fflate.strFromU8(unzipped[notesPath]);
              const notesDoc = parser.parseFromString(notesXml, "application/xml");
              const notesTNodes = notesDoc.getElementsByTagName("a:t");
              const notesParts: string[] = [];
              for (let nt = 0; nt < notesTNodes.length; nt++) {
                const t = (notesTNodes[nt]?.textContent || "").trim();
                if (t && !t.startsWith("Slide ") && t !== String(i + 1)) {
                  notesParts.push(t);
                }
              }
              if (notesParts.length > 0) {
                notesText = notesParts.join(" ");
              }
            } catch {}
          }

          parsedSlides.push({
            index: i + 1,
            title,
            texts,
            notes: notesText,
            imageUrls,
            tables,
            elements,
          });
        }

        if (active) {
          setSlides(parsedSlides);
          setCurrentSlideIndex(0);
          setLoading(false);
        }
      } catch (err: unknown) {
        if (active) {
          const msg = err instanceof Error ? err.message : "Couldn’t parse presentation";
          setError(msg);
          setLoading(false);
        }
      }
    }

    loadPresentation();

    return () => {
      active = false;
      for (const url of blobUrlsRef.current) {
        URL.revokeObjectURL(url);
      }
      blobUrlsRef.current.clear();
    };
  }, [fileUrl]);



  const toggleFullscreen = React.useCallback(() => {
    if (!containerRef.current) return;
    if (!document.fullscreenElement) {
      containerRef.current.requestFullscreen().then(() => {
        setIsFullscreen(true);
        setIsHudVisible(true);
      }).catch(() => {});
    } else {
      document.exitFullscreen().then(() => {
        setIsFullscreen(false);
        setIsHudVisible(false);
      }).catch(() => {});
    }
  }, []);

  // Keyboard navigation shortcuts with input focus protection
  const handleKeyDown = React.useCallback(
    (e: React.KeyboardEvent | KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) || target.isContentEditable)
      ) {
        return;
      }

      // Do not hijack browser shortcuts (e.g. Cmd+F, Ctrl+F, Cmd+G, Ctrl+B)
      if (e.ctrlKey || e.metaKey || e.altKey) {
        return;
      }

      if (blankScreen !== "none") {
        setBlankScreen("none");
        return;
      }

      if (e.key === "b" || e.key === "B") {
        e.preventDefault();
        setBlankScreen((prev) => (prev === "black" ? "none" : "black"));
      } else if (e.key === "w" || e.key === "W") {
        e.preventDefault();
        setBlankScreen((prev) => (prev === "white" ? "none" : "white"));
      } else if (e.key === "g" || e.key === "G") {
        e.preventDefault();
        setShowGrid((prev) => !prev);
      } else if (e.key === "Escape" && showGrid) {
        e.preventDefault();
        setShowGrid(false);
      } else if (e.key === "ArrowRight" || e.key === "PageDown" || e.key === " ") {
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
    [blankScreen, showGrid, slides.length, toggleFullscreen],
  );

  React.useEffect(() => {
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleKeyDown]);

  const handleZoomIn = React.useCallback(() => {
    setZoom((prev) => Math.min(200, prev + 25));
  }, []);

  const handleZoomOut = React.useCallback(() => {
    setZoom((prev) => Math.max(50, prev - 25));
  }, []);

  const handleResetZoom = React.useCallback(() => {
    setZoom(100);
  }, []);

  const handleMouseMove = React.useCallback(() => {
    if (!isFullscreen) return;
    setIsHudVisible(true);
    if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
    hudTimeoutRef.current = setTimeout(() => {
      setIsHudVisible(false);
    }, 2500);
  }, [isFullscreen]);



  React.useEffect(() => {
    const onFsChange = () => {
      const isFs = Boolean(document.fullscreenElement);
      setIsFullscreen(isFs);
      if (isFs) setIsHudVisible(true);
    };
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  if (loading) {
    return <PresentationSkeleton />;
  }

  // Legacy .ppt binary card
  if (isLegacy) {

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
              <DownloadLink href={fileUrl} filename={node.name}>
                <Download className="mr-1.5 h-3.5 w-3.5" />
                Download presentation
              </DownloadLink>
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
        <p className="text-sm font-semibold text-foreground">Couldn’t render presentation preview</p>
        <p className="max-w-md text-xs text-muted-foreground">{error}</p>
        <Button asChild size="sm" variant="outline" className="mt-2">
          <DownloadLink href={fileUrl} filename={node.name}>
            <Download className="mr-1.5 h-4 w-4" />
            Download presentation
          </DownloadLink>
        </Button>
      </div>
    );
  }

  const currentSlide = slides[currentSlideIndex] || slides[0]!;

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      className={cn(
        "relative flex h-full w-full flex-col bg-background select-none overflow-hidden",
        isFullscreen && "fixed inset-0 z-50 bg-black text-white p-0 m-0 w-screen h-screen",
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
              · Slide {currentSlideIndex + 1} of {slides.length}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Zoom Controls: -, 100%, + */}
            <div className="flex items-center gap-1 border border-border/60 rounded-md px-1 bg-muted/20">
              <Button
                size="sm"
                variant="ghost"
                onClick={handleZoomOut}
                disabled={zoom <= 50}
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                title="Zoom out"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </Button>
              <button
                type="button"
                onClick={handleResetZoom}
                className="text-xs font-mono text-foreground hover:text-primary px-1 select-none min-w-[36px] text-center"
                title="Reset Zoom to 100%"
              >
                {zoom}%
              </button>
              <Button
                size="sm"
                variant="ghost"
                onClick={handleZoomIn}
                disabled={zoom >= 200}
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                title="Zoom in"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </Button>
            </div>

            <Button
              size="sm"
              variant={layoutMode === "canvas" ? "secondary" : "ghost"}
              onClick={() => setLayoutMode((m) => (m === "canvas" ? "flow" : "canvas"))}
              className="h-7 px-2 text-xs"
              title="Switch layout"
            >
              <Layers className="mr-1 h-3.5 w-3.5" />
              <span className="hidden sm:inline">{layoutMode === "canvas" ? "Layout" : "Flow"}</span>
            </Button>

            <Button
              size="sm"
              variant={showNotes ? "secondary" : "ghost"}
              onClick={() => setShowNotes((prev) => !prev)}
              className="h-7 px-2 text-xs"
              title="Toggle Slide Notes and Text Transcript (N)"
            >
              <FileText className="mr-1 h-3.5 w-3.5" />
              <span className="hidden sm:inline">Notes</span>
            </Button>

            <Button
              size="sm"
              variant={showThumbnails ? "secondary" : "ghost"}
              onClick={() => setShowThumbnails((prev) => !prev)}
              className="h-7 px-2 text-xs"
              title="Toggle thumbnails"
            >
              <Sliders className="mr-1 h-3.5 w-3.5" />
              <span className="hidden sm:inline">Thumbnails</span>
            </Button>

            <Button
              size="sm"
              variant={showGrid ? "secondary" : "ghost"}
              onClick={() => setShowGrid((prev) => !prev)}
              className="h-7 px-2 text-xs"
              title="Slide Overview Grid (G)"
            >
              <LayoutGrid className="mr-1 h-3.5 w-3.5" />
              <span className="hidden sm:inline">Grid</span>
            </Button>

            <Button
              size="sm"
              variant="ghost"
              onClick={toggleFullscreen}
              className="h-7 px-2 text-xs"
              title="Fullscreen Presenter (F)"
            >
              {isFullscreen ? <Minimize2 className="h-3.5 w-3.5" /> : <Maximize2 className="h-3.5 w-3.5" />}
              <span className="hidden sm:inline ml-1">{isFullscreen ? "Exit" : "Present"}</span>
            </Button>

            <Button asChild size="sm" variant="outline" className="h-7 px-2.5 text-xs">
              <DownloadLink href={fileUrl} filename={node.name}>
                <Download className="mr-1 h-3.5 w-3.5" />
                <span className="hidden sm:inline">Download</span>
              </DownloadLink>
            </Button>
          </div>
        </div>
      )}

      {/* Main Slide Stage + Left Thumbnails + Notes Drawer */}
      <div className="flex flex-1 min-h-0 overflow-hidden relative">
        {/* Left Thumbnails Strip */}
        {showThumbnails && !isFullscreen && (
          <div className="w-52 shrink-0 border-r border-border bg-muted/20 p-2.5 overflow-y-auto app-scroll flex flex-col gap-2.5">
            {slides.map((slide, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <span className="text-xs font-mono text-muted-foreground w-4 text-right shrink-0 select-none">
                  {idx + 1}
                </span>
                <button
                  type="button"
                  onClick={() => setCurrentSlideIndex(idx)}
                  className={cn(
                    "flex-1 aspect-video rounded-md border overflow-hidden transition-all bg-card p-0.5 relative group focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary",
                    currentSlideIndex === idx
                      ? "border-primary ring-2 ring-primary/80 shadow-xs"
                      : "border-border/60 hover:border-border hover:bg-muted/50",
                  )}
                  title={`Slide ${idx + 1}`}
                >
                  {slide.imageUrls.length > 0 ? (
                    <img
                      src={slide.imageUrls[0]}
                      alt={`Slide ${idx + 1}`}
                      className="h-full w-full object-contain rounded-[3px] bg-background"
                    />
                  ) : (
                    <div className="h-full w-full rounded-[3px] bg-muted/30 flex items-center justify-center p-2 text-center">
                      <span className="text-[10px] font-medium text-foreground line-clamp-2">
                        {slide.title.startsWith("Slide ") ? `Slide ${idx + 1}` : slide.title}
                      </span>
                    </div>
                  )}
                </button>
              </div>
            ))}
          </div>
        )}

        {/* Center Slide Stage */}
        <div
          className={cn(
            "flex flex-1 items-center justify-center overflow-auto",
            isFullscreen ? "bg-black p-0 h-full w-full" : "p-3 sm:p-6 md:p-8 bg-muted/10",
          )}
        >
          <div
            style={{
              aspectRatio: aspectRatio === "16/9" ? "16 / 9" : "4 / 3",
              transform: `scale(${zoom / 100})`,
              transformOrigin: "center center",
            }}
            className={cn(
              "relative flex items-center justify-center transition-transform duration-150",
              isFullscreen
                ? "h-full w-full max-h-screen max-w-screen"
                : "w-full max-w-5xl rounded-xl border border-border bg-card shadow-lg overflow-hidden",
            )}
          >
            {/* High-Fidelity Canvas Layout Mode (EMU Coordinate Percentages) */}
            {layoutMode === "canvas" && currentSlide.elements && currentSlide.elements.length > 0 ? (
              <div className="relative h-full w-full overflow-hidden p-3 select-text bg-background">
                {currentSlide.elements.map((el) => {
                  if (el.type === "image" && el.imageUrl) {
                    return (
                      <div
                        key={el.id}
                        className="absolute overflow-hidden pointer-events-none select-none flex items-center justify-center"
                        style={{
                          left: `${el.box.left}%`,
                          top: `${el.box.top}%`,
                          width: `${el.box.width}%`,
                          height: `${el.box.height}%`,
                          transform: el.box.rotation ? `rotate(${el.box.rotation}deg)` : undefined,
                          transformOrigin: "center center",
                        }}
                      >
                        <img src={el.imageUrl} alt="" className="w-full h-full object-contain" />
                      </div>
                    );
                  }
                  if (el.type === "table" && el.table) {
                    return (
                      <div
                        key={el.id}
                        className="absolute overflow-auto rounded border border-border/60 bg-card/95 shadow-2xs p-1"
                        style={{
                          left: `${el.box.left}%`,
                          top: `${el.box.top}%`,
                          width: `${el.box.width}%`,
                          height: `${el.box.height}%`,
                          transform: el.box.rotation ? `rotate(${el.box.rotation}deg)` : undefined,
                          transformOrigin: "center center",
                        }}
                      >
                        <table className="w-full border-collapse text-left text-[11px]">
                          <tbody>
                            {el.table.map((row, rIdx) => (
                              <tr key={rIdx} className={cn("border-b border-border/40 last:border-b-0", rIdx === 0 && "bg-muted/50 font-semibold")}>
                                {row.map((cell, cIdx) => (
                                  <td key={cIdx} className="border-r border-border/30 last:border-r-0 p-1 text-foreground/90">
                                    {cell}
                                  </td>
                                ))}
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    );
                  }
                  if (el.type === "text" && el.texts) {
                    return (
                      <div
                        key={el.id}
                        className="absolute overflow-hidden p-1 flex flex-col justify-start"
                        style={{
                          left: `${el.box.left}%`,
                          top: `${el.box.top}%`,
                          width: `${el.box.width}%`,
                          height: `${el.box.height}%`,
                          transform: el.box.rotation ? `rotate(${el.box.rotation}deg)` : undefined,
                          transformOrigin: "center center",
                        }}
                      >
                        {el.texts.map((para, pIdx) => (
                          <p
                            key={pIdx}
                            className={cn(
                              "text-foreground/90 leading-snug",
                              el.isTitle && pIdx === 0
                                ? "text-base sm:text-lg md:text-xl font-bold tracking-tight text-foreground mb-1"
                                : "text-xs sm:text-sm",
                            )}
                          >
                            {para}
                          </p>
                        ))}
                      </div>
                    );
                  }
                  return null;
                })}
              </div>
            ) : currentSlide.imageUrls.length > 0 && currentSlide.texts.length > 0 ? (
              <div className="flex flex-col h-full w-full p-6 sm:p-8 overflow-hidden">
                {!currentSlide.title.startsWith("Slide ") && (
                  <div className="border-b border-border/40 pb-3 shrink-0">
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground truncate">
                      {currentSlide.title}
                    </h2>
                  </div>
                )}
                <div className="flex-1 min-h-0 my-4 grid grid-cols-1 md:grid-cols-2 gap-6 items-center">
                  <div className="h-full w-full flex items-center justify-center p-2 rounded-lg bg-muted/20 border border-border/30 overflow-hidden">
                    <img
                      src={currentSlide.imageUrls[0]}
                      alt={currentSlide.title}
                      className="max-h-full max-w-full object-contain select-none shadow-xs rounded-[4px]"
                    />
                  </div>
                  <div className="flex flex-col space-y-3 overflow-y-auto app-scroll pr-2">
                    {currentSlide.texts.map((para, pIdx) => (
                      <p key={pIdx} className="text-sm sm:text-base leading-relaxed text-foreground/90">
                        {para}
                      </p>
                    ))}
                    {currentSlide.tables && currentSlide.tables.length > 0 && (
                      <div className="space-y-4 pt-2">
                        {currentSlide.tables.map((table, tIdx) => (
                          <div key={tIdx} className="overflow-x-auto rounded-lg border border-border/60 bg-muted/20">
                            <table className="w-full border-collapse text-left text-xs">
                              <tbody>
                                {table.map((row, rIdx) => (
                                  <tr key={rIdx} className={cn("border-b border-border/40 last:border-b-0", rIdx === 0 && "bg-muted/40 font-semibold")}>
                                    {row.map((cell, cIdx) => (
                                      <td key={cIdx} className="border-r border-border/30 last:border-r-0 p-2 text-foreground/90">
                                        {cell}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ) : currentSlide.imageUrls.length > 0 ? (
              <div
                className={cn(
                  "relative h-full w-full flex items-center justify-center",
                  isFullscreen ? "p-0" : "p-2 sm:p-4 bg-background",
                )}
              >
                <img
                  src={currentSlide.imageUrls[0]}
                  alt={currentSlide.title}
                  className="h-full w-full object-contain select-none"
                />
              </div>
            ) : (
              <div className="flex flex-col justify-between h-full w-full p-8 sm:p-12">
                {!currentSlide.title.startsWith("Slide ") && (
                  <div className="border-b border-border/40 pb-4">
                    <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground truncate">
                      {currentSlide.title}
                    </h2>
                  </div>
                )}
                <div className="flex-1 my-6 space-y-3 overflow-y-auto app-scroll pr-2">
                  {currentSlide.texts.map((para, pIdx) => (
                    <p key={pIdx} className="text-sm sm:text-base leading-relaxed text-foreground/90">
                      {para}
                    </p>
                  ))}
                  {currentSlide.tables && currentSlide.tables.length > 0 && (
                    <div className="space-y-4 pt-2">
                      {currentSlide.tables.map((table, tIdx) => (
                        <div key={tIdx} className="overflow-x-auto rounded-lg border border-border/60 bg-muted/20">
                          <table className="w-full border-collapse text-left text-xs">
                            <tbody>
                              {table.map((row, rIdx) => (
                                <tr key={rIdx} className={cn("border-b border-border/40 last:border-b-0", rIdx === 0 && "bg-muted/40 font-semibold")}>
                                  {row.map((cell, cIdx) => (
                                    <td key={cIdx} className="border-r border-border/30 last:border-r-0 p-2 text-foreground/90">
                                      {cell}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  )}
                  {currentSlide.texts.length === 0 && (!currentSlide.tables || currentSlide.tables.length === 0) && (
                    <div className="flex h-full items-center justify-center text-xs text-muted-foreground italic">
                      (Slide contains vector graphics or background design)
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Screen-reader live region for slide announcements */}
            <div className="sr-only" aria-live="polite" aria-atomic="true">
              Slide {currentSlideIndex + 1} of {slides.length}: {currentSlide.title}
            </div>
          </div>
        </div>

        {/* Speaker Notes / Text Transcript Drawer */}
        {showNotes && !isFullscreen && (
          <div className="w-80 shrink-0 border-l border-border bg-card/95 p-4 overflow-y-auto app-scroll flex flex-col gap-3 backdrop-blur-md">
            <div className="flex items-center justify-between border-b border-border/60 pb-2">
              <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                <FileText className="h-3.5 w-3.5 text-primary" />
                Slide {currentSlideIndex + 1} Notes and transcript
              </span>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setShowNotes(false)}
                className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
              >
                ✕
              </Button>
            </div>

            {currentSlide.notes && (
              <div className="space-y-1">
                <span className="text-[11px] font-semibold text-primary uppercase tracking-wider">
                  Speaker notes
                </span>
                <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap rounded-md bg-muted/30 p-2.5 border border-border/40">
                  {currentSlide.notes}
                </p>
              </div>
            )}

            <div className="space-y-1.5 flex-1">
              <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Extracted text
              </span>
              {currentSlide.texts.length > 0 ? (
                <div className="space-y-2 text-xs text-muted-foreground leading-relaxed">
                  {currentSlide.texts.map((t, idx) => (
                    <p key={idx} className="rounded-md bg-muted/20 p-2 border border-border/30">
                      {t}
                    </p>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground italic">
                  No separate text runs found in slide XML.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Normal View Bottom Navigation HUD */}
      {!isFullscreen && (
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
      )}

      {/* Fullscreen Auto-Hiding Floating HUD */}
      {isFullscreen && (
        <div
          className={cn(
            "absolute bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 rounded-full border border-white/20 bg-black/85 px-4 py-2 text-white shadow-2xl backdrop-blur-md transition-all duration-300",
            isHudVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4 pointer-events-none",
          )}
          onMouseEnter={() => {
            if (hudTimeoutRef.current) clearTimeout(hudTimeoutRef.current);
            setIsHudVisible(true);
          }}
        >
          <Button
            size="sm"
            variant="ghost"
            disabled={currentSlideIndex === 0}
            onClick={() => setCurrentSlideIndex((prev) => Math.max(0, prev - 1))}
            className="h-8 w-8 p-0 text-white hover:bg-white/20 hover:text-white rounded-full"
            title="Previous slide"
          >
            <ChevronLeft className="h-4 w-4" />
          </Button>

          <span className="font-mono text-xs font-medium text-white/90 px-2 select-none">
            {currentSlideIndex + 1} / {slides.length}
          </span>

          <Button
            size="sm"
            variant="ghost"
            disabled={currentSlideIndex === slides.length - 1}
            onClick={() => setCurrentSlideIndex((prev) => Math.min(slides.length - 1, prev + 1))}
            className="h-8 w-8 p-0 text-white hover:bg-white/20 hover:text-white rounded-full"
            title="Next slide"
          >
            <ChevronRight className="h-4 w-4" />
          </Button>

          <div className="h-4 w-px bg-white/20 mx-1" />

          <Button
            size="sm"
            variant="ghost"
            onClick={toggleFullscreen}
            className="h-8 px-2.5 text-xs text-white hover:bg-white/20 hover:text-white rounded-full"
            title="Exit Fullscreen (Esc or F)"
          >
            <Minimize2 className="mr-1 h-3.5 w-3.5" />
            Exit
          </Button>
        </div>
      )}

      {/* Presenter Blackout / Whiteout Mode (B / W keys) */}
      {blankScreen !== "none" && (
        <div
          onClick={() => setBlankScreen("none")}
          className={cn(
            "absolute inset-0 z-50 flex items-center justify-center cursor-pointer transition-colors duration-200 select-none",
            blankScreen === "black" ? "bg-black text-neutral-600" : "bg-white text-neutral-400",
          )}
          title="Click to resume presentation"
        >
          <span className="text-xs opacity-60">
            Press any key or click to resume
          </span>
        </div>
      )}

      {/* Slide Overview Grid Overlay (G key) */}
      {showGrid && (
        <div className="absolute inset-0 z-40 bg-background/95 backdrop-blur-md p-6 overflow-y-auto app-scroll flex flex-col">
          <div className="flex items-center justify-between pb-4 border-b border-border">
            <span className="text-sm font-semibold text-foreground flex items-center gap-2">
              <LayoutGrid className="h-4 w-4 text-primary" />
              Slide Overview ({slides.length} slides)
            </span>
            <button
              type="button"
              onClick={() => setShowGrid(false)}
              className="text-xs text-muted-foreground hover:text-foreground px-2 py-1 rounded-[3px] border border-border/60 hover:bg-muted"
            >
              Close (Esc / G)
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-4 pt-4">
            {slides.map((s, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => {
                  setCurrentSlideIndex(idx);
                  setShowGrid(false);
                }}
                className={cn(
                  "group text-left rounded-lg border p-2 transition-all hover:scale-[1.02] flex flex-col gap-1.5 focus:outline-none focus:ring-2 focus:ring-primary",
                  idx === currentSlideIndex
                    ? "border-primary bg-primary/10 shadow-xs"
                    : "border-border/70 bg-card hover:border-primary/50",
                )}
              >
                <div className="aspect-video w-full rounded bg-muted/40 border border-border/40 overflow-hidden flex items-center justify-center p-2">
                  {s.imageUrls[0] ? (
                    <img src={s.imageUrls[0]} alt="" className="h-full w-full object-contain" />
                  ) : (
                    <span className="text-[10px] text-muted-foreground line-clamp-3">
                      {s.texts[0] || "(Blank Slide)"}
                    </span>
                  )}
                </div>
                <div className="flex items-center justify-between text-[11px] w-full">
                  <span className="font-semibold text-foreground">Slide {s.index}</span>
                  <span className="text-muted-foreground truncate max-w-[100px]">{s.title}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function PresentationSkeleton(): React.JSX.Element {
  return (
    <div
      role="status"
      aria-busy="true"
      aria-label="Loading presentation"
      className="flex h-full w-full flex-col bg-background select-none"
    >
      <div className="flex h-11 shrink-0 items-center justify-between border-b border-border/40 px-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-4 w-4 rounded-[3px]" />
          <Skeleton className="h-4 w-44 rounded-[3px]" />
        </div>
        <div className="flex items-center gap-2">
          <Skeleton className="h-7 w-20 rounded-md" />
          <Skeleton className="h-7 w-20 rounded-md" />
        </div>
      </div>
      <div className="flex flex-1 min-h-0 overflow-hidden">
        <div className="w-52 shrink-0 border-r border-border/40 p-3 space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-2">
              <Skeleton className="h-3 w-3 rounded-full" />
              <Skeleton className="flex-1 aspect-video rounded-md" />
            </div>
          ))}
        </div>
        <div className="flex flex-1 items-center justify-center p-8">
          <div className="aspect-video w-full max-w-4xl rounded-xl border border-border/60 bg-card p-8 flex flex-col justify-between shadow-xs">
            <Skeleton className="h-7 w-1/3 rounded-md" />
            <div className="space-y-3">
              <Skeleton className="h-4 w-5/6 rounded-[3px]" />
              <Skeleton className="h-4 w-3/4 rounded-[3px]" />
              <Skeleton className="h-4 w-2/3 rounded-[3px]" />
            </div>
            <div className="flex justify-between">
              <Skeleton className="h-3 w-24 rounded-[3px]" />
              <Skeleton className="h-3 w-12 rounded-[3px]" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
