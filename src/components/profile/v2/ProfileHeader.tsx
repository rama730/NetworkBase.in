'use client'

import React from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Ban, ChevronDown, Lock, MapPin, Link2, Pencil, MessageSquare, Share2, Smile, UserPlus, UserCheck, UserMinus, Clock, Users } from 'lucide-react'
import { buildPrivacyPresentation } from '@/lib/privacy/presentation'
import type { ConnectionState, ProfilePrivacyRelationship, ProfileStats } from './types'
import { normalizeProfile } from '@/lib/utils/normalize-profile'
import { SkillIcon } from '@/components/skills'
import { resolveClientSkill, useSkillCatalog } from '@/lib/skills/client'
import { PersonPresenceBadge } from '@/components/presence/PersonPresence'
import { StatusInline } from '@/components/presence/StatusInline'
import { usePresenceUi } from '@/components/presence/presence-ui-store'
import { usePersonPresence } from '@/components/presence/usePresence'
import { resolveProfileActionState } from './profile-action-state'

function Chip({ children, className }: { children: React.ReactNode; className?: string }) {
    return (
        <span
            className={cn(
                'nb-status inline-flex items-center px-3 py-1.5 rounded-[3px] border border-border bg-card text-muted-foreground',
                className
            )}
        >
            {children}
        </span>
    )
}

/** Status controls under the name. Active-now is already shown by the avatar badge. */
function PresenceChips({ userId, lastActiveAt, isOwner }: { userId: string | null; lastActiveAt?: string | null; isOwner: boolean }) {
    const presence = usePersonPresence(userId, { fallbackLastActiveAt: lastActiveAt ?? null, live: isOwner || undefined })
    const openPicker = usePresenceUi((state) => state.setPickerOpen)
    const showAvailability = presence.availability !== 'now'

    if (!presence.status && !showAvailability && !isOwner) return null

    return (
        <div className="mt-2.5 flex flex-wrap items-center gap-2 max-md:col-span-2">
            {presence.status ? (
                <span className="inline-flex h-[26px] items-center rounded-full bg-muted px-2.5 text-[13px] font-medium text-foreground">
                    <StatusInline emoji={presence.status.emoji} text={presence.statusText} />
                </span>
            ) : null}
            {showAvailability ? (
                <span className="inline-flex h-[26px] items-center rounded-full bg-muted px-2.5 text-[13px] text-muted-foreground">{presence.availabilityText}</span>
            ) : null}
            {isOwner ? (
                <button type="button" onClick={() => openPicker(true)} className="inline-flex h-[26px] items-center gap-1.5 rounded-full border border-dashed border-border px-2.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
                    <Smile className="size-3.5" aria-hidden="true" />
                    {presence.status ? 'Change status' : 'Update your status'}
                </button>
            ) : null}
        </div>
    )
}

export function ProfileHeader({
    profile,
    viewerId,
    isOwner,
    isAuthenticated,
    connectionState,
    onEdit,
    onShare,
    onAvailabilityEdit,
    onConnectionsClick,
    onProjectsClick,
    onConnectPrimary,
    onConnectSecondary,
    onMessage,
    onToggleBlock,
    isLoadingConnection = false,
    isBlocking = false,
    mutualCount = 0,
    stats,
    privacyRelationship,
    lockedShell = false,
}: {
    profile: any
    viewerId?: string | null
    isOwner: boolean
    isAuthenticated: boolean
    connectionState: ConnectionState
    onEdit: () => void
    onShare?: () => void
    onAvailabilityEdit?: () => void
    onConnectionsClick?: () => void
    onProjectsClick?: () => void
    onConnectPrimary: () => void
    onConnectSecondary?: () => void
    onMessage: () => void
    onToggleBlock?: () => void
    isLoadingConnection?: boolean
    isBlocking?: boolean
    mutualCount?: number
    stats?: Pick<ProfileStats, 'connectionsCount' | 'projectsCount'>
    privacyRelationship: ProfilePrivacyRelationship
    lockedShell?: boolean
}) {
    useSkillCatalog();
    const vm = normalizeProfile(profile)
    if (!vm) return null
    const name = vm.fullName || vm.username || 'User'
    const username = vm.username ? `@${vm.username}` : ''
    const headline = vm.headline || ''
    const location = vm.location || ''
    const skills = vm.skills || []
    const isOpenToCollaborate = (vm.openTo || []).length > 0 || Boolean(vm.hoursPerWeek)
    const connectionsCount = stats?.connectionsCount ?? vm.connectionsCount ?? 0
    const projectsCount = stats?.projectsCount ?? vm.projectsCount ?? 0
    // Own-profile completion prompt (spec §17 / §08); phones get it here instead of the rail card.
    const completionScore = Math.max(0, Math.min(100, Number((vm as any).profileStrength || 0)))
    const completionHint: string | undefined = Array.isArray(profile?.completionMissing) ? profile.completionMissing[0] : undefined

    const connectLabel =
        connectionState === 'accepted'
            ? 'Connected'
            : connectionState === 'pending_outgoing'
                ? 'Requested'
                : connectionState === 'pending_incoming'
                    ? 'Accept'
                    : 'Connect'

    const connectIcon =
        connectionState === 'accepted' || connectionState === 'pending_incoming'
            ? <UserCheck className="size-4" />
            : connectionState === 'pending_outgoing'
                ? <Clock className="size-4" />
                : <UserPlus className="size-4" />

    const secondaryConnectLabel =
        connectionState === 'accepted'
            ? 'Disconnect'
            : connectionState === 'pending_outgoing'
                ? 'Cancel'
                : connectionState === 'pending_incoming'
                    ? 'Decline'
                    : null

    const secondaryConnectIcon =
        connectionState === 'pending_outgoing'
            ? <Clock className="size-4" />
            : <UserMinus className="size-4" />

    const blockActionLabel = privacyRelationship.blockedByViewer ? 'Unblock' : 'Block'
    const privacyPresentation = buildPrivacyPresentation({
        viewerId: viewerId ?? null,
        targetUserId: profile.id,
        isSelf: isOwner,
        isConnected: connectionState === 'accepted',
        hasPendingIncomingRequest: connectionState === 'pending_incoming',
        hasPendingOutgoingRequest: connectionState === 'pending_outgoing',
        blockedByViewer: privacyRelationship.blockedByViewer,
        blockedByTarget: privacyRelationship.blockedByTarget,
        profileVisibility: profile.visibility || 'public',
        messagePrivacy: privacyRelationship.canSendMessage ? 'everyone' : 'connections',
        connectionPrivacy: privacyRelationship.canSendConnectionRequest ? 'everyone' : 'nobody',
        canViewProfile: privacyRelationship.canViewProfile,
        canSendConnectionRequest: privacyRelationship.canSendConnectionRequest,
        canSendMessage: privacyRelationship.canSendMessage,
        shouldHideFromDiscovery: false,
        visibilityReason: privacyRelationship.visibilityReason,
        connectionState:
            privacyRelationship.connectionState === 'blocked_by_viewer'
                ? 'blocked_by_viewer'
                : privacyRelationship.connectionState === 'blocked_by_target'
                    ? 'blocked_by_target'
                    : privacyRelationship.connectionState === 'connected'
                        ? 'connected'
                        : privacyRelationship.connectionState === 'pending_incoming'
                            ? 'pending_incoming'
                            : privacyRelationship.connectionState === 'pending_outgoing'
                                ? 'pending_outgoing'
                                : 'none',
        latestConnectionId: null,
    })
    const lockLabel = privacyPresentation.relationshipBadgeText
    const canManageBlock = Boolean(isAuthenticated && onToggleBlock && !privacyRelationship.blockedByTarget)
    const {
        hasConnectionMenuAction,
        isInteractionBlocked,
        isPrimaryConnectionAction,
        relationshipControlLabel,
        relationshipControlVariant,
        showMessageAction,
        showRelationshipAction,
    } = resolveProfileActionState({
        connectionState,
        isAuthenticated,
        canSendMessage: privacyPresentation.canSendMessage,
        canSendConnectionRequest: privacyRelationship.canSendConnectionRequest,
        blockedByViewer: privacyRelationship.blockedByViewer,
        blockedByTarget: privacyRelationship.blockedByTarget,
        canManageBlock,
        hasSecondaryHandler: Boolean(onConnectSecondary),
    })

    return (
        <div data-testid="profile-summary-header" className="overflow-hidden rounded-lg border border-border bg-card shadow-none">
            <div className="p-4 md:p-6">
                <div className="flex flex-col items-start justify-between gap-5 md:flex-row">
                    {/* Below md the details column dissolves into a 2-column grid: avatar + name on row one, everything else full width (spec §17). */}
                    <div className="flex min-w-0 flex-1 items-start gap-5 max-md:grid max-md:w-full max-md:grid-cols-[72px_minmax(0,1fr)] max-md:gap-x-4 max-md:gap-y-0">
                        <div className="relative shrink-0">
                            <UserAvatar
                                identity={vm}
                                className="size-[72px] border border-border bg-secondary"
                                roundedClassName="rounded-[3px]"
                                fallbackClassName="text-2xl font-semibold"
                                sizes="72px"
                                priority
                            />
                            {/* Phones: the badge sits just outside the photo's corner (inside the 16px column gap). */}
                            <PersonPresenceBadge userId={profile?.id ?? null} lastActiveAt={vm.lastActiveAt} live={isOwner || undefined} size={22} className="absolute -bottom-1.5 -right-1.5 max-md:-right-3.5 max-md:bottom-0" />
                        </div>
                        <div className="min-w-0 flex-1 pb-1 max-md:contents">
                            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-2 max-md:self-center">
                                <h1 className="nb-page-title text-foreground">{name}</h1>
                                {username ? (
                                    <span className="nb-meta break-all normal-case tracking-normal">
                                        {username}
                                    </span>
                                ) : null}
                                {isOpenToCollaborate ? (
                                    <span className="nb-status" data-status="completed">
                                        <span className="size-1.5 rounded-full bg-current" aria-hidden="true" />
                                        Open to collaborate
                                    </span>
                                ) : null}
                            </div>
                            {headline ? <p className="text-[15px] leading-normal font-normal mt-2 text-muted-foreground max-md:col-span-2 max-md:mt-3">{headline}</p> : null}
                            <PresenceChips userId={profile?.id ?? null} lastActiveAt={vm.lastActiveAt} isOwner={isOwner} />

                            {mutualCount > 0 ? (
                                <div className="nb-meta mt-2 flex items-center gap-2 text-muted-foreground max-md:col-span-2">
                                    <Users className="w-3 h-3 inline mr-1" />
                                    <span>{mutualCount} mutual connections</span>
                                </div>
                            ) : null}

                            <div data-profile-details className="nb-meta mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 max-md:col-span-2 max-md:gap-y-0">
                                {lockLabel ? (
                                    <span className="nb-status border border-border/60 bg-muted/60 text-muted-foreground">
                                        <Lock className="w-3.5 h-3.5" />
                                        {lockLabel}
                                    </span>
                                ) : null}
                                {location ? (
                                    <span className="inline-flex items-center gap-1.5">
                                        <MapPin className="size-3.5" />
                                        {location}
                                    </span>
                                ) : null}
                                <button
                                    type="button"
                                    onClick={onConnectionsClick}
                                    disabled={!onConnectionsClick || lockedShell}
                                    aria-label={`View ${connectionsCount} ${connectionsCount === 1 ? 'connection' : 'connections'}`}
                                    className="rounded-sm underline-offset-2 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none max-md:inline-flex max-md:min-h-11 max-md:items-center"
                                >
                                    {connectionsCount} connections
                                </button>
                                <button
                                    type="button"
                                    onClick={onProjectsClick}
                                    disabled={!onProjectsClick || lockedShell}
                                    aria-label={`View ${projectsCount} ${projectsCount === 1 ? 'project' : 'projects'}`}
                                    className="rounded-sm underline-offset-2 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none max-md:inline-flex max-md:min-h-11 max-md:items-center"
                                >
                                    {projectsCount} projects
                                </button>
                                {vm.website ? (
                                    <a
                                        href={vm.website}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 hover:text-primary max-md:min-h-11"
                                    >
                                        <Link2 className="size-3.5" />
                                        Website
                                    </a>
                                ) : null}
                            </div>
                            {skills.length > 0 ? (
                                <div className="mt-3 flex flex-wrap gap-1.5 max-md:col-span-2" aria-label="Profile skills">
                                    {skills.map((name: string) => {
                                        const skill = resolveClientSkill(name)
                                        return (
                                            <span className="nb-tag" key={skill.canonicalKey}>
                                                <SkillIcon skill={skill} size={14} />
                                                {skill.name}
                                            </span>
                                        )
                                    })}
                                </div>
                            ) : null}
                        </div>
                    </div>

                    <div className="flex shrink-0 flex-col items-start gap-2.5 md:items-end max-md:w-full">
                        {isOwner ? (
                            <>
                                <div className="flex flex-wrap gap-2 max-md:w-full max-md:flex-nowrap">
                                    <Button onClick={onShare} variant="outline" size="sm" aria-label="Share profile">
                                        <Share2 className="size-4" />
                                        <span className="max-md:sr-only">Share</span>
                                    </Button>
                                    <Button onClick={onEdit} size="sm" className="max-md:flex-1">
                                        <Pencil className="size-4" />
                                        Edit profile
                                    </Button>
                                </div>
                                <button
                                    type="button"
                                    role="switch"
                                    aria-checked={isOpenToCollaborate}
                                    onClick={onAvailabilityEdit ?? onEdit}
                                    className="nb-ui-label inline-flex items-center gap-2 text-foreground max-md:min-h-11"
                                    title="Manage collaboration preferences"
                                >
                                    <span
                                        className={cn(
                                            'relative inline-flex h-5 w-9 rounded-full border transition-colors',
                                            isOpenToCollaborate
                                                ? 'border-[#8F2E12] bg-primary'
                                                : 'border-border bg-secondary',
                                        )}
                                        aria-hidden="true"
                                    >
                                        <span
                                            className={cn(
                                                'absolute top-0.5 size-3.5 rounded-full bg-white shadow-sm transition-transform',
                                                isOpenToCollaborate ? 'translate-x-[17px]' : 'translate-x-0.5',
                                            )}
                                        />
                                    </span>
                                    Open to collaborators
                                </button>
                                {completionScore > 0 && completionScore < 100 ? (
                                    <button
                                        type="button"
                                        onClick={onEdit}
                                        className="w-full space-y-1.5 border-t border-border pt-3 text-left md:hidden"
                                        aria-label={`Profile ${completionScore}% complete${completionHint ? `. Next: ${completionHint}` : ''}`}
                                    >
                                        <span className="nb-compact flex items-center justify-between gap-3 text-muted-foreground">
                                            <span className="min-w-0 truncate"><span className="font-mono text-foreground">{completionScore}%</span> complete{completionHint ? ` · ${completionHint}` : ''}</span>
                                            <span aria-hidden="true">›</span>
                                        </span>
                                        <span className="block h-1.5 overflow-hidden rounded-[3px] bg-muted" aria-hidden="true">
                                            <span className="block h-full bg-primary" style={{ width: `${completionScore}%` }} />
                                        </span>
                                    </button>
                                ) : null}
                            </>
                        ) : isLoadingConnection ? (
                            <div aria-hidden="true" className="nb-skeleton h-10 w-28 rounded-[3px] border border-border/40" />
                        ) : (
                            <div className="flex flex-wrap items-center gap-2">
                                {showMessageAction ? (
                                    <Button
                                        variant="outline"
                                        onClick={onMessage}
                                        aria-label={`Message ${name}`}
                                        className="gap-2"
                                    >
                                        <MessageSquare className="size-4" />
                                        Message
                                    </Button>
                                ) : null}
                                {showRelationshipAction ? (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <Button
                                                variant={relationshipControlVariant}
                                                disabled={!isAuthenticated}
                                                aria-label={`${relationshipControlLabel} options`}
                                                className="gap-1.5"
                                            >
                                                {connectIcon}
                                                {relationshipControlLabel}
                                                <ChevronDown className="size-4 opacity-70" />
                                            </Button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="end" className="w-48">
                                            {isPrimaryConnectionAction ? (
                                                <DropdownMenuItem onClick={onConnectPrimary} disabled={isLoadingConnection}>
                                                    {connectIcon}
                                                    {connectLabel}
                                                </DropdownMenuItem>
                                            ) : null}
                                            {secondaryConnectLabel && onConnectSecondary ? (
                                                <DropdownMenuItem onClick={onConnectSecondary} disabled={isLoadingConnection}>
                                                    {secondaryConnectIcon}
                                                    {secondaryConnectLabel}
                                                </DropdownMenuItem>
                                            ) : null}
                                            {(isPrimaryConnectionAction || secondaryConnectLabel) && canManageBlock ? <DropdownMenuSeparator /> : null}
                                            {canManageBlock ? (
                                                <DropdownMenuItem onClick={onToggleBlock} disabled={isBlocking} variant="destructive">
                                                    <Ban className="size-4" />
                                                    {blockActionLabel}
                                                </DropdownMenuItem>
                                            ) : null}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                ) : isInteractionBlocked ? (
                                    <Chip className="border-destructive/30 bg-destructive/10 text-destructive">
                                        <Ban className="mr-1 w-3.5 h-3.5" />
                                        {privacyPresentation.blockedBannerText || 'You cannot interact with this account'}
                                    </Chip>
                                ) : null}
                            </div>
                        )}
                    </div>
                </div>

                {lockedShell ? (
                    <div className="nb-compact mt-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-muted-foreground">
                        {privacyRelationship.blockedByViewer
                            ? `${privacyPresentation.blockedBannerText || 'You blocked this account'}. Their profile remains limited until you unblock them.`
                            : privacyRelationship.blockedByTarget
                                ? 'This account is not available for profile viewing or interaction.'
                                : privacyRelationship.visibilityReason === 'connections_only'
                                    ? 'Only accepted connections can view the full profile.'
                                    : 'This account is private. Limited identity is shown until you are allowed to view more.'}
                    </div>
                ) : null}
            </div>
        </div>
    )
}
