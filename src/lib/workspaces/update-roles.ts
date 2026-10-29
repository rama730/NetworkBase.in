import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { profileContributionStages, profileContributions, profiles, workspaces } from "@/lib/db/schema";
import { isGenericWorkspaceUpdateRoleTitle, sanitizeWorkspaceUpdateRoleTitle } from "@/lib/workspaces/updates";

export type RoleTitleTarget = { projectId: string; userId: string | null | undefined };

/** The key a title is stored under in the map `readWorkspaceRoleTitles` returns. */
export const roleTitleKey = (projectId: string, userId: string) => `${projectId}:${userId}`;

function specificTitle(value: unknown) {
    const title = sanitizeWorkspaceUpdateRoleTitle(value);
    return title && !isGenericWorkspaceUpdateRoleTitle(title) ? title : null;
}

/**
 * The job title to show beside someone's name on a project update, for any number of (project, person) pairs
 * in a fixed number of queries. The Updates tab and the Discover feed both call this, so the same update can
 * never carry two different labels. Order of trust: the title on an active contribution stage, then on the
 * contribution, then the owner's "lead focus", then (last) the profile headline.
 */
export async function readWorkspaceRoleTitles(targets: RoleTitleTarget[]): Promise<Map<string, string>> {
    const wanted = new Set<string>();
    for (const { projectId, userId } of targets) if (projectId && userId) wanted.add(roleTitleKey(projectId, userId));
    const titles = new Map<string, string>();
    if (wanted.size === 0) return titles;

    const projectIds = [...new Set(targets.filter((t) => t.userId).map((t) => t.projectId))];
    const userIds = [...new Set(targets.flatMap((t) => (t.userId ? [t.userId] : [])))];
    const setIfEmpty = (projectId: string | null, userId: string | null, value: unknown) => {
        if (!projectId || !userId) return;
        const key = roleTitleKey(projectId, userId);
        if (!wanted.has(key) || titles.has(key)) return;
        const title = specificTitle(value);
        if (title) titles.set(key, title);
    };

    const [stageRows, contributionRows, projectRows, profileRows] = await Promise.all([
        db
            .select({
                projectId: profileContributionStages.projectId,
                userId: profileContributionStages.profileId,
                roleTitle: profileContributionStages.roleTitle,
            })
            .from(profileContributionStages)
            .innerJoin(profileContributions, eq(profileContributions.id, profileContributionStages.contributionId))
            .where(and(
                inArray(profileContributionStages.projectId, projectIds),
                inArray(profileContributionStages.profileId, userIds),
                isNull(profileContributionStages.deletedAt),
                isNull(profileContributionStages.endedAt),
                isNull(profileContributions.deletedAt),
                isNull(profileContributions.endedAt),
                eq(profileContributions.visibility, "public"),
            ))
            .orderBy(
                sql`${profileContributionStages.verifiedAt} DESC NULLS LAST`,
                sql`${profileContributionStages.startedAt} DESC NULLS LAST`,
                desc(profileContributionStages.updatedAt),
            ),
        db
            .select({
                projectId: profileContributions.projectId,
                userId: profileContributions.profileId,
                roleTitle: profileContributions.roleTitle,
            })
            .from(profileContributions)
            .where(and(
                inArray(profileContributions.projectId, projectIds),
                inArray(profileContributions.profileId, userIds),
                isNull(profileContributions.deletedAt),
                isNull(profileContributions.endedAt),
                eq(profileContributions.visibility, "public"),
            ))
            .orderBy(sql`${profileContributions.verifiedAt} DESC NULLS LAST`, desc(profileContributions.updatedAt)),
        db
            .select({
                id: workspaces.id,
                ownerId: workspaces.ownerId,
                leadFocus: sql<string | null>`${workspaces.importSource}->'metadata'->>'leadFocus'`,
            })
            .from(workspaces)
            .where(and(inArray(workspaces.id, projectIds), isNull(workspaces.deletedAt))),
        db.select({ id: profiles.id, headline: profiles.headline }).from(profiles).where(inArray(profiles.id, userIds)),
    ]);

    for (const row of stageRows) setIfEmpty(row.projectId, row.userId, row.roleTitle);
    for (const row of contributionRows) setIfEmpty(row.projectId, row.userId, row.roleTitle);
    for (const row of projectRows) setIfEmpty(row.id, row.ownerId, row.leadFocus);
    const headlines = new Map(profileRows.map((row) => [row.id, row.headline]));
    for (const { projectId, userId } of targets) if (userId) setIfEmpty(projectId, userId, headlines.get(userId));
    return titles;
}
