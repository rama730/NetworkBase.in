export type WorkspaceVisibility = "public" | "private";
export type WorkspaceVisibilityInput = WorkspaceVisibility | "unlisted" | string | null | undefined;

/**
 * Product visibility is intentionally Public/Private only.
 * Only explicit `public` and legacy `unlisted` rows are publicly readable.
 * Unknown, missing, or corrupted values fail closed as private.
 */
export function normalizeWorkspaceVisibility(value: unknown): WorkspaceVisibility {
    if (value === "public" || value === "unlisted") return "public";
    return "private";
}

export function isWorkspaceVisibility(value: unknown): value is WorkspaceVisibility {
    return value === "public" || value === "private";
}

export function isWorkspacePubliclyReadableVisibility(value: unknown) {
    return normalizeWorkspaceVisibility(value) === "public";
}

export function formatWorkspaceVisibility(value: unknown) {
    return normalizeWorkspaceVisibility(value) === "private" ? "Private" : "Public";
}
