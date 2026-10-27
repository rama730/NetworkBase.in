import "server-only";

import { and, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { projectMembers, projectUpdates, projects } from "@/lib/db/schema";
import { organizationsEnabled } from "@/lib/organizations/config";
import { readViewerOrgRole, type OrgMemberRoleOrNone } from "@/lib/organizations/detail";
import { shareBlock } from "@/lib/organizations/update-rules";

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
};

export async function readOrgUpdateContext(project: { id: string; kind?: string | null; parentId?: string | null; visibility?: string | null }, viewerId: string | null): Promise<OrgUpdateContext | null> {
  const orgId = project.kind === "organization" ? project.id : project.parentId ?? null;
  if (!orgId || !organizationsEnabled()) return null;
  const [org] = await db.select({ title: projects.title, slug: projects.slug, orgSettings: projects.orgSettings })
    .from(projects).where(and(eq(projects.id, orgId), eq(projects.kind, "organization"), isNull(projects.deletedAt))).limit(1);
  if (!org) return null;
  const viewerRole = await readViewerOrgRole(orgId, viewerId);
  const viewerChildIds = viewerId
    ? (await db.select({ id: projects.id }).from(projects)
      .innerJoin(projectMembers, and(eq(projectMembers.projectId, projects.id), eq(projectMembers.userId, viewerId)))
      .where(and(eq(projects.parentId, orgId), isNull(projects.deletedAt)))).map((r) => r.id)
    : [];
  return {
    kind: project.kind === "organization" ? "org" : "child",
    orgId,
    orgTitle: org.title,
    orgSlug: org.slug,
    viewerRole,
    isOrgAdmin: viewerRole === "owner" || viewerRole === "admin",
    viewerChildIds,
    shareBlockedReason: project.kind === "organization" ? null : shareBlock({
      childVisibility: project.visibility ?? null,
      orgAllowsShare: (org.orgSettings as { childShare?: boolean } | null)?.childShare !== false,
    }),
  };
}

/** SQL mirror of audienceAllows for the feed (and of app_private.nb_update_audience_ok). */
function audienceSql(ctx: OrgUpdateContext, viewerId: string | null): SQL | undefined {
  if (ctx.isOrgAdmin) return undefined;
  const conditions: SQL[] = [sql`${projectUpdates.audience} = '{}'::jsonb`];
  if (viewerId) conditions.push(eq(projectUpdates.authorId, viewerId));
  if (ctx.viewerRole && ctx.viewerRole !== "owner") conditions.push(sql`${projectUpdates.audience}->'roles' @> to_jsonb(${ctx.viewerRole}::text)`);
  for (const childId of ctx.viewerChildIds) conditions.push(sql`${projectUpdates.audience}->'projectIds' @> to_jsonb(${childId}::text)`);
  return or(...conditions);
}

export type OrgFeedFilter = "all" | "announcement" | "discussion" | "from_projects";

/**
 * The org feed (report §17.5): the org's own posts the viewer's audience allows, plus posts shared up from
 * child projects that aren't Private. People outside the org only see public posts of public projects.
 */
export function orgFeedWhere(ctx: OrgUpdateContext, viewerId: string | null, filter: OrgFeedFilter): SQL {
  const inOrg = Boolean(ctx.viewerRole);
  const own = and(eq(projectUpdates.projectId, ctx.orgId), audienceSql(ctx, viewerId), inOrg ? undefined : eq(projectUpdates.visibility, "public"))!;
  const shared = and(
    isNotNull(projectUpdates.sharedToOrgAt),
    sql`${projectUpdates.projectId} IN (SELECT id FROM ${projects} WHERE parent_id = ${ctx.orgId} AND deleted_at IS NULL AND visibility <> 'private' ${inOrg ? sql`` : sql`AND visibility IN ('public', 'unlisted')`})`,
    inOrg ? undefined : eq(projectUpdates.visibility, "public"),
  )!;
  if (filter === "from_projects") return shared;
  if (filter === "announcement" || filter === "discussion") return and(own, eq(projectUpdates.updateType, filter))!;
  return or(own, shared)!;
}

/** Titles for the "From <project>" chip on shared posts. */
export async function readProjectTitles(ids: string[]) {
  if (ids.length === 0) return new Map<string, { title: string; slug: string | null }>();
  const rows = await db.select({ id: projects.id, title: projects.title, slug: projects.slug }).from(projects).where(inArray(projects.id, ids));
  return new Map(rows.map((r) => [r.id, { title: r.title, slug: r.slug }]));
}

export async function readLastSeenUpdates(orgId: string, viewerId: string | null) {
  if (!viewerId) return null;
  const [row] = await db.select({ at: projectMembers.lastSeenUpdatesAt }).from(projectMembers)
    .where(and(eq(projectMembers.projectId, orgId), eq(projectMembers.userId, viewerId))).limit(1);
  return row?.at?.toISOString() ?? null;
}

/** The newest live pinned announcement of a child project's org, for the "📌 CSE-3A · …" line (report §17.7). */
export async function readPinnedOrgLine(ctx: OrgUpdateContext, viewerId: string | null) {
  if (!ctx.viewerRole) return null; // outside people never see the org line
  const [row] = await db.select({ id: projectUpdates.id, content: projectUpdates.content })
    .from(projectUpdates)
    .where(and(
      eq(projectUpdates.projectId, ctx.orgId),
      eq(projectUpdates.isPinned, true),
      isNull(projectUpdates.deletedAt),
      or(isNull(projectUpdates.pinnedUntil), sql`${projectUpdates.pinnedUntil} > now()`),
      audienceSql(ctx, viewerId),
    ))
    .orderBy(sql`${projectUpdates.createdAt} DESC`)
    .limit(1);
  return row ? { id: row.id, content: row.content, orgTitle: ctx.orgTitle, orgSlug: ctx.orgSlug } : null;
}


/** Pinned-first in the org feed: the org's own live pins only (a child's pin stays in the child). */
export function orgLivePinSql(orgId: string): SQL<boolean> {
  return sql<boolean>`(${projectUpdates.isPinned} AND ${projectUpdates.projectId} = ${orgId} AND (${projectUpdates.pinnedUntil} IS NULL OR ${projectUpdates.pinnedUntil} > now()))`;
}
