import { cache } from "react";
import { db } from "@/lib/db";
import { connections, profiles } from "@/lib/db/schema";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { logger } from "@/lib/logger";
import {
  derivePrivacyRelationshipState,
  type ConnectionPrivacySetting,
  type MessagePrivacySetting,
  type PrivacyConnectionRow,
  type PrivacyRelationshipState,
  type ProfileVisibilitySetting,
} from "@/lib/privacy/relationship-state";

type ConnectionRow = PrivacyConnectionRow;

const DEFAULT_VISIBILITY: ProfileVisibilitySetting = "public";
const DEFAULT_MESSAGE_PRIVACY: MessagePrivacySetting = "connections";
const DEFAULT_CONNECTION_PRIVACY: ConnectionPrivacySetting = "everyone";

/**
 * Accepted mutual connections between the viewer and each target, computed in SQL: the peers are
 * never loaded into the process, and the two peer sets meet in one hash join.
 */
async function countMutualAcceptedConnectionsBatch(viewerId: string, targetUserIds: string[]) {
  const normalizedTargetIds = Array.from(new Set(targetUserIds.filter((value) => value && value !== viewerId)));
  if (normalizedTargetIds.length === 0) return new Map<string, number>();

  // postgres.js expands JS arrays into tuples, so the ids travel as one JSON array.
  const rows = await db.execute<{ target_id: string; mutual: number }>(sql`
    WITH viewer_peers AS (
      SELECT addressee_id AS id FROM connections WHERE status = 'accepted' AND requester_id = ${viewerId}::uuid
      UNION
      SELECT requester_id FROM connections WHERE status = 'accepted' AND addressee_id = ${viewerId}::uuid
    ),
    targets AS (
      SELECT jsonb_array_elements_text(${JSON.stringify(normalizedTargetIds)}::jsonb)::uuid AS id
    ),
    target_peers AS (
      SELECT t.id AS target_id, e.addressee_id AS peer_id FROM targets t JOIN connections e ON e.status = 'accepted' AND e.requester_id = t.id
      UNION
      SELECT t.id, e.requester_id FROM targets t JOIN connections e ON e.status = 'accepted' AND e.addressee_id = t.id
    )
    SELECT tp.target_id, count(*)::int AS mutual
    FROM target_peers tp
    JOIN viewer_peers vp ON vp.id = tp.peer_id
    GROUP BY tp.target_id
  `);
  return new Map(Array.from(rows, (row) => [row.target_id, Number(row.mutual)] as const));
}

type PrivacyTarget = {
  visibility: ProfileVisibilitySetting | null;
  messagePrivacy: MessagePrivacySetting | null;
  connectionPrivacy: ConnectionPrivacySetting | null;
};

/**
 * `options.target` is the target's privacy columns when the caller has just read the live,
 * non-deleted profile row server-side (it saves a second read). Never pass client-supplied values.
 */
export async function resolvePrivacyRelationship(
  viewerId: string | null,
  targetUserId: string,
  options: { target?: PrivacyTarget } = {},
): Promise<PrivacyRelationshipState | null> {
  const startedAt = Date.now();
  const [targetProfile] = options.target ? [{ id: targetUserId, ...options.target }] : await db
    .select({
      id: profiles.id,
      visibility: profiles.visibility,
      messagePrivacy: profiles.messagePrivacy,
      connectionPrivacy: profiles.connectionPrivacy,
    })
    .from(profiles)
    .where(and(eq(profiles.id, targetUserId), isNull(profiles.deletedAt)))
    .limit(1);

  if (!targetProfile) return null;

  let latestConnection: ConnectionRow | null = null;
  const usedFastPath = false;

  if (viewerId && viewerId !== targetUserId) {
    // Redis relationship projections are never authorization proof: a block
    // and cache invalidation cannot be committed atomically across systems.
    const dbConnection = await db.query.connections.findFirst({
      columns: {
        id: true,
        requesterId: true,
        addresseeId: true,
        status: true,
        blockedBy: true,
      },
      where: or(
        and(eq(connections.requesterId, viewerId), eq(connections.addresseeId, targetUserId)),
        and(eq(connections.requesterId, targetUserId), eq(connections.addresseeId, viewerId)),
      ),
      orderBy: [
        sql`CASE
          WHEN status = 'blocked' THEN 1
          WHEN status = 'accepted' THEN 2
          WHEN status = 'pending' THEN 3
          ELSE 4
        END`,
        desc(connections.updatedAt),
        desc(connections.id)
      ],
    });
    latestConnection = dbConnection ?? null;
  }

  const needsMutualResolution =
    !!viewerId &&
    viewerId !== targetUserId &&
    !latestConnection &&
    (targetProfile.connectionPrivacy ?? DEFAULT_CONNECTION_PRIVACY) === "mutuals_only";
  const mutualAcceptedCount =
    needsMutualResolution && viewerId
      ? (await countMutualAcceptedConnectionsBatch(viewerId, [targetUserId])).get(targetUserId) ?? 0
      : 0;

  const result = derivePrivacyRelationshipState({
    viewerId,
    targetUserId,
    profileVisibility: targetProfile.visibility ?? DEFAULT_VISIBILITY,
    messagePrivacy: targetProfile.messagePrivacy ?? DEFAULT_MESSAGE_PRIVACY,
    connectionPrivacy: targetProfile.connectionPrivacy ?? DEFAULT_CONNECTION_PRIVACY,
    latestConnection,
    mutualAcceptedCount,
  });
  logger.metric("privacy.relationship.resolve", {
    mode: "single",
    hasViewer: !!viewerId,
    usedFastPath,
    durationMs: Date.now() - startedAt,
    visibilityReason: result.visibilityReason,
  });
  return result;
}

export async function resolvePrivacyRelationships(
  viewerId: string | null,
  targetUserIds: string[],
): Promise<Map<string, PrivacyRelationshipState>> {
  const startedAt = Date.now();
  const uniqueTargetIds = Array.from(new Set(targetUserIds.filter(Boolean)));
  if (uniqueTargetIds.length === 0) return new Map();

  const targetProfiles = await db
    .select({
      id: profiles.id,
      visibility: profiles.visibility,
      messagePrivacy: profiles.messagePrivacy,
      connectionPrivacy: profiles.connectionPrivacy,
    })
    .from(profiles)
    .where(and(inArray(profiles.id, uniqueTargetIds), isNull(profiles.deletedAt)));

  const profileById = new Map(targetProfiles.map((profile) => [profile.id, profile]));

  const latestConnections = viewerId
    ? await db
        .select({
          id: connections.id,
          requesterId: connections.requesterId,
          addresseeId: connections.addresseeId,
          status: connections.status,
          blockedBy: connections.blockedBy,
          updatedAt: connections.updatedAt,
        })
        .from(connections)
        .where(
          or(
            and(eq(connections.requesterId, viewerId), inArray(connections.addresseeId, uniqueTargetIds)),
            and(eq(connections.addresseeId, viewerId), inArray(connections.requesterId, uniqueTargetIds)),
          ),
        )
        .orderBy(
            sql`CASE 
              WHEN ${connections.status} = 'accepted' THEN 1
              WHEN ${connections.status} = 'blocked' THEN 2
              WHEN ${connections.status} = 'pending' THEN 3
              ELSE 4
            END`,
            desc(connections.updatedAt),
            desc(connections.id)
        )
    : [];

  const latestConnectionByTarget = new Map<string, ConnectionRow>();
  for (const row of latestConnections) {
    const otherUserId = row.requesterId === viewerId ? row.addresseeId : row.requesterId;
    if (!latestConnectionByTarget.has(otherUserId)) {
      latestConnectionByTarget.set(otherUserId, row);
    }
  }

  const needsMutualResolutionIds =
    viewerId
      ? uniqueTargetIds.filter((targetUserId) => {
          const profile = profileById.get(targetUserId);
          const latestConnection = latestConnectionByTarget.get(targetUserId) ?? null;
          return (
            !!profile &&
            viewerId !== targetUserId &&
            !latestConnection &&
            (profile.connectionPrivacy ?? DEFAULT_CONNECTION_PRIVACY) === "mutuals_only"
          );
        })
      : [];

  const mutualAcceptedCountByTarget =
    viewerId && needsMutualResolutionIds.length > 0
      ? await countMutualAcceptedConnectionsBatch(viewerId, needsMutualResolutionIds)
      : new Map<string, number>();

  const results = new Map<string, PrivacyRelationshipState>();
  for (const targetUserId of uniqueTargetIds) {
    const profile = profileById.get(targetUserId);
    if (!profile) continue;
    const latestConnection = latestConnectionByTarget.get(targetUserId) ?? null;
    const mutualAcceptedCount = mutualAcceptedCountByTarget.get(targetUserId) ?? 0;

    results.set(
      targetUserId,
      derivePrivacyRelationshipState({
        viewerId,
        targetUserId,
        profileVisibility: profile.visibility ?? DEFAULT_VISIBILITY,
        messagePrivacy: profile.messagePrivacy ?? DEFAULT_MESSAGE_PRIVACY,
        connectionPrivacy: profile.connectionPrivacy ?? DEFAULT_CONNECTION_PRIVACY,
        latestConnection,
        mutualAcceptedCount,
      }),
    );
  }

  logger.metric("privacy.relationship.resolve", {
    mode: "batch",
    viewerId: viewerId ?? "anon",
    targetCount: uniqueTargetIds.length,
    mutualResolutionCount: needsMutualResolutionIds.length,
    durationMs: Date.now() - startedAt,
  });
  return results;
}


/** Bounded identity projections use the single-profile policy; block evidence fails closed. */
export function readableProfileIdentitySql(viewerId: string | null) {
  if (!viewerId) return and(isNull(profiles.deletedAt), eq(profiles.visibility, 'public'))!;
  const pair = sql`((c.requester_id = ${viewerId}::uuid AND c.addressee_id = ${profiles.id})
    OR (c.addressee_id = ${viewerId}::uuid AND c.requester_id = ${profiles.id}))`;
  return and(isNull(profiles.deletedAt),
    sql`NOT EXISTS (SELECT 1 FROM connections c WHERE ${pair} AND c.status = 'blocked')`,
    or(eq(profiles.id, viewerId), eq(profiles.visibility, 'public'),
      sql`EXISTS (SELECT 1 FROM connections c WHERE ${pair} AND c.status = 'accepted')`))!;
}
