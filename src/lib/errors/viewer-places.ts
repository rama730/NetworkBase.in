import "server-only";

import { and, desc, eq, isNull, isNotNull, or } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import type { Place } from "@/lib/errors/suggest";

/**
 * The workspaces and organizations the viewer owns or belongs to, for "Did you mean" on a 404. Signed-in viewers only
 * (bots and visitors never reach this), at most 200 rows, so a 404 never suggests a place the viewer can't open.
 */
export async function readViewerPlaces(userId: string): Promise<Place[]> {
  const rows = await db
    .selectDistinct({ slug: workspaces.slug, title: workspaces.title, kind: workspaces.kind, updatedAt: workspaces.updatedAt })
    .from(workspaces)
    .leftJoin(workspaceMembers, and(eq(workspaceMembers.projectId, workspaces.id), eq(workspaceMembers.userId, userId)))
    .where(and(isNull(workspaces.deletedAt), isNotNull(workspaces.slug), or(eq(workspaces.ownerId, userId), eq(workspaceMembers.userId, userId))))
    .orderBy(desc(workspaces.updatedAt))
    .limit(200);
  return rows.map((row) => ({ slug: row.slug!, title: row.title, kind: row.kind === "organization" ? "organization" : "workspace" }));
}
