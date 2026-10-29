// Org Updates rules (report §17.3–17.6), pure so the feed, the composer and the server agree.
// Mirrors app_private.nb_update_audience_ok and the pin-limit trigger (0245).

/** Who sees a post: everyone when empty; otherwise these roles and members of these child projects. */
export type UpdateAudience = { roles?: Array<"admin" | "member" | "viewer">; projectIds?: string[] };

export function audienceAllows(
  audience: UpdateAudience | null | undefined,
  viewer: { isAdmin: boolean; isAuthor: boolean; role: "owner" | "admin" | "member" | "viewer" | null; childProjectIds: string[] },
) {
  const roles = audience?.roles ?? [];
  const projectIds = audience?.projectIds ?? [];
  if (roles.length === 0 && projectIds.length === 0) return true;
  if (viewer.isAdmin || viewer.isAuthor) return true;
  if (viewer.role && viewer.role !== "owner" && roles.includes(viewer.role)) return true;
  return projectIds.some((id) => viewer.childProjectIds.includes(id));
}

/** Up to 3 pinned posts in an org; one in any other project (decision 35). */
export function pinLimit(kind: string | null | undefined) {
  return kind === "organization" ? 3 : 1;
}

/** A pin past its unpin date is quietly over (report §17.4). */
export function isPinnedNow(isPinned: boolean, pinnedUntil: Date | null, now: Date = new Date()) {
  return isPinned && (!pinnedUntil || pinnedUntil.getTime() > now.getTime());
}

/** Why a child project can't share a post up to its org, or null (report §17.6). */
export function shareBlock(input: { childVisibility: string | null; orgAllowsShare: boolean }): string | null {
  if (input.childVisibility === "private") return "Private workspaces can’t share to the org.";
  if (!input.orgAllowsShare) return "The organization turned sharing off.";
  return null;
}
