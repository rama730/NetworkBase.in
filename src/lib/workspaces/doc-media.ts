export type ProjectDocMediaProject = {
    id?: string | null;
    visibility?: string | null;
    githubRepoUrl?: string | null;
    githubDefaultBranch?: string | null;
    importSource?: unknown;
};

export type ProjectDocGithubSource = {
    owner: string;
    repo: string;
    branch: string;
};

export type ProjectDocImageKind = "badge" | "icon" | "logo" | "diagram" | "content";

export type ProjectDocResolvedImage = {
    src: string | null;
    blockedReason: "invalid" | "external" | null;
    trustedExternal: boolean;
    originalSrc: string;
    kind: ProjectDocImageKind;
    width: number | null;
    height: number | null;
    widthPercent: number | null;
};

const CONTROL_CHARS_REGEX = /[\u0000-\u001F\u007F]/g;
const SAFE_IMAGE_PROTOCOLS = new Set(["http:", "https:"]);
export const TRUSTED_PUBLIC_README_IMAGE_HOSTS = new Set([
    "raw.githubusercontent.com",
    "github.com",
    "user-images.githubusercontent.com",
    "private-user-images.githubusercontent.com",
    "camo.githubusercontent.com",
    "avatars.githubusercontent.com",
    "img.shields.io",
    "shields.io",
    "badge.fury.io",
    "api.star-history.com",
    "star-history.com",
    "em-content.zobj.net",
]);

export function isTrustedPublicReadmeImageHost(urlOrHost: string): boolean {
    try {
        const normalized = urlOrHost.startsWith("//") ? `https:${urlOrHost}` : urlOrHost;
        const parsed = new URL(normalized);
        return TRUSTED_PUBLIC_README_IMAGE_HOSTS.has(parsed.hostname.toLowerCase());
    } catch {
        return false;
    }
}

function normalizeBranch(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : "main";
}

function readImportSource(project: ProjectDocMediaProject) {
    const importSource = project.importSource && typeof project.importSource === "object"
        ? project.importSource as Record<string, unknown>
        : {};
    const metadata = importSource.metadata && typeof importSource.metadata === "object"
        ? importSource.metadata as Record<string, unknown>
        : {};
    return { importSource, metadata };
}

function readMetadataGithubRepoUrl(metadata: Record<string, unknown>) {
    const owner = typeof metadata.githubOwner === "string" ? metadata.githubOwner.trim() : "";
    const name = typeof metadata.githubName === "string" ? metadata.githubName.trim() : "";
    return owner && name ? `https://github.com/${owner}/${name}` : null;
}

export function parseProjectDocGithubRepoUrl(value: unknown): Pick<ProjectDocGithubSource, "owner" | "repo"> | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    const match = trimmed.match(/github\.com[/:]([^/\s]+)\/([^/\s#?]+?)(?:\.git)?(?:[/?#].*)?$/i)
        ?? trimmed.match(/^([^/\s]+)\/([^/\s#?]+)$/);
    if (!match) return null;
    const owner = match[1]?.trim();
    const repo = match[2]?.replace(/\.git$/i, "").trim();
    return owner && repo ? { owner, repo } : null;
}

export function resolveProjectDocGithubSource(project: ProjectDocMediaProject): ProjectDocGithubSource | null {
    const { importSource, metadata } = readImportSource(project);
    const repoUrl = project.githubRepoUrl
        ?? (typeof importSource.repoUrl === "string" ? importSource.repoUrl : null)
        ?? (typeof metadata.normalizedRepoUrl === "string" ? metadata.normalizedRepoUrl : null)
        ?? (typeof metadata.repoUrl === "string" ? metadata.repoUrl : null)
        ?? readMetadataGithubRepoUrl(metadata);
    const repo = parseProjectDocGithubRepoUrl(repoUrl);
    if (!repo) return null;
    const branch = normalizeBranch(importSource.branch ?? project.githubDefaultBranch ?? metadata.branch);
    return { ...repo, branch };
}

export function parseReadmeHtmlDimension(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.round(value);
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    const match = trimmed.match(/^(\d{1,5})(?:px)?$/i);
    if (!match) return null;
    const numeric = Number(match[1]);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : null;
}

export function parseReadmeHtmlWidthPercent(value: unknown): number | null {
    if (typeof value !== "string") return null;
    const match = value.trim().match(/^(\d{1,3})%$/);
    if (!match) return null;
    const numeric = Number(match[1]);
    return Number.isFinite(numeric) && numeric > 0 && numeric <= 100 ? numeric : null;
}

function encodeGithubPath(value: string) {
    return value.split("/").map((part) => encodeURIComponent(part)).join("/");
}

function normalizeRelativeReadmeAssetPath(value: string) {
    const [pathPart = "", suffix = ""] = value.split(/([?#].*)/, 2);
    const normalizedPath = pathPart
        .replace(/^\.\/+/, "")
        .replace(/^\/+/, "")
        .split("/")
        .filter(Boolean);
    if (!normalizedPath.length || normalizedPath.some((part) => part === "." || part === "..")) return null;
    return `${normalizedPath.map(encodeURIComponent).join("/")}${suffix}`;
}

function resolveGithubRawImage(value: string, source: ProjectDocGithubSource | null) {
    if (!source) return null;
    const relativePath = normalizeRelativeReadmeAssetPath(value);
    if (!relativePath) return null;
    return `https://raw.githubusercontent.com/${encodeURIComponent(source.owner)}/${encodeURIComponent(source.repo)}/${encodeGithubPath(source.branch)}/${relativePath}`;
}

function normalizeProtocolRelativeImageUrl(value: string) {
    return value.startsWith("//") ? `https:${value}` : value;
}

function resolveGithubRepositoryImageUrl(url: URL, source: ProjectDocGithubSource | null) {
    if (url.hostname.toLowerCase() !== "github.com") return null;
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 5) return null;
    const [owner, repo, mode] = parts;
    if (!owner || !repo || (mode !== "blob" && mode !== "raw")) return null;

    const sourceMatches = source
        && owner.toLowerCase() === source.owner.toLowerCase()
        && repo.toLowerCase() === source.repo.toLowerCase();
    const branchSegments = sourceMatches ? source.branch.split("/").filter(Boolean) : [];
    const pathStart = branchSegments.length > 0
        && parts.slice(3, 3 + branchSegments.length).join("/") === source!.branch
        ? 3 + branchSegments.length
        : 4;
    const assetPath = parts.slice(pathStart).join("/");
    if (!assetPath) return null;
    const branch = branchSegments.length > 0 && pathStart > 4 ? source!.branch : parts[3];
    if (!branch) return null;

    return `https://raw.githubusercontent.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/${encodeGithubPath(branch)}/${normalizeRelativeReadmeAssetPath(assetPath) ?? encodeGithubPath(assetPath)}${url.search}`;
}

function isProjectStorageImage(value: string) {
    return value.startsWith("/api/v1/workspaces/") || value.startsWith("/_next/") || value.startsWith("/images/");
}

function isTrustedReadmeImageUrl(url: URL, project: ProjectDocMediaProject, source: ProjectDocGithubSource | null) {
    if (!TRUSTED_PUBLIC_README_IMAGE_HOSTS.has(url.hostname.toLowerCase())) return false;
    if (url.hostname.toLowerCase() === "raw.githubusercontent.com") {
        if (!source) return false;
        const [, owner, repo] = url.pathname.split("/");
        return owner?.toLowerCase() === source.owner.toLowerCase()
            && repo?.toLowerCase() === source.repo.toLowerCase();
    }
    return true;
}

export function classifyReadmeImage(input: {
    src: string;
    alt?: string | null;
    title?: string | null;
    width: number | null;
    height: number | null;
}) : ProjectDocImageKind {
    const value = input.src.toLowerCase();
    const label = `${input.alt ?? ""} ${input.title ?? ""}`.toLowerCase();
    const width = input.width ?? 0;
    const height = input.height ?? 0;

    if (/\b(star-history|chart|graph|diagram|screenshot|preview|demo)\b/.test(value) || /\b(star-history|chart|graph|diagram|screenshot|preview|demo)\b/.test(label)) {
        return "diagram";
    }
    if (/\b(shields\.io|badge\.fury\.io|badgen\.net|img\.shields\.io)\b/.test(value) || /\b(badge|stars?|license|commit|build|version)\b/.test(label)) {
        return "badge";
    }
    if ((width > 0 && width <= 48) || (height > 0 && height <= 48)) return "icon";
    if (width > 0 && width <= 220) return "logo";
    return "content";
}

export function resolveProjectDocImage(input: {
    src: unknown;
    alt?: unknown;
    title?: unknown;
    width?: unknown;
    height?: unknown;
    allowExternalImages: boolean;
    project: ProjectDocMediaProject;
}): ProjectDocResolvedImage {
    const originalSrc = typeof input.src === "string" ? input.src.replace(CONTROL_CHARS_REGEX, "").trim() : "";
    const width = parseReadmeHtmlDimension(input.width);
    const height = parseReadmeHtmlDimension(input.height);
    const widthPercent = parseReadmeHtmlWidthPercent(input.width);
    const kind = classifyReadmeImage({
        src: originalSrc,
        alt: typeof input.alt === "string" ? input.alt : null,
        title: typeof input.title === "string" ? input.title : null,
        width,
        height,
    });

    if (!originalSrc || originalSrc.startsWith("#")) {
        return { src: null, blockedReason: "invalid", trustedExternal: false, originalSrc, kind, width, height, widthPercent };
    }

    const normalizedSrc = normalizeProtocolRelativeImageUrl(originalSrc);

    if (!/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(normalizedSrc)) {
        if (isProjectStorageImage(normalizedSrc)) {
            return { src: normalizedSrc, blockedReason: null, trustedExternal: false, originalSrc, kind, width, height, widthPercent };
        }
        const githubSrc = resolveGithubRawImage(normalizedSrc, resolveProjectDocGithubSource(input.project));
        if (githubSrc) {
            return { src: githubSrc, blockedReason: null, trustedExternal: true, originalSrc, kind, width, height, widthPercent };
        }
        return { src: null, blockedReason: "invalid", trustedExternal: false, originalSrc, kind, width, height, widthPercent };
    }

    try {
        const source = resolveProjectDocGithubSource(input.project);
        const parsed = new URL(normalizedSrc);
        if (!SAFE_IMAGE_PROTOCOLS.has(parsed.protocol)) {
            return { src: null, blockedReason: "invalid", trustedExternal: false, originalSrc, kind, width, height, widthPercent };
        }
        const githubRawSrc = resolveGithubRepositoryImageUrl(parsed, source);
        const resolvedUrl = githubRawSrc ? new URL(githubRawSrc) : parsed;
        const trustedExternal = isTrustedReadmeImageUrl(resolvedUrl, input.project, source);
        if (!input.allowExternalImages && !trustedExternal) {
            return { src: null, blockedReason: "external", trustedExternal: false, originalSrc, kind, width, height, widthPercent };
        }
        return { src: resolvedUrl.toString(), blockedReason: null, trustedExternal, originalSrc, kind, width, height, widthPercent };
    } catch {
        return { src: null, blockedReason: "invalid", trustedExternal: false, originalSrc, kind, width, height, widthPercent };
    }
}
