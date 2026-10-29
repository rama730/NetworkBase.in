export const PROJECT_DOC_DEFAULT_SLUG = "readme";
export const PROJECT_DOC_SLUG_MAX_LENGTH = 80;

export function normalizeProjectDocSlug(value: unknown, fallback = PROJECT_DOC_DEFAULT_SLUG) {
    const fallbackSlug = typeof fallback === "string" && fallback.trim()
        ? fallback.trim().toLowerCase()
        : PROJECT_DOC_DEFAULT_SLUG;
    const raw = typeof value === "string" ? value : "";
    const normalized = raw
        .trim()
        .toLowerCase()
        .replace(/\.(md|mdx|markdown)$/i, "")
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/-+/g, "-")
        .replace(/^[-_]+|[-_]+$/g, "")
        .slice(0, PROJECT_DOC_SLUG_MAX_LENGTH)
        .replace(/^[-_]+|[-_]+$/g, "");
    return normalized || fallbackSlug;
}

export function isProjectDocSlugCanonical(value: unknown) {
    return typeof value === "string" && value === normalizeProjectDocSlug(value);
}

export function nextFreeDocSlug(base: string, taken: Set<string>) {
    if (!taken.has(base)) return base;
    let n = 2;
    while (taken.has(`${base}-${n}`)) n += 1;
    return `${base}-${n}`;
}
