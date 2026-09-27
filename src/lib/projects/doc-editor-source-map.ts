export type ProjectDocEditorTargetKind =
    | "blockquote"
    | "code"
    | "command"
    | "heading"
    | "html"
    | "image"
    | "inline-code"
    | "list"
    | "paragraph"
    | "smart-block"
    | "table";

export type ProjectDocEditorSourcePosition = {
    targetId: string;
    kind?: ProjectDocEditorTargetKind | string | null;
    line?: number | null;
    offset?: number | null;
};

function sanitizeTargetKind(kind: string) {
    return kind.replace(/[^a-z0-9-]/gi, "-").toLowerCase() || "block";
}

export function projectDocEditorTargetId(
    kind: ProjectDocEditorTargetKind | string,
    line: number | null | undefined,
    offset: number | null | undefined,
) {
    const safeLine = Number.isFinite(line) && line ? Math.max(1, Math.trunc(line)) : 1;
    const safeOffset = Number.isFinite(offset) ? Math.max(0, Math.trunc(offset ?? 0)) : "line";
    return `readme-editor-${sanitizeTargetKind(kind)}-${safeLine}-${safeOffset}`;
}

