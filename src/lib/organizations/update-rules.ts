// Org Updates rules (report §17.3–17.6), pure so the feed, the composer and the server agree.
// Mirrors app_private.nb_update_audience_ok and the pin-limit trigger (0245).

import { rolePlural } from "@/lib/organizations/role-words";

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

/** Decision 153: followers hear about a post only when it's Public, on a public workspace, and meant for everyone. */
export function followersHear(post: { visibility: string; projectVisibility: string | null; audience: UpdateAudience | null | undefined }) {
  const limited = (post.audience?.roles?.length ?? 0) > 0 || (post.audience?.projectIds?.length ?? 0) > 0;
  return post.visibility === "public" && post.projectVisibility === "public" && !limited;
}

/**
 * How a new audience compares with the old one (report §37.3): widening needs a confirmation, narrowing applies at once.
 * Public reaches more than members; everyone inside reaches more than any role or workspace.
 */
export function audienceChange(
  prev: { audience: UpdateAudience | null | undefined; visibility: string },
  next: { audience: UpdateAudience | null | undefined; visibility: string },
): "same" | "wider" | "narrower" | "mixed" {
  const parts = (a: UpdateAudience | null | undefined) => [...(a?.roles ?? []).map((r) => `r:${r}`), ...(a?.projectIds ?? []).map((id) => `p:${id}`)];
  const before = parts(prev.audience), after = parts(next.audience);
  const visRank = (v: string) => (v === "public" ? 1 : 0);
  let wider = visRank(next.visibility) > visRank(prev.visibility);
  let narrower = visRank(next.visibility) < visRank(prev.visibility);
  if (before.length > 0 && after.length === 0) wider = true;
  else if (before.length === 0 && after.length > 0) narrower = true;
  else {
    if (after.some((x) => !before.includes(x))) wider = true;
    if (before.some((x) => !after.includes(x))) narrower = true;
  }
  return wider && narrower ? "mixed" : wider ? "wider" : narrower ? "narrower" : "same";
}

/**
 * The card's audience label (report §37.3): `Public`, `Members`, `Admins`, a role name, `Team Falcon +2`.
 * Workspaces the viewer can't name show as "Selected workspaces".
 */
export function audienceLabel(
  post: { audience: UpdateAudience | null | undefined; visibility: string },
  roleNames: Record<"admin" | "member" | "viewer", string>,
  workspaceTitles: Map<string, string>,
) {
  if (post.visibility === "public") return "Public";
  const roles = post.audience?.roles ?? [];
  const ids = post.audience?.projectIds ?? [];
  if (roles.length === 0 && ids.length === 0) return "Members";
  const names = [
    ...roles.map((r) => rolePlural(roleNames[r])),
    ...ids.map((id) => workspaceTitles.get(id)).filter((t): t is string => Boolean(t)),
  ];
  if (names.length === 0) return "Selected workspaces";
  return names.length === 1 ? names[0]! : `${names[0]} +${names.length - 1}`;
}
