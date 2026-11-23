"use server";

import { eq, sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { LABEL_SETTINGS } from "@/lib/agents/via-visibility";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { consumeRateLimit } from "@/lib/security/rate-limit";

/** What AI agents may do in this workspace and whether they're paused (report §26.6, §18.5). */
export async function getWorkspaceAgentSettingsAction(projectId: string) {
  try {
    z.string().uuid().parse(projectId);
    const { user } = await requireAuthenticatedUser();
    const access = await getWorkspaceAccessById(projectId, user?.id ?? null);
    if (!access.isOwner && access.member?.role !== "admin") throw new Error("Only the owner and admins can see agent settings");
    const [row] = await db.select({ policy: workspaces.agentPolicy, pausedAt: workspaces.agentsPausedAt, labels: workspaces.agentLabelVisibility, membersChooseLabels: workspaces.membersChooseLabels, kind: workspaces.kind, parentId: workspaces.parentId })
      .from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
    if (!row) throw new Error("Workspace not found");
    return {
      success: true as const, policy: row.policy, paused: Boolean(row.pausedAt),
      // "Show when agents helped" (report Part B): only the owner chooses; inside an organization its staff still
      // see labels where the class asks.
      labels: row.labels, membersChooseLabels: row.membersChooseLabels, canChangeLabels: access.isOwner, inOrganization: row.kind === "organization" || Boolean(row.parentId),
    };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t load agent settings" };
  }
}

const updateSchema = z.object({
  projectId: z.string().uuid(),
  policy: z.enum(["ask_important", "ask_all", "trust_drafts_docs"]).optional(),
  paused: z.boolean().optional(),
  labels: z.enum(LABEL_SETTINGS).optional(),
  /** Member settings §2 "Let members choose": each member may hide the label on their own work (stricter only). */
  membersChooseLabels: z.boolean().optional(),
});

export async function updateWorkspaceAgentSettingsAction(input: z.infer<typeof updateSchema>) {
  try {
    const data = updateSchema.parse(input);
    const { user, tokenScopes } = await requireAuthenticatedUser();
    if (!user) throw new Error("Sign in to continue");
    // A token, an agent's above all, can't loosen its own rules.
    if (tokenScopes) throw new Error("Change agent settings in the app");
    if (!(await consumeRateLimit(`agent-policy:${user.id}`, 30, 60)).allowed) throw new Error("Too many attempts. Try again in a minute.");
    const access = await getWorkspaceAccessById(data.projectId, user.id);
    if (!access.isOwner && access.member?.role !== "admin") throw new Error("Only the owner and admins can change agent settings");
    if ((data.labels || data.membersChooseLabels !== undefined) && !access.isOwner) throw new Error("Only the owner chooses who sees when agents helped");
    const [row] = await db
      .update(workspaces)
      .set({
        ...(data.policy ? { agentPolicy: data.policy } : {}),
        ...(data.paused === undefined ? {} : { agentsPausedAt: data.paused ? sql`now()` : null }),
        ...(data.labels ? { agentLabelVisibility: data.labels } : {}),
        ...(data.membersChooseLabels === undefined ? {} : { membersChooseLabels: data.membersChooseLabels }),
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, data.projectId))
      .returning({ policy: workspaces.agentPolicy, pausedAt: workspaces.agentsPausedAt, labels: workspaces.agentLabelVisibility, membersChooseLabels: workspaces.membersChooseLabels });
    if (!row) throw new Error("Workspace not found");
    return { success: true as const, policy: row.policy, paused: Boolean(row.pausedAt), labels: row.labels, membersChooseLabels: row.membersChooseLabels };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t save agent settings" };
  }
}
