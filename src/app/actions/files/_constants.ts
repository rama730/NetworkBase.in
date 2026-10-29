import { eq, isNull } from "drizzle-orm";
import { workspaceNodes } from "@/lib/db/schema";

export const MAX_NODE_NAME_LENGTH = 255;
export const MAX_SEARCH_QUERY_CHARS = 120;
export const MAX_TREE_PAGE_SIZE = 200;
export const MAX_BULK_NODE_OPS = 200;
/** Links one task may hold; also the most a single attachment read returns. */
export const MAX_TASK_ATTACHMENTS = 200;
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

export function isWithParent(parentId: string | null) {
    return parentId ? eq(workspaceNodes.parentId, parentId) : isNull(workspaceNodes.parentId);
}
