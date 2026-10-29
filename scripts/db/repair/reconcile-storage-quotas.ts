/**
 * Rebuild storage quota counters from canonical asset rows.
 *
 * Dry-run is the default. Pass --apply to lock and reconcile one scope at a
 * time. Canonical upload admission uses the same quota-row lock, so concurrent
 * reservations are applied after each rebuilt value instead of being lost.
 */
import { and, eq, isNull, sql } from "drizzle-orm";

import { storageAssets, storageQuotaScopes } from "../../../src/lib/db/schema";
import {
  WORKSPACE_STORAGE_LIMIT_BYTES,
  USER_STORAGE_LIMIT_BYTES,
} from "../../../src/lib/storage/storage-quota";

const APPLY = process.argv.includes("--apply");
const PAGE_SIZE = 100;

type ScopeType = "user" | "project";

let db: (typeof import("../../../src/lib/db"))["db"];

async function nextScopeIds(scopeType: ScopeType, cursor: string | null) {
  const rows = scopeType === "user"
    ? await db.execute<{ id: string }>(sql`
        SELECT scope.id
        FROM (
          SELECT owner_user_id AS id FROM public.storage_assets WHERE owner_user_id IS NOT NULL
          UNION
          SELECT scope_id AS id FROM public.storage_quota_scopes WHERE scope_type = 'user'
        ) scope
        WHERE (${cursor}::uuid IS NULL OR scope.id > ${cursor}::uuid)
        ORDER BY scope.id
        LIMIT ${PAGE_SIZE}
      `)
    : await db.execute<{ id: string }>(sql`
        SELECT scope.id
        FROM (
          SELECT workspace_id AS id FROM public.storage_assets WHERE workspace_id IS NOT NULL
          UNION
          SELECT scope_id AS id FROM public.storage_quota_scopes WHERE scope_type = 'project'
        ) scope
        WHERE (${cursor}::uuid IS NULL OR scope.id > ${cursor}::uuid)
        ORDER BY scope.id
        LIMIT ${PAGE_SIZE}
      `);
  return Array.from(rows);
}

async function measuredUsage(scopeType: ScopeType, scopeId: string) {
  const byteScope = scopeType === "project"
    ? eq(storageAssets.projectId, scopeId)
    : and(eq(storageAssets.ownerUserId, scopeId), isNull(storageAssets.projectId));
  const [bytes] = await db.select({
    reserved: sql<number>`coalesce(sum(CASE WHEN ${storageAssets.quotaTracked} AND ${storageAssets.state} IN ('pending', 'delete_pending', 'deleting') AND ${storageAssets.verifiedSize} IS NULL THEN ${storageAssets.declaredSize} ELSE 0 END), 0)::bigint`,
    retained: sql<number>`coalesce(sum(CASE WHEN ${storageAssets.quotaTracked} AND ${storageAssets.state} IN ('verified', 'delete_pending', 'deleting') AND ${storageAssets.verifiedSize} IS NOT NULL THEN ${storageAssets.verifiedSize} ELSE 0 END), 0)::bigint`,
  }).from(storageAssets).where(byteScope);
  const [outstanding] = scopeType === "user"
    ? await db.select({ count: sql<number>`count(*)::integer` })
        .from(storageAssets)
        .where(and(
          eq(storageAssets.ownerUserId, scopeId),
          eq(storageAssets.quotaTracked, true),
          sql`${storageAssets.state} IN ('pending', 'delete_pending', 'deleting')`,
          isNull(storageAssets.verifiedSize),
        ))
    : [{ count: 0 }];
  return {
    reservedBytes: Number(bytes?.reserved ?? 0),
    retainedBytes: Number(bytes?.retained ?? 0),
    outstandingUploads: Number(outstanding?.count ?? 0),
  };
}

async function reconcileScope(scopeType: ScopeType, scopeId: string) {
  const limitBytes = scopeType === "project" ? WORKSPACE_STORAGE_LIMIT_BYTES : USER_STORAGE_LIMIT_BYTES;
  if (!APPLY) return measuredUsage(scopeType, scopeId);

  return db.transaction(async (tx) => {
    await tx.insert(storageQuotaScopes).values({ scopeType, scopeId, limitBytes }).onConflictDoNothing();
    await tx.select({ scopeId: storageQuotaScopes.scopeId })
      .from(storageQuotaScopes)
      .where(and(
        eq(storageQuotaScopes.scopeType, scopeType),
        eq(storageQuotaScopes.scopeId, scopeId),
      ))
      .limit(1)
      .for("update");

    const byteScope = scopeType === "project"
      ? eq(storageAssets.projectId, scopeId)
      : and(eq(storageAssets.ownerUserId, scopeId), isNull(storageAssets.projectId));
    const [bytes] = await tx.select({
      reserved: sql<number>`coalesce(sum(CASE WHEN ${storageAssets.quotaTracked} AND ${storageAssets.state} IN ('pending', 'delete_pending', 'deleting') AND ${storageAssets.verifiedSize} IS NULL THEN ${storageAssets.declaredSize} ELSE 0 END), 0)::bigint`,
      retained: sql<number>`coalesce(sum(CASE WHEN ${storageAssets.quotaTracked} AND ${storageAssets.state} IN ('verified', 'delete_pending', 'deleting') AND ${storageAssets.verifiedSize} IS NOT NULL THEN ${storageAssets.verifiedSize} ELSE 0 END), 0)::bigint`,
    }).from(storageAssets).where(byteScope);
    const [outstanding] = scopeType === "user"
      ? await tx.select({ count: sql<number>`count(*)::integer` })
          .from(storageAssets)
          .where(and(
            eq(storageAssets.ownerUserId, scopeId),
            eq(storageAssets.quotaTracked, true),
            sql`${storageAssets.state} IN ('pending', 'delete_pending', 'deleting')`,
            isNull(storageAssets.verifiedSize),
          ))
      : [{ count: 0 }];
    const usage = {
      reservedBytes: Number(bytes?.reserved ?? 0),
      retainedBytes: Number(bytes?.retained ?? 0),
      outstandingUploads: Number(outstanding?.count ?? 0),
    };
    await tx.update(storageQuotaScopes)
      .set({ ...usage, updatedAt: new Date() })
      .where(and(
        eq(storageQuotaScopes.scopeType, scopeType),
        eq(storageQuotaScopes.scopeId, scopeId),
      ));
    return usage;
  });
}

async function reconcileType(scopeType: ScopeType) {
  let cursor: string | null = null;
  let scopes = 0;
  let overLimit = 0;
  do {
    const page = await nextScopeIds(scopeType, cursor);
    if (page.length === 0) break;
    for (const row of page) {
      if (!row.id) continue;
      const usage = await reconcileScope(scopeType, row.id);
      const limit = scopeType === "project" ? WORKSPACE_STORAGE_LIMIT_BYTES : USER_STORAGE_LIMIT_BYTES;
      scopes += 1;
      if (usage.reservedBytes + usage.retainedBytes > limit) overLimit += 1;
      cursor = row.id;
    }
    console.log(`[storage-quota] type=${scopeType} scopes=${scopes} cursor=${cursor}`);
  } while (cursor);
  return { scopes, overLimit };
}

async function main() {
  ({ db } = await import("../../../src/lib/db"));
  console.log(`[storage-quota] mode=${APPLY ? "apply" : "dry-run"}`);
  const users = await reconcileType("user");
  const projects = await reconcileType("project");
  console.log(JSON.stringify({ mode: APPLY ? "apply" : "dry-run", users, projects }));
}

main().then(() => process.exit(0)).catch((error) => {
  console.error("[storage-quota] failed", error instanceof Error ? error.message : String(error));
  process.exit(1);
});
