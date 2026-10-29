import "server-only";

import { and, eq, inArray, isNotNull, isNull, or, sql, type SQL } from "drizzle-orm";

import { db } from "@/lib/db";
import { projectMembers, projectUpdates, projects } from "@/lib/db/schema";
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
    sharedPinIds: readSharedPins(org.orgSettings),
    notifyDefault: (org.orgSettings as { announcementNotify?: string } | null)?.announcementNotify === "email" ? "email" : "in_app",
    replyDefault: (org.orgSettings as { replyRule?: string } | null)?.replyRule === "logged_in" ? "logged_in" : "members",
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
export async function readWorkspaceTitles(ids: string[]) {
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


/** Pinned-first in the org feed: the org's own live pins and the shared posts it pinned (a child's own pin stays in the child). */
export function orgLivePinSql(orgId: string): SQL<boolean> {
  return sql<boolean>`((${projectUpdates.isPinned} AND ${projectUpdates.projectId} = ${orgId} AND (${projectUpdates.pinnedUntil} IS NULL OR ${projectUpdates.pinnedUntil} > now()))
    OR (${projectUpdates.sharedToOrgAt} IS NOT NULL AND ${projectUpdates.id}::text IN (SELECT jsonb_array_elements_text(coalesce(org_settings->'sharedPins', '[]'::jsonb)) FROM projects WHERE id = ${orgId})))`;
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
    SELECT count(DISTINCT pm.user_id)::int AS n FROM project_members pm WHERE pm.project_id = ${orgId}
      AND (${roles.length === 0 && projectIds.length === 0}
        OR pm.role IN ('owner', 'admin')
        OR pm.role IN (SELECT jsonb_array_elements_text(${JSON.stringify(roles)}::jsonb))
        OR EXISTS (SELECT 1 FROM project_members c JOIN projects p ON p.id = c.project_id
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
  const [org] = await db.select({ settings: projects.orgSettings }).from(projects).where(eq(projects.id, orgId)).limit(1);
  const replyPolicy = (org?.settings as { replyRule?: string } | null)?.replyRule === "logged_in" ? "logged_in" : "members";
  const [row] = await db.insert(projectUpdates).values({ projectId: orgId, authorId: actorId, content: text, updateType: "announcement", visibility: "members", replyPolicy, notifyLevel: "in_app" })
    .returning({ id: projectUpdates.id });
  if (!row) return null;
  const { notifyAnnouncement } = await import("@/lib/organizations/notify");
  await notifyAnnouncement({ orgId, updateId: row.id, actorId, content: text, audience: {}, email: false });
  return row.id;
}
