'use client'

import { SettingsSwitch } from '@/components/settings/ui/SettingsSwitch'
import React from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ItemMenu } from '@/components/reports/ItemMenu'
import { useMuteToggle } from '@/components/privacy/BlockDialog'
import { useMutedIds } from '@/components/messages/ChatShellProvider'
import { Ban, BellOff, ChevronDown, Lock, MapPin, Link2, Pencil, MessageSquare, Share2, Smile, UserPlus, UserCheck, UserMinus, Clock, Users, Loader2 } from 'lucide-react'
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
import { OpenToCollaborateBadge } from '@/components/profile/OpenToCollaborateBadge'
import { completionItemSection, type ProfileEditSection } from '@/lib/profile/edit-route'
import { profileNewMemberLine } from '@/lib/profile/details'

/** Owner status lives with profile actions; visitors see status beside identity. */
function PresenceChips({ userId, lastActiveAt, isOwner, className }: { userId: string | null; lastActiveAt?: string | null; isOwner: boolean; className?: string }) {
    const presence = usePersonPresence(userId, { fallbackLastActiveAt: lastActiveAt ?? null, live: isOwner || undefined })
    const openPicker = usePresenceUi((state) => state.setPickerOpen)
    const showAvailability = presence.availability !== 'now'

    if (!isOwner) {
        if (!presence.status || (!presence.status.emoji && !presence.statusText)) return null
        return (
            <span data-profile-status className="nb-status min-w-0 max-w-full bg-muted text-muted-foreground normal-case! tracking-normal! whitespace-normal! [overflow-wrap:anywhere]">
                <StatusInline emoji={presence.status.emoji} text={presence.statusText} className="min-w-0" />
            </span>
        )
    }

    return (
        <div className={cn("flex flex-wrap items-center gap-2", className)}>
            {presence.status ? (
                <span className="inline-flex min-h-[26px] max-w-full items-center rounded-[6px] bg-muted px-2.5 py-1 text-[13px] font-medium text-foreground [overflow-wrap:anywhere]">
                    <StatusInline emoji={presence.status.emoji} text={presence.statusText} />
                </span>
            ) : null}
            {showAvailability ? (
                <span className="inline-flex h-[26px] items-center rounded-[6px] bg-muted px-2.5 text-[13px] text-muted-foreground">{presence.availabilityText}</span>
            ) : null}
            {isOwner ? (
                <button type="button" onClick={() => openPicker(true)} className="inline-flex h-[26px] max-md:min-h-11 items-center gap-1.5 rounded-[6px] border border-dashed border-border px-2.5 text-[13px] text-muted-foreground hover:bg-muted hover:text-foreground">
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
    onAvailabilityToggle,
    isSavingAvailability = false,
    availabilityToggleDisabled = false,
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
    /** Opens profile edit at a section; General when none is given. */
    onEdit: (section?: ProfileEditSection) => void
    onShare?: (trigger?: HTMLElement) => void
    onAvailabilityToggle?: (checked: boolean) => void
    isSavingAvailability?: boolean
    availabilityToggleDisabled?: boolean
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
    // Mute (Blocking B26), beside Block in the same menu.
    const toggleMute = useMuteToggle()
    const mutedIds = useMutedIds()
    const vm = normalizeProfile(profile)
    if (!vm) return null
    const name = vm.fullName || vm.username || 'User'
    const username = vm.username ? `@${vm.username}` : ''
    const headline = vm.headline || ''
    const location = vm.location || ''
    const skills = vm.skills || []
    const isOpenToCollaborate = !lockedShell && vm.openToCollaborate === true
    const connectionsCount = stats?.connectionsCount ?? vm.connectionsCount ?? 0
    const projectsCount = stats?.projectsCount ?? vm.projectsCount ?? 0
    // A visitor on a brand-new account reads "New member · joined Nov 2026", not two zeros.
    const newMemberLine = lockedShell ? null : profileNewMemberLine({ isOwner, connectionsCount, workspacesCount: projectsCount, createdAt: vm.createdAt })
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
    const canManageBlock = Boolean(isAuthenticated && onToggleBlock)
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
            <div className="grid grid-cols-1 p-4 md:grid-cols-[minmax(0,1fr)_auto] md:gap-x-5 md:p-6">
                {/* Identity sits beside the avatar; the details below span the whole card. */}
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
                        <PersonPresenceBadge userId={profile?.id ?? null} lastActiveAt={vm.lastActiveAt} live={isOwner || undefined} size={30} className="absolute -bottom-1.5 -right-1.5 max-md:-right-3.5 max-md:bottom-0" />
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
                                <OpenToCollaborateBadge
                                    openToCollaborate={isOpenToCollaborate}
                                    openTo={vm.openTo}
                                    customRoles={vm.openToCustomRoles}
                                    categories={vm.preferredCategories}
                                    experienceLevel={vm.experienceLevel}
                                    hoursPerWeek={vm.hoursPerWeek}
                                    variant="profile-header"
                                    isOwner={isOwner}
                                />
                            ) : null}
                            {!isOwner && !lockedShell ? <PresenceChips userId={profile?.id ?? null} lastActiveAt={vm.lastActiveAt} isOwner={false} /> : null}
                        </div>
                        {headline ? <p className="text-[15px] leading-normal font-normal mt-2 text-muted-foreground max-md:col-span-2 max-md:mt-3">{headline}</p> : null}
                    </div>
                </div>

                {mutualCount > 0 ? (
                    <div className="nb-meta mt-2 flex items-center gap-2 text-muted-foreground md:col-span-2">
                        <Users className="w-3 h-3 inline mr-1" />
                        <span>{mutualCount} mutual connections</span>
                    </div>
                ) : null}

                <div data-profile-details className="nb-meta mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 md:col-span-2 max-md:gap-y-0">
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
                    {newMemberLine ? (
                        <span>{newMemberLine}</span>
                    ) : (
                        <>
                        <button
                            type="button"
                            onClick={onConnectionsClick}
                            disabled={!onConnectionsClick || lockedShell}
                            aria-label={`View ${connectionsCount} ${connectionsCount === 1 ? 'connection' : 'connections'}`}
                            className="rounded-sm underline-offset-2 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none max-md:inline-flex max-md:min-h-11 max-md:items-center"
                        >
                            {connectionsCount} {connectionsCount === 1 ? 'connection' : 'connections'}
                        </button>
                        <button
                            type="button"
                            onClick={onProjectsClick}
                            disabled={!onProjectsClick || lockedShell}
                            aria-label={`View ${projectsCount} ${projectsCount === 1 ? 'workspace' : 'workspaces'}`}
                            className="rounded-sm underline-offset-2 transition-colors hover:text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none max-md:inline-flex max-md:min-h-11 max-md:items-center"
                        >
                            {projectsCount} {projectsCount === 1 ? 'workspace' : 'workspaces'}
                        </button>
                        </>
                    )}
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
                    <div className="mt-3 flex flex-wrap gap-1.5 md:col-span-2" aria-label="Profile skills">
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

                <div className="mt-5 flex max-w-full flex-col items-start gap-2.5 md:col-start-2 md:row-start-1 md:mt-0 md:max-w-[280px] md:items-end md:gap-1.5">
                    {isOwner ? (
                        <>
                            <div className="flex flex-wrap gap-2 max-md:w-full max-md:flex-nowrap">
                                <Button onClick={event => onShare?.(event.currentTarget)} variant="outline" size="sm" aria-label="Share profile" className="max-md:min-h-11 max-md:min-w-11">
                                    <Share2 className="size-4" />
                                    <span className="max-md:sr-only">Share</span>
                                </Button>
                                <Button onClick={() => onEdit()} size="sm" className="max-md:flex-1 max-md:min-h-11">
                                    <Pencil className="size-4" />
                                    Edit profile
                                </Button>
                            </div>
                            <label className="nb-ui-label inline-flex items-center gap-2 text-foreground max-md:min-h-11">
                                <SettingsSwitch
                                    checked={isOpenToCollaborate}
                                    onCheckedChange={onAvailabilityToggle}
                                    disabled={!onAvailabilityToggle || isSavingAvailability || availabilityToggleDisabled}
                                    aria-label="Open to collaboration"
                                    aria-busy={isSavingAvailability}
                                />
                                <span>Open to collaboration</span>
                                {isSavingAvailability ? <span role="status" className="nb-compact text-muted-foreground">Saving…</span> : null}
                            </label>
                            <PresenceChips userId={profile?.id ?? null} lastActiveAt={vm.lastActiveAt} isOwner className="md:justify-end" />
                            {completionScore > 0 && completionScore < 100 ? (
                                <button
                                    type="button"
                                    onClick={() => onEdit(completionItemSection(completionHint))}
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
                    ) : (
                        <>
                        <div className="flex flex-wrap items-center gap-2">
                            {!lockedShell && onShare ? <Button onClick={event => onShare(event.currentTarget)} variant="outline" aria-label="Share profile"><Share2 className="size-4" />Share</Button> : null}
                            {!isAuthenticated && !privacyRelationship.blockedByTarget ? <Button onClick={onConnectPrimary} disabled={isLoadingConnection}>Sign in to connect</Button> : null}
                            {showRelationshipAction ? (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button
                                            variant={relationshipControlVariant}
                                            disabled={!isAuthenticated || isLoadingConnection}
                                            aria-label={`${relationshipControlLabel} options`}
                                            className="gap-1.5"
                                        >
                                            {isLoadingConnection ? <Loader2 className="size-4 animate-spin" /> : connectIcon}
                                            {relationshipControlLabel}
                                            <ChevronDown className="size-4 opacity-70" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" className="w-48">
                                        {showMessageAction ? (
                                            <DropdownMenuItem onClick={onMessage} aria-label={`Message ${name}`}>
                                                <MessageSquare className="size-4" />
                                                Message
                                            </DropdownMenuItem>
                                        ) : null}
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
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            ) : isInteractionBlocked ? (
                                <span className="nb-status inline-flex items-center px-3 py-1.5 rounded-[3px] border border-destructive/30 bg-destructive/10 text-destructive">
                                    <Ban className="mr-1 w-3.5 h-3.5" />
                                    {privacyPresentation.blockedBannerText || 'You cannot interact with this account'}
                                </span>
                            ) : null}
                            {/* One "⋯" for a person (Blocking B6): Block or Unblock, then Report, also while blocked, never on your own profile. */}
                            {profile?.id && isAuthenticated ? (
                                <ItemMenu label={`More actions for ${name}`} className="size-[var(--ui-control-height)] rounded-[5px] border border-border"
                                    report={{ kind: 'person', targetId: profile.id, noun: 'person', personName: name }}>
                                    {canManageBlock ? (
                                        <DropdownMenuItem onSelect={onToggleBlock} disabled={isBlocking} variant={privacyRelationship.blockedByViewer ? undefined : 'destructive'}>
                                            <Ban className="size-4" />
                                            {blockActionLabel} {privacyRelationship.blockedByViewer ? '' : name}
                                        </DropdownMenuItem>
                                    ) : null}
                                    {canManageBlock && !privacyRelationship.blockedByViewer ? (
                                        <DropdownMenuItem onSelect={() => toggleMute({ id: profile.id, name }, !mutedIds.has(profile.id))}>
                                            <BellOff className="size-4" />
                                            {mutedIds.has(profile.id) ? `Unmute ${name}` : `Mute ${name}`}
                                        </DropdownMenuItem>
                                    ) : null}
                                </ItemMenu>
                            ) : null}
                        </div>
                        </>
                    )}
                </div>

                {lockedShell ? (
                    <div className="nb-compact mt-4 rounded-lg border border-border bg-muted/40 px-4 py-3 text-muted-foreground md:col-span-2">
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
