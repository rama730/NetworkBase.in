import "server-only";

import { and, eq } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";

import type { LabelScope } from "@/lib/agents/via-visibility";
import { db } from "@/lib/db";
import { tasks, workspaceMembers, workspaces } from "@/lib/db/schema";
import { effectiveAiPolicy } from "@/lib/organizations/assignment-rules";
import { readViewerOrgRole } from "@/lib/organizations/detail";
import { readOrgWork } from "@/lib/organizations/settings";

export { visibleVia, visibleViaOfPayload } from "@/lib/agents/via-visibility";

/**
 * What decides labels for one viewer in one workspace (report Part B): the owner's setting, and whether the
 * organization's AI policy (the assignment's when `taskId` is an assignment copy) keeps it visible to its staff.
 * A workspace that can't be found shows nothing.
 */
export async function labelScope(viewerId: string | null, workspaceId: string, taskId?: string | null): Promise<LabelScope> {
  const org = alias(workspaces, "label_org");
  const [w] = await db
    .select({ setting: workspaces.agentLabelVisibility, membersChoose: workspaces.membersChooseLabels, kind: workspaces.kind, own: workspaces.orgSettings, ownType: workspaces.orgType, orgId: org.id, orgSettings: org.orgSettings, orgType: org.orgType })
    .from(workspaces)
    .leftJoin(org, and(eq(org.id, workspaces.parentId), eq(org.kind, "organization")))
    .where(eq(workspaces.id, workspaceId))
    .limit(1);
  if (!w) return { setting: "none", orgForced: false, viewerId, viewerStaff: false };
  const hiddenAuthors = w.membersChoose ? new Set((await db.select({ id: workspaceMembers.userId }).from(workspaceMembers)
    .where(and(eq(workspaceMembers.projectId, workspaceId), eq(workspaceMembers.hideAgentLabel, true)))).map((r) => r.id)) : undefined;
  const isOrg = w.kind === "organization";
  const orgId = isOrg ? workspaceId : w.orgId;
  if (!orgId) return { setting: w.setting, orgForced: false, viewerId, viewerStaff: false, hiddenAuthors };
  let policy = readOrgWork(isOrg ? w.own : w.orgSettings, isOrg ? w.ownType : w.orgType).aiPolicy;
  if (taskId) {
    const master = alias(tasks, "label_master");
    const [t] = await db.select({ settings: master.assignmentSettings, own: tasks.assignmentSettings }).from(tasks)
      .leftJoin(master, eq(master.id, tasks.assignmentId)).where(eq(tasks.id, taskId)).limit(1);
    const settings = t?.settings ?? t?.own;
    if (settings) policy = effectiveAiPolicy(settings, policy);
  }
  const orgForced = policy === "labelled" || policy === "not_allowed";
  const role = orgForced ? await readViewerOrgRole(orgId, viewerId) : null;
  return { setting: w.setting, orgForced, viewerId, viewerStaff: role === "owner" || role === "admin", hiddenAuthors };
}

/** One scope per task in a workspace, read once each: for lists that mix tasks (activity). */
export function labelScopes(viewerId: string | null, workspaceId: string) {
  const cache = new Map<string, Promise<LabelScope>>();
  return (taskId?: string | null) => {
    const key = taskId ?? "";
    if (!cache.has(key)) cache.set(key, labelScope(viewerId, workspaceId, taskId));
    return cache.get(key)!;
  };
}
