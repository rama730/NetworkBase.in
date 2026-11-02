import { calculateCooldown } from "@/lib/applications/utils";
import { ORG_LIMITS } from "@/lib/organizations/config";

// No look-alikes: no O/0, no I/1 (report §6.1).
const JOIN_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const JOIN_CODE_PATTERN = /^[A-HJ-NP-Z2-9]{6}$/;

export function generateJoinCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(6));
  // 256 % 32 === 0, so the modulo is unbiased.
  return Array.from(bytes, (b) => JOIN_CODE_ALPHABET[b % JOIN_CODE_ALPHABET.length]).join("");
}

/** A typed or pasted code, uppercased with spaces and dashes removed; null when it can't be a code. */
export function normalizeJoinCode(raw: string): string | null {
  const code = raw.toUpperCase().replace(/[\s-]/g, "");
  return JOIN_CODE_PATTERN.test(code) ? code : null;
}

export type OrgJoinMode = "instant" | "approval";

export type OrgJoinState = {
  /** False when the org is archived, suspended or scheduled for deletion. */
  available: boolean;
  isMember: boolean;
  isBlocked: boolean;
  joinMode: OrgJoinMode;
  memberCount: number;
  maxMembers: number | null;
  request: { status: string; updatedAt: Date; decidedBySelf: boolean } | null;
};

export type OrgJoinOutcome =
  | "joined"
  | "requested"
  | "already_member"
  | "already_requested"
  | "blocked"
  | "full"
  | "unavailable"
  | "cooldown";

/** The org's member cap: Max members when set (a positive number), never above the platform limit. */
export function orgMemberCap(maxCollaborators: string | null) {
  const n = maxCollaborators ? Number.parseInt(maxCollaborators, 10) : NaN;
  return Math.min(Number.isFinite(n) && n > 0 ? n : ORG_LIMITS.membersPerOrg, ORG_LIMITS.membersPerOrg);
}

export function decideOrgJoin(state: OrgJoinState): OrgJoinOutcome {
  if (!state.available) return "unavailable";
  if (state.isMember) return "already_member";
  if (state.isBlocked) return "blocked";
  const cap = Math.min(state.maxMembers ?? ORG_LIMITS.membersPerOrg, ORG_LIMITS.membersPerOrg);
  if (state.memberCount >= cap) return "full";
  if (state.joinMode === "instant") return "joined";
  if (state.request?.status === "pending") return "already_requested";
  // The cool-down is for an admin's decline, not for withdrawing yourself (same rule as role applications).
  if (state.request?.status === "rejected" && !state.request.decidedBySelf && !calculateCooldown(state.request.updatedAt).canApply) {
    return "cooldown";
  }
  return "requested";
}

export const ORG_JOIN_MESSAGES = {
  no_match: "That code doesn’t match an organization.",
  blocked: "You can’t join this organization.",
  full: "This organization is full.",
  unavailable: "This organization isn’t accepting new members.",
  cooldown: "Your last request was declined. You can ask again tomorrow.",
} as const;

/** Who is looking at a private organization's page (report §26.9, decision 48). */
export type PrivateOrgState =
  | { kind: "none" }
  | { kind: "invited"; role: string; inviteId?: string }
  | { kind: "waiting" }
  | { kind: "declined" }
  | { kind: "left"; date: string }
  | { kind: "removed" }
  | { kind: "blocked" }
  | { kind: "ended" };

/** The one line and the actions a private organization's page shows each person; nothing else from inside. */
export function privateOrgLine(state: PrivateOrgState, org: string): { line: string | null; join: boolean; action: "invite" | "cancel" | null } {
  switch (state.kind) {
    case "invited": return { line: `You’re invited as ${state.role}`, join: false, action: "invite" };
    case "waiting": return { line: "Request sent", join: false, action: "cancel" };
    case "declined": return { line: "Your request was declined. You can ask again tomorrow.", join: false, action: null };
    case "left": return { line: `You left ${org} on ${state.date}.`, join: true, action: null };
    case "removed": return { line: `You’re no longer in ${org}.`, join: true, action: null };
    case "blocked": return { line: "You can’t join this organization.", join: false, action: null };
    case "ended": return { line: "This organization has ended.", join: false, action: null };
    default: return { line: null, join: true, action: null };
  }
}
