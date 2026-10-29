import { normalizeSearchQuery, tokenizeSearchQuery } from "@/lib/search/query";
import { settingsTabHref } from "@/constants/routes";

export type GlobalSearchContext =
    | "default"
    | "discover"
    | "network"
    | "messages"
    | "project"
    | "settings";

export type SearchContext = {
    context: GlobalSearchContext;
    placeholder: string;
    title: string;
    description: string;
};

export type NetworkSearchScope = "discover" | "network";

export function getNetworkSearchScope(searchParams?: URLSearchParams | null): NetworkSearchScope {
    const tab = searchParams?.get("tab");
    return tab === "network" || tab === "connections" ? "network" : "discover";
}

export type SettingsSearchItem = {
    id: string;
    title: string;
    section: string;
    description: string;
    href: string;
    keywords: string;
    featured?: boolean;
};

const RECENT_GLOBAL_SEARCH_STORAGE_PREFIX = "nb:global-search:recent:v1";
export const MAX_RECENT_GLOBAL_SEARCHES = 5;

type RecentGlobalSearchStore = Record<string, unknown>;

export type RecentGlobalSearchItem =
    | { kind: "query"; key: string; label: string; query: string }
    | { kind: "preview"; key: string; label: string; preview: unknown };

function readRecentGlobalSearchStore(ownerId: string): RecentGlobalSearchStore {
    if (typeof window === "undefined" || !ownerId) return {};
    try {
        const parsed = JSON.parse(window.localStorage.getItem(`${RECENT_GLOBAL_SEARCH_STORAGE_PREFIX}:${ownerId}`) || "{}") as unknown;
        return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as RecentGlobalSearchStore : {};
    } catch {
        return {};
    }
}

export function getGlobalSearchRecentScope(
    context: GlobalSearchContext,
    peopleScope: NetworkSearchScope,
    projectIdentifier: string | null,
) {
    if (context === "default" || context === "discover") return "discover";
    if (context === "network") return `network:${peopleScope}`;
    if (context === "project") return `project:${projectIdentifier || "unknown"}`;
    return context;
}

function recentQueryItem(query: string): RecentGlobalSearchItem | null {
    const normalized = normalizeGlobalSearchQuery(query);
    if (!normalized) return null;
    return {
        kind: "query",
        key: `query:${normalized.toLocaleLowerCase()}`,
        label: normalized,
        query: normalized,
    };
}

function parseRecentGlobalSearchItem(value: unknown): RecentGlobalSearchItem | null {
    if (typeof value === "string") return recentQueryItem(value);
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const item = value as Record<string, unknown>;
    if (item.kind === "query" && typeof item.query === "string") return recentQueryItem(item.query);
    if (
        item.kind === "preview"
        && typeof item.key === "string"
        && typeof item.label === "string"
        && item.preview
        && typeof item.preview === "object"
        && !Array.isArray(item.preview)
    ) {
        return { kind: "preview", key: item.key, label: item.label, preview: item.preview };
    }
    return null;
}

export function mergeRecentGlobalSearches(current: readonly RecentGlobalSearchItem[], item: RecentGlobalSearchItem) {
    return [item, ...current.filter((recent) => recent.key !== item.key)].slice(0, MAX_RECENT_GLOBAL_SEARCHES);
}

export function readRecentGlobalSearches(ownerId: string, scope: string) {
    const value = readRecentGlobalSearchStore(ownerId)[scope];
    if (!Array.isArray(value)) return [];
    return value
        .map(parseRecentGlobalSearchItem)
        .filter((item): item is RecentGlobalSearchItem => Boolean(item))
        .slice(0, MAX_RECENT_GLOBAL_SEARCHES);
}

function writeRecentGlobalSearches(ownerId: string, scope: string, searches: readonly RecentGlobalSearchItem[]) {
    if (typeof window === "undefined" || !ownerId) return [];
    const store = readRecentGlobalSearchStore(ownerId);
    const next = searches.slice(0, MAX_RECENT_GLOBAL_SEARCHES);
    try {
        window.localStorage.setItem(
            `${RECENT_GLOBAL_SEARCH_STORAGE_PREFIX}:${ownerId}`,
            JSON.stringify({ ...store, [scope]: next }),
        );
    } catch {
        // Browser-local recents are best-effort; storage failures must never block search navigation.
    }
    return next;
}

export function rememberRecentGlobalSearch(ownerId: string, scope: string, query: string) {
    const item = recentQueryItem(query);
    if (!item) return readRecentGlobalSearches(ownerId, scope);
    return writeRecentGlobalSearches(
        ownerId,
        scope,
        mergeRecentGlobalSearches(readRecentGlobalSearches(ownerId, scope), item),
    );
}

export function rememberRecentGlobalSearchPreview<T extends { id: string; title: string }>(ownerId: string, scope: string, preview: T) {
    const item: RecentGlobalSearchItem = {
        kind: "preview",
        key: `preview:${preview.id}`,
        label: normalizeGlobalSearchQuery(preview.title) || "Search result",
        preview,
    };
    return writeRecentGlobalSearches(
        ownerId,
        scope,
        mergeRecentGlobalSearches(readRecentGlobalSearches(ownerId, scope), item),
    );
}

export function removeRecentGlobalSearch(ownerId: string, scope: string, key: string) {
    if (!key) return readRecentGlobalSearches(ownerId, scope);
    return writeRecentGlobalSearches(
        ownerId,
        scope,
        readRecentGlobalSearches(ownerId, scope).filter((item) => item.key !== key),
    );
}

const SETTINGS_SEARCH_ITEMS: readonly SettingsSearchItem[] = [
    { id: "account", title: "Account", section: "Account", description: "Your account details and data on this device.", href: settingsTabHref("account"), keywords: "profile account status manage", featured: true },
    { id: "delete-account", title: "Delete account", section: "Legal and data", description: "Review the permanent account deletion controls.", href: "/settings#settings-delete-account", keywords: "remove erase close danger irreversible" },
    { id: "security", title: "Security", section: "Security", description: "Protect your account and review sign-in activity.", href: settingsTabHref("security"), keywords: "protect login sign in", featured: true },
    { id: "authenticator", title: "Authenticator app", section: "Security", description: "Configure an authenticator app and 6-digit verification codes.", href: "/settings#settings-security-authenticator", keywords: "mfa 2fa two factor otp verification code" },
    { id: "password", title: "Password", section: "Security", description: "Change your password.", href: "/settings#settings-security-password", keywords: "change reset credential sign in" },
    { id: "active-sessions", title: "Signed-in devices", section: "Security", description: "Review devices where your account is signed in.", href: "/settings#settings-security-sessions", keywords: "device logout revoke trusted session" },
    { id: "login-activity", title: "Sign-in activity", section: "Security", description: "Review recent sign-ins and security changes.", href: "/settings#settings-security-activity", keywords: "history audit recent device" },
    { id: "privacy", title: "Privacy", section: "Privacy", description: "Control profile visibility and interaction permissions.", href: settingsTabHref("privacy"), keywords: "visibility permissions interactions", featured: true },
    { id: "profile-visibility", title: "Profile visibility", section: "Privacy", description: "Choose who can open your full profile.", href: "/settings#settings-privacy-visibility", keywords: "public private connections only hide profile" },
    { id: "messaging-privacy", title: "Messaging privacy", section: "Privacy", description: "Choose who can start direct messages with you.", href: "/settings#settings-privacy-messages", keywords: "message dm everyone connections permission" },
    { id: "request-privacy", title: "Connection request privacy", section: "Privacy", description: "Choose who can send connection requests.", href: "/settings#settings-privacy-requests", keywords: "mutuals nobody everyone people network" },
    { id: "blocked-accounts", title: "Blocked accounts", section: "Privacy", description: "Review and unblock accounts you have blocked.", href: "/settings#settings-privacy-blocked", keywords: "block unblock users people" },
    { id: "notifications", title: "Notifications", section: "Notifications", description: "Control notification categories and delivery.", href: settingsTabHref("notifications"), keywords: "alerts bell updates", featured: true },
    { id: "notification-categories", title: "In-app notification categories", section: "Notifications", description: "Choose which updates appear in the bell tray.", href: settingsTabHref("notifications"), keywords: "categories workspace connection message application" },
    { id: "quiet-hours", title: "Pause notifications and quiet hours", section: "Notifications", description: "Delay delivery temporarily or set a daily quiet window.", href: "/settings#settings-notifications-quiet-hours", keywords: "mute muted scopes snooze pause resume time" },
    { id: "desktop-push", title: "Desktop and push notifications", section: "Notifications", description: "Manage browser desktop and push delivery.", href: "/settings#settings-notifications-delivery", keywords: "browser permission device delivery subscribe" },
    { id: "appearance", title: "Appearance", section: "Appearance", description: "Customize theme, accent color, density, and motion.", href: settingsTabHref("appearance"), keywords: "look display interface", featured: true },
    { id: "theme", title: "Theme mode", section: "Appearance", description: "Switch between light, dark, and system themes.", href: "/settings#settings-appearance-theme", keywords: "change color theme light dark system mode" },
    { id: "accent-color", title: "Accent color", section: "Appearance", description: "Change the action and selected-state color across the app.", href: "/settings#settings-appearance-accent", keywords: "change color primary clay orchid violet forest green ember amber rose lagoon teal" },
    { id: "density", title: "Display spacing", section: "Appearance", description: "Adjust spacing in navigation, lists, cards, and panels.", href: "/settings#settings-appearance-density", keywords: "compact comfortable spacious size spacing" },
    { id: "reduce-motion", title: "Reduce motion", section: "Appearance", description: "Reduce non-essential interface animation.", href: "/settings#settings-appearance-motion", keywords: "accessibility animation transition movement" },
    { id: "integrations", title: "Integrations", section: "Integrations", description: "Manage sign-in methods, GitHub, and editor sessions.", href: settingsTabHref("integrations"), keywords: "connected services extensions", featured: true },
    { id: "account-connections", title: "Sign-in methods", section: "Integrations", description: "Review Google, GitHub, email, and linked sign-in methods.", href: "/settings#settings-integrations-connections", keywords: "provider login oauth link unlink" },
    { id: "github", title: "GitHub access", section: "Integrations", description: "Review account-level GitHub repository access status.", href: "/settings#settings-integrations-github", keywords: "repository repo source code connect" },
    { id: "editor-sessions", title: "Connected editors", section: "Integrations", description: "Review or disconnect VS Code and other editor sessions.", href: "/settings#settings-integrations-editors", keywords: "vscode cursor kiro ide extension disconnect revoke active" },
    { id: "manual-token", title: "Manual editor token", section: "Integrations", description: "Generate a fallback token for an editor extension.", href: "/settings#settings-integrations-token", keywords: "device authentication login extension" },
    { id: "privacy-policies", title: "Legal and data rights", section: "Legal and data", description: "Review legal terms, policies, and account data rights.", href: settingsTabHref("privacy-policies"), keywords: "legal rights terms eula policy data export delete" },
    { id: "terms-of-service", title: "Terms of Service", section: "Legal and data", description: "Review the NetworkBase™ Terms of Service.", href: "/terms", keywords: "legal terms conditions agreement contract rules" },
    { id: "privacy-policy", title: "Privacy Policy", section: "Legal and data", description: "Review NetworkBase™ data protection and privacy policies.", href: "/privacy", keywords: "legal privacy notice data rights protection gdpr" },
    { id: "security-reporting", title: "Security reporting", section: "Legal and data", description: "Official security disclosure and vulnerability reporting.", href: "/security-reporting", keywords: "security bug vulnerability report incident disclose" },
    { id: "grievances", title: "Grievance redressal", section: "Legal and data", description: "Statutory grievance officer and dispute redressal.", href: "/grievances", keywords: "grievance officer complaint dispute nodal officer redressal" },
    { id: "trademark-ip", title: "Copyright complaints", section: "Legal and data", description: "NetworkBase™ trademark, copyright, and intellectual property notices.", href: "/copyright", keywords: "trademark brand copyright intellectual property ownership" },
] as const;

export function normalizeGlobalSearchQuery(query: string) {
    return normalizeSearchQuery(query);
}

export function isProjectDetailPath(pathname: string | null) {
    const segments = pathname?.split("/").filter(Boolean) ?? [];
    // An org page (/org/<handle>) searches that org: "Search CSE-3A" first (report §30.1).
    return segments.length === 2 && (segments[0] === "projects" || segments[0] === "org") && segments[1] !== "new";
}

export function getProjectIdentifierFromPathname(pathname: string | null) {
    if (!isProjectDetailPath(pathname)) return null;
    const segment = pathname?.split("/").filter(Boolean)[1];
    if (!segment) return null;
    try {
        return decodeURIComponent(segment);
    } catch {
        return segment;
    }
}

export function resolveGlobalSearchContext(pathname: string | null, searchParams?: URLSearchParams | null): SearchContext {
    if (isProjectDetailPath(pathname) && pathname?.startsWith("/org/")) {
        return {
            context: "project",
            placeholder: "Search this organization…",
            title: "Search this organization",
            description: "Docs, assignments, workspaces, files you can open, sprints and tasks in this organization.",
        };
    }
    if (isProjectDetailPath(pathname)) {
        return {
            context: "project",
            placeholder: "Search this workspace’s tasks…",
            title: "Search workspace tasks",
            description: "Search task keys, titles, and descriptions in this workspace.",
        };
    }
    if (pathname?.startsWith("/network")) {
        const scope = getNetworkSearchScope(searchParams);
        return {
            context: "network",
            placeholder: scope === "network" ? "Search your network…" : "Find people…",
            title: scope === "network" ? "Search your network" : "Find people",
            description: scope === "network"
                ? "Search your accepted connections by name."
                : "Search people by name, skills, interests, or location.",
        };
    }
    if (pathname?.startsWith("/discover")) {
        return {
            context: "discover",
            placeholder: "Search workspaces…",
            title: "Search workspaces",
            description: "Search workspace names, descriptions, and technologies.",
        };
    }
    if (pathname?.startsWith("/messages")) {
        return {
            context: "messages",
            placeholder: "Find a conversation…",
            title: "Find a conversation",
            description: "Jump to a channel, direct message, or person.",
        };
    }
    if (pathname?.startsWith("/settings")) {
        return {
            context: "settings",
            placeholder: "Search settings…",
            title: "Search settings",
            description: "Find a setting and go directly to its section.",
        };
    }
    return {
        context: "default",
        placeholder: "Search workspaces…",
        title: "Search workspaces",
        description: "Search workspaces from anywhere in the app.",
    };
}

export function getGlobalSearchQuery(searchParams: URLSearchParams, context: GlobalSearchContext) {
    if (context === "messages" || context === "settings") return "";
    if (context === "project") return normalizeGlobalSearchQuery(searchParams.get("search") || "");
    const query = searchParams.get("q");
    const tag = searchParams.get("tag");
    // Discover shows its skill filters as tags of its own; the top bar shows only the text search there.
    const technologies = context === "default"
        ? searchParams.get("tech")?.split(",").map((item) => item.trim()).filter(Boolean) ?? []
        : [];
    return normalizeGlobalSearchQuery(query || (tag ? `#${tag}` : technologies.join(", ")));
}

export function searchSettings(query: string) {
    const normalized = normalizeGlobalSearchQuery(query).toLowerCase();
    if (!normalized) return SETTINGS_SEARCH_ITEMS.filter((item) => item.featured);

    const tokens = tokenizeSearchQuery(normalized);
    return SETTINGS_SEARCH_ITEMS
        .map((item) => {
            const title = item.title.toLowerCase();
            const haystack = `${title} ${item.section} ${item.description} ${item.keywords}`.toLowerCase();
            if (!tokens.every((token) => haystack.includes(token))) return null;
            const score = title === normalized ? 0 : title.startsWith(normalized) ? 1 : title.includes(normalized) ? 2 : 3;
            return { item, score };
        })
        .filter((result): result is { item: SettingsSearchItem; score: number } => Boolean(result))
        .sort((a, b) => a.score - b.score || a.item.title.localeCompare(b.item.title))
        .map((result) => result.item);
}

export function buildGlobalSearchHref({
    pathname,
    searchParams,
    context,
    query,
}: {
    pathname: string;
    searchParams: URLSearchParams;
    context: GlobalSearchContext;
    query: string;
}) {
    const value = normalizeGlobalSearchQuery(query);
    if (!value || context === "messages" || context === "settings") return null;

    const params = context === "default" ? new URLSearchParams() : new URLSearchParams(searchParams);
    let targetPath = pathname;
    if (context === "project") {
        params.set("tab", "tasks");
        params.set("search", value);
        params.set("page", "1");
        params.delete("task");
        params.delete("taskId");
        params.delete("drawerType");
        params.delete("drawerId");
        params.delete("panelTab");
    } else {
        if (context === "default") targetPath = "/discover";
        if (context === "network" && (params.get("tab") === "requests" || params.get("tab") === "invitations")) params.set("tab", "suggested");
        params.set("q", value);
        params.delete("tag");
    }
    const serialized = params.toString();
    return serialized ? `${targetPath}?${serialized}` : targetPath;
}

export function buildGlobalSearchClearHref({
    pathname,
    searchParams,
    context,
}: {
    pathname: string;
    searchParams: URLSearchParams;
    context: GlobalSearchContext;
}) {
    const params = new URLSearchParams(searchParams);
    if (context === "project") {
        const wasTaskSearch = params.get("tab") === "tasks" && params.has("search");
        params.delete("search");
        if (wasTaskSearch) params.set("page", "1");
    } else {
        params.delete("q");
        params.delete("tag");
        // On Discover, skills are filters with their own tags and Clear all; clearing the search keeps them.
        if (context !== "discover") params.delete("tech");
    }
    const serialized = params.toString();
    return serialized ? `${pathname}?${serialized}` : pathname;
}
