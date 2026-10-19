"use client";

import { createContext, useContext, type ReactNode } from "react";

// Account settings use Edit Profile's open layout. Other consumers, including
// project settings, keep their existing card presentation by default.
const OpenSettingsSectionsContext = createContext(false);

export function OpenSettingsSections({ children }: { children: ReactNode }) {
    return <OpenSettingsSectionsContext.Provider value={true}>{children}</OpenSettingsSectionsContext.Provider>;
}

export function useOpenSettingsSections() {
    return useContext(OpenSettingsSectionsContext);
}
