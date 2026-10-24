"use client";

import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from "react";
import { observeHistoryGrid } from "@/lib/messaging/history-grid";
import { cn } from "@/lib/utils";

/** Decorative canvas only: Virtuoso and the existing composer still own scrolling and drafts. */
export function MessageHistory({ variant = "conversation", className = "", ...props }: ComponentPropsWithoutRef<"div"> & {
  variant?: "conversation" | "thread";
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => ref.current ? observeHistoryGrid(ref.current) : undefined, []);
  return <div {...props} ref={ref} data-message-history={variant} className={cn("nb-message-history relative min-h-0 flex-1", className)} />;
}
