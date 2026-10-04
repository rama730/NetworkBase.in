"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

/** Back to the previous screen; a deep link with no history goes to `fallback`. */
export function useBack(fallback = "/messages") {
  const router = useRouter();
  return useCallback(() => {
    if (window.history.length > 1) router.back();
    else router.push(fallback);
  }, [fallback, router]);
}
