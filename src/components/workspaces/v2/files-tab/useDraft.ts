"use client";

import { useEffect, useState } from "react";

/** An unsent comment stays in this browser until it's sent (0.8 #5): change sets and merge requests. */
export function useDraft(key: string) {
  const [text, setText] = useState(() => { try { return window.localStorage.getItem(key) ?? ""; } catch { return ""; } });
  useEffect(() => { try { setText(window.localStorage.getItem(key) ?? ""); } catch { setText(""); } }, [key]);
  const save = (value: string) => { setText(value); try { if (value) window.localStorage.setItem(key, value); else window.localStorage.removeItem(key); } catch { /* private mode */ } };
  return [text, save] as const;
}

/**
 * Unsaved editor text survives switching branch, opening a change set or leaving the page (0.8 #4): kept in this tab's
 * session while it differs from the saved text, with the leave warning. `base` is the version it was edited from;
 * a draft from another base is stale and never restored.
 */
export function useEditDraft(key: string | null, base: string | number | null, value: string | null, saved: string | null) {
  const dirty = Boolean(key) && value !== null && saved !== null && value !== saved;
  useEffect(() => {
    if (!key || value === null || saved === null) return;
    try {
      // ponytail: whole text per change; a diff would matter only for multi-MB files, which aren't kept.
      if (dirty && value.length < 2_000_000) window.sessionStorage.setItem(key, JSON.stringify({ base, text: value }));
      else window.sessionStorage.removeItem(key);
    } catch { /* private mode or full: the leave warning still asks */ }
  }, [key, base, value, saved, dirty]);
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

export function readEditDraft(key: string, base: string | number | null): string | null {
  try {
    const draft = JSON.parse(window.sessionStorage.getItem(key) ?? "null") as { base: unknown; text: unknown } | null;
    return draft && draft.base === base && typeof draft.text === "string" ? draft.text : null;
  } catch { return null; }
}
