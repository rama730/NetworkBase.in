import type { SearchHit } from "@/lib/search/global/types";

/** A recently viewed item read back from this device's storage: only a whole hit, linking inside the app. */
export function isStoredHit(value: unknown): value is SearchHit {
    if (!value || typeof value !== "object") return false;
    const hit = value as Partial<SearchHit>;
    return typeof hit.id === "string" && typeof hit.title === "string" && typeof hit.kind === "string"
        && typeof hit.sub === "string" && Array.isArray(hit.tags)
        && typeof hit.href === "string" && hit.href.startsWith("/") && !hit.href.startsWith("//") && !hit.href.includes("\\")
        && Boolean(hit.meta) && typeof hit.meta === "object" && !Array.isArray(hit.meta);
}

/** Tab finishes the word only when a different suggestion is on screen; otherwise Tab moves focus as usual. */
export function acceptsSuggestion({ q, suggestions, shown }: { q: string; suggestions: string[]; shown: boolean }): string | null {
    const first = suggestions[0];
    return shown && first && first.toLowerCase() !== q.trim().toLowerCase() ? first : null;
}
