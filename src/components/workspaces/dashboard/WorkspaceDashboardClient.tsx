'use client';

import { Suspense, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast, feedbackError } from "@/lib/feedback";
import { Loader2, Lock } from 'lucide-react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import ProjectLayout from '@/components/workspaces/dashboard/WorkspaceLayout';
import { PlainContentHeadings } from '@/components/workspaces/PlainContentHeadings';
import { TabErrorBoundary } from '@/components/workspaces/TabErrorBoundary';
import type { Project } from '@/types/discover';
import { toggleProjectFollowAction, updateProjectStageAction, incrementProjectViewAction } from '@/app/actions/workspace';
import { ROUTES } from '@/constants/routes';
import { getApplicationStatusAction, withdrawApplicationAction, type ApplicationStatusResult } from '@/app/actions/applications';
import type { ApplicationStatusLoad } from '@/lib/applications/card-state';
import { useRoleApplicationCounts } from '@/hooks/useRoleApplicationCounts';
import { userTopic } from '@/lib/messaging/constants';
import { subscribeBroadcast } from '@/lib/realtime/private-broadcast';
import { resolveProjectInvitationAction } from '@/app/actions/workspace/guidance';
import { useProjectMembers } from '@/hooks/workspaces/useWorkspaceMembers';
import { queryKeys } from '@/lib/query-keys';
import { logger } from '@/lib/logger';
import { subscribeProjectStage } from '@/lib/realtime/subscriptions';
import type { SprintDetailPayload } from '@/lib/workspaces/sprint-detail';
import type { TaskPanelTab } from '@/hooks/useTaskPanelResource';
import { normalizeProjectDocSlug } from '@/lib/workspaces/doc-slug';
import { canProjectMemberUploadFiles, isProjectTabVisibleToViewer, normalizeProjectMemberRole, normalizeProjectPublicTabVisibility, PROJECT_MEMBER_ROLE_LABELS, resolveAllowedProjectTab, type ProjectMemberRole } from '@/lib/workspaces/settings-policies';
import {
    useUIStore,
    MY_WORK_TASK_HANDOFF_STORAGE_KEY,
    readMyWorkTaskHandoff,
    type MyWorkTaskHandoff,
} from '@/stores/ui-store';

import { DashboardTab, DocTab, UpdatesTab, TasksTab, FilesTab, SprintPlanning, ProjectSettingsTab } from '@/components/workspaces/dashboard/WorkspaceTabsRegistry';
import { SkeletonSprints } from '@/components/workspaces/skeletons/SkeletonSprints';
import { OrgAboutTab } from '@/components/organizations/OrgAboutTab';
import { AssignmentsPanel, GroupCopiesPanel } from '@/components/organizations/AssignmentsPanel';
import { OrgFilesPanel, OrgSprintMaterials } from '@/components/organizations/OrgFilesPanel';
import { OrgMembersTab } from '@/components/organizations/OrgMembersTab';
import { ChildOrgLine, ChildUnitsLine, OrgDashboard, OrgProjectsTab } from '@/components/organizations/OrgOverviewParts';
import { OrgInviteBanner } from '@/components/organizations/OrgInviteBanner';
import { ChildOrgChips, OrgBreadcrumb, OrgCompactMark, OrgHeaderMenu, OrgIdentityLine, OrgInviteDialog, OrgNewItems, OrgNewMenu, OrgStatusBanner, OrgVisitorActions, type OrgNewKind } from '@/components/organizations/OrgHeaderParts';
import { readOrgTabBadgesAction, type OrgTabBadges } from '@/app/actions/assignments';
import { isProjectPubliclyReadableVisibility } from '@/lib/workspaces/workspace-visibility';
import { confirmFileNavigation } from '@/lib/files/unsaved-navigation';
import { useFilesStore } from '@/stores/filesStore';

const EditProjectModal = dynamic(() => import('@/components/workspaces/EditWorkspaceModal'), { ssr: false, loading: () => null });

const WithdrawApplicationDialog = dynamic(() => import('@/components/workspaces/dashboard/WithdrawApplicationDialog'), { ssr: false, loading: () => null });
const InviteCollaboratorModal = dynamic(() => import('@/components/workspaces/dashboard/InviteCollaboratorModal'), { ssr: false, loading: () => null });

const ApplyRoleModal = dynamic(() => import('@/components/workspaces/ApplyRoleModal'), { ssr: false, loading: () => null });

const ProjectOnboardingModal = dynamic(() => import('@/components/workspaces/WorkspaceOnboardingModal').then((mod) => mod.ProjectOnboardingModal), { ssr: false, loading: () => null });

function normalizeProjectDetailTabParam(value: string | null | undefined) {
    const tab = value?.trim();
    if (!tab) return 'dashboard';
    if (tab === 'analytics') return 'dashboard';
    return tab === 'docs' ? 'readme' : tab;
}

function projectDetailTabQueryParam(tabId: string) {
    return tabId === 'readme' ? 'docs' : tabId;
}

/** Sign-in that returns the visitor to this exact page (tab and deep-link params included). */
function signInHref(applyRoleId?: string) {
    if (typeof window === 'undefined') return `${ROUTES.LOGIN}?redirect=${encodeURIComponent('/')}`;
    const target = new URL(window.location.href);
    // Signing in from a role's Apply button brings the visitor back to that role's form.
    if (applyRoleId) target.searchParams.set('applyRole', applyRoleId);
    return `${ROUTES.LOGIN}?redirect=${encodeURIComponent(`${target.pathname}${target.search}`)}`;
}

function deleteParam(params: URLSearchParams, key: string) {
    if (!params.has(key)) return false;
    params.delete(key);
    return true;
}

function clearProjectDetailScopedParams(params: URLSearchParams, activeTab: string, resetActiveTab = false) {
    let changed = false;

    if (resetActiveTab || activeTab !== 'tasks') {
        for (const key of ['drawerType', 'drawerId', 'panelTab']) {
            changed = deleteParam(params, key) || changed;
        }
    }

    if (resetActiveTab || activeTab !== 'files') {
        for (const key of ['fileId', 'path', 'line', 'column', 'filesView', 'filesTask']) {
            changed = deleteParam(params, key) || changed;
        }
    }

    if (resetActiveTab || activeTab !== 'updates') {
        for (const key of ['updateId', 'commentId']) {
            changed = deleteParam(params, key) || changed;
        }
    }

    if (resetActiveTab || activeTab !== 'readme') {
        changed = deleteParam(params, 'doc') || changed;
        changed = deleteParam(params, 'readmeMode') || changed;
    }

    if (resetActiveTab || activeTab !== 'settings') {
        for (const key of ['settings', 'section']) {
            changed = deleteParam(params, key) || changed;
        }
    }

    if (resetActiveTab || activeTab !== 'sprints') {
        for (const key of ['sprint', 'sprintId', 'task']) {
            changed = deleteParam(params, key) || changed;
        }
    }

    // Sprints deep-links and legacy task links (`taskId`) are read on Sprints and Tasks only.
    if (resetActiveTab || (activeTab !== 'sprints' && activeTab !== 'tasks')) {
        changed = deleteParam(params, 'taskId') || changed;
    }

    for (const key of ['analyticsTab', 'memberId', 'analyticsMember', 'analyticsSource', 'analyticsWindow']) {
        changed = deleteParam(params, key) || changed;
    }

    return changed;
}

interface ExtendedProjectDetail extends Omit<Project, 'publicTabVisibility'> {
    publicTabVisibility?: Project['publicTabVisibility'] | string;
    public_tab_visibility?: string;
    hasPublishedReadme?: boolean;
    isFollowed?: boolean;
    followersCount?: number;
    viewCount?: number;
    currentStageIndex?: number;
    stageCompletionDates?: Record<string, string>;
    membersHasMore?: boolean;
    membersNextCursor?: string | null;
    guidance?: unknown;
}

interface ProjectDashboardClientProps {
    project: ExtendedProjectDetail;
    currentUserId: string | null;
    viewerDisplayName?: string | null;
    viewerAvatarUrl?: string | null;
    isOwner: boolean;
    isMember: boolean;
    /** The viewer's role from the server capabilities, never derived from a members page. */
    memberRole?: string | null;
    initialSprintData?: Promise<SprintDetailPayload | null> | null;
}

const ResourceShareDialog = dynamic(() => import('@/components/sharing/ShareDialog').then(mod => mod.ShareDialog), { ssr: false });
export default function ProjectDashboardClient({ project, currentUserId, viewerDisplayName = null, viewerAvatarUrl = null, isOwner, isMember, memberRole = null, initialSprintData = null }: ProjectDashboardClientProps) {
    const router = useRouter();
    const pathname = usePathname();
    const queryClient = useQueryClient();
    const searchParams = useSearchParams();
    const myWorkTaskHandoff = useUIStore((state) => state.myWorkTaskHandoff);
    const setMyWorkTaskHandoff = useUIStore((state) => state.setMyWorkTaskHandoff);
    const [sessionTaskHandoff, setSessionTaskHandoff] = useState<MyWorkTaskHandoff | null>(() => {
        if (typeof window === 'undefined') return null;
        const handoff = readMyWorkTaskHandoff(window.sessionStorage.getItem(MY_WORK_TASK_HANDOFF_STORAGE_KEY));
        return handoff?.projectId === project.id ? handoff : null;
    });
    useEffect(() => {
        if (myWorkTaskHandoff || typeof window === 'undefined') return;
        try {
            const stored = readMyWorkTaskHandoff(
                window.sessionStorage.getItem(MY_WORK_TASK_HANDOFF_STORAGE_KEY),
            );
            if (stored?.projectId === project.id) setSessionTaskHandoff(stored);
            else window.sessionStorage.removeItem(MY_WORK_TASK_HANDOFF_STORAGE_KEY);
        } catch {
            try {
                window.sessionStorage.removeItem(MY_WORK_TASK_HANDOFF_STORAGE_KEY);
            } catch {
                // Storage is unavailable; no persisted handoff can be used.
            }
        }
    }, [project.id, myWorkTaskHandoff]);
    const pendingMyWorkTaskHandoff = myWorkTaskHandoff ?? sessionTaskHandoff;
    const myWorkInitialTaskId =
        pendingMyWorkTaskHandoff?.projectId === project.id
            ? pendingMyWorkTaskHandoff.taskId
            : null;
    const applyRoleIdFromUrl = searchParams?.get('applyRole') || null;

    // Keep the handoff alive until TasksTab has actually opened the panel.
    // Clearing it on dashboard mount races the lazy task-tab mount.
    const consumeMyWorkTaskHandoff = useCallback(() => {
        if (pendingMyWorkTaskHandoff?.projectId === project.id) {
            setMyWorkTaskHandoff(null);
            setSessionTaskHandoff(null);
            try {
                window.sessionStorage.removeItem(MY_WORK_TASK_HANDOFF_STORAGE_KEY);
            } catch {
                // The in-memory handoff is already consumed.
            }
        }
    }, [pendingMyWorkTaskHandoff, project.id, setMyWorkTaskHandoff]);
    // The detail shell already resolves viewer-safe guidance in parallel with
    // the rest of the project header. Avoid a second client POST on every open.
    const guidance = (project as { guidance?: unknown }).guidance ?? null;

    const invalidateProjectDetailSlices = useCallback(
        (options?: { shell?: boolean; shellRefresh?: boolean; tasks?: boolean; sprints?: boolean; members?: boolean; files?: boolean }) => {
            const o = options ?? {};
            if (o.shell) {
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.project.detail.recentActivity(project.id),
                });
                if (project.slug) {
                    void queryClient.invalidateQueries({
                        queryKey: queryKeys.project.bySlug(project.slug),
                    });
                }
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.project.byId(project.id),
                });
                if (o.shellRefresh) {
                    router.refresh();
                }
            }
            if (o.tasks) {
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.project.detail.tasksRoot(project.id),
                });
            }
            if (o.sprints) {
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.project.detail.sprints(project.id),
                });
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.project.detail.sprintTasksRoot(project.id),
                });
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.project.detail.sprintDetailRoot(project.id),
                });
            }
            if (o.members) {
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.project.detail.members(project.id),
                });
            }
            if (o.files) {
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.project.detail.filesNodes(project.id, null),
                });
            }
        },
        [project.id, project.slug, queryClient, router],
    );

    // Active tab from URL or default
    // Organizations live at /org/<handle> (report §24); their header, tabs and settings differ (report §18, §21).
    const organization = project.organization ?? null;
    const isOrganization = Boolean(organization);
    const canonicalProjectHref = useMemo(() => `${isOrganization ? '/org' : '/workspaces'}/${project.slug || project.id}`, [isOrganization, project.id, project.slug]);
    const publicTabVisibility = useMemo(() => normalizeProjectPublicTabVisibility(project.publicTabVisibility ?? project.public_tab_visibility), [project]);
    const isOwnerOrMember = isOwner || isMember;
    // Org admins read every tab of their org's child projects and manage its org link (report §29.4);
    // the project's own admin tools stay with its team.
    const parentOrg = project.parentOrg ?? null;
    const isInheritedAdmin = Boolean(parentOrg?.viewerIsInheritedAdmin) && !isOwnerOrMember;
    const canSeeAllTabs = isOwnerOrMember || isInheritedAdmin;
    const resolvedActiveTab = resolveAllowedProjectTab({
        requestedTab: normalizeProjectDetailTabParam(searchParams?.get('tab')),
        isOwnerOrMember: canSeeAllTabs,
        canManageSettings: isOwner,
        publicTabVisibility,
        isOrganization,
    });

    const [activeTab, setActiveTab] = useState(() => resolvedActiveTab);

    const refreshProjectData = useCallback(
        (scopeTab?: string) => {
            const targetTab = scopeTab || activeTab;
            invalidateProjectDetailSlices({
                shell: true,
                shellRefresh: true,
                tasks: targetTab === 'tasks' || targetTab === 'dashboard',
                sprints: targetTab === 'sprints',
                members: true,
                files: targetTab === 'files',
            });
        },
        [activeTab, invalidateProjectDetailSlices],
    );


    // State management
    const [isFollowing, setIsFollowing] = useState(project.isFollowed || false);
    const [followLoading, setFollowLoading] = useState(false);
    const [followersCount, setFollowersCount] = useState(project.followersCount || 0);
    const [viewCount, setViewCount] = useState(project.viewCount || 0);
    const [isEditModalOpen, setIsEditModalOpen] = useState(false);
    const [isApplyModalOpen, setIsApplyModalOpen] = useState(false);
    const [isInviteModalOpen, setIsInviteModalOpen] = useState(false);
    const [isOrgInviteOpen, setIsOrgInviteOpen] = useState(false);
    // + New ▾ (report §18.2): the target tab opens its composer or modal once, then clears this.
    const [newIntent, setNewIntent] = useState<Exclude<OrgNewKind, 'project'> | null>(null);
    const [orgBadges, setOrgBadges] = useState<OrgTabBadges | null>(null);
    const [preselectedRoleId, setPreselectedRoleId] = useState<string | undefined>(undefined);
    const [isOnboardingOpen, setIsOnboardingOpen] = useState(false);
    const [isStageUpdating, setIsStageUpdating] = useState(false);
    const [, setStageVersion] = useState<string | null>(project.updatedAt || null);
    const stageVersionRef = useRef<string | null>(project.updatedAt || null);
    const isStageUpdatingRef = useRef(false);
    const isMountedRef = useRef(true);
    const followRequestRef = useRef(0);
    const followInFlightRef = useRef(false);
    const [shareOpen, setShareOpen] = useState(false);
    const shareTrigger = useRef<HTMLElement | null>(null);
    useEffect(() => { setShareOpen(false); }, [project.id]);
    const stageRequestRef = useRef(0);
    const roleApplyRequestRef = useRef<string | null>(null);

    const setStageVersionSafe = useCallback((nextVersion: string | null) => {
        stageVersionRef.current = nextVersion;
        setStageVersion(nextVersion);
    }, []);

    const setIsStageUpdatingSafe = useCallback((next: boolean) => {
        isStageUpdatingRef.current = next;
        setIsStageUpdating(next);
    }, []);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
        };
    }, []);

    const handleProjectSettingsUpdated = useCallback(
        (_updates?: { coverImage?: string | null }) => {
            refreshProjectData();
        },
        [refreshProjectData],
    );

    // Initial Onboarding Check (Workspace Bridge)
    useEffect(() => {
        const source = searchParams?.get('source');
        if (source === 'application_accepted' && (isMember || isOwner)) {
            setIsOnboardingOpen(true);
            // The welcome names the role they were accepted for (a member's status is not read otherwise).
            void getApplicationStatusAction(project.id).then(setApplicationStatus);
            // Clean URL
            const url = new URL(window.location.href);
            url.searchParams.delete('source');
            window.history.replaceState({}, '', url);
        }
    }, [searchParams, isMember, isOwner, project.id]);

    // Application status for non-owner/non-member users
    const [applicationStatus, setApplicationStatus] = useState<ApplicationStatusResult>({ status: 'none' });
    const [applicationLoad, setApplicationLoad] = useState<ApplicationStatusLoad>('loading');
    const [invitationLoading, setInvitationLoading] = useState(false);
    const [isEditApplicationOpen, setIsEditApplicationOpen] = useState(false);
    const [isWithdrawOpen, setIsWithdrawOpen] = useState(false);

    /** Reads where the viewer's application stands; a failed read is an error state, never "no application". */
    const lastStatusRef = useRef<ApplicationStatusResult['status']>('none');
    const refreshApplicationStatus = useCallback(async () => {
        const next = await getApplicationStatusAction(project.id).catch(() => ({ status: 'none', loadFailed: true }) as ApplicationStatusResult);
        const before = lastStatusRef.current;
        lastStatusRef.current = next.status;
        setApplicationStatus(next);
        setApplicationLoad(next.loadFailed ? 'error' : 'ready');
        // Discover and profile cards show your application too: they re-read it.
        void queryClient.invalidateQueries({ queryKey: queryKeys.discover.myApplications(currentUserId) });
        // Accepted while this page is open: the page becomes the team's (tabs, roles) and welcomes the new member.
        if (before === 'pending' && next.status === 'accepted' && !next.membershipEnded) {
            toast.success(`You joined ${project.title}`);
            setIsOnboardingOpen(true);
            router.refresh();
        }
    }, [currentUserId, project.id, project.title, queryClient, router]);

    const handleInvitation = useCallback(async (action: 'accept' | 'decline') => {
        if (invitationLoading) return;
        setInvitationLoading(true);
        try {
            if (!applicationStatus.invitationId) throw new Error('No active invitation ID found.');
            const res = await resolveProjectInvitationAction({
                invitationId: applicationStatus.invitationId,
                action,
            });

            if (res.success) {
                toast.success(action === 'accept' ? 'Invitation accepted' : 'Invitation declined');
                refreshProjectData();
                await refreshApplicationStatus();
            } else {
                toast.error(feedbackError(res.error || (action === 'accept' ? 'Couldn’t accept invitation' : 'Couldn’t decline invitation'), "Couldn’t decline invitation"));
            }
        } catch (error) {
            console.error(`Error ${action === 'accept' ? 'accepting' : 'declining'} invitation:`, error);
            toast.error(feedbackError(error instanceof Error ? error.message : action === 'accept' ? 'Couldn’t accept invitation' : 'Couldn’t decline invitation', "Couldn’t decline invitation"));
        } finally {
            setInvitationLoading(false);
        }
    }, [applicationStatus, invitationLoading, refreshApplicationStatus, refreshProjectData]);

    // Optimistic State for Project Journey
    const [optimisticStageIndex, setOptimisticStageIndex] = useState(project.currentStageIndex || 0);
    const [stageCompletionDates, setStageCompletionDates] = useState<Record<string, string>>(() => project.stageCompletionDates || {});

    // Sync state with server updates (e.g. revalidation or external changes)
    // This ensures we don't get stuck in a detached state if the server updates
    const serverStageIndex = project.currentStageIndex || 0;
    const serverProjectUpdatedAt = project.updatedAt || null;
    useEffect(() => {
        setOptimisticStageIndex(serverStageIndex);
        setStageCompletionDates(project.stageCompletionDates || {});
    }, [serverStageIndex, project.stageCompletionDates]);

    // Realtime subscription for project stage changes
    useEffect(() => {
        if (!project?.id) return;
        const supabase = createClient();
        const channel = subscribeProjectStage({
            supabase,
            projectId: project.id,
            subscriberId: 'dashboard',
            onUpdate: (payload: any) => {
                if (isStageUpdatingRef.current) return;

                const nextIndex = payload.new?.current_stage_index;
                if (nextIndex !== undefined && nextIndex !== null) {
                    setOptimisticStageIndex(Number(nextIndex));
                }
                const nextDates = payload.new?.stage_completion_dates;
                if (nextDates !== undefined && nextDates !== null) {
                    setStageCompletionDates(nextDates as Record<string, string>);
                }
                const nextVersion = payload.new?.updated_at;
                if (typeof nextVersion === 'string') {
                    setStageVersionSafe(nextVersion);
                }
                // Sync stats on the same unified channel without separate broadcast channel
                const nextViews = payload.new?.view_count;
                if (typeof nextViews === 'number') {
                    setViewCount((current: number) => Math.max(current, nextViews));
                }
                const nextFollowers = payload.new?.followers_count;
                if (typeof nextFollowers === 'number') {
                    setFollowersCount(nextFollowers);
                }
            },
        });

        return () => {
            void supabase.removeChannel(channel);
        };
    }, [project?.id, setStageVersionSafe]);

    // Extended project data (may come from joined queries, cast to any for flexibility)
    const projectWithLiveStats = useMemo(
        () => ({
            ...(project as any),
            viewCount,
            followersCount,
            // The live stage, so Edit and Settings never start from a stage Advance already moved past.
            currentStageIndex: optimisticStageIndex,
            stageCompletionDates,
            guidance,
        }),
        [project, viewCount, followersCount, optimisticStageIndex, stageCompletionDates, guidance],
    );
    const extendedProject = projectWithLiveStats as any;

    const lastProjectIdRef = useRef<string | null>(null);
    useEffect(() => {
        if (!project?.id) return;
        if (lastProjectIdRef.current === project.id) return;
        lastProjectIdRef.current = project.id;
        setFollowersCount(project.followersCount || 0);
        setViewCount(project.viewCount || 0);
        setIsFollowing(project.isFollowed || false);
        setStageVersionSafe(serverProjectUpdatedAt);
    }, [project?.id, serverProjectUpdatedAt, setStageVersionSafe]);

    // OPTIMIZATION: Default to empty arrays as these are now fetched client-side or lazy loaded
    const tasks = useMemo(() => extendedProject?.tasks || [], [extendedProject]);
    const sprints = useMemo(() => extendedProject?.sprints || [], [extendedProject]);

    const collaboratorUsers = useMemo(() => {
        const list = (extendedProject?.collaborators || []) as any[];
        return list
            .map((c) =>
                c?.user
                    ? {
                          ...c.user,
                          membershipRole: c.membershipRole,
                          projectRoleTitle: c.projectRoleTitle ?? null,
                          joinedAt: c.joinedAt ?? null,
                      }
                    : null,
            )
            .filter(Boolean);
    }, [extendedProject]);

    const rolesWithFilled = useMemo(() => {
        const roles = extendedProject?.openRoles || [];
        return roles.map((role: any) => ({
            ...role,
            filled: role?.filled ?? 0,
        }));
    }, [extendedProject]);

    // Fetch application status for non-owners (lightweight O(1) query)
    useEffect(() => {
        if (!currentUserId || isOwner || isMember) return;
        void refreshApplicationStatus();
        // A decision made while this page is open shows up when the tab is looked at again.
        const onVisible = () => { if (document.visibilityState === 'visible') void refreshApplicationStatus(); };
        document.addEventListener('visibilitychange', onVisible);
        window.addEventListener('focus', onVisible);
        // A reviewer's decision arrives live, so the card changes while the page is open.
        const live = subscribeBroadcast(userTopic(currentUserId), (event, payload) => {
            if (event === 'application.changed' && payload.project_id === project.id) void refreshApplicationStatus();
        });
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            window.removeEventListener('focus', onVisible);
            live.unsubscribe();
        };
    }, [currentUserId, isOwner, isMember, project.id, refreshApplicationStatus]);

    // Hook Integration: Scalable Member Loading
    const shouldLoadMembers = activeTab === 'dashboard' || activeTab === 'tasks' || activeTab === 'updates' || activeTab === 'sprints' || activeTab === 'settings';

    const {
        data: membersData,
        isLoading: loadingMembers,
    } = useProjectMembers(project.id, collaboratorUsers || [], {
        enabled: shouldLoadMembers,
        initialHasMore: project.membersHasMore,
        initialCursor: project.membersNextCursor,
        pageSize: 20,
    });

    // Flatten members and include owner
    const allMembers = useMemo(() => {
        const collab = membersData?.pages.flatMap((p: any) => p.members) || collaboratorUsers || [];
        const owner = (extendedProject?.owner || project.owner) as { id: string } | undefined;

        const list = [...collab];
        if (owner && !list.find((m) => m.id === owner.id)) {
            list.unshift(owner);
        }
        return list;
    }, [membersData, collaboratorUsers, project, extendedProject]);
    const currentProjectRole: ProjectMemberRole | null = isOwner
        ? 'owner'
        : isMember ? normalizeProjectMemberRole(memberRole, 'member') : null;
    const canManageProjectSettings = isOwner || currentProjectRole === 'admin';
    const canEditTasks = isOwner || currentProjectRole === 'admin' || currentProjectRole === 'member';
    const canManageFiles = isOwner || currentProjectRole === 'admin';
    const currentFileMember = allMembers.find((item: any) => item?.id === currentUserId);
    // Org files: only owners and admins write the org tree; members add files to their own copies (report §23.4).
    const canUploadFiles = isOrganization ? canManageFiles : isOwner || canProjectMemberUploadFiles({ role: currentProjectRole, fileUploadEnabled: currentFileMember?.fileUploadEnabled });
    const canReadTaskFiles = isProjectTabVisibleToViewer({ tabId: 'tasks', isOwnerOrMember: canSeeAllTabs, publicTabVisibility });

    const currentUserName = useMemo(() => {
        if (!currentUserId) return undefined;
        const member = allMembers.find((item: any) => item?.id === currentUserId);
        return member?.displayName || member?.fullName || member?.name || viewerDisplayName || 'Anonymous';
    }, [allMembers, currentUserId, viewerDisplayName]);
    const currentUserAvatarUrl = useMemo(() => {
        if (!currentUserId) return undefined;
        const member = allMembers.find((item: any) => item?.id === currentUserId);
        return member?.avatarUrl || member?.profile?.avatarUrl || member?.user?.avatarUrl || viewerAvatarUrl || null;
    }, [allMembers, currentUserId, viewerAvatarUrl]);
    const canCreateUpdates = isOwner || currentProjectRole === 'admin' || (currentProjectRole === 'member' && Boolean(extendedProject?.memberUpdatesEnabled ?? (extendedProject as any)?.member_updates_enabled ?? true));
    const canManageUpdates = canManageProjectSettings;

    const lifecycleStageNames = useMemo(() => {
        return (Array.isArray(extendedProject?.lifecycleStages) && extendedProject.lifecycleStages.length > 0 ? extendedProject.lifecycleStages : Array.isArray((extendedProject as any)?.lifecycle_stages) && (extendedProject as any).lifecycle_stages.length > 0 ? (extendedProject as any).lifecycle_stages : []) as string[];
    }, [extendedProject]);

    const lifecycleStages = useMemo(() => {
        const stages = lifecycleStageNames;
        const currentIndex = optimisticStageIndex;
        return stages.map((stageName: string, idx: number) => ({
            name: stageName,
            status: idx < currentIndex ? 'completed' : idx === currentIndex ? 'current' : 'upcoming',
        }));
    }, [lifecycleStageNames, optimisticStageIndex]);

    // Tab change handler
    const handleTabChange = useCallback(
        (tabId: string) => {
            if (!confirmFileNavigation(project.id)) return;
            if (
                !isProjectTabVisibleToViewer({
                    tabId,
                    isOwnerOrMember: canSeeAllTabs,
                    canManageSettings: canManageProjectSettings,
                    publicTabVisibility,
                    isOrganization,
                })
            ) {
                toast.error('That workspace tab is not visible for your current access');
                return;
            }
            const routeRoot = document.querySelector<HTMLElement>('[data-scroll-root="route"]');
            routeRoot?.scrollTo({ top: 0, left: routeRoot.scrollLeft, behavior: 'auto' });
            if (tabId === activeTab) {
                // If they click the current tab, clear any tab-specific parameters to reset tab view/drawer
                const nextParams = new URLSearchParams(window.location.search);
                const changed = clearProjectDetailScopedParams(nextParams, tabId, true);
                if (changed) {
                    const nextQuery = nextParams.toString();
                    const safePath = pathname ?? window.location.pathname;
                    const nextUrl = nextQuery ? `${safePath}?${nextQuery}` : safePath;
                    router.replace(nextUrl, { scroll: false });
                }
                return;
            }
            setActiveTab(tabId);

            const nextParams = new URLSearchParams(window.location.search);
            if (tabId === 'readme') {
                nextParams.set('tab', 'docs');
                if (!nextParams.has('doc')) {
                    nextParams.set('doc', 'readme');
                }
            } else {
                nextParams.set('tab', tabId);
            }

            // Clean up other tab-specific query parameters when switching tabs
            clearProjectDetailScopedParams(nextParams, tabId);

            const nextQuery = nextParams.toString();
            const safePath = pathname ?? window.location.pathname;
            const nextUrl = nextQuery ? `${safePath}?${nextQuery}` : safePath;
            // A user's tab click is a history entry; canonicalising below stays a replace.
            router.push(nextUrl, { scroll: false });
        },
        [activeTab, canManageProjectSettings, isOwnerOrMember, pathname, publicTabVisibility, router],
    );

    // Keep the URL canonical from the URL state itself. This avoids the tab
    // rollback that happens when optimistic local tab state cleans a stale URL.
    useEffect(() => {
        if (typeof window === "undefined") return;

        const nextParams = new URLSearchParams(searchParams?.toString() ?? window.location.search);
        const requestedTab = normalizeProjectDetailTabParam(nextParams.get('tab'));
        const normalizedRequestedTab = requestedTab;
        const allowedTab = resolveAllowedProjectTab({
            requestedTab: normalizedRequestedTab,
            isOwnerOrMember: canSeeAllTabs,
            canManageSettings: canManageProjectSettings,
            publicTabVisibility,
            isOrganization,
        });
        if (allowedTab === null) {
            return;
        }
        let changed = false;

        // The landing tab (About for org visitors, Dashboard otherwise) needs no ?tab=.
        if (allowedTab === (isOrganization && !canSeeAllTabs ? 'about' : 'dashboard')) {
            changed = deleteParam(nextParams, 'tab') || changed;
        } else {
            const encodedTab = projectDetailTabQueryParam(allowedTab);
            if (nextParams.get('tab') !== encodedTab) {
                nextParams.set('tab', encodedTab);
                changed = true;
            }
        }

        if (allowedTab === 'readme') {
            const currentDocSlug = nextParams.get('doc');
            const normalizedDocSlug = normalizeProjectDocSlug(currentDocSlug || 'readme');
            if (currentDocSlug !== normalizedDocSlug) {
                nextParams.set('doc', normalizedDocSlug);
                changed = true;
            }
        }

        changed = clearProjectDetailScopedParams(nextParams, allowedTab) || changed;

        if (!changed) return;
        const nextQuery = nextParams.toString();
        const safePath = pathname ?? window.location.pathname;
        const nextUrl = nextQuery ? `${safePath}?${nextQuery}` : safePath;
        router.replace(nextUrl, { scroll: false });
    }, [
        canManageProjectSettings,
        isOwnerOrMember,
        pathname,
        project.id,
        project.slug,

        publicTabVisibility,
        router,
        searchParams
    ]);

    useEffect(() => {
        const searchTab = searchParams?.get('tab');
        const requestedTab = normalizeProjectDetailTabParam(searchTab);
        const normalizedRequestedTab = requestedTab;
        const nextTab = resolveAllowedProjectTab({
            requestedTab: normalizedRequestedTab,
            isOwnerOrMember: canSeeAllTabs,
            canManageSettings: canManageProjectSettings,
            publicTabVisibility,
            isOrganization,
        });
        setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
    }, [
        canManageProjectSettings,
        isOwnerOrMember,
        project.id,
        project.slug,

        publicTabVisibility,
        searchParams
    ]);

    const handleTabHover = useCallback(
        (tabId: string) => {
            // Warm only the surface the user is expressing intent to open.
            // Data prefetch stays scoped below so hovering one tab never fans
            // out requests for the rest of the project workspace.
            switch (tabId) {
                case 'readme':
                    void import('@/components/workspaces/tabs/DocTab');
                    break;
                case 'updates':
                    void import('@/components/workspaces/tabs/UpdatesTab');
                    break;
                case 'sprints':
                    void import('@/components/workspaces/tabs/SprintPlanning');
                    break;
                case 'tasks':
                    void import('@/components/workspaces/v2/TasksTab');
                    break;
                case 'settings':
                    void import('@/components/workspaces/tabs/WorkspaceSettingsTab');
                    break;
                case 'files':
                    void import('@/components/workspaces/v2/files-tab/FilesTabRoot');
                    break;
                default:
                    break;
            }
        },
        [],
    );



    // Actions
    const handleEdit = useCallback(() => {
        setIsEditModalOpen(true);
    }, []);

    const handleShare = useCallback((trigger?: HTMLElement) => { shareTrigger.current = trigger ?? null; setShareOpen(true); }, []);

    const handleFollow = useCallback(async () => {
        if (followLoading || followInFlightRef.current) return;
        if (!currentUserId) {
            router.push(signInHref());
            return;
        }
        // Optimistic update
        const requestId = ++followRequestRef.current;
        const baselineFollowersCount = followersCount;
        const newIsFollowing = !isFollowing;
        setIsFollowing(newIsFollowing);
        setFollowersCount((c: number) => (newIsFollowing ? c + 1 : Math.max(0, c - 1)));

        try {
            setFollowLoading(true);
            followInFlightRef.current = true;
            const result = await toggleProjectFollowAction(project.id, newIsFollowing);
            if (!isMountedRef.current || requestId !== followRequestRef.current) return;
            if (!result.success) throw new Error(result.error);
            if (result.followersCount !== undefined) {
                const serverCount = Math.max(0, result.followersCount);
                const reconciledCount = newIsFollowing ? Math.max(serverCount, baselineFollowersCount + 1) : Math.min(serverCount, Math.max(0, baselineFollowersCount - 1));
                setFollowersCount(reconciledCount);

                // Invalidate the Hub project feed query cache
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.discover.projectsSimpleRoot(),
                });
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.globalSearch.discoverRoot(),
                });
                // Discover's follow bells read this: back on Discover they match what you just did.
                void queryClient.invalidateQueries({
                    queryKey: queryKeys.discover.userFollowedProjects(currentUserId),
                });
            }
            toast.success(newIsFollowing ? 'Following workspace' : 'Unfollowed workspace');
            logger.metric('project.detail.follow.result', {
                projectId: project.id,
                userId: currentUserId,
                success: true,
                isFollowing: newIsFollowing,
            });
        } catch (error) {
            if (!isMountedRef.current || requestId !== followRequestRef.current) return;
            // Revert
            setIsFollowing(!newIsFollowing);
            setFollowersCount(Math.max(0, baselineFollowersCount));
            const message = error instanceof Error ? error.message : 'Couldn’t update follow status';
            toast.error(feedbackError(message, "Action couldn’t finish"));
            logger.metric('project.detail.follow.result', {
                projectId: project.id,
                userId: currentUserId,
                success: false,
                isFollowing: newIsFollowing,
                message,
            });
        } finally {
            if (!isMountedRef.current || requestId !== followRequestRef.current) return;
            followInFlightRef.current = false;
            setFollowLoading(false);
        }
    }, [currentUserId, followLoading, followersCount, isFollowing, project.id]);

    useEffect(() => {
        if (!project?.id) return;
        let cancelled = false;
        const sessionKey = `project:view:${project.id}`;
        try {
            if (window.sessionStorage.getItem(sessionKey)) return;
        } catch {
            // Storage can be unavailable in privacy-restricted browser modes.
        }

        const incrementView = () => {
            if (cancelled || document.visibilityState !== 'visible') return;
            incrementProjectViewAction(project.id).then((result) => {
                if (cancelled) return;
                if (!isMountedRef.current) return;
                const nextViewCount = result.viewCount;
                if (result.success) {
                    try {
                        window.sessionStorage.setItem(sessionKey, '1');
                    } catch {
                        // Counting remains best-effort when storage is unavailable.
                    }
                }
                if (result.success && typeof nextViewCount === 'number') {
                    setViewCount((current: number) => Math.max(current, nextViewCount));

                    logger.metric('project.detail.view.increment', {
                        projectId: project.id,
                        success: true,
                        viewCount: nextViewCount,
                    });
                } else {
                    logger.metric('project.detail.view.increment', {
                        projectId: project.id,
                        success: false,
                        message: result.error || 'increment failed',
                    });
                }
            });
        };
        let idleId: number | null = null;
        let timeoutId: number | null = null;
        if (typeof window.requestIdleCallback === 'function') {
            idleId = window.requestIdleCallback(incrementView, { timeout: 10_000 });
        } else {
            timeoutId = window.setTimeout(incrementView, 5_000);
        }
        return () => {
            cancelled = true;
            if (idleId !== null && typeof window.cancelIdleCallback === 'function') {
                window.cancelIdleCallback(idleId);
            }
            if (timeoutId !== null) window.clearTimeout(timeoutId);
        };
    }, [project?.id]);

    // The visitor's own application, on the mobile header link (where "N open roles" is otherwise).
    const applicationHeaderLabel = applicationStatus.status === 'pending' ? 'Application pending'
        : applicationStatus.status === 'rejected' ? 'Application declined'
            : applicationStatus.status === 'withdrawn' ? 'Application withdrawn' : null;
    // Owners and admins see how many applications wait for them (the counts action answers only for reviewers).
    const roleApplicationCounts = useRoleApplicationCounts(project.id, canManageProjectSettings);
    const pendingApplicationsForReviewer = Object.values(roleApplicationCounts).reduce((sum, counts) => sum + counts.pending, 0);
    const projectClosed = ['archived', 'completed'].includes(String((project as { status?: string | null }).status ?? ''));
    const applicationControls = useMemo(() => ({
        load: applicationLoad,
        projectClosed,
        onRetry: () => { setApplicationLoad('loading'); void refreshApplicationStatus(); },
        onEdit: () => { setIsApplyModalOpen(true); setIsEditApplicationOpen(true); },
        onWithdraw: () => setIsWithdrawOpen(true),
    }), [applicationLoad, projectClosed, refreshApplicationStatus]);

    const withdrawApplication = useCallback(async (note: string) => {
        if (!applicationStatus.applicationId) return 'This application is no longer available.';
        const result = await withdrawApplicationAction(applicationStatus.applicationId, note || undefined);
        if (!result.success) return result.error || 'Couldn’t withdraw the application.';
        setIsWithdrawOpen(false);
        toast.success('Application withdrawn');
        await refreshApplicationStatus();
        refreshProjectData();
        return null;
    }, [applicationStatus.applicationId, refreshApplicationStatus, refreshProjectData]);

    const handleApplyToRole = useCallback(
        (role: any) => {
            if (!currentUserId) {
                router.push(signInHref(role?.id));
                return;
            }
            if (isOwner || isMember) {
                toast.error('Workspace members cannot apply for an additional role');
                return;
            }
            if (applicationLoad !== 'ready') {
                toast.error(feedbackError(applicationLoad === 'error' ? 'Couldn’t check your application. Try again.' : 'Checking your application…', "Checking your application…"));
                return;
            }
            if (applicationStatus.status === 'pending') {
                toast.error('Application already pending');
                return;
            }
            if (applicationStatus.status === 'proposed') {
                toast.error('Workspace invitation pending');
                return;
            }
            if (applicationStatus.status === 'rejected' && !applicationStatus.canReapply) {
                toast.warning(`You can apply again in ${applicationStatus.waitTime}`);
                return;
            }

            // Open the apply modal, optionally with a preselected role
            setPreselectedRoleId(role?.id || undefined);
            setIsApplyModalOpen(true);
        },
        [currentUserId, applicationLoad, applicationStatus, isMember, isOwner, router],
    );

    useEffect(() => {
        if (!applyRoleIdFromUrl) {
            roleApplyRequestRef.current = null;
            return;
        }

        if (roleApplyRequestRef.current === applyRoleIdFromUrl) return;

        // Wait until we know whether this viewer may apply, so the form never opens for someone who already has.
        const needsStatus = Boolean(currentUserId) && !isOwner && !isMember;
        if (needsStatus && applicationLoad === 'loading') return;

        const role = rolesWithFilled.find((item: any) => item?.id === applyRoleIdFromUrl);
        if (!role) return;

        roleApplyRequestRef.current = applyRoleIdFromUrl;
        setActiveTab('dashboard');
        handleApplyToRole(role);
        // Keep the link out of the address bar once it has done its job (a signed-out visitor is leaving).
        if (currentUserId) {
            const clean = new URL(window.location.href);
            clean.searchParams.delete('applyRole');
            window.history.replaceState(window.history.state, '', `${clean.pathname}${clean.search}${clean.hash}`);
        }
    }, [applyRoleIdFromUrl, applicationLoad, currentUserId, handleApplyToRole, isMember, isOwner, rolesWithFilled]);

    const commitStageIndex = useCallback(
        async (targetIndex: number, expectedUpdatedAt: string | null, allowRetry = true): Promise<boolean> => {
            const requestId = ++stageRequestRef.current;
            setIsStageUpdatingSafe(true);
            try {
                const result = await updateProjectStageAction(project.id, targetIndex, {
                    expectedUpdatedAt: expectedUpdatedAt || undefined,
                });

                if (!isMountedRef.current || requestId !== stageRequestRef.current) return false;

                if (result.success) {
                    const nextIndex = typeof result.currentStageIndex === 'number' ? result.currentStageIndex : targetIndex;
                    setOptimisticStageIndex(nextIndex);
                    setStageVersionSafe(result.updatedAt ?? null);
                    if (result.stageCompletionDates) {
                        setStageCompletionDates(result.stageCompletionDates);
                    }
                    return true;
                }

                if (result.errorCode === 'PROJECT_CONFLICT' && allowRetry && result.latest) {
                    const latestIndex = Math.max(0, result.latest.currentStageIndex ?? 0);
                    const latestVersion = result.latest.updatedAt ?? null;
                    setOptimisticStageIndex(latestIndex);
                    setStageVersionSafe(latestVersion);

                    if (latestIndex >= targetIndex) {
                        toast.info('Stage updated from another session', { description: 'Synced latest stage.' });
                        return true;
                    }

                    const retryTarget = Math.min(Math.max(0, lifecycleStageNames.length - 1), latestIndex + 1);
                    const retryResult = await updateProjectStageAction(project.id, retryTarget, {
                        expectedUpdatedAt: latestVersion || undefined,
                    });

                    if (!isMountedRef.current || requestId !== stageRequestRef.current) return false;

                    if (retryResult.success) {
                        const nextIndex = typeof retryResult.currentStageIndex === 'number' ? retryResult.currentStageIndex : retryTarget;
                        setOptimisticStageIndex(nextIndex);
                        setStageVersionSafe(retryResult.updatedAt ?? latestVersion);
                        if (retryResult.stageCompletionDates) {
                            setStageCompletionDates(retryResult.stageCompletionDates);
                        }
                        return true;
                    }

                    toast.error(feedbackError(retryResult.error || 'Couldn’t update stage after sync', "Couldn’t update stage after sync"));
                    return false;
                }

                toast.error(feedbackError(result.error || 'Couldn’t update stage', "Couldn’t update stage"));
                return false;
            } catch (error) {
                if (!isMountedRef.current || requestId !== stageRequestRef.current) return false;
                toast.error(feedbackError(error instanceof Error ? error.message : 'Couldn’t update workspace stage', "Couldn’t update workspace stage"));
                return false;
            } finally {
                if (isMountedRef.current && requestId === stageRequestRef.current) {
                    setIsStageUpdatingSafe(false);
                }
            }
        },
        [lifecycleStageNames.length, project.id, setIsStageUpdatingSafe, setStageVersionSafe],
    );

    const moveStage = useCallback(async (delta: 1 | -1) => {
        if (isStageUpdating) {
            toast.info('Stage update is in progress');
            return;
        }
        if (!isOwner) {
            toast.error(feedbackError(delta > 0 ? 'Only the workspace owner can advance the stage' : 'Only the workspace owner can revert the stage', "Only the workspace owner can revert the stage"));
            return;
        }

        const stages = lifecycleStageNames;
        const prevIndex = optimisticStageIndex;
        const nextIndex = prevIndex + delta;
        if (nextIndex < 0) {
            toast.info('Workspace is already at the starting stage');
            return;
        }
        if (nextIndex >= stages.length) {
            toast.info('Workspace is already at the final stage');
            return;
        }

        const expectedUpdatedAt = stageVersionRef.current;
        setOptimisticStageIndex(nextIndex);

        const committed = await commitStageIndex(nextIndex, expectedUpdatedAt, true);
        if (!committed) {
            setOptimisticStageIndex(prevIndex);
            return;
        }
        toast.success(delta > 0 ? `Advanced to ${stages[nextIndex]}` : `Returned to ${stages[nextIndex]}`);
    }, [commitStageIndex, isOwner, isStageUpdating, lifecycleStageNames, optimisticStageIndex]);

    const handleRegressStage = useCallback(() => {
        void moveStage(-1);
    }, [moveStage]);

    const handleAdvanceStage = useCallback(() => {
        void moveStage(1);
    }, [moveStage]);

    const filesSyncStatus = extendedProject?.syncStatus;
    // Org tab badges (report §18.3), re-read on each tab change; opening Updates clears its dot.
    const orgIdForBadges = isOrganization && isOwnerOrMember ? project.id : null;
    useEffect(() => {
        if (!orgIdForBadges) return;
        let live = true;
        void readOrgTabBadgesAction(orgIdForBadges).then((b) => { if (live) setOrgBadges(b); });
        return () => { live = false; };
    }, [orgIdForBadges, activeTab]);
    const tabBadges = useMemo(() => orgBadges ? {
        tasks: orgBadges.tasks || undefined,
        updates: orgBadges.updates && activeTab !== 'updates' ? 'dot' as const : undefined,
        members: orgBadges.members || undefined,
    } : {}, [orgBadges, activeTab]);
    const startNew = useCallback((kind: OrgNewKind) => {
        if (kind === 'project') return router.push(`/workspaces/new?org=${encodeURIComponent(project.slug ?? project.id)}`);
        setNewIntent(kind);
        handleTabChange(kind === 'assignment' ? 'tasks' : kind === 'announcement' ? 'updates' : 'sprints');
    }, [handleTabChange, project.id, project.slug, router]);
    // Settings → Work → Story points: Hidden (report §21.2 #5) covers the board, drawers and dialogs (portals) alike.
    const hideStoryPoints = organization?.work.storyPoints === 'hidden';
    useEffect(() => {
        if (!hideStoryPoints) return;
        document.documentElement.dataset.storyPoints = 'hidden';
        return () => { delete document.documentElement.dataset.storyPoints; };
    }, [hideStoryPoints]);
    const canStartNew = isOrganization && canManageProjectSettings && project.status !== 'archived' && !organization?.suspended;
    const activeSprintName = (sprints as Array<{ status?: string; name?: string }>).find((s) => s.status === 'active')?.name ?? null;
    const filesSyncBadge = useFilesStore((s) => s.byProjectId[project.id]?.git?.syncBadge ?? null);
    // `drawerType=task&drawerId=` is the task link; `taskId` is the legacy form some old links carry.
    const initialTaskDrawerId = (searchParams?.get('drawerType') === 'task' ? searchParams.get('drawerId') : null)
        ?? (activeTab === 'tasks' ? searchParams?.get('taskId') ?? null : null);
    const initialTaskPanelTabParam = searchParams?.get('panelTab');
    const initialTaskPanelTab = initialTaskPanelTabParam === 'details' || initialTaskPanelTabParam === 'subtasks' || initialTaskPanelTabParam === 'comments' || initialTaskPanelTabParam === 'files' ? (initialTaskPanelTabParam as TaskPanelTab) : null;
    const initialOpenFileId = searchParams?.get('fileId') || null;
    const initialOpenPath = searchParams?.get('path') || null;

    // Memoize the Files tab while active so parent shell updates do not churn the workspace.
    const filesTabContent = useMemo(
        () => (
            <TabErrorBoundary tabName="Files" fillContainer>
                <FilesTab key={`${project.id}:${currentUserId ?? 'viewer'}`} projectId={project.id} projectSlug={project.slug || undefined} projectName={project.title} currentUserId={currentUserId || undefined} isOwner={isOwner} isOwnerOrMember={isOwnerOrMember} canManageFiles={canManageFiles} canUploadFiles={canUploadFiles} canReadTasks={canReadTaskFiles} isActive={activeTab === 'files'} syncStatus={filesSyncStatus} initialOpenFileId={initialOpenFileId} initialOpenPath={initialOpenPath} isOrganization={isOrganization} orgType={organization?.type ?? null} />
            </TabErrorBoundary>
        ),
        [project.id, project.slug, project.title, currentUserId, isOwner, isOwnerOrMember, canManageFiles, canUploadFiles, canReadTaskFiles, activeTab, filesSyncStatus, initialOpenFileId, initialOpenPath, isOrganization, organization?.type],
    );

    return (
        <PlainContentHeadings>
        {shareOpen ? <ResourceShareDialog kind="project" path={canonicalProjectHref} returnFocusElement={shareTrigger.current} onClose={() => setShareOpen(false)} /> : null}
        <ProjectLayout project={projectWithLiveStats} isOwner={isOwner} canManageSettings={canManageProjectSettings} isOwnerOrMember={canSeeAllTabs} publicTabVisibility={publicTabVisibility} activeTab={activeTab ?? ''} onTabChange={handleTabChange} followersCount={followersCount} viewCount={viewCount} filesSyncBadge={filesSyncBadge} isFollowing={isFollowing} onFollow={handleFollow} followLoading={followLoading} onShare={handleShare} onInvite={() => (isOrganization ? setIsOrgInviteOpen(true) : setIsInviteModalOpen(true))} canInvite={canManageProjectSettings}
            isOrganization={isOrganization}
            canOpenSettings={isInheritedAdmin}
            breadcrumb={parentOrg ? <OrgBreadcrumb parentOrg={parentOrg} /> : null}
            identityExtra={parentOrg ? <ChildOrgChips parentOrg={parentOrg} visibility={project.visibility} archived={project.status === 'archived'} /> : organization ? <><OrgIdentityLine handle={project.slug ?? null} organization={organization} memberRole={isOwner ? 'owner' : (currentProjectRole as 'admin' | 'member' | 'viewer' | null) ?? null} archived={project.status === 'archived'} /><OrgStatusBanner orgId={project.id} organization={organization} isOwner={isOwner} /></> : null}
            metadataExtra={organization?.childProjectCount ? <span className="nb-compact text-muted-foreground">· {organization.childProjectCount} {organization.childProjectCount === 1 ? 'project' : 'projects'}</span> : null}
            tabBadges={tabBadges}
            compactChip={organization ? (activeSprintName ? <span className="nb-status shrink-0" data-status="active">{activeSprintName}</span> : null) : undefined}
            compactPrefix={parentOrg ? <OrgCompactMark parentOrg={parentOrg} /> : null}
            compactMenuItems={canStartNew ? <OrgNewItems onNew={startNew} prefix="New " /> : null}
            actionsStart={organization ? <>{canStartNew ? <OrgNewMenu onNew={startNew} /> : null}{!isOwnerOrMember && currentUserId ? <OrgInviteBanner orgId={project.id} /> : null}{!isOwnerOrMember && isProjectPubliclyReadableVisibility(project.visibility) && project.status !== 'archived' && !organization.suspended ? <OrgVisitorActions orgId={project.id} href={canonicalProjectHref} joinMode={organization.joinMode} requestPending={organization.viewerRequestPending} loggedIn={Boolean(currentUserId)} /> : null}{currentUserId && !isOwner ? <OrgHeaderMenu orgId={project.id} /> : null}</> : null}
            showFollow={!organization || (!isOwnerOrMember && isProjectPubliclyReadableVisibility(project.visibility))} onTabHover={handleTabHover} members={allMembers} loadingMembers={loadingMembers} stageLabel={lifecycleStageNames[optimisticStageIndex] ?? null} stageIndex={optimisticStageIndex} stageCount={lifecycleStageNames.length} applicationLabel={applicationHeaderLabel} openRolesCount={rolesWithFilled.filter((role: any) => (role?.count || 0) - (role?.filled || 0) > 0).length}>
            {!activeTab && (
                <div className="w-full h-full min-h-[40vh] flex items-center justify-center p-8">
                    <div className="nb-empty-state max-w-md text-center py-12" role="status">
                        <Lock className="nb-empty-state-icon mx-auto text-muted-foreground" aria-hidden="true" />
                        <p className="nb-card-title mt-4 text-foreground">Tab unavailable</p>
                        <p className="nb-compact mt-2 text-muted-foreground">
                            You don’t have access to this tab. The owner or admins limit who can see it.
                        </p>
                    </div>
                </div>
            )}

            {activeTab === 'dashboard' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Dashboard">
                        {/* Orgs get their own Dashboard (report §27); child projects add the org line (§27.5). */}
                        {isOrganization ? <OrgDashboard orgId={project.id} orgSlug={project.slug ?? null} /> : <>
                        {parentOrg ? <ChildOrgLine projectId={project.id} /> : null}
                        {parentOrg ? <ChildUnitsLine projectId={project.id} members={allMembers} /> : null}
                        <DashboardTab project={projectWithLiveStats} isCreator={isOwner} isCollaborator={isMember} rolesWithFilled={rolesWithFilled} onEdit={handleEdit} onAdvanceStage={handleAdvanceStage} onRedoStage={handleRegressStage} onApplyToRole={handleApplyToRole} lifecycleStages={lifecycleStages} currentStageIndex={optimisticStageIndex} applicationStatus={applicationStatus} onAcceptInvitation={() => void handleInvitation('accept')} onDeclineInvitation={() => void handleInvitation('decline')} invitationLoading={invitationLoading} application={applicationControls} pendingApplications={pendingApplicationsForReviewer} />
                        </>}
                    </TabErrorBoundary>
                </div>
            )}

            {isOrganization && activeTab === 'about' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="About">
                        <OrgAboutTab project={projectWithLiveStats} isCreator={isOwner} onEdit={handleEdit} visitorActions={organization && !isOwnerOrMember && isProjectPubliclyReadableVisibility(project.visibility) ? <OrgVisitorActions orgId={project.id} href={canonicalProjectHref} joinMode={organization.joinMode} requestPending={organization.viewerRequestPending} loggedIn={Boolean(currentUserId)} /> : undefined} />
                    </TabErrorBoundary>
                </div>
            )}

            {isOrganization && isOwnerOrMember && activeTab === 'projects' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Workspaces">
                        <OrgProjectsTab orgId={project.id} orgSlug={project.slug} />
                    </TabErrorBoundary>
                </div>
            )}

            {isOrganization && canManageProjectSettings && activeTab === 'members' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Members">
                        <OrgMembersTab orgId={project.id} roleNames={organization?.roleNames} />
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'readme' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Docs" fillContainer>
                        <DocTab projectId={project.id} project={projectWithLiveStats} />
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'updates' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Updates">
                        <UpdatesTab projectId={project.id} projectSlug={project.slug || project.id} projectName={project.title} currentUserId={currentUserId} currentUserName={currentUserName} currentUserAvatarUrl={currentUserAvatarUrl} canCreateUpdates={canCreateUpdates} canManageUpdates={canManageUpdates} focusComposer={newIntent === 'announcement'} onComposerFocused={() => setNewIntent(null)} initialUpdateId={searchParams?.get('updateId') || null} initialCommentId={searchParams?.get('commentId') || null} />
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'sprints' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Sprints">
                        <div className="space-y-6">
                            <Suspense fallback={<SkeletonSprints />}>
                                <SprintPlanning projectId={project.id} projectSlug={project.slug || project.id} projectName={project.title} projectKey={project.key} isOwner={isOwner} isOwnerOrMember={isOwnerOrMember} initialSprintData={initialSprintData} startCreate={newIntent === 'sprint'} onCreateStarted={() => setNewIntent(null)} />
                            </Suspense>
                        </div>
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'tasks' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Tasks">
                        {/* Assignments (report §16.5) and, in child projects, the org's group copies (§16.6). */}
                        {isOrganization ? <AssignmentsPanel orgId={project.id} onBoardChanged={() => refreshProjectData('tasks')} startComposing={newIntent === 'assignment'} onComposingStarted={() => setNewIntent(null)} /> : null}
                        {parentOrg ? <GroupCopiesPanel projectId={project.id} onBoardChanged={() => refreshProjectData('tasks')} /> : null}
                        <TasksTab projectId={project.id} projectSlug={project.slug || project.id} projectName={project.title} currentUserId={currentUserId || undefined} currentUserName={currentUserName} currentUserAvatarUrl={currentUserAvatarUrl} isOwner={isOwner} canEditTasks={canEditTasks} isProjectMember={isOwnerOrMember} canManageFiles={canManageFiles} canManageWorkflow={canManageProjectSettings} isChildProject={Boolean(parentOrg)} initialTasks={tasks} members={allMembers} sprints={sprints} initialOpenTaskId={initialTaskDrawerId ?? myWorkInitialTaskId} initialPanelTab={initialTaskPanelTab} initialCommentId={searchParams?.get('commentId')} initialFileId={searchParams?.get('fileId')} onInitialTaskOpened={myWorkInitialTaskId ? consumeMyWorkTaskHandoff : undefined} />
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'files' && (
                <div className="w-full h-full min-h-0">
                    {/* Org Files (report §23): folder access for org admins; From <org> in child projects. */}
                    {isOrganization && canManageFiles ? <OrgFilesPanel projectId={project.id} mode="org-admin" canCopy={false} /> : null}
                    {isOrganization && isOwnerOrMember ? <OrgSprintMaterials orgId={project.id} orgSlug={project.slug ?? null} /> : null}
                    {parentOrg && (isOwnerOrMember || isInheritedAdmin) ? <OrgFilesPanel projectId={project.id} mode="child" canCopy={canUploadFiles || isInheritedAdmin} /> : null}
                    {filesTabContent}
                </div>
            )}

            {(canManageProjectSettings || isInheritedAdmin || (isOrganization && isOwnerOrMember)) && activeTab === 'settings' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Settings">
                        <ProjectSettingsTab projectId={project.id} project={projectWithLiveStats} onProjectUpdated={handleProjectSettingsUpdated} isProjectOwner={isOwner} actorRole={currentProjectRole} members={allMembers} loadingMembers={loadingMembers} />
                    </TabErrorBoundary>
                </div>
            )}

            {organization && canManageProjectSettings ? (
                <OrgInviteDialog orgId={project.id} title={project.title} joinCode={organization.joinCode} open={isOrgInviteOpen} onOpenChange={setIsOrgInviteOpen} />
            ) : null}

            {isOnboardingOpen ? (
                <ProjectOnboardingModal
                    isOpen={isOnboardingOpen}
                    onClose={() => setIsOnboardingOpen(false)}
                    projectTitle={project.title}
                    roleTitle={applicationStatus.status === 'accepted' && applicationStatus.roleTitle ? applicationStatus.roleTitle : undefined}
                    onViewTasks={() => {
                        setIsOnboardingOpen(false);
                        handleTabChange('tasks');
                    }}
                    onViewDocs={() => {
                        setIsOnboardingOpen(false);
                        handleTabChange('readme');
                    }}
                />
            ) : null}

            {isEditModalOpen ? <EditProjectModal project={extendedProject} isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} onSaved={() => refreshProjectData()} /> : null}

            {isApplyModalOpen && (rolesWithFilled.length > 0 || isEditApplicationOpen) && (
                <ApplyRoleModal
                    isOpen={isApplyModalOpen}
                    onClose={() => {
                        setIsApplyModalOpen(false);
                        setIsEditApplicationOpen(false);
                        setPreselectedRoleId(undefined);
                    }}
                    onRolesStale={() => refreshProjectData()}
                    lead={(extendedProject?.owner ?? project.owner) as { id: string; username?: string | null; fullName?: string | null; avatarUrl?: string | null } | undefined}
                    editApplication={isEditApplicationOpen && applicationStatus.applicationId ? {
                        applicationId: applicationStatus.applicationId,
                        roleId: applicationStatus.roleId,
                        message: applicationStatus.message ?? '',
                        details: applicationStatus.details,
                    } : undefined}
                    project={{
                        id: project.id,
                        title: project.title,
                        slug: project.slug,
                    }}
                    roles={rolesWithFilled}
                    preselectedRoleId={preselectedRoleId}
                    onSuccess={(result) => {
                        refreshProjectData();
                        // Show Pending at once; the read below fills in the rest.
                        if (result?.applicationId) lastStatusRef.current = 'pending';
                        if (result?.applicationId) setApplicationStatus((current) => ({ ...current, status: 'pending', applicationId: result.applicationId, channelId: result.channelId ?? current.channelId }));
                        void refreshApplicationStatus();
                    }}
                />
            )}

            <WithdrawApplicationDialog
                open={isWithdrawOpen}
                roleTitle={applicationStatus.roleTitle}
                onClose={() => setIsWithdrawOpen(false)}
                onConfirm={withdrawApplication}
            />

            {isInviteModalOpen && (
                <InviteCollaboratorModal
                    isOpen={isInviteModalOpen}
                    onClose={() => setIsInviteModalOpen(false)}
                    onSuccess={() => refreshProjectData()}
                    projectId={project.id}
                    projectTitle={project.title}
                    canAppointGuidance={isOwner}
                />
            )}
        </ProjectLayout>
        </PlainContentHeadings>
    );
}
