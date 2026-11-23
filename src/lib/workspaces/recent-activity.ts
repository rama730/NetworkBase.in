export type WorkspaceRecentActivityType = "member" | "task" | "file" | "github" | "workflow";

export type WorkspaceRecentActivityItem = {
  id: string;
  type: WorkspaceRecentActivityType;
  text: string;
  occurredAt: string;
  href: string;
  /** Made from the CLI or by an AI agent (report A9.7). */
  via?: string | null;
  agentName?: string | null;
};

export function recentActivityAudience(isMember: boolean, tabs: { tasks: boolean; files: boolean }) {
  return {
    mayReadTasks: isMember || tabs.tasks,
    mayReadFiles: isMember || tabs.files,
    mayReadTaskFiles: isMember || tabs.tasks,
    requirePublicProfile: !isMember,
  };
}

export function newestWorkspaceActivities(items: WorkspaceRecentActivityItem[], limit = 3) {
  const seen = new Set<string>();
  return items.slice()
    .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt) || a.id.localeCompare(b.id))
    .filter((item) => {
      const key = item.type === "file" ? `file:${item.href}` : item.id;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit);
}

export function activityActorName(profile: { fullName?: string | null; username?: string | null } | null | undefined) {
  return profile?.fullName?.trim() || profile?.username?.trim() || "A workspace member";
}

export function isPublishableFileMetadata(metadata: Record<string, unknown> | null | undefined) {
  if (!metadata) return true;
  const privacy = metadata.privacy;
  const nested = privacy && typeof privacy === "object" ? privacy as Record<string, unknown> : null;
  const analytics = metadata.analytics && typeof metadata.analytics === "object" ? metadata.analytics as Record<string, unknown> : null;
  return (metadata.visibility == null || metadata.visibility === "public")
    && (nested?.visibility == null || nested.visibility === "public")
    && metadata.isSystem !== true && metadata.publicVisible !== false && nested?.publicVisible !== false
    && nested?.private !== true && analytics?.publicVisible !== false
    && metadata.analyticsVisible !== false && analytics?.analyticsVisible !== false;
}

/** Member settings §3, §4: completing, reopening, confirming and leaving show in the workspace's activity. */
export const MEMBER_JOURNEY_EVENTS = ["workspace_member.completed", "workspace_member.reopened", "workspace_member.completion_confirmed", "workspace_member.removed", "workspace.completed"] as const;

export function describeMembershipEvent(name: string, type: string, metadata: Record<string, unknown>, opts: { showNote?: boolean } = {}) {
  // A completion's note is the person's words (or their owner's): members see it, visitors don't.
  const note = opts.showNote && typeof metadata.note === "string" && metadata.note.trim() ? ` · “${metadata.note.trim().slice(0, 80)}${metadata.note.trim().length > 80 ? "…" : ""}”` : "";
  if (type === "workspace_member.completed") return metadata.byOwner ? `${name}’s part was marked completed${note}` : `${name} completed their part${note}`;
  if (type === "workspace_member.reopened") return `${name} reopened their part`;
  if (type === "workspace_member.completion_confirmed") return `${name}’s part was confirmed`;
  if (type === "workspace_member.removed") return `${name} left the workspace`;
  if (type === "workspace.completed") return `${name} completed the workspace`;
  if (type !== "workspace_member.added" && type !== "workspace_member.role_changed") return null;
  const previousRole = typeof metadata.previousRole === "string" ? metadata.previousRole : null;
  const nextRole = typeof metadata.nextRole === "string" ? metadata.nextRole : null;
  if (type === "workspace_member.added" && previousRole === nextRole) return null;
  return type === "workspace_member.role_changed" || previousRole
    ? `${name} became ${nextRole || "a member"}`
    : `${name} joined the workspace`;
}

export function describeGithubPush(actor: string, mode: "direct" | "pr") {
  return mode === "pr" ? `${actor} opened a GitHub pull request` : `${actor} pushed to GitHub`;
}
