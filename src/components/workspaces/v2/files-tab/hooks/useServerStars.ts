"use client";

import { useEffect, useRef } from "react";

import { listMyNodeStarsAction, setNodeStarsAction } from "@/app/actions/files/stars";
import { useFilesStore } from "@/stores/files";

/**
 * Starred files live on the server (report C3, 0087), so the CLI and every browser see the same ones. The store
 * stays the local copy: on open it takes the server's list (after uploading stars this browser had saved before
 * stars moved), and each star or unstar afterwards is sent to the server.
 */
export function useServerStars(projectId: string) {
  const ready = useRef(false);
  useEffect(() => {
    ready.current = false;
    let cancelled = false;
    void (async () => {
      try {
        const local = Object.keys(useFilesStore.getState().byProjectId[projectId]?.favorites ?? {});
        const server = new Set(await listMyNodeStarsAction(projectId));
        const onlyHere = local.filter((id) => !server.has(id));
        if (onlyHere.length) await setNodeStarsAction(projectId, onlyHere, true);
        const merged = onlyHere.length ? await listMyNodeStarsAction(projectId) : [...server];
        if (cancelled) return;
        useFilesStore.getState().setFavorites(projectId, merged);
        ready.current = true;
      } catch {
        // Offline or signed out: the local stars keep working; the next open syncs them.
      }
    })();
    const unsubscribe = useFilesStore.subscribe((state, prev) => {
      if (!ready.current) return;
      const now = state.byProjectId[projectId]?.favorites ?? {};
      const before = prev.byProjectId[projectId]?.favorites ?? {};
      if (now === before) return;
      const added = Object.keys(now).filter((id) => !before[id]);
      const removed = Object.keys(before).filter((id) => !now[id]);
      if (added.length) void setNodeStarsAction(projectId, added, true).catch(() => undefined);
      if (removed.length) void setNodeStarsAction(projectId, removed, false).catch(() => undefined);
    });
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [projectId]);
}
