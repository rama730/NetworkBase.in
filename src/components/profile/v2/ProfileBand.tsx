'use client'
import { PixelBeat } from "@/components/ui/PixelBeat";

import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { UserAvatar } from '@/components/ui/UserAvatar'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ItemMenu } from '@/components/reports/ItemMenu'
import { useMuteToggle } from '@/components/privacy/BlockDialog'
import { useMutedIds } from '@/components/messages/ChatShellProvider'
import { Ban, BellOff, ChevronDown, Clock, Link2, Lock, MapPin, MessageSquare, Pencil, Share2, Smile, UserCheck, UserMinus, UserPlus } from 'lucide-react'
import { buildPrivacyPresentation } from '@/lib/privacy/presentation'
import type { ConnectionState, ProfilePrivacyRelationship } from './types'
import { normalizeProfile } from '@/lib/utils/normalize-profile'
import { PersonPresenceBadge } from '@/components/presence/PersonPresence'
import { StatusInline } from '@/components/presence/StatusInline'
import { usePresenceUi } from '@/components/presence/presence-ui-store'
import { usePersonPresence } from '@/components/presence/usePresence'
import { resolveProfileActionState } from './profile-action-state'
import { profileNewMemberLine } from '@/lib/profile/details'
import type { ProfileEditSection } from '@/lib/profile/edit-route'

export type ProfileBandProps = {
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
    onConnectionsClick?: () => void
    onProjectsClick?: () => void
    onContributionsClick?: () => void
    onConnectPrimary: () => void
    onConnectSecondary?: () => void
    onMessage: () => void
    onToggleBlock?: () => void
    isLoadingConnection?: boolean
    isBlocking?: boolean
    mutualCount?: number
    /** Up to three faces for the Mutual stat. */
    mutualFaces?: ReactNode
    stats?: { connectionsCount?: number; projectsCount?: number; contributionsCount?: number }
    /** "4:12 PM" in their time zone, for signed-in visitors. */
    localTime?: string | null
    privacyRelationship: ProfilePrivacyRelationship
    lockedShell?: boolean
    /** Edit profile's live preview: every part is a button that opens its field. */
    preview?: { onJump: (field: string) => void; photo?: ReactNode; badge?: ReactNode; actions?: ReactNode; hint?: ReactNode }
}

const host = (url: string) => url.replace(/^https?:\/\//, '').replace(/\/$/, '')

/** The status chip in the band: the owner changes it in place (the shared presence picker); visitors read it. */
function BandStatus({ userId, lastActiveAt, isOwner, preview }: { userId: string | null; lastActiveAt?: string | null; isOwner: boolean; preview?: boolean }) {
    const presence = usePersonPresence(userId, { fallbackLastActiveAt: lastActiveAt ?? null, live: isOwner || undefined })
    const openPicker = usePresenceUi((state) => state.setPickerOpen)
    const has = Boolean(presence.status && (presence.status.emoji || presence.statusText))
    if (!has) {
        return isOwner ? (
            <button type="button" className="nb-pf-status is-add" onClick={() => openPicker(true)}>
                <Smile className="size-3.5" aria-hidden="true" />Set a status
            </button>
        ) : null
    }
    const chip = <StatusInline emoji={presence.status!.emoji} text={presence.statusText} className="min-w-0" />
    if (isOwner && preview) return <button type="button" className="nb-pf-status" onClick={() => openPicker(true)} title="Change your status">{chip}</button>
    return (
        <span className="nb-pf-status" data-profile-status>
            {chip}
            {isOwner ? <button type="button" className="chg" onClick={() => openPicker(true)} aria-label="Change status">Change</button> : null}
        </span>
    )
}

export function ProfileBand(props: ProfileBandProps) {
    const {
        profile, viewerId, isOwner, isAuthenticated, connectionState, onEdit, onShare, onAvailabilityToggle, isSavingAvailability = false,
        onConnectionsClick, onProjectsClick, onContributionsClick, onConnectPrimary, onConnectSecondary, onMessage, onToggleBlock,
        isLoadingConnection = false, isBlocking = false, mutualCount = 0, mutualFaces, stats, localTime, privacyRelationship, lockedShell = false, preview,
    } = props
    const toggleMute = useMuteToggle()
    const mutedIds = useMutedIds()
    const bandRef = useRef<HTMLElement>(null)
    const [tall, setTall] = useState(false)
    const vm = normalizeProfile(profile)

    // When the name, handle and headline run taller than the photo, the headline drops to its own full-width line,
    // so no empty block is left under the photo. Short content keeps the side-by-side block.
    useLayoutEffect(() => {
        const band = bandRef.current
        if (!band) return
        const measure = () => {
            const was = band.classList.contains('is-tall')
            band.classList.remove('is-tall')
            const id = band.querySelector<HTMLElement>('.nb-pf-id'), photo = band.querySelector<HTMLElement>('.nb-pf-photo')
            const next = Boolean(id && photo && id.offsetHeight > photo.offsetHeight + 20)
            if (was) band.classList.add('is-tall')
            setTall(next)
        }
        measure()
        const observer = new ResizeObserver(measure)
        observer.observe(band)
        return () => observer.disconnect()
    }, [vm?.fullName, vm?.headline, vm?.username])

    if (!vm) return null
    const name = vm.fullName || vm.username || (preview ? 'Your name' : 'User')
    const firstName = name.split(/\s+/)[0]
    const isOpen = !lockedShell && vm.openToCollaborate === true
    const connectionsCount = stats?.connectionsCount ?? vm.connectionsCount ?? 0
    const projectsCount = stats?.projectsCount ?? vm.projectsCount ?? 0
    const contributionsCount = stats?.contributionsCount ?? 0
    const newMemberLine = lockedShell ? null : profileNewMemberLine({ isOwner, connectionsCount, workspacesCount: projectsCount, createdAt: vm.createdAt })
    const jump = (field: string) => preview ? { onClick: () => preview.onJump(field), type: 'button' as const, className: 'nb-pf-hit', title: 'Edit' } : null

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
        connectionState: (['blocked_by_viewer', 'blocked_by_target', 'connected', 'pending_incoming', 'pending_outgoing'] as const).find((s) => s === privacyRelationship.connectionState) ?? 'none',
        latestConnectionId: null,
    })
    const canManageBlock = Boolean(isAuthenticated && onToggleBlock)
    const { isInteractionBlocked, isPrimaryConnectionAction, relationshipControlLabel, relationshipControlVariant, showMessageAction, showRelationshipAction } = resolveProfileActionState({
        connectionState,
        isAuthenticated,
        canSendMessage: privacyPresentation.canSendMessage,
        canSendConnectionRequest: privacyRelationship.canSendConnectionRequest,
        blockedByViewer: privacyRelationship.blockedByViewer,
        blockedByTarget: privacyRelationship.blockedByTarget,
        canManageBlock,
        hasSecondaryHandler: Boolean(onConnectSecondary),
    })
    const messageOff = Boolean(isAuthenticated && !showMessageAction && !isInteractionBlocked)
    const connectLabel = connectionState === 'accepted' ? 'Connected' : connectionState === 'pending_outgoing' ? 'Requested' : connectionState === 'pending_incoming' ? 'Accept' : 'Connect'
    const connectIcon = connectionState === 'accepted' || connectionState === 'pending_incoming' ? <UserCheck className="size-4" /> : connectionState === 'pending_outgoing' ? <Clock className="size-4" /> : <UserPlus className="size-4" />
    const secondaryLabel = connectionState === 'accepted' ? 'Disconnect' : connectionState === 'pending_outgoing' ? 'Cancel request' : connectionState === 'pending_incoming' ? 'Decline' : null

    const avatar = (
        <UserAvatar identity={vm} className="nb-pf-pic size-20 max-md:size-16 bg-secondary" roundedClassName="rounded-[6px]" fallbackClassName="text-2xl font-semibold" sizes="80px" priority />
    )
    const statItems: Array<[string, number, (() => void) | undefined, ReactNode?]> = [
        ['Connections', connectionsCount, onConnectionsClick],
        ['Workspaces', projectsCount, onProjectsClick],
        ['Contributions', contributionsCount, onContributionsClick],
    ]
    if (!isOwner && isAuthenticated && mutualCount > 0) statItems.push(['Mutual', mutualCount, onConnectionsClick, mutualFaces])

    const tag = lockedShell ? null : isOwner && onAvailabilityToggle && !preview ? (
        <button type="button" role="switch" className="nb-pf-tag" aria-checked={isOpen} aria-label="Open to collaboration" disabled={isSavingAvailability} aria-busy={isSavingAvailability}
            onClick={() => onAvailabilityToggle(!isOpen)} title={isOpen ? 'Turn off open to collaboration' : 'Turn on open to collaboration'}>
            <span className="mini" aria-hidden="true" />{isOpen ? 'Open to collaborate' : 'Not open to collaborate'}
        </button>
    ) : isOpen ? (preview ? <button {...jump('open')!}><span className="nb-pf-tag">Open to collaborate</span></button> : <span className="nb-pf-tag">Open to collaborate</span>) : null

    const actions = preview ? preview.actions : isOwner ? (
        <>
            <Button variant="outline" size="icon" className="nb-pf-btn nb-pf-icon" aria-label="Share profile" title="Share profile" onClick={(e) => onShare?.(e.currentTarget)}><Share2 className="size-4" /></Button>
            <Button className="nb-pf-grow" onClick={() => onEdit()}><Pencil className="size-4" />Edit profile</Button>
        </>
    ) : (
        <>
            {!isAuthenticated && !privacyRelationship.blockedByTarget ? <Button className="nb-pf-grow" onClick={onConnectPrimary} disabled={isLoadingConnection}><UserPlus className="size-4" />Sign in to connect</Button> : null}
            {showRelationshipAction ? (
                <>
                    {/* Message sits beside Connect whenever they take your messages (EntryPoints 05); off with the tag when they don't (06). */}
                    {showMessageAction ? <Button variant="outline" className="nb-pf-btn nb-pf-grow" onClick={onMessage}><MessageSquare className="size-4" />Message</Button> : null}
                    {messageOff ? <span className="nb-msg-off" title="Only accepts messages from connections"><Button variant="outline" className="nb-pf-btn" disabled><MessageSquare className="size-4" />Message</Button><span className="nb-state-tag">Can’t message</span><span className="sr-only">Only accepts messages from connections</span></span> : null}
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button variant={relationshipControlVariant} className={cn('nb-pf-grow gap-1.5', relationshipControlVariant !== 'default' && 'nb-pf-btn')} disabled={!isAuthenticated || isLoadingConnection} aria-label={`${relationshipControlLabel} options`}>
                                {isLoadingConnection ? <PixelBeat /> : connectIcon}
                                {relationshipControlLabel}
                                <ChevronDown className="size-4 opacity-70" />
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-48">
                            {showMessageAction ? <DropdownMenuItem onClick={onMessage} aria-label={`Message ${name}`}><MessageSquare className="size-4" />Message</DropdownMenuItem> : null}
                            {isPrimaryConnectionAction ? <DropdownMenuItem onClick={onConnectPrimary} disabled={isLoadingConnection}>{connectIcon}{connectLabel}</DropdownMenuItem> : null}
                            {secondaryLabel && onConnectSecondary ? <DropdownMenuItem onClick={onConnectSecondary} disabled={isLoadingConnection} variant={connectionState === 'accepted' ? 'destructive' : undefined}><UserMinus className="size-4" />{secondaryLabel}</DropdownMenuItem> : null}
                        </DropdownMenuContent>
                    </DropdownMenu>
                </>
            ) : isInteractionBlocked && !privacyRelationship.blockedByViewer ? (
                <span className="nb-pf-status"><Ban className="size-3.5" />{privacyPresentation.blockedBannerText || 'You can’t interact with this account'}</span>
            ) : null}
            {privacyRelationship.blockedByViewer && onToggleBlock ? <Button variant="outline" className="nb-pf-btn nb-pf-grow" onClick={onToggleBlock}><Ban className="size-4" />Unblock</Button> : null}
            {!lockedShell && onShare ? <Button variant="outline" size="icon" className="nb-pf-btn nb-pf-icon" aria-label="Share profile" title="Share profile" onClick={(e) => onShare(e.currentTarget)}><Share2 className="size-4" /></Button> : null}
            {profile?.id && isAuthenticated ? (
                <ItemMenu label={`More actions for ${name}`} className="nb-pf-btn nb-pf-icon size-[var(--ui-control-height)] rounded-[5px] border border-border" report={{ kind: 'person', targetId: profile.id, noun: 'person', personName: name }}>
                    {canManageBlock ? (
                        <DropdownMenuItem onSelect={onToggleBlock} disabled={isBlocking} variant={privacyRelationship.blockedByViewer ? undefined : 'destructive'}>
                            <Ban className="size-4" />{privacyRelationship.blockedByViewer ? 'Unblock' : `Block ${firstName}`}
                        </DropdownMenuItem>
                    ) : null}
                    {canManageBlock && !privacyRelationship.blockedByViewer ? (
                        <DropdownMenuItem onSelect={() => toggleMute({ id: profile.id, name }, !mutedIds.has(profile.id))}>
                            <BellOff className="size-4" />{mutedIds.has(profile.id) ? `Unmute ${firstName}` : `Mute ${firstName}`}
                        </DropdownMenuItem>
                    ) : null}
                </ItemMenu>
            ) : null}
        </>
    )

    const location = vm.location || ''
    const website = typeof vm.website === 'string' ? vm.website : ''
    const meta = lockedShell ? null : (
        <div className="nb-pf-meta">
            {location ? (preview ? <button {...jump('location')!}><MapPin className="size-3.5" />{location}</button> : <span><MapPin className="size-3.5" aria-hidden="true" />{location}</span>) : null}
            {website ? (preview ? <button {...jump('website')!}><Link2 className="size-3.5" />{host(website)}</button> : <a href={website} target="_blank" rel="noopener noreferrer"><Link2 className="size-3.5" aria-hidden="true" />{host(website)}</a>) : null}
            {!isOwner && localTime ? <span title="Their local time"><Clock className="size-3.5" aria-hidden="true" />{localTime} there</span> : null}
        </div>
    )

    return (
        <section ref={bandRef} className={cn('nb-pf-band', tall && 'is-tall')} aria-label={preview ? 'Preview of your profile header' : 'Profile'} data-testid={preview ? 'profile-edit-preview' : 'profile-summary-header'}>
            <div className="nb-pf-band-in">
                <div className="nb-pf-photo">
                    {preview ? <button type="button" className="nb-pf-pic nb-pf-hit" onClick={() => preview.onJump('photo')} title="Change photo">{preview.photo ?? avatar}</button> : avatar}
                    {lockedShell ? null : <PersonPresenceBadge userId={profile?.id ?? null} lastActiveAt={vm.lastActiveAt} live={isOwner || undefined} size={24} className="absolute -bottom-1.5 -right-1.5" />}
                    {preview?.badge}
                </div>
                <div className="nb-pf-id">
                    {preview ? <p className="nb-pf-name" data-pf-name><button {...jump('name')!}>{name}</button></p> : <h1 className="nb-pf-name" data-pf-name>{name}</h1>}
                    <div className="nb-pf-handle">
                        {vm.username ? (preview ? <button {...jump('username')!}>@{vm.username}</button> : <span>@{vm.username}</span>) : null}
                        {tag}
                    </div>
                    {lockedShell ? null : (
                        <p className="nb-pf-headline">
                            {preview ? <button {...jump('headline')!}>{vm.headline || <span className="opacity-70">Add a headline</span>}</button> : vm.headline || (isOwner ? <span className="opacity-70">No headline yet</span> : null)}
                        </p>
                    )}
                </div>
                <div className="nb-pf-acts">{actions}</div>
                {lockedShell ? null : (
                    <div className="nb-pf-row">
                        {meta}
                        <BandStatus userId={profile?.id ?? null} lastActiveAt={vm.lastActiveAt} isOwner={isOwner} preview={Boolean(preview)} />
                    </div>
                )}
                {lockedShell ? (
                    <div className="nb-pf-lock" role="note">
                        {privacyRelationship.blockedByViewer ? <Ban className="mt-0.5 size-4 shrink-0" /> : <Lock className="mt-0.5 size-4 shrink-0" />}
                        <span>
                            {privacyRelationship.blockedByViewer
                                ? `You blocked ${firstName}. Their profile stays limited until you unblock them.`
                                : privacyRelationship.blockedByTarget
                                    ? 'This account is not available for profile viewing or interaction.'
                                    : privacyRelationship.visibilityReason === 'connections_only'
                                        ? `Only ${firstName}’s connections can see their full profile.`
                                        : 'This account is private. Limited identity is shown until you are allowed to view more.'}
                        </span>
                    </div>
                ) : null}
            </div>
            {preview?.hint}
            {lockedShell || preview ? null : newMemberLine ? (
                <div className="nb-pf-stats" style={{ ['--cols' as string]: 1 }}><span className="nb-pf-stat is-new">{newMemberLine}</span></div>
            ) : (
                <div className="nb-pf-stats" data-cols={statItems.length} style={{ ['--cols' as string]: statItems.length }}>
                    {statItems.map(([label, n, go, faces]) => (
                        <button key={label} type="button" className="nb-pf-stat" onClick={go} disabled={!go} aria-label={`View ${n} ${label === 'Mutual' ? 'mutual connections' : label.toLowerCase()}`}>
                            <b>{n}</b>{faces}<span>{label}</span>
                        </button>
                    ))}
                </div>
            )}
        </section>
    )
}
