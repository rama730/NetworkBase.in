import { and, eq, notInArray, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { connectionSuggestions } from "@/lib/db/schema";

type SuggestionRow = typeof connectionSuggestions.$inferInsert;

/**
 * Replaces one person's whole suggestion set atomically (COR-021). Computation happens outside, then
 * this swaps the set in a single transaction under a per-person lock: overlapping jobs queue behind
 * each other instead of deleting each other's rows, and a failure rolls back to the previous set
 * rather than leaving a mixture.
 */
export async function replaceSuggestions(userId: string, rows: SuggestionRow[]) {
    await db.transaction(async (tx) => {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`connection-suggestions:${userId}`}, 0))`);
        if (rows.length === 0) {
            await tx.delete(connectionSuggestions).where(eq(connectionSuggestions.userId, userId));
            return;
        }
        await tx
            .insert(connectionSuggestions)
            .values(rows)
            .onConflictDoUpdate({
                target: [connectionSuggestions.userId, connectionSuggestions.suggestedUserId],
                set: {
                    mutualConnectionsCount: sql`excluded.mutual_connections_count`,
                    score: sql`excluded.score`,
                    reason: sql`excluded.reason`,
                    updatedAt: new Date(),
                },
            });
        // Keep this derived cache exact. Otherwise a removed mutual could
        // remain visible until a later unrelated recommendation refresh.
        await tx
            .delete(connectionSuggestions)
            .where(and(
                eq(connectionSuggestions.userId, userId),
                notInArray(connectionSuggestions.suggestedUserId, rows.map((item) => item.suggestedUserId)),
            ));
    });
}
