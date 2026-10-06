"use client";

import { useSyncExternalStore } from "react";

const WIDE = "(min-width: 1024px)";
const subscribeWide = (onChange: () => void) => {
  const media = window.matchMedia(WIDE);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
};

/** 1024px+ (the two-pane Messages layout). null before hydration knows the width. */
export function useWide() {
  return useSyncExternalStore(subscribeWide, () => window.matchMedia(WIDE).matches, () => null);
}
