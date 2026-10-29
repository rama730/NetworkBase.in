import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { profileProjectContributionStages, profileProjectContributions, profiles, projects } from "@/lib/db/schema";
import { isGenericProjectUpdateRoleTitle, sanitizeProjectUpdateRoleTitle } from "@/lib/workspaces/updates";

export type RoleTitleTarget = { projectId: string; userId: string | null | undefined };

/** The key a title is stored under in the map `readProjectRoleTitles` returns. */
export const roleTitleKey = (projectId: string, userId: string) => `${projectId}:${userId}`;

function specificTitle(value: unknown) {
    const title = sanitizeProjectUpdateRoleTitle(value);
    return title && !isGenericProjectUpdateRoleTitle(title) ? title : null;
}

/**
 * The job title to show beside someone's name on a project update, for any number of (project, person) pairs
 * in a fixed number of queries. The Updates tab and the Discover feed both call this, so the same update can
 * never carry two different labels. Order of trust: the title on an active contribution stage, then on the
 * contribution, then the owner's "lead focus", then (last) the profile headline.
 */
export async function readProjectRoleTitles(targets: RoleTitleTarget[]): Promise<Map<string, string>> {
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
                projectId: profileProjectContributionStages.projectId,
                userId: profileProjectContributionStages.profileId,
                roleTitle: profileProjectContributionStages.roleTitle,
            })
            .from(profileProjectContributionStages)
            .innerJoin(profileProjectContributions, eq(profileProjectContributions.id, profileProjectContributionStages.contributionId))
            .where(and(
                inArray(profileProjectContributionStages.projectId, projectIds),
                inArray(profileProjectContributionStages.profileId, userIds),
                isNull(profileProjectContributionStages.deletedAt),
                isNull(profileProjectContributionStages.endedAt),
                isNull(profileProjectContributions.deletedAt),
                isNull(profileProjectContributions.endedAt),
                eq(profileProjectContributions.visibility, "public"),
            ))
            .orderBy(
                sql`${profileProjectContributionStages.verifiedAt} DESC NULLS LAST`,
                sql`${profileProjectContributionStages.startedAt} DESC NULLS LAST`,
                desc(profileProjectContributionStages.updatedAt),
            ),
        db
            .select({
                projectId: profileProjectContributions.projectId,
                userId: profileProjectContributions.profileId,
                roleTitle: profileProjectContributions.roleTitle,
            })
            .from(profileProjectContributions)
            .where(and(
                inArray(profileProjectContributions.projectId, projectIds),
                inArray(profileProjectContributions.profileId, userIds),
                isNull(profileProjectContributions.deletedAt),
                isNull(profileProjectContributions.endedAt),
                eq(profileProjectContributions.visibility, "public"),
            ))
            .orderBy(sql`${profileProjectContributions.verifiedAt} DESC NULLS LAST`, desc(profileProjectContributions.updatedAt)),
        db
            .select({
                id: projects.id,
                ownerId: projects.ownerId,
                leadFocus: sql<string | null>`${projects.importSource}->'metadata'->>'leadFocus'`,
            })
            .from(projects)
            .where(and(inArray(projects.id, projectIds), isNull(projects.deletedAt))),
        db.select({ id: profiles.id, headline: profiles.headline }).from(profiles).where(inArray(profiles.id, userIds)),
    ]);

    for (const row of stageRows) setIfEmpty(row.projectId, row.userId, row.roleTitle);
    for (const row of contributionRows) setIfEmpty(row.projectId, row.userId, row.roleTitle);
    for (const row of projectRows) setIfEmpty(row.id, row.ownerId, row.leadFocus);
    const headlines = new Map(profileRows.map((row) => [row.id, row.headline]));
    for (const { projectId, userId } of targets) if (userId) setIfEmpty(projectId, userId, headlines.get(userId));
    return titles;
}
