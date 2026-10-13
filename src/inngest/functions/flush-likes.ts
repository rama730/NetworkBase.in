import { sql } from "drizzle-orm";

import { inngest } from "../client";
import { redis } from "@/lib/redis";
import { flushRedisCounterHash, type FlushRedis } from "@/lib/counters/redis-flush";

export const flushUpdateLikes = inngest.createFunction(
    { id: "flush-project-likes", name: "Flush Project Update Likes from Redis" },
    { cron: "*/15 * * * *" },
    async ({ step }) => {
        if (!redis) return { skipped: true, reason: "No Redis configured" };

        // Each buffered batch is applied to PostgreSQL exactly once, however often this step replays (COR-009).
        return step.run("flush-likes", () =>
            flushRedisCounterHash({
                redis: redis as unknown as FlushRedis,
                liveKey: "project:updates:likes",
                kind: "update_likes",
                apply: async (tx, deltas) => {
                    await tx.execute(sql`
                        UPDATE project_updates u
                        SET like_count = GREATEST(u.like_count + d.delta, 0), updated_at = now()
                        FROM jsonb_to_recordset(${JSON.stringify(deltas)}::jsonb) AS d(id uuid, delta integer)
                        WHERE u.id = d.id
                    `);
                },
            }),
        );
    }
);
