
export function projectDocCommandBlockId(blockIndex: number) {
    return `readme-command-${blockIndex}`;
}

export function projectDocCommandLineTargetId(blockIndex: number, commandIndex: number) {
    return `${projectDocCommandBlockId(blockIndex)}-command-${commandIndex}`;
}

function safeReadmeTargetSegment(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "-")
        .replace(/^-+|-+$/g, "") || "target";
}

export function projectDocReferenceTargetId(kind: string, id: string, index: number) {
    return `readme-ref-${safeReadmeTargetSegment(kind)}-${safeReadmeTargetSegment(id)}-${index}`;
}

export function decodeReadmeHashTarget(hash: string) {
    const raw = hash.startsWith("#") ? hash.slice(1) : hash;
    if (!raw) return null;
    try {
        return decodeURIComponent(raw);
    } catch {
        return raw;
    }
}

