"use client";

import { useEffect } from "react";

import { useUIStore } from "@/stores/ui-store";

/** Register this page's real parent for the back arrow's fallback (B13); cleared when the page goes. */
export function useBackParent(href: string | null) {
  const setBackParent = useUIStore((state) => state.setBackParent);
  useEffect(() => {
    setBackParent(href);
    return () => setBackParent(null);
  }, [href, setBackParent]);
}
