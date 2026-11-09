"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { confirmAppNavigation } from "@/lib/navigation/confirm-navigation";
import { canGoBackInApp, currentEntry } from "@/lib/navigation/in-app-history";

/**
 * Back to the previous in-app screen; a deep link (nothing of ours behind it) goes to `fallback`.
 * Leave guards (unsaved edits, running uploads) are asked first. After a round trip to another
 * site, the entries that site added are skipped (R4).
 */
export function useBack(fallback: string) {
  const router = useRouter();
  return useCallback(() => {
    confirmAppNavigation(() => {
      const skip = currentEntry()?.skip;
      if (skip) window.history.go(-skip);
      else if (canGoBackInApp()) router.back();
      else router.push(fallback);
    });
  }, [fallback, router]);
}
