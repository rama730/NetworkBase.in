import { createHash, } from "crypto";
import { normalizeProjectPublicTabVisibility, normalizeProjectMemberRole, } from "@/lib/projects/settings-policies";
import { normalizeProjectVisibility } from "@/lib/projects/project-visibility";
import { evaluateProjectDocQuality } from "@/lib/projects/doc-quality";
import { parseProjectDocSmartBlocks, type ProjectDocSmartBlock } from "@/lib/projects/doc-blocks";
import { buildProjectDocPlainText } from "@/lib/projects/doc-plain-text";
import { extractProjectDocHeadings, type ProjectDocHeading } from "@/lib/projects/doc-headings";

export { buildProjectDocPlainText, decodeProjectDocHtmlEntities } from "@/lib/projects/doc-plain-text";
export { extractProjectDocHeadings, slugifyReadmeHeading, type ProjectDocHeading } from "@/lib/projects/doc-headings";
export {
    isProjectDocSlugCanonical,
    normalizeProjectDocSlug,
    PROJECT_DOC_DEFAULT_SLUG,
    PROJECT_DOC_SLUG_MAX_LENGTH,
} from "@/lib/projects/doc-slug";

export type ProjectDocEditPolicy = "leaders" | "members";
export type ProjectDocPublicVisibility = "inherit_project";
export type ProjectDocVisibilityOverride = "inherit_project" | "public" | "members_only" | "leaders_only";

export type ProjectDocSettings = {
    version: 1;
    editPolicy: ProjectDocEditPolicy;
    publicVisibility?: ProjectDocPublicVisibility;
    visibilityOverride: ProjectDocVisibilityOverride;
    externalImages: boolean;
    projectBlocks: boolean;
};

export type ProjectDocQualityIssue = {
    id: string;
    severity: "info" | "warning" | "error";
    label: string;
    description: string;
};

export type ProjectDocQualityReport = {
    score: number;
    issues: ProjectDocQualityIssue[];
    sectionPresence: Record<string, boolean>;
    contentBytes: number;
};

export type ProjectDocPermission = {
    canReadPublished: boolean;
    canReadDraft: boolean;
    canEdit: boolean;
    canPublish: boolean;
    canManageSettings: boolean;
    accessLevel: "public" | "viewer" | "member" | "co_leader" | "owner" | "none";
    reason?: string | null;
};

export type ProjectDocVersion = {
    id: string;
    projectId: string;
    versionNumber: number;
    displayVersionNumber: number;
    content: string;
    excerpt: string | null;
    headings: ProjectDocHeading[];
    qualityReport: ProjectDocQualityReport;
    contentHash: string;
    changeSummary: string | null;
    coAuthors: { id: string; name: string; avatarUrl: string | null }[];
    createdBy: string | null;
    createdByName: string | null;
    createdAt: string;
    deletedAt: string | null;
};

export type ProjectDocListItem = { id: string; slug: string; filename: string; linkedNodeId: string | null };

export type ProjectDocPublishedPayload = {
    projectId: string;
    docSlug: string;
    docs: ProjectDocListItem[];
    canEdit: boolean;
    permission: ProjectDocPermission;
    settings: ProjectDocSettings;
    version: ProjectDocVersion | null;
    smartBlocks: ProjectDocSmartBlock[];
    linkedNodeId?: string | null;
    linkedNode?: { id: string; name: string; path: string } | null;
};

export const PROJECT_DOC_MAX_CONTENT_BYTES = 500 * 1024;
const GENERATED_COLLABORATION_FOOTER_RE = /(?:\n{1,3}|^)\s{0,3}#{0,6}\s*Collaborator\s+[^\n]{1,120}?\s+publish(?:ed|es)?\b[^\n]*(?:\n\s*)?$/i;

export const DEFAULT_PROJECT_DOC_SETTINGS: ProjectDocSettings = {
    version: 1,
    editPolicy: "leaders",
    publicVisibility: "inherit_project",
    visibilityOverride: "inherit_project",
    externalImages: false,
    projectBlocks: true,
};

export function normalizeProjectDocSettings(value: unknown): ProjectDocSettings {
    const source = value && typeof value === "object" ? value as Partial<ProjectDocSettings> : {};
    const visibilityOverride = source.visibilityOverride === "public" || source.visibilityOverride === "members_only" || source.visibilityOverride === "leaders_only" || source.visibilityOverride === "inherit_project"
        ? source.visibilityOverride
        : "inherit_project";
    return {
        version: 1,
        editPolicy: source.editPolicy === "members" ? "members" : "leaders",
        publicVisibility: "inherit_project",
        visibilityOverride,
        externalImages: typeof source.externalImages === "boolean" ? source.externalImages : DEFAULT_PROJECT_DOC_SETTINGS.externalImages,
        projectBlocks: typeof source.projectBlocks === "boolean" ? source.projectBlocks : DEFAULT_PROJECT_DOC_SETTINGS.projectBlocks,
    };
}

const README_REPEATED_TAIL_MIN_CHARS = 200;

function firstMeaningfulReadmeLine(value: string) {
    return value
        .split("\n")
        .map((line) => line.trim())
        .find((line) => line.length > 0) ?? "";
}

function stripRepeatedReadmeTail(value: string) {
    if (value.length < README_REPEATED_TAIL_MIN_CHARS * 2) return value;

    const firstLine = firstMeaningfulReadmeLine(value);
    if (firstLine.length < 8) return value;

    let searchFrom = firstLine.length;
    while (searchFrom >= 0 && searchFrom < value.length) {
        const duplicateStart = value.indexOf(firstLine, searchFrom);
        if (duplicateStart < 0) return value;

        const duplicateTail = value.slice(duplicateStart);
        const duplicateTailTrimmed = duplicateTail.trimEnd();
        const originalPrefix = value.slice(0, duplicateTailTrimmed.length);
        const originalPrefixTrimmed = originalPrefix.trimEnd();
        const startsAtLineBoundary = duplicateStart === 0 || value[duplicateStart - 1] === "\n";
        const isMeaningfulTail = duplicateTailTrimmed.length >= README_REPEATED_TAIL_MIN_CHARS;

        if (
            startsAtLineBoundary
            && isMeaningfulTail
            && originalPrefixTrimmed === duplicateTailTrimmed
        ) {
            return value.slice(0, duplicateStart).trimEnd();
        }

        searchFrom = duplicateStart + firstLine.length;
    }

    return value;
}

export function normalizeProjectDocContent(content: unknown) {
    const value = typeof content === "string"
        ? stripRepeatedReadmeTail(content.replace(/\r\n?/g, "\n").replace(GENERATED_COLLABORATION_FOOTER_RE, ""))
        : "";
    return value.length > PROJECT_DOC_MAX_CONTENT_BYTES ? value.slice(0, PROJECT_DOC_MAX_CONTENT_BYTES) : value;
}

export function assertProjectDocContentSize(content: string) {
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > PROJECT_DOC_MAX_CONTENT_BYTES) {
        throw new Error("Doc content is too large. Keep it under 500 KiB.");
    }
}

export function hashProjectDocContent(content: string) {
    return createHash("sha256").update(content, "utf8").digest("hex");
}

export function buildProjectDocExcerpt(content: string, maxLength = 220) {
    return buildProjectDocPlainText(content, { maxLength });
}

export function normalizeProjectDocHeadings(value: unknown): ProjectDocHeading[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            if (!item || typeof item !== "object") return null;
            const source = item as Partial<ProjectDocHeading>;
            const id = typeof source.id === "string" ? source.id : "";
            const text = typeof source.text === "string" ? source.text : "";
            const level = Number(source.level);
            if (!id || !text || !Number.isFinite(level)) return null;
            return { id, text, level: Math.min(4, Math.max(1, Math.trunc(level))) };
        })
        .filter((item): item is ProjectDocHeading => Boolean(item));
}

export function buildProjectDocQualityReport(content: string): ProjectDocQualityReport {
    return evaluateProjectDocQuality(content);
}

export function buildProjectDocPublishMetadata(content: string) {
    const normalized = normalizeProjectDocContent(content);
    assertProjectDocContentSize(normalized);
    return {
        content: normalized,
        headings: extractProjectDocHeadings(normalized),
        excerpt: buildProjectDocExcerpt(normalized),
        qualityReport: buildProjectDocQualityReport(normalized),
        contentHash: hashProjectDocContent(normalized),
        smartBlocks: parseProjectDocSmartBlocks(normalized),
    };
}

const DOC_METADATA_CACHE = new Map<string, ReturnType<typeof buildProjectDocPublishMetadata>>();
const MAX_DOC_METADATA_CACHE_ENTRIES = 200;

export function getOrBuildProjectDocPublishMetadata(content: string) {
    const hash = hashProjectDocContent(content);
    const cached = DOC_METADATA_CACHE.get(hash);
    if (cached) {
        DOC_METADATA_CACHE.delete(hash);
        DOC_METADATA_CACHE.set(hash, cached);
        return cached;
    }
    const metadata = buildProjectDocPublishMetadata(content);
    if (DOC_METADATA_CACHE.size >= MAX_DOC_METADATA_CACHE_ENTRIES) {
        const oldest = DOC_METADATA_CACHE.keys().next().value;
        if (oldest) DOC_METADATA_CACHE.delete(oldest);
    }
    DOC_METADATA_CACHE.set(hash, metadata);
    return metadata;
}

export function resolveProjectDocPermission(input: {
    actorUserId?: string | null;
    projectVisibility?: unknown;
    /** Project status; blank counts as draft. Draft projects publish nothing to outsiders. */
    projectStatus?: string | null;
    publicTabVisibility?: unknown;
    settings?: unknown;
    membershipRole?: unknown;
    isOwner?: boolean;
    isActiveMember?: boolean;
    hasPublishedReadme?: boolean;
}) : ProjectDocPermission {
    const settings = normalizeProjectDocSettings(input.settings);
    const visibility = normalizeProjectVisibility(input.projectVisibility);
    const publicTabs = normalizeProjectPublicTabVisibility(input.publicTabVisibility);
    const isActiveMember = Boolean(input.isActiveMember || input.isOwner);
    const role = isActiveMember
        ? normalizeProjectMemberRole(input.membershipRole, input.isOwner ? "owner" : "member")
        : null;
    const isOwner = Boolean(input.isOwner) || role === "owner";
    const isCoLeader = role === "admin";
    const isMember = isActiveMember || isOwner || isCoLeader || role === "member" || role === "viewer";
    
    const override = settings.visibilityOverride || "inherit_project";

    const isDraftProject = !input.projectStatus?.trim() || input.projectStatus === "draft";
    let isPublishedPublic = false;
    if (isDraftProject) {
        isPublishedPublic = false;
    } else if (override === "members_only") {
        isPublishedPublic = false;
    } else if (override === "leaders_only") {
        isPublishedPublic = false;
    } else {
        // "public" and "inherit_project" both need a publicly readable project with
        // the Readme tab, exactly like the project_docs RLS policy; an override never
        // publishes a doc out of a private project.
        isPublishedPublic = visibility === "public" && publicTabs.readme && Boolean(input.hasPublishedReadme);
    }

    let canReadPublished = false;
    if (override === "leaders_only") {
        canReadPublished = isOwner || isCoLeader;
    } else if (override === "members_only") {
        canReadPublished = isMember;
    } else {
        canReadPublished = isMember || isPublishedPublic;
    }

    const isLeader = isOwner || isCoLeader;
    const canReadDraft = isLeader || (isMember && settings.editPolicy === "members" && override !== "leaders_only");
    const canEdit = canReadDraft;
    const canPublish = canEdit;
    const canManageSettings = isLeader;
    const accessLevel: ProjectDocPermission["accessLevel"] = isOwner
        ? "owner"
        : isCoLeader
            ? "co_leader"
            : role === "member"
                ? "member"
                : role === "viewer"
                    ? "viewer"
                    : isPublishedPublic
                        ? "public"
                        : "none";
    return {
        canReadPublished,
        canReadDraft,
        canEdit,
        canPublish,
        canManageSettings,
        accessLevel,
        reason: canReadPublished || canReadDraft ? null : "Document is not available for this viewer.",
    };
}
