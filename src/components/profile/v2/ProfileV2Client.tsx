'use client'

import { profileEditHref, type ProfileEditSection as EditProfileSection } from '@/lib/profile/edit-route'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProfilePageData, ProfilePrivacyRelationship, ProfileStats, ProfileTabKey } from './types'
import type { ProfileCollaborationSummary, ProfileInviteProjectOption } from '@/lib/profile/collaboration'
import { ProfileShell } from './ProfileShell'
import { ProfileTabs } from './ProfileTabs'
import { toast, feedbackError } from "@/lib/feedback";
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
import { profileSharePath } from '@/lib/sharing/presentation'
import { buildAuthPageHref } from '@/lib/auth/redirects'
const ResourceShareDialog = dynamic(() => import('@/components/sharing/ShareDialog').then(mod => mod.ShareDialog), { ssr: false })

import { ProfileHeader } from './ProfileHeader'
import { ProfileRightRail } from './ProfileRightRail'
import { OpenToRolesCard } from './sections/OpenToRolesCard'
import { ProjectContributionsCard } from './sections/ProjectContributionsCard'
import { ProjectsGridCard } from './sections/ProjectsGridCard'

type UserConnectionsModalComponent = typeof import('@/components/profile/v2/UserConnectionsModal')['UserConnectionsModal'];
type ProfileInviteModalComponent = typeof import('./ProfileInviteModal')['default'];
type ApplyRoleModalComponent = typeof import('@/components/projects/ApplyRoleModal')['default'];

interface ProfileClientProps extends Omit<ProfilePageData, 'stats'> {
    stats?: ProfileStats;
    collaborationSummary?: ProfileCollaborationSummary;
    initialOpenRolesProjects?: any[];
    /** The viewer has 20 pending applications: the picker says so instead of failing on submit. */
    applicationsCapReached?: boolean;
}

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
    applicationsCapReached = false,
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
    const [isSavingAvailability, setIsSavingAvailability] = useState(false)
    const availabilityInFlight = useRef(false)
    const [UserConnectionsModal, setUserConnectionsModal] = useState<UserConnectionsModalComponent | null>(null)
    const [ProfileInviteModal, setProfileInviteModal] = useState<ProfileInviteModalComponent | null>(null)
    const [ApplyRoleModal, setApplyRoleModal] = useState<ApplyRoleModalComponent | null>(null)
    const [showConnectionsModal, setShowConnectionsModal] = useState(false)
    const [inviteOpen, setInviteOpen] = useState(false)
    const [isApplyModalOpen, setIsApplyModalOpen] = useState(false)
    const openRolesProjects = initialOpenRolesProjects
    const [status, setStatus] = useState<ConnectionState>(connectionStatus)
    const [privacyRelationship, setPrivacyRelationship] = useState(initialPrivacyRelationship)
    const [lockedShell, setLockedShell] = useState(initialLockedShell)
    const [isBlocking, setIsBlocking] = useState(false)
    const [viewerMutualCount, setViewerMutualCount] = useState(initialStats?.mutualCount ?? 0)
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
        setViewerMutualCount(initialStats?.mutualCount ?? 0)
        setCollaborationSummary(initialCollaborationSummary || EMPTY_COLLABORATION_SUMMARY)
    }, [connectionStatus, initialCollaborationSummary, initialLockedShell, initialPrivacyRelationship, initialStats, profile])

    useEffect(() => {
        setActiveTab(urlTab)
    }, [urlTab])

    const [isLoading, setIsLoading] = useState(false);
    const [shareOpen, setShareOpen] = useState(false);
    const shareTrigger = useRef<HTMLElement | null>(null);
    useEffect(() => { setShareOpen(false); }, [profile.id]);

    const safeProfile = liveProfile as any
    const connectionCountQuery = useQuery({
        queryKey: queryKeys.profile.connectionCount(profile.id),
        queryFn: async () => {
            const { getProfileConnectionCountAction } = await import('@/app/actions/connections')
            const result = await getProfileConnectionCountAction(profile.id)
            if (!result.success) throw new Error(result.error)
            return result.connectionsCount
        },
        enabled: Boolean(profile.id && !lockedShell),
        initialData: Number(initialStats?.connectionsCount ?? profile.connectionsCount ?? 0),
        staleTime: 10_000,
    })
    useEffect(() => {
        queryClient.setQueryData(queryKeys.profile.connectionCount(profile.id), Number(initialStats?.connectionsCount ?? profile.connectionsCount ?? 0))
    }, [initialStats?.connectionsCount, profile.connectionsCount, profile.id, queryClient])
    const portfolioQuery = useQuery({
        queryKey: profile?.id ? queryKeys.profile.projects(profile.id) : queryKeys.profile.projects('unknown'),
        queryFn: () => fetchProfileProjects(profile.id),
        enabled: Boolean(profile?.id && !lockedShell && activeTab === 'portfolio'),
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
            connectionsCount: lockedShell ? 0 : connectionCountQuery.data,
            projectsCount: Number(initialStats?.projectsCount ?? initialSummary.stats?.projectsCount ?? overviewProjects.length ?? 0),
            mutualCount: viewerMutualCount,
        }),
        [connectionCountQuery.data, lockedShell, initialStats, initialSummary.stats?.projectsCount, overviewProjects.length, viewerMutualCount],
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

    const openEditPage = useCallback((section: EditProfileSection = 'general') => {
        if (!isOwner || availabilityInFlight.current) return
        router.push(profileEditHref(section, activeTab))
    }, [activeTab, isOwner, router])

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

    const toggleAvailability = async (checked: boolean) => {
        if (!isOwner || availabilityInFlight.current) return
        availabilityInFlight.current = true
        setIsSavingAvailability(true)
        const previous = safeProfile.openToCollaborate === true
        applyOptimisticProfileUpdate({ openToCollaborate: checked })
        try {
            const { updateProfileAction } = await import('@/app/actions/profile')
            const response = await updateProfileAction({
                openToCollaborate: checked,
                ...(safeProfile.updatedAt ? { expectedUpdatedAt: new Date(safeProfile.updatedAt).toISOString() } : {}),
            })
            if (!response.success) throw new Error(response.errorCode === 'PROFILE_CONFLICT'
                ? 'Your profile changed in another session. Refresh and try again.' : response.error)
            setLiveProfile(current => ({ ...current, openToCollaborate: checked, updatedAt: new Date(response.updatedAt) }))
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: queryKeys.profile.root() }),
                queryClient.invalidateQueries({ queryKey: queryKeys.connections.root() }),
                queryClient.invalidateQueries({ queryKey: queryKeys.globalSearch.networkRoot() }),
            ])
            toast.success(checked ? 'Open to collaboration' : 'Collaboration turned off')
        } catch (error) {
            applyOptimisticProfileUpdate({ openToCollaborate: previous })
            toast.error(feedbackError(error instanceof Error ? error.message : 'Could not update availability', "Could not update availability"))
            router.refresh()
        } finally {
            availabilityInFlight.current = false
            setIsSavingAvailability(false)
        }
    }

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
        await queryClient.invalidateQueries({ queryKey: queryKeys.profile.root() });
        router.refresh();
    }, [isOwner, profile?.id, queryClient, router, viewerUser]);

    const handleConnectPrimary = async () => {
        if (!profile) return;
        if (!viewerUser) { router.push(buildAuthPageHref('/login', profileSharePath(profile.username) || '/discover')); return; }
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
                                onEdit={isOwner ? () => openEditPage('general') : undefined}
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
                    profileId={profile.id}
                    isOwner={isOwner}
                    onAdd={isOwner ? () => openEditPage('experience') : undefined}
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
            toast.error(feedbackError(error instanceof Error ? error.message : 'Failed to update block state', "Failed to update block state"))
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
        if (applicationsCapReached) {
            toast.error('You have 20 pending applications. Withdraw one to apply.')
            return
        }
        setIsApplyModalOpen(true)
        void loadApplyRoleModal()
    }, [applicationsCapReached, loadApplyRoleModal])

    const handleShareProfile = useCallback((trigger?: HTMLElement) => { shareTrigger.current = trigger ?? null; setShareOpen(true); }, [])



    return (
        <>
            {shareOpen ? <ResourceShareDialog kind="profile" path={profileSharePath(safeProfile.username)} returnFocusElement={shareTrigger.current} onClose={() => setShareOpen(false)}
                ownerUsernameSetup={isOwner ? { profileId: safeProfile.id, updatedAt: safeProfile.updatedAt, onSaved: username => { applyOptimisticProfileUpdate({ username }); router.refresh(); } } : undefined} /> : null}
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
                        onEdit={() => openEditPage('general')}
                        onShare={handleShareProfile}
                        onAvailabilityToggle={(checked) => startTransition(() => { void toggleAvailability(checked) })}
                        isSavingAvailability={isSavingAvailability}
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
                            openToCollaborate={safeProfile.openToCollaborate}
                            customRoles={safeProfile.openToCustomRoles}
                            categories={safeProfile.preferredCategories}
                            experienceLevel={safeProfile.experienceLevel}
                            hoursPerWeek={safeProfile.hoursPerWeek}
                            isOwner={isOwner}
                            onEdit={isOwner ? () => openEditPage('opportunity') : undefined}
                            onInvite={viewerUser && !isOwner ? handleOpenInvite : undefined}
                            onInviteIntent={prefetchInviteOptions}
                            onApply={viewerUser && !isOwner ? handleOpenApplyModal : undefined}
                            hasOpenRoles={openRolesProjects.length > 0 || applicationsCapReached}
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
                        onEditSection={openEditPage}
                    />
                )}
            />

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
                    onSuccess={() => router.refresh()}
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
