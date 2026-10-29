"use client";

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useDebounce } from "use-debounce";
import { get as getIdb, set as setIdb } from "idb-keyval";

import { getConnectionsFeed, type SuggestedProfile } from "@/app/actions/connections";
import { fetchDiscoverWorkspacesAction } from "@/app/actions/discover";
import { fetchWorkspaceLinkPreviewsAction, fetchWorkspaceTaskPreviewsAction } from "@/app/actions/workspace";
import { searchOrgPreviewsAction } from "@/app/actions/org-workspace";
import { FILTER_VIEWS, WORKSPACE_STATUS, WORKSPACE_TYPE, SORT_OPTIONS } from "@/constants/discover";
import { normalizeGlobalSearchQuery, type GlobalSearchContext, type NetworkSearchScope } from "@/components/layout/header/global-search";
import { profileHref } from "@/lib/routing/identifiers";
import { queryKeys } from "@/lib/query-keys";
import { isRetryableSearchError, toSearchPreviewError, SearchPreviewError, type SearchErrorCode } from "@/lib/search/contracts";

let globalCooldownUntil = 0;

type GlobalSearchPreviewBase = {
    id: string;
    title: string;
    subtitle: string;
    href: string;
    matchReason: string | null;
};

export type GlobalSearchWorkspacePreview = GlobalSearchPreviewBase & {
    kind: "project";
    username: string | null;
    status?: string | null;
    skills: string[];
    openRolesCount: number;
    followersCount: number;
    viewCount: number;
    connectedFriends: Array<{ name: string; role: string }>;
    additionalConnectedFriendsCount: number;
    coverImage?: string | null;
    updatedAt?: string | null;
};

export type GlobalSearchProfilePreview = GlobalSearchPreviewBase & {
    kind: "profile";
    userId: string;
    avatarUrl: string | null;
    username: string | null;
    skills: string[];
    location: string | null;
    mutualConnections: number;
    lastActiveAt: string | null;
    connectionStatus: SuggestedProfile["connectionStatus"];
    canConnect: boolean;
    isLockedProfile: boolean;
};

export type GlobalSearchTaskPreview = GlobalSearchPreviewBase & {
    kind: "task";
    taskCode: string;
    status: string;
    reviewStatus?: string | null;
    priority: string;
    sprintName: string | null;
    assignee: { fullName: string | null; avatarUrl: string | null } | null;
    dueDate: string | null;
    storyPoints: number | null;
};

export type GlobalSearchSkillPreview = GlobalSearchPreviewBase & {
    kind: "skill";
};

export type GlobalSearchLinkPreview = GlobalSearchPreviewBase & {
    kind: "link";
    platform: string;
    iconKey: string | null;
    purpose: string;
    audience: "public" | "members";
};

/** Organizations, assignments, org docs and "Search <org>" results (report §30.1). */
export type GlobalSearchOrgPreview = GlobalSearchPreviewBase & {
    kind: "org";
    orgKind: "org" | "assignment" | "doc" | "child" | "sprint" | "member" | "file" | "action";
    chip: string | null;
};

export type GlobalSearchPreview = GlobalSearchWorkspacePreview | GlobalSearchProfilePreview | GlobalSearchTaskPreview | GlobalSearchSkillPreview | GlobalSearchLinkPreview | GlobalSearchOrgPreview;

function isNullableString(value: unknown): value is string | null {
    return value === null || typeof value === "string";
}

function isPreviewBase(value: unknown): value is Record<string, unknown> & GlobalSearchPreviewBase {
    if (!value || typeof value !== "object" || Array.isArray(value)) return false;
    const preview = value as Record<string, unknown>;
    return typeof preview.id === "string"
        && typeof preview.title === "string"
        && typeof preview.subtitle === "string"
        && typeof preview.href === "string"
        && preview.href.startsWith("/")
        && !preview.href.startsWith("//")
        && isNullableString(preview.matchReason);
}

export function isGlobalSearchPreview(value: unknown): value is GlobalSearchPreview {
    if (!isPreviewBase(value)) return false;
    const preview = value as Record<string, unknown> & GlobalSearchPreviewBase;
    if (preview.kind === "skill") return true;
    if (preview.kind === "org") return typeof preview.orgKind === "string" && isNullableString(preview.chip);
    if (preview.kind === "link") {
        return typeof preview.platform === "string"
            && isNullableString(preview.iconKey)
            && typeof preview.purpose === "string"
            && (preview.audience === "public" || preview.audience === "members");
    }
    if (preview.kind === "project") {
        return isNullableString(preview.username)
            && (preview.status === undefined || isNullableString(preview.status))
            && (preview.coverImage === undefined || isNullableString(preview.coverImage))
            && (preview.updatedAt === undefined || isNullableString(preview.updatedAt))
            && Array.isArray(preview.skills) && preview.skills.every((skill) => typeof skill === "string")
            && [preview.openRolesCount, preview.followersCount, preview.viewCount, preview.additionalConnectedFriendsCount].every(Number.isFinite)
            && Array.isArray(preview.connectedFriends)
            && preview.connectedFriends.every((friend) => Boolean(friend) && typeof friend === "object" && typeof friend.name === "string" && typeof friend.role === "string");
    }
    if (preview.kind === "profile") {
        return typeof preview.userId === "string"
            && isNullableString(preview.avatarUrl)
            && isNullableString(preview.username)
            && Array.isArray(preview.skills) && preview.skills.every((skill) => typeof skill === "string")
            && isNullableString(preview.location)
            && Number.isFinite(preview.mutualConnections)
            && isNullableString(preview.lastActiveAt)
            && ["none", "pending_sent", "pending_received", "connected", "blocked"].includes(String(preview.connectionStatus))
            && typeof preview.canConnect === "boolean"
            && typeof preview.isLockedProfile === "boolean";
    }
    if (preview.kind === "task") {
        const assignee = preview.assignee as Record<string, unknown> | null;
        return typeof preview.taskCode === "string"
            && typeof preview.status === "string"
            && typeof preview.priority === "string"
            && isNullableString(preview.sprintName)
            && (assignee === null || Boolean(assignee) && typeof assignee === "object" && isNullableString(assignee.fullName) && isNullableString(assignee.avatarUrl))
            && isNullableString(preview.dueDate)
            && (preview.storyPoints === null || Number.isFinite(preview.storyPoints));
    }
    return false;
}

const PREVIEW_LIMIT = 6;

async function fetchOrgPreviews(query: string, orgIdentifier: string | null): Promise<GlobalSearchPreview[]> {
    const rows = await searchOrgPreviewsAction(query, orgIdentifier).catch(() => []);
    return rows.map((row) => ({ id: `org-result:${row.id}`, kind: "org" as const, orgKind: row.kind, title: row.title, subtitle: row.subtitle, href: row.href, chip: row.chip, matchReason: null }));
}

function textIncludes(value: string | null | undefined, query: string) {
    return Boolean(value?.toLocaleLowerCase().includes(query.toLocaleLowerCase()));
}

async function fetchProjectPreviews(query: string): Promise<GlobalSearchPreview[]> {
    const result = await fetchDiscoverWorkspacesAction({
        status: WORKSPACE_STATUS.ALL,
        type: WORKSPACE_TYPE.ALL,
        tech: [],
        sort: SORT_OPTIONS.NEWEST,
        search: query,
    }, undefined, PREVIEW_LIMIT, FILTER_VIEWS.ALL, "preview");

    if (!result.success) throw toSearchPreviewError(
        result.error || "Workspace preview search failed",
        result.code as SearchErrorCode | undefined,
        "retryAfterMs" in result ? result.retryAfterMs : undefined,
    );

    const projects = result.projects.map((project) => {
        const matchedSkill = (project.skills || []).find((skill) => textIncludes(skill, query));
        return {
        id: `project:${project.id}`,
        kind: "project" as const,
        title: project.title,
        subtitle: project.shortDescription || project.description || project.owner?.displayName || project.owner?.fullName || "Workspace",
        href: `/workspaces/${project.slug || project.id}?fromTab=projects`,
        username: project.owner?.username ?? null,
        status: project.status ?? null,
        skills: project.skills || [],
        openRolesCount: project.openRolesCount ?? (project.openRoles || []).reduce((count, role) => count + Math.max(0, role.count - role.filled), 0),
        followersCount: Math.max(0, project.followersCount ?? 0),
        viewCount: Math.max(0, project.viewCount ?? 0),
        connectedFriends: project.connectedFriends ?? [],
        additionalConnectedFriendsCount: Math.max(0, project.additionalConnectedFriendsCount ?? 0),
        coverImage: project.coverImage ?? null,
        updatedAt: project.updatedAt ?? null,
        matchReason: textIncludes(project.title, query)
            ? "Matched workspace title"
            : matchedSkill
                ? `Matched skill: ${matchedSkill}`
                : textIncludes(project.description || project.shortDescription, query)
                    ? "Matched workspace description"
                    : null,
    };
    });

    const seenSkills = new Set<string>();
    const skills = result.projects.flatMap((project) => project.skills || []).filter((skill) => {
        const normalized = skill.trim().toLowerCase();
        if (!normalized || seenSkills.has(normalized)) return false;
        seenSkills.add(normalized);
        return true;
    }).slice(0, PREVIEW_LIMIT).map((skill) => ({
        id: `skill:${skill.toLowerCase()}`,
        kind: "skill" as const,
        title: skill,
        subtitle: "View workspaces using this skill",
        href: `/discover?tech=${encodeURIComponent(skill)}`,
        matchReason: `Skill in matching workspaces: ${skill}`,
    }));

    return [...projects, ...skills];
}

async function fetchProfilePreviews(query: string, scope: NetworkSearchScope): Promise<GlobalSearchPreview[]> {
    const result = await getConnectionsFeed({
        tab: scope,
        limit: PREVIEW_LIMIT,
        search: query,
        includeMeta: false,
    });
    if (!result.success) throw toSearchPreviewError(
        result.error || "Profile preview search failed",
        result.code as SearchErrorCode | undefined,
        "retryAfterMs" in result ? result.retryAfterMs : undefined,
    );

    const profiles = scope === "network"
        ? result.items.flatMap((item) => "otherUser" in item && item.otherUser ? [{
            ...item.otherUser,
            connectionStatus: "connected" as const,
            canConnect: false,
            mutualConnections: 0,
            isLockedProfile: false,
            recommendationReason: null,
        }] : [])
        : result.items as SuggestedProfile[];

    return profiles.map((profile) => {
        const skills = (Array.isArray(profile.skills) ? profile.skills : []) as string[];
        const matchedSkill = skills.find((skill) => textIncludes(skill, query));
        return {
        id: `profile:${profile.id}`,
        kind: "profile" as const,
        userId: profile.id,
        title: profile.fullName || profile.username || "Person",
        subtitle: profile.headline || profile.location || profile.recommendationReason || "Profile",
        href: profileHref(profile),
        avatarUrl: profile.avatarUrl,
        username: profile.username,
        skills,
        location: profile.location,
        mutualConnections: profile.mutualConnections ?? 0,
        lastActiveAt: profile.lastActiveAt ?? null,
        connectionStatus: profile.connectionStatus,
        canConnect: profile.canConnect !== false,
        isLockedProfile: Boolean(profile.isLockedProfile),
        matchReason: textIncludes(profile.username, query) || textIncludes(profile.fullName, query)
            ? "Matched name"
            : matchedSkill
                ? `Matched skill: ${matchedSkill}`
                : textIncludes(profile.location, query)
                    ? "Matched location"
                    : textIncludes(profile.headline, query)
                        ? "Matched headline"
                        : null,
    };
    });
}

async function fetchTaskPreviews(projectIdentifier: string, query: string): Promise<GlobalSearchPreview[]> {
    const result = await fetchWorkspaceTaskPreviewsAction({ slugOrId: projectIdentifier, search: query, limit: PREVIEW_LIMIT });
    if (!result.success) throw toSearchPreviewError(
        result.error || "Task preview search failed",
        result.code as SearchErrorCode | undefined,
        "retryAfterMs" in result ? result.retryAfterMs : undefined,
    );

    return result.tasks.map((task) => {
        const taskCode = task.projectKey && task.taskNumber ? `${task.projectKey}-${task.taskNumber}` : task.id;
        return {
            id: `task:${task.id}`,
            kind: "task" as const,
            title: task.title,
            subtitle: task.description || "No description",
            href: `/workspaces/${encodeURIComponent(projectIdentifier)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(taskCode)}`,
            taskCode,
            status: task.status,
            reviewStatus: task.reviewStatus,
            priority: task.priority,
            sprintName: task.sprint?.name ?? null,
            assignee: task.assignee ? { fullName: task.assignee.fullName, avatarUrl: task.assignee.avatarUrl } : null,
            dueDate: task.dueDate,
            storyPoints: task.storyPoints,
            matchReason: textIncludes(taskCode, query)
                ? "Matched task key"
                : textIncludes(task.title, query)
                    ? "Matched task title"
                    : textIncludes(task.description, query)
                        ? "Matched task description"
                        : null,
        };
    });
}

async function fetchProjectContextPreviews(projectIdentifier: string, query: string): Promise<GlobalSearchPreview[]> {
    const [tasks, linkResult] = await Promise.all([
        fetchTaskPreviews(projectIdentifier, query),
        fetchWorkspaceLinkPreviewsAction({ slugOrId: projectIdentifier, search: query, limit: PREVIEW_LIMIT }),
    ]);
    const links = linkResult.success ? linkResult.links.map((link) => ({
        id: `link:${link.id}`,
        kind: "link" as const,
        title: link.title,
        subtitle: link.subtitle,
        href: link.href,
        platform: link.platform,
        iconKey: link.iconKey,
        purpose: link.purpose,
        audience: link.audience,
        matchReason: `Matched workspace link · ${link.purpose.replaceAll('-', ' ')}`,
    })) : [];
    return [...links, ...tasks].slice(0, PREVIEW_LIMIT * 2);
}

export function useGlobalSearchPreviews({
    context,
    query,
    enabled,
    projectIdentifier,
    peopleScope = "discover",
}: {
    context: GlobalSearchContext;
    query: string;
    enabled: boolean;
    projectIdentifier?: string | null;
    peopleScope?: NetworkSearchScope;
}) {
    const [debouncedQuery] = useDebounce(
        normalizeGlobalSearchQuery(query),
        query.trim().length <= 3 ? 450 : 250,
    );
    const previewContext = context === "default" ? "discover" : context;
    const supportsPreviews = previewContext === "discover" || previewContext === "network" || (previewContext === "project" && Boolean(projectIdentifier));
    const [cooldownUntil, setCooldownUntil] = useState(globalCooldownUntil);

    useEffect(() => {
        if (!cooldownUntil) return;
        const remaining = Math.max(cooldownUntil - Date.now(), 0);
        const timeout = window.setTimeout(() => setCooldownUntil(0), remaining);
        return () => window.clearTimeout(timeout);
    }, [cooldownUntil]);

    const queryResult = useQuery({
        queryKey: queryKeys.globalSearch.preview(
            previewContext,
            peopleScope,
            projectIdentifier ?? null,
            debouncedQuery.toLowerCase(),
        ),
        queryFn: async () => {
            if (Date.now() <= globalCooldownUntil) {
                throw new SearchPreviewError("Rate limit cooldown active", "RATE_LIMITED", globalCooldownUntil - Date.now());
            }
            const cacheKey = `offline:search:${previewContext}:${peopleScope}:${projectIdentifier || 'none'}:${debouncedQuery.toLowerCase()}`;
            try {
                // Org results come first: "Search CSE-3A" inside an org, then your orgs, assignments and docs (report §30.1).
                const [orgResults, results] = await Promise.all([
                    previewContext === "network" ? Promise.resolve([]) : fetchOrgPreviews(debouncedQuery, previewContext === "project" ? projectIdentifier ?? null : null),
                    previewContext === "network"
                        ? fetchProfilePreviews(debouncedQuery, peopleScope)
                        : previewContext === "project" && projectIdentifier
                            ? fetchProjectContextPreviews(projectIdentifier, debouncedQuery)
                            : fetchProjectPreviews(debouncedQuery),
                ]);
                
                const merged = [...orgResults, ...results];
                void setIdb(cacheKey, merged).catch(() => {});
                return merged;
            } catch (error) {
                if (typeof window !== "undefined" && (!navigator.onLine || error instanceof Error)) {
                    try {
                        const cached = await getIdb<GlobalSearchPreview[]>(cacheKey);
                        if (cached) return cached;
                    } catch {}
                }
                if (error instanceof SearchPreviewError && error.code === "RATE_LIMITED") {
                    const nextCooldownUntil = Date.now() + (error.retryAfterMs ?? 2000);
                    globalCooldownUntil = nextCooldownUntil;
                    setCooldownUntil(nextCooldownUntil);
                }
                throw error;
            }
        },
        enabled: enabled && supportsPreviews && debouncedQuery.length >= 2 && cooldownUntil === 0,
        staleTime: previewContext === "discover" ? 60_000 : previewContext === "network" ? 30_000 : 15_000,
        gcTime: 5 * 60_000,
        retry: (failureCount, error) => failureCount < 1 && isRetryableSearchError(error),
        refetchOnWindowFocus: false,
    });

    return {
        ...queryResult,
        effectiveQuery: debouncedQuery,
        isDebouncing: normalizeGlobalSearchQuery(query) !== debouncedQuery,
    };
}
