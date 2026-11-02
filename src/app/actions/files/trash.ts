"use server";

import { and, eq, inArray, sql } from "drizzle-orm";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { workspaceNodes } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import {
  assertOrgActionTx,
  assertWorkspaceManageFilesAccessTx,
  recordNodeEvent,
} from "@/lib/files/internal-helpers";
import {
  finishPermanentDelete,
  inspectPermanentDelete,
} from "@/lib/files/permanent-delete";
import { UUID_RE } from "./_constants";

function fingerprint(
  plan: NonNullable<Awaited<ReturnType<typeof inspectPermanentDelete>>>,
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        nodes: plan.nodes
          .map((n) => [n.id, n.name, n.deletedAt, n.currentVersion])
          .sort(),
        keys: [...plan.keys].sort(),
        links: plan.taskLinks,
        docs: plan.documentLinks,
      }),
    )
    .digest("hex");
}
async function actor(projectId: string, nodeId: string) {
  if (!UUID_RE.test(projectId) || !UUID_RE.test(nodeId))
    throw new Error("Invalid file");
  const client = await createClient();
  const {
    data: { user },
  } = await client.auth.getUser();
  if (!user) throw new Error("Sign in to continue");
  const { allowed } = await consumeRateLimit(`files:purge:${user.id}`, 30, 60);
  if (!allowed) throw new Error("Too many requests. Try again shortly.");
  return user;
}

export async function getPermanentDeleteImpact(
  projectId: string,
  nodeId: string,
) {
  const user = await actor(projectId, nodeId);
  return db.transaction(async (tx) => {
    await assertWorkspaceManageFilesAccessTx(tx, projectId, user.id);
    await assertOrgActionTx(tx, projectId, user.id, "empty_trash");
    const plan = await inspectPermanentDelete(tx, projectId, nodeId);
    if (!plan) throw new Error("This item has already been deleted.");
    return {
      name: plan.nodes.find((n) => n.id === nodeId)!.name,
      items: plan.nodes.length,
      versions: plan.versions,
      taskLinks: plan.taskLinks,
      documentLinks: plan.documentLinks,
      fingerprint: fingerprint(plan),
    };
  });
}

export async function permanentlyDeleteTrashedNode(
  projectId: string,
  nodeId: string,
  expectedFingerprint: string,
) {
  const user = await actor(projectId, nodeId);
  return purgeTrashedRoot(projectId, nodeId, expectedFingerprint, user.id);
}

async function purgeTrashedRoot(
  projectId: string,
  nodeId: string,
  expectedFingerprint: string,
  userId: string,
) {
  const user = { id: userId };
  await db.transaction(async (tx) => {
    await assertWorkspaceManageFilesAccessTx(tx, projectId, user.id);
    await assertOrgActionTx(tx, projectId, user.id, "empty_trash");
    const root = await tx.query.workspaceNodes.findFirst({
      where: and(
        eq(workspaceNodes.projectId, projectId),
        eq(workspaceNodes.id, nodeId),
      ),
    });
    if (!root) return; // Idempotent retry after a successful delete.
    const plan = await inspectPermanentDelete(tx, projectId, nodeId);
    if (!plan) return;
    if (root.metadata?.permanentDeleteRoot === nodeId) return;
    if (fingerprint(plan) !== expectedFingerprint)
      throw new Error(
        "The items changed. Close this dialog and review the deletion again.",
      );
    if (plan.nodes.some((node) => node.metadata?.permanentDeleteRoot))
      throw new Error(
        "A deletion is already pending in this folder. Wait for it to finish.",
      );
    await tx
      .update(workspaceNodes)
      .set({
        metadata: sql`coalesce(${workspaceNodes.metadata}, '{}'::jsonb) || ${JSON.stringify({ permanentDeleteRoot: nodeId, permanentDeleteActor: user.id, permanentDeleteRequestedAt: new Date().toISOString() })}::jsonb`,
      })
      .where(
        and(
          eq(workspaceNodes.projectId, projectId),
          inArray(workspaceNodes.id, plan.ids),
        ),
      );
    await recordNodeEvent(
      projectId,
      user.id,
      nodeId,
      "permanent_delete_requested",
      { items: plan.ids.length },
      tx,
    );
  });
  try {
    return {
      status: "deleted" as const,
      ...(await finishPermanentDelete(projectId, nodeId)),
    };
  } catch {
    return { status: "pending" as const, deletedIds: [] as string[] };
  }
}

const BULK_PURGE_ROOT_LIMIT = 500;

async function bulkActor(projectId: string) {
  if (!UUID_RE.test(projectId)) throw new Error("Invalid workspace");
  const client = await createClient();
  const { data: { user } } = await client.auth.getUser();
  if (!user) throw new Error("Sign in to continue");
  // One charge per batch: Empty Trash is one user action, not one per item.
  const { allowed } = await consumeRateLimit(`files:purge:${user.id}`, 30, 60);
  if (!allowed) throw new Error("Too many requests. Try again shortly.");
  return user;
}

/** Top-level trashed items only (a trashed folder's contents go with it), newest first. */
async function trashedRootIds(projectId: string) {
  const rows = await db.execute<{ id: string }>(sql`
    SELECT n.id FROM workspace_nodes n
    LEFT JOIN workspace_nodes p ON p.id = n.parent_id
    WHERE n.workspace_id = ${projectId} AND n.deleted_at IS NOT NULL AND (p.id IS NULL OR p.deleted_at IS NULL)
    ORDER BY n.deleted_at DESC, n.id
    LIMIT ${BULK_PURGE_ROOT_LIMIT}
  `);
  return Array.from(rows).map((row) => row.id);
}

/**
 * The review step for Empty Trash and batch delete: the aggregated impact of every root,
 * with each root's fingerprint so the confirm deletes exactly what was reviewed.
 */
export async function getBulkPermanentDeleteImpact(projectId: string, nodeIds: string[] | "all") {
  const user = await bulkActor(projectId);
  if (nodeIds !== "all" && (nodeIds.length > BULK_PURGE_ROOT_LIMIT || nodeIds.some((id) => !UUID_RE.test(id))))
    throw new Error(`Select up to ${BULK_PURGE_ROOT_LIMIT} items.`);
  const roots = nodeIds === "all" ? await trashedRootIds(projectId) : Array.from(new Set(nodeIds));
  return db.transaction(async (tx) => {
    await assertWorkspaceManageFilesAccessTx(tx, projectId, user.id);
    await assertOrgActionTx(tx, projectId, user.id, "empty_trash");
    const total = { roots: 0, items: 0, versions: 0, taskLinks: 0, documentLinks: 0 };
    const fingerprints: Record<string, string> = {};
    for (const id of roots) {
      const plan = await inspectPermanentDelete(tx, projectId, id);
      if (!plan) continue;
      fingerprints[id] = fingerprint(plan);
      total.roots += 1;
      total.items += plan.nodes.length;
      total.versions += plan.versions;
      total.taskLinks += plan.taskLinks;
      total.documentLinks += plan.documentLinks;
    }
    return { ...total, fingerprints, truncated: nodeIds === "all" && roots.length >= BULK_PURGE_ROOT_LIMIT };
  });
}

/** Deletes each reviewed root; reports deleted, pending (storage cleanup retries) and failed separately. */
export async function permanentlyDeleteTrashedNodes(projectId: string, fingerprints: Record<string, string>) {
  const user = await bulkActor(projectId);
  const entries = Object.entries(fingerprints);
  if (entries.length > BULK_PURGE_ROOT_LIMIT || entries.some(([id, fp]) => !UUID_RE.test(id) || typeof fp !== "string"))
    throw new Error("Invalid deletion review.");
  const deletedIds: string[] = [];
  const pendingIds: string[] = [];
  const failed: { id: string; error: string }[] = [];
  for (const [id, fp] of entries) {
    try {
      const result = await purgeTrashedRoot(projectId, id, fp, user.id);
      if (result.status === "pending") pendingIds.push(id);
      else deletedIds.push(...result.deletedIds);
    } catch (error) {
      failed.push({ id, error: error instanceof Error ? error.message : "Deletion failed" });
    }
  }
  return { deletedIds, pendingIds, failed };
}
