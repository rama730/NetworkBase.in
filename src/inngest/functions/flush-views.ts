import { sql } from "drizzle-orm";

import { inngest } from "../client";
import { redis } from "@/lib/redis";
import { flushRedisCounterHash, type FlushRedis } from "@/lib/counters/redis-flush";

export const flushWorkspaceViews = inngest.createFunction(
    { id: "flush-project-views", name: "Flush Workspace Views from Redis" },
    { cron: "*/15 * * * *" },
    async ({ step }) => {
        if (!redis) return { skipped: true, reason: "No Redis configured" };

        // Each buffered batch is applied to PostgreSQL exactly once, however often this step replays (COR-009).
        return step.run("flush-views", () =>
            flushRedisCounterHash({
                redis: redis as unknown as FlushRedis,
                liveKey: "project:views",
                kind: "project_views",
                apply: async (tx, deltas) => {
                    await tx.execute(sql`
                        UPDATE projects p
                        SET view_count = p.view_count + d.delta
                        FROM jsonb_to_recordset(${JSON.stringify(deltas)}::jsonb) AS d(id uuid, delta integer)
                        WHERE p.id = d.id AND d.delta > 0
                    `);
                },
            }),
        );
    }
);
