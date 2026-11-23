"use client";

import { useEffect } from "react";

/**
 * Controls round 2, drop targets: while anything is being dragged (a file from the computer, or a card), the page
 * carries `data-dragging` and every `[data-drop-target]` shows its dashed grey edge. Nothing shows until a drag starts.
 */
export function DragArming() {
  useEffect(() => {
    const root = document.documentElement;
    let depth = 0;
    const on = () => root.setAttribute("data-dragging", "");
    const off = () => { depth = 0; root.removeAttribute("data-dragging"); };
    const files = (e: DragEvent) => Boolean(e.dataTransfer && [...e.dataTransfer.types].includes("Files"));
    const enter = (e: DragEvent) => { if (!files(e)) return; depth++; on(); };
    const leave = (e: DragEvent) => { if (!files(e)) return; depth = Math.max(0, depth - 1); if (!depth) off(); };
    document.addEventListener("dragstart", on);
    document.addEventListener("dragenter", enter);
    document.addEventListener("dragleave", leave);
    document.addEventListener("dragend", off);
    document.addEventListener("drop", off);
    return () => {
      document.removeEventListener("dragstart", on);
      document.removeEventListener("dragenter", enter);
      document.removeEventListener("dragleave", leave);
      document.removeEventListener("dragend", off);
      document.removeEventListener("drop", off);
      off();
    };
  }, []);
  return null;
}
