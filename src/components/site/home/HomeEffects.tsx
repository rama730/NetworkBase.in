"use client";

import { useEffect } from "react";
import { setupHome } from "./home-effects";

/** Wires the home page's motion and interactions onto the server-rendered markup; renders nothing. */
export function HomeEffects() {
  useEffect(() => {
    const root = document.getElementById("nbh");
    return root ? setupHome(root) : undefined;
  }, []);
  return null;
}
