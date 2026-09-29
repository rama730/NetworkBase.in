"use client";

import React, { createContext, useContext } from "react";
import { createPortal } from "react-dom";

// Keep leaf controls independent of the header's navigation/search imports.
export const FilesHeaderContext = createContext<{
  actions: HTMLDivElement | null;
  status: HTMLDivElement | null;
  canOpenGitHub: boolean;
  /** Lets the Files ⋯ menu offer the desktop IDE handoff on phones, where the header button is hidden. */
  ide?: { projectId: string; projectSlug?: string; location: import("./navigation").CurrentLocation | null; taskId?: string | null };
} | null>(null);

export function FilesHeaderSlot({
  children,
  slot = "actions",
}: {
  children: React.ReactNode;
  slot?: "actions" | "status";
}) {
  const header = useContext(FilesHeaderContext);
  if (!header) return <>{children}</>;
  return header[slot] ? createPortal(children, header[slot]) : null;
}
