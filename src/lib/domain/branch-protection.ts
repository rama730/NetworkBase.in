import "server-only";
/**
 * Protecting main (report H5, phase H-4). The rules live in `branch_protection` (0099) and the database's `saves_guard`
 * refuses any save on a protected main that isn't a merge, so every writer is covered. This module reads and changes
 * the rules and decides whether a merge request may merge (approvals, checks, who merges, owners' override).
 * docs/superpowers/plans/2026-11-17-m8-h4-protection-agents.md
 */
import { eq, sql } from "drizzle-orm";

import { protectedRefusal } from "@/lib/branches/protected-refusal";
import { db } from "@/lib/db";
import { branchProtection } from "@/lib/db/schema";
import { ChangeSetError, type Actor } from "@/lib/domain/change-sets";
import { mainBranch, memberAccess } from "@/lib/domain/saves";
import { recordSecurityEvent } from "@/lib/security/audit";

const fail = (message: string, status: number, code: string, details?: Record<string, unknown>): never => {
  throw new ChangeSetError(message, status, code, details);
};
const userOf = (actor: Actor) => actor.user?.id ?? fail("Sign in to continue", 401, "UNAUTHORIZED");

export type Protection = {
  requireMergeRequest: boolean; approvals: number; reapproveOnNewSaves: boolean; requiredChecks: string[];
  mergeBy: "writers" | "admins"; agentsOnBranches: boolean; allowGithubSync: boolean;
};
export const NO_PROTECTION: Protection = {
  requireMergeRequest: false, approvals: 0, reapproveOnNewSaves: false, requiredChecks: [], mergeBy: "writers", agentsOnBranches: false, allowGithubSync: true,
};

/** People who can write here (owners, admins, members): a team is more than one (H5 defaults). */
export async function writerCount(workspaceId: string) {
  // The owner counts whether or not they have a member row.
  const [row] = Array.from(await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM (
    SELECT user_id FROM workspace_members WHERE workspace_id = ${workspaceId} AND role <> 'viewer'
    UNION SELECT owner_id FROM workspaces WHERE id = ${workspaceId} AND owner_id IS NOT NULL) w`));
  return Number(row?.n ?? 0);
}

/** The H5 defaults, made when Branches is turned on (0099 makes them for workspaces that already had it). */
export async function defaultProtection(workspaceId: string): Promise<Protection> {
  const team = (await writerCount(workspaceId)) > 1;
  return { ...NO_PROTECTION, requireMergeRequest: team, approvals: team ? 1 : 0, agentsOnBranches: true };
}

export async function protectionOf(branchId: string): Promise<Protection> {
  const [row] = await db.select().from(branchProtection).where(eq(branchProtection.branchId, branchId)).limit(1);
  if (!row) return NO_PROTECTION;
  return {
    requireMergeRequest: row.requireMergeRequest, approvals: row.approvals, reapproveOnNewSaves: row.reapproveOnNewSaves, requiredChecks: row.requiredChecks,
    mergeBy: row.mergeBy, agentsOnBranches: row.agentsOnBranches, allowGithubSync: row.allowGithubSync,
  };
}

/** Main's rules for anyone in the workspace; `canChange` for owners and admins (people, not agents). */
export async function getProtection(actor: Actor, workspaceId: string) {
  const { isAdmin } = await memberAccess(actor, workspaceId);
  const main = await mainBranch(workspaceId);
  const team = (await writerCount(workspaceId)) > 1;
  return { rules: await protectionOf(main.id), canChange: isAdmin && actor.tokenKind !== "agent", agentsLocked: team };
}

const CHECK_NAME = /^[\w .:/-]{1,60}$/;

/**
 * Owners and admins change the rules (H15); agents never do. Loosening them (protection off, fewer approvals, fewer
 * checks, agents on main) needs "Verify it's you" first, given by the caller as `verified`. Every change is returned
 * with its before and after for the security log.
 */
export async function setProtection(actor: Actor, workspaceId: string, patch: Partial<Protection>, opts: { verified: boolean; request?: Request }) {
  const userId = userOf(actor);
  if (actor.tokenKind === "agent") fail("Only a person can change protection", 403, "FORBIDDEN");
  const { isAdmin } = await memberAccess(actor, workspaceId);
  if (!isAdmin) fail("Only the workspace's owners and admins can change protection", 403, "FORBIDDEN");
  const main = await mainBranch(workspaceId);
  const before = await protectionOf(main.id);
  const next: Protection = { ...before, ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)) };
  if (!Number.isInteger(next.approvals) || next.approvals < 0 || next.approvals > 5) fail("Approvals needed is 0 to 5", 400, "BAD_REQUEST");
  if (!["writers", "admins"].includes(next.mergeBy)) fail("Who may merge is writers or admins", 400, "BAD_REQUEST");
  next.requiredChecks = [...new Set((next.requiredChecks ?? []).map((c) => String(c).trim()).filter(Boolean))];
  if (next.requiredChecks.length > 20 || next.requiredChecks.some((c) => !CHECK_NAME.test(c))) fail("Up to 20 check names: letters, numbers, spaces and . : / - _", 400, "BAD_REQUEST");
  if (!next.agentsOnBranches && (await writerCount(workspaceId)) > 1) fail("In a team workspace, agents always work on a branch", 409, "CONFLICT");
  const loosens = (before.requireMergeRequest && !next.requireMergeRequest) || next.approvals < before.approvals
    || before.requiredChecks.some((c) => !next.requiredChecks.includes(c)) || (before.agentsOnBranches && !next.agentsOnBranches)
    || (!before.allowGithubSync && next.allowGithubSync) || (before.mergeBy === "admins" && next.mergeBy === "writers");
  if (loosens && !opts.verified) fail("Loosening main's protection needs you to verify it's you", 403, "STEP_UP_REQUIRED");
  const values = { ...next, updatedBy: userId, updatedAt: new Date() };
  await db.insert(branchProtection).values({ branchId: main.id, ...values }).onConflictDoUpdate({ target: branchProtection.branchId, set: values });
  if (opts.request) await recordSecurityEvent({ userId, eventType: "branch_protection_changed", request: opts.request, metadata: { workspaceId }, previousValue: before, nextValue: next }).catch(() => undefined);
  return { before, rules: next, loosens };
}

export type MergeGate = { needs: string[]; approvals: { needed: number; have: number }; checks: Array<{ name: string; state: string | null }>; mergeBy: "writers" | "admins" };

/**
 * What stands between a merge request and main (H5): approvals (only those on the branch's latest save when
 * re-approval is on), required checks passed on that save, and who may merge. An empty `needs` means it may merge.
 */
export function mergeGate(rules: Protection, input: {
  headSaveId: string | null; isAdmin: boolean;
  reviews: Array<{ reviewerId: string; state: string; saveId: string | null }>;
  checks: Array<{ name: string; state: string; saveId: string | null }>;
}): MergeGate {
  if (!rules.requireMergeRequest) return { needs: [], approvals: { needed: 0, have: 0 }, checks: [], mergeBy: "writers" };
  const needs: string[] = [];
  const have = input.reviews.filter((r) => r.state === "approved" && (!rules.reapproveOnNewSaves || r.saveId === input.headSaveId)).length;
  if (input.reviews.some((r) => r.state === "changes_requested")) needs.push("Changes were requested");
  if (have < rules.approvals) needs.push(`Needs ${rules.approvals - have} more approval${rules.approvals - have === 1 ? "" : "s"}`);
  const checks = rules.requiredChecks.map((name) => ({ name, state: input.checks.find((c) => c.name === name && c.saveId === input.headSaveId)?.state ?? null }));
  for (const c of checks) if (c.state !== "passed") needs.push(c.state === "failed" ? `Check ${c.name} failed` : `Check ${c.name} hasn't passed`);
  if (rules.mergeBy === "admins" && !input.isAdmin) needs.push("Only owners and admins merge into main");
  return { needs, approvals: { needed: rules.approvals, have }, checks, mergeBy: rules.mergeBy };
}

/** The error a merge gets when something in the gate is missing: the first reason decides the code. */
export function gateError(gate: MergeGate) {
  const first = gate.needs[0] ?? "";
  const code = first.startsWith("Check") ? "CHECKS_FAILED" : first.startsWith("Only owners") ? "FORBIDDEN" : "APPROVAL_REQUIRED";
  fail(`main is protected: ${gate.needs.join("; ")}`, code === "FORBIDDEN" ? 403 : 409, code, { needs: gate.needs });
}

/** The database's refusal (0099 `saves_guard`) as a domain error, for the routes and actions that map those. */
export function protectedFromDb(error: unknown): ChangeSetError | null {
  const refusal = protectedRefusal(error);
  return refusal ? new ChangeSetError(refusal.message, 403, "BRANCH_PROTECTED", { reason: refusal.reason }) : null;
}
