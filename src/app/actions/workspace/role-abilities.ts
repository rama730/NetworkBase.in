"use server";

import { eq } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { normalizeRoleAbilities, type RoleAbilities } from "@/lib/workspaces/role-abilities";

/** Settings → Roles (member settings Part 4): what the owner changed from today's rules, and whether they can change it. */
export async function readRoleAbilitiesAction(projectId: string) {
  try {
    z.string().uuid().parse(projectId);
    const { user } = await requireAuthenticatedUser();
    const access = await getWorkspaceAccessById(projectId, user?.id ?? null);
    if (!access.project || !access.canRead) throw new Error("Workspace not found");
    const orgRules = access.project.kind === "organization" || Boolean(access.project.parentId);
    return { success: true as const, abilities: normalizeRoleAbilities(access.project.roleAbilities), canChange: access.isOwner && !orgRules, orgRules };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t load the roles" };
  }
}

/** Only the owner; only cells the rules allow (viewers never get write abilities); organizations keep their own table. */
export async function updateRoleAbilitiesAction(projectId: string, abilities: RoleAbilities | null) {
  try {
    z.string().uuid().parse(projectId);
    const { user, tokenScopes } = await requireAuthenticatedUser();
    if (!user) throw new Error("Sign in to continue");
    if (tokenScopes) throw new Error("Change roles in the app");
    if (!(await consumeRateLimit(`role-abilities:${user.id}`, 30, 60)).allowed) throw new Error("Too many attempts. Try again in a minute.");
    const access = await getWorkspaceAccessById(projectId, user.id);
    if (!access.project || !access.isOwner) throw new Error("Only the owner decides what each role can do");
    if (access.project.kind === "organization" || access.project.parentId) throw new Error("Your organization’s permission table decides this here");
    const next = normalizeRoleAbilities(abilities);
    await db.update(workspaces).set({ roleAbilities: next as never, updatedAt: new Date() }).where(eq(workspaces.id, projectId));
    return { success: true as const, abilities: next };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t save the roles" };
  }
}
