/** Where a saved search opens: its words, its tab and its filters, as the results page reads them. Client-safe. */
export function savedSearchHref(query: string, tab: string, filters: Record<string, unknown>) {
    const params = new URLSearchParams({ q: query });
    if (tab !== "discover") params.set("tab", tab);
    for (const [key, value] of Object.entries(filters)) if (typeof value === "string" && value && !params.has(key)) params.set(key, value);
    return `/search?${params.toString()}`;
}
