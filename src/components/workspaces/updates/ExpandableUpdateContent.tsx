"use client";

import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { WorkspaceUpdateContent } from "@/components/workspaces/updates/UpdateContent";
import { cn } from "@/lib/utils";

export interface ExpandableUpdateContentProps {
  content: string;
  projectId: string;
  projectSlug?: string | null;
  /** Maximum number of lines before clamping. Defaults to 5. */
  clampLines?: number;
  className?: string;
  defaultExpanded?: boolean;
}

// Singleton ResizeObserver shared across all cards to eliminate allocation overhead
// and prevent layout thrashing across long feeds with hundreds of cards.
type ResizeCallback = () => void;
const observerCallbacks = new WeakMap<Element, ResizeCallback>();
let sharedResizeObserver: ResizeObserver | null = null;

function getSharedResizeObserver(): ResizeObserver | null {
  if (typeof window === "undefined" || typeof ResizeObserver === "undefined") {
    return null;
  }
  if (!sharedResizeObserver) {
    sharedResizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const callback = observerCallbacks.get(entry.target);
        if (callback) {
          callback();
        }
      }
    });
  }
  return sharedResizeObserver;
}

const useIsomorphicLayoutEffect = typeof window !== "undefined" ? useLayoutEffect : useEffect;

export const ExpandableUpdateContent = memo(function ExpandableUpdateContent({
  content,
  projectId,
  projectSlug,
  clampLines = 5,
  className,
  defaultExpanded = false,
}: ExpandableUpdateContentProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [canExpand, setCanExpand] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const clampClass = clampLines === 3 ? "line-clamp-3" : clampLines === 4 ? "line-clamp-4" : "line-clamp-5";

  // Fast-path bypass: short updates without newlines cannot possibly overflow 5 lines
  // on any screen width >= 320px. Skipping observer & state measuring saves CPU on ~70-80% of updates.
  const isDefinitelyShort = content.length < 100 && !content.includes("\n");

  // Reset expanded if content is edited by author
  const prevContentRef = useRef(content);
  useEffect(() => {
    if (prevContentRef.current !== content) {
      prevContentRef.current = content;
      setExpanded(false);
    }
  }, [content]);

  useIsomorphicLayoutEffect(() => {
    if (isDefinitelyShort) {
      setCanExpand(false);
      return;
    }

    const element = containerRef.current;
    if (!element) return;

    const measureOverflow = () => {
      if (expanded) return;
      // 2px buffer prevents false positives from sub-pixel rounding on Retina/high-DPI screens
      const isOverflowing = element.scrollHeight - element.clientHeight > 2;
      setCanExpand(isOverflowing);
    };

    // Initial post-layout measurement
    measureOverflow();

    const observer = getSharedResizeObserver();
    if (observer) {
      observerCallbacks.set(element, measureOverflow);
      observer.observe(element);
      return () => {
        observer.unobserve(element);
        observerCallbacks.delete(element);
      };
    }
    return undefined;
  }, [content, isDefinitelyShort, expanded]);

  if (!content.trim()) return null;

  return (
    <div className="w-full">
      <WorkspaceUpdateContent
        containerRef={containerRef}
        content={content}
        projectId={projectId}
        projectSlug={projectSlug}
        className={cn(
          "block w-full whitespace-pre-wrap break-words text-left transition-[max-height] duration-200",
          !expanded && cn(clampClass, "overflow-hidden"),
          className
        )}
      />

      {!isDefinitelyShort && canExpand ? (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={(event) => {
            event.stopPropagation();
            if (expanded) {
              const rect = containerRef.current?.getBoundingClientRect();
              if (rect && rect.top < 80) {
                containerRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
              }
            }
            setExpanded((open) => !open);
          }}
          className="mt-1 inline-flex min-h-8 items-center text-[13px] font-medium text-muted-foreground hover:text-foreground focus-visible:underline focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded-sm"
        >
          {expanded ? "Show less" : "Show more"}
        </button>
      ) : null}
    </div>
  );
});
