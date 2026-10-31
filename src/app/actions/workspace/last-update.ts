"use server";

import { and, eq, inArray, isNull, sql } from "drizzle-orm";

import { getWorkspaceAccessByIds } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { profiles, workspaces } from "@/lib/db/schema";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { isUuid } from "@/lib/validations/uuid";
import { lastUpdateName, type WorkspaceLastUpdate } from "@/lib/workspaces/last-update";

const MAX_BATCH = 100;

/** Who last did real work in the workspaces the viewer can read (drafts and private ones only for members). */
export async function getWorkspaceLastUpdates(input: { projectIds: string[] }): Promise<WorkspaceLastUpdate[]> {
  const user = await getAuthUser();
  const ids = Array.from(new Set((Array.isArray(input?.projectIds) ? input.projectIds : []).filter(isUuid))).slice(0, MAX_BATCH);
  if (ids.length === 0) return [];
  const access = await getWorkspaceAccessByIds(ids, user?.id ?? null);
  const readable = ids.filter((id) => access[id]?.canRead);
  if (readable.length === 0) return [];
  const found = await db.select({
    id: workspaces.id,
    at: workspaces.lastUpdateAt,
    fullName: profiles.fullName,
    username: profiles.username,
    visibility: profiles.visibility,
    blocked: user ? sql<boolean>`app_private.blocked_between(${user.id}::uuid, ${profiles.id})` : sql<boolean>`false`,
  }).from(workspaces)
    .leftJoin(profiles, and(eq(profiles.id, workspaces.lastUpdateBy), isNull(profiles.deletedAt)))
    .where(and(inArray(workspaces.id, readable), isNull(workspaces.deletedAt)));
  return found.map((row) => ({
    projectId: row.id,
    at: row.at.toISOString(),
    byName: lastUpdateName(row, Boolean(access[row.id]?.isOwner || access[row.id]?.isMember)),
  }));
}
