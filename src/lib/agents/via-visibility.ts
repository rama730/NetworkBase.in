/**
 * Who sees "with Claude Code" (report Part B). The record (`via`, `agent_name`) never changes; this decides, per
 * viewer, what a read sends. Every read path that feeds a label goes through `visibleVia` (tests/unit/via-visibility-
 * guard checks it), so "No one" also means the data isn't sent to other people.
 */
export type LabelSetting = "everyone" | "person" | "none";
export const LABEL_SETTINGS = ["everyone", "person", "none"] as const;

export type LabelScope = {
  /** The workspace owner's choice ("Show when agents helped"). */
  setting: LabelSetting;
  /** An organization workspace or assignment copy whose AI policy is Labelled or Not allowed. */
  orgForced: boolean;
  viewerId: string | null;
  /** The organization's owners and admins: the people who review. */
  viewerStaff: boolean;
};

export type ViaShown = { via: "agent" | "cli" | null; agentName: string | null };

const HIDDEN: ViaShown = { via: null, agentName: null };

/** The label this viewer may see on one row; `authorId` is the person who used the agent or the CLI. */
export function visibleVia(scope: LabelScope, row: { via?: string | null; agentName?: string | null; authorId?: string | null }): ViaShown {
  if (row.via !== "agent" && row.via !== "cli") return HIDDEN;
  const shown: ViaShown = { via: row.via, agentName: row.via === "agent" ? row.agentName ?? null : null };
  // Where the class asks, staff always see it, whatever the copy's owner chose.
  if (scope.orgForced && scope.viewerStaff) return shown;
  if (scope.setting === "everyone") return shown;
  if (scope.setting === "person") return scope.viewerId && row.authorId === scope.viewerId ? shown : HIDDEN;
  return HIDDEN;
}

/** The label stored in an activity event's payload, for this viewer. */
export function visibleViaOfPayload(scope: LabelScope, payload: unknown, authorId: string | null | undefined): ViaShown {
  const p = (payload ?? {}) as { via?: unknown; agentName?: unknown };
  return visibleVia(scope, { via: typeof p.via === "string" ? p.via : null, agentName: typeof p.agentName === "string" ? p.agentName : null, authorId });
}
