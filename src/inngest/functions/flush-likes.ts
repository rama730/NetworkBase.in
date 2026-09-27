import { inngest } from "../client";
import { redis } from "@/lib/redis";
import { db } from "@/lib/db";
import { projectUpdates } from "@/lib/db/schema";
import { eq, inArray, sql } from "drizzle-orm";

export const flushUpdateLikes = inngest.createFunction(
    { id: "flush-project-likes", name: "Flush Project Update Likes from Redis" },
    { cron: "*/15 * * * *" },
    async ({ step }) => {
        if (!redis) return { skipped: true, reason: "No Redis configured" };

        const bufferedLikes = await step.run("get-redis-likes", async () => {
            const tempKey = `project:updates:likes:flush:${Date.now()}`;
            try {
                await redis!.rename("project:updates:likes", tempKey);
            } catch (e: any) {
                // RENAME fails if source key doesn't exist (no likes buffered)
                return null;
            }
            try {
                const data = await redis!.hgetall(tempKey);
                return {
                    tempKey,
                    likes: data as Record<string, string> | null,
                };
            } catch (e: any) {
                console.error("flush-likes: failed to process temp key", {
                    tempKey,
                    error: e,
                });
                throw e; // Re-throw to let Inngest retry
            }
        });

        if (!bufferedLikes?.likes || Object.keys(bufferedLikes.likes).length === 0) {
            if (bufferedLikes?.tempKey) {
                await redis!.del(bufferedLikes.tempKey);
            }
            return { processed: 0 };
        }

        const { tempKey, likes } = bufferedLikes;

        const updates = await step.run("update-database", async () => {
            const validUpdates = Object.entries(likes)
                .map(([updateId, strVal]) => {
                    const increments = parseInt(strVal, 10);
                    if (isNaN(increments) || increments === 0) return null;
                    return { updateId, increments };
                })
                .filter((entry): entry is { updateId: string; increments: number } => entry !== null);

            const BATCH_SIZE = 200;
            const failed: Array<{ updateId: string; increments: number; error?: any }> = [];
            let succeeded = 0;

            for (let i = 0; i < validUpdates.length; i += BATCH_SIZE) {
                const chunk = validUpdates.slice(i, i + BATCH_SIZE);
                try {
                    const caseFragments = chunk.map(({ updateId, increments }) => {
                        if (increments > 0) {
                            return sql`WHEN ${projectUpdates.id} = ${updateId} THEN ${projectUpdates.likeCount} + ${increments}`;
                        } else {
                            return sql`WHEN ${projectUpdates.id} = ${updateId} THEN GREATEST(${projectUpdates.likeCount} - ${Math.abs(increments)}, 0)`;
                        }
                    });
                    const chunkIds = chunk.map(c => c.updateId);
                    await db.update(projectUpdates)
                        .set({
                            likeCount: sql`CASE ${sql.join(caseFragments, sql` `)} ELSE ${projectUpdates.likeCount} END`,
                            updatedAt: new Date(),
                        })
                        .where(inArray(projectUpdates.id, chunkIds));
                    succeeded += chunk.length;
                } catch (batchErr) {
                    // Fallback to item-by-item on chunk error to isolate any problematic row
                    for (const item of chunk) {
                        try {
                            if (item.increments > 0) {
                                await db.update(projectUpdates)
                                    .set({ likeCount: sql`${projectUpdates.likeCount} + ${item.increments}`, updatedAt: new Date() })
                                    .where(eq(projectUpdates.id, item.updateId));
                            } else if (item.increments < 0) {
                                await db.update(projectUpdates)
                                    .set({ likeCount: sql`GREATEST(${projectUpdates.likeCount} - ${Math.abs(item.increments)}, 0)`, updatedAt: new Date() })
                                    .where(eq(projectUpdates.id, item.updateId));
                            }
                            succeeded++;
                        } catch (singleErr) {
                            failed.push({ ...item, error: singleErr });
                        }
                    }
                }
            }

            if (failed.length > 0) {
                console.error("flush-likes: update failed", {
                    failedCount: failed.length,
                    failedUpdateIds: failed.map((f) => f?.updateId).filter(Boolean),
                    reasons: failed.map((f) => f.error),
                });

                // Requeue only the failed increments to retry in the next flush
                await Promise.allSettled(
                    failed
                        .filter((f): f is NonNullable<typeof f> => !!f)
                        .map(({ updateId, increments }) =>
                            redis!.hincrby("project:updates:likes", updateId, increments)
                        )
                );
            }

            await redis!.del(tempKey);

            return { succeeded, failed: failed.length };
        });

        return { processed: updates.succeeded, requeued: updates.failed };
    }
);
