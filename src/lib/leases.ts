import "server-only";

import { randomUUID } from "node:crypto";

import { and, eq, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { workLeases } from "@/lib/db/schema";

export type WorkLease = { scope: string; leaseId: string; fence: number };
type Executor = Pick<typeof db, "select" | "execute">;

export class LeaseLostError extends Error {
  constructor(readonly scope: string) {
    super(`Lease for ${scope} was lost`);
    this.name = "LeaseLostError";
  }
}

/**
 * Takes the lease for `scope` unless another live holder has it; an expired lease is taken over with
 * a higher fence (ARCH-001). Returns null when the scope is busy.
 */
export async function acquireWorkLease(scope: string, ttlMs: number): Promise<WorkLease | null> {
  const leaseId = randomUUID();
  const rows = await db
    .insert(workLeases)
    .values({ scope, leaseId, expiresAt: new Date(Date.now() + ttlMs) })
    .onConflictDoUpdate({
      target: workLeases.scope,
      set: {
        leaseId,
        fence: sql`${workLeases.fence} + 1`,
        expiresAt: new Date(Date.now() + ttlMs),
        updatedAt: new Date(),
      },
      setWhere: sql`${workLeases.expiresAt} < now()`,
    })
    .returning({ fence: workLeases.fence });
  const row = rows[0];
  return row ? { scope, leaseId, fence: Number(row.fence) } : null;
}

/** Extends a held lease; false means it expired or was taken over. */
export async function renewWorkLease(lease: WorkLease, ttlMs: number): Promise<boolean> {
  const rows = await db
    .update(workLeases)
    .set({ expiresAt: new Date(Date.now() + ttlMs), updatedAt: new Date() })
    .where(and(eq(workLeases.scope, lease.scope), eq(workLeases.leaseId, lease.leaseId)))
    .returning({ scope: workLeases.scope });
  return rows.length > 0;
}

export async function releaseWorkLease(lease: WorkLease): Promise<void> {
  await db.delete(workLeases).where(and(eq(workLeases.scope, lease.scope), eq(workLeases.leaseId, lease.leaseId)));
}

/**
 * The fence check for mutation transactions: call it first inside the transaction. FOR SHARE blocks a
 * concurrent takeover until this transaction commits, so a stale holder cannot write after losing the lease.
 */
export async function assertWorkLeaseHeld(executor: Executor, lease: WorkLease): Promise<void> {
  const rows = await executor.execute<{ ok: number }>(sql`
    SELECT 1 AS ok FROM work_leases
    WHERE scope = ${lease.scope} AND lease_id = ${lease.leaseId}::uuid AND fence = ${lease.fence} AND expires_at > now()
    FOR SHARE
  `);
  if (Array.from(rows).length === 0) throw new LeaseLostError(lease.scope);
}

/**
 * Runs `task` while holding the lease, renewing it every third of the TTL; `task` receives the lease
 * (for fencing its writes) and a signal that aborts if renewal fails. Returns { skipped: true } when
 * the scope is busy. The lease is released in finally.
 */
export async function withWorkLease<T>(
  scope: string,
  ttlMs: number,
  task: (lease: WorkLease, signal: AbortSignal) => Promise<T>,
): Promise<{ skipped: true } | { skipped: false; value: T }> {
  const lease = await acquireWorkLease(scope, ttlMs);
  if (!lease) return { skipped: true };
  const lost = new AbortController();
  const timer = setInterval(() => {
    void renewWorkLease(lease, ttlMs).then(
      (held) => { if (!held) lost.abort(new LeaseLostError(scope)); },
      () => undefined, // a transient renewal failure is retried on the next tick; expiry is the backstop
    );
  }, Math.max(1_000, Math.floor(ttlMs / 3)));
  try {
    return { skipped: false, value: await task(lease, lost.signal) };
  } finally {
    clearInterval(timer);
    await releaseWorkLease(lease).catch(() => undefined);
  }
}
