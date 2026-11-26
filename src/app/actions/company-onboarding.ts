"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { ensureOnboarding, labDefault, makeStepTask, readPlan as readPlanRaw, type OnboardingRecord } from "@/lib/organizations/company-onboarding-server";
import { starterPlanFor, dayLabel, dueFor, onboardingDone, phaseOf, validPlan, type PlanStep } from "@/lib/organizations/onboarding-plan";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 33.5 (plan B4.4, K4): Settings → Onboarding plan, Start here for the new person, and Members → Onboarding.
 * Onboarding is seen only by the person, their line manager, their buddy and admins (call 6); How's it going? only by
 * the line manager and admins (call 7). Existing members never get steps (call 1). Never a token.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

const readPlan = (ctx: { settings: unknown; type: string | null; created: string }) => readPlanRaw(ctx.settings, labDefault(ctx.type, ctx.created));

async function company(orgId: string) {
  if (!isLooseUuid(orgId)) return null;
  const { userId } = await getViewerAuthContext();
  if (!userId) return null;
  const a = await getWorkspaceAccessById(orgId, userId);
  const [w] = Array.from(await db.execute<{ type: string | null; settings: unknown; owner: string; note: string | null; created: string }>(sql`
    SELECT org_type AS type, org_settings AS settings, owner_id AS owner, welcome_note AS note, created_at::text AS created FROM workspaces WHERE id = ${orgId}::uuid AND kind = 'organization' AND deleted_at IS NULL`));
  // B6.1b: a research lab's New people plan works the same way (on by default; the manager is the Supervisor).
  if (!w || (w.type !== "company" && w.type !== "research") || !(a.isOwner || a.isMember)) return null;
  const reportsTo = ((w.settings as { staffGrowth?: { reportsTo?: Record<string, string> } } | null)?.staffGrowth?.reportsTo ?? {}) as Record<string, string>;
  // Review parity (lab.ts): an archived, suspended or deleting org reads but takes no changes.
  return { userId, blocked: Boolean(a.writeBlocked), admin: (a.isOwner || a.memberRole === "admin") && !a.writeBlocked, settings: w.settings, owner: w.owner, note: w.note, reportsTo, type: w.type, created: w.created };
}

/** Settings → Onboarding plan (admins): the plan (the starter until saved) and whether it's on. */
export async function readOnboardingPlanAction(orgId: string) {
  const ctx = await company(orgId);
  if (!ctx?.admin) return DENIED;
  const p = readPlan(ctx);
  return { success: true as const, on: Boolean(p.enabledAt), plan: p.plan.length ? p.plan : starterPlanFor(ctx.type), lab: ctx.type === "research" };
}

/** Save the plan; switching it on starts onboarding for people who join from now on — never for people already here. */
export async function saveOnboardingPlanAction(orgId: string, input: { plan: unknown; on: boolean }): Promise<{ success: true } | Failure> {
  const ctx = await company(orgId);
  if (!ctx?.admin) return DENIED;
  if (!validPlan(input?.plan) || typeof input.on !== "boolean") return { success: false, error: "Each step needs a day from −14 to 90, who it’s for and a title." };
  const p = readPlan(ctx);
  const enabledAt = input.on ? p.enabledAt ?? new Date().toISOString() : null;
  await db.execute(sql`UPDATE workspaces SET org_settings = coalesce(org_settings, '{}'::jsonb) || jsonb_build_object('onboarding', ${JSON.stringify({ enabledAt, plan: input.plan })}::jsonb) WHERE id = ${orgId}::uuid`);
  return { success: true };
}

type StepView = { stepId: string; taskId: string | null; title: string; who: string; kind: string; day: number; phase: string; due: string; done: boolean; required: boolean; mine: boolean };
async function stepsOf(orgId: string, rec: OnboardingRecord, plan: PlanStep[], viewer: string) {
  const ids = rec.steps.map((s) => s.taskId).filter((x): x is string => Boolean(x));
  const tasks = ids.length ? new Map(Array.from(await db.execute<{ id: string; title: string; status: string; assignee_id: string | null }>(sql`
    SELECT id, title, status, assignee_id FROM tasks WHERE workspace_id = ${orgId}::uuid AND id IN (${sql.join(ids.map((i) => sql`${i}::uuid`), sql`, `)}) AND deleted_at IS NULL`)).map((t) => [t.id, t])) : new Map();
  return rec.steps.flatMap((s): StepView[] => {
    const step = plan.find((p) => p.id === s.stepId);
    if (!step) return [];
    const t = s.taskId ? tasks.get(s.taskId) : null;
    return [{ stepId: s.stepId, taskId: t?.id ?? null, title: t?.title ?? step.title, who: s.who, kind: step.kind, day: step.day, phase: phaseOf(step.day), due: dueFor(rec.start, step.day),
      done: t?.status === "done", required: step.required, mine: t?.assignee_id === viewer }];
  });
}

/** Start here (the new person): phases, steps, % done, Day N, the welcome note and their buddy. Starts onboarding if due. */
export async function readStartHereAction(orgId: string) {
  const ctx = await company(orgId);
  if (!ctx) return DENIED;
  const rec = ctx.blocked ? await record(orgId, ctx.userId).then((r) => r?.rec ?? null) : await ensureOnboarding(orgId, ctx.userId);
  if (!rec) return { success: true as const, onboarding: null, lab: ctx.type === "research" };
  const steps = await stepsOf(orgId, rec, readPlan(ctx).plan, ctx.userId);
  const people = new Map(Array.from(await db.execute<{ id: string; name: string }>(sql`SELECT id, coalesce(full_name, username, 'Someone') AS name FROM profiles WHERE id IN (${rec.buddy ?? ctx.userId}::uuid, ${ctx.reportsTo[ctx.userId] ?? ctx.userId}::uuid)`)).map((p) => [p.id, p.name]));
  const done = steps.filter((s) => s.done).length;
  return { success: true as const, lab: ctx.type === "research", onboarding: { start: rec.start, day: dayLabel(rec.start, new Date().toISOString().slice(0, 10)), done, total: steps.length, steps,
    complete: onboardingDone(steps), note: ctx.note, buddy: rec.buddy ? { id: rec.buddy, name: people.get(rec.buddy) ?? "Your buddy" } : null,
    manager: ctx.reportsTo[ctx.userId] ? people.get(ctx.reportsTo[ctx.userId]!) ?? null : null, answered: Boolean(rec.answer) } };
}

/** Members → Onboarding (admins all; line managers their reports; buddies the person they're paired with). */
export async function readOnboardingBoardAction(orgId: string) {
  const ctx = await company(orgId);
  if (!ctx) return DENIED;
  const rows = Array.from(await db.execute<{ user_id: string; name: string; rec: OnboardingRecord }>(sql`
    SELECT m.user_id, coalesce(p.full_name, p.username, 'Someone') AS name, m.view_prefs->'onboarding' AS rec FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.view_prefs->'onboarding' IS NOT NULL ORDER BY m.joined_at DESC LIMIT 200`));
  const plan = readPlan(ctx).plan;
  const today = new Date().toISOString().slice(0, 10);
  const visible = rows.filter((r) => ctx.admin || ctx.reportsTo[r.user_id] === ctx.userId || r.rec.buddy === ctx.userId);
  if (!visible.length && !ctx.admin) return DENIED;
  const people = [];
  for (const r of visible) {
    const steps = await stepsOf(orgId, r.rec, plan, ctx.userId);
    const done = steps.filter((s) => s.done).length;
    people.push({ userId: r.user_id, name: r.name, start: r.rec.start, buddy: r.rec.buddy, pct: steps.length ? Math.round((done / steps.length) * 100) : 0,
      overdue: steps.filter((s) => !s.done && s.taskId && s.due < today).length, complete: onboardingDone(steps), steps,
      // Call 7: How's it going? reaches only the line manager and admins.
      answer: ctx.admin || ctx.reportsTo[r.user_id] === ctx.userId ? r.rec.answer ?? null : null });
  }
  const staff = ctx.admin || people.length ? Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Someone') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id WHERE m.workspace_id = ${orgId}::uuid AND m.role <> 'viewer' ORDER BY 2`)) : [];
  return { success: true as const, lab: ctx.type === "research", admin: ctx.admin, me: ctx.userId, people, staff: staff.map((s) => ({ id: s.id, name: s.name })) };
}

async function record(orgId: string, userId: string) {
  const [m] = Array.from(await db.execute<{ rec: OnboardingRecord | null; name: string }>(sql`
    SELECT m.view_prefs->'onboarding' AS rec, coalesce(p.full_name, p.username, 'the new person') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.user_id = ${userId}::uuid`));
  return m?.rec ? { rec: m.rec, name: m.name } : null;
}
const saveRecord = (orgId: string, userId: string, rec: OnboardingRecord) =>
  db.execute(sql`UPDATE workspace_members SET view_prefs = coalesce(view_prefs, '{}'::jsonb) || jsonb_build_object('onboarding', ${JSON.stringify(rec)}::jsonb) WHERE workspace_id = ${orgId}::uuid AND user_id = ${userId}::uuid`);

/** Change the start date (admins): open steps move with it; done steps stay done. */
export async function setOnboardingStartAction(orgId: string, userId: string, start: string): Promise<{ success: true } | Failure> {
  const ctx = await company(orgId);
  if (!ctx?.admin || !isLooseUuid(userId) || !z.string().date().safeParse(start).success) return DENIED;
  const r = await record(orgId, userId);
  if (!r) return { success: false, error: "They haven’t started onboarding." };
  const plan = readPlan(ctx).plan;
  for (const s of r.rec.steps) {
    const step = plan.find((p) => p.id === s.stepId);
    if (step && s.taskId) await db.execute(sql`UPDATE tasks SET due_date = ${`${dueFor(start, step.day)}T17:00:00Z`}::timestamptz, updated_at = now() WHERE id = ${s.taskId}::uuid AND workspace_id = ${orgId}::uuid AND status <> 'done'`);
  }
  await saveRecord(orgId, userId, { ...r.rec, start });
  return { success: true };
}

/** Pick the buddy (admins or the line manager): the buddy's steps go to them (made now, or moved if already made). */
export async function setBuddyAction(orgId: string, userId: string, buddy: string): Promise<{ success: true } | Failure> {
  const ctx = await company(orgId);
  if (ctx?.blocked) return DENIED;
  if (!ctx || !isLooseUuid(userId) || !isLooseUuid(buddy) || !(ctx.admin || ctx.reportsTo[userId] === ctx.userId)) return DENIED;
  if (buddy === userId) return { success: false, error: "Pick someone else as the buddy." };
  const [staff] = Array.from(await db.execute<{ ok: boolean }>(sql`SELECT EXISTS (SELECT 1 FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND user_id = ${buddy}::uuid AND role <> 'viewer') AS ok`));
  if (!staff?.ok) return { success: false, error: "Pick people in the company." };
  const r = await record(orgId, userId);
  if (!r) return { success: false, error: "They haven’t started onboarding." };
  const plan = readPlan(ctx).plan;
  const steps = [];
  for (const s of r.rec.steps) {
    if (s.who !== "buddy") { steps.push(s); continue; }
    const step = plan.find((p) => p.id === s.stepId);
    if (s.taskId) { await db.execute(sql`UPDATE tasks SET assignee_id = ${buddy}::uuid, updated_at = now() WHERE id = ${s.taskId}::uuid AND workspace_id = ${orgId}::uuid AND status <> 'done'`); steps.push(s); }
    else steps.push({ ...s, taskId: step ? await makeStepTask(db, orgId, step, buddy, r.rec.start, r.name, ctx.userId) : null });
  }
  await saveRecord(orgId, userId, { ...r.rec, buddy, steps });
  return { success: true };
}

/** How's it going? (call 7): the new person's written answer; read by their line manager and admins; no score. */
export async function answerHowsItGoingAction(orgId: string, answer: string): Promise<{ success: true } | Failure> {
  const ctx = await company(orgId);
  if (ctx?.blocked) return DENIED;
  const text = typeof answer === "string" ? answer.trim() : "";
  if (!ctx) return DENIED;
  if (!text || text.length > 2000) return { success: false, error: "Write a few words, up to 2,000 characters." };
  const r = await record(orgId, ctx.userId);
  if (!r) return DENIED;
  const step = r.rec.steps.find((s) => s.who === "person" && readPlan(ctx).plan.find((p) => p.id === s.stepId)?.kind === "answer");
  if (step?.taskId) {
    const { updateTaskStatusAction } = await import("@/app/actions/task");
    await updateTaskStatusAction(step.taskId, "done", orgId).catch(() => undefined);
  }
  await saveRecord(orgId, ctx.userId, { ...r.rec, answer: text });
  return { success: true };
}
