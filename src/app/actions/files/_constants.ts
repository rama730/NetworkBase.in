import { eq, isNull } from "drizzle-orm";
import { projectNodes } from "@/lib/db/schema";

export const MAX_NODE_NAME_LENGTH = 255;
export const MAX_SEARCH_QUERY_CHARS = 120;
export const MAX_TREE_PAGE_SIZE = 200;
export const MAX_BULK_NODE_OPS = 200;
export { UUID_RE } from "@/lib/validations/uuid";

export const FILES_ERROR_CODES = {
    UNAUTHORIZED: "UNAUTHORIZED",
    FORBIDDEN: "FORBIDDEN",
    NODE_NOT_FOUND: "NODE_NOT_FOUND",
    LOCK_CONFLICT: "LOCK_CONFLICT",
    VERSION_CONFLICT: "VERSION_CONFLICT",
    VALIDATION_ERROR: "VALIDATION_ERROR",
    UNKNOWN_ERROR: "UNKNOWN_ERROR",
} as const;

type FilesErrorCode = (typeof FILES_ERROR_CODES)[keyof typeof FILES_ERROR_CODES];

export type FilesActionSuccess<T> = {
    success: true;
    data: T;
};

export type FilesActionFailure = {
    success: false;
    code: FilesErrorCode;
    message: string;
};

export type FilesActionResult<T> = FilesActionSuccess<T> | FilesActionFailure;

export function escapeLikePattern(input: string): string {
    return input.replace(/[%_\\]/g, (c) => `\\${c}`);
}

export function normalizeNodeName(name: string) {
    return (name || "").trim();
}

export function assertValidNodeName(name: string) {
    if (!name) throw new Error("Name is required");
    if (name.length > MAX_NODE_NAME_LENGTH) throw new Error("Name is too long");
    if (name === "." || name === "..") throw new Error("Invalid name");
    if (name.includes("/") || name.includes("\\")) throw new Error("Name cannot include path separators");
}

export function normalizeSearchQuery(query?: string) {
    const normalized = (query || "").trim();
    if (!normalized) return "";
    return normalized.slice(0, MAX_SEARCH_QUERY_CHARS);
}

export function assertBulkLimit(nodeIds: string[]) {
    if (nodeIds.length === 0) throw new Error("No nodes selected");
    if (nodeIds.length > MAX_BULK_NODE_OPS) {
        throw new Error(`Too many nodes selected. Max allowed: ${MAX_BULK_NODE_OPS}`);
    }
}

export async function formatSqlLight(content: string) {
    const normalized = (content || "").replace(/\r\n/g, "\n");
    try {
        // ponytail: dynamic import keeps sql-formatter out of default server action bundle. ceiling: on-demand SQL formatting. upgrade: static import if SQL formatting becomes standard in all file paths.
        const { format: sqlFormat } = await import("sql-formatter");
        const formatted = sqlFormat(normalized, {
            language: "postgresql",
            keywordCase: "upper",
            tabWidth: 2,
            linesBetweenQueries: 1,
            denseOperators: false,
        });
        const trimmed = formatted
            .split("\n")
            .map((line) => line.replace(/[ \t]+$/g, ""))
            .join("\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        return trimmed ? `${trimmed}\n` : "";
    } catch {
        const withStatementBreaks = normalized
            .split("\n")
            .map((line) => line.replace(/[ \t]+$/g, ""))
            .join("\n")
            .replace(/;[ \t]*(\n|$)/g, ";\n")
            .replace(/\n{3,}/g, "\n\n")
            .trim();
        return withStatementBreaks ? `${withStatementBreaks}\n` : "";
    }
}

export function isWithParent(parentId: string | null) {
    return parentId ? eq(projectNodes.parentId, parentId) : isNull(projectNodes.parentId);
}
