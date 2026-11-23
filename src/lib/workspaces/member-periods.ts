import "server-only";

import { and, desc, eq, isNull } from "drizzle-orm";

import { profileContributionStages } from "@/lib/db/schema";
import type { WorkspaceCollaboratorExecutor } from "@/lib/workspaces/collaborator-lifecycle";

/**
 * When a person's current period in a workspace began (member settings §6): the open profile stage's start, which a
 * reopened part restarts, else their join date. Finished periods are stored in workspace_member_periods.
 */
export async function currentPeriodStart(executor: WorkspaceCollaboratorExecutor, projectId: string, userId: string, fallback: Date) {
    const [open] = await executor.select({ startedAt: profileContributionStages.startedAt }).from(profileContributionStages)
        .where(and(eq(profileContributionStages.projectId, projectId), eq(profileContributionStages.profileId, userId), isNull(profileContributionStages.endedAt), isNull(profileContributionStages.deletedAt)))
        .orderBy(desc(profileContributionStages.startedAt)).limit(1);
    return open?.startedAt ?? fallback;
}
