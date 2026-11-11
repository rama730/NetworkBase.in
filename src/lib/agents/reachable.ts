import "server-only";

import { and, eq, isNull, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import { db } from "@/lib/db";
import { workspaceMembers, workspaces } from "@/lib/db/schema";
import { allowsAgentTokens } from "@/lib/organizations/settings";

/**
 * Which workspaces a token's lists may show (report A5): null = no filter (a person's own sign-in), one workspace for
 * a one-workspace token, and for an "All my workspaces" agent every workspace the person belongs to except those that
 * paused agents or whose organization turned them off.
 */
export async function agentWorkspaceFilter(auth: { user: { id: string } | null; tokenWorkspaceId?: string | null; tokenAllWorkspaces?: boolean }): Promise<Set<string> | null> {
  if (auth.tokenWorkspaceId) return new Set([auth.tokenWorkspaceId]);
  if (!auth.tokenAllWorkspaces || !auth.user) return null;
  const org = alias(workspaces, "reach_org");
  const rows = await db
    .select({ id: workspaces.id, kind: workspaces.kind, pausedAt: workspaces.agentsPausedAt, own: workspaces.orgSettings, orgSettings: org.orgSettings })
    .from(workspaces)
    .leftJoin(workspaceMembers, and(eq(workspaceMembers.projectId, workspaces.id), eq(workspaceMembers.userId, auth.user.id)))
    .leftJoin(org, and(eq(org.id, workspaces.parentId), eq(org.kind, "organization")))
    .where(and(isNull(workspaces.deletedAt), or(eq(workspaces.ownerId, auth.user.id), eq(workspaceMembers.userId, auth.user.id))));
  return new Set(rows.filter((r) => !r.pausedAt && allowsAgentTokens(r.kind === "organization" ? r.own : r.orgSettings)).map((r) => r.id));
}
