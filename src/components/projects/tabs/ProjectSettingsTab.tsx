"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import {
    AlertTriangle,
    Archive,
    Bell,
    ChevronDown,
    Crown,
    FileText,
    Folder,
    Globe,
    Link2,
    Loader2,
    Lock,
    Newspaper,
    RefreshCw,
    Search,
    Scale,
    Settings,
    Shield,
    SlidersHorizontal,
    Trash2,
    UserCog,
    Users,
    Workflow,
} from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
    ProjectArchiveModal,
    ProjectTransferOwnershipModal,
    ProjectDeleteModal,
} from "@/components/projects/settings/ProjectDangerModals";
import { Button } from "@/components/ui/button";
import { transferProjectOwnership } from "@/app/actions/account";
import { archiveProjectAction, deleteProject, getProjectAccessTransitionPreflightAction, getProjectCollaboratorSettingsAction, getProjectDangerZonePreflightAction, getProjectFileWorkspaceSettingsAction, getProjectMemberRemovalPreflightAction, readProjectMemberNotificationSettingsAction, readProjectNotificationSettingsAction, readProjectSettingsBootstrapAction, removeProjectMemberAction, resetProjectMemberNotificationSettingsAction, resetProjectNotificationSettingsAction, updateProject, updateProjectLifecycleAction, updateProjectFileUploadDefaultsAction, updateProjectMemberFileUploadAction, updateProjectMemberNotificationSettingsAction, updateProjectMemberRoleAction, updateProjectNotificationSettingsAction, updateProjectPublicTabVisibilityAction, updateProjectVisibilityAction } from "@/app/actions/project";
import { readProjectDocSettingsAction, updateProjectDocSettingsAction } from "@/app/actions/project/doc";
import { cn } from "@/lib/utils";
import {
    buildDefaultProjectNotificationPolicy,
    groupProjectNotificationEntries,
    normalizeProjectMemberNotificationOverrides,
    normalizeProjectNotificationPolicy,
    resolveProjectNotificationDecision,
    summarizeProjectNotificationPolicy,
    type ProjectMemberNotificationOverrides,
    type ProjectNotificationEventKey,
    type ProjectNotificationPolicy,
    type ProjectNotificationPreset,
} from "@/lib/notifications/project-policy";
import {
    buildProjectFilePolicy,
    buildProjectMemberMutationPolicy,
    buildProjectMemberRemovalPreflight,
    buildProjectRolePolicy,
    buildProjectSettingsPreflight,
    areProjectPublicTabVisibilitiesEqual,
    getProjectMemberDisplayName,
    getProjectMemberRoleLabel,
    normalizeProjectPublicTabVisibility,
    getVisibleProjectSettingsSections,
    normalizeProjectVisibility,
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
import { ProjectRolesEditor } from "@/components/projects/settings/ProjectRolesEditor";
import { ProjectLinksManager } from "@/components/projects/dashboard/ProjectSocialLinksCard";
import { SettingsSwitch } from "@/components/settings/ui/SettingsSwitch";
import { LegalAndDataRightsSection } from "@/components/settings/LegalAndDataRightsSection";
import {
    normalizeProjectRoleFormValues,
    type ProjectRoleFormValue,
    type ProjectRolesFormValues,
} from "@/lib/projects/project-roles-form";
import { SettingsCard } from '@/components/projects/settings/SettingsFormFields';
import type { AccessTransitionPreflightData, RemovalPreflightData } from '@/components/projects/settings/SettingsPolicyDetails';
import { ProjectNotificationCategoryCard } from '@/components/projects/settings/ProjectNotificationSettings';
import { CollaboratorSearchField } from '@/components/projects/settings/CollaboratorSearchField';
import type { MemberNotificationSettingsData } from '@/components/projects/settings/MemberNotificationSettingsEditor';
import { FileWorkspaceMembers, type FileWorkspaceSettingsData } from '@/components/projects/settings/FileWorkspaceMembers';
import { CollaboratorCard, projectMemberRole } from '@/components/projects/settings/CollaboratorCard';
import { LifecycleSettingsEditor } from '@/components/projects/settings/LifecycleSettingsEditor';
import { PublicTabVisibilityEditor } from '@/components/projects/settings/PublicTabVisibilityEditor';
import { GeneralSettingsSection, resetIdentityFromProject } from '@/components/projects/settings/GeneralSettingsSection';

const AccessTransitionDetails = dynamic(() => import("@/components/projects/settings/SettingsPolicyDetails").then((mod) => mod.AccessTransitionDetails));
const RemovalImpactDetails = dynamic(() => import("@/components/projects/settings/SettingsPolicyDetails").then((mod) => mod.RemovalImpactDetails));
const MemberNotificationSettingsEditor = dynamic(() => import("@/components/projects/settings/MemberNotificationSettingsEditor").then((mod) => mod.MemberNotificationSettingsEditor));

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

type CollaboratorSettingsData = {
    members: ProjectSettingsMember[];
    roleCounts: Record<ProjectMemberRole, number>;
    hasMore: boolean;
    nextCursor: string | null;
};

type ProjectNotificationSettingsData = {
    policy: ProjectNotificationPolicy;
    summary: ReturnType<typeof summarizeProjectNotificationPolicy>;
};

type CollaboratorFilter = "all" | "admin" | "member" | "viewer";
type RemovalMode = "preserve_history" | "unassign_active_tasks" | "reassign_active_tasks";
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

const projectRoleSettingsSchema = z.object({
    roles: z.array(z.object({
        id: z.string().optional(),
        role: z.string().trim().min(1, "Role name is required"),
        count: z.number().int().min(1, "Count must be at least 1"),
        description: z.string().optional(),
        skills: z.array(z.string()).optional(),
    })),
});

function projectOwnerId(project: any): string | null {
    return project?.ownerId ?? project?.owner?.id ?? null;
}

function resetSettingsFromProject(project: any) {
    return {
        visibility: normalizeProjectVisibility(project?.visibility),
        publicTabVisibility: normalizeProjectPublicTabVisibility(project?.publicTabVisibility ?? project?.public_tab_visibility),
        memberUpdatesEnabled: project?.memberUpdatesEnabled ?? project?.member_updates_enabled ?? true,
        memberFileUploadDefault: project?.memberFileUploadDefault ?? project?.member_file_upload_default ?? true,
    };
}

const NOTIFICATION_GROUPS = groupProjectNotificationEntries();
const FILE_POLICY = buildProjectFilePolicy();

interface ProjectSettingsTabProps {
    projectId: string;
    project: any;
    onProjectUpdated: (updates?: { coverImage?: string | null }) => void;
    isProjectOwner: boolean;
    actorRole?: ProjectMemberRole | null;
    members?: ProjectSettingsMember[];
    loadingMembers?: boolean;
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

    const handleNavigateSection = (sectionId: ProjectSettingsSectionId) => {
        const localNav = { id: sectionId };
        locallyNavigatedSectionRef.current = localNav;
        setActiveSection(sectionId);

        if (typeof window !== "undefined") {
            const params = new URLSearchParams(window.location.search);
            params.set("tab", "settings");
            params.set("settings", sectionId);
            router.push(`?${params.toString()}`, { scroll: false });
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
    };

    useEffect(() => () => {
        if (localNavigationReleaseTimerRef.current !== null) {
            window.clearTimeout(localNavigationReleaseTimerRef.current);
        }
    }, []);
    const [savingSettings, setSavingSettings] = useState(false);
    const [savingLifecycle, setSavingLifecycle] = useState(false);
    const [confirmLoading, setConfirmLoading] = useState(false);
    const [confirmAction, setConfirmAction] = useState<ConfirmAction | null>(null);
    const [dangerPreflight, setDangerPreflight] = useState<DangerPreflight | null>(null);
    const [dangerPreflightLoading, setDangerPreflightLoading] = useState(false);
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
    const collaboratorRequestSeqRef = useRef(0);

    const initialSettings = useMemo(() => resetSettingsFromProject(project), [project]);
    const initialIdentity = useMemo(() => resetIdentityFromProject(project), [project]);
    const initialRoles = useMemo<ProjectRolesFormValues>(() => {
        const openRoles = normalizeProjectRoleFormValues(project?.openRoles ?? project?.open_roles);
        const metadata = (project?.importSource?.metadata || project?.import_source?.metadata || {}) as any;
        const leadFocus = typeof metadata.leadFocus === "string" ? metadata.leadFocus.trim() : "";

        // Skip duplicate lead-role when open roles already define the lead focus
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
    const [memberFileUploadDefault, setMemberFileUploadDefault] = useState<boolean>(initialSettings.memberFileUploadDefault);
    const [savingMemberFileUploadDefault, setSavingMemberFileUploadDefault] = useState(false);
    const [projectTitle, setProjectTitle] = useState(initialIdentity.title);
    const [deletedRoleIds, setDeletedRoleIds] = useState<string[]>([]);
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

    const initialVisibility = initialSettings.visibility;
    const initialPublicTabVisibilityKey = JSON.stringify(initialSettings.publicTabVisibility);
    const initialMemberUpdates = initialSettings.memberUpdatesEnabled;
    const initialFileUploadDefault = initialSettings.memberFileUploadDefault;

    useEffect(() => {
        setVisibility(initialVisibility);
        setPublicTabVisibility(initialSettings.publicTabVisibility);
        setSavedVisibility(initialVisibility);
        setSavedPublicTabVisibility(initialSettings.publicTabVisibility);
        setMemberUpdatesEnabled(initialMemberUpdates);
        setMemberFileUploadDefault(initialFileUploadDefault);
    }, [initialVisibility, initialPublicTabVisibilityKey, initialMemberUpdates, initialFileUploadDefault]);

    const initialRolesKey = JSON.stringify(initialRoles);
    useEffect(() => {
        if (rolesFormDirty || deletedRoleIds.length > 0) return;
        resetRolesForm(initialRoles);
        setDeletedRoleIds([]);
    }, [initialRolesKey, resetRolesForm]);

    useEffect(() => {
        collaboratorDataRef.current = collaboratorData;
    }, [collaboratorData]);

    useEffect(() => {
        removalModeRef.current = removalMode;
    }, [removalMode]);

    useEffect(() => {
        removalReassignToUserIdRef.current = removalReassignToUserId;
    }, [removalReassignToUserId]);

    const initialTitle = initialIdentity.title;
    useEffect(() => {
        setProjectTitle(initialTitle);
    }, [initialTitle]);

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

    const ownerId = projectOwnerId(project);
    const collaboratorMembers = collaboratorData?.members ?? members;
    const rolePolicy = buildProjectRolePolicy({ isOwner: isProjectOwner, actorRole: actorProjectRole, ownerId, members: collaboratorMembers });
    const filteredCollaborators = rolePolicy.members.filter((member) => projectMemberRole(member, ownerId) !== "owner");
    const notificationSummary = summarizeProjectNotificationPolicy(projectNotificationDraft);
    const toggleNotificationGroup = (groupId: string) => {
        setExpandedNotificationGroups((prev) => ({
            ...prev,
            [groupId]: !prev[groupId],
        }));
    };
    const areAllNotificationGroupsExpanded = NOTIFICATION_GROUPS.length > 0 && NOTIFICATION_GROUPS.every((g) => expandedNotificationGroups[g.id]);
    const toggleAllNotificationGroups = useCallback(() => {
        if (areAllNotificationGroupsExpanded) {
            setExpandedNotificationGroups({});
        } else {
            const next: Record<string, boolean> = {};
            for (const g of NOTIFICATION_GROUPS) {
                next[g.id] = true;
            }
            setExpandedNotificationGroups(next);
        }
    }, [areAllNotificationGroupsExpanded]);
    const preflightPolicy = buildProjectSettingsPreflight(dangerPreflight);

    const visibilityDirty = visibility !== savedVisibility;
    const publicTabVisibilityDirty = !areProjectPublicTabVisibilitiesEqual(publicTabVisibility, savedPublicTabVisibility);
    const rolesDirty = rolesFormDirty || deletedRoleIds.length > 0;
    const notificationDirty = JSON.stringify(projectNotificationDraft) !== JSON.stringify(projectNotificationData?.policy ?? buildDefaultProjectNotificationPolicy());
    const dangerPreflightLoadedRef = useRef(false);
    const loadDangerPreflight = useCallback(async (force = false, pending?: ReturnType<typeof getProjectDangerZonePreflightAction>) => {
        if (!isProjectOwner) return;
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
    }, [isProjectOwner, projectId]);

    const loadCollaborators = useCallback(async (mode: "initial" | "refresh" | "more" = "initial", pending?: ReturnType<typeof getProjectCollaboratorSettingsAction>) => {
        const seq = ++collaboratorRequestSeqRef.current;
        const cursor = mode === "more" ? collaboratorDataRef.current?.nextCursor ?? undefined : undefined;
        if (mode === "refresh") {
            setCollaboratorRefreshing(true);
        } else if (mode === "more") {
            if (!cursor) return;
            setCollaboratorLoadingMore(true);
        } else {
            // Keep warm data mounted without layout shift; only show skeletons on cold mount
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
            if (seq !== collaboratorRequestSeqRef.current) return;
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
            if (seq !== collaboratorRequestSeqRef.current) return;
            console.error("Failed to load collaborators", error);
            setCollaboratorData(null);
            toast.error("Failed to load collaborators.");
        } finally {
            if (seq === collaboratorRequestSeqRef.current) {
                setCollaboratorLoading(false);
                setCollaboratorRefreshing(false);
                setCollaboratorLoadingMore(false);
            }
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
        void loadDangerPreflight(false, bootstrap.then((data) => data.dangerPreflight));
    }, [collaboratorFilter, collaboratorSearch, loadCollaborators, loadDangerPreflight, loadFileWorkspaceSettings, loadProjectNotificationSettings, loadReadmeSettings, projectId]);

    const initialCollaboratorFilterRef = useRef(false);
    useEffect(() => {
        if (!initialCollaboratorFilterRef.current) {
            initialCollaboratorFilterRef.current = true;
            return;
        }
        void loadCollaborators("initial");
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

    const handleAddSettingsRole = useCallback(() => {
        if (!isProjectOwner) return;
        appendRole({ role: "New Role", count: 1, description: "", skills: [] });
    }, [appendRole, isProjectOwner]);

    const handleRemoveSettingsRole = useCallback((index: number, roleId?: string) => {
        if (!isProjectOwner) return;
        if (roleId) {
            setDeletedRoleIds((current) => current.includes(roleId) ? current : [...current, roleId]);
        }
        removeRole(index);
    }, [isProjectOwner, removeRole]);

    const handleCancelRoles = useCallback(() => {
        if (!isProjectOwner) return;
        resetRolesForm(initialRoles);
        setDeletedRoleIds([]);
    }, [initialRoles, isProjectOwner, resetRolesForm]);

    const handleSaveRoles = useCallback(() => {
        if (!isProjectOwner) return;
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
    }, [deletedRoleIds, handleRolesSubmit, isProjectOwner, onProjectUpdated, projectId, resetRolesForm, router]);

    const handleTogglePublicTab = useCallback(async (tabId: ProjectPublicTabId, enabled: boolean) => {
        if (savingPublicTabId) return;
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
        } catch (error) {
            setPublicTabVisibility(previous);
            setSavedPublicTabVisibility(previous);
            console.error("Failed to update public tab visibility", error);
            toast.error("Failed to update tab visibility.");
        } finally {
            setSavingPublicTabId(null);
        }
    }, [onProjectUpdated, projectId, publicTabVisibility, router]);

    const handleSelectVisibility = async (nextVisibility: ProjectSettingsVisibility) => {
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
    };

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
            // Adjust the server's totals by this one change: the member list may hold only the first page.
            const changed = member.fileUploadEnabled !== enabled;
            const enabledMemberCount = previousData.summary.enabledMemberCount + (changed ? (enabled ? 1 : -1) : 0);
            const disabledMemberCount = previousData.summary.disabledMemberCount + (changed ? (enabled ? -1 : 1) : 0);
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
            const configurableTotal = previousData.summary.enabledMemberCount + previousData.summary.disabledMemberCount;
            const enabledMemberCount = enabled ? configurableTotal : 0;
            const disabledMemberCount = enabled ? 0 : configurableTotal;
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

    const handleProjectNotificationPreset = (preset: ProjectNotificationPreset) => {
        setProjectNotificationDraft(buildDefaultProjectNotificationPolicy(preset));
    };

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

    const handleSaveNotifications = async () => {
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
    };

    const handleToggleReadmeSetting = async (key: keyof ProjectDocSettings, enabled: boolean) => {
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
    };

    const handleResetNotifications = async () => {
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
    };

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

    const handleToggleMemberUpdates = async (enabled: boolean) => {
        if (!isProjectOwner) return;
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
        } catch (error) {
            setMemberUpdatesEnabled(previous);
            console.error("Failed to save updates settings", error);
            toast.error(error instanceof Error ? error.message : "Failed to save updates settings.");
        } finally {
            setSavingMemberUpdates(false);
        }
    };

    // Starting upload permission for members who join later (set at creation in step 4).
    const handleToggleMemberFileUploadDefault = async (enabled: boolean) => {
        if (!isProjectOwner) return;
        const previous = memberFileUploadDefault;
        setMemberFileUploadDefault(enabled);
        setSavingMemberFileUploadDefault(true);
        try {
            const result = await updateProject(projectId, { memberFileUploadDefault: enabled });
            if (!result?.success) {
                setMemberFileUploadDefault(previous);
                toast.error("Failed to update the upload default for new members.");
                return;
            }
            toast.success("Upload default for new members updated.");
            onProjectUpdated();
        } catch (error) {
            setMemberFileUploadDefault(previous);
            toast.error(error instanceof Error ? error.message : "Failed to update the upload default for new members.");
        } finally {
            setSavingMemberFileUploadDefault(false);
        }
    };
    const handleCancelNotifications = useCallback(() => {
        setProjectNotificationDraft(projectNotificationData?.policy ?? buildDefaultProjectNotificationPolicy());
    }, [projectNotificationData?.policy]);

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
                void loadCollaborators("refresh");
                onProjectUpdated();
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
    }, [confirmAction, loadCollaborators, onProjectUpdated, router]);

    const handleExecuteArchive = useCallback(async () => {
        setConfirmLoading(true);
        try {
            const result = await archiveProjectAction(projectId);
            if (!result.success) {
                toast.error(result.message);
                return;
            }
            await loadDangerPreflight(true);
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
            await loadDangerPreflight(true);
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
                            className="nb-touch-target mt-2 h-[34px] w-full rounded-[5px] border border-border bg-card px-3 text-[13px] text-foreground outline-none focus:border-primary focus:ring-1 focus:ring-primary"
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
                                <div className="px-3 py-1 font-mono text-[10px] max-md:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
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
                    <div className="mt-2 space-y-3 border-t border-border pt-2 max-md:max-h-[60dvh] max-md:overflow-y-auto max-md:overscroll-contain">
                        {SECTION_GROUPS.map((group) => {
                            const groupSections = sections.filter((s) => group.sectionIds.includes(s.id));
                            if (groupSections.length === 0) return null;
                            return (
                                <div key={group.id} className="space-y-1">
                                    <div className="px-3 py-1 font-mono text-[10px] max-md:text-[11px] font-semibold uppercase tracking-wider text-muted-foreground/70">
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


                {/* activeSection === "general" && ( */}
                {sections.some((s) => s.id === "general") && (
                    <GeneralSettingsSection
                        projectId={projectId}
                        project={project}
                        onProjectUpdated={onProjectUpdated}
                        initialIdentity={initialIdentity}
                        projectTitle={projectTitle}
                        onProjectTitleChange={setProjectTitle}
                    />
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
                                            <h3 className="nb-ui-label text-sm font-semibold text-foreground">Project visibility</h3>
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
                                            <h3 className="nb-ui-label text-sm font-semibold text-foreground">Public surface visibility</h3>
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
                                            Defaults are Dashboard, Docs, Updates, and Files on; Sprints and Tasks off. If the project is Private, these settings are saved but only apply after the project becomes Public again.
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
                                            className="nb-touch-target h-[34px] gap-1.5 rounded-[5px] border-border px-3 text-[13px] font-medium leading-[1.2] text-foreground shrink-0 hover:bg-muted"
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
                                <CollaboratorSearchField onCommit={setCollaboratorSearch} />
                                <div className="flex items-center gap-2">
                                    <div
                                        className="flex items-center gap-1.5 overflow-x-auto pb-0.5 no-scrollbar [scrollbar-width:none]"
                                        aria-label="Filter collaborators by role"
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
                                                aria-pressed={collaboratorFilter === id}
                                                onClick={() => setCollaboratorFilter(id)}
                                                className={cn(
                                                    "nb-touch-target h-[28px] shrink-0 whitespace-nowrap rounded-[5px] px-3 text-xs font-medium transition-colors inline-flex items-center",
                                                    collaboratorFilter === id
                                                        ? "bg-foreground text-background shadow-xs"
                                                        : "bg-muted/60 text-muted-foreground hover:bg-muted hover:text-foreground",
                                                )}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Section 1: Leadership Showcase (visible on all or admin filter when not actively searching) */}
                            {(collaboratorFilter === "all" || collaboratorFilter === "admin") && !collaboratorSearch.trim() ? (
                                <div className="space-y-3 pb-6">
                                    <div className="flex items-center justify-between pb-2 border-b border-border/60">
                                        <div className="flex items-center gap-2">
                                            <Shield className="h-4 w-4 text-primary" />
                                            <span className="nb-ui-label text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                                                Project leadership
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
                                                Team directory
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
                                            className="nb-touch-target h-[34px] gap-2 rounded-[5px] border-border px-3.5 text-[13px] font-medium leading-[1.2] text-foreground"
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
                                    !isProjectOwner ? (
                                        <p className="nb-compact text-xs text-muted-foreground italic">
                                            Only the owner can change this.
                                        </p>
                                    ) : (
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
                                                    className="nb-touch-target h-[34px] rounded-[5px] border-border px-3.5 text-[13px] font-medium leading-[1.2] text-foreground hover:bg-muted"
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    onClick={handleSaveRoles}
                                                    disabled={!rolesDirty || savingSettings}
                                                    className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]"
                                                >
                                                    {savingSettings ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
                                                    Save changes
                                                </Button>
                                            </div>
                                        </>
                                    )
                                }
                            >
                                <ProjectRolesEditor
                                    fields={roleFields}
                                    register={registerRoles}
                                    control={rolesControl}
                                    errors={roleErrors}
                                    disabled={savingSettings || !isProjectOwner}
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
                                                    Content delivery &amp; notification rules
                                                </span>
                                            </div>
                                            <span className="nb-meta text-xs text-muted-foreground">
                                                Security &amp; alerts
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
                                                    Publishing permissions
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
                                                {!isProjectOwner ? (
                                                    <p className="nb-compact mt-1 text-xs text-muted-foreground italic">
                                                        Only the owner can change this.
                                                    </p>
                                                ) : null}
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
                                                    disabled={savingMemberUpdates || !isProjectOwner}
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
                                isOwner={isProjectOwner}
                                onSave={async (stages: string[], currentActiveStage: string) => {
                                    setSavingLifecycle(true);
                                    try {
                                        const result = await updateProjectLifecycleAction(projectId, stages, currentActiveStage);
                                        if (result.success) {
                                            toast.success("Lifecycle updated.");
                                            onProjectUpdated();
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
                                        className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium gap-2 self-start sm:self-auto border-border hover:bg-muted/50"
                                    >
                                        <RefreshCw className={cn("size-3.5", fileWorkspaceLoading && "animate-spin")} />
                                        Refresh
                                    </Button>
                                </div>
                            }
                        >
                            <div className="mb-4 flex items-start justify-between gap-4 border-b border-border pb-4">
                                <div className="min-w-0">
                                    <p className="nb-ui-label text-foreground">New members can upload files</p>
                                    <p className="nb-compact mt-1 text-muted-foreground">The starting upload permission for people who join. Existing members keep their own setting below.</p>
                                    {!isProjectOwner ? (
                                        <p className="nb-compact mt-1 text-xs text-muted-foreground italic">
                                            Only the owner can change this.
                                        </p>
                                    ) : null}
                                </div>
                                <SettingsSwitch
                                    checked={memberFileUploadDefault}
                                    disabled={savingMemberFileUploadDefault || !isProjectOwner}
                                    aria-label="New members can upload files"
                                    onCheckedChange={(checked) => void handleToggleMemberFileUploadDefault(checked)}
                                />
                            </div>
                            <FileWorkspaceMembers
                                data={fileWorkspaceData}
                                isLoading={fileWorkspaceLoading && !fileWorkspaceData}
                                savingMemberId={fileWorkspaceSavingMemberId}
                                bulkSaving={fileWorkspaceBulkSaving}
                                onToggle={handleToggleMemberFileUpload}
                                onBulkToggle={handleBulkFileUploadPermission}
                                filePolicy={FILE_POLICY}
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
                                                className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2] border-border hover:bg-muted/50"
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                disabled={!notificationDirty || savingSettings}
                                                onClick={() => void handleSaveNotifications()}
                                                className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2] gap-1.5"
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
                                                    Workflow event triggers
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
                                                className="nb-touch-target h-[28px] rounded-[5px] px-2.5 text-xs font-medium border-border hover:bg-muted/50"
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
                                            {NOTIFICATION_GROUPS.map((group) => (
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
                                    className="nb-touch-target h-[28px] gap-1.5 rounded-[5px] border-border px-2.5 text-xs font-medium"
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
                                            className="nb-touch-target h-[34px] gap-2 rounded-[5px] border-border px-3.5 text-[13px] font-medium"
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
                                                className="nb-touch-target h-[34px] w-full rounded-[5px] border border-border bg-card px-3 text-[13px] text-foreground outline-none transition-colors focus:border-primary"
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
                                            className="nb-touch-target h-[34px] shrink-0 gap-2 rounded-[5px] px-3.5 text-[13px] font-medium"
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
                                                    <div className="flex size-6 shrink-0 items-center justify-center rounded-[3px] bg-muted font-mono text-[10px] max-md:text-[11px] font-semibold text-muted-foreground uppercase">
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
                                            className="nb-touch-target h-[34px] gap-2 rounded-[5px] px-3.5 text-[13px] font-medium"
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
                size="wide"
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
