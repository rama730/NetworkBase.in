import { and, eq, gt, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { profiles, workspaceUpdateComments } from "@/lib/db/schema";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { accountRestriction } from "@/lib/trust/standing";

const NEW_ACCOUNT_DAYS = 3;
const REPEAT_WINDOW_MS = 10 * 60_000;
const REPEAT_MAX_POSTS = 3;
const LINKS = /https?:\/\/|www\./gi;

export const COMMENT_LIMITS = {
    established: { perMinute: 10, perHour: 60, links: 3 },
    fresh: { perMinute: 3, perHour: 15, links: 1 },
} as const;

/** Too many links for this account, the one rule here that needs no database. */
export function tooManyLinks(content: string, limit: number) {
    return (content.match(LINKS)?.length ?? 0) > limit;
}

/**
 * Now that strangers can reach a team's posts (UP13): a comment needs a verified email and an account in good standing,
 * has limits per minute and per hour that are stricter for new accounts, and can't repeat itself or be mostly links.
 * Returns what to tell the person, or null when it may post.
 */
export async function refuseComment(input: { userId: string; updateId: string; emailVerified: boolean; content: string }) {
    if (!input.emailVerified) return "Verify your email to comment.";
    if (await accountRestriction(input.userId)) return "Your account can’t comment right now. See Settings → Account → Standing.";
    const [profile] = await db
        .select({ fresh: sql<boolean>`${profiles.createdAt} > now() - make_interval(days => ${NEW_ACCOUNT_DAYS})` })
        .from(profiles)
        .where(eq(profiles.id, input.userId))
        .limit(1);
    const limits = profile?.fresh ? COMMENT_LIMITS.fresh : COMMENT_LIMITS.established;
    if (tooManyLinks(input.content, limits.links)) return "That’s a lot of links for one comment. Keep a few and try again.";
    // "Nice work!" on two posts is ordinary. The same words twice on one post, or across many, isn't.
    const [repeat] = await db
        .select({ posts: sql<number>`count(DISTINCT ${workspaceUpdateComments.updateId})::int`, here: sql<boolean>`coalesce(bool_or(${workspaceUpdateComments.updateId} = ${input.updateId}::uuid), false)` })
        .from(workspaceUpdateComments)
        .where(and(
            eq(workspaceUpdateComments.userId, input.userId),
            eq(workspaceUpdateComments.content, input.content),
            isNull(workspaceUpdateComments.deletedAt),
            gt(workspaceUpdateComments.createdAt, new Date(Date.now() - REPEAT_WINDOW_MS)),
        ));
    if (repeat?.here) return "You already posted that comment.";
    if ((repeat?.posts ?? 0) >= REPEAT_MAX_POSTS) return "You’ve posted that on several updates. Try writing something different.";
    const minute = await consumeRateLimit(`project-update:comment:${input.userId}`, limits.perMinute, 60);
    if (!minute.allowed) return "Too many comments. Try again in a minute.";
    const hour = await consumeRateLimit(`project-update:comment-hour:${input.userId}`, limits.perHour, 3_600);
    if (!hour.allowed) return "You’ve commented a lot this hour. Try again later.";
    return null;
}
