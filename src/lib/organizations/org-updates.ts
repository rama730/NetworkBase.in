import "server-only";

import { and, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaceMembers, workspaceUpdates, workspaces } from "@/lib/db/schema";
import { readViewerOrgRole, type OrgMemberRoleOrNone } from "@/lib/organizations/detail";
import { shareBlock, type UpdateAudience } from "@/lib/organizations/update-rules";

// Org Updates (report §17): who may post what, the audience rule on reads, the shared-up feed.

export type OrgUpdateContext = {
  kind: "org" | "child";
  orgId: string;
  orgTitle: string;
  orgSlug: string | null;
  viewerRole: OrgMemberRoleOrNone;
  isOrgAdmin: boolean;
  /** Child projects of this org the viewer belongs to (for child-project audiences). */
  viewerChildIds: string[];
  /** Child only: whether its posts may be shared up, and why not. */
  shareBlockedReason: string | null;
  /** Org feed: child posts an org admin pinned there (report §17.6, "org feed only"). */
  sharedPinIds: string[];
  /** Org Settings → Updates (report §17.10): announcements notify in-app by default; replies from org members only. */
  notifyDefault: "in_app" | "email";
  replyDefault: "members" | "logged_in";
};

export async function readOrgUpdateContext(project: { id: string; kind?: string | null; parentId?: string | null; visibility?: string | null }, viewerId: string | null): Promise<OrgUpdateContext | null> {
  const orgId = project.kind === "organization" ? project.id : project.parentId ?? null;
  if (!orgId) return null;
  const [org] = await db.select({ title: workspaces.title, slug: workspaces.slug, orgSettings: workspaces.orgSettings })
    .from(workspaces).where(and(eq(workspaces.id, orgId), eq(workspaces.kind, "organization"), isNull(workspaces.deletedAt))).limit(1);
  if (!org) return null;
  const viewerRole = await readViewerOrgRole(orgId, viewerId);
  const viewerChildIds = viewerId
    ? (await db.select({ id: workspaces.id }).from(workspaces)
      .innerJoin(workspaceMembers, and(eq(workspaceMembers.projectId, workspaces.id), eq(workspaceMembers.userId, viewerId)))
      .where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt)))).map((r) => r.id)
    : [];
  return {
    kind: project.kind === "organization" ? "org" : "child",
    orgId,
    orgTitle: org.title,
    orgSlug: org.slug,
    viewerRole,
    isOrgAdmin: viewerRole === "owner" || viewerRole === "admin",
    viewerChildIds,
    sharedPinIds: readSharedPins(org.orgSettings),
    notifyDefault: (org.orgSettings as { announcementNotify?: string } | null)?.announcementNotify === "email" ? "email" : "in_app",
    replyDefault: (org.orgSettings as { replyRule?: string } | null)?.replyRule === "logged_in" ? "logged_in" : "members",
    shareBlockedReason: project.kind === "organization" ? null : shareBlock({
      childVisibility: project.visibility ?? null,
      orgAllowsShare: (org.orgSettings as { childShare?: boolean } | null)?.childShare !== false,
    }),
  };
}

/**
 * SQL mirror of audienceAllows (and of app_private.nb_update_audience_ok): one audience rule for the feed, Overview
 * and the sidebar dot (decision 154). Only bare columns, so it works on its own or inside a join.
 */
export function audienceSql(ctx: Pick<OrgUpdateContext, "isOrgAdmin" | "viewerRole" | "viewerChildIds">, viewerId: string | null): SQL | undefined {
  if (ctx.isOrgAdmin) return undefined;
  const conditions: SQL[] = [sql`${workspaceUpdates.audience} = '{}'::jsonb`];
  if (viewerId) conditions.push(eq(workspaceUpdates.authorId, viewerId));
  if (ctx.viewerRole && ctx.viewerRole !== "owner") conditions.push(sql`${workspaceUpdates.audience}->'roles' @> to_jsonb(${ctx.viewerRole}::text)`);
  for (const childId of ctx.viewerChildIds) conditions.push(sql`${workspaceUpdates.audience}->'projectIds' @> to_jsonb(${childId}::text)`);
  return or(...conditions);
}

export type OrgFeedFilter = "all" | "announcement" | "discussion" | "from_projects";

/**
 * The org feed (report §17.5): the org's own posts the viewer's audience allows, plus posts shared up from
 * child projects that aren't Private. People outside the org only see public posts of public projects.
 */
export function orgFeedWhere(ctx: OrgUpdateContext, viewerId: string | null, filter: OrgFeedFilter): SQL {
  const inOrg = Boolean(ctx.viewerRole);
  const own = and(eq(workspaceUpdates.projectId, ctx.orgId), audienceSql(ctx, viewerId), inOrg ? undefined : eq(workspaceUpdates.visibility, "public"))!;
  const shared = and(
    isNotNull(workspaceUpdates.sharedToOrgAt),
    sql`${workspaceUpdates.projectId} IN (SELECT id FROM ${workspaces} WHERE parent_id = ${ctx.orgId} AND deleted_at IS NULL AND visibility <> 'private' ${inOrg ? sql`` : sql`AND visibility IN ('public', 'unlisted')`})`,
    inOrg ? undefined : eq(workspaceUpdates.visibility, "public"),
  )!;
  if (filter === "from_projects") return shared;
  if (filter === "announcement" || filter === "discussion") return and(own, eq(workspaceUpdates.updateType, filter))!;
  return or(own, shared)!;
}

/** Titles for the "From <project>" chip on shared posts. */
export async function readWorkspaceTitles(ids: string[]) {
  if (ids.length === 0) return new Map<string, { title: string; slug: string | null }>();
  const rows = await db.select({ id: workspaces.id, title: workspaces.title, slug: workspaces.slug }).from(workspaces).where(inArray(workspaces.id, ids));
  return new Map(rows.map((r) => [r.id, { title: r.title, slug: r.slug }]));
}

export async function readLastSeenUpdates(orgId: string, viewerId: string | null) {
  if (!viewerId) return null;
  const [row] = await db.select({ at: workspaceMembers.lastSeenUpdatesAt }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.projectId, orgId), eq(workspaceMembers.userId, viewerId))).limit(1);
  return row?.at?.toISOString() ?? null;
}

/** The newest live pinned announcement of a child project's org, for the "📌 CSE-3A · …" line (report §17.7). */
export async function readPinnedOrgLine(ctx: OrgUpdateContext, viewerId: string | null) {
  if (!ctx.viewerRole) return null; // outside people never see the org line
  const [row] = await db.select({ id: workspaceUpdates.id, content: workspaceUpdates.content })
    .from(workspaceUpdates)
    .where(and(
      eq(workspaceUpdates.projectId, ctx.orgId),
      eq(workspaceUpdates.isPinned, true),
      isNull(workspaceUpdates.deletedAt),
      or(isNull(workspaceUpdates.pinnedUntil), sql`${workspaceUpdates.pinnedUntil} > now()`),
      audienceSql(ctx, viewerId),
    ))
    .orderBy(sql`${workspaceUpdates.createdAt} DESC`)
    .limit(1);
  return row ? { id: row.id, content: row.content, orgTitle: ctx.orgTitle, orgSlug: ctx.orgSlug } : null;
}


/** Pinned-first in the org feed: the org's own live pins and the shared posts it pinned (a child's own pin stays in the child). */
export function orgLivePinSql(orgId: string): SQL<boolean> {
  return sql<boolean>`((${workspaceUpdates.isPinned} AND ${workspaceUpdates.projectId} = ${orgId} AND (${workspaceUpdates.pinnedUntil} IS NULL OR ${workspaceUpdates.pinnedUntil} > now()))
    OR (${workspaceUpdates.sharedToOrgAt} IS NOT NULL AND ${workspaceUpdates.id}::text IN (SELECT jsonb_array_elements_text(coalesce(org_settings->'sharedPins', '[]'::jsonb)) FROM workspaces WHERE id = ${orgId})))`;
}

export function readSharedPins(orgSettings: unknown): string[] {
  const pins = (orgSettings as { sharedPins?: unknown } | null)?.sharedPins;
  return Array.isArray(pins) ? pins.filter((id): id is string => typeof id === "string").slice(0, 3) : [];
}

/** How many people an audience reaches, for the composer's "Visible to … · notifies …" line (report §17.3). */
export async function countAudience(orgId: string, audience: UpdateAudience | null) {
  const roles = audience?.roles ?? [];
  const projectIds = audience?.projectIds ?? [];
  const [row] = await db.execute<{ n: number }>(sql`
    SELECT count(DISTINCT pm.user_id)::int AS n FROM workspace_members pm WHERE pm.workspace_id = ${orgId}
      AND (${roles.length === 0 && projectIds.length === 0}
        OR pm.role IN ('owner', 'admin')
        OR pm.role IN (SELECT jsonb_array_elements_text(${JSON.stringify(roles)}::jsonb))
        OR EXISTS (SELECT 1 FROM workspace_members c JOIN workspaces p ON p.id = c.workspace_id
          WHERE c.user_id = pm.user_id AND p.parent_id = ${orgId} AND p.id::text IN (SELECT jsonb_array_elements_text(${JSON.stringify(projectIds)}::jsonb))))`);
  return row?.n ?? 0;
}

/**
 * "Also post an announcement" when a sprint starts or an assignment is published (report §17.2): a plain
 * announcement to everyone, in-app, with the org's reply default.
 */
export async function postOrgAnnouncement(orgId: string, actorId: string, content: string) {
  const text = content.trim().slice(0, 5000);
  if (!text) return null;
  const [org] = await db.select({ settings: workspaces.orgSettings }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
  const replyPolicy = (org?.settings as { replyRule?: string } | null)?.replyRule === "logged_in" ? "logged_in" : "members";
  const [row] = await db.insert(workspaceUpdates).values({ projectId: orgId, authorId: actorId, content: text, updateType: "announcement", visibility: "members", replyPolicy, notifyLevel: "in_app" })
    .returning({ id: workspaceUpdates.id });
  if (!row) return null;
  const { notifyAnnouncement } = await import("@/lib/organizations/notify");
  await notifyAnnouncement({ orgId, updateId: row.id, actorId, content: text, audience: {}, email: false });
  return row.id;
}
