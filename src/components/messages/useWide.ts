"use client";

import { useMediaQuery } from "@/hooks/useMediaQuery";

/** 1024px+ (the two-pane Messages layout). null before hydration knows the width. */
export const useWide = () => useMediaQuery("(min-width: 1024px)");
