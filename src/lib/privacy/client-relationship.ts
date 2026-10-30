import type { PrivacyConnectionState, PrivacyVisibilityReason } from "@/lib/privacy/relationship-state";

type ClientRelationship = {
  blockedByViewer: boolean;
  blockedByTarget: boolean;
  connectionState: PrivacyConnectionState;
  visibilityReason: PrivacyVisibilityReason;
  canViewProfile: boolean;
  canSendMessage: boolean;
  canSendConnectionRequest: boolean;
};

/**
 * What a browser may know about a relationship (Blocking B4, B31, K28). Someone who was blocked sees exactly what a
 * private account looks like: no "blocked" flag, state or reason ever leaves the server. Your own block you can see.
 */
export function forClient<T extends ClientRelationship>(state: T): T {
  if (state.blockedByViewer) return { ...state, blockedByTarget: false };
  if (!state.blockedByTarget) return state;
  return {
    ...state,
    blockedByTarget: false,
    connectionState: "none",
    visibilityReason: "private",
    canViewProfile: false,
    canSendMessage: false,
    canSendConnectionRequest: false,
  };
}
