"use client";

import * as React from "react";
import { X, ArrowRight, Loader2, Columns2, SlidersHorizontal, Image as ImageIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { getFileVersionContentAction } from "@/app/actions/files/versions";

interface AlignedLine {
  type: "added" | "removed" | "unchanged" | "empty";
  content: string;
  lineNumber?: number;
}

export interface FileVersionCompareViewProps {
  projectId: string;
  nodeId: string;
  fileName: string;
  baseVersion: number;
  targetVersion: number;
  onClose: () => void;
}

export function FileVersionCompareView({
  projectId,
  nodeId,
  fileName,
  baseVersion,
  targetVersion,
  onClose,
}: FileVersionCompareViewProps): React.JSX.Element {
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);
  const [leftLines, setLeftLines] = React.useState<AlignedLine[]>([]);
  const [rightLines, setRightLines] = React.useState<AlignedLine[]>([]);

  const isImage = React.useMemo(
    () => /\.(png|jpe?g|webp|gif|svg|avif|bmp|ico)$/i.test(fileName),
    [fileName],
  );
  const [imageMode, setImageMode] = React.useState<"split" | "side-by-side">("split");
  const [splitPercent, setSplitPercent] = React.useState(50);

  const baseImgUrl = React.useMemo(
    () => `/api/v1/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(nodeId)}/preview?v=${baseVersion}`,
    [projectId, nodeId, baseVersion],
  );
  const targetImgUrl = React.useMemo(
    () => `/api/v1/projects/${encodeURIComponent(projectId)}/files/${encodeURIComponent(nodeId)}/preview?v=${targetVersion}`,
    [projectId, nodeId, targetVersion],
  );

  React.useEffect(() => {
    if (isImage) {
      setLoading(false);
      return;
    }

    let active = true;
    setLoading(true);
    setError(null);

    async function loadDiffs() {
      try {
        const [baseRes, targetRes] = await Promise.all([
          getFileVersionContentAction(projectId, nodeId, baseVersion),
          getFileVersionContentAction(projectId, nodeId, targetVersion),
        ]);

        if (!active) return;

        if (!baseRes.success || !targetRes.success) {
          throw new Error("Failed to retrieve file contents for comparison.");
        }

        const baseContent = baseRes.content;
        const targetContent = targetRes.content;

        // Yield to event loop to allow UI render cycle to paint loading indicator cleanly
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (!active) return;

        // Perform line diff computation
        const { diffLines } = await import("diff");
        const diffChunks = diffLines(baseContent, targetContent);

        // Yield again before processing large chunks
        await new Promise<void>((resolve) => setTimeout(resolve, 0));
        if (!active) return;

        interface LineGroup {
          type: "added" | "removed" | "unchanged";
          lines: string[];
        }

        const groups: LineGroup[] = [];
        for (let i = 0; i < diffChunks.length; i++) {
          const chunk = diffChunks[i];
          if (!chunk) continue;
          const lines = chunk.value.split(/\r?\n/);
          if (lines.length > 1 && lines[lines.length - 1] === "") {
            lines.pop();
          }
          groups.push({
            type: chunk.added ? "added" : chunk.removed ? "removed" : "unchanged",
            lines,
          });
        }
        
        const localLeft: AlignedLine[] = [];
        const localRight: AlignedLine[] = [];
        let leftLineNum = 1;
        let rightLineNum = 1;

        let i = 0;
        while (i < groups.length) {
          const current = groups[i]!;
          const next = groups[i + 1];

          if (current.type === "removed" && next && next.type === "added") {
            const removedLines = current.lines;
            const addedLines = next.lines;
            const maxLen = Math.max(removedLines.length, addedLines.length);

            for (let k = 0; k < maxLen; k++) {
              if (k < removedLines.length && k < addedLines.length) {
                localLeft.push({ type: "removed", content: removedLines[k]!, lineNumber: leftLineNum++ });
                localRight.push({ type: "added", content: addedLines[k]!, lineNumber: rightLineNum++ });
              } else if (k < removedLines.length) {
                localLeft.push({ type: "removed", content: removedLines[k]!, lineNumber: leftLineNum++ });
                localRight.push({ type: "empty", content: "" });
              } else {
                localLeft.push({ type: "empty", content: "" });
                localRight.push({ type: "added", content: addedLines[k]!, lineNumber: rightLineNum++ });
              }
            }
            i += 2;
          } else if (current.type === "added" && next && next.type === "removed") {
            const addedLines = current.lines;
            const removedLines = next.lines;
            const maxLen = Math.max(addedLines.length, removedLines.length);

            for (let k = 0; k < maxLen; k++) {
              if (k < addedLines.length && k < removedLines.length) {
                localLeft.push({ type: "removed", content: removedLines[k]!, lineNumber: leftLineNum++ });
                localRight.push({ type: "added", content: addedLines[k]!, lineNumber: rightLineNum++ });
              } else if (k < removedLines.length) {
                localLeft.push({ type: "removed", content: removedLines[k]!, lineNumber: leftLineNum++ });
                localRight.push({ type: "empty", content: "" });
              } else {
                localLeft.push({ type: "empty", content: "" });
                localRight.push({ type: "added", content: addedLines[k]!, lineNumber: rightLineNum++ });
              }
            }
            i += 2;
          } else {
            if (current.type === "added") {
              current.lines.forEach((line) => {
                localLeft.push({ type: "empty", content: "" });
                localRight.push({ type: "added", content: line, lineNumber: rightLineNum++ });
              });
            } else if (current.type === "removed") {
              current.lines.forEach((line) => {
                localLeft.push({ type: "removed", content: line, lineNumber: leftLineNum++ });
                localRight.push({ type: "empty", content: "" });
              });
            } else {
              current.lines.forEach((line) => {
                localLeft.push({ type: "unchanged", content: line, lineNumber: leftLineNum++ });
                localRight.push({ type: "unchanged", content: line, lineNumber: rightLineNum++ });
              });
            }
            i += 1;
          }
        }

        if (active) {
          setLeftLines(localLeft);
          setRightLines(localRight);
          setLoading(false);
        }
      } catch (err) {
        if (active) {
          setError(err instanceof Error ? err.message : "An unexpected error occurred loading comparisons.");
          setLoading(false);
        }
      }
    }

    void loadDiffs();

    return () => {
      active = false;
    };
  }, [projectId, nodeId, baseVersion, targetVersion, isImage]);

  // Synchronized scroll handlers
  const leftScrollRef = React.useRef<HTMLDivElement>(null);
  const rightScrollRef = React.useRef<HTMLDivElement>(null);

  const handleLeftScroll = React.useCallback(() => {
    if (leftScrollRef.current && rightScrollRef.current) {
      rightScrollRef.current.scrollTop = leftScrollRef.current.scrollTop;
    }
  }, []);

  const handleRightScroll = React.useCallback(() => {
    if (leftScrollRef.current && rightScrollRef.current) {
      leftScrollRef.current.scrollTop = rightScrollRef.current.scrollTop;
    }
  }, []);

  if (loading) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-background p-8">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        <p className="mt-4 text-sm text-muted-foreground">Computing comparison changes...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center bg-background p-8">
        <p className="text-sm font-semibold text-red-500">{error}</p>
        <button
          type="button"
          onClick={onClose}
          className="mt-4 rounded-[5px] bg-muted px-3 py-1.5 text-xs font-medium text-foreground transition-colors hover:bg-muted/80"
        >
          Close Compare Mode
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col min-h-0 bg-card border border-border rounded-[8px] overflow-hidden shadow-sm">
      {/* Compare View Header */}
      <div className="flex items-center justify-between border-b border-border px-4 py-2.5 bg-[#F3F0EA] dark:bg-card shrink-0">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[11px] font-semibold text-[#4C5A61] dark:text-muted-foreground uppercase tracking-[0.09em]">Compare Mode</span>
          <span className="text-xs font-medium text-foreground font-mono bg-background border border-border px-1.5 py-0.5 rounded-[3px]">
            v{baseVersion}
          </span>
          <ArrowRight className="h-3.5 w-3.5 text-[#4C5A61]/60" />
          <span className="text-xs font-semibold text-[#D14E24] dark:text-[#FCF0EA] font-mono bg-[#FCF0EA] dark:bg-[#D14E24]/20 border border-[#D14E24]/30 dark:border-[#D14E24]/50 px-1.5 py-0.5 rounded-[3px]">
            v{targetVersion}
          </span>
          <span className="text-xs text-muted-foreground font-medium truncate max-w-xs">
            — {fileName}
          </span>
        </div>

        <div className="flex items-center gap-4">
          {isImage ? (
            <div className="flex items-center gap-1 bg-muted/60 p-0.5 rounded-[5px] border border-border/60">
              <button
                type="button"
                onClick={() => setImageMode("split")}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 text-xs rounded-[4px] font-medium transition-colors",
                  imageMode === "split"
                    ? "bg-background text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <SlidersHorizontal className="h-3 w-3" />
                <span>Split Slider</span>
              </button>
              <button
                type="button"
                onClick={() => setImageMode("side-by-side")}
                className={cn(
                  "flex items-center gap-1.5 px-2 py-1 text-xs rounded-[4px] font-medium transition-colors",
                  imageMode === "side-by-side"
                    ? "bg-background text-foreground shadow-2xs"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                <Columns2 className="h-3 w-3" />
                <span>Side-by-Side</span>
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-3 font-mono text-[11px] font-medium">
              <span className="flex items-center gap-1.5 text-red-700 dark:text-red-400">
                <span className="inline-flex size-3.5 items-center justify-center rounded-[2px] bg-red-100 dark:bg-red-950/50 text-[10px] font-bold text-red-600 border border-red-200 dark:border-red-900">−</span> Removed
              </span>
              <span className="flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400">
                <span className="inline-flex size-3.5 items-center justify-center rounded-[2px] bg-emerald-100 dark:bg-emerald-950/50 text-[10px] font-bold text-emerald-600 border border-emerald-200 dark:border-emerald-900">+</span> Added
              </span>
            </div>
          )}

          <button
            type="button"
            onClick={onClose}
            aria-label="Close Comparison"
            className="rounded-[5px] p-1 text-[#4C5A61] hover:bg-[#DBD5C8]/40 hover:text-foreground dark:hover:bg-muted dark:hover:text-foreground transition-colors"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>

      {isImage ? (
        imageMode === "split" ? (
          /* Split Swipe Slider View */
          <div className="relative flex-1 min-h-0 w-full overflow-hidden flex items-center justify-center p-6 bg-[repeating-conic-gradient(#80808018_0%_25%,transparent_0%_50%)] bg-[size:16px_16px]">
            <div className="relative max-h-full max-w-full overflow-hidden rounded-md border border-border/80 shadow-lg select-none">
              {/* Target image (vTarget) - Base Layer */}
              <img
                src={targetImgUrl}
                alt={`Version ${targetVersion}`}
                className="max-h-[70vh] max-w-full object-contain block"
              />
              {/* Base image (vBase) - Clipped Overlay */}
              <div
                className="absolute inset-0 overflow-hidden"
                style={{ clipPath: `inset(0 ${100 - splitPercent}% 0 0)` }}
              >
                <img
                  src={baseImgUrl}
                  alt={`Version ${baseVersion}`}
                  className="max-h-[70vh] max-w-full object-contain block"
                />
              </div>
              {/* Interactive Divider Line */}
              <div
                className="absolute top-0 bottom-0 w-0.5 bg-primary pointer-events-none shadow-sm"
                style={{ left: `${splitPercent}%` }}
              >
                <div className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 h-6 w-6 rounded-[4px] bg-primary text-primary-foreground flex items-center justify-center shadow-md text-[10px] font-bold">
                  ↔
                </div>
              </div>
            </div>

            {/* Bottom Slider Control Pill */}
            <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex items-center gap-3 bg-background/90 border border-border px-4 py-1.5 rounded-lg shadow-md backdrop-blur-md">
              <span className="text-[11px] font-mono font-semibold text-muted-foreground">v{baseVersion}</span>
              <input
                type="range"
                min={0}
                max={100}
                value={splitPercent}
                onChange={(e) => setSplitPercent(Number(e.target.value))}
                className="w-48 h-1.5 cursor-ew-resize accent-primary"
                title="Drag to compare versions"
              />
              <span className="text-[11px] font-mono font-semibold text-primary">v{targetVersion}</span>
            </div>
          </div>
        ) : (
          /* Side-by-Side Image Comparison View */
          <div className="flex flex-col md:flex-row flex-1 min-h-0 divide-y md:divide-y-0 md:divide-x divide-border overflow-hidden">
            <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[repeating-conic-gradient(#80808018_0%_25%,transparent_0%_50%)] bg-[size:16px_16px] overflow-auto">
              <span className="mb-2 text-xs font-mono font-semibold bg-background/90 px-2.5 py-0.5 rounded border border-border text-muted-foreground shadow-2xs">
                v{baseVersion} (Base)
              </span>
              <img
                src={baseImgUrl}
                alt={`Version ${baseVersion}`}
                className="max-h-[65vh] max-w-full object-contain rounded border border-border/60 shadow-md"
              />
            </div>
            <div className="flex-1 flex flex-col items-center justify-center p-6 bg-[repeating-conic-gradient(#80808018_0%_25%,transparent_0%_50%)] bg-[size:16px_16px] overflow-auto">
              <span className="mb-2 text-xs font-mono font-semibold bg-background/90 px-2.5 py-0.5 rounded border border-primary/40 text-primary shadow-2xs">
                v{targetVersion} (Target)
              </span>
              <img
                src={targetImgUrl}
                alt={`Version ${targetVersion}`}
                className="max-h-[65vh] max-w-full object-contain rounded border border-border/60 shadow-md"
              />
            </div>
          </div>
        )
      ) : (
        /* Aligned Columns Grid for Text / Code Files */
        <div className="flex flex-col md:flex-row flex-1 min-h-0 divide-y md:divide-y-0 md:divide-x divide-border overflow-hidden">
        {/* Left Column (Base Content - vBase) */}
        <div
          ref={leftScrollRef}
          onScroll={handleLeftScroll}
          className="flex-1 overflow-auto bg-background font-mono text-[13px] leading-[1.55]"
        >
          <div className="min-w-max p-4">
            {leftLines.map((line, idx) => (
              <div
                key={`left-${idx}`}
                className={cn(
                  "flex items-start",
                  line.type === "removed" && "bg-red-50 text-red-700 dark:bg-red-950/20 dark:text-red-400 font-semibold",
                  line.type === "empty" && "bg-muted/30 opacity-30 select-none pointer-events-none"
                )}
              >
                {/* Line number */}
                <div className="w-10 shrink-0 text-right pr-2 text-muted-foreground/60 select-none">
                  {line.lineNumber ?? " "}
                </div>
                {/* Glyph indicator */}
                <div className="w-4 shrink-0 text-center select-none font-bold text-xs mr-2 border-r border-border pr-1 text-red-600 dark:text-red-400" aria-hidden="true">
                  {line.type === "removed" ? "−" : " "}
                </div>
                {/* Content */}
                <div className="whitespace-pre select-text">
                  {line.type === "removed" ? <span className="sr-only">Removed: </span> : null}
                  {line.type === "empty" ? "\n" : line.content}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Right Column (Target Content - vTarget) */}
        <div
          ref={rightScrollRef}
          onScroll={handleRightScroll}
          className="flex-1 overflow-auto bg-background font-mono text-[13px] leading-[1.55]"
        >
          <div className="min-w-max p-4">
            {rightLines.map((line, idx) => (
              <div
                key={`right-${idx}`}
                className={cn(
                  "flex items-start",
                  line.type === "added" && "bg-emerald-50 text-emerald-700 dark:bg-emerald-950/20 dark:text-emerald-400 font-semibold",
                  line.type === "empty" && "bg-muted/30 opacity-30 select-none pointer-events-none"
                )}
              >
                {/* Line number */}
                <div className="w-10 shrink-0 text-right pr-2 text-muted-foreground/60 select-none">
                  {line.lineNumber ?? " "}
                </div>
                {/* Glyph indicator */}
                <div className="w-4 shrink-0 text-center select-none font-bold text-xs mr-2 border-r border-border pr-1 text-emerald-600 dark:text-emerald-400" aria-hidden="true">
                  {line.type === "added" ? "+" : " "}
                </div>
                {/* Content */}
                <div className="whitespace-pre select-text">
                  {line.type === "added" ? <span className="sr-only">Added: </span> : null}
                  {line.type === "empty" ? "\n" : line.content}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      )}
    </div>
  );
}
