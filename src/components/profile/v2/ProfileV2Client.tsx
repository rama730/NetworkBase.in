'use client'

import { profileEditHref, type ProfileEditSection as EditProfileSection } from '@/lib/profile/edit-route'
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import dynamic from 'next/dynamic'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import type { ProfilePageData, ProfilePrivacyRelationship, ProfileStats, ProfileTabKey } from './types'
import type { ProfileCollaborationSummary, ProfileInviteWorkspaceOption } from '@/lib/profile/collaboration'
import { ProfileShell } from './ProfileShell'
import { ProfileTabBar } from './ProfileTabBar'
import { SkillsStrip } from './SkillsStrip'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { Button } from '@/components/ui/button'
import { Clock, MessageSquare, Pencil, UserCheck, UserPlus } from 'lucide-react'
import { toast, feedbackError } from "@/lib/feedback";
import { useAuth } from '@/hooks/use-auth';
import { invalidatePrivacyDependents } from '@/lib/privacy/client-invalidation';
import type { ConnectionState } from './types';
import { logger } from '@/lib/logger';
import { applyOptimisticUpdate as applyProfileOptimisticUpdate } from '@/lib/profile/normalization';
import { queryKeys } from '@/lib/query-keys';
import { useRealtime } from '@/components/providers/RealtimeProvider';

// Keep the first content card synchronous. The action-heavy header and secondary
// rail cards remain server-rendered, but live in separate client chunks so every
// profile navigation does not synchronously evaluate their menus and controls.
import { AboutSection } from './sections/AboutSection'
import { ComponentErrorBoundary } from '@/components/ui/ComponentErrorBoundary'
import { Skeleton } from '@/components/ui/skeleton'
import { messageUserInWindow } from '@/components/messages/message-user'
import { profileSharePath } from '@/lib/sharing/presentation'
import { buildAuthPageHref } from '@/lib/auth/redirects'
const ResourceShareDialog = dynamic(() => import('@/components/sharing/ShareDialog').then(mod => mod.ShareDialog), { ssr: false })

import { ProfileBand } from './ProfileBand'
import { RELATIONSHIP_EVENT, useBlockFlow } from '@/components/privacy/BlockDialog'
import { ContributionTimeline } from './sections/ContributionTimeline'
import { ProfileFactsCard } from './sections/ProfileFactsCard'
import { WorkspacesGridCard } from './sections/WorkspacesGridCard'
import { profileDetailsRows } from '@/lib/profile/details'
import { usePersonContext } from '@/components/messages/useConversation'

type UserConnectionsModalComponent = typeof import('@/components/profile/v2/UserConnectionsModal')['UserConnectionsModal'];
type ProfileInviteModalComponent = typeof import('./ProfileInviteModal')['default'];
type ApplyRoleModalComponent = typeof import('@/components/workspaces/ApplyRoleModal')['default'];

interface ProfileClientProps extends Omit<ProfilePageData, 'stats'> {
    stats?: ProfileStats;
    collaborationSummary?: ProfileCollaborationSummary;
    initialOpenRolesProjects?: any[];
    /** The viewer has 20 pending applications: the picker says so instead of failing on submit. */
    applicationsCapReached?: boolean;
}

function parseProfileTab(value: string | null): ProfileTabKey {
    return value === 'portfolio' || value === 'contributions' ? value : 'overview';
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
    const response = await fetch(`/api/v1/profiles/${encodeURIComponent(profileId)}/workspaces?limit=24`, {
        headers: { accept: 'application/json' },
        credentials: 'include',
    })
    return readApiData<{ projects: any[]; total: number; hasMore: boolean }>(response)
}

async function fetchInviteOptions(profileId: string) {
    const response = await fetch(`/api/v1/profiles/${encodeURIComponent(profileId)}/workspace-invite-options`, {
        headers: { accept: 'application/json' },
        credentials: 'include',
    })
    return readApiData<{ projects: ProfileInviteWorkspaceOption[] }>(response)
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
    const { subscribeUserNotifications } = useRealtime()
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
    // Their local time for the Details card: signed-in visitors only, same source and privacy as the hover card.
    const personContext = usePersonContext(profile.id, Boolean(viewerUser && !isOwner && !lockedShell))
    const theirTimeZone = personContext.data?.timeZone ?? null
    const [now, setNow] = useState(() => new Date())
    useEffect(() => {
        if (!theirTimeZone) return
        const timer = window.setInterval(() => setNow(new Date()), 60_000)
        return () => window.clearInterval(timer)
    }, [theirTimeZone])
    const localTime = theirTimeZone ? new Intl.DateTimeFormat('en', { hour: 'numeric', minute: '2-digit', timeZone: theirTimeZone }).format(now) : null
    const detailsRows = profileDetailsRows({
        isOwner,
        // Collaboration preferences shows experience and availability whenever it is on the page.
        preferencesShownElsewhere: isOwner || safeProfile.openToCollaborate === true,
        experienceLevel: safeProfile.experienceLevel,
        hoursPerWeek: safeProfile.hoursPerWeek,
        interests: safeProfile.interests,
        timeZone: theirTimeZone,
        createdAt: safeProfile.createdAt,
        now,
    })
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
        const mod = await import('@/components/workspaces/ApplyRoleModal')
        setApplyRoleModal(() => mod.default)
    }, [ApplyRoleModal])

    const openEditPage = useCallback((section: EditProfileSection = 'general', extra?: Record<string, string | null | undefined>) => {
        if (!isOwner || availabilityInFlight.current) return
        router.push(profileEditHref(section, activeTab, extra))
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
            toast.error(feedbackError(error instanceof Error ? error.message : 'Couldn’t update availability', "Couldn’t update availability"))
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

    useEffect(() => {
        if (!viewerUser?.id || isOwner || !profile?.id) return;
        const unsubscribe = subscribeUserNotifications((event) => {
            if (event.kind === 'notification') {
                const payload = (event.payload?.new ?? event.payload?.old) as Record<string, unknown> | undefined;
                const kind = typeof payload?.kind === 'string' ? payload.kind : '';
                if (kind.startsWith('connection_')) {
                    void refreshViewerOverlay();
                }
            }
        });
        return () => {
            unsubscribe();
        };
    }, [isOwner, profile?.id, refreshViewerOverlay, subscribeUserNotifications, viewerUser?.id]);

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
                    loading: 'Sending request…',
                    success: 'Request sent',
                    error: (err) => err instanceof Error ? err.message : 'Request wasn’t sent'
                }).unwrap();
                await refreshViewerOverlay();
            } else if (status === 'pending_incoming') {
                setStatus('accepted');
                const connectionId = await resolveConnectionId();
                const { acceptConnectionRequest } = await import('@/app/actions/connections');
                await toast.promise(failed(acceptConnectionRequest(connectionId, { idempotencyKey: connectionId })), {
                    loading: 'Accepting request…',
                    success: `You’re now connected with ${profile.fullName || profile.username || 'them'}`,
                    error: (err) => err instanceof Error ? err.message : 'Couldn’t accept request'
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
                    loading: 'Canceling request…',
                    success: 'Request canceled',
                    error: (err) => err instanceof Error ? err.message : 'Couldn’t cancel request'
                }).unwrap();
                await refreshViewerOverlay();
            } else if (status === 'pending_incoming') {
                setStatus('none');
                const connectionId = await resolveConnectionId();
                const { rejectConnectionRequest } = await import('@/app/actions/connections');
                await toast.promise(failed(rejectConnectionRequest(connectionId)), {
                    loading: 'Declining request…',
                    success: 'Request declined',
                    error: (err) => err instanceof Error ? err.message : 'Couldn’t decline request'
                }).unwrap();
                await refreshViewerOverlay();
            } else if (status === 'accepted') {
                setStatus('none');
                const connectionId = await resolveConnectionId();
                const { removeConnection } = await import('@/app/actions/connections');
                await toast.promise(failed(removeConnection(connectionId)), {
                    loading: 'Disconnecting…',
                    success: 'Disconnected',
                    error: (err) => err instanceof Error ? err.message : 'Couldn’t disconnect'
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

    const visibleContributions = collaborationContributions.filter((c) => isOwner || c.visibility === 'public')
    const timeline = (variant: 'full' | 'recent') => (
        <ComponentErrorBoundary fallbackMessage="Couldn’t load workspace contributions.">
            <ContributionTimeline
                variant={variant}
                contributions={collaborationContributions}
                profileId={profile.id}
                isOwner={isOwner}
                onEdit={isOwner ? (id) => openEditPage('experience', { contribution: id }) : undefined}
                onSeeAll={() => handleTabChange('contributions')}
                onChanged={() => router.refresh()}
                onProjectIntent={prefetchProjectHref}
            />
        </ComponentErrorBoundary>
    )
    const renderMainContent = () => {
        if (lockedShell) return null
        if (activeTab === 'portfolio') {
            const visibleProjectsCount = Number(portfolioQuery.data?.total ?? safeStats.projectsCount ?? portfolioProjects.length ?? 0)
            const portfolioDescription = visibleProjectsCount > portfolioProjects.length
                ? `Showing ${portfolioProjects.length} of ${visibleProjectsCount} visible workspaces`
                : `Showcasing ${visibleProjectsCount} visible workspaces`
            return (
                <div id="profile-panel-portfolio" role="tabpanel" aria-labelledby="profile-tab-portfolio" className="space-y-4">
                    {portfolioQuery.isError && (
                        <div role="alert" className="nb-compact flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--status-danger)] bg-[var(--status-danger-soft)] px-4 py-3">
                            <span>Some portfolio workspaces could not be refreshed. Showing the last available workspaces.</span>
                            <button type="button" className="nb-ui-label text-primary hover:underline" onClick={() => void portfolioQuery.refetch()}>Try again</button>
                        </div>
                    )}
                    <WorkspacesGridCard projects={portfolioProjects} title="Portfolio" description={portfolioDescription} isOwner={isOwner}
                        isLoading={portfolioQuery.isLoading && portfolioProjects.length === 0} onProjectIntent={prefetchProjectHref} profileId={profile.id} />
                </div>
            )
        }
        if (activeTab === 'contributions') {
            return <div id="profile-panel-contributions" role="tabpanel" aria-labelledby="profile-tab-contributions">{timeline('full')}</div>
        }
        return (
            <div id="profile-panel-overview" role="tabpanel" aria-labelledby="profile-tab-overview" className="nb-pf-col">
                <ComponentErrorBoundary fallbackMessage="Couldn’t load about section.">
                    <AboutSection
                        profile={safeProfile}
                        isOwner={isOwner}
                        current={visibleContributions.filter((c) => c.currentlyActive && c.visibility !== 'private')}
                        onEdit={isOwner ? () => openEditPage('general', { field: 'bio' }) : undefined}
                        onSeeAll={() => handleTabChange('contributions')}
                    />
                </ComponentErrorBoundary>
                {timeline('recent')}
            </div>
        )
    }

    // Block and Unblock confirm first and offer Undo (Blocking B5, B12); every open screen hears about it (B11).
    const blockFlow = useBlockFlow('profile')
    const handleToggleBlock = () => {
        if (!viewerUser || !profile?.id) return
        const person = { id: profile.id, name: profile.fullName || (profile.username ? `@${profile.username}` : 'this person') }
        if (privacyRelationship.blockedByViewer) blockFlow.openUnblock(person)
        else blockFlow.openBlock(person)
    }
    useEffect(() => {
        if (!profile?.id) return
        const onChange = (event: Event) => {
            if ((event as CustomEvent<{ userId?: string }>).detail?.userId !== profile.id) return
            void invalidatePrivacyDependents(queryClient, profile.username || profile.id).then(() => refreshViewerOverlay())
        }
        window.addEventListener(RELATIONSHIP_EVENT, onChange)
        return () => window.removeEventListener(RELATIONSHIP_EVENT, onChange)
    }, [profile?.id, profile?.username, queryClient, refreshViewerOverlay])

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
            toast.error('You have 20 pending applications', { description: 'Withdraw one to apply.' })
            return
        }
        setIsApplyModalOpen(true)
        void loadApplyRoleModal()
    }, [applicationsCapReached, loadApplyRoleModal])

    // the tab bar carries the page's main action once it floats past the name
    const tabBarAction = isOwner ? (
        <Button size="sm" className="nb-pf-icononly" onClick={() => openEditPage('general')} aria-label="Edit profile"><Pencil className="size-3.5" />Edit profile</Button>
    ) : !viewerUser ? (
        <Button size="sm" className="nb-pf-icononly" onClick={handleConnectPrimary} aria-label="Sign in to connect"><UserPlus className="size-3.5" />Sign in to connect</Button>
    ) : status === 'accepted' && privacyRelationship.canSendMessage ? (
        <Button size="sm" variant="outline" className="nb-pf-icononly" onClick={() => { if (!messageUserInWindow(safeProfile.id)) router.push(`/messages?userId=${safeProfile.id}`) }} aria-label="Message"><MessageSquare className="size-3.5" />Message</Button>
    ) : status === 'pending_incoming' ? (
        <Button size="sm" className="nb-pf-icononly" onClick={handleConnectPrimary} disabled={isLoading} aria-label="Accept"><UserCheck className="size-3.5" />Accept</Button>
    ) : status === 'pending_outgoing' ? (
        <Button size="sm" variant="outline" className="nb-pf-icononly" disabled aria-label="Requested"><Clock className="size-3.5" />Requested</Button>
    ) : (status === 'none' || status === 'rejected') && privacyRelationship.canSendConnectionRequest ? (
        <Button size="sm" className="nb-pf-icononly" onClick={handleConnectPrimary} disabled={isLoading} aria-label="Connect"><UserPlus className="size-3.5" />Connect</Button>
    ) : null

    const handleShareProfile = useCallback((trigger?: HTMLElement) => { shareTrigger.current = trigger ?? null; setShareOpen(true); }, [])



    return (
        <>
            {shareOpen ? <ResourceShareDialog kind="profile" path={profileSharePath(safeProfile.username)} returnFocusElement={shareTrigger.current} onClose={() => setShareOpen(false)}
                ownerUsernameSetup={isOwner ? { profileId: safeProfile.id, updatedAt: safeProfile.updatedAt, onSaved: username => { applyOptimisticProfileUpdate({ username }); router.refresh(); } } : undefined} /> : null}
            {blockFlow.dialog}
            <ProfileShell
                header={<ProfileBand
                        profile={safeProfile}
                        viewerId={viewerUser?.id ?? null}
                        isOwner={isOwner}
                        isAuthenticated={!!viewerUser}
                        connectionState={status}
                        localTime={localTime}
                        privacyRelationship={privacyRelationship}
                        lockedShell={lockedShell}
                        isLoadingConnection={isLoading}
                        isBlocking={false}
                        onEdit={(section) => openEditPage(section ?? 'general')}
                        onShare={handleShareProfile}
                        onAvailabilityToggle={(checked) => startTransition(() => { void toggleAvailability(checked) })}
                        isSavingAvailability={isSavingAvailability}
                        onConnectionsClick={handleOpenConnections}
                        onProjectsClick={handleOpenProjects}
                        onContributionsClick={() => handleTabChange('contributions')}
                        onConnectPrimary={handleConnectPrimary}
                        onConnectSecondary={handleConnectSecondary}
                        onMessage={() => { if (!messageUserInWindow(safeProfile.id)) router.push(`/messages?userId=${safeProfile.id}`); }}
                        onToggleBlock={handleToggleBlock}
                        mutualCount={safeStats.mutualCount}
                        stats={{ ...safeStats, contributionsCount: collaborationContributions.filter((c) => isOwner || c.visibility === 'public').length }}
                    />}
                tabs={lockedShell ? null : (
                    <ProfileTabBar
                        label="Profile sections"
                        idPrefix="profile"
                        value={activeTab}
                        onChange={handleTabChange}
                        onIntent={(next) => { if (next === 'portfolio') prefetchPortfolioProjects() }}
                        tabs={[
                            { key: 'overview', label: 'Overview' },
                            { key: 'contributions', label: 'Contributions', count: visibleContributions.length },
                            { key: 'portfolio', label: 'Portfolio', count: Number(portfolioQuery.data?.total ?? initialSummary.stats?.visibleProjectsCount ?? portfolioProjects.length) },
                        ]}
                        identity={{ name: safeProfile.fullName || safeProfile.username || 'Profile', avatar: <UserAvatar identity={safeProfile} className="size-[26px]" roundedClassName="rounded-[5px]" sizes="26px" /> }}
                        action={tabBarAction}
                    />
                )}
                strip={lockedShell ? null : <SkillsStrip skills={Array.isArray(safeProfile.skills) ? safeProfile.skills : []} isOwner={isOwner} onAdd={isOwner ? () => openEditPage('skills') : undefined} />}
                main={renderMainContent()}
                rail={lockedShell ? null : (
                    <ComponentErrorBoundary fallbackMessage="Couldn’t load profile details.">
                        <ProfileFactsCard
                            profile={safeProfile}
                            isOwner={isOwner}
                            isAuthenticated={Boolean(viewerUser)}
                            contributions={collaborationContributions}
                            detailsRows={detailsRows}
                            mutualCount={safeStats.mutualCount}
                            onEditSection={isOwner ? (section, extra) => openEditPage(section, extra) : undefined}
                            onInvite={viewerUser && !isOwner ? handleOpenInvite : undefined}
                            onInviteIntent={prefetchInviteOptions}
                            onApply={viewerUser && !isOwner ? handleOpenApplyModal : undefined}
                            hasOpenRoles={openRolesProjects.length > 0 || applicationsCapReached}
                            onSeeConnections={handleOpenConnections}
                        />
                    </ComponentErrorBoundary>
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
