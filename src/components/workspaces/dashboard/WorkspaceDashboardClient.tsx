'use client';

import { runningSprint, sprintPath } from '@/lib/workspaces/sprint-plan';
import { Suspense, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { toast, feedbackError } from "@/lib/feedback";
import { Loader2, Lock } from 'lucide-react';
import dynamic from 'next/dynamic';
import { createClient } from '@/lib/supabase/client';
import WorkspaceLayout from '@/components/workspaces/dashboard/WorkspaceLayout';
import { PlainContentHeadings } from '@/components/workspaces/PlainContentHeadings';
import { TabErrorBoundary } from '@/components/workspaces/TabErrorBoundary';
import type { Workspace } from '@/types/discover';
import { toggleWorkspaceFollowAction, updateWorkspaceStageAction } from '@/app/actions/workspace';
import { fetchWorkspaceCounts, followWorkspaceTopic, patchDiscoverCounts, useWorkspaceViewBeacon } from '@/hooks/useWorkspaceLiveCounts';
import { ROUTES } from '@/constants/routes';
import { getApplicationStatusAction, withdrawApplicationAction, type ApplicationStatusResult } from '@/app/actions/applications';
import type { ApplicationStatusLoad } from '@/lib/applications/card-state';
import { useRoleApplicationCounts } from '@/hooks/useRoleApplicationCounts';
import { userTopic } from '@/lib/messaging/constants';
import { subscribeBroadcast } from '@/lib/realtime/private-broadcast';
import { resolveWorkspaceInvitationAction } from '@/app/actions/workspace/guidance';
import { useWorkspaceMembers } from '@/hooks/workspaces/useWorkspaceMembers';
import { queryKeys } from '@/lib/query-keys';
import { logger } from '@/lib/logger';
import { liveTopics } from '@/lib/realtime/subscriptions';
import type { SprintDetailPayload } from '@/lib/workspaces/sprint-detail';
import type { TaskPanelTab } from '@/hooks/useTaskPanelResource';
import { normalizeWorkspaceDocSlug } from '@/lib/workspaces/doc-slug';
import { canWorkspaceMemberUploadFiles, isWorkspaceTabVisibleToViewer, normalizeWorkspaceMemberRole, normalizeWorkspacePublicTabVisibility, WORKSPACE_MEMBER_ROLE_LABELS, resolveAllowedWorkspaceTab, type WorkspaceMemberRole } from '@/lib/workspaces/settings-policies';
import {
    useUIStore,
    MY_WORK_TASK_HANDOFF_STORAGE_KEY,
    readMyWorkTaskHandoff,
    type MyWorkTaskHandoff,
} from '@/stores/ui-store';

import { DashboardTab, DocTab, UpdatesTab, TasksTab, FilesTab, SprintPlanning, WorkspaceSettingsTab } from '@/components/workspaces/dashboard/WorkspaceTabsRegistry';
import { SkeletonSprints } from '@/components/workspaces/skeletons/SkeletonSprints';
import { OrgAboutTab } from '@/components/organizations/OrgAboutTab';
import { GroupCopiesPanel } from '@/components/organizations/AssignmentsPanel';
import type { OrgFilesInfo } from '@/components/organizations/OrgFilesPanel';
import { OrgMembersTab } from '@/components/organizations/OrgMembersTab';
import { ChildOrgHeaderDetails, ChildOrgLine, ChildUnitsLine, OrgDashboard } from '@/components/organizations/OrgOverviewParts';
import { OrgWorkspacesTab } from '@/components/organizations/OrgWorkspacesTab';
import { OrgInviteBanner } from '@/components/organizations/OrgInviteBanner';
import { VerifiedMark } from '@/components/organizations/org-ui';
import { HeaderReportMenu } from '@/components/reports/ItemMenu';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { ChildOrgChips, OrgArchivedNotice, OrgBreadcrumb, OrgCompactMark, OrgHeaderDetails, OrgInviteDialog, OrgNewItems, OrgNewMenu, OrgStatusBanner, OrgVisitorActions, type OrgNewKind } from '@/components/organizations/OrgHeaderParts';
import { readOrgTabBadgesAction, type OrgTabBadges } from '@/app/actions/assignments';
import type { OrgStartedReads } from '@/lib/organizations/started-reads';
import type { TasksBoot } from '@/lib/workspaces/server/tasks-boot';
import type { getWorkspaceNodesWithCounts } from '@/app/actions/files/nodes';
import { offerStartedRoot } from '@/lib/files/started-root';
import { serverFirst } from '@/lib/server-first';
import { isWorkspacePubliclyReadableVisibility } from '@/lib/workspaces/workspace-visibility';
import { confirmFileNavigation } from '@/lib/files/unsaved-navigation';
import { useFilesStore } from '@/stores/filesStore';
import { useReloadOnNotice } from '@/hooks/useReloadOnNotice';

const EditWorkspaceModal = dynamic(() => import('@/components/workspaces/EditWorkspaceModal'), { ssr: false, loading: () => null });

const WithdrawApplicationDialog = dynamic(() => import('@/components/workspaces/dashboard/WithdrawApplicationDialog'), { ssr: false, loading: () => null });
const InviteCollaboratorModal = dynamic(() => import('@/components/workspaces/dashboard/InviteCollaboratorModal'), { ssr: false, loading: () => null });

const ApplyRoleModal = dynamic(() => import('@/components/workspaces/ApplyRoleModal'), { ssr: false, loading: () => null });

const WorkspaceOnboardingModal = dynamic(() => import('@/components/workspaces/WorkspaceOnboardingModal').then((mod) => mod.WorkspaceOnboardingModal), { ssr: false, loading: () => null });

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

interface ExtendedProjectDetail extends Omit<Workspace, 'publicTabVisibility'> {
    publicTabVisibility?: Workspace['publicTabVisibility'] | string;
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
    /** Reads the page started on the server for an organization's open tab (a browser runs actions one at a time). */
    orgStarted?: OrgStartedReads | null;
    /** The Tasks tab's first reads, started on the server when the page opens on Tasks. */
    tasksStarted?: TasksBoot | null;
    /** The Files tab's root folder, started on the server when the page opens on Files. */
    filesStarted?: ReturnType<typeof getWorkspaceNodesWithCounts> | null;
}

const ResourceShareDialog = dynamic(() => import('@/components/sharing/ShareDialog').then(mod => mod.ShareDialog), { ssr: false });
async function askToChangeTeam(workspaceId: string) {
    const { askToChangeTeamAction } = await import('@/app/actions/blocking');
    const result = await askToChangeTeamAction(workspaceId);
    toast(result.success ? 'Your request went to the organization’s admins. Nobody else is told.' : result.error);
}

export default function WorkspaceDashboardClient({ project, currentUserId, viewerDisplayName = null, viewerAvatarUrl = null, isOwner, isMember, memberRole = null, initialSprintData = null, orgStarted = null, tasksStarted = null, filesStarted = null }: ProjectDashboardClientProps) {
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
    const publicTabVisibility = useMemo(() => normalizeWorkspacePublicTabVisibility(project.publicTabVisibility ?? project.public_tab_visibility), [project]);
    const isOwnerOrMember = isOwner || isMember;
    // Org admins read every tab of their org's child projects and manage its org link (report §29.4);
    // the project's own admin tools stay with its team.
    const parentOrg = project.parentOrg ?? null;
    const isInheritedAdmin = Boolean(parentOrg?.viewerIsInheritedAdmin) && !isOwnerOrMember;
    const canSeeAllTabs = isOwnerOrMember || isInheritedAdmin;
    const resolvedActiveTab = resolveAllowedWorkspaceTab({
        requestedTab: normalizeProjectDetailTabParam(searchParams?.get('tab')),
        isOwnerOrMember: canSeeAllTabs,
        // Smaller bug 13: admins can open Members, so ?tab=members must not start on Overview and then jump.
        // Audit N39: an org admin outside the team opens this workspace's Settings (its Organization section).
        canManageSettings: isOwner || (isMember && normalizeWorkspaceMemberRole(memberRole, 'member') === 'admin') || isInheritedAdmin,
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
    // Search's "New task in …" quick action opens ?tab=tasks&new=1.
    const [newIntent, setNewIntent] = useState<Exclude<OrgNewKind, 'project'> | null>(() => resolvedActiveTab === 'tasks' && searchParams?.get('new') === '1' ? 'task' : null);
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
            // Audit N60: About's details come from their own read.
            void queryClient.invalidateQueries({ queryKey: ['org-about', project.id] });
        },
        [refreshProjectData, queryClient, project.id],
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
            const res = await resolveWorkspaceInvitationAction({
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

    // Realtime subscription for stage changes and the header's counts
    useEffect(() => {
        if (!project?.id || !currentUserId) return;
        const applyCounts = (views: unknown, followers: unknown) => {
            if (typeof views === 'number') setViewCount((current: number) => Math.max(current, views));
            if (typeof followers === 'number') setFollowersCount(followers);
        };
        const workspaceId = project.id;
        return followWorkspaceTopic(workspaceId, (event, payload: any) => {
                if (event !== 'workspace.changed') return;
                // A stage change in flight holds back only the stage fields, never the counts.
                applyCounts(payload.view_count, payload.followers_count);
                if (isStageUpdatingRef.current) return;

                const nextIndex = payload.current_stage_index;
                if (nextIndex !== undefined && nextIndex !== null) {
                    setOptimisticStageIndex(Number(nextIndex));
                }
                const nextDates = payload.stage_completion_dates;
                if (nextDates !== undefined && nextDates !== null) {
                    setStageCompletionDates(nextDates as Record<string, string>);
                }
                const nextVersion = payload.updated_at;
                if (typeof nextVersion === 'string') {
                    setStageVersionSafe(nextVersion);
                }
        }, () => void fetchWorkspaceCounts(workspaceId).then((counts) => applyCounts(counts?.viewCount, counts?.followersCount)));
    }, [currentUserId, project?.id, setStageVersionSafe]);

    // What this page knows reaches the cached Discover cards, so card and header agree.
    useEffect(() => {
        if (project?.id) patchDiscoverCounts(queryClient, project.id, { viewCount, followersCount });
    }, [followersCount, project?.id, queryClient, viewCount]);

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
        // A reviewer's decision arrives live, so the card changes while the page is open.
        const live = subscribeBroadcast(userTopic(currentUserId), (event, payload) => {
            if (event === 'application.changed' && payload.project_id === project.id) void refreshApplicationStatus();
        });
        return () => {
            document.removeEventListener('visibilitychange', onVisible);
            live.unsubscribe();
        };
    }, [currentUserId, isOwner, isMember, project.id, refreshApplicationStatus]);

    // Hook Integration: Scalable Member Loading
    const shouldLoadMembers = activeTab === 'dashboard' || activeTab === 'tasks' || activeTab === 'updates' || activeTab === 'sprints' || activeTab === 'settings';

    const {
        data: membersData,
        isLoading: loadingMembers,
    } = useWorkspaceMembers(project.id, collaboratorUsers || [], {
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
    const currentProjectRole: WorkspaceMemberRole | null = isOwner
        ? 'owner'
        : isMember ? normalizeWorkspaceMemberRole(memberRole, 'member') : null;
    const canManageProjectSettings = isOwner || currentProjectRole === 'admin';
    // Which tabs open: the project's admins, plus org admins for Settings only (audit N39). Tools stay canManageProjectSettings.
    const canOpenSettingsTab = canManageProjectSettings || isInheritedAdmin;
    // Decision 139: an organization admin not on the team creates and moves its tasks too, marked Viewing as admin.
    const canEditTasks = isOwner || currentProjectRole === 'admin' || currentProjectRole === 'member' || isInheritedAdmin;
    const canManageFiles = isOwner || currentProjectRole === 'admin';
    const currentFileMember = allMembers.find((item: any) => item?.id === currentUserId);
    // Org files: only owners and admins write the org tree; members add files to their own copies (report §23.4).
    const canUploadFiles = isOrganization ? canManageFiles : isOwner || canWorkspaceMemberUploadFiles({ role: currentProjectRole, fileUploadEnabled: currentFileMember?.fileUploadEnabled });
    const canReadTaskFiles = isWorkspaceTabVisibleToViewer({ tabId: 'tasks', isOwnerOrMember: canSeeAllTabs, publicTabVisibility });

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
    const switchTab = useCallback(
        (tabId: string) => {
            if (
                !isWorkspaceTabVisibleToViewer({
                    tabId,
                    isOwnerOrMember: canSeeAllTabs,
                    canManageSettings: canOpenSettingsTab,
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
                // No made-up doc=readme: the Documents tab opens the first document and puts its real slug in the address.
                nextParams.set('tab', 'docs');
            } else if (tabId === (isOrganization && !canSeeAllTabs ? 'about' : 'dashboard')) {
                // Audit 4.5: the landing tab has no ?tab=, so the clean-up below has nothing to undo.
                nextParams.delete('tab');
            } else {
                nextParams.set('tab', tabId);
            }

            // Clean up other tab-specific query parameters when switching tabs
            clearProjectDetailScopedParams(nextParams, tabId);

            const nextQuery = nextParams.toString();
            const safePath = pathname ?? window.location.pathname;
            const nextUrl = nextQuery ? `${safePath}?${nextQuery}` : safePath;
            // A user's tab click is a history entry; canonicalising below stays a replace. Audit 4.5: the address
            // changes without a server round trip (the tabs read their own data), as Files and Messages already do.
            window.history.pushState(null, '', nextUrl);
        },
        [activeTab, canOpenSettingsTab, canSeeAllTabs, isOrganization, pathname, publicTabVisibility, router],
    );
    const handleTabChange = useCallback((tabId: string) => confirmFileNavigation(project.id, () => switchTab(tabId)), [project.id, switchTab]);

    // Keep the URL canonical from the URL state itself. This avoids the tab
    // rollback that happens when optimistic local tab state cleans a stale URL.
    useEffect(() => {
        if (typeof window === "undefined") return;

        const nextParams = new URLSearchParams(searchParams?.toString() ?? window.location.search);
        const requestedTab = normalizeProjectDetailTabParam(nextParams.get('tab'));
        const normalizedRequestedTab = requestedTab;
        const allowedTab = resolveAllowedWorkspaceTab({
            requestedTab: normalizedRequestedTab,
            isOwnerOrMember: canSeeAllTabs,
            canManageSettings: canOpenSettingsTab,
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
            // Audit 4.6: only a doc that is in the address is normalized; none is added (the tab picks its first one).
            const normalizedDocSlug = currentDocSlug ? normalizeWorkspaceDocSlug(currentDocSlug) : null;
            if (currentDocSlug && normalizedDocSlug && currentDocSlug !== normalizedDocSlug) {
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
        canOpenSettingsTab,
        canSeeAllTabs,
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
        const nextTab = resolveAllowedWorkspaceTab({
            requestedTab: normalizedRequestedTab,
            isOwnerOrMember: canSeeAllTabs,
            canManageSettings: canOpenSettingsTab,
            publicTabVisibility,
            isOrganization,
        });
        setActiveTab((prev) => (prev === nextTab ? prev : nextTab));
    }, [
        canOpenSettingsTab,
        canSeeAllTabs,
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
            const result = await toggleWorkspaceFollowAction(project.id, newIsFollowing);
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

    useWorkspaceViewBeacon(project?.id, canSeeAllTabs);

    // The visitor's own application, on the mobile header link (where "N open roles" is otherwise).
    const applicationHeaderLabel = applicationStatus.status === 'pending' ? 'Application pending'
        : applicationStatus.status === 'rejected' ? 'Application declined'
            : applicationStatus.status === 'withdrawn' ? 'Application withdrawn' : null;
    // Owners and admins see how many applications wait for them (the counts action answers only for reviewers).
    // Organizations don't show these counts; only the workspace Dashboard does.
    const roleApplicationCounts = useRoleApplicationCounts(project.id, canManageProjectSettings && !isOrganization);
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
                const result = await updateWorkspaceStageAction(project.id, targetIndex, {
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
                    const retryResult = await updateWorkspaceStageAction(project.id, retryTarget, {
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
        toast.success(`Moved to ${stages[nextIndex]}`);
    }, [commitStageIndex, isOwner, isStageUpdating, lifecycleStageNames, optimisticStageIndex]);

    const handleRegressStage = useCallback(() => {
        void moveStage(-1);
    }, [moveStage]);

    const handleAdvanceStage = useCallback(() => {
        void moveStage(1);
    }, [moveStage]);

    const filesSyncStatus = extendedProject?.syncStatus;
    // Org tab badges (report §18.3), re-read on each tab change; opening Updates clears its dot.
    // The page started the Files root read on the server; the explorer takes it once.
    useState(() => offerStartedRoot(project.id, filesStarted));
    const orgIdForBadges = isOrganization && isOwnerOrMember ? project.id : null;
    const [readBadges] = useState(() => serverFirst(orgStarted?.badges, () => readOrgTabBadgesAction(project.id)));
    // Audit 5.6: a new request or hand-in updates the counts without a tab change.
    const [badgeTick, setBadgeTick] = useState(0);
    useReloadOnNotice(() => setBadgeTick((n) => n + 1));
    useEffect(() => {
        if (!orgIdForBadges) return;
        let live = true;
        void readBadges().then((b) => { if (live) setOrgBadges(b); });
        return () => { live = false; };
    }, [orgIdForBadges, activeTab, readBadges, badgeTick]);
    const tabBadges = useMemo(() => orgBadges ? {
        tasks: orgBadges.tasks || undefined,
        updates: orgBadges.updates && activeTab !== 'updates' ? 'dot' as const : undefined,
        members: orgBadges.members || undefined,
    } : {}, [orgBadges, activeTab]);
    const startNew = useCallback((kind: OrgNewKind) => {
        if (kind === 'project') return router.push(`/workspaces/new?org=${encodeURIComponent(project.slug ?? project.id)}`);
        setNewIntent(kind);
        handleTabChange(kind === 'task' || kind === 'assignment' ? 'tasks' : kind === 'announcement' ? 'updates' : 'sprints');
    }, [handleTabChange, project.id, project.slug, router]);
    // Settings → Work → Story points: Hidden (report §21.2 #5) covers the board, drawers and dialogs (portals) alike.
    const hideStoryPoints = organization?.work.storyPoints === 'hidden';
    useEffect(() => {
        if (!hideStoryPoints) return;
        document.documentElement.dataset.storyPoints = 'hidden';
        return () => { delete document.documentElement.dataset.storyPoints; };
    }, [hideStoryPoints]);
    const canStartNew = isOrganization && canManageProjectSettings && project.status !== 'archived' && !organization?.suspended;
    // Board/review report §6: the header chip names the running sprint inside a CO as "CO1 · Week 3–4".
    const sprintList = (sprints as Array<{ id: string; status: string; name: string; parentSprintId?: string | null }>) ?? [];
    const runningNow = runningSprint(sprintList);
    const activeSprintName = runningNow ? sprintPath(runningNow, sprintList) : null;
    const filesSyncBadge = useFilesStore((s) => s.byProjectId[project.id]?.git?.syncBadge ?? null);
    // `drawerType=task&drawerId=` is the task link; `taskId` is the legacy form some old links carry.
    const initialTaskDrawerId = (searchParams?.get('drawerType') === 'task' ? searchParams.get('drawerId') : null)
        ?? (activeTab === 'tasks' ? searchParams?.get('taskId') ?? null : null);
    const initialTaskPanelTabParam = searchParams?.get('panelTab');
    const initialTaskPanelTab = initialTaskPanelTabParam === 'details' || initialTaskPanelTabParam === 'subtasks' || initialTaskPanelTabParam === 'comments' || initialTaskPanelTabParam === 'files' ? (initialTaskPanelTabParam as TaskPanelTab) : null;
    const initialOpenFileId = searchParams?.get('fileId') || null;
    const initialOpenPath = searchParams?.get('path') || null;

    // Report §7.8, §18.6: the organization's views sit in the Files left panel; an outside person gets none.
    const orgFiles = useMemo<OrgFilesInfo | null>(() => (
        isOrganization ? { mode: 'org', orgId: project.id, title: project.title, slug: project.slug ?? null, isAdmin: canManageFiles, canCopy: false }
            : parentOrg && (parentOrg.viewerRole || isInheritedAdmin) ? { mode: 'child', orgId: parentOrg.id, title: parentOrg.title, slug: parentOrg.slug, isAdmin: isInheritedAdmin || parentOrg.viewerRole === 'owner' || parentOrg.viewerRole === 'admin', canCopy: canUploadFiles || isInheritedAdmin }
                : null
    ), [isOrganization, project.id, project.title, project.slug, canManageFiles, parentOrg, isInheritedAdmin, canUploadFiles]);
    // Memoize the Files tab while active so parent shell updates do not churn the workspace.
    const filesTabContent = useMemo(
        () => (
            <TabErrorBoundary tabName="Files" fillContainer>
                <FilesTab key={`${project.id}:${currentUserId ?? 'viewer'}`} projectId={project.id} projectSlug={project.slug || undefined} projectName={project.title} currentUserId={currentUserId || undefined} isOwner={isOwner} isOwnerOrMember={isOwnerOrMember} canManageFiles={canManageFiles} canUploadFiles={canUploadFiles} canReadTasks={canReadTaskFiles} isActive={activeTab === 'files'} syncStatus={filesSyncStatus} initialOpenFileId={initialOpenFileId} initialOpenPath={initialOpenPath} isOrganization={isOrganization} orgType={organization?.type ?? null} orgFiles={orgFiles} />
            </TabErrorBoundary>
        ),
        [project.id, project.slug, project.title, currentUserId, isOwner, isOwnerOrMember, canManageFiles, canUploadFiles, canReadTaskFiles, activeTab, filesSyncStatus, initialOpenFileId, initialOpenPath, isOrganization, organization?.type, orgFiles],
    );

    return (
        <PlainContentHeadings>
        {shareOpen ? <ResourceShareDialog kind="project" path={canonicalProjectHref} returnFocusElement={shareTrigger.current} onClose={() => setShareOpen(false)} /> : null}
        <WorkspaceLayout project={projectWithLiveStats} isOwner={isOwner} canManageSettings={canManageProjectSettings} isOwnerOrMember={canSeeAllTabs} publicTabVisibility={publicTabVisibility} activeTab={activeTab ?? ''} onTabChange={handleTabChange} followersCount={followersCount} viewCount={viewCount} filesSyncBadge={filesSyncBadge} isFollowing={isFollowing} onFollow={handleFollow} followLoading={followLoading} onShare={handleShare} onInvite={() => (isOrganization ? setIsOrgInviteOpen(true) : setIsInviteModalOpen(true))} canInvite={canManageProjectSettings}
            isOrganization={isOrganization}
            canOpenSettings={isInheritedAdmin}
            breadcrumb={parentOrg ? <OrgBreadcrumb parentOrg={parentOrg} current={project.title} /> : null}
            identityExtra={parentOrg ? <ChildOrgChips parentOrg={parentOrg} visibility={project.visibility} archived={project.status === 'archived'} isWorkspaceMember={isOwnerOrMember} /> : organization ? <>{!isOwnerOrMember && currentUserId ? <OrgInviteBanner orgId={project.id} /> : null}{project.status === 'archived' ? <OrgArchivedNotice /> : null}<OrgStatusBanner orgId={project.id} organization={organization} isOwner={isOwner} /></> : null}
            headerDetails={parentOrg ? <ChildOrgHeaderDetails projectId={project.id} /> : organization ? <OrgHeaderDetails organization={organization} /> : null}
            metadataExtra={organization?.childProjectCount ? <span className="nb-compact text-muted-foreground">· {isOwnerOrMember ? <button type="button" className="hover:text-foreground hover:underline" onClick={() => handleTabChange('projects')}>{organization.childProjectCount} {organization.childProjectCount === 1 ? 'workspace' : 'workspaces'}</button> : <>{organization.childProjectCount} {organization.childProjectCount === 1 ? 'workspace' : 'workspaces'}</>}</span> : null}
            tabBadges={tabBadges}
            compactChip={organization ? (activeSprintName ? <span className="nb-status shrink-0" data-status="active">{activeSprintName}</span> : null) : undefined}
            compactPrefix={parentOrg ? <OrgCompactMark parentOrg={parentOrg} /> : null}
            compactMenuItems={canStartNew ? <OrgNewItems onNew={startNew} prefix="New " /> : null}
            actionsStart={organization ? <>{canStartNew ? <OrgNewMenu onNew={startNew} /> : null}{!isOwnerOrMember && isWorkspacePubliclyReadableVisibility(project.visibility) && project.status !== 'archived' && !organization.suspended && !organization.deletionScheduledAt ? <OrgVisitorActions orgId={project.id} href={canonicalProjectHref} joinMode={organization.joinMode} requestPending={organization.viewerRequestPending} loggedIn={Boolean(currentUserId)} /> : null}</> : null}
            actionsEnd={currentUserId && !isOwner ? (
                <HeaderReportMenu targetId={project.id} noun={organization ? 'organization' : 'workspace'}>
                    {/* A member of a team inside an organization can ask to move, privately (Blocking B48). */}
                    {parentOrg && isMember ? <DropdownMenuItem onSelect={() => void askToChangeTeam(project.id)}>Ask to change team</DropdownMenuItem> : null}
                </HeaderReportMenu>
            ) : null}
            // Decision 22: inside an organization, Follow is only for outsiders of a public workspace, and the counts go when it isn't public.
            showFollow={!organization && !parentOrg ? true : !isOwnerOrMember && isWorkspacePubliclyReadableVisibility(project.visibility)}
            showStats={!parentOrg || isWorkspacePubliclyReadableVisibility(project.visibility)}
            titleBadge={organization?.verified ? <VerifiedMark label={organization.verifiedLabel} size={18} className="ml-2" /> : null} onTabHover={handleTabHover} members={allMembers} loadingMembers={loadingMembers} stageLabel={lifecycleStageNames[optimisticStageIndex] ?? null} stageIndex={optimisticStageIndex} stageCount={lifecycleStageNames.length} applicationLabel={applicationHeaderLabel} openRolesCount={rolesWithFilled.filter((role: any) => (role?.count || 0) - (role?.filled || 0) > 0).length}>
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
                    <TabErrorBoundary tabName="Overview">
                        {/* Orgs get their own Dashboard (report §27); child projects add the org line (§27.5). */}
                        {isOrganization ? <OrgDashboard orgId={project.id} orgSlug={project.slug ?? null} orgType={organization?.type ?? null} started={orgStarted?.dashboard} /> : <>
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
                        <OrgAboutTab project={projectWithLiveStats} isCreator={isOwner} onEdit={handleEdit} memberRole={isOwner ? 'owner' : (currentProjectRole as 'admin' | 'member' | 'viewer' | null) ?? null} visitorActions={organization && !isOwnerOrMember && isWorkspacePubliclyReadableVisibility(project.visibility) && project.status !== 'archived' && !organization.suspended && !organization.deletionScheduledAt ? <OrgVisitorActions orgId={project.id} href={canonicalProjectHref} joinMode={organization.joinMode} requestPending={organization.viewerRequestPending} loggedIn={Boolean(currentUserId)} /> : undefined} />
                    </TabErrorBoundary>
                </div>
            )}

            {isOrganization && isOwnerOrMember && activeTab === 'projects' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Workspaces">
                        <OrgWorkspacesTab orgId={project.id} orgSlug={project.slug} started={orgStarted?.workspaces} />
                    </TabErrorBoundary>
                </div>
            )}

            {isOrganization && canManageProjectSettings && activeTab === 'members' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Members">
                        <OrgMembersTab orgId={project.id} roleNames={organization?.roleNames} started={orgStarted?.members} />
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'readme' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Documents" fillContainer>
                        <DocTab projectId={project.id} project={projectWithLiveStats} />
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'updates' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Updates">
                        <UpdatesTab isOrganization={isOrganization} isChild={Boolean(parentOrg)} projectId={project.id} projectSlug={project.slug || project.id} projectName={project.title} currentUserId={currentUserId} currentUserName={currentUserName} currentUserAvatarUrl={currentUserAvatarUrl} canCreateUpdates={canCreateUpdates} isMember={isOwnerOrMember} canManageUpdates={canManageUpdates} focusComposer={newIntent === 'announcement'} onComposerFocused={() => setNewIntent(null)} initialUpdateId={searchParams?.get('updateId') || null} initialCommentId={searchParams?.get('commentId') || null} />
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'sprints' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Sprints">
                        <div className="space-y-6">
                            <Suspense fallback={<SkeletonSprints />}>
                                <SprintPlanning projectId={project.id} projectSlug={project.slug || project.id} projectName={project.title} projectKey={project.key} isOwner={isOwner} isOwnerOrMember={isOwnerOrMember} viewingAsAdmin={isInheritedAdmin} initialSprintData={initialSprintData} startCreate={newIntent === 'sprint'} onCreateStarted={() => setNewIntent(null)} />
                            </Suspense>
                        </div>
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'tasks' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Tasks">
                        {/* One board (problem 3): assignments are cards on it. In child projects, the org's group copies (§16.6). */}
                        {parentOrg ? <GroupCopiesPanel projectId={project.id} onBoardChanged={() => refreshProjectData('tasks')} /> : null}
                        <TasksTab projectId={project.id} projectSlug={project.slug || project.id} projectName={project.title} currentUserId={currentUserId || undefined} currentUserName={currentUserName} currentUserAvatarUrl={currentUserAvatarUrl} isOwner={isOwner} canEditTasks={canEditTasks} isProjectMember={isOwnerOrMember} reviewsGroupWork={isInheritedAdmin} canManageFiles={canManageFiles} canManageWorkflow={canManageProjectSettings} isChildProject={Boolean(parentOrg)} orgId={isOrganization ? project.id : null} initialTasks={tasks} started={tasksStarted} startCreate={newIntent === 'task' || newIntent === 'assignment'} startCreateKind={newIntent === 'assignment' ? 'assignment' : 'task'} onCreateStarted={() => setNewIntent(null)} orgTimeZone={organization?.timeZone ?? null} members={allMembers} sprints={sprints} initialOpenTaskId={initialTaskDrawerId ?? myWorkInitialTaskId} initialPanelTab={initialTaskPanelTab} initialCommentId={searchParams?.get('commentId')} initialFileId={searchParams?.get('fileId')} onInitialTaskOpened={myWorkInitialTaskId ? consumeMyWorkTaskHandoff : undefined} />
                    </TabErrorBoundary>
                </div>
            )}

            {activeTab === 'files' && (
                <div className="w-full h-full min-h-0">
                    {filesTabContent}
                </div>
            )}

            {(canManageProjectSettings || isInheritedAdmin || (isOrganization && isOwnerOrMember)) && activeTab === 'settings' && (
                <div className="w-full h-full min-h-0">
                    <TabErrorBoundary tabName="Settings">
                        <WorkspaceSettingsTab projectId={project.id} project={projectWithLiveStats} onProjectUpdated={handleProjectSettingsUpdated} isProjectOwner={isOwner} actorRole={currentProjectRole} members={allMembers} loadingMembers={loadingMembers} />
                    </TabErrorBoundary>
                </div>
            )}

            {organization && canManageProjectSettings ? (
                <OrgInviteDialog orgId={project.id} orgHandle={project.slug ?? null} title={project.title} open={isOrgInviteOpen} onOpenChange={setIsOrgInviteOpen} />
            ) : null}

            {isOnboardingOpen ? (
                <WorkspaceOnboardingModal
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

            {isEditModalOpen ? <EditWorkspaceModal project={extendedProject} isOpen={isEditModalOpen} onClose={() => setIsEditModalOpen(false)} onSaved={() => refreshProjectData()} /> : null}

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
        </WorkspaceLayout>
        </PlainContentHeadings>
    );
}
