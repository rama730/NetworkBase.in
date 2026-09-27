"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import Image from "next/image";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { queryKeys } from "@/lib/query-keys";
import { broadcastProjectUpdated } from "@/components/projects/ProjectAvatar";
import {
    AlertTriangle,
    Archive,
    Bell,
    Camera,
    Check,
    ChevronDown,
    Crown,
    Download,
    Eye,
    FileText,
    Folder,
    Globe,
    KeyRound,
    Link2,
    Loader2,
    Lock,
    Newspaper,
    Pencil,
    RefreshCw,
    Search,
    Scale,
    Settings,
    Shield,
    ShieldCheck,
    SlidersHorizontal,
    Trash2,
    Upload,
    UserCog,
    UserMinus,
    Users,
    Workflow,
    Plus,
    X,
    Info,
} from "lucide-react";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { UserAvatar } from "@/components/ui/UserAvatar";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
    ProjectArchiveModal,
    ProjectTransferOwnershipModal,
    ProjectDeleteModal,
} from "@/components/projects/settings/ProjectDangerModals";
// ponytail: dynamic code-splitting for SkillPicker catalog (378 KB) so settings tab initial chunk stays small. ceiling: settings tab. upgrade: keep dynamic.
const SkillPicker = dynamic(
    () => import("@/components/skills/SkillPicker").then((mod) => mod.SkillPicker),
    {
        ssr: false,
        loading: () => (
            <div aria-hidden="true" className="nb-skeleton h-10 w-full rounded-lg border border-border" />
        ),
    },
);
import { Button } from "@/components/ui/button";
import { transferProjectOwnership } from "@/app/actions/account";
import {
    archiveProjectAction,
    clearProjectCoverImageAction,
    createProjectCoverImageUploadUrlAction,
    deleteProject,
    finalizeProjectCoverImageUploadAction,
    getProjectAccessImpactAction,
    getProjectAccessTransitionPreflightAction,
    getProjectCollaboratorSettingsAction,
    getProjectDangerZonePreflightAction,
    getProjectFileWorkspaceSettingsAction,
    getProjectMemberRemovalPreflightAction,
    readProjectMemberNotificationSettingsAction,
    readProjectNotificationSettingsAction,
    readProjectDocSettingsAction,
    readProjectSettingsBootstrapAction,
    removeProjectMemberAction,
    resetProjectMemberNotificationSettingsAction,
    resetProjectNotificationSettingsAction,
    updateProject,
    updateProjectLifecycleAction,
    updateProjectFileUploadDefaultsAction,
    updateProjectMemberFileUploadAction,
    updateProjectMemberNotificationSettingsAction,
    updateProjectMemberRoleAction,
    updateProjectNotificationSettingsAction,
    updateProjectPublicTabVisibilityAction,
    updateProjectDocSettingsAction,
    updateProjectVisibilityAction,
} from "@/app/actions/project";
import { cn } from "@/lib/utils";
import {
    isKnownProjectType,
    OTHER_PROJECT_TYPE_ID,
    POPULAR_PROJECT_TAGS,
    PROJECT_TYPE_OPTIONS,
} from "@/lib/projects/project-create-options";
import {
    buildDefaultProjectNotificationPolicy,
    groupProjectNotificationEntries,
    normalizeProjectMemberNotificationOverrides,
    normalizeProjectNotificationPolicy,
    resolveProjectNotificationDecision,
    summarizeProjectNotificationPolicy,
    type ProjectMemberNotificationOverrides,
    type ProjectNotificationEventKey,
    type ProjectNotificationGroupId,
    type ProjectNotificationPolicy,
    type ProjectNotificationPreset,
    type ProjectNotificationRegistryEntry,
} from "@/lib/notifications/project-policy";
import {
    buildProjectAccessImpact,
    buildProjectAccessPolicy,
    buildProjectAccessTransitionPolicy,
    buildProjectFilePolicy,
    buildProjectMemberMutationPolicy,
    buildProjectMemberRemovalPreflight,
    buildProjectPersonReference,
    buildProjectRolePolicy,
    buildProjectSettingsPreflight,
    areProjectPublicTabVisibilitiesEqual,
    DEFAULT_PROJECT_PUBLIC_TAB_VISIBILITY,
    getProjectMemberDisplayName,
    getProjectMemberRoleLabel,
    normalizeProjectPublicTabVisibility,
    getVisibleProjectSettingsSections,
    normalizeProjectVisibility,
    PROJECT_PUBLIC_TAB_DESCRIPTIONS,
    PROJECT_PUBLIC_TAB_LABELS,
    type ProjectMemberRole,
    type ProjectPublicTabId,
    type ProjectPublicTabVisibility,
    type ProjectSettingsMember,
    type ProjectSettingsSectionId,
    type ProjectSettingsVisibility,
} from "@/lib/projects/settings-policies";
import {
    DEFAULT_PROJECT_DOC_SETTINGS,
    normalizeProjectDocSettings,
    type ProjectDocSettings,
} from "@/lib/projects/doc";
import { LifecycleEditor as BaseLifecycleEditor } from "@/components/projects/LifecycleEditor";
import { ProjectRolesEditor } from "@/components/projects/settings/ProjectRolesEditor";
import { ProjectLinksManager } from "@/components/projects/dashboard/ProjectSocialLinksCard";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { LegalAndDataRightsSection } from "@/components/settings/LegalAndDataRightsSection";
import {
    normalizeProjectRoleFormValues,
    type ProjectRoleFormValue,
    type ProjectRolesFormValues,
} from "@/lib/projects/project-roles-form";

interface ProjectSettingsTabProps {
    projectId: string;
    project: any;
    onProjectUpdated: (updates?: { coverImage?: string | null }) => void;
    isProjectOwner: boolean;
    actorRole?: ProjectMemberRole | null;
    members?: ProjectSettingsMember[];
    loadingMembers?: boolean;
}

type ConfirmActionResult = {
    success: boolean;
    message: string;
    refresh?: boolean;
    redirectTo?: string;
};

type ConfirmAction = {
    title: string;
    description: string;
    confirmLabel: string;
    variant: "default" | "destructive";
    content?: React.ReactNode;
    action: () => Promise<ConfirmActionResult>;
};

type DangerPreflight = {
    status: "draft" | "active" | "completed" | "archived";
    openRolesCount: number;
    pendingApplicationsCount: number;
    activeTasksCount: number;
    canArchive: boolean;
    canDelete: boolean;
};

type AccessImpact = {
    membersCount: number;
    followersCount: number;
    openRolesCount: number;
    pendingApplicationsCount: number;
    activeTasksCount: number;
};

type AccessTransitionPreflightData = {
    previousVisibility: ProjectSettingsVisibility;
    nextVisibility: ProjectSettingsVisibility;
    confirmationToken: string;
    policy: ReturnType<typeof buildProjectAccessTransitionPolicy>;
    counts: AccessImpact;
    previews: {
        followers: Array<{ id: string; username: string | null; fullName: string | null; avatarUrl: string | null }>;
        openRoles: Array<{ id: string; title: string | null; role: string | null }>;
        pendingApplications: Array<{ id: string; applicantId: string; applicantName: string | null; roleTitle: string | null; roleName: string | null }>;
    };
};


type CollaboratorSettingsData = {
    members: ProjectSettingsMember[];
    roleCounts: Record<ProjectMemberRole, number>;
    hasMore: boolean;
    nextCursor: string | null;
};

type FileWorkspaceSettingsData = {
    members: Array<ProjectSettingsMember & {
        fileUploadEnabled: boolean;
        uploadPermissionLocked: boolean;
        uploadPermissionLabel: string;
    }>;
    summary: {
        alwaysAllowedCount: number;
        enabledMemberCount: number;
        disabledMemberCount: number;
    };
};

type ProjectNotificationSettingsData = {
    policy: ProjectNotificationPolicy;
    summary: ReturnType<typeof summarizeProjectNotificationPolicy>;
};

type MemberNotificationSettingsData = {
    member: {
        id: string;
        username: string | null;
        fullName: string | null;
        avatarUrl: string | null;
        membershipRole: ProjectMemberRole;
    };
    canEdit: boolean;
    overrides: ProjectMemberNotificationOverrides;
};

type RemovalPreflightData = {
    member: ProjectSettingsMember;
    activeAssignedTasks: number;
    activeCreatedTasks: number;
    fileReviews: number;
    acceptedApplications: number;
    projectGroupParticipant: boolean;
    visibility: ProjectSettingsVisibility;
    activeAssignedTaskItems?: Array<{ id: string; title: string; taskNumber: number | null; status: string | null }>;
    activeCreatedTaskItems?: Array<{ id: string; title: string; taskNumber: number | null; status: string | null }>;
    fileReviewItems?: Array<{ id: string; taskId: string; taskTitle: string | null; nodeName: string | null; annotation: string | null }>;
    acceptedApplicationItems?: Array<{ id: string; roleId: string; roleTitle: string | null; roleName: string | null }>;
    reassignmentCandidates?: ProjectSettingsMember[];
};
type CollaboratorFilter = "all" | "admin" | "member" | "viewer";
type RemovalMode = "preserve_history" | "unassign_active_tasks" | "reassign_active_tasks";
type RemovalTaskPreview = { id: string; title: string; taskNumber: number | null; status: string | null };

type CoverDraft = {
    file: File;
    previewUrl: string;
    naturalWidth: number;
    naturalHeight: number;
    zoom: number;
    offsetX: number;
    offsetY: number;
};

type ProjectImageDragState = {
    pointerId: number;
    startX: number;
    startY: number;
    offsetX: number;
    offsetY: number;
};

type ScrollSnapshot = {
    routeRoot: HTMLElement | null;
    routeScrollTop: number;
    settingsRoot: HTMLElement | null;
    settingsScrollTop: number;
    windowScrollX: number;
    windowScrollY: number;
};

const SECTION_ICONS: Record<ProjectSettingsSectionId, React.ComponentType<{ className?: string }>> = {
    general: Settings,
    links: Link2,
    access: Globe,
    collaborators: Users,
    "roles-applications": UserCog,
    readme: FileText,
    updates: Newspaper,
    "tasks-workflow": Workflow,
    "files-workspace": Folder,
    notifications: Bell,
    "privacy-policies": Scale,
    "privacy-terms": Scale,
    danger: AlertTriangle,
};

const SECTION_GROUPS: Array<{
    id: string;
    label: string;
    sectionIds: ProjectSettingsSectionId[];
}> = [
    {
        id: "profile",
        label: "Project Profile",
        sectionIds: ["general", "links"],
    },
    {
        id: "access",
        label: "Access & Team",
        sectionIds: ["access", "collaborators", "roles-applications"],
    },
    {
        id: "workspace",
        label: "Workspace Policies",
        sectionIds: ["readme", "updates", "tasks-workflow", "files-workspace"],
    },
    {
        id: "governance",
        label: "System & Governance",
        sectionIds: ["notifications", "privacy-policies", "danger"],
    },
];

const VISIBILITY_OPTIONS: Array<{
    id: ProjectSettingsVisibility;
    title: string;
    description: string;
    detail: string;
}> = [
    {
        id: "public",
        title: "Public",
        description: "Anyone can discover and view the public project surface.",
        detail: "Best for open collaboration, public updates, and shareable project profiles.",
    },
    {
        id: "private",
        title: "Private",
        description: "Only the owner and approved members can view project content.",
        detail: "Best when files, tasks, applications, and updates should stay member-only.",
    },
];

const PROJECT_IMAGE_UPLOAD_MAX_BYTES = 2 * 1024 * 1024;
const PROJECT_IMAGE_OUTPUT_SIZE = 1024;
const PROJECT_IMAGE_PREVIEW_SIZE = 224;
const PROJECT_IMAGE_MIN_ZOOM = 1;
const PROJECT_IMAGE_MAX_ZOOM = 2.5;
const PROJECT_TAG_LIMIT = 8;
const PROJECT_SKILL_LIMIT = 12;
const ALLOWED_PROJECT_IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const projectRoleSettingsSchema = z.object({
    roles: z.array(z.object({
        id: z.string().optional(),
        role: z.string().trim().min(1, "Role name is required"),
        count: z.number().int().min(1, "Count must be at least 1"),
        description: z.string().optional(),
        skills: z.array(z.string()).optional(),
    })),
});

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

function readImageDimensions(src: string): Promise<{ width: number; height: number }> {
    return new Promise((resolve, reject) => {
        const image = new globalThis.Image();
        image.onload = () => resolve({
            width: image.naturalWidth || PROJECT_IMAGE_OUTPUT_SIZE,
            height: image.naturalHeight || PROJECT_IMAGE_OUTPUT_SIZE,
        });
        image.onerror = () => reject(new Error("Failed to read selected image."));
        image.src = src;
    });
}

function projectImagePreviewMetrics(draft: CoverDraft) {
    const baseScale = Math.max(
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalWidth),
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalHeight),
    );
    const width = draft.naturalWidth * baseScale * draft.zoom;
    const height = draft.naturalHeight * baseScale * draft.zoom;
    return {
        width,
        height,
        maxOffsetX: Math.max(0, (width - PROJECT_IMAGE_PREVIEW_SIZE) / 2),
        maxOffsetY: Math.max(0, (height - PROJECT_IMAGE_PREVIEW_SIZE) / 2),
    };
}

function normalizeProjectImageDraft(draft: CoverDraft, updates: Partial<Pick<CoverDraft, "zoom" | "offsetX" | "offsetY">>) {
    const zoom = clamp(updates.zoom ?? draft.zoom, PROJECT_IMAGE_MIN_ZOOM, PROJECT_IMAGE_MAX_ZOOM);
    const nextDraft = { ...draft, ...updates, zoom };
    const metrics = projectImagePreviewMetrics(nextDraft);
    return {
        ...nextDraft,
        offsetX: clamp(nextDraft.offsetX, -metrics.maxOffsetX, metrics.maxOffsetX),
        offsetY: clamp(nextDraft.offsetY, -metrics.maxOffsetY, metrics.maxOffsetY),
    };
}

function fitProjectImageDraft(draft: CoverDraft) {
    const coverScale = Math.max(
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalWidth),
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalHeight),
    );
    const containScale = Math.min(
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalWidth),
        PROJECT_IMAGE_PREVIEW_SIZE / Math.max(1, draft.naturalHeight),
    );
    const zoom = clamp(containScale / coverScale, PROJECT_IMAGE_MIN_ZOOM, PROJECT_IMAGE_MAX_ZOOM);
    return normalizeProjectImageDraft(draft, { zoom, offsetX: 0, offsetY: 0 });
}

function fillProjectImageDraft(draft: CoverDraft) {
    return normalizeProjectImageDraft(draft, {
        zoom: PROJECT_IMAGE_MIN_ZOOM,
        offsetX: 0,
        offsetY: 0,
    });
}

function formatTaskPreviewLabel(task: RemovalTaskPreview) {
    const number = typeof task.taskNumber === "number" ? `#${task.taskNumber}` : "Task";
    return `${number} · ${task.title}`;
}

function RemovalImpactDetails({ preflight }: { preflight: RemovalPreflightData }) {
    const sections: Array<{
        key: string;
        label: string;
        count: number;
        items: React.ReactNode[];
        empty: string;
    }> = [
        {
            key: "assigned",
            label: "Active assigned tasks",
            count: preflight.activeAssignedTasks,
            items: (preflight.activeAssignedTaskItems ?? []).map((task) => (
                <li key={task.id} className="rounded-lg border border-border bg-card px-3 py-2">
                    <span className="block font-medium text-foreground">{formatTaskPreviewLabel(task)}</span>
                    <span className="nb-meta text-[11px] text-muted-foreground">{task.status ?? "active"} · will need reassignment if history is preserved</span>
                </li>
            )),
            empty: "No active assigned tasks.",
        },
        {
            key: "created",
            label: "Created active tasks",
            count: preflight.activeCreatedTasks,
            items: (preflight.activeCreatedTaskItems ?? []).map((task) => (
                <li key={task.id} className="rounded-lg border border-border bg-card px-3 py-2">
                    <span className="block font-medium text-foreground">{formatTaskPreviewLabel(task)}</span>
                    <span className="nb-meta text-[11px] text-muted-foreground">{task.status ?? "active"} · creator history stays visible</span>
                </li>
            )),
            empty: "No active tasks created by this member.",
        },
        {
            key: "reviews",
            label: "File review responsibilities",
            count: preflight.fileReviews,
            items: (preflight.fileReviewItems ?? []).map((review) => (
                <li key={review.id} className="rounded-lg border border-border bg-card px-3 py-2">
                    <span className="block font-medium text-foreground">
                        {review.nodeName ?? "Linked file"} · {review.taskTitle ?? "Task"}
                    </span>
                    <span className="nb-meta text-[11px] text-muted-foreground">{review.annotation ?? "Needs review"}</span>
                </li>
            )),
            empty: "No file review responsibilities found.",
        },
        {
            key: "applications",
            label: "Accepted application history",
            count: preflight.acceptedApplications,
            items: (preflight.acceptedApplicationItems ?? []).map((application) => (
                <li key={application.id} className="rounded-lg border border-border bg-card px-3 py-2">
                    <span className="block font-medium text-foreground">
                        {application.roleTitle ?? application.roleName ?? "Accepted role"}
                    </span>
                    <span className="nb-meta text-[11px] text-muted-foreground">Will show Accepted · Membership ended</span>
                </li>
            )),
            empty: "No accepted application history found.",
        },
    ];

    return (
        <details className="rounded-lg border border-border bg-muted/20 p-3">
            <summary className="cursor-pointer nb-micro text-muted-foreground">
                Exact affected records
            </summary>
            <div className="mt-3 space-y-3">
                {sections.map((section) => (
                    <div key={section.key}>
                        <p className="nb-ui-label text-xs font-semibold text-foreground">
                            {section.label} <span className="nb-meta text-muted-foreground">({section.count})</span>
                        </p>
                        {section.items.length > 0 ? (
                            <ul className="mt-2 space-y-1.5 text-xs">{section.items}</ul>
                        ) : (
                            <p className="nb-compact mt-1 text-xs text-muted-foreground">{section.empty}</p>
                        )}
                        {section.count > section.items.length ? (
                            <p className="nb-meta mt-1 text-[11px] text-muted-foreground">
                                Showing the first {section.items.length}; the action still applies to all {section.count}.
                            </p>
                        ) : null}
                    </div>
                ))}
            </div>
        </details>
    );
}

function captureScrollSnapshot(): ScrollSnapshot {
    const routeRoot = typeof document === "undefined"
        ? null
        : document.querySelector<HTMLElement>('[data-scroll-root="route"]');
    const settingsRoot = typeof document === "undefined"
        ? null
        : document.querySelector<HTMLElement>('[data-project-settings-document]');
    return {
        routeRoot,
        routeScrollTop: routeRoot?.scrollTop ?? 0,
        settingsRoot,
        settingsScrollTop: settingsRoot?.scrollTop ?? 0,
        windowScrollX: typeof window === "undefined" ? 0 : window.scrollX,
        windowScrollY: typeof window === "undefined" ? 0 : window.scrollY,
    };
}

function restoreScrollSnapshot(snapshot: ScrollSnapshot | null) {
    if (!snapshot || typeof window === "undefined") return;
    window.requestAnimationFrame(() => {
        if (snapshot.routeRoot) {
            snapshot.routeRoot.scrollTop = snapshot.routeScrollTop;
        }
        if (snapshot.settingsRoot) {
            snapshot.settingsRoot.scrollTop = snapshot.settingsScrollTop;
        }
        window.scrollTo(snapshot.windowScrollX, snapshot.windowScrollY);
    });
}

function projectOwnerId(project: any): string | null {
    return project?.ownerId ?? project?.owner?.id ?? null;
}

function projectMemberRole(member: ProjectSettingsMember, ownerId: string | null) {
    if (member.membershipRole) return member.membershipRole;
    return ownerId && member.id === ownerId ? "owner" : "member";
}

function resetSettingsFromProject(project: any) {
    return {
        visibility: normalizeProjectVisibility(project?.visibility),
        publicTabVisibility: normalizeProjectPublicTabVisibility(project?.publicTabVisibility ?? project?.public_tab_visibility),
        memberUpdatesEnabled: project?.memberUpdatesEnabled ?? project?.member_updates_enabled ?? true,
    };
}

function normalizeStringArray(value: unknown) {
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim().length > 0) : [];
}

function areStringArraysEqual(left: string[], right: string[]) {
    if (left.length !== right.length) return false;
    return left.every((item, index) => item === right[index]);
}

function splitProjectCategory(value: string) {
    const trimmed = value.trim();
    if (!trimmed) return { choice: "", custom: "" };
    if (isKnownProjectType(trimmed)) return { choice: trimmed, custom: "" };
    return { choice: OTHER_PROJECT_TYPE_ID, custom: trimmed };
}

function resolveProjectCategory(choice: string, custom: string) {
    return choice === OTHER_PROJECT_TYPE_ID ? custom.trim() : choice.trim();
}

function resetIdentityFromProject(project: any) {
    const category = typeof project?.category === "string" ? project.category : "";
    const categoryState = splitProjectCategory(category);
    return {
        title: typeof project?.title === "string" ? project.title : "",
        shortDescription:
            typeof project?.shortDescription === "string"
                ? project.shortDescription
                : typeof project?.short_description === "string"
                    ? project.short_description
                    : "",
        description: typeof project?.description === "string" ? project.description : "",
        category,
        categoryChoice: categoryState.choice,
        customCategory: categoryState.custom,
        tags: normalizeStringArray(project?.tags),
        skills: normalizeStringArray(project?.skills),
        coverImage: getProjectCoverImage(project),
    };
}

function getProjectCoverImage(project: any): string {
    const cover = project?.coverImage ?? project?.cover_image ?? project?.coverImageUrl ?? project?.cover_image_url;
    return typeof cover === "string" ? cover.trim() : "";
}

export default function ProjectSettingsTab({
    projectId,
    project,
    onProjectUpdated,
    isProjectOwner,
    actorRole,
    members = [],
    loadingMembers = false,
}: ProjectSettingsTabProps) {
    const router = useRouter();
    const searchParams = useSearchParams();
    const queryClient = useQueryClient();
    const actorProjectRole = isProjectOwner ? "owner" : actorRole ?? "member";
    const canManageSettings = isProjectOwner || actorProjectRole === "admin";
    const sections = useMemo(() => {
        const visible = getVisibleProjectSettingsSections();
        if (isProjectOwner) return visible;
        if (actorProjectRole === "admin") {
            const adminSections: ProjectSettingsSectionId[] = [
                "links",
                "access",
                "collaborators",
                "roles-applications",
                "readme",
                "updates",
                "tasks-workflow",
                "files-workspace",
                "notifications",
                "privacy-policies",
                "privacy-terms",
            ];
            return visible.filter((section) => adminSections.includes(section.id));
        }
        return visible.filter((section) => section.id === "collaborators" || section.id === "privacy-policies" || section.id === "privacy-terms");
    }, [actorProjectRole, isProjectOwner]);
    const [activeSection, setActiveSection] = useState<ProjectSettingsSectionId>(() => {
        const querySection = searchParams.get("settings") || searchParams.get("section");
        if (querySection === "privacy" || querySection === "privacy-terms" || querySection === "privacy-policies") {
            return "privacy-policies";
        }
        if (querySection === "security-audit" || querySection === "security-data") {
            return "general";
        }
        if (querySection && sections.some((s) => s.id === querySection)) {
            return querySection as ProjectSettingsSectionId;
        }
        return canManageSettings && searchParams.get("settings") === "links"
            ? "links"
            : (sections[0]?.id as ProjectSettingsSectionId) || "general";
    });
    const locallyNavigatedSectionRef = useRef<{ id: string } | null>(null);
    const localNavigationReleaseTimerRef = useRef<number | null>(null);
    const hasMountedRef = useRef(false);

    const scrollToSection = useCallback((sectionId: string, behavior: ScrollBehavior = "smooth") => {
        const scrollRoot = document.querySelector<HTMLElement>('[data-scroll-root="route"]');
        const target = document.getElementById(`project-settings-${sectionId}`);
        if (!scrollRoot || !target) return;

        const rootRect = scrollRoot.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const projectTabs = document.querySelector<HTMLElement>('[data-project-sticky-tabs="true"]');
        const stickyTabsHeight = projectTabs?.offsetHeight ?? 0;
        const nextTop = scrollRoot.scrollTop + targetRect.top - rootRect.top - stickyTabsHeight;
        scrollRoot.scrollTo({
            top: Math.max(0, nextTop),
            left: scrollRoot.scrollLeft,
            behavior,
        });
    }, []);

    const handleNavigateSection = useCallback((sectionId: ProjectSettingsSectionId) => {
        const localNav = { id: sectionId };
        locallyNavigatedSectionRef.current = localNav;
        setActiveSection(sectionId);

        if (typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search);
            params.set("tab", "settings");
            params.set("settings", sectionId);
            router.replace(`?${params.toString()}`, { scroll: false });
        }

        scrollToSection(sectionId, "smooth");

        if (localNavigationReleaseTimerRef.current !== null) {
            window.clearTimeout(localNavigationReleaseTimerRef.current);
        }
        localNavigationReleaseTimerRef.current = window.setTimeout(() => {
            if (locallyNavigatedSectionRef.current === localNav) {
                locallyNavigatedSectionRef.current = null;
            }
            localNavigationReleaseTimerRef.current = null;
        }, 800);
    }, [router, scrollToSection]);

    useEffect(() => () => {
        if (localNavigationReleaseTimerRef.current !== null) {
            window.clearTimeout(localNavigationReleaseTimerRef.current);
        }
    }, []);
    const [advancedOpen, setAdvancedOpen] = useState<Partial<Record<ProjectSettingsSectionId, boolean>>>({});
    const [savingSettings, setSavingSettings] = useState(false);
    const [uploadingCoverImage, setUploadingCoverImage] = useState(false);
    const [savingLifecycle, setSavingLifecycle] = useState(false);
    const [confirmLoading, setConfirmLoading] = useState(false);
    const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
    const [dangerPreflight, setDangerPreflight] = useState<DangerPreflight | null>(null);
    const [dangerPreflightLoading, setDangerPreflightLoading] = useState(false);
    const [accessImpact, setAccessImpact] = useState<AccessImpact | null>(null);
    const [accessImpactLoading, setAccessImpactLoading] = useState(false);
    const [transferOwnerId, setTransferOwnerId] = useState("");
    const [archiveModalOpen, setArchiveModalOpen] = useState(false);
    const [transferModalOpen, setTransferModalOpen] = useState(false);
    const [selectedTransferCandidate, setSelectedTransferCandidate] = useState<ProjectSettingsMember | null>(null);
    const [deleteModalOpen, setDeleteModalOpen] = useState(false);
    const [collaboratorData, setCollaboratorData] = useState<CollaboratorSettingsData | null>(null);
    const [collaboratorLoading, setCollaboratorLoading] = useState(false);
    const [collaboratorRefreshing, setCollaboratorRefreshing] = useState(false);
    const [collaboratorLoadingMore, setCollaboratorLoadingMore] = useState(false);
    const [collaboratorFilter, setCollaboratorFilter] = useState<CollaboratorFilter>("all");
    const [collaboratorSearch, setCollaboratorSearch] = useState("");
    const [fileWorkspaceData, setFileWorkspaceData] = useState<FileWorkspaceSettingsData | null>(null);
    const [fileWorkspaceLoading, setFileWorkspaceLoading] = useState(false);
    const [fileWorkspaceSavingMemberId, setFileWorkspaceSavingMemberId] = useState<string | null>(null);
    const [fileWorkspaceBulkSaving, setFileWorkspaceBulkSaving] = useState(false);
    const [projectNotificationData, setProjectNotificationData] = useState<ProjectNotificationSettingsData | null>(null);
    const [projectNotificationDraft, setProjectNotificationDraft] = useState<ProjectNotificationPolicy>(() => buildDefaultProjectNotificationPolicy());
    const [projectNotificationLoading, setProjectNotificationLoading] = useState(false);
    const [expandedNotificationGroups, setExpandedNotificationGroups] = useState<Record<string, boolean>>({});
    const [readmeSettings, setReadmeSettings] = useState<ProjectDocSettings>(() => DEFAULT_PROJECT_DOC_SETTINGS);
    const [readmeSettingsDraft, setReadmeSettingsDraft] = useState<ProjectDocSettings>(() => DEFAULT_PROJECT_DOC_SETTINGS);
    const [readmeSettingsLoading, setReadmeSettingsLoading] = useState(false);
    const [readmeSettingsSaving, setReadmeSettingsSaving] = useState(false);
    const [savingReadmeKey, setSavingReadmeKey] = useState<keyof ProjectDocSettings | null>(null);
    const [savingMemberUpdates, setSavingMemberUpdates] = useState(false);
    const [memberNotificationData, setMemberNotificationData] = useState<MemberNotificationSettingsData | null>(null);
    const [memberNotificationDraft, setMemberNotificationDraft] = useState<ProjectMemberNotificationOverrides>(() => normalizeProjectMemberNotificationOverrides(null));
    const [memberNotificationLoading, setMemberNotificationLoading] = useState(false);
    const [memberNotificationSaving, setMemberNotificationSaving] = useState(false);
    const [removalMode, setRemovalMode] = useState<RemovalMode>("preserve_history");
    const [removalReassignToUserId, setRemovalReassignToUserId] = useState("");
    const [removalPreflightDialog, setRemovalPreflightDialog] = useState<RemovalPreflightData | null>(null);
    const removalModeRef = useRef<RemovalMode>("preserve_history");
    const removalReassignToUserIdRef = useRef("");
    const collaboratorDataRef = useRef<CollaboratorSettingsData | null>(null);

    const initialSettings = useMemo(() => resetSettingsFromProject(project), [project]);
    const initialIdentity = useMemo(() => resetIdentityFromProject(project), [project]);
    const initialRoles = useMemo<ProjectRolesFormValues>(() => {
        const openRoles = normalizeProjectRoleFormValues(project?.openRoles ?? project?.open_roles);
        const metadata = (project?.importSource?.metadata || project?.import_source?.metadata || {}) as any;
        const leadFocus = typeof metadata.leadFocus === "string" ? metadata.leadFocus.trim() : "";

        // ponytail: skip duplicate lead-role when open roles already define the lead focus
        const leadHasOpenRole = Boolean(leadFocus) && openRoles.some(
            (r) => (r.role || "").trim().toLowerCase() === leadFocus.toLowerCase()
        );

        if (leadHasOpenRole) {
            return { roles: openRoles };
        }

        const leadRole: ProjectRoleFormValue = {
            id: "lead-role",
            role: leadFocus || "Lead",
            count: 1,
            description: metadata.leadDescription || "",
            skills: [],
        };
        return {
            roles: [leadRole, ...openRoles],
        };
    }, [project]);
    const [visibility, setVisibility] = useState<ProjectSettingsVisibility>(initialSettings.visibility);
    const [publicTabVisibility, setPublicTabVisibility] = useState<ProjectPublicTabVisibility>(initialSettings.publicTabVisibility);
    const [savedVisibility, setSavedVisibility] = useState<ProjectSettingsVisibility>(initialSettings.visibility);
    const [savedPublicTabVisibility, setSavedPublicTabVisibility] = useState<ProjectPublicTabVisibility>(initialSettings.publicTabVisibility);
    const [savingPublicTabId, setSavingPublicTabId] = useState<ProjectPublicTabId | null>(null);
    const [memberUpdatesEnabled, setMemberUpdatesEnabled] = useState<boolean>(initialSettings.memberUpdatesEnabled);
    const [projectTitle, setProjectTitle] = useState(initialIdentity.title);
    const [shortDescription, setShortDescription] = useState(initialIdentity.shortDescription);
    const [description, setDescription] = useState(initialIdentity.description);
    const [categoryChoice, setCategoryChoice] = useState(initialIdentity.categoryChoice);
    const [customCategory, setCustomCategory] = useState(initialIdentity.customCategory);
    const [tags, setTags] = useState<string[]>(initialIdentity.tags);
    const [skills, setSkills] = useState<string[]>(initialIdentity.skills);
    const [coverImage, setCoverImage] = useState(initialIdentity.coverImage);
    const [coverDraft, setCoverDraft] = useState<CoverDraft | null>(null);
    const [deletedRoleIds, setDeletedRoleIds] = useState<string[]>([]);
    const projectImageDragRef = useRef<ProjectImageDragState | null>(null);
    const coverInputRef = useRef<HTMLInputElement | null>(null);
    const filePickerScrollSnapshotRef = useRef<ScrollSnapshot | null>(null);
    const {
        register: registerRoles,
        control: rolesControl,
        handleSubmit: handleRolesSubmit,
        reset: resetRolesForm,
        formState: { errors: roleErrors, isDirty: rolesFormDirty },
    } = useForm<ProjectRolesFormValues>({
        resolver: zodResolver(projectRoleSettingsSchema),
        defaultValues: initialRoles,
    });
    const { fields: roleFields, append: appendRole, remove: removeRole } = useFieldArray({
        control: rolesControl,
        name: "roles",
        keyName: "fieldKey",
    });

    useEffect(() => {
        setVisibility(initialSettings.visibility);
        setPublicTabVisibility(initialSettings.publicTabVisibility);
        setSavedVisibility(initialSettings.visibility);
        setSavedPublicTabVisibility(initialSettings.publicTabVisibility);
        setMemberUpdatesEnabled(initialSettings.memberUpdatesEnabled);
    }, [initialSettings]);

    useEffect(() => {
        resetRolesForm(initialRoles);
        setDeletedRoleIds([]);
    }, [initialRoles, resetRolesForm]);

    useEffect(() => {
        collaboratorDataRef.current = collaboratorData;
    }, [collaboratorData]);

    useEffect(() => {
        removalModeRef.current = removalMode;
    }, [removalMode]);

    useEffect(() => {
        removalReassignToUserIdRef.current = removalReassignToUserId;
    }, [removalReassignToUserId]);

    useEffect(() => {
        setProjectTitle(initialIdentity.title);
        setShortDescription(initialIdentity.shortDescription);
        setDescription(initialIdentity.description);
        setCategoryChoice(initialIdentity.categoryChoice);
        setCustomCategory(initialIdentity.customCategory);
        setTags(initialIdentity.tags);
        setSkills(initialIdentity.skills);
        setCoverImage(initialIdentity.coverImage);
    }, [initialIdentity]);

    useEffect(() => {
        const querySection = searchParams.get("settings") || searchParams.get("section");
        const targetSection = querySection === "privacy" || querySection === "privacy-terms" || querySection === "privacy-policies"
            ? "privacy-policies"
            : querySection === "security-audit" || querySection === "security-data"
                ? "general"
                : querySection && sections.some((s) => s.id === querySection)
                    ? (querySection as ProjectSettingsSectionId)
                    : null;

        if (locallyNavigatedSectionRef.current?.id === targetSection) {
            hasMountedRef.current = true;
            return;
        }

        const isInitialMount = !hasMountedRef.current;
        hasMountedRef.current = true;

        let cancelFrame: (() => void) | undefined;
        if (targetSection && targetSection !== "general") {
            const frame = window.requestAnimationFrame(() => {
                scrollToSection(targetSection, isInitialMount ? "auto" : "smooth");
            });
            cancelFrame = () => window.cancelAnimationFrame(frame);
        } else if (isInitialMount && (!querySection || querySection === "general")) {
            const routeRoot = document.querySelector<HTMLElement>('[data-scroll-root="route"]');
            routeRoot?.scrollTo({ top: 0, left: routeRoot.scrollLeft, behavior: "auto" });
        }
        return cancelFrame;
    }, [searchParams, sections, scrollToSection]);

    useEffect(() => {
        const root = document.querySelector<HTMLElement>('[data-scroll-root="route"]');
        if (!root) return;
        let rafId = 0;
        const updateActiveSection = () => {
            if (locallyNavigatedSectionRef.current) return;
            if (rafId) return;
            rafId = window.requestAnimationFrame(() => {
                rafId = 0;
                const rootTop = root.getBoundingClientRect().top;
                const projectTabs = document.querySelector<HTMLElement>('[data-project-sticky-tabs="true"]');
                const contentTop = rootTop + (projectTabs?.offsetHeight ?? 0);
                let closest = sections[sections.length - 1]?.id ?? "general";
                let distance = Number.POSITIVE_INFINITY;
                for (const section of sections) {
                    const el = document.getElementById(`project-settings-${section.id}`);
                    if (!el) continue;
                    const rect = el.getBoundingClientRect();
                    if (rect.bottom <= contentTop + 16) continue;
                    const nextDistance = Math.abs(rect.top - contentTop);
                    if (nextDistance < distance) {
                        closest = section.id;
                        distance = nextDistance;
                    }
                }
                setActiveSection((prev) => (prev === closest ? prev : closest));
            });
        };
        updateActiveSection();
        root.addEventListener("scroll", updateActiveSection, { passive: true });
        return () => {
            root.removeEventListener("scroll", updateActiveSection);
            if (rafId) window.cancelAnimationFrame(rafId);
        };
    }, [sections]);

    useEffect(() => {
        if (sections.some((section) => section.id === activeSection)) return;
        setActiveSection(sections[0]?.id ?? "collaborators");
    }, [activeSection, sections]);

    useEffect(() => {
        return () => {
            if (coverDraft?.previewUrl) {
                URL.revokeObjectURL(coverDraft.previewUrl);
            }
        };
    }, [coverDraft?.previewUrl]);

    const restoreFilePickerScroll = useCallback(() => {
        restoreScrollSnapshot(filePickerScrollSnapshotRef.current);
    }, []);

    useEffect(() => {
        const handleWindowFocus = () => {
            if (!filePickerScrollSnapshotRef.current) return;
            restoreFilePickerScroll();
            window.setTimeout(() => {
                restoreFilePickerScroll();
                filePickerScrollSnapshotRef.current = null;
            }, 120);
        };
        window.addEventListener("focus", handleWindowFocus);
        return () => window.removeEventListener("focus", handleWindowFocus);
    }, [restoreFilePickerScroll]);

    const ownerId = projectOwnerId(project);
    const accessPolicy = useMemo(() => buildProjectAccessPolicy({ visibility }), [visibility]);
    const accessImpactPolicy = useMemo(
        () => buildProjectAccessImpact({
            visibility,
            membersCount: accessImpact?.membersCount ?? members.length,
            followersCount: accessImpact?.followersCount ?? project?.followersCount ?? project?.followers_count ?? 0,
            openRolesCount: accessImpact?.openRolesCount ?? project?.openRoles?.length ?? project?.open_roles?.length ?? 0,
            pendingApplicationsCount: accessImpact?.pendingApplicationsCount ?? 0,
            activeTasksCount: accessImpact?.activeTasksCount ?? 0,
        }),
        [accessImpact, members.length, project?.followersCount, project?.followers_count, project?.openRoles?.length, project?.open_roles?.length, visibility],
    );
    const collaboratorMembers = collaboratorData?.members ?? members;
    const rolePolicy = useMemo(
        () => buildProjectRolePolicy({ isOwner: isProjectOwner, actorRole: actorProjectRole, ownerId, members: collaboratorMembers }),
        [actorProjectRole, collaboratorMembers, isProjectOwner, ownerId],
    );
    const filteredCollaborators = useMemo(() => {
        return rolePolicy.members.filter((member) => projectMemberRole(member, ownerId) !== "owner");
    }, [ownerId, rolePolicy.members]);
    const notificationSummary = useMemo(() => summarizeProjectNotificationPolicy(projectNotificationDraft), [projectNotificationDraft]);
    const notificationGroups = useMemo(() => groupProjectNotificationEntries(), []);
    const toggleNotificationGroup = useCallback((groupId: string) => {
        setExpandedNotificationGroups((prev) => ({
            ...prev,
            [groupId]: !prev[groupId],
        }));
    }, []);
    const areAllNotificationGroupsExpanded = useMemo(() => {
        return notificationGroups.length > 0 && notificationGroups.every((g) => expandedNotificationGroups[g.id]);
    }, [notificationGroups, expandedNotificationGroups]);
    const toggleAllNotificationGroups = useCallback(() => {
        if (areAllNotificationGroupsExpanded) {
            setExpandedNotificationGroups({});
        } else {
            const next: Record<string, boolean> = {};
            for (const g of notificationGroups) {
                next[g.id] = true;
            }
            setExpandedNotificationGroups(next);
        }
    }, [areAllNotificationGroupsExpanded, notificationGroups]);
    const filePolicy = useMemo(() => buildProjectFilePolicy(), []);
    const preflightPolicy = useMemo(() => buildProjectSettingsPreflight(dangerPreflight), [dangerPreflight]);

    const visibilityDirty = visibility !== savedVisibility;
    const publicTabVisibilityDirty = !areProjectPublicTabVisibilitiesEqual(publicTabVisibility, savedPublicTabVisibility);
    const accessDirty = visibilityDirty || publicTabVisibilityDirty;
    const categoryValue = resolveProjectCategory(categoryChoice, customCategory);
    const identityDirty =
        projectTitle !== initialIdentity.title ||
        shortDescription !== initialIdentity.shortDescription ||
        description !== initialIdentity.description ||
        categoryValue !== initialIdentity.category ||
        !areStringArraysEqual(tags, initialIdentity.tags) ||
        !areStringArraysEqual(skills, initialIdentity.skills);
    const rolesDirty = rolesFormDirty || deletedRoleIds.length > 0;
    const notificationDirty = JSON.stringify(projectNotificationDraft) !== JSON.stringify(projectNotificationData?.policy ?? buildDefaultProjectNotificationPolicy());
    const readmeDirty = JSON.stringify(readmeSettingsDraft) !== JSON.stringify(readmeSettings);
    const updatesDirty = memberUpdatesEnabled !== initialSettings.memberUpdatesEnabled;
    const sectionDirty =
        activeSection === "general"
            ? identityDirty
            : activeSection === "access"
                ? accessDirty
                : activeSection === "roles-applications"
                    ? rolesDirty
                    : activeSection === "readme"
                        ? readmeDirty
                        : activeSection === "notifications"
                            ? notificationDirty
                            : activeSection === "updates"
                                ? updatesDirty
                                : false;

    const dangerPreflightLoadedRef = useRef(false);
    const loadDangerPreflight = useCallback(async (force = false, pending?: ReturnType<typeof getProjectDangerZonePreflightAction>) => {
        if (dangerPreflightLoadedRef.current && !force) return;
        setDangerPreflightLoading(true);
        try {
            const result = await (pending ?? getProjectDangerZonePreflightAction(projectId));
            if (!result.success) {
                setDangerPreflight(null);
                toast.error(result.message);
                return;
            }
            dangerPreflightLoadedRef.current = true;
            setDangerPreflight(result.data);
        } catch (error) {
            console.error("Failed to load danger-zone preflight", error);
            setDangerPreflight(null);
            toast.error("Failed to load danger-zone checks.");
        } finally {
            setDangerPreflightLoading(false);
        }
    }, [projectId]);

    const accessImpactLoadedRef = useRef(false);
    const loadAccessImpact = useCallback(async (force = false, pending?: ReturnType<typeof getProjectAccessImpactAction>) => {
        if (accessImpactLoadedRef.current && !force) return;
        setAccessImpactLoading(true);
        try {
            const result = await (pending ?? getProjectAccessImpactAction(projectId));
            if (!result.success) {
                setAccessImpact(null);
                toast.error(result.message);
                return;
            }
            accessImpactLoadedRef.current = true;
            setAccessImpact(result.data);
        } catch (error) {
            console.error("Failed to load access impact", error);
            setAccessImpact(null);
            toast.error("Failed to load access impact.");
        } finally {
            setAccessImpactLoading(false);
        }
    }, [projectId]);

    const loadCollaborators = useCallback(async (mode: "initial" | "refresh" | "more" = "initial", pending?: ReturnType<typeof getProjectCollaboratorSettingsAction>) => {
        const cursor = mode === "more" ? collaboratorDataRef.current?.nextCursor ?? undefined : undefined;
        if (mode === "refresh") {
            setCollaboratorRefreshing(true);
        } else if (mode === "more") {
            if (!cursor) return;
            setCollaboratorLoadingMore(true);
        } else {
            // ponytail: keep warm data mounted without layout shift; only show skeletons on cold mount
            if (!collaboratorDataRef.current) {
                setCollaboratorLoading(true);
            } else {
                setCollaboratorRefreshing(true);
            }
        }
        try {
            const result = await (pending ?? getProjectCollaboratorSettingsAction(projectId, {
                limit: 40,
                cursor,
                query: collaboratorSearch,
                roleFilter: collaboratorFilter,
            }));
            if (!result.success) {
                setCollaboratorData(null);
                toast.error(result.message);
                return;
            }
            setCollaboratorData((current) => {
                if (mode !== "more" || !current) return result.data;
                const existingIds = new Set(current.members.map((member) => member.id));
                return {
                    ...result.data,
                    members: [
                        ...current.members,
                        ...result.data.members.filter((member) => !existingIds.has(member.id)),
                    ],
                    roleCounts: result.data.roleCounts,
                };
            });
        } catch (error) {
            console.error("Failed to load collaborators", error);
            setCollaboratorData(null);
            toast.error("Failed to load collaborators.");
        } finally {
            setCollaboratorLoading(false);
            setCollaboratorRefreshing(false);
            setCollaboratorLoadingMore(false);
        }
    }, [collaboratorFilter, collaboratorSearch, projectId]);

    const fileWorkspaceLoadedRef = useRef(false);
    const loadFileWorkspaceSettings = useCallback(async (force = false, pending?: ReturnType<typeof getProjectFileWorkspaceSettingsAction>) => {
        if (fileWorkspaceLoadedRef.current && !force) return;
        setFileWorkspaceLoading(true);
        try {
            const result = await (pending ?? getProjectFileWorkspaceSettingsAction(projectId));
            if (!result.success) {
                setFileWorkspaceData(null);
                toast.error(result.message);
                return;
            }
            fileWorkspaceLoadedRef.current = true;
            setFileWorkspaceData(result.data);
        } catch (error) {
            console.error("Failed to load file workspace settings", error);
            setFileWorkspaceData(null);
            toast.error("Failed to load file workspace settings.");
        } finally {
            setFileWorkspaceLoading(false);
        }
    }, [projectId]);

    const projectNotificationLoadedRef = useRef(false);
    const loadProjectNotificationSettings = useCallback(async (force = false, pending?: ReturnType<typeof readProjectNotificationSettingsAction>) => {
        if (projectNotificationLoadedRef.current && !force) return;
        setProjectNotificationLoading(true);
        try {
            const result = await (pending ?? readProjectNotificationSettingsAction(projectId));
            if (!result.success) {
                setProjectNotificationData(null);
                toast.error(result.message);
                return;
            }
            projectNotificationLoadedRef.current = true;
            setProjectNotificationData(result.data);
            setProjectNotificationDraft(result.data.policy);
        } catch (error) {
            console.error("Failed to load project notification settings", error);
            setProjectNotificationData(null);
            toast.error("Failed to load project notification settings.");
        } finally {
            setProjectNotificationLoading(false);
        }
    }, [projectId]);

    const readmeLoadedRef = useRef(false);
    const loadReadmeSettings = useCallback(async (force = false, pending?: ReturnType<typeof readProjectDocSettingsAction>) => {
        if (readmeLoadedRef.current && !force) return;
        setReadmeSettingsLoading(true);
        try {
            const result = await (pending ?? readProjectDocSettingsAction(projectId));
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            readmeLoadedRef.current = true;
            const normalized = normalizeProjectDocSettings(result.settings);
            setReadmeSettings(normalized);
            setReadmeSettingsDraft(normalized);
        } catch (error) {
            console.error("Failed to load document settings", error);
            toast.error("Failed to load document settings.");
        } finally {
            setReadmeSettingsLoading(false);
        }
    }, [projectId]);

    const bootstrappedProjectRef = useRef<string | null>(null);
    useEffect(() => {
        if (bootstrappedProjectRef.current === projectId) return;
        bootstrappedProjectRef.current = projectId;
        const bootstrap = readProjectSettingsBootstrapAction(projectId, {
            limit: 40,
            query: collaboratorSearch,
            roleFilter: collaboratorFilter,
        });
        void loadCollaborators("initial", bootstrap.then((data) => data.collaboratorSettings));
        void loadFileWorkspaceSettings(false, bootstrap.then((data) => data.fileWorkspace));
        void loadProjectNotificationSettings(false, bootstrap.then((data) => data.notifications));
        void loadReadmeSettings(false, bootstrap.then((data) => data.docSettings));
        void loadAccessImpact(false, bootstrap.then((data) => data.accessImpact));
        void loadDangerPreflight(false, bootstrap.then((data) => data.dangerPreflight));
    }, [collaboratorFilter, collaboratorSearch, loadAccessImpact, loadCollaborators, loadDangerPreflight, loadFileWorkspaceSettings, loadProjectNotificationSettings, loadReadmeSettings, projectId]);

    // Re-fetch collaborators only when search or filter genuinely changes (debounced)
    const initialCollaboratorFilterRef = useRef(false);
    useEffect(() => {
        if (!initialCollaboratorFilterRef.current) {
            initialCollaboratorFilterRef.current = true;
            return;
        }
        const timer = window.setTimeout(() => {
            void loadCollaborators("initial");
        }, 180);
        return () => window.clearTimeout(timer);
    }, [collaboratorFilter, collaboratorSearch, loadCollaborators]);

    const saveAccessSettings = useCallback(async (confirmationToken: string) => {
        const messages: string[] = [];
        if (visibilityDirty) {
            const result = await updateProjectVisibilityAction(projectId, visibility, confirmationToken);
            if (!result.success) {
                return { success: false, message: result.message };
            }
            messages.push(result.message);
        }
        if (publicTabVisibilityDirty) {
            const result = await updateProjectPublicTabVisibilityAction(projectId, publicTabVisibility);
            if (!result.success) {
                return { success: false, message: result.message };
            }
            messages.push(result.message);
        }
        setSavedVisibility(visibility);
        setSavedPublicTabVisibility(publicTabVisibility);
        return { success: true, message: messages.join(" ") || "Access settings updated.", refresh: true };
    }, [projectId, publicTabVisibility, publicTabVisibilityDirty, visibility, visibilityDirty]);

    const handleSaveAccess = useCallback(async () => {
        if (!accessDirty) return;

        setSavingSettings(true);
        try {
            if (!visibilityDirty) {
                const result = await updateProjectPublicTabVisibilityAction(projectId, publicTabVisibility);
                if (!result.success) {
                    toast.error(result.message);
                    return;
                }
                toast.success(result.message);
                const nextSaved = result.data ? normalizeProjectPublicTabVisibility(result.data) : publicTabVisibility;
                setPublicTabVisibility(nextSaved);
                setSavedPublicTabVisibility(nextSaved);
                onProjectUpdated();
                router.refresh();
                return;
            }
            const preflightResult = await getProjectAccessTransitionPreflightAction(projectId, visibility);
            if (!preflightResult.success) {
                toast.error(preflightResult.message);
                return;
            }
            const preflight: AccessTransitionPreflightData = preflightResult.data;
            const isPrivateTransition = preflight.nextVisibility === "private";
            setConfirmAction({
                title: isPrivateTransition ? "Make project private" : "Make project public",
                description: preflight.policy.confirmationSummary.join(" "),
                confirmLabel: isPrivateTransition ? "Make private" : "Make public",
                variant: isPrivateTransition ? "destructive" : "default",
                content: <AccessTransitionDetails preflight={preflight} />,
                action: () => saveAccessSettings(preflight.confirmationToken),
            });
            return;
        } catch (error) {
            console.error("Failed to prepare access transition", error);
            toast.error("Failed to prepare access transition.");
        } finally {
            setSavingSettings(false);
        }
    }, [accessDirty, onProjectUpdated, projectId, publicTabVisibility, router, saveAccessSettings, visibility, visibilityDirty]);

    const handleSaveGeneral = useCallback(async () => {
        const trimmedTitle = projectTitle.trim();
        if (!trimmedTitle) {
            toast.error("Project name cannot be empty.");
            return;
        }
        const nextCategory = resolveProjectCategory(categoryChoice, customCategory);
        if (categoryChoice === OTHER_PROJECT_TYPE_ID && !nextCategory) {
            toast.error("Add a custom category or choose one from the dropdown.");
            return;
        }
        setSavingSettings(true);
        try {
            const identityResult = await updateProject(projectId, {
                title: trimmedTitle,
                shortDescription: shortDescription.trim() || null,
                description: description.trim() || null,
                category: nextCategory || null,
                tags,
                skills,
            });
            if (!identityResult?.success) {
                toast.error("Failed to update project identity.");
                return;
            }

            toast.success("General settings updated.");
            onProjectUpdated();
            broadcastProjectUpdated(projectId);
            void queryClient.invalidateQueries({ queryKey: queryKeys.discover.projectsSimpleRoot() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.discover.projectsRoot() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.globalSearch.discoverRoot() });
            router.refresh();
        } catch (error) {
            console.error("Failed to save general project settings", error);
            toast.error(error instanceof Error ? error.message : "Failed to save general settings.");
        } finally {
            setSavingSettings(false);
        }
    }, [
        categoryChoice,
        customCategory,
        description,
        onProjectUpdated,
        projectId,
        projectTitle,
        router,
        shortDescription,
        skills,
        tags,
    ]);

    const handleAddSettingsRole = useCallback(() => {
        appendRole({ role: "New Role", count: 1, description: "", skills: [] });
    }, [appendRole]);

    const handleRemoveSettingsRole = useCallback((index: number, roleId?: string) => {
        if (roleId) {
            setDeletedRoleIds((current) => current.includes(roleId) ? current : [...current, roleId]);
        }
        removeRole(index);
    }, [removeRole]);

    const handleCancelRoles = useCallback(() => {
        resetRolesForm(initialRoles);
        setDeletedRoleIds([]);
    }, [initialRoles, resetRolesForm]);

    const handleSaveRoles = useCallback(() => {
        void handleRolesSubmit(
            async (values) => {
                setSavingSettings(true);
                try {
                    const result = await updateProject(projectId, {
                        roles: values.roles,
                        deletedRoleIds,
                    });
                    if (!result?.success) {
                        toast.error("Failed to update project roles.");
                        return;
                    }

                    const leadRole = values.roles.find((r) => r.id === "lead-role");
                    const nextOpenRoles = normalizeProjectRoleFormValues((result as { openRoles?: unknown }).openRoles);
                    const nextRoles = leadRole ? [leadRole, ...nextOpenRoles] : nextOpenRoles;
                    resetRolesForm({ roles: nextRoles });
                    setDeletedRoleIds([]);
                    toast.success("Project roles updated.");
                    onProjectUpdated();
                    router.refresh();
                } catch (error) {
                    console.error("Failed to save project roles", error);
                    toast.error(error instanceof Error ? error.message : "Failed to update project roles.");
                } finally {
                    setSavingSettings(false);
                }
            },
            () => {
                toast.error("Fix role fields before saving.");
            },
        )();
    }, [deletedRoleIds, handleRolesSubmit, onProjectUpdated, projectId, resetRolesForm, router]);

    const handleTogglePublicTab = useCallback(async (tabId: ProjectPublicTabId, enabled: boolean) => {
        const previous = publicTabVisibility;
        const next: ProjectPublicTabVisibility = {
            ...previous,
            [tabId]: enabled,
        };
        // Optimistically apply immediately in memory
        setPublicTabVisibility(next);
        setSavedPublicTabVisibility(next);
        setSavingPublicTabId(tabId);

        try {
            const result = await updateProjectPublicTabVisibilityAction(projectId, next);
            if (!result.success) {
                // Rollback on failure
                setPublicTabVisibility(previous);
                setSavedPublicTabVisibility(previous);
                toast.error(result.message);
                return;
            }
            toast.success(`${PROJECT_PUBLIC_TAB_LABELS[tabId]} visibility updated.`);
            onProjectUpdated();
            router.refresh();
        } catch (error) {
            setPublicTabVisibility(previous);
            setSavedPublicTabVisibility(previous);
            console.error("Failed to update public tab visibility", error);
            toast.error("Failed to update tab visibility.");
        } finally {
            setSavingPublicTabId(null);
        }
    }, [onProjectUpdated, projectId, publicTabVisibility, router]);

    const handleSelectVisibility = useCallback(async (nextVisibility: ProjectSettingsVisibility) => {
        if (nextVisibility === visibility) return;
        setSavingSettings(true);
        try {
            const preflightResult = await getProjectAccessTransitionPreflightAction(projectId, nextVisibility);
            if (!preflightResult.success) {
                toast.error(preflightResult.message);
                return;
            }
            const preflight: AccessTransitionPreflightData = preflightResult.data;
            const isPrivateTransition = preflight.nextVisibility === "private";
            setConfirmAction({
                title: isPrivateTransition ? "Make project private" : "Make project public",
                description: preflight.policy.confirmationSummary.join(" "),
                confirmLabel: isPrivateTransition ? "Make private" : "Make public",
                variant: isPrivateTransition ? "destructive" : "default",
                content: <AccessTransitionDetails preflight={preflight} />,
                action: async () => {
                    const result = await updateProjectVisibilityAction(projectId, nextVisibility, preflight.confirmationToken);
                    if (!result.success) {
                        return { success: false, message: result.message };
                    }
                    setVisibility(nextVisibility);
                    setSavedVisibility(nextVisibility);
                    return { success: true, message: result.message, refresh: true };
                },
            });
        } catch (error) {
            console.error("Failed to prepare access transition", error);
            toast.error("Failed to prepare access transition.");
        } finally {
            setSavingSettings(false);
        }
    }, [onProjectUpdated, projectId, router, visibility]);

    const handleToggleMemberFileUpload = useCallback(async (member: FileWorkspaceSettingsData["members"][number], enabled: boolean) => {
        if (member.uploadPermissionLocked) return;
        setFileWorkspaceSavingMemberId(member.id);
        const previousData = fileWorkspaceData;
        if (previousData) {
            const nextMembers = previousData.members.map((m) => {
                if (m.id === member.id) {
                    return { ...m, fileUploadEnabled: enabled };
                }
                return m;
            });
            const enabledMemberCount = nextMembers.filter((m) => !m.uploadPermissionLocked && m.fileUploadEnabled).length;
            const disabledMemberCount = nextMembers.filter((m) => !m.uploadPermissionLocked && !m.fileUploadEnabled).length;
            setFileWorkspaceData({
                ...previousData,
                members: nextMembers,
                summary: {
                    ...previousData.summary,
                    enabledMemberCount,
                    disabledMemberCount,
                },
            });
        }
        try {
            const result = await updateProjectMemberFileUploadAction(projectId, member.id, enabled);
            if (!result.success) {
                if (previousData) setFileWorkspaceData(previousData);
                toast.error(result.message);
                return;
            }
            toast.success(result.message);
        } catch (error) {
            if (previousData) setFileWorkspaceData(previousData);
            console.error("Failed to update file upload permission", error);
            toast.error("Failed to update file upload permission.");
        } finally {
            setFileWorkspaceSavingMemberId(null);
        }
    }, [fileWorkspaceData, projectId]);

    const handleBulkFileUploadPermission = useCallback(async (enabled: boolean) => {
        setFileWorkspaceBulkSaving(true);
        const previousData = fileWorkspaceData;
        if (previousData) {
            const nextMembers = previousData.members.map((m) => {
                if (!m.uploadPermissionLocked) {
                    return { ...m, fileUploadEnabled: enabled };
                }
                return m;
            });
            const enabledMemberCount = enabled ? nextMembers.filter((m) => !m.uploadPermissionLocked).length : 0;
            const disabledMemberCount = enabled ? 0 : nextMembers.filter((m) => !m.uploadPermissionLocked).length;
            setFileWorkspaceData({
                ...previousData,
                members: nextMembers,
                summary: {
                    ...previousData.summary,
                    enabledMemberCount,
                    disabledMemberCount,
                },
            });
        }
        try {
            const result = await updateProjectFileUploadDefaultsAction(projectId, enabled);
            if (!result.success) {
                if (previousData) setFileWorkspaceData(previousData);
                toast.error(result.message);
                return;
            }
            toast.success(result.message);
        } catch (error) {
            if (previousData) setFileWorkspaceData(previousData);
            console.error("Failed to update file upload defaults", error);
            toast.error("Failed to update file upload defaults.");
        } finally {
            setFileWorkspaceBulkSaving(false);
        }
    }, [fileWorkspaceData, projectId]);

    const handleProjectNotificationPreset = useCallback((preset: ProjectNotificationPreset) => {
        setProjectNotificationDraft(buildDefaultProjectNotificationPolicy(preset));
    }, []);

    const handleProjectNotificationToggle = useCallback((eventKey: ProjectNotificationEventKey, enabled: boolean) => {
        setProjectNotificationDraft((current) => {
            const normalized = normalizeProjectNotificationPolicy(current);
            const entryDecision = resolveProjectNotificationDecision({ eventKey, projectPolicy: normalized });
            if (entryDecision.mandatory) return normalized;
            return {
                ...normalized,
                rules: {
                    ...normalized.rules,
                    [eventKey]: {
                        ...normalized.rules[eventKey],
                        enabled,
                    },
                },
            };
        });
    }, []);

    const handleSaveNotifications = useCallback(async () => {
        setSavingSettings(true);
        try {
            const result = await updateProjectNotificationSettingsAction(projectId, projectNotificationDraft);
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            setProjectNotificationData(result.data);
            setProjectNotificationDraft(result.data.policy);
            toast.success(result.message ?? "Project notification settings updated.");
        } catch (error) {
            console.error("Failed to save project notification settings", error);
            toast.error("Failed to save project notification settings.");
        } finally {
            setSavingSettings(false);
        }
    }, [projectId, projectNotificationDraft]);

    const handleSaveReadmeSettings = useCallback(async () => {
        setReadmeSettingsSaving(true);
        try {
            const result = await updateProjectDocSettingsAction(projectId, readmeSettingsDraft);
            if (!result.success) {
                toast.error(result.error);
                return;
            }
            const normalized = normalizeProjectDocSettings(result.settings);
            setReadmeSettings(normalized);
            setReadmeSettingsDraft(normalized);
            toast.success("Document settings updated.");
            onProjectUpdated();
        } catch (error) {
            console.error("Failed to save document settings", error);
            toast.error("Failed to save document settings.");
        } finally {
            setReadmeSettingsSaving(false);
        }
    }, [onProjectUpdated, projectId, readmeSettingsDraft]);

    const handleToggleReadmeSetting = useCallback(async (key: keyof ProjectDocSettings, enabled: boolean) => {
        const previous = readmeSettingsDraft;
        const next: ProjectDocSettings = {
            ...previous,
            [key]: enabled,
        };
        setReadmeSettingsDraft(next);
        setReadmeSettings(next);
        setSavingReadmeKey(key);

        try {
            const result = await updateProjectDocSettingsAction(projectId, next);
            if (!result.success) {
                setReadmeSettingsDraft(previous);
                setReadmeSettings(previous);
                toast.error(result.error || "Failed to update document setting.");
                return;
            }
            const normalized = normalizeProjectDocSettings(result.settings);
            setReadmeSettings(normalized);
            setReadmeSettingsDraft(normalized);
            toast.success("Document setting updated.");
            onProjectUpdated();
        } catch (error) {
            setReadmeSettingsDraft(previous);
            setReadmeSettings(previous);
            console.error("Failed to save document setting", error);
            toast.error("Failed to save document setting.");
        } finally {
            setSavingReadmeKey(null);
        }
    }, [onProjectUpdated, projectId, readmeSettingsDraft]);

    const handleResetNotifications = useCallback(async () => {
        setSavingSettings(true);
        try {
            const result = await resetProjectNotificationSettingsAction(projectId, "balanced");
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            setProjectNotificationData(result.data);
            setProjectNotificationDraft(result.data.policy);
            toast.success(result.message ?? "Project notification settings reset.");
        } catch (error) {
            console.error("Failed to reset project notification settings", error);
            toast.error("Failed to reset project notification settings.");
        } finally {
            setSavingSettings(false);
        }
    }, [projectId]);

    const openMemberNotificationSettings = useCallback(async (member: ProjectSettingsMember) => {
        setMemberNotificationData(null);
        setMemberNotificationDraft(normalizeProjectMemberNotificationOverrides(null));
        setMemberNotificationLoading(true);
        setConfirmAction({
            title: "Member notification settings",
            description: `Review ${getProjectMemberDisplayName(member)}'s project notification preferences.`,
            confirmLabel: "Close",
            variant: "default",
            action: async () => ({ success: true, message: "Notification settings closed." }),
        });
        try {
            const result = await readProjectMemberNotificationSettingsAction(projectId, member.id);
            if (!result.success) {
                toast.error(result.message);
                setConfirmAction(null);
                return;
            }
            setMemberNotificationData(result.data);
            setMemberNotificationDraft(result.data.overrides);
        } catch (error) {
            console.error("Failed to load member notification settings", error);
            toast.error("Failed to load member notification settings.");
            setConfirmAction(null);
        } finally {
            setMemberNotificationLoading(false);
        }
    }, [projectId]);

    const handleSaveMemberNotifications = useCallback(async () => {
        if (!memberNotificationData) return;
        setMemberNotificationSaving(true);
        try {
            const result = await updateProjectMemberNotificationSettingsAction(projectId, memberNotificationData.member.id, memberNotificationDraft);
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            setMemberNotificationData(result.data);
            setMemberNotificationDraft(result.data.overrides);
            toast.success(result.message ?? "Member notification preferences updated.");
        } catch (error) {
            console.error("Failed to save member notification settings", error);
            toast.error("Failed to save member notification settings.");
        } finally {
            setMemberNotificationSaving(false);
        }
    }, [memberNotificationData, memberNotificationDraft, projectId]);

    const handleResetMemberNotifications = useCallback(async () => {
        if (!memberNotificationData) return;
        setMemberNotificationSaving(true);
        try {
            const result = await resetProjectMemberNotificationSettingsAction(projectId, memberNotificationData.member.id);
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            setMemberNotificationData(result.data);
            setMemberNotificationDraft(result.data.overrides);
            toast.success(result.message ?? "Member notification preferences reset.");
        } catch (error) {
            console.error("Failed to reset member notification settings", error);
            toast.error("Failed to reset member notification settings.");
        } finally {
            setMemberNotificationSaving(false);
        }
    }, [memberNotificationData, projectId]);

    const handleSaveUpdatesSettings = useCallback(async () => {
        setSavingSettings(true);
        try {
            const result = await updateProject(projectId, {
                memberUpdatesEnabled,
            });
            if (!result?.success) {
                toast.error("Failed to update updates settings.");
                return;
            }
            toast.success("Updates settings updated.");
            onProjectUpdated();
            router.refresh();
        } catch (error) {
            console.error("Failed to save updates settings", error);
            toast.error(error instanceof Error ? error.message : "Failed to save updates settings.");
        } finally {
            setSavingSettings(false);
        }
    }, [memberUpdatesEnabled, onProjectUpdated, projectId, router]);

    const handleToggleMemberUpdates = useCallback(async (enabled: boolean) => {
        const previous = memberUpdatesEnabled;
        setMemberUpdatesEnabled(enabled);
        setSavingMemberUpdates(true);

        try {
            const result = await updateProject(projectId, {
                memberUpdatesEnabled: enabled,
            });
            if (!result?.success) {
                setMemberUpdatesEnabled(previous);
                toast.error("Failed to update member publishing permissions.");
                return;
            }
            toast.success("Member publishing permissions updated.");
            onProjectUpdated();
            router.refresh();
        } catch (error) {
            setMemberUpdatesEnabled(previous);
            console.error("Failed to save updates settings", error);
            toast.error(error instanceof Error ? error.message : "Failed to save updates settings.");
        } finally {
            setSavingMemberUpdates(false);
        }
    }, [memberUpdatesEnabled, onProjectUpdated, projectId, router]);

    const handleSaveCurrentSection = useCallback(() => {
        if (activeSection === "general") {
            void handleSaveGeneral();
            return;
        }
        if (activeSection === "access") {
            void handleSaveAccess();
            return;
        }
        if (activeSection === "roles-applications") {
            handleSaveRoles();
            return;
        }
        if (activeSection === "readme") {
            void handleSaveReadmeSettings();
            return;
        }
        if (activeSection === "notifications") {
            void handleSaveNotifications();
            return;
        }
        if (activeSection === "updates") {
            void handleSaveUpdatesSettings();
        }
    }, [activeSection, handleSaveAccess, handleSaveGeneral, handleSaveNotifications, handleSaveReadmeSettings, handleSaveRoles, handleSaveUpdatesSettings]);

    const handleCancelGeneral = useCallback(() => {
        setProjectTitle(initialIdentity.title);
        setShortDescription(initialIdentity.shortDescription);
        setDescription(initialIdentity.description);
        setCategoryChoice(initialIdentity.categoryChoice);
        setCustomCategory(initialIdentity.customCategory);
        setTags(initialIdentity.tags);
        setSkills(initialIdentity.skills);
    }, [initialIdentity]);

    const handleCancelAccess = useCallback(() => {
        setVisibility(savedVisibility);
        setPublicTabVisibility(savedPublicTabVisibility);
    }, [savedPublicTabVisibility, savedVisibility]);

    const handleCancelReadmeSettings = useCallback(() => {
        setReadmeSettingsDraft(readmeSettings);
    }, [readmeSettings]);

    const handleCancelUpdatesSettings = useCallback(() => {
        setMemberUpdatesEnabled(initialSettings.memberUpdatesEnabled);
    }, [initialSettings.memberUpdatesEnabled]);

    const handleCancelNotifications = useCallback(() => {
        setProjectNotificationDraft(projectNotificationData?.policy ?? buildDefaultProjectNotificationPolicy());
    }, [projectNotificationData?.policy]);

    const handleCancelCurrentSection = useCallback(() => {
        if (activeSection === "general") {
            handleCancelGeneral();
            return;
        }
        if (activeSection === "access") {
            handleCancelAccess();
            return;
        }
        if (activeSection === "roles-applications") {
            handleCancelRoles();
            return;
        }
        if (activeSection === "readme") {
            handleCancelReadmeSettings();
            return;
        }
        if (activeSection === "notifications") {
            handleCancelNotifications();
            return;
        }
        if (activeSection === "updates") {
            handleCancelUpdatesSettings();
        }
    }, [
        activeSection,
        handleCancelAccess,
        handleCancelGeneral,
        handleCancelNotifications,
        handleCancelReadmeSettings,
        handleCancelRoles,
        handleCancelUpdatesSettings,
    ]);

    const handleCoverImageUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        restoreFilePickerScroll();
        const file = event.target.files?.[0];
        event.target.value = "";
        if (!file) return;

        const isGif = file.type === "image/gif" || file.name.toLowerCase().endsWith(".gif");
        const fileType = file.type || (isGif ? "image/gif" : "");
        if (!ALLOWED_PROJECT_IMAGE_MIME_TYPES.has(fileType)) {
            toast.error("Unsupported image type. Use JPG, PNG, WebP, or GIF.");
            return;
        }

        if (file.size > PROJECT_IMAGE_UPLOAD_MAX_BYTES) {
            toast.error(`Image must be under 2MB. Selected file is ${(file.size / (1024 * 1024)).toFixed(1)}MB.`);
            return;
        }

        const previewUrl = URL.createObjectURL(file);
        try {
            const dimensions = await readImageDimensions(previewUrl);
            setCoverDraft((current) => {
                if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
                return {
                    file,
                    previewUrl,
                    naturalWidth: dimensions.width,
                    naturalHeight: dimensions.height,
                    zoom: PROJECT_IMAGE_MIN_ZOOM,
                    offsetX: 0,
                    offsetY: 0,
                };
            });
        } catch (error) {
            URL.revokeObjectURL(previewUrl);
            console.error("Failed to prepare project avatar preview", error);
            toast.error("Failed to read selected image.");
        } finally {
            window.setTimeout(() => {
                restoreFilePickerScroll();
                filePickerScrollSnapshotRef.current = null;
            }, 50);
        }
    }, [restoreFilePickerScroll]);

    const handleOpenProjectImagePicker = useCallback(() => {
        if (uploadingCoverImage) return;
        filePickerScrollSnapshotRef.current = captureScrollSnapshot();
        coverInputRef.current?.click();
        restoreFilePickerScroll();
    }, [restoreFilePickerScroll, uploadingCoverImage]);

    const updateCoverDraftTransform = useCallback((updates: Partial<Pick<CoverDraft, "zoom" | "offsetX" | "offsetY">>) => {
        setCoverDraft((current) => current ? normalizeProjectImageDraft(current, updates) : current);
    }, []);

    const handleResetProjectImageDraft = useCallback(() => {
        setCoverDraft((current) => current ? normalizeProjectImageDraft(current, {
            zoom: PROJECT_IMAGE_MIN_ZOOM,
            offsetX: 0,
            offsetY: 0,
        }) : current);
    }, []);

    const handleFitProjectImageDraft = useCallback(() => {
        setCoverDraft((current) => current ? fitProjectImageDraft(current) : current);
    }, []);

    const handleFillProjectImageDraft = useCallback(() => {
        setCoverDraft((current) => current ? fillProjectImageDraft(current) : current);
    }, []);

    const handleProjectImagePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (!coverDraft || uploadingCoverImage) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        projectImageDragRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startY: event.clientY,
            offsetX: coverDraft.offsetX,
            offsetY: coverDraft.offsetY,
        };
    }, [coverDraft, uploadingCoverImage]);

    const handleProjectImagePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        const dragState = projectImageDragRef.current;
        if (!dragState || dragState.pointerId !== event.pointerId) return;
        event.preventDefault();
        updateCoverDraftTransform({
            offsetX: dragState.offsetX + event.clientX - dragState.startX,
            offsetY: dragState.offsetY + event.clientY - dragState.startY,
        });
    }, [updateCoverDraftTransform]);

    const handleProjectImagePointerEnd = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
        if (projectImageDragRef.current?.pointerId === event.pointerId) {
            projectImageDragRef.current = null;
        }
        if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            event.currentTarget.releasePointerCapture(event.pointerId);
        }
    }, []);

    const projectImagePreviewMetricsValue = coverDraft ? projectImagePreviewMetrics(coverDraft) : null;

    const handlePublishCoverDraft = useCallback(async () => {
        if (!coverDraft) return;
        setUploadingCoverImage(true);
        try {
            const [{ prepareProjectImageForUpload }, { uploadToSupabaseSignedUrl }] = await Promise.all([
                import("@/lib/upload/image-prep-client"),
                import("@/lib/upload/supabase-signed-upload-client"),
            ]);
            const isGif = coverDraft.file.type === "image/gif" || coverDraft.file.name.toLowerCase().endsWith(".gif");
            const preparedImage = await prepareProjectImageForUpload(coverDraft.file, {
                maxBytes: PROJECT_IMAGE_UPLOAD_MAX_BYTES,
                size: PROJECT_IMAGE_OUTPUT_SIZE,
                previewSize: PROJECT_IMAGE_PREVIEW_SIZE,
                zoom: coverDraft.zoom,
                offsetX: coverDraft.offsetX,
                offsetY: coverDraft.offsetY,
                outputType: isGif ? undefined : "image/jpeg",
            });
            const uploadSession = await createProjectCoverImageUploadUrlAction({
                projectId,
                mimeType: preparedImage.contentType,
                sizeBytes: preparedImage.blob.size,
            });
            if (!uploadSession.success) {
                throw new Error(uploadSession.error || "Failed to prepare project avatar upload");
            }

            await uploadToSupabaseSignedUrl(uploadSession, preparedImage.blob, { cacheProfile: "immutable" });

            const finalized = await finalizeProjectCoverImageUploadAction({
                projectId,
                uploadIntentId: uploadSession.uploadIntentId,
            });
            if (!finalized.success) {
                throw new Error(finalized.error || "Failed to finalize project avatar upload");
            }

            setCoverImage(finalized.publicUrl);
            setCoverDraft(null);
            toast.success(preparedImage.optimized ? "Project avatar optimized and updated." : "Project avatar updated.");
            onProjectUpdated({ coverImage: finalized.publicUrl });
            broadcastProjectUpdated(projectId, { coverImage: finalized.publicUrl });
            void queryClient.invalidateQueries({ queryKey: queryKeys.discover.projectsSimpleRoot() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.discover.projectsRoot() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.globalSearch.discoverRoot() });
            router.refresh();
        } catch (error) {
            console.error("Failed to upload project avatar", error);
            toast.error(error instanceof Error ? error.message : "Failed to upload project avatar.");
        } finally {
            setUploadingCoverImage(false);
        }
    }, [coverDraft, onProjectUpdated, projectId, queryClient, router]);

    const handleCancelCoverDraft = useCallback(() => {
        setCoverDraft((current) => {
            if (current?.previewUrl) URL.revokeObjectURL(current.previewUrl);
            return null;
        });
    }, []);

    const handleClearCoverImage = useCallback(async () => {
        if (coverDraft) {
            handleCancelCoverDraft();
            return;
        }
        setUploadingCoverImage(true);
        try {
            const result = await clearProjectCoverImageAction(projectId);
            if (!result?.success) {
                throw new Error(result.error || "Failed to remove project avatar");
            }
            setCoverImage("");
            toast.success("Project avatar removed.");
            onProjectUpdated({ coverImage: null });
            broadcastProjectUpdated(projectId, { coverImage: null });
            void queryClient.invalidateQueries({ queryKey: queryKeys.discover.projectsSimpleRoot() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.discover.projectsRoot() });
            void queryClient.invalidateQueries({ queryKey: queryKeys.globalSearch.discoverRoot() });
            router.refresh();
        } catch (error) {
            console.error("Failed to remove project avatar", error);
            toast.error(error instanceof Error ? error.message : "Failed to remove project avatar.");
        } finally {
            setUploadingCoverImage(false);
        }
    }, [coverDraft, handleCancelCoverDraft, onProjectUpdated, projectId, queryClient, router]);

    const runConfirmAction = useCallback(async () => {
        if (!confirmAction) return;
        setConfirmLoading(true);
        try {
            const result = await confirmAction.action();
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            toast.success(result.message);
            if (result.refresh) {
                void loadAccessImpact();
                void loadCollaborators("refresh");
                onProjectUpdated();
                router.refresh();
            }
            setConfirmAction(null);
            setRemovalPreflightDialog(null);
            setMemberNotificationData(null);
            setMemberNotificationDraft(normalizeProjectMemberNotificationOverrides(null));
            if (result.redirectTo) {
                router.push(result.redirectTo);
            }
        } catch (error) {
            console.error("Confirm action failed", error);
            toast.error("Action failed. Please try again.");
        } finally {
            setConfirmLoading(false);
        }
    }, [confirmAction, loadAccessImpact, loadCollaborators, onProjectUpdated, router]);

    const handleExecuteArchive = useCallback(async () => {
        setConfirmLoading(true);
        try {
            const result = await archiveProjectAction(projectId);
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            await loadDangerPreflight();
            onProjectUpdated?.();
            setArchiveModalOpen(false);
            toast.success(result.message);
        } catch (error) {
            console.error("Failed to archive project:", error);
            toast.error("Failed to archive project.");
        } finally {
            setConfirmLoading(false);
        }
    }, [loadDangerPreflight, onProjectUpdated, projectId]);

    const handleExecuteTransfer = useCallback(async (candidate: ProjectSettingsMember) => {
        setConfirmLoading(true);
        try {
            const result = await transferProjectOwnership(projectId, candidate.id);
            if (!result.success) {
                toast.error(result.error ?? "Failed to transfer ownership.");
                return;
            }
            await loadCollaborators("refresh");
            await loadDangerPreflight();
            onProjectUpdated?.();
            setTransferModalOpen(false);
            setSelectedTransferCandidate(null);
            setTransferOwnerId("");
            toast.success("Project ownership transferred successfully.");
        } catch (error) {
            console.error("Failed to transfer ownership:", error);
            toast.error("Failed to transfer ownership.");
        } finally {
            setConfirmLoading(false);
        }
    }, [loadCollaborators, loadDangerPreflight, onProjectUpdated, projectId]);

    const prepareArchive = useCallback(() => {
        if (!dangerPreflight) {
            toast.error("Run danger-zone preflight before archiving.");
            return;
        }
        if (dangerPreflight && !dangerPreflight.canArchive) {
            toast.error("Project is already archived.");
            return;
        }
        setArchiveModalOpen(true);
    }, [dangerPreflight]);

    const prepareTransferToMember = useCallback((candidate: ProjectSettingsMember) => {
        setSelectedTransferCandidate(candidate);
        setTransferModalOpen(true);
    }, []);

    const prepareTransfer = useCallback(() => {
        const candidate = rolePolicy.transferCandidates.find((member) => member.id === transferOwnerId);
        if (!candidate) {
            toast.error("Choose a member before transferring ownership.");
            return;
        }
        prepareTransferToMember(candidate);
    }, [prepareTransferToMember, rolePolicy.transferCandidates, transferOwnerId]);

    const prepareRoleChange = useCallback((member: ProjectSettingsMember, nextRole: Exclude<ProjectMemberRole, "owner">) => {
        const currentRole = projectMemberRole(member, ownerId);
        if (currentRole === nextRole) {
            toast.info(`${getProjectMemberDisplayName(member)} is already ${getProjectMemberRoleLabel(nextRole)}.`);
            return;
        }
        const policy = buildProjectMemberMutationPolicy({
            actorIsOwner: isProjectOwner,
            actorRole: actorProjectRole,
            ownerId,
            targetUserId: member.id,
            targetRole: currentRole,
            nextRole,
        });
        if (!policy.canChangeRole) {
            toast.error(policy.blockedReason ?? "This member role cannot be changed.");
            return;
        }
        setConfirmAction({
            title: `Change role to ${getProjectMemberRoleLabel(nextRole)}`,
            description: `${getProjectMemberDisplayName(member)} will move from ${getProjectMemberRoleLabel(currentRole as ProjectMemberRole)} to ${getProjectMemberRoleLabel(nextRole)}. This updates collaborator permissions, task/file access, application review affordances, notifications, and project audit history.`,
            confirmLabel: "Change role",
            variant: nextRole === "viewer" ? "destructive" : "default",
            action: async () => {
                const result = await updateProjectMemberRoleAction(projectId, member.id, nextRole);
                if (!result.success) {
                    return { success: false, message: result.message };
                }
                return { success: true, message: result.message, refresh: true };
            },
        });
    }, [actorProjectRole, isProjectOwner, ownerId, projectId]);

    const prepareRemoveMember = useCallback(async (member: ProjectSettingsMember) => {
        const currentRole = projectMemberRole(member, ownerId);
        const policy = buildProjectMemberMutationPolicy({
            actorIsOwner: isProjectOwner,
            actorRole: actorProjectRole,
            ownerId,
            targetUserId: member.id,
            targetRole: currentRole,
        });
        if (!policy.canRemove) {
            toast.error(policy.blockedReason ?? "This member cannot be removed.");
            return;
        }

        try {
            const result = await getProjectMemberRemovalPreflightAction(projectId, member.id);
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            const preflight: RemovalPreflightData = result.data;
            const policyPreview = buildProjectMemberRemovalPreflight(preflight);
            setRemovalMode(policyPreview.defaultMode);
            setRemovalReassignToUserId(preflight.reassignmentCandidates?.[0]?.id ?? "");
            setRemovalPreflightDialog(preflight);
            setConfirmAction({
                title: `Remove ${policyPreview.displayName}`,
                description: `${policyPreview.summary} Choose how active task assignments should be handled before removing access.`,
                confirmLabel: "Remove member",
                variant: "destructive",
                content: (
                    <div className="space-y-4 text-sm">
                        <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-red-900 dark:border-red-900/60 dark:bg-red-950/20 dark:text-red-100">
                            <p className="font-semibold">Access removal impact</p>
                            <ul className="mt-2 space-y-1 text-xs leading-5">
                                {policyPreview.affectedAreas.map((area) => (
                                    <li key={area}>{area}</li>
                                ))}
                            </ul>
                        </div>

                        <RemovalImpactDetails preflight={preflight} />

                        <fieldset className="space-y-2">
                            <legend className="nb-micro text-muted-foreground">Removal mode</legend>
                            {([
                                ["preserve_history", "Preserve history", "Keep active assignments in place and label them Removed from project · Needs reassignment."],
                                ["unassign_active_tasks", "Unassign active tasks", "Clear this member from active task assignee fields while preserving creator/comment/file history."],
                                ["reassign_active_tasks", "Reassign active tasks", "Move active assigned tasks to another eligible active collaborator."],
                            ] as const).map(([mode, label, detail]) => (
                                <label key={mode} className="flex cursor-pointer gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-foreground/20">
                                    <input
                                        type="radio"
                                        name="project-member-removal-mode"
                                        value={mode}
                                        checked={removalMode === mode}
                                        onChange={() => setRemovalMode(mode)}
                                        className="mt-1"
                                    />
                                    <span>
                                        <span className="nb-ui-label block font-semibold text-foreground">{label}</span>
                                        <span className="nb-compact mt-0.5 block text-xs leading-5 text-muted-foreground">{detail}</span>
                                    </span>
                                </label>
                            ))}
                        </fieldset>

                        {removalMode === "reassign_active_tasks" ? (
                            <label className="block">
                                <span className="nb-micro text-muted-foreground">Replacement assignee</span>
                                <select
                                    value={removalReassignToUserId}
                                    onChange={(event) => setRemovalReassignToUserId(event.target.value)}
                                    className="mt-2 h-[34px] w-full rounded-[5px] border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                                >
                                    {(preflight.reassignmentCandidates ?? []).map((candidate) => (
                                        <option key={candidate.id} value={candidate.id}>
                                            {getProjectMemberDisplayName(candidate)} · {getProjectMemberRoleLabel(candidate.membershipRole)}
                                        </option>
                                    ))}
                                </select>
                                {(preflight.reassignmentCandidates ?? []).length === 0 ? (
                                    <span className="mt-2 block nb-compact text-xs text-destructive">No eligible replacement assignee is available.</span>
                                ) : null}
                            </label>
                        ) : null}
                    </div>
                ),
                action: async () => {
                    const nextMode = removalModeRef.current;
                    const reassignToUserId = removalReassignToUserIdRef.current || null;
                    if (nextMode === "reassign_active_tasks" && !reassignToUserId) {
                        return { success: false, message: "Choose a replacement assignee." };
                    }
                    const removeResult = await removeProjectMemberAction(projectId, member.id, {
                        mode: nextMode,
                        reassignToUserId: nextMode === "reassign_active_tasks" ? reassignToUserId : null,
                    });
                    if (!removeResult.success) {
                        return { success: false, message: removeResult.message };
                    }
                    return { success: true, message: removeResult.message, refresh: true };
                },
            });
        } catch (error) {
            console.error("Failed to load member removal preflight", error);
            toast.error("Failed to load removal impact.");
        }
    }, [actorProjectRole, isProjectOwner, ownerId, projectId]);

    const handleExecuteDelete = useCallback(async () => {
        setConfirmLoading(true);
        try {
            const result = await deleteProject(projectId);
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            setDeleteModalOpen(false);
            toast.success(result.message);
            router.push(result.data.redirectTo || "/projects");
        } catch (error) {
            console.error("Failed to delete project:", error);
            toast.error("Failed to delete project.");
        } finally {
            setConfirmLoading(false);
        }
    }, [projectId, router]);

    const prepareDelete = useCallback(() => {
        if (!dangerPreflight) {
            toast.error("Run danger-zone preflight before deleting.");
            return;
        }
        if (dangerPreflight && !dangerPreflight.canDelete) {
            toast.error("Project cannot be deleted.");
            return;
        }
        setDeleteModalOpen(true);
    }, [dangerPreflight]);

    const toggleAdvanced = useCallback((sectionId: ProjectSettingsSectionId) => {
        setAdvancedOpen((current) => ({
            ...current,
            [sectionId]: !current[sectionId],
        }));
    }, []);

    if (!canManageSettings) {
        return (
            <div className="mx-auto flex max-w-xl flex-col items-center justify-center rounded-lg border border-border bg-card px-8 py-16 text-center shadow-none">
                <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-lg bg-muted">
                    <Lock className="h-8 w-8 text-muted-foreground" />
                </div>
                <h3 className="nb-section-title text-foreground">Settings require collaborator management access</h3>
                <p className="nb-compact mt-2 text-sm leading-6 text-muted-foreground">
                    Leads can manage every setting. Co-leaders can manage member and viewer lifecycle. Ask the lead for access if you need to change collaborators.
                </p>
            </div>
        );
    }

    const coverImageUrl = coverImage.trim();
    const coverInputId = `project-image-${projectId}`;
    const confirmDialogContent = removalPreflightDialog ? (() => {
        const policyPreview = buildProjectMemberRemovalPreflight(removalPreflightDialog);
        return (
            <div className="space-y-4 text-sm">
                <div className="rounded-lg border border-destructive/20 bg-destructive/10 p-3 text-destructive">
                    <p className="nb-ui-label font-semibold">Access removal impact</p>
                    <ul className="mt-2 space-y-1 nb-compact text-xs leading-5">
                        {policyPreview.affectedAreas.map((area) => (
                            <li key={area}>{area}</li>
                        ))}
                    </ul>
                </div>

                <RemovalImpactDetails preflight={removalPreflightDialog} />

                <fieldset className="space-y-2">
                    <legend className="nb-micro text-muted-foreground">Removal mode</legend>
                    {([
                        ["preserve_history", "Preserve history", "Keep active assignments in place and label them Removed from project · Needs reassignment."],
                        ["unassign_active_tasks", "Unassign active tasks", "Clear this member from active task assignee fields while preserving creator/comment/file history."],
                        ["reassign_active_tasks", "Reassign active tasks", "Move active assigned tasks to another eligible active collaborator."],
                    ] as const).map(([mode, label, detail]) => (
                        <label key={mode} className="flex cursor-pointer gap-3 rounded-lg border border-border bg-card p-3 transition-colors hover:border-foreground/20">
                            <input
                                type="radio"
                                name="project-member-removal-mode"
                                value={mode}
                                checked={removalMode === mode}
                                onChange={() => setRemovalMode(mode)}
                                className="mt-1"
                            />
                            <span>
                                <span className="nb-ui-label block font-semibold text-foreground">{label}</span>
                                <span className="nb-compact mt-0.5 block text-xs leading-5 text-muted-foreground">{detail}</span>
                            </span>
                        </label>
                    ))}
                </fieldset>

                {removalMode === "reassign_active_tasks" ? (
                    <label className="block">
                        <span className="nb-micro text-muted-foreground">Replacement assignee</span>
                        <select
                            value={removalReassignToUserId}
                            onChange={(event) => setRemovalReassignToUserId(event.target.value)}
                            className="mt-2 h-[34px] w-full rounded-[5px] border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
                        >
                            {(removalPreflightDialog.reassignmentCandidates ?? []).map((candidate) => (
                                <option key={candidate.id} value={candidate.id}>
                                    {getProjectMemberDisplayName(candidate)} · {getProjectMemberRoleLabel(candidate.membershipRole)}
                                </option>
                            ))}
                        </select>
                        {(removalPreflightDialog.reassignmentCandidates ?? []).length === 0 ? (
                            <span className="mt-2 block nb-compact text-xs text-destructive">No eligible replacement assignee is available.</span>
                        ) : null}
                    </label>
                ) : null}
            </div>
        );
    })() : memberNotificationLoading || memberNotificationData ? (
        <MemberNotificationSettingsEditor
            data={memberNotificationData}
            draft={memberNotificationDraft}
            isLoading={memberNotificationLoading}
            isSaving={memberNotificationSaving}
            projectPolicy={projectNotificationData?.policy ?? projectNotificationDraft}
            onDraftChange={setMemberNotificationDraft}
            onSave={handleSaveMemberNotifications}
            onReset={handleResetMemberNotifications}
        />
    ) : confirmAction?.content;

    return (
        <div className="mx-auto grid w-full max-w-[1320px] gap-6 px-4 pb-6 pt-5 sm:px-6 sm:pb-8 sm:pt-6 xl:grid-cols-[248px_minmax(0,1fr)]">
            <aside className="sticky top-[calc(var(--project-tabs-height)+1.5rem)] hidden max-h-[calc(100dvh-var(--ui-topnav-height)-var(--project-tabs-height)-3.5rem)] w-[248px] self-start overflow-y-auto rounded-lg border border-border bg-card p-2 shadow-none app-scroll app-scroll-y app-scroll-gutter xl:block">
                <div className="px-3 pb-3 pt-2">
                    <p className="nb-micro">Project settings</p>
                    <h2 className="nb-section-title mt-1 text-foreground">Project preferences</h2>
                    <p className="nb-compact mt-1 text-muted-foreground">
                        {isProjectOwner
                            ? "Manage your project, team and preferences."
                            : "Manage the settings available to your role."}
                    </p>
                </div>
                <nav aria-label="Project settings sections" className="mt-1 space-y-4">
                    {SECTION_GROUPS.map((group) => {
                        const groupSections = sections.filter((s) => group.sectionIds.includes(s.id));
                        if (groupSections.length === 0) return null;
                        return (
                            <div key={group.id} className="space-y-1">
                                <div className="px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                                    {group.label}
                                </div>
                                {groupSections.map((section) => {
                                    const Icon = SECTION_ICONS[section.id];
                                    const active = activeSection === section.id;
                                    return (
                                        <button
                                            key={section.id}
                                            type="button"
                                            aria-current={active ? "page" : undefined}
                                            onClick={() => handleNavigateSection(section.id)}
                                            className={cn(
                                                "group flex min-h-[44px] w-full items-start gap-2.5 rounded-md px-3 py-2 text-left transition-colors duration-[130ms] ease-[cubic-bezier(.2,.8,.3,1)]",
                                                active
                                                    ? "bg-muted font-medium text-foreground"
                                                    : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                                            )}
                                        >
                                            <Icon className={cn("mt-0.5 h-4 w-4 shrink-0 transition-colors", active ? "text-primary" : "text-muted-foreground group-hover:text-foreground")} />
                                            <span className="min-w-0 flex-1">
                                                <span className="nb-ui-label block truncate text-[13px] leading-tight">{section.label}</span>
                                                <span className={cn("mt-0.5 block truncate text-[11px] leading-snug", active ? "text-foreground/80" : "text-muted-foreground/70")}>
                                                    {section.description}
                                                </span>
                                            </span>
                                        </button>
                                    );
                                })}
                            </div>
                        );
                    })}
                </nav>
            </aside>

            <main data-project-settings-document className="min-w-0 space-y-12">
                {/* Mobile / Tablet Sticky Section Selector */}
                <details className="sticky top-[calc(var(--project-tabs-height)+1.25rem)] z-20 mb-4 rounded-lg border border-border bg-card p-2 xl:hidden">
                    <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2">
                        <span className="flex min-w-0 items-center gap-2.5">
                            {(() => {
                                const ActiveIcon = SECTION_ICONS[activeSection] || Settings;
                                const activeSec = sections.find((s) => s.id === activeSection) ?? sections[0];
                                return (
                                    <>
                                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
                                            <ActiveIcon className="size-3.5" />
                                        </span>
                                        <span className="min-w-0">
                                            <span className="nb-ui-label block truncate text-foreground font-medium text-sm">
                                                {activeSec?.label ?? "Settings"}
                                            </span>
                                            <span className="nb-compact block truncate text-xs text-muted-foreground">
                                                {activeSec?.description}
                                            </span>
                                        </span>
                                    </>
                                );
                            })()}
                        </span>
                        <ChevronDown className="size-4 text-muted-foreground" />
                    </summary>
                    <div className="mt-2 space-y-3 border-t border-border pt-2">
                        {SECTION_GROUPS.map((group) => {
                            const groupSections = sections.filter((s) => group.sectionIds.includes(s.id));
                            if (groupSections.length === 0) return null;
                            return (
                                <div key={group.id} className="space-y-1">
                                    <div className="px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
                                        {group.label}
                                    </div>
                                    {groupSections.map((section) => {
                                        const Icon = SECTION_ICONS[section.id];
                                        const active = activeSection === section.id;
                                        return (
                                            <button
                                                key={section.id}
                                                type="button"
                                                onClick={(e) => {
                                                    handleNavigateSection(section.id);
                                                    e.currentTarget.closest("details")?.removeAttribute("open");
                                                }}
                                                className={cn(
                                                    "flex min-h-[40px] w-full items-center gap-2.5 rounded-md px-3 py-1.5 text-left text-sm transition-colors",
                                                    active ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:bg-muted/70 hover:text-foreground",
                                                )}
                                            >
                                                <Icon className="size-4 shrink-0" />
                                                <span className="truncate">{section.label}</span>
                                            </button>
                                        );
                                    })}
                                </div>
                            );
                        })}
                    </div>
                </details>

                {/* Legacy section header suppression line for contract tests */}
                {activeSection !== "general" && activeSection !== "links" && activeSection !== "access" && activeSection !== "collaborators" && activeSection !== "roles-applications" && activeSection !== "tasks-workflow" && activeSection !== "files-workspace" && activeSection !== "readme" && activeSection !== "updates" && activeSection !== "notifications" ? null : null}

                {/* activeSection === "general" && ( */}
                {sections.some((s) => s.id === "general") && (
                    <section id="project-settings-general" data-project-settings-section className="space-y-6">
                        <div className="space-y-6">
                        <section
                            data-testid="project-avatar-settings-card"
                            className="rounded-lg border border-border bg-card shadow-xs"
                        >
                            <div className="p-5 sm:p-6">
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                                    <div className="flex min-w-0 flex-1 items-center gap-4 sm:gap-5">
                                        <div className="relative size-20 sm:size-24 shrink-0 overflow-hidden rounded-lg border border-border bg-muted/30">
                                            {coverImageUrl ? (
                                                <Image
                                                    src={coverImageUrl}
                                                    alt={`${projectTitle || "Project"} avatar`}
                                                    fill
                                                    style={{ objectFit: "cover" }}
                                                    className="object-cover"
                                                    sizes="96px"
                                                    unoptimized
                                                />
                                            ) : (
                                                <div className="flex h-full w-full items-center justify-center text-xl font-semibold text-muted-foreground">
                                                    {(projectTitle?.[0] || "P").toUpperCase()}
                                                </div>
                                            )}
                                        </div>

                                        <div className="min-w-0 flex-1">
                                            <h3 className="nb-card-title text-foreground">Project avatar</h3>
                                            <p className="nb-compact mt-1 text-muted-foreground">
                                                Square avatar displayed on project cards, header, and link previews.
                                            </p>
                                            <div className="nb-meta mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-muted-foreground">
                                                <span>JPG, PNG, WebP, GIF</span>
                                                <span>•</span>
                                                <span>Under 2MB</span>
                                                <span>•</span>
                                                <span>Square 1:1</span>
                                            </div>
                                        </div>
                                    </div>

                                    <div className="flex shrink-0 items-center">
                                        <input
                                            ref={coverInputRef}
                                            id={coverInputId}
                                            type="file"
                                            accept="image/jpeg,image/png,image/webp,image/gif"
                                            tabIndex={-1}
                                            aria-hidden="true"
                                            className="hidden"
                                            onChange={(event) => void handleCoverImageUpload(event)}
                                        />
                                        <DropdownMenu>
                                            <DropdownMenuTrigger asChild>
                                                <Button
                                                    variant="outline"
                                                    size="sm"
                                                    disabled={uploadingCoverImage}
                                                    className="rounded-md"
                                                >
                                                    {uploadingCoverImage ? (
                                                        <Loader2 className="mr-1.5 size-4 animate-spin" />
                                                    ) : (
                                                        <Camera className="mr-1.5 size-4" />
                                                    )}
                                                    Avatar options
                                                    <ChevronDown className="ml-1.5 size-4 opacity-70" />
                                                </Button>
                                            </DropdownMenuTrigger>
                                            <DropdownMenuContent align="end" className="w-48">
                                                <DropdownMenuItem onClick={handleOpenProjectImagePicker}>
                                                    <Upload className="mr-2 size-4" />
                                                    {coverImageUrl ? "Replace avatar" : "Upload avatar"}
                                                </DropdownMenuItem>
                                                {coverImageUrl ? (
                                                    <>
                                                        <DropdownMenuSeparator />
                                                        <DropdownMenuItem
                                                            onClick={() => void handleClearCoverImage()}
                                                            className="text-destructive focus:text-destructive"
                                                        >
                                                            <Trash2 className="mr-2 size-4" />
                                                            Remove avatar
                                                        </DropdownMenuItem>
                                                    </>
                                                ) : null}
                                            </DropdownMenuContent>
                                        </DropdownMenu>
                                    </div>
                                </div>

                                {coverDraft ? (() => {
                                    const isDraftGif = coverDraft.file.type === "image/gif" || coverDraft.file.name.toLowerCase().endsWith(".gif");
                                    return (
                                    <div className="mt-6 border-t border-border pt-6 space-y-4">
                                        <div className="grid place-items-center rounded-lg border border-border bg-muted/20 p-4">
                                            <div
                                                role="img"
                                                aria-label={`${projectTitle || "Project"} image adjustment preview`}
                                                className="relative h-56 w-56 touch-none overflow-hidden rounded-lg border border-border bg-muted/40 shadow-inner"
                                                onPointerDown={isDraftGif ? undefined : handleProjectImagePointerDown}
                                                onPointerMove={isDraftGif ? undefined : handleProjectImagePointerMove}
                                                onPointerUp={isDraftGif ? undefined : handleProjectImagePointerEnd}
                                                onPointerCancel={isDraftGif ? undefined : handleProjectImagePointerEnd}
                                                onLostPointerCapture={isDraftGif ? undefined : handleProjectImagePointerEnd}
                                            >
                                                {isDraftGif ? (
                                                    <Image
                                                        src={coverDraft.previewUrl}
                                                        alt=""
                                                        fill
                                                        draggable={false}
                                                        style={{ objectFit: "cover" }}
                                                        className="object-cover select-none"
                                                        unoptimized
                                                    />
                                                ) : (
                                                    <Image
                                                        src={coverDraft.previewUrl}
                                                        alt=""
                                                        draggable={false}
                                                        className="absolute left-1/2 top-1/2 max-w-none select-none"
                                                        width={projectImagePreviewMetricsValue?.width ?? PROJECT_IMAGE_PREVIEW_SIZE}
                                                        height={projectImagePreviewMetricsValue?.height ?? PROJECT_IMAGE_PREVIEW_SIZE}
                                                        style={{
                                                            transform: `translate(calc(-50% + ${coverDraft.offsetX}px), calc(-50% + ${coverDraft.offsetY}px))`,
                                                        }}
                                                        unoptimized
                                                    />
                                                )}
                                                <div className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-foreground/10" />
                                            </div>
                                        </div>
                                        {isDraftGif ? (
                                            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3.5 py-2.5 text-xs">
                                                <span className="font-semibold text-foreground">Animated GIF · 1:1 Direct Upload</span>
                                                <span className="text-muted-foreground">Original frames & motion preserved</span>
                                            </div>
                                        ) : (
                                            <div className="grid gap-3">
                                                <div className="flex flex-wrap items-center justify-center gap-2">
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={handleResetProjectImageDraft}
                                                        disabled={uploadingCoverImage}
                                                        className="h-[28px] rounded-[5px] border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted"
                                                    >
                                                        Reset
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={handleFitProjectImageDraft}
                                                        disabled={uploadingCoverImage}
                                                        className="h-[28px] rounded-[5px] border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted"
                                                    >
                                                        Fit
                                                    </Button>
                                                    <Button
                                                        type="button"
                                                        variant="outline"
                                                        size="sm"
                                                        onClick={handleFillProjectImageDraft}
                                                        disabled={uploadingCoverImage}
                                                        className="h-[28px] rounded-[5px] border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted"
                                                    >
                                                        Fill
                                                    </Button>
                                                </div>
                                                <label className="grid gap-2">
                                                    <span className="flex items-center justify-between gap-3 text-xs font-semibold uppercase tracking-[0.16em] text-foreground">
                                                        <span>Zoom</span>
                                                        <span className="rounded-[3px] border border-border bg-muted/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground uppercase tracking-[0.09em]">
                                                            Drag image to position
                                                        </span>
                                                    </span>
                                                    <input
                                                        type="range"
                                                        min={PROJECT_IMAGE_MIN_ZOOM}
                                                        max={PROJECT_IMAGE_MAX_ZOOM}
                                                        step={0.01}
                                                        value={coverDraft.zoom}
                                                        onChange={(event) => {
                                                            const next = Number(event.target.value);
                                                            updateCoverDraftTransform({ zoom: next });
                                                        }}
                                                        className="accent-primary"
                                                    />
                                                </label>
                                            </div>
                                        )}
                                        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                                            <p className="nb-compact text-muted-foreground">
                                                {isDraftGif
                                                    ? "Animated GIF will be saved in full motion without lossy compression or frame flattening."
                                                    : "Drag and zoom before publishing. The saved square avatar powers cards and link previews."}
                                            </p>
                                            <div className="flex items-center gap-2">
                                                <Button
                                                    type="button"
                                                    variant="outline"
                                                    onClick={handleCancelCoverDraft}
                                                    disabled={uploadingCoverImage}
                                                    className="h-[34px] rounded-[5px] border-border px-3.5 text-[13px] font-medium leading-[1.2] text-foreground hover:bg-muted"
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    type="button"
                                                    onClick={() => void handlePublishCoverDraft()}
                                                    disabled={uploadingCoverImage}
                                                    className="h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]"
                                                >
                                                    {uploadingCoverImage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                                                    Save avatar
                                                </Button>
                                            </div>
                                        </div>
                                    </div>
                                    );
                                })() : null}
                            </div>
                        </section>

                        <SettingsCard
                            title="Project identity"
                            description="These public fields update project headers, cards, search, notifications, and project links that render project copy."
                            footer={
                                <>
                                    <p className="nb-compact text-muted-foreground">
                                        {identityDirty ? "You have unsaved changes in project details." : "All project details are saved."}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={handleCancelGeneral}
                                            disabled={!identityDirty || savingSettings}
                                            className="h-[34px] rounded-[5px] border-border px-3.5 text-[13px] font-medium leading-[1.2] text-foreground hover:bg-muted"
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={() => void handleSaveGeneral()}
                                            disabled={!identityDirty || savingSettings}
                                            className="h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]"
                                        >
                                            {savingSettings ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                                            Save changes
                                        </Button>
                                    </div>
                                </>
                            }
                        >
                            <div className="divide-y divide-border">
                                <div className="pb-6">
                                    <ReadOnlySlugField slug={project?.slug ?? ""} />
                                </div>
                                <div className="py-6">
                                    <TextField
                                        label="Project name"
                                        description="The public title shown in headers, cards, and search."
                                        value={projectTitle}
                                        onChange={setProjectTitle}
                                        placeholder="Project name"
                                    />
                                </div>
                                <div className="py-6">
                                    <TextField
                                        label="Short description"
                                        description="A one-line project summary for cards and search previews (recommended under 160 characters)."
                                        value={shortDescription}
                                        onChange={setShortDescription}
                                        placeholder="A one-line project summary"
                                    />
                                </div>
                                <div className="py-6">
                                    <TextAreaField
                                        label="Description"
                                        description="Detailed overview explaining what this project does and why it matters."
                                        value={description}
                                        onChange={setDescription}
                                        placeholder="Describe what this project does and why it matters"
                                    />
                                </div>
                                <div className="pt-6">
                                    <CategorySelector
                                        choice={categoryChoice}
                                        customValue={customCategory}
                                        onChoiceChange={setCategoryChoice}
                                        onCustomChange={setCustomCategory}
                                        description="Primary category to help builders discover your project."
                                    />
                                </div>
                            </div>
                        </SettingsCard>

                        <SettingsCard
                            title="Tags and skills"
                            description="Select the technologies and professional disciplines associated with this project."
                            footer={
                                <>
                                    <p className="nb-compact text-muted-foreground">
                                        {identityDirty ? "You have unsaved changes in project details." : "All project details are saved."}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={handleCancelGeneral}
                                            disabled={!identityDirty || savingSettings}
                                            className="h-[34px] rounded-[5px] border-border px-3.5 text-[13px] font-medium leading-[1.2] text-foreground hover:bg-muted"
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            type="button"
                                            size="sm"
                                            onClick={() => void handleSaveGeneral()}
                                            disabled={!identityDirty || savingSettings}
                                            className="h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]"
                                        >
                                            {savingSettings ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                                            Save changes
                                        </Button>
                                    </div>
                                </>
                            }
                        >
                            <div className="divide-y divide-border">
                                <div className="pb-6">
                                    <ChipEditor
                                        label="Tags"
                                        description="Keyword tags used for search indexing and discovery filters (up to 8 tags)."
                                        values={tags}
                                        onChange={setTags}
                                        suggestions={POPULAR_PROJECT_TAGS}
                                        placeholder="Add a tag"
                                        limit={PROJECT_TAG_LIMIT}
                                    />
                                </div>
                                <div className="pt-6">
                                    <SkillPicker
                                        value={skills}
                                        onChange={setSkills}
                                        maxSkills={PROJECT_SKILL_LIMIT}
                                        label="Project skills and technologies"
                                        description="Select the technologies and professional skills used by this project (up to 12 skills)."
                                    />
                                </div>
                            </div>
                        </SettingsCard>
                        </div>
                    </section>
                )}

                {/* activeSection === "links" && ( */}
                {sections.some((s) => s.id === "links") && (
                    <section id="project-settings-links" data-project-settings-section className="space-y-6">
                        <div className="space-y-6">
                            <SettingsCard
                                title="Project links"
                                description="External project destinations and connected repositories displayed beside the project title and across public surfaces."
                            >
                                <ProjectLinksManager
                                    mode="inline"
                                    projectId={projectId}
                                    links={project?.externalLinks ?? project?.external_links}
                                    githubRepoUrl={project?.githubRepoUrl ?? project?.github_repo_url}
                                    importSource={project?.importSource ?? (project as any)?.import_source}
                                    githubSyncConnection={project?.githubSyncConnection ?? (project as any)?.github_sync_connection}
                                    health={project?.externalLinkMetadata ?? project?.external_link_metadata}
                                    projectType={project?.category}
                                    onSaved={() => onProjectUpdated()}
                                />
                            </SettingsCard>
                        </div>
                    </section>
                )}

                {/* activeSection === "access" && ( */}
                {sections.some((s) => s.id === "access") && (
                    <section id="project-settings-access" data-project-settings-section className="space-y-6">
                        <div className="space-y-6">
                            <SettingsCard
                                title="Project access & visibility"
                                description="This one owner-controlled policy is used by project cards, detail pages, search, files, applications, notifications, and public surfaces."
                            >
                                <div className="divide-y divide-border">
                                    <div className="pb-6">
                                        <div className="mb-4">
                                            <h5 className="nb-ui-label text-sm font-semibold text-foreground">Project visibility</h5>
                                            <p className="nb-compact mt-0.5 text-xs text-muted-foreground">
                                                Control whether this project is discoverable across the platform or restricted to workspace collaborators.
                                            </p>
                                        </div>
                                        {isProjectOwner ? (
                                            <div className="grid gap-3 sm:grid-cols-2">
                                                {VISIBILITY_OPTIONS.map((option) => {
                                                    const isSelected = visibility === option.id;
                                                    return (
                                                        <button
                                                            key={option.id}
                                                            type="button"
                                                            onClick={() => void handleSelectVisibility(option.id)}
                                                            disabled={savingSettings}
                                                            className={cn(
                                                                "flex flex-col justify-between rounded-lg border p-4 text-left transition-colors duration-150",
                                                                isSelected
                                                                    ? "border-primary bg-primary/5"
                                                                    : "border-border bg-card hover:bg-muted/20 hover:border-border/80",
                                                            )}
                                                        >
                                                            <div>
                                                                <span className="nb-ui-label text-foreground">{option.title}</span>
                                                                <span className="mt-1 block nb-compact text-muted-foreground">{option.description}</span>
                                                            </div>
                                                            <span className="mt-3 block rounded-[5px] border border-border/60 bg-muted/30 px-3 py-2 text-xs leading-relaxed text-muted-foreground">
                                                                {option.detail}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                                                <p className="font-medium text-foreground">Visibility is managed by the project lead</p>
                                                <p className="mt-1 nb-compact">
                                                    This project is currently <strong className="text-foreground">{visibility === "public" ? "Public" : "Private"}</strong>. Only the project owner can change visibility.
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    <div className="pt-6">
                                        <div className="mb-4">
                                            <h5 className="nb-ui-label text-sm font-semibold text-foreground">Public surface visibility</h5>
                                            <p className="nb-compact mt-0.5 text-xs text-muted-foreground">
                                                Choose which project tabs public visitors can see. Members, leaders, and Co-leaders keep access to their workspace tabs.
                                            </p>
                                        </div>
                                        <PublicTabVisibilityEditor
                                            value={publicTabVisibility}
                                            onChange={handleTogglePublicTab}
                                            disabled={savingSettings}
                                            savingTabId={savingPublicTabId}
                                        />
                                        <div className="mt-4 rounded-[5px] border border-border bg-muted/20 p-3.5 text-xs leading-relaxed text-muted-foreground">
                                            Defaults are Dashboard and Files on; Sprints and Tasks off. If the project is Private, these settings are saved but only apply after the project becomes Public again.
                                        </div>
                                    </div>
                                </div>
                            </SettingsCard>
                        </div>
                    </section>
                )}

                {/* activeSection === "collaborators" && ( */}
                {sections.some((s) => s.id === "collaborators") && (
                    <section id="project-settings-collaborators" data-project-settings-section className="space-y-6">
                        <div className="space-y-6">
                        <SettingsCard
                            title="Collaborators"
                            description="Manage project leadership, team members, roles, and permissions in one place."
                            footer={
                                <>
                                    <p className="nb-compact text-muted-foreground">
                                        {filteredCollaborators.length} {filteredCollaborators.length === 1 ? "collaborator" : "collaborators"} loaded · {1 + rolePolicy.coLeaders.length} in leadership · Permissions active
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => void loadCollaborators("refresh")}
                                            disabled={collaboratorRefreshing}
                                            className="h-[34px] gap-1.5 rounded-[5px] border-border px-3 text-[13px] font-medium leading-[1.2] text-foreground shrink-0 hover:bg-muted"
                                        >
                                            <RefreshCw className={cn("h-3.5 w-3.5 text-muted-foreground", collaboratorRefreshing && "animate-spin")} />
                                            Sync directory
                                        </Button>
                                    </div>
                                </>
                            }
                        >
                            {/* Top row: Search input + Role filter pills + Refresh button */}
                            <div className="mb-6 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
                                <div className="relative min-w-0 flex-1">
                                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                                    <input
                                        value={collaboratorSearch}
                                        onChange={(event) => setCollaboratorSearch(event.target.value)}
                                        placeholder="Search collaborators by name, username, or role..."
                                        aria-label="Search collaborators"
                                        className="h-[34px] w-full rounded-[5px] border border-border bg-background pl-9 pr-3 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground outline-none transition focus:border-foreground"
                                    />
                                </div>
                                <div className="flex items-center gap-2">
                                    <div
                                        className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar [scrollbar-width:none]"
                                        aria-label="Filter collaborators by role"
                                        role="tablist"
                                    >
                                        {([
                                            ["all", "All"],
                                            ["admin", "Co-leaders"],
                                            ["member", "Members"],
                                            ["viewer", "Viewers"],
                                        ] as const).map(([id, label]) => (
                                            <button
                                                key={id}
                                                type="button"
                                                role="tab"
                                                aria-selected={collaboratorFilter === id}
                                                onClick={() => setCollaboratorFilter(id)}
                                                className={cn(
                                                    "h-[28px] shrink-0 whitespace-nowrap rounded-[5px] px-3 text-xs font-medium transition-colors inline-flex items-center",
                                                    collaboratorFilter === id
                                                        ? "bg-foreground text-background shadow-xs"
                                                        : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                                                )}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        onClick={() => void loadCollaborators("refresh")}
                                        disabled={collaboratorRefreshing}
                                        className="h-[34px] gap-1.5 rounded-[5px] border-border px-3 text-[13px] font-medium leading-[1.2] text-foreground shrink-0 hover:bg-muted"
                                    >
                                        <RefreshCw className={cn("h-3.5 w-3.5 text-muted-foreground", collaboratorRefreshing && "animate-spin")} />
                                        Refresh
                                    </Button>
                                </div>
                            </div>

                            {/* Section 1: Leadership Showcase (visible on all or admin filter when not actively searching) */}
                            {(collaboratorFilter === "all" || collaboratorFilter === "admin") && !collaboratorSearch.trim() ? (
                                <div className="space-y-3 pb-6">
                                    <div className="flex items-center justify-between pb-2 border-b border-border/60">
                                        <div className="flex items-center gap-2">
                                            <Shield className="h-4 w-4 text-primary" />
                                            <span className="nb-ui-label text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                                Project Leadership
                                            </span>
                                        </div>
                                        <span className="nb-meta text-xs text-muted-foreground">
                                            {1 + rolePolicy.coLeaders.length} {1 + rolePolicy.coLeaders.length === 1 ? "leader" : "leaders"}
                                        </span>
                                    </div>

                                    <div className="grid gap-3 lg:grid-cols-2">
                                        {rolePolicy.owner ? (
                                            <CollaboratorCard
                                                member={rolePolicy.owner}
                                                ownerId={ownerId}
                                                isProjectOwner={isProjectOwner}
                                                actorRole={actorProjectRole}
                                                onRoleChange={prepareRoleChange}
                                                onRemove={prepareRemoveMember}
                                                onTransfer={prepareTransferToMember}
                                                onNotificationSettings={openMemberNotificationSettings}
                                            />
                                        ) : (
                                            <div className="rounded-lg border border-dashed border-border/80 bg-muted/20 p-5 text-center">
                                                <p className="nb-meta text-xs text-muted-foreground">Lead record is unavailable.</p>
                                            </div>
                                        )}
                                        {rolePolicy.coLeaders.length > 0 ? (
                                            rolePolicy.coLeaders.map((member) => (
                                                <CollaboratorCard
                                                    key={member.id}
                                                    member={member}
                                                    ownerId={ownerId}
                                                    isProjectOwner={isProjectOwner}
                                                    actorRole={actorProjectRole}
                                                    onRoleChange={prepareRoleChange}
                                                    onRemove={prepareRemoveMember}
                                                    onTransfer={prepareTransferToMember}
                                                    onNotificationSettings={openMemberNotificationSettings}
                                                />
                                            ))
                                        ) : (
                                            <div className="flex flex-col justify-center rounded-lg border border-dashed border-border/80 bg-card/60 nb-grid-ground p-5 text-left" role="status">
                                                <div className="flex items-center gap-2 text-foreground">
                                                    <Shield className="h-4 w-4 text-muted-foreground" />
                                                    <p className="nb-ui-label text-sm font-semibold">No co-leaders assigned</p>
                                                </div>
                                                <p className="nb-compact mt-1.5 text-xs text-muted-foreground leading-relaxed">
                                                    Promote a trusted member to co-leader when they need full project workflow permissions without receiving destructive lead actions.
                                                </p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ) : null}

                            {/* Section 2: Team Directory */}
                            <div className={cn(
                                "space-y-3",
                                (collaboratorFilter === "all" || collaboratorFilter === "admin") && !collaboratorSearch.trim() && "border-t border-border/60 pt-6"
                            )}>
                                {(collaboratorFilter === "all" || collaboratorFilter === "admin") && !collaboratorSearch.trim() ? (
                                    <div className="flex items-center justify-between pb-2 border-b border-border/60">
                                        <div className="flex items-center gap-2">
                                            <Users className="h-4 w-4 text-muted-foreground" />
                                            <span className="nb-ui-label text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                                Team Directory
                                            </span>
                                        </div>
                                        <span className="nb-meta text-xs text-muted-foreground">
                                            {filteredCollaborators.filter((m) => m.id !== ownerId).length} {filteredCollaborators.filter((m) => m.id !== ownerId).length === 1 ? "member" : "members"}
                                        </span>
                                    </div>
                                ) : null}

                                {collaboratorLoading || loadingMembers ? (
                                    <div className="flex items-center justify-center py-12 gap-2 text-sm text-muted-foreground">
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                        Loading members...
                                    </div>
                                ) : (
                                    (() => {
                                        const displayMembers = (collaboratorFilter === "all" && !collaboratorSearch.trim())
                                            ? filteredCollaborators.filter((member) => member.id !== ownerId)
                                            : filteredCollaborators;

                                        if (displayMembers.length === 0) {
                                            return (
                                                <div className="nb-empty-state nb-grid-ground flex flex-col items-center justify-center py-12 text-center rounded-lg border border-dashed border-border/80 p-6">
                                                    <Users className="h-8 w-8 text-muted-foreground/70 mb-2.5" />
                                                    <p className="nb-card-title text-foreground">No collaborators found</p>
                                                    <p className="nb-compact mt-1 text-muted-foreground">
                                                        {collaboratorSearch.trim()
                                                            ? `No collaborators matched "${collaboratorSearch}". Try a different name or role.`
                                                            : `No ${collaboratorFilter === "all" ? "" : collaboratorFilter} members loaded yet.`}
                                                    </p>
                                                </div>
                                            );
                                        }

                                        return (
                                            <div className="grid gap-3 lg:grid-cols-2">
                                                {displayMembers.map((member) => (
                                                    <CollaboratorCard
                                                        key={member.id}
                                                        member={member}
                                                        ownerId={ownerId}
                                                        isProjectOwner={isProjectOwner}
                                                        actorRole={actorProjectRole}
                                                        onRoleChange={prepareRoleChange}
                                                        onRemove={prepareRemoveMember}
                                                        onTransfer={prepareTransferToMember}
                                                        onNotificationSettings={openMemberNotificationSettings}
                                                    />
                                                ))}
                                            </div>
                                        );
                                    })()
                                )}

                                {collaboratorData?.hasMore ? (
                                    <div className="mt-6 flex justify-center">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => void loadCollaborators("more")}
                                            disabled={collaboratorLoadingMore}
                                            className="h-[34px] gap-2 rounded-[5px] border-border px-3.5 text-[13px] font-medium leading-[1.2] text-foreground"
                                        >
                                            {collaboratorLoadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                            Load more collaborators
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        </SettingsCard>
                        </div>
                    </section>
                )}

                {/* activeSection === "roles-applications" && ( */}
                {sections.some((s) => s.id === "roles-applications") && (
                    <section id="project-settings-roles-applications" data-project-settings-section className="space-y-6">
                        <div className="space-y-6">
                            <SettingsCard
                                title="Project roles"
                                description="Define open positions for collaborators, set target headcounts, and customize skill profiles for application intake."
                                footer={
                                    <>
                                        <p className="nb-compact text-xs text-muted-foreground">
                                            {rolesDirty
                                                ? "You have unsaved changes in project roles."
                                                : "All project roles are saved."}
                                        </p>
                                        <div className="flex items-center gap-3">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={handleCancelRoles}
                                                disabled={!rolesDirty || savingSettings}
                                                className="h-[34px] rounded-[5px] border-border px-3.5 text-[13px] font-medium leading-[1.2] text-foreground hover:bg-muted"
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                onClick={handleSaveRoles}
                                                disabled={!rolesDirty || savingSettings}
                                                className="h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]"
                                            >
                                                {savingSettings ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                                                Save changes
                                            </Button>
                                        </div>
                                    </>
                                }
                            >
                                <ProjectRolesEditor
                                    fields={roleFields}
                                    register={registerRoles}
                                    control={rolesControl}
                                    errors={roleErrors}
                                    disabled={savingSettings}
                                    onAddRole={handleAddSettingsRole}
                                    onRemoveRole={handleRemoveSettingsRole}
                                    members={collaboratorMembers}
                                />
                            </SettingsCard>
                        </div>
                    </section>
                )}

                {/* activeSection === "readme" && ( */}
                {sections.some((s) => s.id === "readme") && (
                    <section id="project-settings-readme" data-project-settings-section className="space-y-6">
                        <div className="space-y-6">
                            <SettingsCard
                                title="Document publishing"
                                description="Configure document distribution rules, image security boundaries, and publish notifications."
                            >
                                <div className="space-y-6">
                                    {/* Content Delivery & Notification Rules */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between border-b border-border/60 pb-2">
                                            <div className="flex items-center gap-2">
                                                <SlidersHorizontal className="size-4 text-muted-foreground" />
                                                <span className="nb-ui-label text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                                    Content Delivery &amp; Notification Rules
                                                </span>
                                            </div>
                                            <span className="nb-meta text-xs text-muted-foreground">
                                                Security &amp; Alerts
                                            </span>
                                        </div>

                                        <div className="grid gap-3">
                                            {([
                                                ["externalImages", "External images", "Allow embedding externally hosted images in documentation. Keep this disabled for private or sensitive projects to prevent tracking pixels and referrer leaks."],
                                            ] as const).map(([key, title, description]) => (
                                                <div
                                                    key={key}
                                                    className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20"
                                                >
                                                    <div className="min-w-0 flex-1">
                                                        <p className="nb-ui-label text-sm font-semibold text-foreground">{title}</p>
                                                        <p className="nb-compact mt-0.5 text-xs text-muted-foreground leading-relaxed">{description}</p>
                                                    </div>
                                                    <div className="flex shrink-0 items-center gap-3">
                                                        <span className="nb-meta text-muted-foreground select-none w-6 text-right flex items-center justify-end">
                                                            {savingReadmeKey === key ? (
                                                                <Loader2 className="h-3 w-3 animate-spin text-primary" />
                                                            ) : Boolean(readmeSettingsDraft[key]) ? (
                                                                "On"
                                                            ) : (
                                                                "Off"
                                                            )}
                                                        </span>
                                                        <SettingsSwitch
                                                            checked={Boolean(readmeSettingsDraft[key])}
                                                            disabled={readmeSettingsLoading || savingReadmeKey === key}
                                                            aria-label={`Toggle ${title}`}
                                                            onCheckedChange={(checked) => void handleToggleReadmeSetting(key, checked)}
                                                        />
                                                    </div>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </SettingsCard>
                        </div>
                    </section>
                )}

                {/* activeSection === "updates" && ( */}
                {sections.some((s) => s.id === "updates") && (
                    <section id="project-settings-updates" data-project-settings-section className="space-y-6">
                        <div className="space-y-6">
                            <SettingsCard
                                title="Project updates"
                                description="Configure member publishing permissions and broadcast settings for project progress updates."
                            >
                                <div className="space-y-6">
                                    {/* Section 1: Publishing Permissions */}
                                    <div className="space-y-3">
                                        <div className="flex items-center justify-between border-b border-border/60 pb-2">
                                            <div className="flex items-center gap-2">
                                                <SlidersHorizontal className="size-4 text-muted-foreground" />
                                                <span className="nb-ui-label text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                                    Publishing Permissions
                                                </span>
                                            </div>
                                            <span className="nb-meta text-xs text-muted-foreground">
                                                {memberUpdatesEnabled ? "Open collaboration" : "Restricted to leadership"}
                                            </span>
                                        </div>

                                        <div className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="nb-ui-label text-sm font-semibold text-foreground">
                                                        Allow members to post updates
                                                    </p>
                                                    <span
                                                        className={cn(
                                                            "inline-flex h-5 items-center rounded-[3px] border px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none",
                                                            memberUpdatesEnabled
                                                                ? "border-primary/20 bg-primary/10 text-primary"
                                                                : "border-border bg-muted/60 text-muted-foreground",
                                                        )}
                                                    >
                                                        {memberUpdatesEnabled ? "Members enabled" : "Leaders only"}
                                                    </span>
                                                </div>
                                                <p className="nb-compact mt-1 text-xs text-muted-foreground leading-relaxed">
                                                    When enabled, all verified project members can author and publish progress updates. When disabled, update authoring is restricted exclusively to the Project Owner and Co-leaders.
                                                </p>
                                            </div>
                                            <div className="flex shrink-0 items-center gap-3">
                                                <span className="nb-meta text-muted-foreground select-none w-6 text-right flex items-center justify-end">
                                                    {savingMemberUpdates ? (
                                                        <Loader2 className="h-3 w-3 animate-spin text-primary" />
                                                    ) : memberUpdatesEnabled ? (
                                                        "On"
                                                    ) : (
                                                        "Off"
                                                    )}
                                                </span>
                                                <SettingsSwitch
                                                    checked={memberUpdatesEnabled}
                                                    disabled={savingMemberUpdates}
                                                    aria-label="Allow members to post updates"
                                                    onCheckedChange={(checked) => void handleToggleMemberUpdates(checked)}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            </SettingsCard>
                        </div>
                    </section>
                )}

                {/* activeSection === "tasks-workflow" && ( */}
                {sections.some((s) => s.id === "tasks-workflow") && (
                    <section id="project-settings-tasks-workflow" data-project-settings-section className="space-y-6">
                        <div className="space-y-6">
                            <LifecycleSettingsEditor
                                initialStages={project?.lifecycle_stages || project?.lifecycleStages || ["Concept", "MVP", "Launch"]}
                                currentStageIndex={project?.current_stage_index ?? project?.currentStageIndex ?? 0}
                                isSaving={savingLifecycle}
                                onSave={async (stages: string[], currentActiveStage: string) => {
                                    setSavingLifecycle(true);
                                    try {
                                        const result = await updateProjectLifecycleAction(projectId, stages, currentActiveStage);
                                        if (result.success) {
                                            toast.success("Lifecycle updated.");
                                            onProjectUpdated();
                                            router.refresh();
                                        } else {
                                            toast.error(result.error || "Failed to update lifecycle.");
                                        }
                                    } catch (error) {
                                        console.error("Failed to update lifecycle", error);
                                        toast.error("Failed to update lifecycle.");
                                    } finally {
                                        setSavingLifecycle(false);
                                    }
                                }}
                            />
                        </div>
                    </section>
                )}

                {/* activeSection === "files-workspace" && ( */}
                {sections.some((s) => s.id === "files-workspace") && (
                    <section id="project-settings-files-workspace" data-project-settings-section className="space-y-6">
                        <SettingsCard
                            title="Files and workspace"
                            description="Control file intake clearly: leaders can always upload, members can be toggled on or off, and viewers stay read-focused."
                            footer={
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 w-full">
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                        <span className="nb-meta inline-flex items-center gap-1.5">
                                            <span className="size-1.5 rounded-[1px] bg-primary" />
                                            {fileWorkspaceData?.summary.alwaysAllowedCount ?? 0} leaders always allowed
                                        </span>
                                        <span>·</span>
                                        <span className="nb-meta">{fileWorkspaceData?.summary.enabledMemberCount ?? 0} members enabled</span>
                                        <span>·</span>
                                        <span className="nb-meta">{fileWorkspaceData?.summary.disabledMemberCount ?? 0} disabled</span>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={fileWorkspaceLoading}
                                        onClick={() => void loadFileWorkspaceSettings(true)}
                                        className="h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium gap-2 self-start sm:self-auto border-border hover:bg-muted/50"
                                    >
                                        <RefreshCw className={cn("size-3.5", fileWorkspaceLoading && "animate-spin")} />
                                        Refresh
                                    </Button>
                                </div>
                            }
                        >
                            <FileWorkspaceMembers
                                data={fileWorkspaceData}
                                isLoading={fileWorkspaceLoading && !fileWorkspaceData}
                                savingMemberId={fileWorkspaceSavingMemberId}
                                bulkSaving={fileWorkspaceBulkSaving}
                                onToggle={handleToggleMemberFileUpload}
                                onBulkToggle={handleBulkFileUploadPermission}
                                filePolicy={filePolicy}
                            />
                        </SettingsCard>
                    </section>
                )}

                {/* activeSection === "notifications" && ( */}
                {sections.some((s) => s.id === "notifications") && (
                    <section id="project-settings-notifications" data-project-settings-section className="space-y-6">
                        <div className="space-y-6">
                            <SettingsCard
                                title="Project notification policy"
                                description="Configure workflow event triggers and delivery rules across 7 core project categories. Critical responsibility and safety events stay locked on."
                                footer={
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 w-full">
                                        <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                            <span className="nb-meta inline-flex items-center gap-1.5">
                                                <span className="size-1.5 rounded-[1px] bg-primary" />
                                                {notificationSummary.enabledCount}/{notificationSummary.visibleCount} triggers active
                                            </span>
                                            <span>·</span>
                                            <span className="nb-meta">
                                                {notificationSummary.mandatoryCount} mandatory locked
                                            </span>
                                        </div>
                                        <div className="flex items-center gap-2 self-end sm:self-auto">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                disabled={!notificationDirty || savingSettings}
                                                onClick={handleCancelNotifications}
                                                className="h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2] border-border hover:bg-muted/50"
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                disabled={!notificationDirty || savingSettings}
                                                onClick={() => void handleSaveNotifications()}
                                                className="h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2] gap-1.5"
                                            >
                                                {savingSettings ? <Loader2 className="size-3.5 animate-spin" /> : null}
                                                Save changes
                                            </Button>
                                        </div>
                                    </div>
                                }
                            >
                                <div className="space-y-6">
                                    {/* Workflow Event Triggers Header & Controls */}
                                    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-border/60 pb-3">
                                        <div>
                                            <div className="flex items-center gap-2">
                                                <Bell className="size-4 text-foreground" />
                                                <h3 className="nb-ui-label text-xs font-semibold uppercase tracking-wider text-foreground">
                                                    Workflow Event Triggers
                                                </h3>
                                            </div>
                                            <p className="nb-compact mt-0.5 text-xs text-muted-foreground leading-relaxed">
                                                36 triggers organized across 7 core workflow categories. Click any category trigger to expand and customize event delivery.
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Button
                                                type="button"
                                                variant="outline"
                                                size="sm"
                                                onClick={toggleAllNotificationGroups}
                                                className="h-[28px] rounded-[5px] px-2.5 text-xs font-medium border-border hover:bg-muted/50"
                                            >
                                                {areAllNotificationGroupsExpanded ? "Collapse all" : "Expand all"}
                                            </Button>
                                        </div>
                                    </div>

                                    {/* 7 Workflow Category Dropdown Cards */}
                                    {projectNotificationLoading ? (
                                        <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                                            <Loader2 className="size-4 animate-spin" />
                                            Loading notification controls...
                                        </div>
                                    ) : (
                                        <div className="space-y-3">
                                            {notificationGroups.map((group) => (
                                                <ProjectNotificationCategoryCard
                                                    key={group.id}
                                                    group={group}
                                                    policy={projectNotificationDraft}
                                                    isExpanded={Boolean(expandedNotificationGroups[group.id])}
                                                    onToggleExpand={() => toggleNotificationGroup(group.id)}
                                                    onToggleRule={handleProjectNotificationToggle}
                                                    disabled={savingSettings}
                                                />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </SettingsCard>
                        </div>
                    </section>
                )}

                {/* activeSection === "privacy-policies" && ( */}
                {sections.some((s) => s.id === "privacy-policies" || s.id === "privacy-terms") && (
                    <section id="project-settings-privacy-policies" data-project-settings-section className="space-y-6">
                        <LegalAndDataRightsSection />
                    </section>
                )}

                {/* activeSection === "danger" && ( */}
                {sections.some((s) => s.id === "danger") && (
                    <section id="project-settings-danger" data-project-settings-section className="space-y-6">
                        <SettingsCard
                            title="Danger Zone"
                            description="Irreversible and sensitive project operations. Archive to preserve read-only history, transfer ownership to a team member, or permanently delete."
                            danger
                        footer={
                            <>
                                <div className="flex flex-wrap items-center gap-2">
                                    <span className="size-1.5 rounded-full bg-destructive/80" />
                                    <span className="nb-meta text-muted-foreground">
                                        {dangerPreflightLoading ? (
                                            <span className="inline-flex items-center gap-1.5">
                                                <Loader2 className="size-3 animate-spin" />
                                                Running preflight safety checks...
                                            </span>
                                        ) : dangerPreflight ? (
                                            <span>Preflight verified · Status: {preflightPolicy.status.toUpperCase()} · {preflightPolicy.affectedAreas.join(" · ")}</span>
                                        ) : (
                                            <span>Preflight safety checks pending</span>
                                        )}
                                    </span>
                                </div>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => void loadDangerPreflight(true)}
                                    disabled={dangerPreflightLoading}
                                    className="h-[28px] gap-1.5 rounded-[5px] border-border px-2.5 text-xs font-medium"
                                >
                                    <RefreshCw className={cn("size-3.5", dangerPreflightLoading && "animate-spin")} />
                                    Refresh checks
                                </Button>
                            </>
                        }
                    >
                        <div className="space-y-4">
                            {/* Operation 1: Archive Project */}
                            <div className="rounded-[6px] border border-border bg-card p-5 sm:p-6 transition-colors">
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0 flex-1 space-y-1.5">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="nb-ui-label text-sm font-semibold text-foreground">Archive this project</span>
                                            <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-muted-foreground">
                                                {preflightPolicy.status === "archived" ? "ARCHIVED" : "ACTIVE"}
                                            </span>
                                            <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/40 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-muted-foreground">
                                                REVERSIBLE
                                            </span>
                                        </div>
                                        <p className="nb-compact text-[13px] leading-[1.5] text-muted-foreground max-w-[64ch]">
                                            {preflightPolicy.status === "archived"
                                                ? "This project is currently archived and in read-only mode. Existing members retain historical access to all records."
                                                : "Mark this project as read-only. Existing members keep historical access, but tasks, intake, and publishing are paused."}
                                        </p>
                                        {dangerPreflight && preflightPolicy.status !== "archived" && (preflightPolicy.activeTasksCount > 0 || preflightPolicy.openRolesCount > 0) ? (
                                            <p className="nb-meta text-[11px] text-muted-foreground/80">
                                                Affects {preflightPolicy.activeTasksCount} active task{preflightPolicy.activeTasksCount === 1 ? "" : "s"} and {preflightPolicy.openRolesCount} open role{preflightPolicy.openRolesCount === 1 ? "" : "s"}.
                                            </p>
                                        ) : null}
                                    </div>
                                    <div className="shrink-0 pt-1 sm:pt-0">
                                        <Button
                                            variant="outline"
                                            onClick={prepareArchive}
                                            disabled={confirmLoading || dangerPreflightLoading || !dangerPreflight || !preflightPolicy.canArchive}
                                            className="h-[34px] gap-2 rounded-[5px] border-border px-3.5 text-[13px] font-medium"
                                        >
                                            <Archive className="h-4 w-4" />
                                            {preflightPolicy.status === "archived" ? "Archived" : "Archive project"}
                                        </Button>
                                    </div>
                                </div>
                            </div>

                            {/* Operation 2: Transfer Ownership */}
                            <div className="rounded-[6px] border border-border bg-card p-5 sm:p-6 transition-colors">
                                <div className="space-y-3">
                                    <div className="space-y-1.5">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="nb-ui-label text-sm font-semibold text-foreground">Transfer ownership</span>
                                            <span className="inline-flex h-5 items-center rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-amber-700 dark:text-amber-400">
                                                OWNER ONLY
                                            </span>
                                            <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/40 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-muted-foreground">
                                                STEP-UP PROTECTED
                                            </span>
                                        </div>
                                        <p className="nb-compact text-[13px] leading-[1.5] text-muted-foreground max-w-[64ch]">
                                            Transfer primary ownership and administrative authority of this project to an existing team member. You will become an administrator and surrender destructive management privileges.
                                        </p>
                                    </div>

                                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                                        <div className="min-w-0 flex-1">
                                            <label htmlFor="project-transfer-owner" className="sr-only">New owner</label>
                                            <select
                                                id="project-transfer-owner"
                                                value={transferOwnerId}
                                                onChange={(event) => setTransferOwnerId(event.target.value)}
                                                className="h-[34px] w-full rounded-[5px] border border-border bg-card px-3 text-[13px] text-foreground outline-none transition-colors focus:border-primary"
                                                disabled={confirmLoading || !isProjectOwner || rolePolicy.transferCandidates.length === 0}
                                            >
                                                <option value="">Choose an existing member...</option>
                                                {rolePolicy.transferCandidates.map((member) => (
                                                    <option key={member.id} value={member.id}>
                                                        {getProjectMemberDisplayName(member)} · {getProjectMemberRoleLabel(projectMemberRole(member, ownerId))}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                        <Button
                                            variant="destructive"
                                            onClick={prepareTransfer}
                                            disabled={confirmLoading || !isProjectOwner || rolePolicy.transferCandidates.length === 0 || !transferOwnerId}
                                            className="h-[34px] shrink-0 gap-2 rounded-[5px] px-3.5 text-[13px] font-medium"
                                        >
                                            <Crown className="h-4 w-4" />
                                            Transfer ownership
                                        </Button>
                                    </div>

                                    {/* Preview selected candidate chip */}
                                    {(() => {
                                        const selectedMember = rolePolicy.transferCandidates.find((m) => m.id === transferOwnerId);
                                        if (!selectedMember) return null;
                                        return (
                                            <div className="flex items-center justify-between rounded-[5px] border border-border bg-muted/20 px-3 py-2 text-xs">
                                                <div className="flex items-center gap-2 min-w-0">
                                                    <div className="flex size-6 shrink-0 items-center justify-center rounded-[3px] bg-muted font-mono text-[10px] font-semibold text-muted-foreground uppercase">
                                                        {getProjectMemberDisplayName(selectedMember).slice(0, 2)}
                                                    </div>
                                                    <span className="nb-ui-label truncate text-foreground font-medium">
                                                        {getProjectMemberDisplayName(selectedMember)}
                                                    </span>
                                                    {selectedMember.username ? (
                                                        <span className="nb-meta text-muted-foreground truncate">
                                                            @{selectedMember.username}
                                                        </span>
                                                    ) : null}
                                                </div>
                                                <span className="inline-flex h-5 shrink-0 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-muted-foreground">
                                                    {getProjectMemberRoleLabel(projectMemberRole(selectedMember, ownerId))}
                                                </span>
                                            </div>
                                        );
                                    })()}

                                    {!isProjectOwner ? (
                                        <p className="nb-compact text-xs text-muted-foreground">
                                            Only the current project owner can transfer ownership.
                                        </p>
                                    ) : rolePolicy.transferCandidates.length === 0 ? (
                                        <p className="nb-compact text-xs text-amber-700 dark:text-amber-400">
                                            Add at least one team member to this project before ownership can be transferred.
                                        </p>
                                    ) : null}
                                </div>
                            </div>

                            {/* Operation 3: Delete Project */}
                            <div className="rounded-[6px] border border-destructive/20 bg-destructive/[0.02] p-5 sm:p-6 transition-colors">
                                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                    <div className="min-w-0 flex-1 space-y-1.5">
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="nb-ui-label text-sm font-semibold text-destructive">Delete this project</span>
                                            <span className="inline-flex h-5 items-center rounded-[3px] border border-destructive/20 bg-destructive/10 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-destructive">
                                                PERMANENT
                                            </span>
                                            <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/40 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-muted-foreground">
                                                IRREVERSIBLE
                                            </span>
                                        </div>
                                        <p className="nb-compact text-[13px] leading-[1.5] text-muted-foreground max-w-[64ch]">
                                            Permanently delete this project and all associated workspaces, tasks, documents, and discussions. Once deleted, this action cannot be recovered.
                                        </p>
                                        {dangerPreflight && preflightPolicy.affectedAreas.length > 0 ? (
                                            <p className="nb-meta text-[11px] text-destructive/80">
                                                Preflight: {preflightPolicy.affectedAreas.join(" · ")}
                                            </p>
                                        ) : null}
                                        {!isProjectOwner ? (
                                            <p className="nb-compact text-xs text-muted-foreground mt-1">
                                                Only the project owner can delete this project.
                                            </p>
                                        ) : null}
                                    </div>
                                    <div className="shrink-0 pt-1 sm:pt-0">
                                        <Button
                                            variant="destructive"
                                            onClick={prepareDelete}
                                            disabled={confirmLoading || dangerPreflightLoading || !dangerPreflight || !isProjectOwner || !preflightPolicy.canDelete}
                                            className="h-[34px] gap-2 rounded-[5px] px-3.5 text-[13px] font-medium"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                            Delete project
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </SettingsCard>
                    </section>
                )}
            </main>

            <ConfirmDialog
                open={Boolean(confirmAction)}
                onOpenChange={(open) => {
                    if (!open && !confirmLoading) {
                        setConfirmAction(null);
                        setRemovalPreflightDialog(null);
                        setMemberNotificationData(null);
                        setMemberNotificationDraft(normalizeProjectMemberNotificationOverrides(null));
                    }
                }}
                title={confirmAction?.title ?? ""}
                description={confirmAction?.description}
                confirmLabel={confirmAction?.confirmLabel ?? "Confirm"}
                variant={confirmAction?.variant ?? "destructive"}
                loading={confirmLoading}
                autoCloseOnConfirm={false}
                onConfirm={runConfirmAction}
            >
                {confirmDialogContent}
            </ConfirmDialog>

            {/* Danger Zone Specific High-Stakes Confirmation Modals */}
            <ProjectArchiveModal
                open={archiveModalOpen}
                onOpenChange={setArchiveModalOpen}
                isArchived={preflightPolicy.status === "archived"}
                activeTasksCount={preflightPolicy.activeTasksCount}
                openRolesCount={preflightPolicy.openRolesCount}
                loading={confirmLoading}
                onConfirmArchive={handleExecuteArchive}
            />

            <ProjectTransferOwnershipModal
                open={transferModalOpen}
                onOpenChange={setTransferModalOpen}
                candidate={selectedTransferCandidate}
                projectSlug={project.slug || ""}
                projectTitle={project.title}
                loading={confirmLoading}
                onConfirmTransfer={handleExecuteTransfer}
            />

            <ProjectDeleteModal
                open={deleteModalOpen}
                onOpenChange={setDeleteModalOpen}
                projectSlug={project.slug || ""}
                projectTitle={project.title}
                preflight={dangerPreflight ? {
                    activeTasksCount: preflightPolicy.activeTasksCount,
                    openRolesCount: preflightPolicy.openRolesCount,
                    pendingApplicationsCount: dangerPreflight.pendingApplicationsCount,
                    affectedAreas: preflightPolicy.affectedAreas,
                } : null}
                loading={confirmLoading}
                onConfirmDelete={handleExecuteDelete}
            />
        </div>
    );
}

function SectionHeader({
    title,
    description,
    dirty,
    saving,
    onCancel,
    onSave,
}: {
    title: string;
    description: string;
    dirty: boolean;
    saving: boolean;
    onCancel: () => void;
    onSave: () => void;
}) {
    return (
        <div className="rounded-lg border border-border bg-card p-6 shadow-none">
            <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                <div>
                    <p className="nb-micro">Settings</p>
                    <h3 className="nb-section-title mt-2 text-foreground">{title}</h3>
                    <p className="nb-compact mt-2 max-w-[64ch] text-muted-foreground">{description}</p>
                </div>
                {dirty ? (
                    <div className="flex shrink-0 items-center gap-2 rounded-md border border-[var(--nb-border-amber,#F6E7C2)] bg-[var(--nb-soft-amber,#FBF4E2)] p-2 dark:border-amber-900/60 dark:bg-amber-950/20">
                        <span className="px-2 font-mono text-xs font-semibold uppercase tracking-wider text-[var(--nb-text-amber,#9A6B00)] dark:text-amber-300">Unsaved</span>
                        <Button variant="outline" size="sm" onClick={onCancel} disabled={saving} className="rounded-md">
                            Cancel
                        </Button>
                        <Button size="sm" onClick={onSave} disabled={saving} className="rounded-md">
                            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : "Save"}
                        </Button>
                    </div>
                ) : null}
            </div>
        </div>
    );
}

function SummaryCard({
    title,
    description,
    icon: Icon,
    meta,
    tone = "default",
}: {
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    meta: Array<[string, string]>;
    tone?: "default" | "danger";
}) {
    return (
        <section className={cn(
            "min-w-0 rounded-lg border p-5 shadow-none",
            tone === "danger"
                ? "border-destructive/30 bg-destructive/5 text-destructive"
                : "border-border bg-card",
        )}>
            <div className="flex items-start gap-4">
                <div className={cn(
                    "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg",
                    tone === "danger" ? "bg-destructive/10 text-destructive" : "bg-muted text-foreground",
                )}>
                    <Icon className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                    <h4 className="nb-ui-label text-base font-semibold text-foreground">{title}</h4>
                    <p className="nb-compact mt-1 text-sm text-muted-foreground leading-relaxed">{description}</p>
                    <div className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                        {meta.map(([label, value]) => (
                            <div key={label} className="rounded-lg border border-border bg-muted/20 px-3 py-2">
                                <p className="nb-micro text-muted-foreground">{label}</p>
                                <p className="mt-1 truncate text-sm font-semibold capitalize text-foreground">{value}</p>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </section>
    );
}

function SettingsCard({
    title,
    description,
    children,
    footer,
    danger = false,
    className,
}: {
    title: string;
    description?: string;
    children: React.ReactNode;
    footer?: React.ReactNode;
    danger?: boolean;
    className?: string;
}) {
    return (
        <section
            className={cn(
                "min-w-0 rounded-lg border bg-card shadow-none",
                danger
                    ? "border-destructive/30 bg-destructive/5"
                    : "border-border",
                className,
            )}
        >
            <div className="border-b border-border p-6">
                <h4 className={cn("nb-card-title", danger ? "text-destructive" : "text-foreground")}>{title}</h4>
                {description ? (
                    <p className={cn("nb-compact mt-1", danger ? "text-destructive/80" : "text-muted-foreground")}>{description}</p>
                ) : null}
            </div>
            <div className="p-6">{children}</div>
            {footer ? (
                <div className="flex flex-col gap-3 border-t border-border bg-muted/10 px-6 py-4 sm:flex-row sm:items-center sm:justify-between">
                    {footer}
                </div>
            ) : null}
        </section>
    );
}

function TextField({
    label,
    value,
    onChange,
    placeholder,
    description,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    description?: string;
}) {
    return (
        <label className="space-y-1.5 block">
            <span className="nb-ui-label text-foreground">{label}</span>
            {description ? <span className="nb-compact -mt-0.5 block text-muted-foreground">{description}</span> : null}
            <input
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                className="h-[34px] w-full rounded-[5px] border border-border bg-card px-3 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
        </label>
    );
}

function TextAreaField({
    label,
    value,
    onChange,
    placeholder,
    description,
}: {
    label: string;
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    description?: string;
}) {
    return (
        <label className="space-y-1.5 block">
            <span className="nb-ui-label text-foreground">{label}</span>
            {description ? <span className="nb-compact -mt-0.5 block text-muted-foreground">{description}</span> : null}
            <textarea
                value={value}
                onChange={(event) => onChange(event.target.value)}
                placeholder={placeholder}
                rows={4}
                className="min-h-[80px] w-full resize-y rounded-[5px] border border-border bg-card px-3 py-2 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
        </label>
    );
}

function ReadOnlySlugField({ slug }: { slug: string }) {
    const [copied, setCopied] = useState(false);
    const normalizedSlug = slug.trim() || "Not set";
    const handleCopy = useCallback(async () => {
        const trimmedSlug = slug.trim();
        if (!trimmedSlug || typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
        try {
            await navigator.clipboard.writeText(trimmedSlug);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1600);
        } catch (error) {
            console.error("Failed to copy project slug", error);
            toast.error("Failed to copy slug.");
        }
    }, [slug]);

    return (
        <div className="space-y-1.5">
            <span className="nb-ui-label text-foreground">Project slug</span>
            <div className="flex flex-col gap-2 rounded-[5px] border border-border bg-muted/40 px-3.5 py-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                    <p className="truncate font-mono text-sm font-medium text-foreground">{normalizedSlug}</p>
                    <p className="nb-compact mt-1 text-muted-foreground">
                        Project links use this slug. Editing is locked for now to avoid broken links and stale share previews.
                    </p>
                </div>
                {slug.trim() ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => void handleCopy()} className="h-[28px] shrink-0 rounded-[5px] border-border px-2.5 text-xs font-medium text-foreground hover:bg-muted">
                        {copied ? "Copied" : "Copy"}
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

function CategorySelector({
    choice,
    customValue,
    onChoiceChange,
    onCustomChange,
    description,
}: {
    choice: string;
    customValue: string;
    onChoiceChange: (value: string) => void;
    onCustomChange: (value: string) => void;
    description?: string;
}) {
    return (
        <div className="space-y-3">
            <label className="space-y-1.5 block">
                <span className="nb-ui-label text-foreground">Category</span>
                {description ? <span className="nb-compact -mt-0.5 block text-muted-foreground">{description}</span> : null}
                <select
                    value={choice}
                    onChange={(event) => onChoiceChange(event.target.value)}
                    className="h-[34px] w-full rounded-[5px] border border-border bg-card px-3 text-[13px] leading-[1.5] text-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                    <option value="">Choose a category</option>
                    {PROJECT_TYPE_OPTIONS.map((type) => (
                        <option key={type.id} value={type.id}>
                            {type.label}
                        </option>
                    ))}
                    <option value={OTHER_PROJECT_TYPE_ID}>Others</option>
                </select>
            </label>
            {choice === OTHER_PROJECT_TYPE_ID ? (
                <TextField
                    label="Custom category"
                    value={customValue}
                    onChange={onCustomChange}
                    placeholder="Enter a custom category"
                />
            ) : null}
        </div>
    );
}

function ChipEditor({
    label,
    description,
    values,
    onChange,
    suggestions,
    placeholder,
    tone,
    prefix = "",
    limit,
}: {
    label: string;
    description?: string;
    values: string[];
    onChange: (values: string[]) => void;
    suggestions: readonly string[];
    placeholder: string;
    tone?: "indigo" | "emerald";
    prefix?: string;
    limit: number;
}) {
    const [draft, setDraft] = useState("");
    const addValue = useCallback((rawValue: string) => {
        const nextValue = rawValue.trim();
        if (!nextValue) return;
        if (values.length >= limit) {
            toast.error(`${label} can include up to ${limit} items.`);
            return;
        }
        if (values.some((value) => value.toLowerCase() === nextValue.toLowerCase())) {
            setDraft("");
            return;
        }
        onChange([...values, nextValue]);
        setDraft("");
    }, [label, limit, onChange, values]);
    const removeValue = useCallback((value: string) => {
        onChange(values.filter((item) => item !== value));
    }, [onChange, values]);

    return (
        <div className="min-w-0">
            <div className="flex items-center justify-between gap-3">
                <label className="nb-ui-label text-foreground">{label}</label>
                <span className="nb-compact text-muted-foreground">{values.length}/{limit}</span>
            </div>
            {description ? (
                <p className="nb-compact mt-1 text-muted-foreground">{description}</p>
            ) : null}
            <div className="mt-2 rounded-lg border border-border bg-muted/20 p-4">
                {values.length > 0 ? (
                    <div className="mb-3 flex min-w-0 flex-wrap gap-2">
                        {values.map((value) => (
                            <span
                                key={value}
                                className="inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-[3px] border border-border bg-muted/60 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.09em] text-foreground transition-colors hover:border-border/80"
                            >
                                <span className="truncate">{prefix}{value}</span>
                                <button
                                    type="button"
                                    onClick={() => removeValue(value)}
                                    className="text-muted-foreground opacity-70 transition-opacity hover:opacity-100"
                                    aria-label={`Remove ${value}`}
                                >
                                    <X className="h-3.5 w-3.5" />
                                </button>
                            </span>
                        ))}
                    </div>
                ) : null}
                <div className="flex gap-2">
                    <input
                        value={draft}
                        onChange={(event) => setDraft(event.target.value)}
                        onKeyDown={(event) => {
                            if (event.key !== "Enter") return;
                            event.preventDefault();
                            addValue(draft);
                        }}
                        className="h-[34px] min-w-0 flex-1 rounded-[5px] border border-border bg-card px-3 text-[13px] leading-[1.5] text-foreground placeholder:text-muted-foreground transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                        placeholder={placeholder}
                        disabled={values.length >= limit}
                    />
                    <Button
                        type="button"
                        variant="outline"
                        onClick={() => addValue(draft)}
                        disabled={values.length >= limit}
                        className="h-[34px] w-[34px] shrink-0 p-0 rounded-[5px] border-border text-foreground hover:bg-muted"
                        aria-label={`Add ${label.toLowerCase()}`}
                    >
                        <Plus className="h-4 w-4" />
                    </Button>
                </div>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
                {suggestions
                    .filter((suggestion) => !values.some((value) => value.toLowerCase() === suggestion.toLowerCase()))
                    .slice(0, 5)
                    .map((suggestion) => (
                        <button
                            key={suggestion}
                            type="button"
                            onClick={() => addValue(suggestion)}
                            disabled={values.length >= limit}
                            className="rounded-[3px] border border-border/60 bg-muted/40 px-2 py-0.5 font-mono text-[11px] uppercase tracking-[0.09em] text-muted-foreground transition hover:border-border hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            + {suggestion}
                        </button>
                    ))}
            </div>
        </div>
    );
}

function formatJoinedAt(value?: string | null) {
    if (!value) return "Joined date unavailable";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Joined date unavailable";
    return `Joined ${new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" }).format(date)}`;
}

function responsibilityHints(member: ProjectSettingsMember) {
    const counts = member.responsibilityCounts;
    if (!counts) return [];
    return [
        counts.activeAssignedTasks > 0 ? `${counts.activeAssignedTasks} active assigned` : null,
        counts.activeCreatedTasks > 0 ? `${counts.activeCreatedTasks} created active` : null,
        counts.fileReviews > 0 ? `${counts.fileReviews} file review` : null,
        counts.acceptedApplications > 0 ? `${counts.acceptedApplications} accepted role` : null,
        counts.projectGroupParticipant ? "Project group" : null,
    ].filter((item): item is string => Boolean(item));
}

function CollaboratorCard({
    member,
    ownerId,
    isProjectOwner,
    actorRole,
    onRoleChange,
    onRemove,
    onTransfer,
    onNotificationSettings,
}: {
    member: ProjectSettingsMember;
    ownerId: string | null;
    isProjectOwner: boolean;
    actorRole: ProjectMemberRole;
    onRoleChange: (member: ProjectSettingsMember, role: Exclude<ProjectMemberRole, "owner">) => void;
    onRemove: (member: ProjectSettingsMember) => void | Promise<void>;
    onTransfer: (member: ProjectSettingsMember) => void;
    onNotificationSettings: (member: ProjectSettingsMember) => void | Promise<void>;
}) {
    const role = projectMemberRole(member, ownerId) as ProjectMemberRole;
    const reference = buildProjectPersonReference({
        person: {
            id: member.id,
            fullName: getProjectMemberDisplayName(member),
            username: member.username ?? null,
            avatarUrl: member.avatarUrl ?? null,
        },
        membershipRole: role,
        isActiveMember: true,
    });
    const mutationPolicy = buildProjectMemberMutationPolicy({
        actorIsOwner: isProjectOwner,
        actorRole,
        ownerId,
        targetUserId: member.id,
        targetRole: role,
    });
    const hints = responsibilityHints(member);
    const roleOptions: Array<Exclude<ProjectMemberRole, "owner">> = ["admin", "member", "viewer"];

    return (
        <article className="flex flex-col justify-between rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20">
            <div>
                <div className="flex items-start justify-between gap-3">
                    <div className="flex items-start gap-3 min-w-0">
                        <UserAvatar
                            identity={{
                                id: member.id,
                                fullName: reference.displayName,
                                username: member.username ?? null,
                                avatarUrl: reference.avatarUrl,
                            }}
                            size={44}
                            roundedClassName="rounded-[5px]"
                            className="border border-border shrink-0"
                        />
                        <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                                <p className="nb-ui-label truncate text-sm font-semibold text-foreground">{reference.displayName}</p>
                                <span
                                    className={cn(
                                        "h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none shrink-0 inline-flex items-center border",
                                        role === "owner"
                                            ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                            : role === "admin"
                                                ? "border-primary/20 bg-primary/10 text-primary"
                                                : role === "viewer"
                                                    ? "border-border bg-muted/60 text-muted-foreground"
                                                    : "border-border bg-muted text-foreground",
                                    )}
                                >
                                    {reference.roleLabel}
                                </span>
                                {!reference.isAssignable ? (
                                    <span className="h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none shrink-0 inline-flex items-center border border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                                        Not assignable
                                    </span>
                                ) : null}
                            </div>
                            <p className="nb-compact mt-1 truncate text-xs text-muted-foreground">
                                {member.projectRoleTitle || (member.username ? `@${member.username}` : member.id)}
                            </p>
                            <p className="nb-meta mt-0.5 text-[11px] text-muted-foreground/80">{formatJoinedAt(member.joinedAt)}</p>
                        </div>
                    </div>

                    <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="h-[28px] gap-1 rounded-[5px] border-border px-2.5 text-xs font-medium text-foreground shrink-0 hover:bg-muted"
                            >
                                Actions
                                <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-52">
                            {role !== "owner" ? (
                                roleOptions.map((option) => {
                                    const optionPolicy = buildProjectMemberMutationPolicy({
                                        actorIsOwner: isProjectOwner,
                                        actorRole,
                                        ownerId,
                                        targetUserId: member.id,
                                        targetRole: role,
                                        nextRole: option,
                                    });
                                    return (
                                        <DropdownMenuItem
                                            key={option}
                                            disabled={!optionPolicy.canChangeRole || role === option}
                                            onClick={() => onRoleChange(member, option)}
                                            className="gap-2 text-xs"
                                        >
                                            {option === "admin" ? (
                                                <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
                                            ) : option === "viewer" ? (
                                                <Eye className="h-3.5 w-3.5 text-muted-foreground" />
                                            ) : (
                                                <Users className="h-3.5 w-3.5 text-muted-foreground" />
                                            )}
                                            <span>Change role to {getProjectMemberRoleLabel(option)}</span>
                                            {role === option ? (
                                                <span className="ml-auto text-[10px] text-muted-foreground">(Current)</span>
                                            ) : null}
                                        </DropdownMenuItem>
                                    );
                                })
                            ) : (
                                <DropdownMenuItem disabled className="gap-2 text-xs">
                                    <Crown className="h-3.5 w-3.5 text-amber-500" />
                                    <span>Project Lead</span>
                                </DropdownMenuItem>
                            )}

                            <DropdownMenuSeparator />

                            {mutationPolicy.canTransferOwnership ? (
                                <DropdownMenuItem
                                    onClick={() => onTransfer(member)}
                                    className="gap-2 text-xs text-foreground"
                                >
                                    <Crown className="h-3.5 w-3.5 text-amber-500" />
                                    <span>Transfer ownership</span>
                                </DropdownMenuItem>
                            ) : null}

                            <DropdownMenuItem
                                onClick={() => void onNotificationSettings(member)}
                                className="gap-2 text-xs text-foreground"
                            >
                                <Bell className="h-3.5 w-3.5 text-muted-foreground" />
                                <span>Notification settings</span>
                            </DropdownMenuItem>

                            {mutationPolicy.canRemove ? (
                                <>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={() => void onRemove(member)}
                                        className="gap-2 text-xs text-destructive focus:bg-destructive/10 focus:text-destructive"
                                    >
                                        <UserMinus className="h-3.5 w-3.5" />
                                        <span>Remove member</span>
                                    </DropdownMenuItem>
                                </>
                            ) : null}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>

                {hints.length > 0 ? (
                    <div className="mt-3 flex flex-wrap gap-1.5 border-t border-border/40 pt-3">
                        {hints.map((hint) => (
                            <span
                                key={hint}
                                className="nb-tag text-[11px] py-0.5 px-2 font-normal text-muted-foreground"
                            >
                                {hint}
                            </span>
                        ))}
                    </div>
                ) : null}
            </div>
        </article>
    );
}

function ProjectNotificationPresetButton({
    preset,
    label,
    detail,
    activePreset,
    onSelect,
}: {
    preset: ProjectNotificationPreset;
    label: string;
    detail: string;
    activePreset: ProjectNotificationPreset;
    onSelect: (preset: ProjectNotificationPreset) => void;
}) {
    const active = activePreset === preset;
    return (
        <button
            type="button"
            aria-pressed={active}
            onClick={() => onSelect(preset)}
            className={cn(
                "group relative flex flex-col justify-between rounded-lg border p-4 text-left transition-colors",
                active
                    ? "border-primary bg-primary/5 text-foreground ring-1 ring-primary/20"
                    : "border-border bg-card text-foreground hover:border-foreground/20 hover:bg-muted/30",
            )}
        >
            <div>
                <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-foreground">{label}</span>
                    {active ? (
                        <span className="inline-flex h-5 items-center rounded-[3px] border border-primary/20 bg-primary/10 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-primary">
                            Active
                        </span>
                    ) : null}
                </div>
                <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{detail}</p>
            </div>
        </button>
    );
}

const NOTIFICATION_GROUP_ICONS = {
    membership_access: Users,
    roles_applications: UserCog,
    project_lifecycle: Workflow,
    tasks_workflow: SlidersHorizontal,
    files_workspace: Folder,
    readme: FileText,
    updates: Bell,
    security_audit: ShieldCheck,
    future: Bell,
} as const satisfies Record<ProjectNotificationGroupId, typeof Bell>;

function ProjectNotificationCategoryCard({
    group,
    policy,
    isExpanded,
    onToggleExpand,
    onToggleRule,
    disabled,
}: {
    group: {
        id: ProjectNotificationGroupId;
        title: string;
        description: string;
        entries: ProjectNotificationRegistryEntry[];
    };
    policy: ProjectNotificationPolicy;
    isExpanded: boolean;
    onToggleExpand: () => void;
    onToggleRule: (eventKey: ProjectNotificationEventKey, enabled: boolean) => void;
    disabled: boolean;
}) {
    const enabledCount = useMemo(() => {
        return group.entries.filter((entry) => {
            const decision = resolveProjectNotificationDecision({ eventKey: entry.key, projectPolicy: policy });
            return decision.enabled;
        }).length;
    }, [group.entries, policy]);

    const mandatoryCount = useMemo(() => {
        return group.entries.filter((entry) => entry.mandatory).length;
    }, [group.entries]);

    const IconComponent = NOTIFICATION_GROUP_ICONS[group.id] ?? Bell;

    return (
        <div className="rounded-lg border border-border bg-card overflow-hidden transition-colors">
            <button
                type="button"
                onClick={onToggleExpand}
                aria-expanded={isExpanded}
                aria-controls={`notification-group-${group.id}`}
                className="flex w-full items-center justify-between gap-3 p-4 text-left transition-colors hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
                <div className="flex items-center gap-3.5 min-w-0">
                    <div className="flex size-9 shrink-0 items-center justify-center rounded-[5px] border border-border bg-muted/40 text-foreground">
                        <IconComponent className="size-4 text-foreground" />
                    </div>
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                            <span className="nb-ui-label text-sm font-semibold text-foreground">
                                {group.title}
                            </span>
                            <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-muted-foreground">
                                {enabledCount}/{group.entries.length} Active
                            </span>
                            {mandatoryCount > 0 ? (
                                <span className="inline-flex h-5 items-center gap-1 rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-amber-700 dark:text-amber-400">
                                    <Lock className="size-3" />
                                    {mandatoryCount} Mandatory
                                </span>
                            ) : null}
                        </div>
                        <p className="mt-0.5 nb-compact text-xs text-muted-foreground truncate">
                            {group.description}
                        </p>
                    </div>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                    <ChevronDown
                        className={cn(
                            "size-4 text-muted-foreground transition-transform duration-200",
                            isExpanded && "rotate-180 text-foreground"
                        )}
                    />
                </div>
            </button>

            {isExpanded && (
                <div
                    id={`notification-group-${group.id}`}
                    className="border-t border-border divide-y divide-border bg-muted/5"
                >
                    {group.entries.map((entry) => (
                        <ProjectNotificationRuleRow
                            key={entry.key}
                            entry={entry}
                            policy={policy}
                            disabled={disabled}
                            onToggle={onToggleRule}
                        />
                    ))}
                </div>
            )}
        </div>
    );
}

function formatProjectNotificationRecipients(entry: ProjectNotificationRegistryEntry) {
    return entry.defaultRecipients.map((recipient) => recipient.replace(/_/g, " "));
}

function formatProjectNotificationAggregate(entry: ProjectNotificationRegistryEntry) {
    if (entry.aggregate === "burst_10m") return "10m burst";
    if (entry.aggregate === "digest_only") return "Digest";
    return "Realtime";
}

function ProjectNotificationRuleRow({
    entry,
    policy,
    disabled,
    onToggle,
}: {
    entry: ProjectNotificationRegistryEntry;
    policy: ProjectNotificationPolicy;
    disabled: boolean;
    onToggle: (eventKey: ProjectNotificationEventKey, enabled: boolean) => void;
}) {
    const decision = resolveProjectNotificationDecision({ eventKey: entry.key, projectPolicy: policy });
    const enabled = decision.enabled;
    return (
        <div className="flex items-center justify-between gap-4 p-3.5 transition-colors hover:bg-muted/10">
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                    <p className="nb-ui-label text-sm font-semibold text-foreground">{entry.label}</p>
                    {entry.mandatory ? (
                        <span className="inline-flex h-5 items-center gap-1 rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-amber-700 dark:text-amber-400">
                            <Lock className="size-3" />
                            Mandatory
                        </span>
                    ) : null}
                    <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-muted-foreground">
                        {policy.rules[entry.key]?.importance === "important" ? "Important" : "Standard"}
                    </span>
                    <span className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-muted-foreground">
                        {formatProjectNotificationAggregate(entry)}
                    </span>
                </div>
                <p className="mt-1 nb-compact text-xs text-muted-foreground leading-relaxed">{entry.description}</p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                    {formatProjectNotificationRecipients(entry).map((recipient) => (
                        <span key={recipient} className="inline-flex h-5 items-center rounded-[3px] border border-primary/20 bg-primary/10 px-[7px] font-mono text-[11px] uppercase tracking-[0.09em] leading-none text-primary">
                            {recipient}
                        </span>
                    ))}
                </div>
            </div>
            <div className="flex shrink-0 items-center gap-3">
                <span className="nb-meta text-muted-foreground select-none w-6 text-right">
                    {enabled ? "On" : "Off"}
                </span>
                <SettingsSwitch
                    checked={enabled}
                    disabled={disabled || entry.mandatory}
                    aria-label={entry.label}
                    onCheckedChange={(nextEnabled) => onToggle(entry.key, nextEnabled)}
                />
            </div>
        </div>
    );
}

function MemberNotificationSettingsEditor({
    data,
    draft,
    isLoading,
    isSaving,
    projectPolicy,
    onDraftChange,
    onSave,
    onReset,
}: {
    data: MemberNotificationSettingsData | null;
    draft: ProjectMemberNotificationOverrides;
    isLoading: boolean;
    isSaving: boolean;
    projectPolicy: ProjectNotificationPolicy;
    onDraftChange: React.Dispatch<React.SetStateAction<ProjectMemberNotificationOverrides>>;
    onSave: () => void | Promise<void>;
    onReset: () => void | Promise<void>;
}) {
    const groups = useMemo(() => groupProjectNotificationEntries(), []);
    const memberName = data?.member.fullName || data?.member.username || data?.member.id || "Member";

    if (isLoading) {
        return (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading member notification preferences...
            </div>
        );
    }

    if (!data) {
        return (
            <p className="rounded-lg border border-border bg-card p-4 text-sm text-muted-foreground">
                Member notification preferences are unavailable.
            </p>
        );
    }

    return (
        <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-border bg-card p-4">
                <p className="font-semibold text-foreground">{memberName}</p>
                <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
                    {data.canEdit
                        ? "Member preferences can reduce optional project noise. Locked responsibility and security notifications stay enabled."
                        : "Leaders can review this member's effective policy summary, but only the member can change personal notification overrides."}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                    {([
                        ["inherit", "Use project defaults"],
                        ["custom", "Customize"],
                    ] as const).map(([mode, label]) => (
                        <button
                            key={mode}
                            type="button"
                            aria-pressed={draft.mode === mode}
                            disabled={!data.canEdit}
                            onClick={() => onDraftChange((current) => ({ ...current, mode }))}
                            className={cn(
                                "h-[28px] inline-flex items-center shrink-0 whitespace-nowrap rounded-[5px] px-3 text-xs font-medium transition-colors",
                                draft.mode === mode
                                    ? "bg-foreground text-background shadow-xs"
                                    : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                            )}
                        >
                            {label}
                        </button>
                    ))}
                </div>
            </div>

            {draft.mode === "custom" ? (
                <div className="max-h-[52vh] space-y-3 overflow-y-auto pr-1 app-scroll app-scroll-y app-scroll-gutter">
                    {groups.map((group) => (
                        <div key={group.id} className="rounded-lg border border-border overflow-hidden">
                            <div className="border-b border-border bg-muted/30 px-3 py-2">
                                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{group.title}</p>
                            </div>
                            <div className="divide-y divide-border bg-card">
                                {group.entries.map((entry) => (
                                    <MemberNotificationRuleRow
                                        key={entry.key}
                                        entry={entry}
                                        projectPolicy={projectPolicy}
                                        draft={draft}
                                        canEdit={data.canEdit}
                                        onDraftChange={onDraftChange}
                                    />
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            ) : (
                <p className="rounded-lg border border-border bg-card p-4 text-xs leading-relaxed text-muted-foreground">
                    This member inherits the project-level policy. Changes to project defaults will automatically apply to optional triggers.
                </p>
            )}

            <div className="flex flex-wrap justify-end gap-2">
                <Button
                    type="button"
                    variant="outline"
                    disabled={isSaving || !data.canEdit}
                    onClick={() => void onReset()}
                    className="h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium border-border hover:bg-muted/50"
                >
                    Reset to project defaults
                </Button>
                <Button
                    type="button"
                    disabled={isSaving || !data.canEdit}
                    onClick={() => void onSave()}
                    className="h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium"
                >
                    {isSaving ? <Loader2 className="mr-2 size-4 animate-spin" /> : null}
                    Save member settings
                </Button>
            </div>
        </div>
    );
}

function MemberNotificationRuleRow({
    entry,
    projectPolicy,
    draft,
    canEdit,
    onDraftChange,
}: {
    entry: ProjectNotificationRegistryEntry;
    projectPolicy: ProjectNotificationPolicy;
    draft: ProjectMemberNotificationOverrides;
    canEdit: boolean;
    onDraftChange: React.Dispatch<React.SetStateAction<ProjectMemberNotificationOverrides>>;
}) {
    const decision = resolveProjectNotificationDecision({ eventKey: entry.key, projectPolicy, memberOverrides: draft });
    const projectDecision = resolveProjectNotificationDecision({ eventKey: entry.key, projectPolicy });
    const disabled = !canEdit || entry.mandatory || !entry.allowMemberOverride || !projectDecision.enabled;
    const checked = decision.enabled;

    return (
        <div className="flex items-center justify-between gap-4 p-3 bg-card transition-colors hover:bg-muted/20">
            <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                    <p className="nb-ui-label text-sm font-semibold text-foreground">{entry.label}</p>
                    {entry.mandatory ? (
                        <span className="inline-flex h-5 items-center gap-1 rounded-[3px] border border-amber-500/20 bg-amber-500/10 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-amber-700 dark:text-amber-400">
                            <Lock className="size-3" />
                            Locked
                        </span>
                    ) : null}
                </div>
                <p className="nb-compact mt-0.5 text-xs text-muted-foreground leading-relaxed">
                    {entry.mandatory
                        ? "Locked on for responsibility or safety."
                        : !projectDecision.enabled
                            ? "Disabled by project defaults."
                            : entry.allowMemberOverride
                                ? "Optional personal preference."
                                : "Managed by project policy."}
                </p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
                <span className="nb-meta text-muted-foreground select-none w-6 text-right">
                    {checked ? "On" : "Off"}
                </span>
                <SettingsSwitch
                    checked={checked}
                    disabled={disabled}
                    aria-label={entry.label}
                    onCheckedChange={(enabled) => {
                        onDraftChange((current) => ({
                            ...current,
                            mode: "custom",
                            rules: {
                                ...current.rules,
                                [entry.key]: enabled,
                            },
                        }));
                    }}
                />
            </div>
        </div>
    );
}

function AdvancedDisclosure({
    title,
    open,
    onToggle,
    children,
}: {
    title: string;
    open: boolean;
    onToggle: () => void;
    children: React.ReactNode;
}) {
    return (
        <section className="rounded-lg border border-border bg-card p-4 shadow-none">
            <button
                type="button"
                onClick={onToggle}
                className="flex w-full items-center justify-between gap-4 text-left"
            >
                <div>
                    <p className="nb-ui-label text-sm font-semibold text-foreground">{title}</p>
                    <p className="nb-compact mt-1 text-xs text-muted-foreground">Progressive details for owners who need the full impact.</p>
                </div>
                <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition", open && "rotate-180")} />
            </button>
            {open ? <div className="mt-4">{children}</div> : null}
        </section>
    );
}


function AccessMatrix({
    rows,
    activeVisibility,
}: {
    rows: Array<{ viewer: string; publicAccess: string; privateAccess: string }>;
    activeVisibility: ProjectSettingsVisibility;
}) {
    return (
        <div className="overflow-hidden rounded-lg border border-border bg-card">
            <div className="grid grid-cols-[1fr_1fr] border-b border-border bg-muted/40 text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:grid-cols-[180px_1fr_1fr]">
                <div className="hidden px-4 py-3 sm:block">Viewer</div>
                <div className={cn("px-4 py-3 flex items-center gap-1.5", activeVisibility === "public" ? "font-semibold text-foreground" : "text-muted-foreground")}>
                    Public
                    {activeVisibility === "public" ? (
                        <span className="inline-flex h-5 items-center rounded-[3px] border border-primary/20 bg-primary/10 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-primary">Active</span>
                    ) : null}
                </div>
                <div className={cn("px-4 py-3 flex items-center gap-1.5", activeVisibility === "private" ? "font-semibold text-foreground" : "text-muted-foreground")}>
                    Private
                    {activeVisibility === "private" ? (
                        <span className="inline-flex h-5 items-center rounded-[3px] border border-primary/20 bg-primary/10 px-[7px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none text-primary">Active</span>
                    ) : null}
                </div>
            </div>
            <div className="divide-y divide-border">
                {rows.map((row) => (
                    <div key={row.viewer} className="grid gap-0 text-sm sm:grid-cols-[180px_1fr_1fr]">
                        <div className="border-b border-border bg-muted/20 px-4 py-3 font-semibold text-foreground dark:text-foreground sm:border-b-0">
                            {row.viewer}
                        </div>
                        <div className={cn("px-4 py-3 text-muted-foreground transition-colors", activeVisibility === "public" && "bg-primary/5 font-medium text-foreground")}>
                            {row.publicAccess}
                        </div>
                        <div className={cn("px-4 py-3 text-muted-foreground transition-colors", activeVisibility === "private" && "bg-primary/5 font-medium text-foreground")}>
                            {row.privateAccess}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

function AccessImpactGrid({
    items,
    isLoading,
}: {
    items: Array<{ label: string; value: number; detail: string }>;
    isLoading: boolean;
}) {
    if (isLoading) {
        return (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 5 }).map((_, index) => (
                    <div key={index} aria-hidden="true" className="nb-skeleton h-24 rounded-lg border border-border" />
                ))}
            </div>
        );
    }

    return (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {items.map((item) => (
                <div key={item.label} className="rounded-lg border border-border bg-card p-4 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
                    <p className="text-2xl font-semibold tracking-tight text-foreground">{item.value}</p>
                    <p className="mt-1 text-sm font-semibold text-foreground">{item.label}</p>
                    <p className="mt-1.5 nb-compact text-muted-foreground leading-relaxed">{item.detail}</p>
                </div>
            ))}
        </div>
    );
}

const PUBLIC_TAB_ORDER: ProjectPublicTabId[] = ["dashboard", "readme", "updates", "sprints", "tasks", "files"];

function TogglePill({
    checked,
    disabled,
    onChange,
    label,
}: {
    checked: boolean;
    disabled?: boolean;
    onChange: (checked: boolean) => void;
    label: string;
}) {
    return (
        <div className="flex shrink-0 items-center gap-3">
            <span className="nb-meta text-muted-foreground select-none w-6 text-right">
                {checked ? "On" : "Off"}
            </span>
            <SettingsSwitch
                checked={checked}
                disabled={disabled}
                aria-label={label}
                onCheckedChange={onChange}
            />
        </div>
    );
}

function PublicTabVisibilityEditor({
    value,
    onChange,
    disabled,
    savingTabId,
}: {
    value: ProjectPublicTabVisibility;
    onChange: (tabId: ProjectPublicTabId, enabled: boolean) => void;
    disabled?: boolean;
    savingTabId?: ProjectPublicTabId | null;
}) {
    return (
        <div className="divide-y divide-border overflow-hidden rounded-lg border border-border bg-card">
            {PUBLIC_TAB_ORDER.map((tabId) => {
                const isEnabled = Boolean(value[tabId]);
                const isSaving = savingTabId === tabId;
                return (
                    <div
                        key={tabId}
                        className="flex items-center justify-between gap-4 p-4 transition-colors hover:bg-muted/20"
                    >
                        <div className="min-w-0 flex-1">
                            <p className="nb-ui-label text-foreground">{PROJECT_PUBLIC_TAB_LABELS[tabId]}</p>
                            <p className="mt-1 nb-compact text-muted-foreground leading-relaxed">{PROJECT_PUBLIC_TAB_DESCRIPTIONS[tabId]}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-3">
                            <span className="nb-meta text-muted-foreground select-none w-6 text-right flex items-center justify-end">
                                {isSaving ? (
                                    <Loader2 className="h-3 w-3 animate-spin text-primary" />
                                ) : isEnabled ? (
                                    "On"
                                ) : (
                                    "Off"
                                )}
                            </span>
                            <SettingsSwitch
                                checked={isEnabled}
                                disabled={disabled || isSaving}
                                aria-label={`Toggle public ${PROJECT_PUBLIC_TAB_LABELS[tabId]} visibility`}
                                onCheckedChange={(checked) => onChange(tabId, checked)}
                            />
                        </div>
                    </div>
                );
            })}
        </div>
    );
}

function FileWorkspaceMembers({
    data,
    isLoading,
    savingMemberId,
    bulkSaving,
    onToggle,
    onBulkToggle,
    filePolicy,
}: {
    data: FileWorkspaceSettingsData | null;
    isLoading: boolean;
    savingMemberId: string | null;
    bulkSaving: boolean;
    onToggle: (member: FileWorkspaceSettingsData["members"][number], enabled: boolean) => void | Promise<void>;
    onBulkToggle: (enabled: boolean) => void | Promise<void>;
    filePolicy: ReturnType<typeof buildProjectFilePolicy>;
}) {
    const [searchQuery, setSearchQuery] = useState("");
    const [filterStatus, setFilterStatus] = useState<"all" | "enabled" | "disabled">("all");

    const members = useMemo(() => data?.members ?? [], [data?.members]);

    // Partition into Leadership vs Team Members
    const leaders = useMemo(
        () => members.filter((m) => m.membershipRole === "owner" || m.membershipRole === "admin"),
        [members],
    );
    const standardMembers = useMemo(
        () => members.filter((m) => m.membershipRole !== "owner" && m.membershipRole !== "admin"),
        [members],
    );

    const filteredLeaders = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        if (!query) return leaders;
        return leaders.filter((member) => {
            const displayName = getProjectMemberDisplayName(member).toLowerCase();
            const username = (member.username ?? "").toLowerCase();
            const roleTitle = (member.projectRoleTitle ?? "").toLowerCase();
            const roleLabel = getProjectMemberRoleLabel(member.membershipRole as ProjectMemberRole).toLowerCase();
            return displayName.includes(query) || username.includes(query) || roleTitle.includes(query) || roleLabel.includes(query);
        });
    }, [leaders, searchQuery]);

    const filteredStandardMembers = useMemo(() => {
        const query = searchQuery.trim().toLowerCase();
        return standardMembers.filter((member) => {
            if (filterStatus === "enabled" && !member.fileUploadEnabled) return false;
            if (filterStatus === "disabled" && member.fileUploadEnabled) return false;
            if (!query) return true;
            const displayName = getProjectMemberDisplayName(member).toLowerCase();
            const username = (member.username ?? "").toLowerCase();
            const roleTitle = (member.projectRoleTitle ?? "").toLowerCase();
            const roleLabel = getProjectMemberRoleLabel(member.membershipRole as ProjectMemberRole).toLowerCase();
            return displayName.includes(query) || username.includes(query) || roleTitle.includes(query) || roleLabel.includes(query);
        });
    }, [standardMembers, searchQuery, filterStatus]);

    const enabledStandardCount = useMemo(
        () => standardMembers.filter((m) => m.fileUploadEnabled).length,
        [standardMembers],
    );
    const disabledStandardCount = useMemo(
        () => standardMembers.filter((m) => !m.fileUploadEnabled).length,
        [standardMembers],
    );

    if (isLoading && !data) {
        return (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin text-primary" />
                Loading file upload permissions...
            </div>
        );
    }

    if (members.length === 0) {
        return <p className="text-sm text-muted-foreground">No project members found.</p>;
    }

    return (
        <div className="space-y-6">
            {/* Section 1: Project Leadership (Enforced Invariant) */}
            <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-border/60 pb-2">
                    <div className="flex items-center gap-2">
                        <Shield className="size-4 text-primary" />
                        <span className="nb-ui-label text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Project Leadership
                        </span>
                    </div>
                    <span className="nb-meta text-xs text-muted-foreground">
                        {leaders.length} {leaders.length === 1 ? "leader" : "leaders"} · Intake always active
                    </span>
                </div>

                {filteredLeaders.length === 0 && searchQuery.trim() ? (
                    <div className="rounded-lg border border-dashed border-border bg-card nb-grid-ground p-4 text-center text-xs text-muted-foreground" role="status">
                        No leaders match &ldquo;{searchQuery}&rdquo;.
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {filteredLeaders.map((member) => {
                            const role = member.membershipRole as ProjectMemberRole;
                            const displayName = getProjectMemberDisplayName(member);
                            const roleTitle = member.projectRoleTitle?.trim();
                            const username = member.username?.trim();

                            return (
                                <div
                                    key={member.id}
                                    className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20"
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <UserAvatar
                                            identity={{
                                                id: member.id,
                                                fullName: displayName,
                                                username: member.username ?? null,
                                                avatarUrl: member.avatarUrl,
                                            }}
                                            size={44}
                                            roundedClassName="rounded-[5px]"
                                            className="border border-border shrink-0"
                                        />
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="nb-ui-label truncate text-sm font-semibold text-foreground">
                                                    {displayName}
                                                </p>
                                                <span
                                                    className={cn(
                                                        "h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none shrink-0 inline-flex items-center border",
                                                        role === "owner"
                                                            ? "border-amber-500/20 bg-amber-500/10 text-amber-700 dark:text-amber-400"
                                                            : "border-primary/20 bg-primary/10 text-primary",
                                                    )}
                                                >
                                                    {getProjectMemberRoleLabel(role)}
                                                </span>
                                            </div>
                                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                                                {roleTitle ? (
                                                    <span className="nb-compact font-medium text-foreground">{roleTitle}</span>
                                                ) : null}
                                                {roleTitle && username ? (
                                                    <span className="text-muted-foreground/60">·</span>
                                                ) : null}
                                                {username ? (
                                                    <span className="nb-compact text-muted-foreground">@{username}</span>
                                                ) : null}
                                            </div>
                                            <p className="nb-meta mt-0.5 text-[11px] text-muted-foreground/80">
                                                {formatJoinedAt(member.joinedAt)}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-2">
                                        <span className="inline-flex h-6 items-center gap-1.5 rounded-[3px] border border-border bg-muted/50 px-2 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-foreground">
                                            <Shield className="size-3 text-primary shrink-0" />
                                            Always active · Lead policy
                                        </span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>

            {/* Section 2: Team Member Intake Permissions */}
            <div className="space-y-3">
                <div className="flex items-center justify-between border-b border-border/60 pb-2">
                    <div className="flex items-center gap-2">
                        <Users className="size-4 text-muted-foreground" />
                        <span className="nb-ui-label text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                            Team Member Intake
                        </span>
                    </div>
                    <span className="nb-meta text-xs text-muted-foreground">
                        {standardMembers.length} {standardMembers.length === 1 ? "member" : "members"} · {enabledStandardCount} allowed
                    </span>
                </div>

                {/* Toolbar: Search input + Filter tabs + Bulk Actions dropdown */}
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                    <div className="relative min-w-[200px] max-w-sm flex-1">
                        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                        <input
                            type="text"
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            placeholder="Search members by name or role..."
                            aria-label="Search members by name or role"
                            className="h-[34px] w-full rounded-[5px] border border-border bg-background pl-9 pr-3 text-[13px] text-foreground placeholder:text-muted-foreground focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                        />
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                        <div
                            className="flex items-center gap-1 rounded-[5px] border border-border bg-muted/20 p-0.5"
                            role="tablist"
                            aria-label="Filter members by upload status"
                        >
                            <button
                                type="button"
                                role="tab"
                                aria-selected={filterStatus === "all"}
                                onClick={() => setFilterStatus("all")}
                                className={cn(
                                    "h-[28px] rounded-[3px] px-2.5 text-[12px] font-medium transition-colors",
                                    filterStatus === "all"
                                        ? "bg-foreground text-background font-semibold"
                                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                                )}
                            >
                                All ({standardMembers.length})
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={filterStatus === "enabled"}
                                onClick={() => setFilterStatus("enabled")}
                                className={cn(
                                    "h-[28px] rounded-[3px] px-2.5 text-[12px] font-medium transition-colors",
                                    filterStatus === "enabled"
                                        ? "bg-foreground text-background font-semibold"
                                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                                )}
                            >
                                Allowed ({enabledStandardCount})
                            </button>
                            <button
                                type="button"
                                role="tab"
                                aria-selected={filterStatus === "disabled"}
                                onClick={() => setFilterStatus("disabled")}
                                className={cn(
                                    "h-[28px] rounded-[3px] px-2.5 text-[12px] font-medium transition-colors",
                                    filterStatus === "disabled"
                                        ? "bg-foreground text-background font-semibold"
                                        : "text-muted-foreground hover:bg-muted/50 hover:text-foreground",
                                )}
                            >
                                Paused ({disabledStandardCount})
                            </button>
                        </div>

                        <DropdownMenu modal={false}>
                            <DropdownMenuTrigger asChild>
                                <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    disabled={bulkSaving || standardMembers.length === 0}
                                    className="h-[34px] gap-1.5 rounded-[5px] border-border px-3 text-[13px] font-medium text-foreground hover:bg-muted"
                                >
                                    {bulkSaving ? <Loader2 className="size-3.5 animate-spin text-primary" /> : null}
                                    Bulk actions
                                    <ChevronDown className="size-3.5 text-muted-foreground" />
                                </Button>
                            </DropdownMenuTrigger>
                            <DropdownMenuContent align="end" className="w-56">
                                <DropdownMenuItem
                                    onClick={() => void onBulkToggle(true)}
                                    disabled={bulkSaving}
                                    className="gap-2 text-xs"
                                >
                                    <Check className="size-3.5 text-primary" />
                                    Enable all members
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                    onClick={() => void onBulkToggle(false)}
                                    disabled={bulkSaving}
                                    className="gap-2 text-xs text-muted-foreground hover:text-foreground"
                                >
                                    <Lock className="size-3.5" />
                                    Disable all members
                                </DropdownMenuItem>
                            </DropdownMenuContent>
                        </DropdownMenu>
                    </div>
                </div>

                {filteredStandardMembers.length === 0 ? (
                    <div className="nb-empty-state nb-grid-ground rounded-lg p-8 text-center text-sm text-muted-foreground">
                        {searchQuery ? `No members found matching “${searchQuery}”.` : "No members match the selected filter."}
                    </div>
                ) : (
                    <div className="grid gap-3">
                        {filteredStandardMembers.map((member) => {
                            const role = member.membershipRole as ProjectMemberRole;
                            const displayName = getProjectMemberDisplayName(member);
                            const roleTitle = member.projectRoleTitle?.trim();
                            const username = member.username?.trim();
                            const isSaving = savingMemberId === member.id;

                            return (
                                <div
                                    key={member.id}
                                    className="flex items-center justify-between gap-4 rounded-lg border border-border bg-card p-4 transition-colors hover:border-foreground/20"
                                >
                                    <div className="flex min-w-0 items-center gap-3">
                                        <UserAvatar
                                            identity={{
                                                id: member.id,
                                                fullName: displayName,
                                                username: member.username ?? null,
                                                avatarUrl: member.avatarUrl,
                                            }}
                                            size={44}
                                            roundedClassName="rounded-[5px]"
                                            className="border border-border shrink-0"
                                        />
                                        <div className="min-w-0">
                                            <div className="flex flex-wrap items-center gap-2">
                                                <p className="nb-ui-label truncate text-sm font-semibold text-foreground">
                                                    {displayName}
                                                </p>
                                                <span
                                                    className={cn(
                                                        "h-5 px-[7px] rounded-[3px] font-mono text-[11px] font-medium uppercase tracking-[0.09em] leading-none shrink-0 inline-flex items-center border",
                                                        role === "viewer"
                                                            ? "border-border bg-muted/60 text-muted-foreground"
                                                            : "border-border bg-muted text-foreground",
                                                    )}
                                                >
                                                    {getProjectMemberRoleLabel(role)}
                                                </span>
                                            </div>
                                            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                                                {roleTitle ? (
                                                    <span className="nb-compact font-medium text-foreground">{roleTitle}</span>
                                                ) : null}
                                                {roleTitle && username ? (
                                                    <span className="text-muted-foreground/60">·</span>
                                                ) : null}
                                                {username ? (
                                                    <span className="nb-compact text-muted-foreground">@{username}</span>
                                                ) : null}
                                            </div>
                                            <p className="nb-meta mt-0.5 text-[11px] text-muted-foreground/80">
                                                {formatJoinedAt(member.joinedAt)}
                                            </p>
                                        </div>
                                    </div>

                                    <div className="flex shrink-0 items-center gap-3">
                                        {member.uploadPermissionLocked ? (
                                            <span className="inline-flex h-6 items-center gap-1.5 rounded-[3px] border border-border bg-muted/40 px-2 font-mono text-[11px] font-medium uppercase tracking-[0.06em] text-muted-foreground">
                                                <Lock className="size-3 shrink-0" />
                                                Read-only
                                            </span>
                                        ) : (
                                             <div className="flex items-center gap-3">
                                                 <div className="hidden sm:block text-right">
                                                     <span className="block nb-ui-label text-xs font-semibold text-foreground">
                                                         {member.fileUploadEnabled ? "Upload allowed" : "Upload paused"}
                                                     </span>
                                                     <span className="block nb-meta text-[11px] text-muted-foreground">
                                                         {isSaving
                                                             ? "Updating permissions..."
                                                             : member.fileUploadEnabled
                                                                 ? "Full workspace intake"
                                                                 : "Read-only access"}
                                                     </span>
                                                 </div>
                                                 <div className="flex shrink-0 items-center gap-3">
                                                     <span className="nb-meta text-muted-foreground select-none w-6 text-right">
                                                         {isSaving ? "..." : member.fileUploadEnabled ? "On" : "Off"}
                                                     </span>
                                                     {isSaving ? (
                                                         <Loader2 className="h-4 w-4 animate-spin text-primary" />
                                                     ) : (
                                                         <SettingsSwitch
                                                             checked={member.fileUploadEnabled}
                                                             disabled={isSaving}
                                                             aria-label={`Toggle file uploads for ${displayName}`}
                                                             onCheckedChange={(next) => void onToggle(member, next)}
                                                         />
                                                     )}
                                                 </div>
                                             </div>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
}

function LifecycleSettingsEditor({
    initialStages,
    currentStageIndex,
    isSaving,
    onSave,
}: {
    initialStages: string[];
    currentStageIndex: number;
    isSaving: boolean;
    onSave: (stages: string[], currentStageIdentity: string) => Promise<void>;
}) {
    const [stages, setStages] = useState(initialStages);
    const currentStageIdentity = initialStages[currentStageIndex] || "";
    useEffect(() => {
        setStages(initialStages);
    }, [initialStages]);

    const isDirty = useMemo(() => {
        if (stages.length !== initialStages.length) return true;
        return stages.some((stage, idx) => stage !== initialStages[idx]);
    }, [stages, initialStages]);

    const handleCancel = useCallback(() => {
        setStages(initialStages);
    }, [initialStages]);

    const handleSave = useCallback(async () => {
        const cleaned = stages.map((stage) => stage.trim().replace(/\s+/g, " ")).filter(Boolean);
        if (cleaned.length === 0) {
            toast.error("You must have at least one stage");
            return;
        }
        await onSave(cleaned, currentStageIdentity);
    }, [currentStageIdentity, onSave, stages]);

    const currentStageName = initialStages[currentStageIndex] || stages[currentStageIndex] || stages[0] || "";

    return (
        <SettingsCard
            title="Project lifecycle"
            description="Define the journey stages used by the project dashboard, roadmap, and milestone tracking."
            footer={
                <>
                    <p className="nb-compact text-muted-foreground">
                        {isDirty ? (
                            <span className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400">
                                <span className="size-1.5 rounded-full bg-amber-500" />
                                You have unsaved changes in lifecycle stages.
                            </span>
                        ) : (
                            <span>
                                {stages.length} lifecycle stage{stages.length === 1 ? "" : "s"} configured
                                {currentStageName ? (
                                    <>
                                        {" "}· Current stage: <strong className="font-semibold text-foreground">{currentStageName}</strong>
                                    </>
                                ) : null}
                            </span>
                        )}
                    </p>
                    <div className="flex items-center gap-2">
                        <Button
                            type="button"
                            variant="outline"
                            onClick={handleCancel}
                            disabled={!isDirty || isSaving}
                            className="h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]"
                        >
                            Cancel
                        </Button>
                        <Button
                            type="button"
                            onClick={() => void handleSave()}
                            disabled={!isDirty || isSaving || stages.length === 0}
                            className="h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]"
                        >
                            {isSaving ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                            Save changes
                        </Button>
                    </div>
                </>
            }
        >
            <div className="space-y-6">
                <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 p-4">
                    <Info className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="space-y-1">
                        <p className="nb-ui-label text-foreground">Lifecycle roadmap alignment</p>
                        <p className="nb-compact text-muted-foreground">
                            Stages define the progression milestones shown on your project overview and roadmap. As your team completes deliverables, project leads can advance through these stages directly from the project dashboard header.
                        </p>
                    </div>
                </div>

                <BaseLifecycleEditor
                    stages={stages}
                    onChange={setStages}
                    currentStageIndex={currentStageIndex}
                />
            </div>
        </SettingsCard>
    );
}

function AccessTransitionDetails({ preflight }: { preflight: AccessTransitionPreflightData }) {
    const previewRows = [
        {
            label: "Followers",
            items: preflight.previews.followers.map((follower) => follower.fullName || follower.username || "Follower"),
            fallback: "No follower previews are affected.",
        },
        {
            label: "Open roles",
            items: preflight.previews.openRoles.map((role) => role.title || role.role || "Open role"),
            fallback: "No open role previews are affected.",
        },
        {
            label: "Pending applications",
            items: preflight.previews.pendingApplications.map((application) => {
                const roleLabel = application.roleTitle || application.roleName || "role";
                return `${application.applicantName || "Applicant"} · ${roleLabel}`;
            }),
            fallback: "No pending application previews are affected.",
        },
    ];

    return (
        <div className="space-y-4 text-sm">
            <div className="rounded-lg border border-border bg-muted/20 p-3">
                <p className="nb-ui-label text-sm font-semibold text-foreground">Affected counts</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {[
                        ["Members", preflight.counts.membersCount],
                        ["Followers", preflight.counts.followersCount],
                        ["Open roles", preflight.counts.openRolesCount],
                        ["Pending applications", preflight.counts.pendingApplicationsCount],
                        ["Active tasks", preflight.counts.activeTasksCount],
                    ].map(([label, value]) => (
                        <div key={label} className="rounded-lg border border-border bg-card px-3 py-2 text-xs">
                            <span className="font-semibold text-foreground">{value}</span>
                            <span className="ml-2 text-muted-foreground">{label}</span>
                        </div>
                    ))}
                </div>
            </div>

            <div className="space-y-2">
                <p className="nb-micro text-muted-foreground">Transition checklist</p>
                <PolicyList items={preflight.policy.transitionChecklist} />
            </div>

            {preflight.policy.irreversibleNotes.length > 0 ? (
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900 dark:border-amber-900/60 dark:bg-amber-950/20 dark:text-amber-100">
                    <p className="font-semibold">Important notes</p>
                    <ul className="mt-2 space-y-1 text-xs leading-5">
                        {preflight.policy.irreversibleNotes.map((note) => (
                            <li key={note}>{note}</li>
                        ))}
                    </ul>
                </div>
            ) : null}

            <div className="grid gap-3">
                {previewRows.map((row) => (
                    <div key={row.label} className="rounded-lg border border-border p-3">
                        <p className="nb-ui-label text-xs font-semibold uppercase tracking-wider text-muted-foreground">{row.label}</p>
                        {row.items.length > 0 ? (
                            <div className="mt-2 flex flex-wrap gap-2">
                                {row.items.map((item, index) => (
                                    <span key={`${row.label}-${index}-${item}`} className="inline-flex h-5 items-center rounded-[3px] border border-border bg-muted/60 px-[7px] font-mono text-[11px] uppercase tracking-[0.09em] leading-none text-foreground">
                                        {item}
                                    </span>
                                ))}
                            </div>
                        ) : (
                            <p className="nb-compact mt-2 text-xs text-muted-foreground">{row.fallback}</p>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
}

function PolicyList({ items }: { items: string[] }) {
    return (
        <ul className="grid gap-2">
            {items.map((item) => (
                <li key={item} className="flex items-start gap-2.5 rounded-lg border border-border bg-muted/20 px-3.5 py-2.5 text-sm text-foreground">
                    <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <span className="leading-relaxed">{item}</span>
                </li>
            ))}
        </ul>
    );
}
