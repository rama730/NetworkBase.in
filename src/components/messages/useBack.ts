"use client";

import { useRouter } from "next/navigation";
import { useCallback } from "react";

import { canGoBackInApp } from "@/lib/navigation/in-app-history";

/** Back to the previous in-app screen; a deep link (nothing of ours behind it) goes to `fallback`. */
export function useBack(fallback = "/messages") {
  const router = useRouter();
  return useCallback(() => {
    if (canGoBackInApp()) router.back();
    else router.push(fallback);
  }, [fallback, router]);
}
