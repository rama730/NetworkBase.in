"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { getAuthUser } from "@/lib/supabase/auth-user";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { containsLikePattern, tokenizeSearchQuery } from "@/lib/search/query";
import { readableProfileIdentitySql } from "@/lib/privacy/resolver";
import { publicPersonSkillsSql } from "@/lib/network/person-filter-sql";
import { readPersonCardDetails } from "@/lib/network/person-card-read";
import type { PersonCardIdentity } from "@/lib/network/person-card";
import { logger } from "@/lib/logger";

export type NetworkInvitation = {
  id: string;
  source: "connection" | "invitation" | "application";
  direction: "received" | "sent";
  createdAt: string;
  note: string | null;
  projectId: string | null;
  projectTitle: string | null;
  projectSlug: string | null;
  roleTitle: string | null;
  person: PersonCardIdentity & { id: string };
};
const inputSchema = z
  .object({
    q: z.string().trim().max(100).default(""),
    sort: z.enum(["recent", "oldest"]).default("recent"),
    direction: z.enum(["all", "received", "sent"]).default("all"),
    kind: z.enum(["all", "connections", "projects"]).default("all"),
    limit: z.number().int().min(1).max(60).default(30),
    cursor: z.string().max(1000).optional(),
  })
  .strict();
const cursorSchema = z.object({
  date: z.string().datetime({ offset: true }),
  source: z.enum(["connection", "invitation", "application"]),
  id: z.string().uuid(),
  sort: z.enum(["recent", "oldest"]),
});

/** A single globally ordered page; search and type/direction filters precede LIMIT for every source. */
export async function readNetworkInvitationsAction(
  input: z.input<typeof inputSchema> = {},
) {
  try {
    const parsed = inputSchema.safeParse(input);
    if (!parsed.success)
      return { success: false as const, error: "Invalid invitation filters" };
    const query = parsed.data;
    let cursor: z.infer<typeof cursorSchema> | undefined;
    if (query.cursor) {
      try {
        cursor = cursorSchema.parse(
          JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")),
        );
      } catch {
        return { success: false as const, error: "Invalid invitation page" };
      }
      if (cursor.sort !== query.sort)
        return {
          success: false as const,
          error: "Invitation ordering changed. Refresh the list.",
        };
    }
    const user = await getAuthUser();
    if (!user) return { success: false as const, error: "Not authenticated" };
    const rate = await consumeRateLimit(
      `network-invitations:${user.id}`,
      100,
      60,
    );
    if (!rate.allowed)
      return {
        success: false as const,
        error: "Too many requests. Please try again shortly.",
      };
    const ascending = query.sort === "oldest";
    const direction = ascending ? sql`ASC` : sql`DESC`,
      comparison = ascending ? sql`>` : sql`<`;
    const search = tokenizeSearchQuery(query.q).map((term) => {
      const pattern = containsLikePattern(term);
      return sql`(profiles.full_name ILIKE ${pattern} OR profiles.username ILIKE ${pattern}
                OR entries.project_title ILIKE ${pattern} OR entries.role_title ILIKE ${pattern}
                OR (${readableProfileIdentitySql(user.id)} AND (profiles.headline ILIKE ${pattern} OR profiles.location ILIKE ${pattern}
                    OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(${publicPersonSkillsSql()}) label(value) WHERE label.value ILIKE ${pattern}))))`;
    });
    const rows = await db.execute<{
      id: string;
      source: NetworkInvitation["source"];
      direction: NetworkInvitation["direction"];
      created_at: Date;
      cursor_date: string;
      note: string | null;
      project_id: string | null;
      project_title: string | null;
      project_slug: string | null;
      role_title: string | null;
      actor_id: string;
      username: string | null;
      full_name: string | null;
      avatar_url: string | null;
      headline: string | null;
      location: string | null;
      total: number;
    }>(sql`
            WITH entries AS (
                SELECT c.id,'connection'::text AS source,CASE WHEN c.requester_id=${user.id}::uuid THEN 'sent' ELSE 'received' END AS direction,
                    c.created_at,c.message AS note,NULL::uuid AS project_id,NULL::text AS project_title,NULL::text AS project_slug,NULL::text AS role_title,
                    CASE WHEN c.requester_id=${user.id}::uuid THEN c.addressee_id ELSE c.requester_id END AS actor_id
                FROM connections c WHERE c.status='pending' AND (c.requester_id=${user.id}::uuid OR c.addressee_id=${user.id}::uuid)
                UNION ALL
                SELECT i.id,'invitation',CASE WHEN i.inviter_id=${user.id}::uuid THEN 'sent' ELSE 'received' END,i.created_at,i.note,i.project_id,p.title,p.slug,
                    coalesce(i.role_title,i.guidance_label,'Collaborator'),CASE WHEN i.inviter_id=${user.id}::uuid THEN i.candidate_id ELSE i.inviter_id END
                FROM project_invitations i JOIN projects p ON p.id=i.project_id
                WHERE i.status='pending' AND i.expires_at>now() AND p.deleted_at IS NULL AND (i.inviter_id=${user.id}::uuid OR i.candidate_id=${user.id}::uuid)
                UNION ALL
                SELECT a.id,'application','received',a.created_at,a.message,a.project_id,p.title,p.slug,coalesce(r.title,r.role,'Collaborator'),a.applicant_id
                FROM role_applications a JOIN projects p ON p.id=a.project_id LEFT JOIN project_open_roles r ON r.id=a.role_id
                WHERE a.status='pending' AND a.creator_id=${user.id}::uuid AND p.deleted_at IS NULL
                    AND (p.owner_id=${user.id}::uuid OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=${user.id}::uuid AND pm.role IN ('owner','admin')))
            ), matching AS (
                SELECT entries.*,profiles.username,profiles.full_name,profiles.avatar_url,profiles.headline,profiles.location
                FROM entries JOIN profiles ON profiles.id=entries.actor_id
                WHERE profiles.deleted_at IS NULL AND profiles.id<>${user.id}::uuid
                    AND NOT EXISTS(SELECT 1 FROM connections b WHERE b.status='blocked' AND ((b.requester_id=${user.id}::uuid AND b.addressee_id=profiles.id) OR (b.addressee_id=${user.id}::uuid AND b.requester_id=profiles.id)))
                    ${query.direction === "all" ? sql`` : sql`AND entries.direction=${query.direction}`}
                    ${query.kind === "all" ? sql`` : query.kind === "connections" ? sql`AND entries.source='connection'` : sql`AND entries.source IN ('invitation','application')`}
                    ${search.length ? sql`AND ${sql.join(search, sql` AND `)}` : sql``}
            )
            SELECT matching.*,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_date,
                (SELECT count(*)::int FROM matching) AS total FROM matching
            ${cursor ? sql`WHERE (created_at,source,id) ${comparison} (${cursor.date}::timestamptz,${cursor.source}::text,${cursor.id}::uuid)` : sql``}
            ORDER BY created_at ${direction},source ${direction},id ${direction} LIMIT ${query.limit + 1}
        `);
    const page = Array.from(rows).slice(0, query.limit),
      hasMore = rows.length > query.limit,
      last = page.at(-1);
    const details = await readPersonCardDetails(
      user.id,
      page.map((row) => row.actor_id),
    );
    // ponytail: privacy-hidden people are dropped after LIMIT, so a page can come back a row or two short while hasMore stays true (cursors are exact, nothing is skipped). ceiling: short pages. upgrade: move the privacy predicate into the SQL once it exists as one expression.
    const items: NetworkInvitation[] = page
      .filter((row) => !details[row.actor_id]?.isUnavailable)
      .map((row) => ({
        id: row.id,
        source: row.source,
        direction: row.direction,
        createdAt: new Date(row.created_at).toISOString(),
        note: row.note,
        projectId: row.project_id,
        projectTitle: row.project_title,
        projectSlug: row.project_slug,
        roleTitle: row.role_title,
        person: {
          id: row.actor_id,
          username: row.username,
          fullName: row.full_name,
          avatarUrl: row.avatar_url,

          ...details[row.actor_id],
        },
      }));
    return {
      success: true as const,
      items,
      total: Number(rows[0]?.total ?? 0),
      hasMore,
      nextCursor:
        hasMore && last
          ? Buffer.from(
              JSON.stringify({
                date: last.cursor_date,
                source: last.source,
                id: last.id,
                sort: query.sort,
              }),
            ).toString("base64url")
          : null,
    };
  } catch (error) {
    logger.warn("network.invitations_read_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return {
      success: false as const,
      error: "Could not load invitations. Please try again.",
    };
  }
}
