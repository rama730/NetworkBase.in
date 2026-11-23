import { createHash, } from "crypto";
import { roleAllows } from "@/lib/workspaces/role-abilities";
import { normalizeWorkspacePublicTabVisibility, normalizeWorkspaceMemberRole, } from "@/lib/workspaces/settings-policies";
import { normalizeWorkspaceVisibility } from "@/lib/workspaces/workspace-visibility";
import { evaluateWorkspaceDocQuality } from "@/lib/workspaces/doc-quality";
import { parseWorkspaceDocSmartBlocks, type WorkspaceDocSmartBlock } from "@/lib/workspaces/doc-blocks";
import { buildWorkspaceDocPlainText } from "@/lib/workspaces/doc-plain-text";
import { extractWorkspaceDocHeadings, type WorkspaceDocHeading } from "@/lib/workspaces/doc-headings";
import { isDocSection, type DocSection } from "@/lib/workspaces/doc-sections";

export { buildWorkspaceDocPlainText, decodeWorkspaceDocHtmlEntities } from "@/lib/workspaces/doc-plain-text";
export { extractWorkspaceDocHeadings, slugifyReadmeHeading, type WorkspaceDocHeading } from "@/lib/workspaces/doc-headings";
export {
    isWorkspaceDocSlugCanonical,
    normalizeWorkspaceDocSlug,
    WORKSPACE_DOC_DEFAULT_SLUG,
    WORKSPACE_DOC_SLUG_MAX_LENGTH,
} from "@/lib/workspaces/doc-slug";

export type WorkspaceDocEditPolicy = "leaders" | "members";
export type WorkspaceDocPublicVisibility = "inherit_workspace";
export type WorkspaceDocVisibilityOverride = "inherit_workspace" | "public" | "members_only" | "leaders_only";


export type WorkspaceDocSettings = {
    version: 1;
    editPolicy: WorkspaceDocEditPolicy;
    publicVisibility?: WorkspaceDocPublicVisibility;
    visibilityOverride: WorkspaceDocVisibilityOverride;
    externalImages: boolean;
    projectBlocks: boolean;
    /** Org docs only (report §19): group, Required, Template, Show in child projects, re-read version. */
    org?: Record<string, unknown>;
    /** Report 38.3 F2: the rail section (src/lib/workspaces/doc-sections.ts), a kind and a date; no version is written. */
    section?: DocSection;
    kind?: string;
    date?: string;
    /** Report 38.3 S4: a decision's D-number (never changes), its status and the document it was recorded from. */
    decisionNumber?: number;
    decisionStatus?: DecisionStatus;
    fromDocId?: string;
    /** Report 38.10 (A3.1): a launch's stage, version label (matched to bugs' Fixed in) and when it launched. */
    launchStage?: "planning" | "getting_ready" | "launched" | "closed" | "cancelled";
    versionLabel?: string;
    launchedAt?: string;
};

export type DecisionStatus = "proposed" | "decided" | "superseded" | "reversed";
const DECISION_STATUSES: DecisionStatus[] = ["proposed", "decided", "superseded", "reversed"];

export type WorkspaceDocQualityIssue = {
    id: string;
    severity: "info" | "warning" | "error";
    label: string;
    description: string;
};

export type WorkspaceDocQualityReport = {
    score: number;
    issues: WorkspaceDocQualityIssue[];
    sectionPresence: Record<string, boolean>;
    contentBytes: number;
};

export type WorkspaceDocPermission = {
    canReadPublished: boolean;
    canReadDraft: boolean;
    canEdit: boolean;
    canPublish: boolean;
    canManageSettings: boolean;
    accessLevel: "public" | "viewer" | "member" | "co_leader" | "owner" | "none";
    reason?: string | null;
};

export type WorkspaceDocVersion = {
    id: string;
    projectId: string;
    versionNumber: number;
    displayVersionNumber: number;
    content: string;
    excerpt: string | null;
    headings: WorkspaceDocHeading[];
    qualityReport: WorkspaceDocQualityReport;
    contentHash: string;
    changeSummary: string | null;
    coAuthors: { id: string; name: string; avatarUrl: string | null }[];
    createdBy: string | null;
    createdByName: string | null;
    createdAt: string;
    deletedAt: string | null;
};

export type WorkspaceDocListItem = { id: string; slug: string; filename: string; linkedNodeId: string | null; section?: DocSection; kind?: string; date?: string; decisionNumber?: number; decisionStatus?: DecisionStatus; fromDocId?: string };

export type WorkspaceDocPublishedPayload = {
    projectId: string;
    docSlug: string;
    docs: WorkspaceDocListItem[];
    canEdit: boolean;
    permission: WorkspaceDocPermission;
    settings: WorkspaceDocSettings;
    version: WorkspaceDocVersion | null;
    smartBlocks: WorkspaceDocSmartBlock[];
    linkedNodeId?: string | null;
    linkedNode?: { id: string; name: string; path: string } | null;
};

export const WORKSPACE_DOC_MAX_CONTENT_BYTES = 500 * 1024;
const GENERATED_COLLABORATION_FOOTER_RE = /(?:\n{1,3}|^)\s{0,3}#{0,6}\s*Collaborator\s+[^\n]{1,120}?\s+publish(?:ed|es)?\b[^\n]*(?:\n\s*)?$/i;

export const DEFAULT_WORKSPACE_DOC_SETTINGS: WorkspaceDocSettings = {
    version: 1,
    editPolicy: "leaders",
    publicVisibility: "inherit_workspace",
    visibilityOverride: "inherit_workspace",
    externalImages: false,
    projectBlocks: true,
};

export function normalizeWorkspaceDocSettings(value: unknown): WorkspaceDocSettings {
    const source = value && typeof value === "object" ? value as Partial<WorkspaceDocSettings> : {};
    const visibilityOverride = source.visibilityOverride === "public" || source.visibilityOverride === "members_only" || source.visibilityOverride === "leaders_only" || source.visibilityOverride === "inherit_workspace"
        ? source.visibilityOverride
        : "inherit_workspace";
    return {
        version: 1,
        editPolicy: source.editPolicy === "members" ? "members" : "leaders",
        publicVisibility: "inherit_workspace",
        visibilityOverride,
        externalImages: typeof source.externalImages === "boolean" ? source.externalImages : DEFAULT_WORKSPACE_DOC_SETTINGS.externalImages,
        projectBlocks: typeof source.projectBlocks === "boolean" ? source.projectBlocks : DEFAULT_WORKSPACE_DOC_SETTINGS.projectBlocks,
        ...(source.org && typeof source.org === "object" ? { org: source.org } : {}),
        // Kept through every settings save, or a move to a section would be undone by the next one (report 38.3).
        ...(isDocSection(source.section) ? { section: source.section } : {}),
        ...(typeof source.kind === "string" && /^[a-z0-9_-]{1,40}$/.test(source.kind) ? { kind: source.kind } : {}),
        ...(typeof source.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(source.date) ? { date: source.date } : {}),
        ...(Number.isInteger(source.decisionNumber) && source.decisionNumber! > 0 ? { decisionNumber: source.decisionNumber } : {}),
        ...(DECISION_STATUSES.includes(source.decisionStatus as DecisionStatus) ? { decisionStatus: source.decisionStatus } : {}),
        ...(typeof source.fromDocId === "string" && /^[0-9a-f-]{36}$/i.test(source.fromDocId) ? { fromDocId: source.fromDocId } : {}),
        ...(["planning", "getting_ready", "launched", "closed", "cancelled"].includes(source.launchStage as string) ? { launchStage: source.launchStage } : {}),
        ...(typeof source.versionLabel === "string" && source.versionLabel.trim() && source.versionLabel.length <= 40 ? { versionLabel: source.versionLabel.trim() } : {}),
        ...(typeof source.launchedAt === "string" && Number.isFinite(Date.parse(source.launchedAt)) ? { launchedAt: source.launchedAt } : {}),
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

export function normalizeWorkspaceDocContent(content: unknown) {
    const value = typeof content === "string"
        ? stripRepeatedReadmeTail(content.replace(/\r\n?/g, "\n").replace(GENERATED_COLLABORATION_FOOTER_RE, ""))
        : "";
    return value.length > WORKSPACE_DOC_MAX_CONTENT_BYTES ? value.slice(0, WORKSPACE_DOC_MAX_CONTENT_BYTES) : value;
}

export function assertWorkspaceDocContentSize(content: string) {
    const bytes = Buffer.byteLength(content, "utf8");
    if (bytes > WORKSPACE_DOC_MAX_CONTENT_BYTES) {
        throw new Error("Doc content is too large. Keep it under 500 KiB.");
    }
}

export function hashWorkspaceDocContent(content: string) {
    return createHash("sha256").update(content, "utf8").digest("hex");
}

export function buildWorkspaceDocExcerpt(content: string, maxLength = 220) {
    return buildWorkspaceDocPlainText(content, { maxLength });
}

export function normalizeWorkspaceDocHeadings(value: unknown): WorkspaceDocHeading[] {
    if (!Array.isArray(value)) return [];
    return value
        .map((item) => {
            if (!item || typeof item !== "object") return null;
            const source = item as Partial<WorkspaceDocHeading>;
            const id = typeof source.id === "string" ? source.id : "";
            const text = typeof source.text === "string" ? source.text : "";
            const level = Number(source.level);
            if (!id || !text || !Number.isFinite(level)) return null;
            return { id, text, level: Math.min(4, Math.max(1, Math.trunc(level))) };
        })
        .filter((item): item is WorkspaceDocHeading => Boolean(item));
}

export function buildWorkspaceDocQualityReport(content: string): WorkspaceDocQualityReport {
    return evaluateWorkspaceDocQuality(content);
}

export function buildWorkspaceDocPublishMetadata(content: string) {
    const normalized = normalizeWorkspaceDocContent(content);
    assertWorkspaceDocContentSize(normalized);
    return {
        content: normalized,
        headings: extractWorkspaceDocHeadings(normalized),
        excerpt: buildWorkspaceDocExcerpt(normalized),
        qualityReport: buildWorkspaceDocQualityReport(normalized),
        contentHash: hashWorkspaceDocContent(normalized),
        smartBlocks: parseWorkspaceDocSmartBlocks(normalized),
    };
}

const DOC_METADATA_CACHE = new Map<string, ReturnType<typeof buildWorkspaceDocPublishMetadata>>();
const MAX_DOC_METADATA_CACHE_ENTRIES = 200;

export function getOrBuildWorkspaceDocPublishMetadata(content: string) {
    const hash = hashWorkspaceDocContent(content);
    const cached = DOC_METADATA_CACHE.get(hash);
    if (cached) {
        DOC_METADATA_CACHE.delete(hash);
        DOC_METADATA_CACHE.set(hash, cached);
        return cached;
    }
    const metadata = buildWorkspaceDocPublishMetadata(content);
    if (DOC_METADATA_CACHE.size >= MAX_DOC_METADATA_CACHE_ENTRIES) {
        const oldest = DOC_METADATA_CACHE.keys().next().value;
        if (oldest) DOC_METADATA_CACHE.delete(oldest);
    }
    DOC_METADATA_CACHE.set(hash, metadata);
    return metadata;
}

export function resolveWorkspaceDocPermission(input: {
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
    /** Member settings Part 4: the owner's changes to "See and edit doc drafts"; organizations keep their rules. */
    roleAbilities?: unknown;
    orgRules?: boolean;
}) : WorkspaceDocPermission {
    const settings = normalizeWorkspaceDocSettings(input.settings);
    const visibility = normalizeWorkspaceVisibility(input.projectVisibility);
    const publicTabs = normalizeWorkspacePublicTabVisibility(input.publicTabVisibility);
    const isActiveMember = Boolean(input.isActiveMember || input.isOwner);
    const role = isActiveMember
        ? normalizeWorkspaceMemberRole(input.membershipRole, input.isOwner ? "owner" : "member")
        : null;
    const isOwner = Boolean(input.isOwner) || role === "owner";
    const isCoLeader = role === "admin";
    const isMember = isActiveMember || isOwner || isCoLeader || role === "member" || role === "viewer";
    
    const override = settings.visibilityOverride || "inherit_workspace";

    const isDraftProject = !input.projectStatus?.trim() || input.projectStatus === "draft";
    let isPublishedPublic = false;
    if (isDraftProject) {
        isPublishedPublic = false;
    } else if (override === "members_only") {
        isPublishedPublic = false;
    } else if (override === "leaders_only") {
        isPublishedPublic = false;
    } else {
        // "public" and "inherit_workspace" both need a publicly readable project with
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
    // Viewers read; they never edit, even where members may (a viewer could edit and publish before, found in A0.4).
    const draftsAllowed = isOwner || roleAllows(input.roleAbilities, role, "docs.drafts", { orgRules: input.orgRules });
    const canReadDraft = draftsAllowed && (isLeader || (isMember && role !== "viewer" && settings.editPolicy === "members" && override !== "leaders_only"));
    const canEdit = canReadDraft;
    const canPublish = canEdit;
    const canManageSettings = isLeader;
    const accessLevel: WorkspaceDocPermission["accessLevel"] = isOwner
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
