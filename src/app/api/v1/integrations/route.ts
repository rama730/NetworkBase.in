import { and, desc, eq, isNotNull, isNull, or, sql } from "drizzle-orm";
import { enforceRouteLimit, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { projects, projectMembers, githubSyncConnections } from "@/lib/db/schema";
import { getLatestPasswordChangeAt } from "@/lib/security/audit";
import { resolveGithubExternalAccountHealth } from "@/lib/github/account-health";
import { buildGithubAccountConnectionState } from "@/lib/github/connection-state";
import { buildIntegrationsData } from "@/lib/settings/integrations";
import { toIsoString } from "@/lib/utils/date";
import { logger } from "@/lib/logger";

export async function GET(request: Request) {
    const auth = await requireAuthenticatedUser();
    if (!auth.user || auth.response) {
        return auth.response || new Response("Unauthorized", { status: 401 });
    }

    const { user } = auth;
    const limited = await enforceRouteLimit(request, "api:v1:integrations:get", 60, 60, "default", user.id);
    if (limited) return limited;

    try {
        const identitiesResult = await db.execute<{
            id: string;
            provider: string;
            identity_data: Record<string, unknown> | null;
        }>(
            sql`SELECT id, provider, identity_data FROM auth.identities WHERE user_id = ${user.id}::uuid ORDER BY last_sign_in_at DESC NULLS LAST, created_at DESC`,
        ).catch(() => null);

        const liveIdentities = identitiesResult && Array.isArray(identitiesResult)
            ? identitiesResult.map((row) => ({
                id: String(row.id),
                provider: String(row.provider),
                identity_data: (row.identity_data || {}) as Record<string, unknown>,
            }))
            : [];

        const effectiveUser = liveIdentities.length > 0
            ? { ...user, identities: liveIdentities as any }
            : user;

        const githubConnection = buildGithubAccountConnectionState(effectiveUser);
        const githubAccountHealthPromise = resolveGithubExternalAccountHealth({
            linked: githubConnection.linked,
            githubId: githubConnection.githubId,
            username: githubConnection.username,
        });

        const githubProjectRows = await db
            .select({
                id: projects.id,
                slug: projects.slug,
                title: projects.title,
                importSource: projects.importSource,
                githubRepoUrl: projects.githubRepoUrl,
                githubLastSyncAt: projects.githubLastSyncAt,
                syncRepository: githubSyncConnections.repository,
                syncBranch: githubSyncConnections.branch,
            })
            .from(projects)
            .leftJoin(githubSyncConnections, eq(projects.id, githubSyncConnections.projectId))
            .where(
                and(
                    sql`(${projects.ownerId} = ${user.id} OR exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.userId} = ${user.id}))`,
                    isNull(projects.deletedAt),
                    or(
                        isNotNull(projects.githubRepoUrl),
                        isNotNull(githubSyncConnections.projectId),
                        sql`${projects.importSource}->>'type' = 'github'`,
                    ),
                ),
            )
            .orderBy(desc(projects.updatedAt))
            .limit(25);
        // The list shows 25; the count says how many there really are.
        const [{ total: githubProjectTotal = 0 } = { total: 0 }] = await db
            .select({ total: sql<number>`count(*)::int` })
            .from(projects)
            .leftJoin(githubSyncConnections, eq(projects.id, githubSyncConnections.projectId))
            .where(
                and(
                    sql`(${projects.ownerId} = ${user.id} OR exists (select 1 from ${projectMembers} where ${projectMembers.projectId} = ${projects.id} and ${projectMembers.userId} = ${user.id}))`,
                    isNull(projects.deletedAt),
                    or(
                        isNotNull(projects.githubRepoUrl),
                        isNotNull(githubSyncConnections.projectId),
                        sql`${projects.importSource}->>'type' = 'github'`,
                    ),
                ),
            );

        const githubProjects = githubProjectRows.map((row) => ({
            id: row.id,
            slug: row.slug || row.id,
            title: row.title || "Untitled Project",
            importSource: (row.importSource as { type?: string; repoUrl?: string; branch?: string } | null) ?? null,
            githubRepoUrl: row.githubRepoUrl || null,
            syncRepository: row.syncRepository || null,
            syncBranch: row.syncBranch || null,
            lastSyncAt: toIsoString(row.githubLastSyncAt),
        }));

        const githubProjectsAggregate = githubProjectRows.length > 0 ? {
            githubLastSyncAt: githubProjectRows.reduce<Date | null>((latest, current) => {
                if (!current.githubLastSyncAt) return latest;
                if (!latest) return current.githubLastSyncAt;
                return current.githubLastSyncAt > latest ? current.githubLastSyncAt : latest;
            }, null),
        } : null;
        const latestSyncAt = toIsoString(githubProjectsAggregate?.githubLastSyncAt);

        const passwordLastChangedAt = await getLatestPasswordChangeAt(user.id);
        const githubAccountHealth = await githubAccountHealthPromise;

        return jsonSuccess(
            buildIntegrationsData({
                user: effectiveUser,
                githubRepoProjectCount: githubProjectTotal,
                githubLastSyncAt: latestSyncAt,
                passwordLastChangedAt: passwordLastChangedAt ?? null,
                githubAccountHealth,
                githubProjects,
            }),
        );
    } catch (error) {
        logger.warn("settings.integrations.read_failed", { module: "settings", error: error instanceof Error ? error.message : String(error) });
        return jsonError("Integrations could not be loaded", 503, "INTERNAL_ERROR");
    }
}
