"use server";

import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { projects, projectTaskPolicyEvents } from "@/lib/db/schema";
import {
  canReadWorkspaceTab,
  getWorkspaceAccessById,
} from "@/lib/data/workspace-access";
import { consumeRateLimit } from "@/lib/security/rate-limit";

export async function getTaskCompletionPolicyAction(projectId: string) {
  try {
    z.string().uuid().parse(projectId);
    const { user } = await requireAuthenticatedUser();
    const access = await getWorkspaceAccessById(projectId, user?.id ?? null);
    if (
      !canReadWorkspaceTab(access, "tasks") &&
      !access.isOwner &&
      access.member?.role !== "admin"
    )
      throw new Error("You don’t have access to this");
    const project = await db.query.projects.findFirst({
      where: eq(projects.id, projectId),
      columns: { taskReviewRequired: true, taskCompletionPolicyVersion: true },
    });
    if (!project) throw new Error("Workspace not found");
    return {
      success: true as const,
      reviewRequired: project.taskReviewRequired,
      version: project.taskCompletionPolicyVersion,
      canManage: access.isOwner || access.member?.role === "admin",
    };
  } catch (error) {
    return {
      success: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Couldn’t load completion settings",
    };
  }
}

export async function updateTaskCompletionPolicyAction(input: {
  projectId: string;
  reviewRequired: boolean;
  expectedVersion: number;
}) {
  try {
    const data = z
      .object({
        projectId: z.string().uuid(),
        reviewRequired: z.boolean(),
        expectedVersion: z.number().int().nonnegative(),
      })
      .parse(input);
    const { user } = await requireAuthenticatedUser();
    if (!user) throw new Error("Sign in to continue");
    if (!(await consumeRateLimit(`task-policy:${user.id}`, 30, 60)).allowed)
      throw new Error("Too many attempts. Try again in a minute.");
    const version = await db.transaction(async (tx) => {
      const [row] = await tx.execute<{
        owner_id: string;
        role: string | null;
        task_review_required: boolean;
        task_completion_policy_version: number;
      }>(sql`
        SELECT p.owner_id, m.role, p.task_review_required, p.task_completion_policy_version
        FROM projects p LEFT JOIN project_members m ON m.project_id = p.id AND m.user_id = ${user.id}
        WHERE p.id = ${data.projectId} AND p.deleted_at IS NULL FOR UPDATE OF p
      `);
      if (!row || (row.owner_id !== user.id && row.role !== "admin"))
        throw new Error("Only the owner and admins can change completion settings");
      if (row.task_completion_policy_version !== data.expectedVersion)
        throw new Error("Settings changed elsewhere. Reload and try again.");
      if (row.task_review_required === data.reviewRequired)
        return row.task_completion_policy_version;
      const next = row.task_completion_policy_version + 1;
      await tx
        .update(projects)
        .set({
          taskReviewRequired: data.reviewRequired,
          taskCompletionPolicyVersion: next,
        })
        .where(
          and(
            eq(projects.id, data.projectId),
            eq(projects.taskCompletionPolicyVersion, data.expectedVersion),
          ),
        );
      await tx
        .insert(projectTaskPolicyEvents)
        .values({
          projectId: data.projectId,
          actorId: user.id,
          reviewRequired: data.reviewRequired,
          policyVersion: next,
        });
      return next;
    });
    revalidatePath(`/workspaces/${data.projectId}`);
    return {
      success: true as const,
      reviewRequired: data.reviewRequired,
      version,
    };
  } catch (error) {
    return {
      success: false as const,
      error:
        error instanceof Error
          ? error.message
          : "Couldn’t save completion settings",
    };
  }
}
