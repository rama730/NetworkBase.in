'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProfilePageData, ProfilePrivacyRelationship, ProfileTabKey } from './types'
import type { ProfileCollaborationSummary, ProfileInviteProjectOption } from '@/lib/profile/collaboration'
import { ProfileShell } from './ProfileShell'
import { ProfileTabs } from './ProfileTabs'
import { toast } from 'sonner';
import { useAuth } from '@/hooks/use-auth';
import { invalidatePrivacyDependents } from '@/lib/privacy/client-invalidation';
import type { ConnectionState } from './types';
import { logger } from '@/lib/logger';
import { applyOptimisticUpdate as applyProfileOptimisticUpdate } from '@/lib/profile/normalization';
import { queryKeys } from '@/lib/query-keys';

// Keep the first content card synchronous. The action-heavy header and secondary
// rail cards remain server-rendered, but live in separate client chunks so every
// profile navigation does not synchronously evaluate their menus and controls.
import { AboutCard } from './sections/AboutCard'
import { ComponentErrorBoundary } from '@/components/ui/ComponentErrorBoundary'
import { Skeleton } from '@/components/ui/skeleton'
import { messageUserInWindow } from '@/components/messages/message-user'
import { profileHref } from '@/lib/routing/identifiers'

const ProfileHeader = dynamic(
    () => import('./ProfileHeader').then((module) => module.ProfileHeader),
    {
        loading: () => (
            <div aria-hidden="true" className="rounded-lg border border-border bg-card p-6 shadow-none">
                <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
                    <div className="flex gap-4">
                        <Skeleton className="size-[72px] shrink-0 rounded-[4px]" />
                        <div className="min-w-0 flex-1 space-y-2.5 pt-0.5">
                            <div className="flex flex-wrap items-center gap-2">
                                <Skeleton className="h-7 w-48 rounded-[4px]" />
                                <Skeleton className="h-4 w-24 rounded-[3px]" />
                            </div>
                            <Skeleton className="h-4 w-80 max-w-full rounded-[3px]" />
                            <div className="flex gap-3 pt-1">
                                <Skeleton className="h-3.5 w-24 rounded-[3px]" />
                                <Skeleton className="h-3.5 w-28 rounded-[3px]" />
                            </div>
                        </div>
                    </div>
                    <Skeleton className="h-9 w-24 rounded-md" />
                </div>
            </div>
        ),
    },
);
const ProfileRightRail = dynamic(
    () => import('./ProfileRightRail').then((module) => module.ProfileRightRail),
    {
        loading: () => (
            <div aria-hidden="true" className="space-y-6">
                <div className="rounded-lg border border-border bg-card p-5 space-y-4">
                    <Skeleton className="h-4 w-28 rounded-[3px]" />
                    <div className="flex flex-wrap gap-1.5">
                        {[1, 2, 3, 4, 5].map((i) => (
                            <Skeleton key={i} className="h-6 w-16 rounded-[4px]" />
                        ))}
                    </div>
                </div>
                <div className="rounded-lg border border-border bg-card p-5 space-y-3">
                    <Skeleton className="h-4 w-24 rounded-[3px]" />
                    <Skeleton className="h-10 w-full rounded-md" />
                </div>
            </div>
        ),
    },
);
const OpenToRolesCard = dynamic(
    () => import('./sections/OpenToRolesCard').then((module) => module.OpenToRolesCard),
    {
        loading: () => (
            <div aria-hidden="true" className="rounded-lg border border-border bg-card p-5 space-y-3">
                <Skeleton className="h-5 w-32 rounded-[3px]" />
                <Skeleton className="h-4 w-3/4 rounded-[3px]" />
                <div className="flex gap-2 pt-1">
                    <Skeleton className="h-6 w-20 rounded-[4px]" />
                    <Skeleton className="h-6 w-24 rounded-[4px]" />
                </div>
            </div>
        ),
    },
);

const ProjectContributionsCard = dynamic(
    () => import('./sections/ProjectContributionsCard').then((module) => module.ProjectContributionsCard),
    {
        loading: () => (
            <div aria-hidden="true" className="rounded-lg border border-border bg-card p-5 space-y-3">
                <Skeleton className="h-5 w-40 rounded-[3px]" />
                <Skeleton className="h-20 w-full rounded-lg border border-border" />
            </div>
        ),
    },
);
const ProjectsGridCard = dynamic(
    () => import('./sections/ProjectsGridCard').then((module) => module.ProjectsGridCard),
    {
        loading: () => (
            <div aria-hidden="true" className="space-y-4">
                <Skeleton className="h-6 w-28 rounded-[3px]" />
                <div className="space-y-4">
                    <Skeleton className="h-32 w-full rounded-lg border border-border" />
                    <Skeleton className="h-32 w-full rounded-lg border border-border" />
                </div>
            </div>
        ),
    },
);

type EditProfileModalComponent = typeof import('@/components/profile/edit/EditProfileModal')['EditProfileModal'];
type UserConnectionsModalComponent = typeof import('@/components/profile/v2/UserConnectionsModal')['UserConnectionsModal'];
type ProfileInviteModalComponent = typeof import('./ProfileInviteModal')['default'];
type ApplyRoleModalComponent = typeof import('@/components/projects/ApplyRoleModal')['default'];

interface ProfileClientProps extends Omit<ProfilePageData, 'stats'> {
    stats?: any;
    collaborationSummary?: ProfileCollaborationSummary;
    initialOpenRolesProjects?: any[];
}

type EditSection = "general" | "experience" | "skills" | "social";

function parseProfileTab(value: string | null): ProfileTabKey {
    return value === 'portfolio' ? 'portfolio' : 'overview';
}

function connectionStateFromRelationship(relationship: ProfilePrivacyRelationship): ConnectionState {
    if (relationship.blockedByViewer || relationship.blockedByTarget) return 'blocked';
    if (relationship.connectionState === 'connected') return 'accepted';
    if (relationship.connectionState === 'pending_incoming') return 'pending_incoming';
    if (relationship.connectionState === 'pending_outgoing') return 'pending_outgoing';
    return 'none';
}

/**
 * These actions report failure as `{ success: false }`; a toast.promise needs a rejection to show the
 * error (and the caller's catch to roll the button back).
 */
function failed<T extends { success: boolean; error?: string }>(request: Promise<T>): Promise<T> {
    return request.then((result) => {
        if (!result.success) throw new Error(result.error || "Something went wrong. Try again.");
        return result;
    });
}

function connectionRequestKey() {
    return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
        ? `profile:${crypto.randomUUID()}`
        : `profile:${Date.now()}`;
}

type ApiEnvelope<T> = {
    success?: boolean
    data?: T
    error?: string
    message?: string
}

const EMPTY_COLLABORATION_SUMMARY: ProfileCollaborationSummary = {
    version: 1,
    generatedAt: '',
    projects: [],
    contributions: [],
    stats: {
        projectsCount: 0,
        visibleProjectsCount: 0,
        contributionCount: 0,
    },
}

async function readApiData<T>(response: Response): Promise<T> {
    const body = await response.json().catch(() => null) as ApiEnvelope<T> | null
    if (!response.ok || body?.success === false) {
        throw new Error(body?.error || body?.message || 'Request failed')
    }
    return (body?.data ?? body) as T
}

async function fetchProfileProjects(profileId: string) {
    const response = await fetch(`/api/v1/profiles/${encodeURIComponent(profileId)}/projects?limit=24`, {
        headers: { accept: 'application/json' },
        credentials: 'include',
    })
    return readApiData<{ projects: any[]; total: number; hasMore: boolean }>(response)
}

async function fetchInviteOptions(profileId: string) {
    const response = await fetch(`/api/v1/profiles/${encodeURIComponent(profileId)}/project-invite-options`, {
        headers: { accept: 'application/json' },
        credentials: 'include',
    })
    return readApiData<{ projects: ProfileInviteProjectOption[] }>(response)
}

async function fetchCollaborationSummary(profileId: string) {
    const response = await fetch(`/api/v1/profiles/${encodeURIComponent(profileId)}/collaboration-summary`, {
        headers: { accept: 'application/json' },
        credentials: 'include',
    })
    return readApiData<{ summary: ProfileCollaborationSummary }>(response)
}

export function ProfileV2Client({
    profile,
    stats: initialStats,
    isOwner,
    currentUser,
    connectionStatus,
    privacyRelationship: initialPrivacyRelationship,
    lockedShell: initialLockedShell = false,
    collaborationSummary: initialCollaborationSummary = EMPTY_COLLABORATION_SUMMARY,
    initialOpenRolesProjects = [],
}: ProfileClientProps) {
    const { user: authUser } = useAuth()
    const viewerUser = authUser ?? currentUser
    const router = useRouter()
    const pathname = usePathname()
    const searchParams = useSearchParams()
    const queryClient = useQueryClient()
    const searchParamsString = searchParams.toString()
    const urlTab = parseProfileTab(searchParams.get('tab'))

    const [activeTab, setActiveTab] = useState<ProfileTabKey>(urlTab)
    const [liveProfile, setLiveProfile] = useState(profile)
    const [isEditModalOpen, setIsEditModalOpen] = useState(false)
    const [EditProfileModal, setEditProfileModal] = useState<EditProfileModalComponent | null>(null)
    const [UserConnectionsModal, setUserConnectionsModal] = useState<UserConnectionsModalComponent | null>(null)
    const [ProfileInviteModal, setProfileInviteModal] = useState<ProfileInviteModalComponent | null>(null)
    const [ApplyRoleModal, setApplyRoleModal] = useState<ApplyRoleModalComponent | null>(null)
    const [editSection, setEditSection] = useState<EditSection>('general')
    const [showConnectionsModal, setShowConnectionsModal] = useState(false)
    const [inviteOpen, setInviteOpen] = useState(false)
    const [isApplyModalOpen, setIsApplyModalOpen] = useState(false)
    const openRolesProjects = initialOpenRolesProjects
    const [status, setStatus] = useState<ConnectionState>(connectionStatus)
    const [privacyRelationship, setPrivacyRelationship] = useState(initialPrivacyRelationship)
    const [lockedShell, setLockedShell] = useState(initialLockedShell)
    const [isBlocking, setIsBlocking] = useState(false)
    const [viewerMutualCount, setViewerMutualCount] = useState((initialStats as any)?.mutualCount ?? 0)
    const [collaborationSummary, setCollaborationSummary] = useState<ProfileCollaborationSummary>(
        initialCollaborationSummary || EMPTY_COLLABORATION_SUMMARY,
    )
    const initialSummary = collaborationSummary || EMPTY_COLLABORATION_SUMMARY
    const overviewProjects = initialSummary.projects ?? []

    useEffect(() => {
        setStatus(connectionStatus)
        setLiveProfile(profile)
        setPrivacyRelationship(initialPrivacyRelationship)
        setLockedShell(initialLockedShell)
        setViewerMutualCount((initialStats as any)?.mutualCount ?? 0)
        setCollaborationSummary(initialCollaborationSummary || EMPTY_COLLABORATION_SUMMARY)
    }, [connectionStatus, initialCollaborationSummary, initialLockedShell, initialPrivacyRelationship, initialStats, profile])

    useEffect(() => {
        setActiveTab(urlTab)
    }, [urlTab])

    const [isLoading, setIsLoading] = useState(false);

    const safeProfile = liveProfile as any
    const portfolioQuery = useQuery({
        queryKey: profile?.id ? queryKeys.profile.projects(profile.id) : queryKeys.profile.projects('unknown'),
        queryFn: () => fetchProfileProjects(profile.id),
        enabled: Boolean(profile?.id && !lockedShell && (activeTab === 'portfolio' || isEditModalOpen)),
        initialData: {
            projects: overviewProjects,
            total: Number(initialSummary.stats?.visibleProjectsCount ?? overviewProjects.length),
            hasMore: Number(initialSummary.stats?.visibleProjectsCount ?? overviewProjects.length) > overviewProjects.length,
        },
        initialDataUpdatedAt: 0,
        staleTime: 60_000,
        refetchOnWindowFocus: false,
    })
    const inviteOptionsQuery = useQuery({
        queryKey: profile?.id ? queryKeys.profile.inviteOptions(profile.id) : queryKeys.profile.inviteOptions('unknown'),
        queryFn: () => fetchInviteOptions(profile.id),
        enabled: Boolean(profile?.id && inviteOpen && viewerUser && !isOwner),
        staleTime: 30_000,
        refetchOnWindowFocus: false,
    })
    const portfolioProjects = portfolioQuery.data?.projects ?? overviewProjects
    const collaborationContributions = initialSummary.contributions ?? []
    const projectOptionsForEditing = portfolioProjects.length ? portfolioProjects : overviewProjects
    const safeStats = useMemo(
        () => ({
            ...(initialStats || {}),
            projectsCount: Number(initialStats?.projectsCount ?? initialSummary.stats?.projectsCount ?? overviewProjects.length ?? 0),
            mutualCount: viewerMutualCount,
        }),
        [initialStats, initialSummary.stats?.projectsCount, overviewProjects.length, viewerMutualCount],
    );

    const prefetchPortfolioProjects = useCallback(() => {
        if (!profile?.id || lockedShell) return
        void queryClient.prefetchQuery({
            queryKey: queryKeys.profile.projects(profile.id),
            queryFn: () => fetchProfileProjects(profile.id),
            staleTime: 60_000,
        })
    }, [lockedShell, profile?.id, queryClient])

    const prefetchInviteOptions = useCallback(() => {
        if (!profile?.id || !viewerUser || isOwner) return
        void queryClient.prefetchQuery({
            queryKey: queryKeys.profile.inviteOptions(profile.id),
            queryFn: () => fetchInviteOptions(profile.id),
            staleTime: 30_000,
        })
    }, [isOwner, profile?.id, queryClient, viewerUser])

    const prefetchProjectHref = useCallback((href: string) => {
        if (!href || !href.startsWith('/')) return
        router.prefetch(href)
    }, [router])

    const refreshCollaborationSummary = useCallback(async () => {
        if (!profile?.id) return
        const result = await queryClient.fetchQuery({
            queryKey: queryKeys.profile.collaborationSummary(profile.id),
            queryFn: () => fetchCollaborationSummary(profile.id),
            staleTime: 5_000,
        })
        setCollaborationSummary(result.summary)
        await queryClient.invalidateQueries({ queryKey: queryKeys.profile.byTarget(profile.username || profile.id) })
    }, [profile?.id, profile?.username, queryClient])



    const loadEditProfileModal = useCallback(async () => {
        if (EditProfileModal) return
        const mod = await import('@/components/profile/edit/EditProfileModal')
        setEditProfileModal(() => mod.EditProfileModal)
    }, [EditProfileModal])

    const loadUserConnectionsModal = useCallback(async () => {
        if (UserConnectionsModal) return
        const mod = await import('@/components/profile/v2/UserConnectionsModal')
        setUserConnectionsModal(() => mod.UserConnectionsModal)
    }, [UserConnectionsModal])

    const loadProfileInviteModal = useCallback(async () => {
        if (ProfileInviteModal) return
        const mod = await import('./ProfileInviteModal')
        setProfileInviteModal(() => mod.default)
    }, [ProfileInviteModal])

    const loadApplyRoleModal = useCallback(async () => {
        if (ApplyRoleModal) return
        const mod = await import('@/components/projects/ApplyRoleModal')
        setApplyRoleModal(() => mod.default)
    }, [ApplyRoleModal])

    const openEditModal = useCallback((section: EditSection = 'general') => {
        setEditSection(section)
        if (section === 'experience') {
            prefetchPortfolioProjects()
        }
        setIsEditModalOpen(true)
        void loadEditProfileModal()
    }, [loadEditProfileModal, prefetchPortfolioProjects])

    const handleTabChange = useCallback(
        (next: ProfileTabKey) => {
            if (next === 'portfolio') {
                prefetchPortfolioProjects()
            }
            setActiveTab(next)
            const params = new URLSearchParams(searchParamsString)
            if (next === 'overview') {
                params.delete('tab')
            } else {
                params.set('tab', next)
            }
            const query = params.toString()
            router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false })
        },
        [pathname, prefetchPortfolioProjects, router, searchParamsString],
    )

    const applyOptimisticProfileUpdate = useCallback((updates: Record<string, unknown>) => {
        setLiveProfile((current) => applyProfileOptimisticUpdate(current || {}, updates) as typeof current)
    }, [])

    const resolveConnectionId = async () => {
        const { checkConnectionStatus } = await import('@/app/actions/connections');
        const result = await checkConnectionStatus(profile.id);
        if (!result.success || !result.connectionId) {
            throw new Error(result.error || "Connection record not found");
        }
        return result.connectionId;
    };

    const refreshViewerOverlay = useCallback(async () => {
        if (!viewerUser || isOwner || !profile?.id) return;
        const { getProfileViewerOverlayAction } = await import('@/app/actions/profile');
        const result = await getProfileViewerOverlayAction(profile.id);
        if (!result.success) return;
        setPrivacyRelationship(result.privacyRelationship);
        setLockedShell(result.lockedShell);
        setViewerMutualCount(result.mutualCount);
        setStatus(connectionStateFromRelationship(result.privacyRelationship));
    }, [isOwner, profile?.id, viewerUser]);

    const handleConnectPrimary = async () => {
        if (!viewerUser || !profile) return;
        const prevStatus = status;
        setIsLoading(true);
        try {
            if (status === 'none' || status === 'rejected') {
                setStatus('pending_outgoing');
                const { sendConnectionRequest } = await import('@/app/actions/connections');
                await toast.promise(failed(sendConnectionRequest(profile.id, connectionRequestKey())), {
                    loading: 'Sending request...',
                    success: 'Connection request sent',
                    error: (err) => err instanceof Error ? err.message : 'Failed to send request'
                }).unwrap();
                await refreshViewerOverlay();
            } else if (status === 'pending_incoming') {
                setStatus('accepted');
                const connectionId = await resolveConnectionId();
                const { acceptConnectionRequest } = await import('@/app/actions/connections');
                await toast.promise(failed(acceptConnectionRequest(connectionId, { idempotencyKey: connectionId })), {
                    loading: 'Accepting request...',
                    success: 'Connection accepted',
                    error: (err) => err instanceof Error ? err.message : 'Failed to accept request'
                }).unwrap();
                await refreshViewerOverlay();
            }
        } catch (e) {
            setStatus(prevStatus);
            logger.error('[ProfileV2Client] primary connection action failed', {
                module: 'profile',
                profileId: profile.id,
                viewerUserId: viewerUser?.id ?? null,
                error: e instanceof Error ? e.message : String(e),
                stack: e instanceof Error ? e.stack : undefined,
            });
        } finally {
            setIsLoading(false);
        }
    };

    const handleConnectSecondary = async () => {
        if (!viewerUser || !profile) return;
        const prevStatus = status;
        setIsLoading(true);
        try {
            if (status === 'pending_outgoing') {
                setStatus('none');
                const connectionId = await resolveConnectionId();
                const { cancelConnectionRequest } = await import('@/app/actions/connections');
                await toast.promise(failed(cancelConnectionRequest(connectionId)), {
                    loading: 'Cancelling request...',
                    success: 'Request cancelled',
                    error: (err) => err instanceof Error ? err.message : 'Failed to cancel request'
                }).unwrap();
                await refreshViewerOverlay();
            } else if (status === 'pending_incoming') {
                setStatus('none');
                const connectionId = await resolveConnectionId();
                const { rejectConnectionRequest } = await import('@/app/actions/connections');
                await toast.promise(failed(rejectConnectionRequest(connectionId)), {
                    loading: 'Declining request...',
                    success: 'Request declined',
                    error: (err) => err instanceof Error ? err.message : 'Failed to decline request'
                }).unwrap();
                await refreshViewerOverlay();
            } else if (status === 'accepted') {
                setStatus('none');
                const connectionId = await resolveConnectionId();
                const { removeConnection } = await import('@/app/actions/connections');
                await toast.promise(failed(removeConnection(connectionId)), {
                    loading: 'Disconnecting...',
                    success: 'Disconnected',
                    error: (err) => err instanceof Error ? err.message : 'Failed to disconnect'
                }).unwrap();
                await refreshViewerOverlay();
            }
        } catch (e) {
            setStatus(prevStatus);
            logger.error('[ProfileV2Client] secondary connection action failed', {
                module: 'profile',
                profileId: profile.id,
                viewerUserId: viewerUser?.id ?? null,
                error: e instanceof Error ? e.message : String(e),
                stack: e instanceof Error ? e.stack : undefined,
            });
        } finally {
            setIsLoading(false);
        }
    };

    const renderMainContent = () => {
        if (lockedShell) {
            return null
        }
        switch (activeTab) {
            case 'overview':
                return (
                    <div id="profile-panel-overview" role="tabpanel" aria-labelledby="profile-tab-overview">
                        <ComponentErrorBoundary fallbackMessage="Failed to load about section.">
                            <AboutCard
                                profile={safeProfile}
                                isOwner={isOwner}
                                onEdit={isOwner ? () => openEditModal('general') : undefined}
                            />
                        </ComponentErrorBoundary>
                    </div>
                )
            case 'portfolio':
                const visibleProjectsCount = Number(portfolioQuery.data?.total ?? safeStats.projectsCount ?? portfolioProjects.length ?? 0)
                const portfolioDescription = visibleProjectsCount > portfolioProjects.length
                    ? `Showing ${portfolioProjects.length} of ${visibleProjectsCount} visible projects`
                    : `Showcasing ${visibleProjectsCount} visible projects`
                return (
                    <div
                        id="profile-panel-portfolio"
                        role="tabpanel"
                        aria-labelledby="profile-tab-portfolio"
                    >
                        <div className="space-y-4">
                            {portfolioQuery.isError && (
                                <div role="alert" className="nb-compact flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--status-danger)] bg-[var(--status-danger-soft)] px-4 py-3">
                                    <span>Some portfolio projects could not be refreshed. Showing the last available projects.</span>
                                    <button type="button" className="nb-ui-label text-primary hover:underline" onClick={() => void portfolioQuery.refetch()}>Try again</button>
                                </div>
                            )}
                            <ProjectsGridCard
                                projects={portfolioProjects}
                                title="Portfolio"
                                description={portfolioDescription}
                                isOwner={isOwner}
                                isLoading={portfolioQuery.isLoading && portfolioProjects.length === 0}
                                onProjectIntent={prefetchProjectHref}
                            />
                        </div>
                    </div>
                )
            default:
                return null
        }
    }

    const renderMainBottom = () => {
        if (lockedShell || (activeTab !== 'overview' && activeTab !== 'portfolio')) return null
        return (
            <ComponentErrorBoundary fallbackMessage="Failed to load project contributions.">
                <ProjectContributionsCard
                    contributions={collaborationContributions}
                    isOwner={isOwner}
                    onAdd={isOwner ? () => openEditModal('experience') : undefined}
                    projects={projectOptionsForEditing}
                    onProjectIntent={prefetchProjectHref}
                />
            </ComponentErrorBoundary>
        )
    }

    const handleToggleBlock = async () => {
        if (!viewerUser || !profile?.id || privacyRelationship.blockedByTarget) return
        setIsBlocking(true)
        try {
            const isBlocked = privacyRelationship.blockedByViewer
            const res = await fetch(isBlocked ? `/api/v1/privacy/blocks/${profile.id}` : '/api/v1/privacy/blocks', {
                method: isBlocked ? 'DELETE' : 'POST',
                headers: isBlocked ? undefined : { 'Content-Type': 'application/json' },
                body: isBlocked ? undefined : JSON.stringify({ userId: profile.id }),
            })
            const json = await res.json().catch(() => null)
            if (!res.ok || json?.success === false) {
                throw new Error((typeof json?.error === 'string' && json.error) || 'Failed to update block state')
            }

            if (isBlocked) {
                const nextConnectionState = 'none'
                const nextVisibilityReason = profile.visibility === 'connections'
                    ? 'connections_only'
                    : profile.visibility === 'private'
                        ? 'private'
                        : 'public'
                const nextCanViewProfile = profile.visibility === 'public'
                const nextCanSendMessage = profile.messagePrivacy === 'everyone'

                setPrivacyRelationship((current) => ({
                    ...current,
                    blockedByViewer: false,
                    blockedByTarget: false,
                    connectionState: nextConnectionState,
                    canSendConnectionRequest: true,
                    canSendMessage: nextCanSendMessage,
                    canViewProfile: nextCanViewProfile,
                    visibilityReason: nextVisibilityReason,
                }))
                setStatus('none')
                toast.success('Account unblocked')
            } else {
                setPrivacyRelationship((current) => ({
                    ...current,
                    blockedByViewer: true,
                    blockedByTarget: false,
                    connectionState: 'blocked_by_viewer',
                    canSendConnectionRequest: false,
                    canSendMessage: false,
                    canViewProfile: false,
                    visibilityReason: 'blocked',
                }))
                setLockedShell(true)
                setStatus('blocked')
                toast.success('Account blocked')
            }
            await invalidatePrivacyDependents(queryClient, profile?.username || profile?.id || null)
            await refreshViewerOverlay()
            router.refresh()
        } catch (error) {
            logger.error('[ProfileV2Client] block toggle failed', {
                module: 'profile',
                profileId: profile.id,
                viewerUserId: viewerUser?.id ?? null,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
            })
            toast.error(error instanceof Error ? error.message : 'Failed to update block state')
        } finally {
            setIsBlocking(false)
        }
    }

    const inviteOptions = inviteOptionsQuery.data?.projects ?? []
    const handleOpenInvite = useCallback(() => {
        if (!viewerUser || isOwner) return
        prefetchInviteOptions()
        setInviteOpen(true)
        void loadProfileInviteModal()
    }, [isOwner, loadProfileInviteModal, prefetchInviteOptions, viewerUser])

    const handleOpenConnections = useCallback(() => {
        setShowConnectionsModal(true)
        void loadUserConnectionsModal()
    }, [loadUserConnectionsModal])

    const handleOpenProjects = useCallback(() => {
        handleTabChange('portfolio')
    }, [handleTabChange])

    const handleOpenApplyModal = useCallback(() => {
        setIsApplyModalOpen(true)
        void loadApplyRoleModal()
    }, [loadApplyRoleModal])

    const handleShareProfile = useCallback(async () => {
        const canonicalPath = profileHref(safeProfile)
        const shareUrl = typeof window !== 'undefined' ? `${window.location.origin}${canonicalPath}` : canonicalPath
        const shareData: ShareData = {
            title: safeProfile.fullName || safeProfile.username || 'NetworkBase profile',
            text: safeProfile.headline || undefined,
            url: shareUrl,
        }
        try {
            if (typeof navigator.share === 'function') {
                await navigator.share(shareData)
                return
            }
            await navigator.clipboard.writeText(shareUrl)
            toast.success('Profile link copied')
        } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') return
            toast.error('Could not share this profile')
        }
    }, [safeProfile])



    return (
        <>
            <ProfileShell
                header={
                    <ProfileHeader
                            profile={safeProfile}
                            viewerId={viewerUser?.id ?? null}
                            isOwner={isOwner}
                            isAuthenticated={!!viewerUser}
                            connectionState={status}
                        privacyRelationship={privacyRelationship}
                        lockedShell={lockedShell}
                        isLoadingConnection={isLoading}
                        isBlocking={isBlocking}
                        onEdit={() => openEditModal('general')}
                        onShare={handleShareProfile}
                        onAvailabilityEdit={() => openEditModal('skills')}
                        onConnectionsClick={handleOpenConnections}
                        onProjectsClick={handleOpenProjects}
                        onConnectPrimary={handleConnectPrimary}
                        onConnectSecondary={handleConnectSecondary}
                        onMessage={() => { if (!messageUserInWindow(safeProfile.id)) router.push(`/messages?userId=${safeProfile.id}`); }}
                        onToggleBlock={handleToggleBlock}
                        mutualCount={safeStats.mutualCount}
                        stats={safeStats}
                    />
                }
                tabs={lockedShell ? null : (
                    <ProfileTabs
                        value={activeTab}
                        onChange={handleTabChange}
                        onIntent={(next) => {
                            if (next === 'portfolio') prefetchPortfolioProjects()
                        }}
                    />
                )}
                main={renderMainContent()}
                mainBottom={renderMainBottom()}
                highlights={lockedShell ? null : (
                    <ComponentErrorBoundary fallbackMessage="Failed to load role preferences.">
                        <OpenToRolesCard
                            openTo={safeProfile.openTo}
                            experienceLevel={safeProfile.experienceLevel}
                            hoursPerWeek={safeProfile.hoursPerWeek}
                            isOwner={isOwner}
                            onEdit={isOwner ? () => openEditModal('skills') : undefined}
                            onInvite={viewerUser && !isOwner ? handleOpenInvite : undefined}
                            onInviteIntent={prefetchInviteOptions}
                            onApply={viewerUser && !isOwner ? handleOpenApplyModal : undefined}
                            hasOpenRoles={openRolesProjects.length > 0}
                        />
                    </ComponentErrorBoundary>
                )}
                rail={lockedShell ? null : (
                    <ProfileRightRail
                        profile={safeProfile}
                        isOwner={isOwner}
                        canMessage={Boolean(
                            viewerUser
                            && privacyRelationship.canSendMessage
                            && !privacyRelationship.blockedByViewer
                            && !privacyRelationship.blockedByTarget
                        )}
                        socialLinks={safeProfile.socialLinks || []}
                        onEditSection={openEditModal}
                    />
                )}
            />

            {isOwner && EditProfileModal && (
                <EditProfileModal
                    open={isEditModalOpen}
                    onOpenChange={setIsEditModalOpen}
                    profile={safeProfile}
                    contributions={collaborationContributions}
                    onOptimisticUpdate={applyOptimisticProfileUpdate}
                    initialSection={editSection}
                    onSaved={refreshCollaborationSummary}
                />
            )}

            {ProfileInviteModal && (
                <ProfileInviteModal
                    isOpen={inviteOpen}
                    onClose={() => setInviteOpen(false)}
                    profileId={profile.id}
                    profileName={safeProfile.fullName || safeProfile.username || 'User'}
                    projects={inviteOptions}
                />
            )}

            {ApplyRoleModal && openRolesProjects.length > 0 && (
                <ApplyRoleModal
                    isOpen={isApplyModalOpen}
                    onClose={() => setIsApplyModalOpen(false)}
                    candidateProjects={openRolesProjects}
                />
            )}

            {UserConnectionsModal ? (
                <UserConnectionsModal
                    isOpen={showConnectionsModal}
                    onClose={() => setShowConnectionsModal(false)}
                    userId={safeProfile.id}
                    userName={safeProfile.fullName || safeProfile.username || 'User'}
                />
            ) : null}
        </>
    )
}
