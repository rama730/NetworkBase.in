'use client';

import { useCallback, useEffect, useState } from "react";

export type StorageLike = {
  getItem(k: string): string | null;
  setItem(k: string, v: string): void;
  removeItem(k: string): void;
};

// Pages rebuild on back, so text held only in state is lost (unified back B12).
// Drafts live in sessionStorage: same tab only, gone when the tab closes.
// Every access is in try/catch: blocked storage reads as "no draft" and never throws.

export function readSessionDraft(store: StorageLike, key: string): string | null {
  try {
    return store.getItem(key);
  } catch {
    return null;
  }
}

export function writeSessionDraft(store: StorageLike, key: string, value: string): void {
  try {
    if (value) store.setItem(key, value);
    else store.removeItem(key);
  } catch {
    // Blocked or full storage: the draft just isn't kept.
  }
}

// Reaches sessionStorage lazily, so a throwing getter lands inside the try above.
export const sessionDraftStore: StorageLike = {
  getItem: (k) => window.sessionStorage.getItem(k),
  setItem: (k, v) => window.sessionStorage.setItem(k, v),
  removeItem: (k) => window.sessionStorage.removeItem(k),
};

/**
 * useState that also keeps the text in sessionStorage under `key`.
 * `key: null` means plain state (nothing stored). The saved draft loads after mount,
 * so server and first client render match. Setting "" or calling clear removes it.
 */
export function useSessionDraft(
  key: string | null,
  initial = "",
): [string, (v: string) => void, () => void] {
  const [value, setValue] = useState(initial);

  useEffect(() => {
    setValue((key && readSessionDraft(sessionDraftStore, key)) ?? initial);
  }, [key]);

  const set = useCallback((v: string) => {
    setValue(v);
    if (key) writeSessionDraft(sessionDraftStore, key, v);
  }, [key]);

  const clear = useCallback(() => set(""), [set]);

  return [value, set, clear];
}
