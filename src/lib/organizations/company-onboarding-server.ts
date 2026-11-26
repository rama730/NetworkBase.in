import "server-only";

import { sql } from "drizzle-orm";

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { dueFor, LAB_STARTER_PLAN, validPlan, type PlanStep, type StepWho } from "@/lib/organizations/onboarding-plan";

/**
 * Report 33.5 (plan B4.4, K4): onboarding starts for a person who joined a company after its plan was switched on —
 * never for existing members (call 1). Each plan step becomes a task for its person (the new person, their line
 * manager from Reports to, or their buddy once picked), due on the start date plus its day offset. Kept on the
 * person's company membership (view_prefs.onboarding). Idempotent: the membership row is claimed under a lock.
 */
export type OnboardingRecord = { start: string; buddy: string | null; steps: Array<{ stepId: string; taskId: string | null; who: StepWho }>; answer?: string | null; completedAt?: string | null };

export function readPlan(settings: unknown, lab?: { createdAt: string } | null): { enabledAt: string | null; plan: PlanStep[] } {
  const raw = (settings as { onboarding?: { enabledAt?: unknown; plan?: unknown } } | null)?.onboarding;
  // Report 35.2 call 4 (B6.1b): a lab's New people plan is on from the lab's start until its PI saves the plan.
  if (lab && !raw) return { enabledAt: lab.createdAt, plan: LAB_STARTER_PLAN };
  const o = raw ?? {};
  return { enabledAt: typeof o.enabledAt === "string" ? o.enabledAt : null, plan: validPlan(o.plan) ? o.plan : [] };
}
/** The lab default's start, for readPlan: research orgs only. */
export const labDefault = (type: string | null | undefined, createdAt: string) => (type === "research" ? { createdAt } : null);
/** SQL: when an org's plan counts as switched on (the lab default when it never saved one). */
const enabledAtSql = sql`coalesce((w.org_settings->'onboarding'->>'enabledAt')::timestamptz, CASE WHEN w.org_type = 'research' AND NOT (w.org_settings ? 'onboarding') THEN w.created_at END)`;

async function makeStepTask(tx: typeof db, orgId: string, step: PlanStep, assignee: string, start: string, name: string, creator: string, label = "Onboarding") {
  const { insertTask } = await import("@/lib/organizations/assignments");
  return insertTask(tx as never, { projectId: orgId, title: step.title.replace(/\{name\}/g, name).slice(0, 200), description: `${label} · ${name}`,
    dueDate: new Date(`${dueFor(start, step.day)}T17:00:00Z`), sprintId: null, assigneeId: assignee, creatorId: creator, kind: "task", assignmentId: null, assignmentSettings: null, teamName: null });
}

/** Start onboarding for one member if they qualify (joined after the plan was switched on, not the owner, not a Viewer). */
export async function ensureOnboarding(orgId: string, userId: string): Promise<OnboardingRecord | null> {
  return db.transaction(async (tx) => {
    const [m] = Array.from(await tx.execute<{ role: string; joined: string | null; after: boolean; prefs: Record<string, unknown> | null; settings: unknown; owner: string; name: string | null; type: string; created: string }>(sql`
      SELECT m.role, to_char(m.joined_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS joined,
        coalesce(m.joined_at >= ${enabledAtSql}, false) AS after, m.view_prefs AS prefs, w.org_settings AS settings, w.owner_id AS owner, coalesce(p.full_name, p.username) AS name,
        w.org_type AS type, w.created_at::text AS created
      FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id JOIN profiles p ON p.id = m.user_id
      WHERE m.workspace_id = ${orgId}::uuid AND m.user_id = ${userId}::uuid AND w.org_type IN ('company', 'research') AND w.deleted_at IS NULL FOR UPDATE OF m`));
    if (!m) return null;
    const existing = (m.prefs?.onboarding ?? null) as OnboardingRecord | null;
    if (existing) return existing;
    const { enabledAt, plan } = readPlan(m.settings, labDefault(m.type, m.created));
    if (!enabledAt || !plan.length || m.role === "viewer" || m.role === "owner" || userId === m.owner || !m.joined || !m.after) return null;
    const start = m.joined;
    const manager = ((m.settings as { staffGrowth?: { reportsTo?: Record<string, string> } } | null)?.staffGrowth?.reportsTo ?? {})[userId] ?? null;
    const name = m.name ?? "the new person";
    const steps: OnboardingRecord["steps"] = [];
    for (const step of plan) {
      // A line manager's step with no Reports to goes to the owner; a buddy's waits until a buddy is picked.
      const assignee = step.who === "person" ? userId : step.who === "manager" ? manager ?? m.owner : null;
      steps.push({ stepId: step.id, who: step.who, taskId: assignee ? await makeStepTask(tx as never, orgId, step, assignee, start, name, m.owner) : null });
    }
    const record: OnboardingRecord = { start, buddy: null, steps };
    await tx.execute(sql`UPDATE workspace_members SET view_prefs = coalesce(view_prefs, '{}'::jsonb) || jsonb_build_object('onboarding', ${JSON.stringify(record)}::jsonb)
      WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid`);
    return record;
  });
}

/** Hourly (B4.4): start onboarding for people who joined a company since its plan was switched on. */
export async function sweepCompanyOnboarding() {
  const due = Array.from(await db.execute<{ org: string; user_id: string }>(sql`
    SELECT m.workspace_id AS org, m.user_id FROM workspace_members m JOIN workspaces w ON w.id = m.workspace_id
    WHERE w.kind = 'organization' AND w.org_type IN ('company', 'research') AND w.deleted_at IS NULL AND ${enabledAtSql} IS NOT NULL
      AND m.role IN ('member', 'admin') AND m.joined_at >= ${enabledAtSql} AND m.view_prefs->'onboarding' IS NULL LIMIT 200`));
  let started = 0;
  for (const d of due) {
    await ensureOnboarding(d.org, d.user_id).then((r) => { if (r) started += 1; }).catch((error) => logger.error("onboarding.start_failed", { error: error instanceof Error ? error.message : String(error) }));
  }
  return { started };
}

export { makeStepTask };
