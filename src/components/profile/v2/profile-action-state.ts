import type { ConnectionState } from './types'

export type ProfileRelationshipControlVariant = 'default' | 'outline'

export function resolveProfileActionState({
    connectionState,
    isAuthenticated,
    canSendMessage,
    canSendConnectionRequest,
    blockedByViewer,
    blockedByTarget,
    canManageBlock,
    hasSecondaryHandler,
}: {
    connectionState: ConnectionState
    isAuthenticated: boolean
    canSendMessage: boolean
    canSendConnectionRequest: boolean
    blockedByViewer: boolean
    blockedByTarget: boolean
    canManageBlock: boolean
    hasSecondaryHandler: boolean
}) {
    const isInteractionBlocked = blockedByViewer || blockedByTarget
    const showMessageAction = Boolean(isAuthenticated && canSendMessage && !isInteractionBlocked)
    const isPrimaryConnectionAction = connectionState === 'pending_incoming'
        || ((connectionState === 'none' || connectionState === 'rejected') && canSendConnectionRequest)
    const hasSecondaryConnectionAction = hasSecondaryHandler && (
        connectionState === 'accepted'
        || connectionState === 'pending_outgoing'
        || connectionState === 'pending_incoming'
    )
    const hasConnectionMenuAction = isPrimaryConnectionAction || hasSecondaryConnectionAction
    const canUnblock = Boolean(blockedByViewer && canManageBlock)
    const showRelationshipAction = Boolean(
        isAuthenticated
        && ((!isInteractionBlocked && (hasConnectionMenuAction || showMessageAction || canManageBlock)) || canUnblock),
    )
    const relationshipControlLabel = hasConnectionMenuAction
        ? connectionState === 'accepted'
            ? 'Connected'
            : connectionState === 'pending_outgoing'
                ? 'Requested'
                : connectionState === 'pending_incoming'
                    ? 'Accept'
                    : 'Connect'
        : blockedByViewer
            ? 'Blocked'
            : 'Actions'
    const relationshipControlVariant: ProfileRelationshipControlVariant =
        connectionState === 'accepted' || connectionState === 'pending_outgoing' || !hasConnectionMenuAction
            ? 'outline'
            : 'default'

    return {
        hasConnectionMenuAction,
        hasSecondaryConnectionAction,
        isInteractionBlocked,
        isPrimaryConnectionAction,
        relationshipControlLabel,
        relationshipControlVariant,
        showMessageAction,
        showRelationshipAction,
    }
}
