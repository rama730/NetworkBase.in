"use client";

import { useRef, useState } from "react";

// Drop files on the composer, the timeline or the thread list: the matching
// composer (same draft key) attaches them, as if picked with the paperclip.
export const DROP_EVENT = "chat-drop-files";
export type DropDetail = { draftKey: string; files: File[] };

/** The draft key a composer uses: the conversation, or conversation:root for a thread. */
export function draftKeyOf(channelId: string, threadRootSeq: number | null) {
  return threadRootSeq ? `${channelId}:${threadRootSeq}` : channelId;
}

export function dropFilesTo(draftKey: string, files: FileList | File[]) {
  window.dispatchEvent(new CustomEvent<DropDetail>(DROP_EVENT, { detail: { draftKey, files: Array.from(files) } }));
}

const handled = new WeakSet<Event>();
const hasFiles = (event: React.DragEvent) => Array.from(event.dataTransfer?.types ?? []).includes("Files");

/** Drag handlers plus a `dragging` flag; text and in-page drags pass through untouched. */
export function useFileDrop(onFiles: (files: FileList) => void) {
  const [dragging, setDragging] = useState(false);
  const depth = useRef(0);
  const handlers = {
    onDragEnter: (event: React.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current += 1;
      setDragging(true);
    },
    onDragOver: (event: React.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "copy";
    },
    onDragLeave: (event: React.DragEvent) => {
      if (!hasFiles(event)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (!depth.current) setDragging(false);
    },
    onDrop: (event: React.DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      depth.current = 0;
      setDragging(false);
      // Nested drop zones (the composer inside the timeline): the innermost attaches, the outer only resets.
      if (handled.has(event.nativeEvent)) return;
      handled.add(event.nativeEvent);
      if (event.dataTransfer.files.length) onFiles(event.dataTransfer.files);
    },
  };
  return { dragging, handlers };
}

export function DropOverlay({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div className="pointer-events-none absolute inset-2 z-30 grid place-items-center rounded-lg border-2 border-dashed border-primary bg-card/85 text-[13px] font-medium text-primary">
      Drop to attach
    </div>
  );
}
