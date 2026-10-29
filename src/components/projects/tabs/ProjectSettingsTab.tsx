"use client";

import { ChildOrgSection } from "@/components/organizations/ChildOrgSection";
import { ChildUnitsPanel } from "@/components/organizations/ChildUnitsPanel";
import { OrgDangerZone } from "@/components/organizations/OrgDangerZone";
import { OrgAccessSection, OrgChatSection, OrgNotificationsSection, OrgVerificationSection, OrgLeaveSection, OrgMembershipSection, OrgPeopleSection, OrgProfileSection, OrgProjectsSection, OrgWorkSection } from "@/components/organizations/OrgSettingsSections";
import { ORG_SECTION_DEFS, orgSettingsSectionIds, type OrgMemberRole, type OrgSettingsSectionId } from "@/lib/organizations/settings";
import { useRoleApplicationCounts } from "@/hooks/useRoleApplicationCounts";
import { TaskCompletionSettings } from "@/components/projects/settings/TaskCompletionSettings";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import { useFieldArray, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { Archive, Crown, Loader2, Lock, RefreshCw, Shield, Trash2, Users } from "lucide-react";
import { toast, feedbackError } from "@/lib/feedback";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import {
    ProjectArchiveModal,
    ProjectTransferOwnershipModal,
    ProjectDeleteModal,
} from "@/components/projects/settings/ProjectDangerModals";
import { Button } from "@/components/ui/button";
import { transferProjectOwnership } from "@/app/actions/account";
import { archiveProjectAction, deleteProject, getProjectAccessTransitionPreflightAction, getProjectCollaboratorSettingsAction, getProjectDangerZonePreflightAction, getProjectFileAccessSettingsAction, getProjectMemberRemovalPreflightAction, readProjectMemberNotificationSettingsAction, readProjectNotificationSettingsAction, readProjectSettingsBootstrapAction, removeProjectMemberAction, resetProjectMemberNotificationSettingsAction, resetProjectNotificationSettingsAction, updateProject, updateProjectLifecycleAction, updateProjectFileUploadDefaultsAction, updateProjectMemberFileUploadAction, updateProjectMemberNotificationSettingsAction, updateProjectMemberRoleAction, updateProjectNotificationSettingsAction, updateProjectPublicTabVisibilityAction, updateProjectVisibilityAction } from "@/app/actions/project";
import { readProjectDocSettingsAction, updateProjectDocSettingsAction } from "@/app/actions/project/doc";
import { cn } from "@/lib/utils";
import {
    buildDefaultProjectNotificationPolicy,
    getVisibleProjectNotificationEntries,
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
import { OpenSettingsSections } from "@/components/settings/ui/SettingsSectionLayout";
import { SettingsPageHeader } from "@/components/settings/ui/SettingsPageHeader";
import { ProjectSettingsNavigation } from "@/components/projects/settings/ProjectSettingsNavigation";
import { useProjectSettingsNavigation } from "@/hooks/useProjectSettingsNavigation";
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
import { FileAccessMembers, type FileAccessSettingsData } from '@/components/projects/settings/FileAccessMembers';
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
// Organizations add their own event groups (report §26.8).
const ORG_NOTIFICATION_GROUPS = groupProjectNotificationEntries(getVisibleProjectNotificationEntries(true));
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

export default function ProjectSettingsTab(props: ProjectSettingsTabProps) {
    return <ProjectSettingsContent key={props.projectId} {...props} />;
}

function ProjectSettingsContent({
    projectId,
    project,
    onProjectUpdated,
    isProjectOwner,
    actorRole,
    members = [],
    loadingMembers = false,
}: ProjectSettingsTabProps) {
    const router = useRouter();
    const mountedRef = useRef(true);
    useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);
    const [settingsErrors, setSettingsErrors] = useState<Record<string, string | null>>({});
    const setLoadError = useCallback((section: string, message: string | null) => setSettingsErrors((current) => ({ ...current, [section]: message })), []);
    const [readmeLoaded, setReadmeLoaded] = useState(false);
    const actorProjectRole = isProjectOwner ? "owner" : actorRole ?? "member";
    const canManageSettings = isProjectOwner || actorProjectRole === "admin";
    const organization = project?.organization ?? null;
    const orgRole = (isProjectOwner ? "owner" : actorProjectRole) as OrgMemberRole;
    const sections = useMemo(() => {
        // A child project's role boxes are its units (report §21 #6, "Units & open seats").
        const visible = getVisibleProjectSettingsSections().map((section) => (project?.parentOrg && section.id === "roles-applications"
            ? { ...section, label: "Units & open seats", description: "Units, their seats and unit leads; open seats org members can apply to." } : section));
        if (organization) {
            // Report §21.4: You sections for everyone, org sections for admins, owner extras for the owner.
            return orgSettingsSectionIds(orgRole).flatMap((id) => {
                const orgDef = ORG_SECTION_DEFS[id as OrgSettingsSectionId];
                const def = orgDef ? { id, ...orgDef } : visible.find((section) => section.id === id);
                return def ? [def] : [];
            });
        }
        // Settings → Organization (report §21.6): second for the lead, first for admins, alone for inherited org admins.
        const childOrgSection = { id: "child-org" as const, label: "Organization", description: "The organization this project belongs to, and its rules." };
        const showsChildOrg = Boolean(project?.parentOrg || project?.pendingMoveIn || project?.moveTargets?.length);
        if (project?.parentOrg?.viewerIsInheritedAdmin && !isProjectOwner && actorProjectRole !== "admin") return [childOrgSection];
        if (isProjectOwner) return showsChildOrg ? visible.flatMap((section) => (section.id === "general" ? [section, childOrgSection] : [section])) : visible;
        if (actorProjectRole === "admin" && project?.parentOrg) {
            const adminSections: ProjectSettingsSectionId[] = ["links", "access", "collaborators", "roles-applications", "readme", "updates", "tasks-workflow", "files-workspace", "notifications", "privacy-policies", "privacy-terms"];
            return [childOrgSection, ...visible.filter((section) => adminSections.includes(section.id))];
        }
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
    }, [actorProjectRole, isProjectOwner, organization, orgRole, project?.parentOrg, project?.pendingMoveIn, project?.moveTargets?.length]);
    const { activeSection, navigate: handleNavigateSection } = useProjectSettingsNavigation(sections);
    const [savingAccess, setSavingAccess] = useState(false);
    const [savingRoles, setSavingRoles] = useState(false);
    const [savingNotifications, setSavingNotifications] = useState(false);
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
    const [collaboratorLoading, setCollaboratorLoading] = useState(true);
    const [collaboratorRefreshing, setCollaboratorRefreshing] = useState(false);
    const [collaboratorLoadingMore, setCollaboratorLoadingMore] = useState(false);
    const [collaboratorFilter, setCollaboratorFilter] = useState<CollaboratorFilter>("all");
    const [collaboratorSearch, setCollaboratorSearch] = useState("");
    const [fileAccessData, setFileAccessData] = useState<FileAccessSettingsData | null>(null);
    const [fileAccessQuery, setFileAccessQuery] = useState("");
    const [fileAccessFilter, setFileAccessFilter] = useState<"all" | "enabled" | "disabled">("all");
    const [fileAccessLoadingMore, setFileAccessLoadingMore] = useState(false);
    const fileAccessDataRef = useRef<FileAccessSettingsData | null>(null);
    const fileAccessRequestRef = useRef(0);
    const [fileAccessLoading, setFileAccessLoading] = useState(true);
    const [fileAccessSavingMemberId, setFileAccessSavingMemberId] = useState<string | null>(null);
    const [fileAccessBulkSaving, setFileAccessBulkSaving] = useState(false);
    const projectNotificationDataRef = useRef<ProjectNotificationSettingsData | null>(null);
    const [projectNotificationData, setProjectNotificationData] = useState<ProjectNotificationSettingsData | null>(null);
    const [projectNotificationDraft, setProjectNotificationDraft] = useState<ProjectNotificationPolicy>(() => buildDefaultProjectNotificationPolicy());
    useEffect(() => { projectNotificationDataRef.current = projectNotificationData; }, [projectNotificationData]);
    const [projectNotificationLoading, setProjectNotificationLoading] = useState(true);
    const [expandedNotificationGroups, setExpandedNotificationGroups] = useState<Record<string, boolean>>({});
    const [, setReadmeSettings] = useState<ProjectDocSettings>(() => DEFAULT_PROJECT_DOC_SETTINGS);
    const [readmeSettingsDraft, setReadmeSettingsDraft] = useState<ProjectDocSettings>(() => DEFAULT_PROJECT_DOC_SETTINGS);
    const [readmeSettingsLoading, setReadmeSettingsLoading] = useState(true);
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
            role: leadFocus || "Owner",
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
    const roleApplicationCounts = useRoleApplicationCounts(projectId);
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
        if (savingAccess) return;
        setVisibility(initialVisibility);
        setSavedVisibility(initialVisibility);
    }, [initialVisibility]);
    useEffect(() => {
        if (savingPublicTabId) return;
        setPublicTabVisibility(initialSettings.publicTabVisibility);
        setSavedPublicTabVisibility(initialSettings.publicTabVisibility);
    }, [initialPublicTabVisibilityKey]);
    useEffect(() => {
        if (!savingMemberUpdates) setMemberUpdatesEnabled(initialMemberUpdates);
    }, [initialMemberUpdates]);
    useEffect(() => {
        if (!savingMemberFileUploadDefault && !fileAccessBulkSaving) setMemberFileUploadDefault(initialFileUploadDefault);
    }, [initialFileUploadDefault]);

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

    const ownerId = projectOwnerId(project);
    const collaboratorMembers = collaboratorData?.members ?? members;
    const rolePolicy = buildProjectRolePolicy({ isOwner: isProjectOwner, actorRole: actorProjectRole, ownerId, members: collaboratorMembers });
    const filteredCollaborators = rolePolicy.members.filter((member) => projectMemberRole(member, ownerId) !== "owner");
    const notificationGroups = organization ? ORG_NOTIFICATION_GROUPS : NOTIFICATION_GROUPS;
    const notificationSummary = summarizeProjectNotificationPolicy(projectNotificationDraft, Boolean(organization));
    const toggleNotificationGroup = (groupId: string) => {
        setExpandedNotificationGroups((prev) => ({
            ...prev,
            [groupId]: !prev[groupId],
        }));
    };
    const areAllNotificationGroupsExpanded = notificationGroups.length > 0 && notificationGroups.every((g) => expandedNotificationGroups[g.id]);
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
        setLoadError("danger", null);
        try {
            const result = await (pending ?? getProjectDangerZonePreflightAction(projectId));
            if (!mountedRef.current) return;
            if (!result.success) {
                setLoadError("danger", result.message);

                toast.error(feedbackError(result.message, "Action couldn’t finish"));
                return;
            }
            dangerPreflightLoadedRef.current = true;
            setDangerPreflight(result.data);
        } catch (error) {
            if (!mountedRef.current) return;
            setLoadError("danger", "Unable to load these settings. Please retry.");
            console.error("Failed to load danger-zone preflight", error);

            toast.error("Couldn’t load danger-zone checks");
        } finally {
            setDangerPreflightLoading(false);
        }
    }, [isProjectOwner, projectId, setLoadError]);

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
        setLoadError("collaborators", null);
        try {
            const result = await (pending ?? getProjectCollaboratorSettingsAction(projectId, {
                limit: 40,
                cursor,
                query: collaboratorSearch,
                roleFilter: collaboratorFilter,
            }));
            if (!mountedRef.current || seq !== collaboratorRequestSeqRef.current) return;
            if (!result.success) {
                setLoadError("collaborators", result.message);

                toast.error(feedbackError(result.message, "Action couldn’t finish"));
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
            if (!mountedRef.current || seq !== collaboratorRequestSeqRef.current) return;
            setLoadError("collaborators", "Unable to load these settings. Please retry.");
            console.error("Couldn’t load members", error);

            toast.error("Couldn’t load members");
        } finally {
            if (seq === collaboratorRequestSeqRef.current) {
                setCollaboratorLoading(false);
                setCollaboratorRefreshing(false);
                setCollaboratorLoadingMore(false);
            }
        }
    }, [collaboratorFilter, collaboratorSearch, projectId, setLoadError]);

    const loadFileAccessSettings = useCallback(async (mode: "replace" | "more" = "replace", pending?: ReturnType<typeof getProjectFileAccessSettingsAction>) => {
        const more = mode === "more";
        if (more && !fileAccessDataRef.current?.nextCursor) return;
        const seq = ++fileAccessRequestRef.current;
        if (more) setFileAccessLoadingMore(true); else setFileAccessLoading(true);
        setLoadError("files", null);
        try {
            const result = await (pending ?? getProjectFileAccessSettingsAction(projectId, {
                query: fileAccessQuery, permissionFilter: fileAccessFilter,
                cursor: more ? fileAccessDataRef.current?.nextCursor : undefined,
            }));
            if (!mountedRef.current || seq !== fileAccessRequestRef.current) return;
            if (!result.success) { setLoadError("files", result.message); return; }
            setFileAccessData((current) => {
                const existing = new Set(current?.members.map((member) => member.id));
                return more && current ? { ...result.data, members: [...current.members, ...result.data.members.filter((member) => !existing.has(member.id))] } : result.data;
            });
        } catch {
            if (mountedRef.current && seq === fileAccessRequestRef.current) setLoadError("files", "Unable to load file permissions. Please retry.");
        } finally {
            if (mountedRef.current && seq === fileAccessRequestRef.current) { setFileAccessLoading(false); setFileAccessLoadingMore(false); }
        }
    }, [projectId, fileAccessQuery, fileAccessFilter, setLoadError]);
    useEffect(() => { fileAccessDataRef.current = fileAccessData; }, [fileAccessData]);
    const initialFileFilterRef = useRef(false);
    useEffect(() => {
        if (!initialFileFilterRef.current) { initialFileFilterRef.current = true; return; }
        void loadFileAccessSettings();
    }, [fileAccessQuery, fileAccessFilter, loadFileAccessSettings]);

    const projectNotificationLoadedRef = useRef(false);
    const loadProjectNotificationSettings = useCallback(async (force = false, pending?: ReturnType<typeof readProjectNotificationSettingsAction>) => {
        if (projectNotificationLoadedRef.current && !force) return;
        setProjectNotificationLoading(true);
        setLoadError("notifications", null);
        try {
            const result = await (pending ?? readProjectNotificationSettingsAction(projectId));
            if (!mountedRef.current) return;
            if (!result.success) {
                setLoadError("notifications", result.message);

                toast.error(feedbackError(result.message, "Action couldn’t finish"));
                return;
            }
            projectNotificationLoadedRef.current = true;
            setProjectNotificationData(result.data);
            setProjectNotificationDraft((draft) => projectNotificationDataRef.current && JSON.stringify(draft) !== JSON.stringify(projectNotificationDataRef.current.policy) ? draft : result.data.policy);
        } catch (error) {
            if (!mountedRef.current) return;
            setLoadError("notifications", "Unable to load these settings. Please retry.");
            console.error("Failed to load project notification settings", error);

            toast.error("Couldn’t load workspace notification settings");
        } finally {
            setProjectNotificationLoading(false);
        }
    }, [projectId, setLoadError]);

    const readmeLoadedRef = useRef(false);
    const loadReadmeSettings = useCallback(async (force = false, pending?: ReturnType<typeof readProjectDocSettingsAction>) => {
        if (readmeLoadedRef.current && !force) return;
        setReadmeSettingsLoading(true);
        setLoadError("readme", null);
        try {
            const result = await (pending ?? readProjectDocSettingsAction(projectId));
            if (!mountedRef.current) return;
            if (!result.success) {
                setLoadError("readme", result.error);
                toast.error(feedbackError(result.error, "Action couldn’t finish"));
                return;
            }
            readmeLoadedRef.current = true;
            setReadmeLoaded(true);
            const normalized = normalizeProjectDocSettings(result.settings);
            setReadmeSettings(normalized);
            setReadmeSettingsDraft(normalized);
        } catch (error) {
            if (!mountedRef.current) return;
            setLoadError("readme", "Unable to load these settings. Please retry.");
            console.error("Failed to load document settings", error);
            toast.error("Couldn’t load document settings");
        } finally {
            setReadmeSettingsLoading(false);
        }
    }, [projectId, setLoadError]);

    const bootstrappedProjectRef = useRef<string | null>(null);
    useEffect(() => {
        if (!canManageSettings || bootstrappedProjectRef.current === projectId) return;
        bootstrappedProjectRef.current = projectId;
        const bootstrap = readProjectSettingsBootstrapAction(projectId, {
            limit: 40,
            query: collaboratorSearch,
            roleFilter: collaboratorFilter,
        });
        void loadCollaborators("initial", bootstrap.then((data) => data.collaboratorSettings));
        void loadFileAccessSettings("replace", bootstrap.then((data) => data.fileAccess));
        void loadProjectNotificationSettings(false, bootstrap.then((data) => data.notifications));
        void loadReadmeSettings(false, bootstrap.then((data) => data.docSettings));
        if (isProjectOwner) void loadDangerPreflight(false, bootstrap.then((data) => data.dangerPreflight));
    }, [collaboratorFilter, collaboratorSearch, loadCollaborators, loadDangerPreflight, loadFileAccessSettings, loadProjectNotificationSettings, loadReadmeSettings, projectId, canManageSettings, isProjectOwner]);

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
        if (!isProjectOwner || savingRoles) return;
        void handleRolesSubmit(
            async (values) => {
                setSavingRoles(true);
                try {
                    const result = await updateProject(projectId, {
                        roles: values.roles,
                        deletedRoleIds,
                    });
                    if (!result?.success) {
                        toast.error("Couldn’t update workspace roles");
                        return;
                    }

                    const leadRole = values.roles.find((r) => r.id === "lead-role");
                    const nextOpenRoles = normalizeProjectRoleFormValues((result as { openRoles?: unknown }).openRoles);
                    const nextRoles = leadRole ? [leadRole, ...nextOpenRoles] : nextOpenRoles;
                    resetRolesForm({ roles: nextRoles });
                    setDeletedRoleIds([]);
                    toast.success("Workspace roles updated");
                    onProjectUpdated();
                } catch (error) {
                    console.error("Failed to save project roles", error);
                    toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t update workspace roles", "Couldn’t update workspace roles"));
                } finally {
                    setSavingRoles(false);
                }
            },
            () => {
                toast.error("Fix role fields before saving");
            },
        )();
    }, [deletedRoleIds, handleRolesSubmit, isProjectOwner, onProjectUpdated, projectId, resetRolesForm, router, savingRoles]);

    const handleTogglePublicTab = useCallback(async (tabId: ProjectPublicTabId, enabled: boolean) => {
        if (savingPublicTabId || savingAccess) return;
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
                toast.error(feedbackError(result.message, "Action couldn’t finish"));
                return;
            }
            toast.success(`${PROJECT_PUBLIC_TAB_LABELS[tabId]} visibility updated`);
            onProjectUpdated();
        } catch (error) {
            setPublicTabVisibility(previous);
            setSavedPublicTabVisibility(previous);
            console.error("Failed to update public tab visibility", error);
            toast.error("Couldn’t update tab visibility");
        } finally {
            setSavingPublicTabId(null);
        }
    }, [onProjectUpdated, projectId, publicTabVisibility, router, savingPublicTabId, savingAccess]);

    const handleSelectVisibility = async (nextVisibility: ProjectSettingsVisibility) => {
        if (savingAccess || confirmLoading || nextVisibility === visibility) return;
        setSavingAccess(true);
        try {
            const preflightResult = await getProjectAccessTransitionPreflightAction(projectId, nextVisibility);
            if (!preflightResult.success) {
                toast.error(feedbackError(preflightResult.message, "Action couldn’t finish"));
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
            toast.error("Couldn’t prepare access transition");
        } finally {
            setSavingAccess(false);
        }
    };

    const handleToggleMemberFileUpload = useCallback(async (member: FileAccessSettingsData["members"][number], enabled: boolean) => {
        if (member.uploadPermissionLocked || fileAccessSavingMemberId || fileAccessBulkSaving || savingMemberFileUploadDefault || fileAccessLoading || settingsErrors.files) return;
        setFileAccessSavingMemberId(member.id);
        const previousData = fileAccessData;
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
            setFileAccessData({
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
                if (previousData) setFileAccessData(previousData);
                toast.error(feedbackError(result.message, "Action couldn’t finish"));
                return;
            }
            toast.success(result.message);
        } catch (error) {
            if (previousData) setFileAccessData(previousData);
            console.error("Failed to update file upload permission", error);
            toast.error("Couldn’t update file upload permission");
        } finally {
            setFileAccessSavingMemberId(null);
        }
    }, [fileAccessData, projectId, fileAccessSavingMemberId, fileAccessBulkSaving, savingMemberFileUploadDefault, fileAccessLoading, settingsErrors.files]);

    const handleBulkFileUploadPermission = useCallback(async (enabled: boolean) => {
        if (fileAccessSavingMemberId || fileAccessBulkSaving || savingMemberFileUploadDefault || fileAccessLoading || !fileAccessData || settingsErrors.files) return false;
        setFileAccessBulkSaving(true);
        const previousData = fileAccessData;
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
            setFileAccessData({
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
                if (previousData) setFileAccessData(previousData);
                toast.error(feedbackError(result.message, "Action couldn’t finish"));
                return false;
            }
            setMemberFileUploadDefault(enabled);
            toast.success(result.message);
            return true;
        } catch (error) {
            if (previousData) setFileAccessData(previousData);
            console.error("Failed to update file upload defaults", error);
            toast.error("Couldn’t update file upload defaults");
            return false;
        } finally {
            setFileAccessBulkSaving(false);
        }
    }, [fileAccessData, projectId, fileAccessSavingMemberId, fileAccessBulkSaving, savingMemberFileUploadDefault, fileAccessLoading, settingsErrors.files]);

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
        if (savingNotifications || !projectNotificationData || settingsErrors.notifications) return;
        setSavingNotifications(true);
        try {
            const result = await updateProjectNotificationSettingsAction(projectId, projectNotificationDraft);
            if (!result.success) {
                toast.error(feedbackError(result.message, "Action couldn’t finish"));
                return;
            }
            setProjectNotificationData(result.data);
            setProjectNotificationDraft(result.data.policy);
            toast.success(result.message ?? "Workspace notification settings updated");
        } catch (error) {
            console.error("Failed to save project notification settings", error);
            toast.error("Couldn’t save workspace notification settings");
        } finally {
            setSavingNotifications(false);
        }
    };

    const handleToggleReadmeSetting = async (key: keyof ProjectDocSettings, enabled: boolean) => {
        if (!readmeLoaded || savingReadmeKey || settingsErrors.readme) return;
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
                toast.error(feedbackError(result.error || "Couldn’t update document setting", "Couldn’t update document setting"));
                return;
            }
            const normalized = normalizeProjectDocSettings(result.settings);
            setReadmeSettings(normalized);
            setReadmeSettingsDraft(normalized);
            toast.success("Document setting updated");
            onProjectUpdated();
        } catch (error) {
            setReadmeSettingsDraft(previous);
            setReadmeSettings(previous);
            console.error("Failed to save document setting", error);
            toast.error("Couldn’t save document setting");
        } finally {
            setSavingReadmeKey(null);
        }
    };

    const handleResetNotifications = async () => {
        setSavingNotifications(true);
        try {
            const result = await resetProjectNotificationSettingsAction(projectId, "balanced");
            if (!result.success) {
                toast.error(feedbackError(result.message, "Action couldn’t finish"));
                return;
            }
            setProjectNotificationData(result.data);
            setProjectNotificationDraft(result.data.policy);
            toast.success(result.message ?? "Workspace notification settings reset");
        } catch (error) {
            console.error("Failed to reset project notification settings", error);
            toast.error("Couldn’t reset workspace notification settings");
        } finally {
            setSavingNotifications(false);
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
                toast.error(feedbackError(result.message, "Action couldn’t finish"));
                setConfirmAction(null);
                return;
            }
            setMemberNotificationData(result.data);
            setMemberNotificationDraft(result.data.overrides);
        } catch (error) {
            console.error("Failed to load member notification settings", error);
            toast.error("Couldn’t load member notification settings");
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
                toast.error(feedbackError(result.message, "Action couldn’t finish"));
                return;
            }
            setMemberNotificationData(result.data);
            setMemberNotificationDraft(result.data.overrides);
            toast.success(result.message ?? "Member notification preferences updated");
        } catch (error) {
            console.error("Failed to save member notification settings", error);
            toast.error("Couldn’t save member notification settings");
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
                toast.error(feedbackError(result.message, "Action couldn’t finish"));
                return;
            }
            setMemberNotificationData(result.data);
            setMemberNotificationDraft(result.data.overrides);
            toast.success(result.message ?? "Member notification preferences reset");
        } catch (error) {
            console.error("Failed to reset member notification settings", error);
            toast.error("Couldn’t reset member notification settings");
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
                toast.error("Couldn’t update member publishing permissions");
                return;
            }
            toast.success("Member publishing permissions updated");
            onProjectUpdated();
        } catch (error) {
            setMemberUpdatesEnabled(previous);
            console.error("Failed to save updates settings", error);
            toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t save updates settings", "Couldn’t save updates settings"));
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
                toast.error("Couldn’t update the upload default for new members");
                return;
            }
            toast.success("Upload default for new members updated");
            onProjectUpdated();
        } catch (error) {
            setMemberFileUploadDefault(previous);
            toast.error(feedbackError(error instanceof Error ? error.message : "Couldn’t update the upload default for new members", "Couldn’t update the upload default for new members"));
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
                toast.error(feedbackError(result.message, "Action couldn’t finish"));
                return;
            }
            toast.success(result.message);
            if (result.refresh) {
                void loadCollaborators("refresh");
                void loadFileAccessSettings();
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
            toast.error("Action failed", { description: "Try again." });
        } finally {
            setConfirmLoading(false);
        }
    }, [confirmAction, loadCollaborators, loadFileAccessSettings, onProjectUpdated, router]);

    const handleExecuteArchive = useCallback(async () => {
        setConfirmLoading(true);
        try {
            const result = await archiveProjectAction(projectId);
            if (!result.success) {
                toast.error(feedbackError(result.message, "Action couldn’t finish"));
                return;
            }
            await loadDangerPreflight(true);
            onProjectUpdated?.();
            setArchiveModalOpen(false);
            toast.success(result.message);
        } catch (error) {
            console.error("Failed to archive project:", error);
            toast.error("Couldn’t archive workspace");
        } finally {
            setConfirmLoading(false);
        }
    }, [loadDangerPreflight, onProjectUpdated, projectId]);

    const handleExecuteTransfer = useCallback(async (candidate: ProjectSettingsMember) => {
        setConfirmLoading(true);
        try {
            const result = await transferProjectOwnership(projectId, candidate.id);
            if (!result.success) {
                toast.error(feedbackError(result.error ?? "Couldn’t transfer ownership", "Couldn’t transfer ownership"));
                return;
            }
            await loadCollaborators("refresh");
            await loadDangerPreflight(true);
            onProjectUpdated?.();
            setTransferModalOpen(false);
            setSelectedTransferCandidate(null);
            setTransferOwnerId("");
            toast.success("Workspace ownership transferred");
        } catch (error) {
            console.error("Failed to transfer ownership:", error);
            toast.error("Couldn’t transfer ownership");
        } finally {
            setConfirmLoading(false);
        }
    }, [loadCollaborators, loadDangerPreflight, onProjectUpdated, projectId]);

    const prepareArchive = useCallback(() => {
        if (!dangerPreflight) {
            toast.error("Run danger-zone preflight before archiving");
            return;
        }
        if (dangerPreflight && !dangerPreflight.canArchive) {
            toast.error("Workspace is already archived");
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
            toast.error("Choose a member before transferring ownership");
            return;
        }
        prepareTransferToMember(candidate);
    }, [prepareTransferToMember, rolePolicy.transferCandidates, transferOwnerId]);

    const prepareRoleChange = useCallback((member: ProjectSettingsMember, nextRole: Exclude<ProjectMemberRole, "owner">) => {
        const currentRole = projectMemberRole(member, ownerId);
        if (currentRole === nextRole) {
            toast.info(`${getProjectMemberDisplayName(member)} is already ${getProjectMemberRoleLabel(nextRole)}`);
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
            toast.error(feedbackError(policy.blockedReason ?? "This member role cannot be changed", "This member role cannot be changed"));
            return;
        }
        setConfirmAction({
            title: `Change access level to ${getProjectMemberRoleLabel(nextRole)}`,
            description: `${getProjectMemberDisplayName(member)} will move from ${getProjectMemberRoleLabel(currentRole as ProjectMemberRole)} to ${getProjectMemberRoleLabel(nextRole)}. Their tasks, files, applications and notifications change to match.`,
            confirmLabel: "Change access level",
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
            toast.error(feedbackError(policy.blockedReason ?? "This member cannot be removed", "This member cannot be removed"));
            return;
        }

        try {
            const result = await getProjectMemberRemovalPreflightAction(projectId, member.id);
            if (!result.success) {
                toast.error(feedbackError(result.message, "Action couldn’t finish"));
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
            toast.error("Couldn’t load removal impact");
        }
    }, [actorProjectRole, isProjectOwner, ownerId, projectId]);

    const handleExecuteDelete = useCallback(async () => {
        setConfirmLoading(true);
        try {
            const result = await deleteProject(projectId);
            if (!result.success) {
                toast.error(feedbackError(result.message, "Action couldn’t finish"));
                return;
            }
            setDeleteModalOpen(false);
            toast.success(result.message);
            router.push(result.data.redirectTo || "/projects");
        } catch (error) {
            console.error("Failed to delete project:", error);
            toast.error("Couldn’t delete workspace");
        } finally {
            setConfirmLoading(false);
        }
    }, [projectId, router]);

    const prepareDelete = useCallback(() => {
        if (!dangerPreflight) {
            toast.error("Run danger-zone preflight before deleting");
            return;
        }
        if (dangerPreflight && !dangerPreflight.canDelete) {
            toast.error("Workspace cannot be deleted");
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
                <h3 className="nb-section-title text-foreground">Only the owner and admins can change settings</h3>
                <p className="nb-compact mt-2 text-sm leading-6 text-muted-foreground">
                    The owner can change every setting. Admins can manage members and viewers. Ask the owner if you need access.
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
                        ["reassign_active_tasks", "Reassign active tasks", "Give their tasks to another member."],
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
        <OpenSettingsSections>
        <div className="grid w-full min-w-0 grid-cols-1 bg-card xl:grid-cols-[var(--nb-sidebar-width)_minmax(0,1fr)]">
            <ProjectSettingsNavigation sections={sections} activeSection={activeSection} onNavigate={handleNavigateSection} />
            <main data-project-settings-document className="mx-auto min-w-0 w-full max-w-4xl space-y-12 p-4 md:p-[calc(var(--ui-panel-padding)+4px)] [&>[data-project-settings-section]]:border-b [&>[data-project-settings-section]]:border-border [&>[data-project-settings-section]]:pb-8 [&>[data-project-settings-section]:last-child]:border-b-0">
                {organization && sections.some((s) => s.id === "you-membership") && <OrgMembershipSection orgId={projectId} organization={organization} role={orgRole} />}
                {organization && sections.some((s) => s.id === "you-leave") && <OrgLeaveSection orgId={projectId} organization={organization} role={orgRole} title={project?.title ?? "this organization"} />}
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
                {organization && isProjectOwner && sections.some((s) => s.id === "general") ? <OrgVerificationSection orgId={projectId} organization={organization} /> : null}
                {sections.some((s) => s.id === "child-org") && project ? <ChildOrgSection project={project} isLead={isProjectOwner} canManage={canManageSettings} /> : null}
                {organization && sections.some((s) => s.id === "org-profile") && <OrgProfileSection orgId={projectId} organization={organization} role={orgRole} handle={project?.slug ?? null} />}
                {sections.some((s) => s.id === "links") && (
                    <section id="project-settings-links" data-project-settings-section className="space-y-6">
                        <div className="space-y-6">
                            <SettingsCard
                                title="Project links"
                                headingLevel={2}
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
                {sections.some((s) => s.id === "access") && (
                    <section id="project-settings-access" data-project-settings-section className="space-y-6">
                        <div className="space-y-6">
                            <SettingsCard
                                title="Project access & visibility"
                                headingLevel={2}
                                description="This one owner-controlled policy is used by project cards, detail pages, search, files, applications, notifications, and public surfaces."
                            >
                                <div className="divide-y divide-border">
                                    <div className="pb-6">
                                        <div className="mb-4">
                                            <h3 className="nb-ui-label text-sm font-semibold text-foreground">Project visibility</h3>
                                            <p className="nb-compact mt-0.5 text-xs text-muted-foreground">
                                                Choose who can find and see this workspace.
                                            </p>
                                        </div>
                                        {project?.parentOrg ? (
                                            <p className="nb-compact text-muted-foreground">
                                                Public, Org only or Private, within {project.parentOrg.title}&apos;s rules: change it in{" "}
                                                <button type="button" className="font-medium text-foreground underline underline-offset-4" onClick={() => handleNavigateSection("child-org")}>Organization</button>.
                                            </p>
                                        ) : isProjectOwner ? (
                                            <div role="group" aria-label="Project visibility" className="grid gap-3 sm:grid-cols-2">
                                                {VISIBILITY_OPTIONS.map((option) => {
                                                    const isSelected = visibility === option.id;
                                                    return (
                                                        <button
                                                            key={option.id}
                                                            type="button"
                                                            aria-pressed={isSelected}
                                                            onClick={() => void handleSelectVisibility(option.id)}
                                                            disabled={savingAccess}
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
                                                            <span className="mt-2 block nb-compact text-muted-foreground">
                                                                {option.detail}
                                                            </span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        ) : (
                                            <div className="rounded-lg border border-border bg-muted/20 p-4 text-sm text-muted-foreground">
                                                <p className="font-medium text-foreground">Only the owner can change visibility</p>
                                                <p className="mt-1 nb-compact">
                                                    This project is currently <strong className="text-foreground">{visibility === "public" ? "Public" : "Private"}</strong>. Only the owner can change visibility.
                                                </p>
                                            </div>
                                        )}
                                    </div>

                                    <div className="pt-6">
                                        <div className="mb-4">
                                            <h3 className="nb-ui-label text-sm font-semibold text-foreground">Public surface visibility</h3>
                                            <p className="nb-compact mt-0.5 text-xs text-muted-foreground">
                                                Choose which tabs visitors can see. Members always see every tab.
                                            </p>
                                        </div>
                                        <PublicTabVisibilityEditor
                                            value={publicTabVisibility}
                                            onChange={handleTogglePublicTab}
                                            disabled={savingAccess}
                                            savingTabId={savingPublicTabId}
                                        />
                                        <div className="mt-4 border-t border-border pt-4 text-xs leading-relaxed text-muted-foreground">
                                            Defaults are Dashboard, Docs, Updates, and Files on; Sprints and Tasks off. If the project is Private, these settings are saved but only apply after the project becomes Public again.
                                        </div>
                                    </div>
                                </div>
                            </SettingsCard>
                        </div>
                    </section>
                )}
                {organization && sections.some((s) => s.id === "org-access") && <OrgAccessSection orgId={projectId} organization={organization} role={orgRole} maxMembers={project?.maxCollaborators ?? null} />}
                {organization && sections.some((s) => s.id === "org-people") && <OrgPeopleSection orgId={projectId} organization={organization} role={orgRole} />}
                {organization && sections.some((s) => s.id === "org-projects") && <OrgProjectsSection orgId={projectId} organization={organization} role={orgRole} />}
                {organization && sections.some((s) => s.id === "org-work") && <OrgWorkSection orgId={projectId} organization={organization} role={orgRole} />}
                {sections.some((s) => s.id === "collaborators") && (
                    <section id="project-settings-collaborators" data-project-settings-section className="space-y-6">
                        <div className="space-y-6">
                        {project?.parentOrg ? <ChildUnitsPanel projectId={projectId} /> : null}
                        <SettingsCard
                            title="Members"
                                headingLevel={2}
                                loadState={{ allowInteractionWhileLoading: true, loading: collaboratorLoading || collaboratorRefreshing || collaboratorLoadingMore, hasData: Boolean(collaboratorData), error: settingsErrors.collaborators ?? null, retry: () => void loadCollaborators("refresh") }}
                            description="Manage members and their access levels."
                            footer={
                                <>
                                    <p className="nb-compact text-muted-foreground">
                                        {filteredCollaborators.length} {filteredCollaborators.length === 1 ? "member" : "members"} · {1 + rolePolicy.coLeaders.length} {rolePolicy.coLeaders.length === 0 ? "owner" : "owner and admins"}
                                    </p>
                                    <div className="flex items-center gap-2">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            size="sm"
                                            onClick={() => void loadCollaborators("refresh")}
                                            disabled={collaboratorRefreshing || collaboratorLoadingMore || collaboratorLoading}
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
                                        aria-label="Filter members by access level"
                                    >
                                        {([
                                            ["all", "All"],
                                            ["admin", "Admins"],
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
                                            <span className="nb-ui-label text-foreground">
                                                Owner and admins
                                            </span>
                                        </div>
                                        <span className="nb-meta text-xs text-muted-foreground">
                                            {1 + rolePolicy.coLeaders.length} {1 + rolePolicy.coLeaders.length === 1 ? "leader" : "leaders"}
                                        </span>
                                    </div>

                                    <div className="divide-y divide-border">
                                        {rolePolicy.owner ? (
                                            <CollaboratorCard
                                                        disabled={collaboratorLoading || collaboratorRefreshing || collaboratorLoadingMore || confirmLoading}
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
                                                        disabled={collaboratorLoading || collaboratorRefreshing || collaboratorLoadingMore || confirmLoading}
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
                                                    <p className="nb-ui-label text-sm font-semibold">No admins yet</p>
                                                </div>
                                                <p className="nb-compact mt-1.5 text-xs text-muted-foreground leading-relaxed">
                                                    Make a trusted member an admin when they need to manage members and work. Only the owner can archive, delete or transfer the workspace.
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
                                            <span className="nb-ui-label text-foreground">
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
                                                    <p className="nb-card-title text-foreground">No members found</p>
                                                    <p className="nb-compact mt-1 text-muted-foreground">
                                                        {collaboratorSearch.trim()
                                                            ? `No members match "${collaboratorSearch}". Try another name.`
                                                            : `No ${collaboratorFilter === "all" ? "" : collaboratorFilter} members loaded yet.`}
                                                    </p>
                                                </div>
                                            );
                                        }

                                        const card = (member: (typeof displayMembers)[number]) => (
                                            <CollaboratorCard
                                                disabled={collaboratorLoading || collaboratorRefreshing || collaboratorLoadingMore || confirmLoading}
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
                                        );
                                        // Child projects of an org group people by unit (report §21.6 #5); "No unit" comes last.
                                        if (displayMembers.some((m) => m.unitTitle)) {
                                            const units = [...new Set(displayMembers.map((m) => m.unitTitle ?? ""))].sort((a, b) => (a ? b ? a.localeCompare(b) : -1 : 1));
                                            return (
                                                <div className="space-y-4">
                                                    {units.map((unit) => (
                                                        <div key={unit || "none"}>
                                                            <p className="nb-meta pb-1 text-xs text-muted-foreground">{unit || "No unit"}</p>
                                                            <div className="divide-y divide-border">{displayMembers.filter((m) => (m.unitTitle ?? "") === unit).map(card)}</div>
                                                        </div>
                                                    ))}
                                                </div>
                                            );
                                        }
                                        return <div className="divide-y divide-border">{displayMembers.map(card)}</div>;
                                    })()
                                )}

                                {collaboratorData?.hasMore ? (
                                    <div className="mt-6 flex justify-center">
                                        <Button
                                            type="button"
                                            variant="outline"
                                            onClick={() => void loadCollaborators("more")}
                                            disabled={collaboratorLoadingMore || collaboratorRefreshing || collaboratorLoading}
                                            className="nb-touch-target h-[34px] gap-2 rounded-[5px] border-border px-3.5 text-[13px] font-medium leading-[1.2] text-foreground"
                                        >
                                            {collaboratorLoadingMore ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                                            Load more members
                                        </Button>
                                    </div>
                                ) : null}
                            </div>
                        </SettingsCard>
                        </div>
                    </section>
                )}
                {sections.some((s) => s.id === "roles-applications") && (
                    <section id="project-settings-roles-applications" data-project-settings-section className="space-y-6">
                        <div className="space-y-6">
                            <SettingsCard
                                title="Project roles"
                                headingLevel={2}
                                description="Add open roles, how many people each needs, and the skills you’re looking for."
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
                                                    disabled={!rolesDirty || savingRoles}
                                                    className="nb-touch-target h-[34px] rounded-[5px] border-border px-3.5 text-[13px] font-medium leading-[1.2] text-foreground hover:bg-muted"
                                                >
                                                    Cancel
                                                </Button>
                                                <Button
                                                    type="button"
                                                    size="sm"
                                                    onClick={handleSaveRoles}
                                                    disabled={!rolesDirty || savingRoles}
                                                    className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2]"
                                                >
                                                    {savingRoles ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : null}
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
                                    disabled={savingRoles || !isProjectOwner}
                                    onAddRole={handleAddSettingsRole}
                                    onRemoveRole={handleRemoveSettingsRole}
                                    applicationCounts={roleApplicationCounts}
                                    members={collaboratorMembers}
                                />
                            </SettingsCard>
                        </div>
                    </section>
                )}
                {sections.some((s) => s.id === "readme") && (
                    <section id="project-settings-readme" data-project-settings-section className="space-y-6">
                        <div className="space-y-6">
                            <SettingsCard
                                title="Document publishing"
                                headingLevel={2}
                                loadState={{ loading: readmeSettingsLoading, hasData: readmeLoaded, error: settingsErrors.readme ?? null, retry: () => void loadReadmeSettings(true) }}
                                description="Control whether documentation can load images from external websites."
                            >
                                <div className="space-y-6">
                                    {/* Content Delivery & Notification Rules */}
                                    <div className="space-y-3">


                                        <div className="grid gap-3">
                                            {([
                                                ["externalImages", "External images", "Allow embedding externally hosted images in documentation. Keep this disabled for private or sensitive projects to prevent tracking pixels and referrer leaks."],
                                            ] as const).map(([key, title, description]) => (
                                                <div
                                                    key={key}
                                                    className="flex min-h-16 items-start justify-between gap-4 py-3 sm:items-center"
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
                                                            disabled={readmeSettingsLoading || Boolean(savingReadmeKey) || Boolean(settingsErrors.readme)}
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
                {sections.some((s) => s.id === "updates") && (
                    <section id="project-settings-updates" data-project-settings-section className="space-y-6">
                        <div className="space-y-6">
                            {/* Org chat rules sit with Updates (report §25.4: Settings → Updates & messages). */}
                            {organization ? <OrgChatSection orgId={projectId} organization={organization} /> : null}
                            <SettingsCard
                                title="Project updates"
                                headingLevel={2}
                                description="Configure member publishing permissions and broadcast settings for project progress updates."
                            >
                                <div className="space-y-6">
                                    {/* Section 1: Publishing Permissions */}
                                    <div className="space-y-3">


                                        <div className="flex min-h-16 items-start justify-between gap-4 py-3 sm:items-center">
                                            <div className="min-w-0 flex-1">
                                                <div className="flex items-center gap-2">
                                                    <p className="nb-ui-label text-sm font-semibold text-foreground">
                                                        Allow members to post updates
                                                    </p>

                                                </div>
                                                <p className="nb-compact mt-1 text-xs text-muted-foreground leading-relaxed">
                                                    On: every member can post updates. Off: only the owner and admins can.
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
                {sections.some((s) => s.id === "tasks-workflow") && (
                    <section id="project-settings-tasks-workflow" data-project-settings-section className="space-y-8">
                        <SettingsPageHeader level={2} title="Lifecycle & Workflow" description="Manage task completion and your project’s lifecycle stages." />
                        <TaskCompletionSettings projectId={projectId} />
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
                                            toast.success("Lifecycle updated");
                                            onProjectUpdated();
                                        } else {
                                            toast.error(feedbackError(result.error || "Couldn’t update lifecycle", "Couldn’t update lifecycle"));
                                        }
                                    } catch (error) {
                                        console.error("Failed to update lifecycle", error);
                                        toast.error("Couldn’t update lifecycle");
                                    } finally {
                                        setSavingLifecycle(false);
                                    }
                                }}
                            />
                        </div>
                    </section>
                )}
                {sections.some((s) => s.id === "files-workspace") && (
                    <section id="project-settings-files-workspace" data-project-settings-section className="space-y-6">
                        <SettingsCard
                            title="Files"
                                headingLevel={2}
                                loadState={{ allowInteractionWhileLoading: true, loading: fileAccessLoading, hasData: Boolean(fileAccessData), error: settingsErrors.files ?? null, retry: () => void loadFileAccessSettings() }}
                            description="Control file intake clearly: leaders can always upload, members can be toggled on or off, and viewers stay read-focused."
                            footer={
                                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 w-full">
                                    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                                        <span className="nb-meta inline-flex items-center gap-1.5">
                                            <span className="size-1.5 rounded-[1px] bg-primary" />
                                            {fileAccessData?.summary.alwaysAllowedCount ?? 0} leaders always allowed
                                        </span>
                                        <span>·</span>
                                        <span className="nb-meta">{fileAccessData?.summary.enabledMemberCount ?? 0} members enabled</span>
                                        <span>·</span>
                                        <span className="nb-meta">{fileAccessData?.summary.disabledMemberCount ?? 0} disabled</span>
                                    </div>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        size="sm"
                                        disabled={fileAccessLoading || fileAccessLoadingMore || fileAccessBulkSaving || Boolean(fileAccessSavingMemberId)}
                                        onClick={() => void loadFileAccessSettings()}
                                        className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium gap-2 self-start sm:self-auto border-border hover:bg-muted/50"
                                    >
                                        <RefreshCw className={cn("size-3.5", fileAccessLoading && "animate-spin")} />
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
                                    disabled={savingMemberFileUploadDefault || fileAccessBulkSaving || !isProjectOwner}
                                    aria-label="New members can upload files"
                                    onCheckedChange={(checked) => void handleToggleMemberFileUploadDefault(checked)}
                                />
                            </div>
                            <FileAccessMembers
                                query={fileAccessQuery}
                                permissionFilter={fileAccessFilter}
                                onQueryChange={setFileAccessQuery}
                                onFilterChange={setFileAccessFilter}
                                onLoadMore={() => void loadFileAccessSettings("more")}
                                loadingMore={fileAccessLoadingMore}
                                data={fileAccessData}
                                isLoading={fileAccessLoading}
                                savingMemberId={fileAccessSavingMemberId}
                                bulkSaving={fileAccessBulkSaving || Boolean(fileAccessSavingMemberId) || savingMemberFileUploadDefault}
                                onToggle={handleToggleMemberFileUpload}
                                onBulkToggle={handleBulkFileUploadPermission}
                                filePolicy={FILE_POLICY}
                            />
                        </SettingsCard>
                    </section>
                )}
                {sections.some((s) => s.id === "notifications") && (
                    <section id="project-settings-notifications" data-project-settings-section className="space-y-6">
                        <div className="space-y-6">
                            <SettingsCard
                                title="Project notification policy"
                                headingLevel={2}
                                loadState={{ loading: projectNotificationLoading, hasData: Boolean(projectNotificationData), error: settingsErrors.notifications ?? null, retry: () => void loadProjectNotificationSettings(true) }}
                                description="Configure workflow event triggers and delivery rules for your project. Critical responsibility and safety events stay locked on."
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
                                                disabled={!projectNotificationData || Boolean(settingsErrors.notifications) || !notificationDirty || savingNotifications}
                                                onClick={handleCancelNotifications}
                                                className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2] border-border hover:bg-muted/50"
                                            >
                                                Cancel
                                            </Button>
                                            <Button
                                                type="button"
                                                size="sm"
                                                disabled={!projectNotificationData || Boolean(settingsErrors.notifications) || !notificationDirty || savingNotifications}
                                                onClick={() => void handleSaveNotifications()}
                                                className="nb-touch-target h-[34px] rounded-[5px] px-3.5 text-[13px] font-medium leading-[1.2] gap-1.5"
                                            >
                                                {savingNotifications ? <Loader2 className="size-3.5 animate-spin" /> : null}
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
                                                <h3 className="nb-ui-label text-foreground">
                                                    Workflow event triggers
                                                </h3>
                                            </div>
                                            <p className="nb-compact mt-0.5 text-xs text-muted-foreground leading-relaxed">
                                                {notificationSummary.visibleCount} triggers organized across {notificationGroups.length} workflow categories. Click any category trigger to expand and customize event delivery.
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

                                    {/* Categories retain their controls during a background refresh. */}
                                    <div className="space-y-3">
                                        {notificationGroups.map((group) => (
                                            <ProjectNotificationCategoryCard
                                                key={group.id}
                                                group={group}
                                                policy={projectNotificationDraft}
                                                isExpanded={Boolean(expandedNotificationGroups[group.id])}
                                                onToggleExpand={() => toggleNotificationGroup(group.id)}
                                                onToggleRule={handleProjectNotificationToggle}
                                                disabled={savingNotifications}
                                            />
                                        ))}
                                    </div>
                                </div>
                            </SettingsCard>
                            {organization ? <OrgNotificationsSection orgId={projectId} organization={organization} /> : null}
                        </div>
                    </section>
                )}
                {sections.some((s) => s.id === "privacy-policies" || s.id === "privacy-terms") && (
                    <section id="project-settings-privacy-policies" data-project-settings-section className="space-y-6">
                        <SettingsPageHeader level={2} title="Privacy and Policies" description="These agreements and data rights apply to your signed-in account, not everyone on this project." />
                        <LegalAndDataRightsSection />
                    </section>
                )}
                {sections.some((s) => s.id === "danger") && (
                    <section id="project-settings-danger" data-project-settings-section className="space-y-6">
                        {organization ? <OrgDangerZone orgId={projectId} organization={organization} handle={project?.slug ?? null} /> : <SettingsCard
                            title="Workspace management"
                                headingLevel={2}
                                loadState={{ loading: dangerPreflightLoading, hasData: Boolean(dangerPreflight), error: settingsErrors.danger ?? null, retry: () => void loadDangerPreflight(true) }}
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
                                            disabled={Boolean(settingsErrors.danger) || confirmLoading || dangerPreflightLoading || !dangerPreflight || !preflightPolicy.canArchive}
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
                                            Only the owner can transfer ownership.
                                        </p>
                                    ) : rolePolicy.transferCandidates.length === 0 ? (
                                        <p className="nb-compact text-xs text-amber-700 dark:text-amber-400">
                                            Add at least one team member to this project before ownership can be transferred.
                                        </p>
                                    ) : null}
                                </div>
                            </div>

                            {/* Operation 3: Delete Project */}
                            <div className="border-b border-border py-6 last:border-b-0">
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
                                                Only the owner can delete this workspace.
                                            </p>
                                        ) : null}
                                    </div>
                                    <div className="shrink-0 pt-1 sm:pt-0">
                                        <Button
                                            variant="destructive"
                                            onClick={prepareDelete}
                                            disabled={Boolean(settingsErrors.danger) || confirmLoading || dangerPreflightLoading || !dangerPreflight || !isProjectOwner || !preflightPolicy.canDelete}
                                            className="nb-touch-target h-[34px] gap-2 rounded-[5px] px-3.5 text-[13px] font-medium"
                                        >
                                            <Trash2 className="h-4 w-4" />
                                            Delete project
                                        </Button>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </SettingsCard>}
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

            {/* Workspace management Specific High-Stakes Confirmation Modals */}
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
        </OpenSettingsSections>
    );
}
