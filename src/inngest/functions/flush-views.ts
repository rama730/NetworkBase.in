import { inngest } from "../client";
import { redis } from "@/lib/redis";
import { db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { eq, inArray, sql } from "drizzle-orm";

export const flushProjectViews = inngest.createFunction(
    { id: "flush-project-views", name: "Flush Project Views from Redis" },
    // ponytail: 15-minute cron prevents idle external polling churn while ensuring eventual consistency
    { cron: "*/15 * * * *" },
    async ({ step }) => {
        if (!redis) return { skipped: true, reason: "No Redis configured" };
        const writeThroughEnabled = process.env.PROJECT_VIEWS_WRITE_THROUGH === "1";

        const bufferedViews = await step.run("get-redis-views", async () => {
            // Atomic RENAME to prevent race condition:
            // Any hincrby calls after RENAME go to a fresh "project:views" key,
            // while we safely read from the temp key without losing data.
            const tempKey = `project:views:flush:${Date.now()}`;
            try {
                await redis!.rename("project:views", tempKey);
            } catch (e: any) {
                // RENAME fails if the source key doesn't exist (no views buffered)
                return null;
            }
            try {
                const data = await redis!.hgetall(tempKey);
                return {
                    tempKey,
                    views: data as Record<string, string> | null,
                };
            } catch (e: any) {
                console.error("flush-views: failed to process temp key", {
                    tempKey,
                    error: e,
                });
                throw e; // Re-throw to let Inngest retry
            }
        });

        if (!bufferedViews?.views || Object.keys(bufferedViews.views).length === 0) {
            if (bufferedViews?.tempKey) {
                await redis!.del(bufferedViews.tempKey);
            }
            return { processed: 0 };
        }

        const { tempKey, views } = bufferedViews;

        if (writeThroughEnabled) {
            // Views are written directly to DB at request time. Drain legacy buffers but do not re-apply.
            await step.run("cleanup-temp-key", async () => {
                await redis!.del(tempKey);
            });
            return { processed: 0, skippedApply: true, drainedProjects: Object.keys(views).length };
        }

        const updates = await step.run("update-database", async () => {
            // Note: If scale is extreme, we could optimize this with `INSERT ... ON CONFLICT`
            // or a single transaction, but since it's only doing it once a minute,
            // sequential/parallel updates are very resilient against locks.
            const validUpdates = Object.entries(views)
                .map(([projectId, strVal]) => {
                    const increments = parseInt(strVal, 10);
                    if (isNaN(increments) || increments <= 0) return null;
                    return { projectId, increments };
                })
                .filter((entry): entry is { projectId: string; increments: number } => entry !== null);

            const BATCH_SIZE = 200;
            const failed: Array<{ projectId: string; increments: number; error?: any }> = [];
            let succeeded = 0;

            for (let i = 0; i < validUpdates.length; i += BATCH_SIZE) {
                const chunk = validUpdates.slice(i, i + BATCH_SIZE);
                try {
                    const caseFragments = chunk.map(
                        ({ projectId, increments }) =>
                            sql`WHEN ${projects.id} = ${projectId} THEN ${projects.viewCount} + ${increments}`
                    );
                    const chunkIds = chunk.map(c => c.projectId);
                    await db.update(projects)
                        .set({
                            viewCount: sql`CASE ${sql.join(caseFragments, sql` `)} ELSE ${projects.viewCount} END`,
                        })
                        .where(inArray(projects.id, chunkIds));
                    succeeded += chunk.length;
                } catch (batchErr) {
                    // Fallback to item-by-item on chunk error to isolate any bad row
                    for (const item of chunk) {
                        try {
                            await db.update(projects)
                                .set({ viewCount: sql`${projects.viewCount} + ${item.increments}` })
                                .where(eq(projects.id, item.projectId));
                            succeeded++;
                        } catch (singleErr) {
                            failed.push({ ...item, error: singleErr });
                        }
                    }
                }
            }

            if (failed.length > 0) {
                console.error("flush-views: project view updates failed", {
                    failedCount: failed.length,
                    failedProjectIds: failed.map((f) => f?.projectId).filter(Boolean),
                    reasons: failed.map((f) => f.error),
                });

                // Requeue only the failed increments so they can be retried in the next flush.
                const requeueResults = await Promise.allSettled(
                    failed
                        .filter((f): f is NonNullable<typeof f> => !!f)
                        .map(({ projectId, increments }) =>
                            redis!.hincrby("project:views", projectId, increments)
                        )
                );

                const requeueFailures = requeueResults
                    .map((result, index) => ({
                        result,
                        projectId: failed[index]?.projectId,
                        increments: failed[index]?.increments,
                    }))
                    .filter(
                        (
                            entry,
                        ): entry is {
                            result: PromiseRejectedResult;
                            projectId: string;
                            increments: number;
                        } =>
                            entry.result.status === 'rejected'
                            && typeof entry.projectId === 'string'
                            && typeof entry.increments === 'number',
                    );

                if (requeueFailures.length > 0) {
                    console.error("flush-views: failed to requeue increments", {
                        failedCount: requeueFailures.length,
                        failedProjectIds: requeueFailures.map(({ projectId }) => projectId),
                        failures: requeueFailures.map(({ projectId, increments, result }) => ({
                            projectId,
                            increments,
                            reason: result.reason,
                        })),
                    });
                }
            }

            await redis!.del(tempKey);

            return { succeeded, failed: failed.length };
        });

        return { processed: updates.succeeded, requeued: updates.failed };
    }
);
