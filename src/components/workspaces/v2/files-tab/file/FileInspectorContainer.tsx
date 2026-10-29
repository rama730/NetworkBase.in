"use client";
import React, { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";

/** A single inspector: inline on desktop, focus-contained drawer on small screens. */
export function FileInspectorContainer({
  title,
  onClose,
  children,
  testId,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
  testId?: string;
}) {
  const [compact, setCompact] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.innerWidth < 1024;
  });
  const anchorRef = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    const container = anchorRef.current?.parentElement;
    if (!container) return;
    // Reserve 520px of usable canvas beside the 320px inspector, even when
    // the user widens the independently resizable file tree.
    const sync = () => setCompact(window.innerWidth < 1024 || container.clientWidth < 840);
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(container);
    window.addEventListener("resize", sync);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", sync);
    };
  }, []);
  const anchor = <span ref={anchorRef} hidden aria-hidden="true" />;
  if (compact)
    return (
      <>{anchor}<Dialog
        open
        onOpenChange={(open) => {
          if (!open) onClose();
        }}
      >
        <DialogContent
          presentation="right-drawer"
          showCloseButton={false}
          className="w-[min(24rem,100vw)] gap-0 overflow-hidden p-0"
          data-testid={testId}
        >
          <DialogTitle className="sr-only">{title}</DialogTitle>
          {children}
        </DialogContent>
      </Dialog></>
    );
  return (
    <>{anchor}<aside
      aria-label={title}
      data-testid={testId}
      className="flex w-80 shrink-0 flex-col overflow-hidden border-l border-[#DBD5C8] bg-white dark:border-border dark:bg-card"
    >
      {children}
    </aside></>
  );
}
