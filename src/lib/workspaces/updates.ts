import {
    splitMarkdownByInlineReferences,
} from "@/lib/workspaces/doc-blocks";

export const WORKSPACE_UPDATE_TYPES = [
    "progress",
    "milestone",
    "release",
    "blocker",
    "decision",
    "collaboration_request",
    "behind_the_scenes",
    // Organizations only (report §17.2): admins post announcements, members post discussions.
    "announcement",
    "discussion",
] as const;

export type WorkspaceUpdateType = typeof WORKSPACE_UPDATE_TYPES[number];
export type WorkspaceUpdateVisibility = "public" | "members";
export type WorkspaceUpdateReplyPolicy = "logged_in" | "members" | "closed";
/** "from_projects" is the org feed's view of posts shared up from child projects. */
export type WorkspaceUpdateFilter = "all" | "from_projects" | WorkspaceUpdateType;

export type WorkspaceUpdateEntityRefs = {
    taskId?: string | null;
    sprintId?: string | null;
    fileId?: string | null;
    readmeVersionId?: string | null;
    roleId?: string | null;
    milestoneId?: string | null;
    references?: WorkspaceUpdateReference[];
};

export type WorkspaceUpdateMediaItem = {
    assetId?: string | null;
    type: "image" | "file" | "link";
    url?: string | null;
    label?: string | null;
    altText?: string | null;
    mimeType?: string | null;
    size?: number | null;
    width?: number | null;
    height?: number | null;
    bucket?: string | null;
    storageKey?: string | null;
};

export type WorkspaceUpdateContextKind = "task" | "sprint" | "file";

export type WorkspaceUpdateReference = {
    kind: WorkspaceUpdateContextKind;
    id: string;
};

export type WorkspaceUpdateCommentView = {
    id: string;
    updateId: string;
    projectId: string;
    parentId: string | null;
    userId: string | null;
    author: {
        id: string;
        fullName?: string | null;
        username?: string | null;
        avatarUrl?: string | null;
    } | null;
    content?: string;
    canDelete?: boolean;
    deletedAt?: string | null;
    createdAt?: string;
    updatedAt?: string;
    targetUserId?: string | null;
    targetUsername?: string | null;
};

export type WorkspaceUpdateContextOption = {
    kind: WorkspaceUpdateContextKind;
    id: string;
    label: string;
    description: string | null;
    href: string | null;
    status?: string | null;
};

export type WorkspaceUpdateContextSummary = {
    task?: WorkspaceUpdateContextOption | null;
    sprint?: WorkspaceUpdateContextOption | null;
    file?: WorkspaceUpdateContextOption | null;
    references?: WorkspaceUpdateContextOption[];
};

export type WorkspaceUpdateAuthorRoleSource = "snapshot" | "project_role" | "membership";

export type WorkspaceUpdateAuthorRoleSnapshot = {
    displayRoleLabel: string | null;
    roleTitle: string | null;
    membershipRoleLabel: string | null;
    source: WorkspaceUpdateAuthorRoleSource;
    capturedAt: string;
};

export const WORKSPACE_UPDATE_PAGE_SIZE = 20;
export const WORKSPACE_UPDATE_COMMENT_PAGE_SIZE = 20;
export const WORKSPACE_UPDATE_VIRTUALIZE_THRESHOLD = 80;
export const WORKSPACE_UPDATE_MAX_MEDIA_ITEMS = 4;
export const WORKSPACE_UPDATE_MAX_REFERENCES = 8;
export const WORKSPACE_UPDATE_MEDIA_BUCKET = "project-updates-media";
export const WORKSPACE_UPDATE_MEDIA_MAX_BYTES = 8 * 1024 * 1024;
export const WORKSPACE_UPDATE_ALLOWED_IMAGE_MIME_TYPES = new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
]);
export const WORKSPACE_UPDATE_MAX_SYNC_NOTIFICATION_RECIPIENTS = 120;

export function projectUpdateMediaApplicationUrl(
    bucket: unknown,
    storageKey: unknown,
): string | null {
    if (bucket !== WORKSPACE_UPDATE_MEDIA_BUCKET || typeof storageKey !== "string") return null;
    const key = storageKey.trim();
    const match = /^projects\/([0-9a-f-]{36})\/update-media\//i.exec(key);
    if (!match || key.includes("..")) return null;
    return `/api/v1/workspaces/${encodeURIComponent(match[1]!)}/update-media?key=${encodeURIComponent(key)}`;
}

export const WORKSPACE_UPDATE_PERFORMANCE_BUDGETS = {
    readMs: 100,
    createMs: 300,
    commentMs: 250,
    fanoutSyncRecipients: WORKSPACE_UPDATE_MAX_SYNC_NOTIFICATION_RECIPIENTS,
    initialPayloadKb: 80,
} as const;

export const WORKSPACE_UPDATE_SCHEMA_CONTRACT = {
    tables: ["workspace_updates", "workspace_update_likes", "workspace_update_comments", "workspace_update_drafts"],
    indexes: [
        "workspace_updates_workspace_pinned_created_idx",
        "workspace_updates_workspace_created_active_idx",
        "workspace_updates_public_feed_idx",
        "workspace_updates_author_created_idx",
        "workspace_updates_deleted_at_idx",
        "workspace_update_likes_update_idx",
        "workspace_update_likes_user_idx",
        "workspace_update_likes_unique",
        "workspace_update_comments_update_created_idx",
        "workspace_update_comments_update_active_idx",
        "workspace_update_comments_parent_idx",
        "workspace_update_comments_workspace_created_idx",
        "workspace_update_comments_user_created_idx",
        "workspace_update_drafts_updated_at_idx",
    ],
    minPolicyCounts: {
        workspace_updates: 3,
        workspace_update_likes: 3,
        workspace_update_comments: 3,
        workspace_update_drafts: 1,
    },
} as const;

export function isWorkspaceUpdateType(value: unknown): value is WorkspaceUpdateType {
    return typeof value === "string" && WORKSPACE_UPDATE_TYPES.includes(value as WorkspaceUpdateType);
}

export function normalizeWorkspaceUpdateType(value: unknown): WorkspaceUpdateType | null {
    return isWorkspaceUpdateType(value) ? value : null;
}

export function normalizeWorkspaceUpdateFilter(value: unknown): WorkspaceUpdateFilter {
    if (value === "all" || value === "from_projects") return value;
    return normalizeWorkspaceUpdateType(value) ?? "all";
}

export function sanitizeWorkspaceUpdateContent(value: unknown, maxLength = 2_000) {
    return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

const LEGACY_PROJECT_UPDATE_SMART_BLOCK_REGEX = /\{%\s*project\.([a-z_]+)([^%]*)%\}/gi;

function legacySmartBlockLabel(kind: string) {
    if (kind === "tasks") return "Workspace tasks";
    if (kind === "sprints") return "Workspace sprints";
    if (kind === "files") return "All files";
    if (kind === "roles") return "Workspace roles";
    if (kind === "contributors") return "Workspace contributors";
    return "Workspace reference";
}

export function projectUpdateDisplayText(value: string) {
    const normalizedSmartBlocks = value.replace(
        LEGACY_PROJECT_UPDATE_SMART_BLOCK_REGEX,
        (_raw, kind: string) => legacySmartBlockLabel(kind?.toLowerCase?.() ?? ""),
    );
    return splitMarkdownByInlineReferences(normalizedSmartBlocks)
        .map((segment) => segment.kind === "reference" ? segment.reference.label : segment.content)
        .join("")
        .replace(/\s+/g, " ")
        .trim();
}

export function projectUpdateExcerpt(value: string, maxLength = 180) {
    const normalized = projectUpdateDisplayText(value);
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}

export function projectUpdateDraftStorageKey(projectId: string, userId: string | null | undefined) {
    return `nb.project-updates.draft.${projectId}.${userId || "anonymous"}`;
}

export function sanitizeWorkspaceUpdateRoleTitle(value: unknown, maxLength = 80) {
    if (typeof value !== "string") return null;
    const normalized = value.replace(/\s+/g, " ").trim().slice(0, maxLength);
    return normalized.length > 0 ? normalized : null;
}

export function composeWorkspaceUpdateRoleLabel(input: {
    roleTitle?: string | null;
    membershipRoleLabel?: string | null;
}) {
    const roleTitle = sanitizeWorkspaceUpdateRoleTitle(input.roleTitle);
    const membershipRoleLabel = sanitizeWorkspaceUpdateRoleTitle(input.membershipRoleLabel);
    if (!roleTitle) return membershipRoleLabel;
    if (!membershipRoleLabel) return roleTitle;
    const normalizedMembership = membershipRoleLabel.toLowerCase();
    const normalizedTitle = roleTitle.toLowerCase();
    if (normalizedTitle.includes(normalizedMembership)) return roleTitle;
    if (normalizedMembership === "lead" || normalizedMembership === "co-lead" || normalizedMembership === "co-leader") {
        return `${membershipRoleLabel} ${roleTitle}`;
    }
    return roleTitle;
}

export function isGenericWorkspaceUpdateRoleTitle(value: unknown, membershipRoleLabel?: string | null) {
    const roleTitle = sanitizeWorkspaceUpdateRoleTitle(value);
    if (!roleTitle) return false;
    const normalizedTitle = roleTitle.toLowerCase();
    const normalizedMembership = sanitizeWorkspaceUpdateRoleTitle(membershipRoleLabel)?.toLowerCase() ?? null;
    return normalizedTitle === normalizedMembership
        || ["lead", "co-lead", "co lead", "admin", "member", "viewer", "owner", "contributor"].includes(normalizedTitle);
}

export function normalizeWorkspaceUpdateAuthorRoleSnapshot(value: unknown): WorkspaceUpdateAuthorRoleSnapshot | null {
    if (!value || typeof value !== "object") return null;
    const source = value as Record<string, unknown>;
    const displayRoleLabel = sanitizeWorkspaceUpdateRoleTitle(source.displayRoleLabel);
    const roleTitle = sanitizeWorkspaceUpdateRoleTitle(source.roleTitle);
    const membershipRoleLabel = sanitizeWorkspaceUpdateRoleTitle(source.membershipRoleLabel);
    const roleSource = source.source === "project_role" || source.source === "membership"
        ? source.source
        : "snapshot";
    const capturedAt = typeof source.capturedAt === "string" && !Number.isNaN(new Date(source.capturedAt).getTime())
        ? source.capturedAt
        : new Date(0).toISOString();
    if (!displayRoleLabel && !roleTitle && !membershipRoleLabel) return null;
    const composedRoleLabel = composeWorkspaceUpdateRoleLabel({ roleTitle, membershipRoleLabel });
    return {
        displayRoleLabel: composedRoleLabel ?? displayRoleLabel ?? roleTitle ?? membershipRoleLabel,
        roleTitle,
        membershipRoleLabel,
        source: roleSource,
        capturedAt,
    };
}

export function resolveWorkspaceUpdateAuthorRoleDisplay(input: {
    snapshot?: WorkspaceUpdateAuthorRoleSnapshot | null;
    projectRoleTitle?: string | null;
    membershipRoleLabel?: string | null;
}) {
    const snapshot = input.snapshot ?? null;
    if (snapshot?.displayRoleLabel) {
        const projectRoleTitle = sanitizeWorkspaceUpdateRoleTitle(input.projectRoleTitle);
        const effectiveMembershipRoleLabel = snapshot.membershipRoleLabel ?? input.membershipRoleLabel;
        const snapshotRoleTitle = isGenericWorkspaceUpdateRoleTitle(snapshot.roleTitle, effectiveMembershipRoleLabel)
            ? null
            : sanitizeWorkspaceUpdateRoleTitle(snapshot.roleTitle);
        const effectiveRoleTitle = projectRoleTitle ?? snapshotRoleTitle;
        return {
            roleLabel: composeWorkspaceUpdateRoleLabel({
                roleTitle: effectiveRoleTitle,
                membershipRoleLabel: effectiveMembershipRoleLabel,
            }) ?? snapshot.displayRoleLabel,
            roleTitle: effectiveRoleTitle ?? snapshot.displayRoleLabel,
            membershipRoleLabel: effectiveMembershipRoleLabel ?? null,
            roleSource: projectRoleTitle ? "project_role" as const : "snapshot" as const,
        };
    }
    const projectRoleTitle = sanitizeWorkspaceUpdateRoleTitle(input.projectRoleTitle);
    if (projectRoleTitle) {
        return {
            roleLabel: composeWorkspaceUpdateRoleLabel({ roleTitle: projectRoleTitle, membershipRoleLabel: input.membershipRoleLabel }),
            roleTitle: projectRoleTitle,
            membershipRoleLabel: input.membershipRoleLabel ?? null,
            roleSource: "project_role" as const,
        };
    }
    const membershipRoleLabel = sanitizeWorkspaceUpdateRoleTitle(input.membershipRoleLabel);
    return {
        roleLabel: membershipRoleLabel,
        roleTitle: null,
        membershipRoleLabel,
        roleSource: membershipRoleLabel ? "membership" as const : null,
    };
}

export function isSafeWorkspaceUpdateUrl(value: unknown): value is string {
    if (typeof value !== "string") return false;
    const trimmed = value.trim();
    if (trimmed.startsWith("/api/v1/workspaces/")) return true;
    try {
        const url = new URL(trimmed);
        return url.protocol === "https:" || url.protocol === "http:";
    } catch {
        return false;
    }
}

export function normalizeWorkspaceUpdateReferenceKind(value: unknown): WorkspaceUpdateContextKind | null {
    return value === "task" || value === "sprint" || value === "file" ? value : null;
}

export function normalizeWorkspaceUpdateReferences(value: unknown, maxItems = WORKSPACE_UPDATE_MAX_REFERENCES): WorkspaceUpdateReference[] {
    if (!Array.isArray(value)) return [];
    const seen = new Set<string>();
    const references: WorkspaceUpdateReference[] = [];
    for (const item of value) {
        if (!item || typeof item !== "object") continue;
        const source = item as Record<string, unknown>;
        const kind = normalizeWorkspaceUpdateReferenceKind(source.kind);
        const id = typeof source.id === "string" ? source.id.trim() : "";
        if (!kind || !id) continue;
        const key = `${kind}:${id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        references.push({ kind, id });
        if (references.length >= maxItems) break;
    }
    return references;
}

export function normalizeWorkspaceUpdateMediaItems(value: unknown, maxItems = WORKSPACE_UPDATE_MAX_MEDIA_ITEMS): WorkspaceUpdateMediaItem[] {
    if (!Array.isArray(value)) return [];
    return value.slice(0, maxItems).flatMap((item) => {
        if (!item || typeof item !== "object") return [];
        const source = item as Record<string, unknown>;
        const type = source.type === "image" || source.type === "file" || source.type === "link" ? source.type : null;
        if (!type) return [];
        const storageKey = typeof source.storageKey === "string" ? source.storageKey.trim().slice(0, 1_024) : null;
        const bucket = typeof source.bucket === "string" ? source.bucket.trim().slice(0, 160) : null;
        const storedMediaUrl = projectUpdateMediaApplicationUrl(bucket, storageKey);
        const sourceUrl = typeof source.url === "string" ? source.url.trim().slice(0, 2_000) : null;
        if (!storedMediaUrl && sourceUrl && !isSafeWorkspaceUpdateUrl(sourceUrl)) return [];
        return [{
            type,
            assetId: typeof source.assetId === "string" ? source.assetId.trim().slice(0, 64) : null,
            url: storedMediaUrl ?? sourceUrl,
            label: typeof source.label === "string" ? source.label.trim().slice(0, 160) : null,
            altText: typeof source.altText === "string" ? source.altText.trim().slice(0, 240) : null,
            mimeType: typeof source.mimeType === "string" ? source.mimeType.trim().slice(0, 160) : null,
            size: typeof source.size === "number" && Number.isFinite(source.size) ? Math.max(0, Math.trunc(source.size)) : null,
            width: typeof source.width === "number" && Number.isFinite(source.width) ? Math.max(0, Math.trunc(source.width)) : null,
            height: typeof source.height === "number" && Number.isFinite(source.height) ? Math.max(0, Math.trunc(source.height)) : null,
            bucket,
            storageKey,
        }];
    });
}

export function hasWorkspaceUpdateLinkedContext(entityRefs: WorkspaceUpdateEntityRefs | null | undefined, media: WorkspaceUpdateMediaItem[] | null | undefined) {
    return Boolean(
        entityRefs && (
            Object.values(entityRefs).some((value) => typeof value === "string" && value.length > 0)
            || normalizeWorkspaceUpdateReferences(entityRefs.references).length > 0
        )
        || media?.some((item) => Boolean(item.url || item.label)),
    );
}

export function projectUpdateImageExtensionFromMimeType(mimeType: string) {
    if (mimeType === "image/png") return "png";
    if (mimeType === "image/webp") return "webp";
    if (mimeType === "image/gif") return "gif";
    return "jpg";
}

export function shouldNotifyWorkspaceUpdateFollowers(input: {
    content: string;
    entityRefs?: WorkspaceUpdateEntityRefs | null;
    media?: WorkspaceUpdateMediaItem[] | null;
}) {
    const content = sanitizeWorkspaceUpdateContent(input.content);
    if (content.length >= 80) return true;
    if (/[.!?]\s*$/.test(content) && content.length >= 40) return true;
    return hasWorkspaceUpdateLinkedContext(input.entityRefs, input.media);
}
