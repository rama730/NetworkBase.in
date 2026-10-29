"use client";

import { createContext, useContext, type ReactNode } from "react";

// Shared project dialogs also appear inside Messages. Only project/profile entry
// points opt in; Messages keeps its existing presentation without caller changes.
const PlainContentHeadingsContext = createContext(false);

export function PlainContentHeadings({ children }: { children: ReactNode }) {
    return <PlainContentHeadingsContext.Provider value={true}>{children}</PlainContentHeadingsContext.Provider>;
}

export function usePlainContentHeadings() {
    return useContext(PlainContentHeadingsContext);
}
