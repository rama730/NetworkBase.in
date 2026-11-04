"use client";

import { createContext, useContext } from "react";

// Board/review report §6: task cards name a sprint inside a CO in full ("CO1 · Week 3–4") on hover; the board knows
// its sprints, the card only its own.
export const SprintPathContext = createContext<ReadonlyMap<string, string>>(new Map());
export const useSprintPath = (id: string | null | undefined, fallback: string) => useContext(SprintPathContext).get(id ?? "") ?? fallback;
