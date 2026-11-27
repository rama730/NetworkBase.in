"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { createNotification } from "@/lib/notifications/service";
import { lab, labMember, personOf, supervises, type Ctx } from "@/lib/organizations/lab-progress-access";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 35.6 (plan B6.5c, R5 calls 5–9): the annual review (Progress report → supervisor feedback → committee comments →
 * Agreed next steps; no ratings, scores or rankings — there is no such field), the development plan (up to 3 goals a year,
 * career aims, About me; the person writes it, their supervisors read it), concerns (private to whoever receives them,
 * never sent to the person they're about), and the PI's counts (numbers first, names only on opening).
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };
const REPORT_KEYS = ["did", "outputs", "trainings", "plan", "worries"] as const;
type ReviewState = "writing" | "with_supervisor" | "with_committee" | "agreed";

async function tell(ctx: Ctx, orgId: string, to: string[], title: string, key: string, important = false) {
  for (const u of new Set(to)) {
    if (u === ctx.userId) continue;
    await createNotification({ recipientUserId: u, actorUserId: ctx.userId, kind: "project_task_activity", category: "tasks", importance: important ? "important" : "more", title,
      href: `/org/${encodeURIComponent(ctx.slug)}`, entityRefs: { projectId: orgId, projectSlug: ctx.slug }, dedupeKey: `${key}:${u}` }).catch(() => undefined);
  }
}

type ReviewRow = { id: string; state: ReviewState; report: Record<string, string>; feedback: string; committee_ids: string[]; committee_comments: Array<{ by: string; text: string; at: string }>; next_steps: string };
async function reviewOf(orgId: string, userId: string, key: string, lock = false, ex: Pick<typeof db, "execute"> = db) {
  const [r] = Array.from(await ex.execute<ReviewRow>(sql`
    SELECT id, state, report, feedback, to_jsonb(committee_ids) AS committee_ids, committee_comments, next_steps FROM lab_reviews
    WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND milestone_key = ${key} ${lock ? sql`FOR UPDATE` : sql``}`));
  return r ?? null;
}

/**
 * An annual review (the person; their supervisors; committee members while it's with them). Pulls in, for the report,
 * the person's papers (R2) and trainings (R4) so they don't retype them.
 */
export async function readReviewAction(orgId: string, userId: string, key: string) {
  if (!isLooseUuid(userId) || typeof key !== "string" || !key.startsWith("annual-review")) return DENIED;
  const ctx = await lab(orgId);
  if (!ctx) return readAsCommittee(orgId, userId, key);
  const person = await personOf(ctx, orgId, userId);
  if (!person) return DENIED;
  const [m] = Array.from(await db.execute<{ name: string; due_on: string }>(sql`SELECT name, due_on::text FROM lab_milestones WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND key = ${key}`));
  if (!m) return DENIED;
  const r = await reviewOf(orgId, userId, key);
  const self = userId === ctx.userId;
  const sup = supervises(ctx, person);
  // Call 6: committee members read it only while it's with them, and lose it once agreed.
  const committee = Boolean(r && r.state === "with_committee" && r.committee_ids.includes(ctx.userId));
  if (!self && !sup && !committee) return DENIED;
  const outputs = self ? Array.from(await db.execute<{ title: string; stage: string }>(sql`
    SELECT t.title, t.stage FROM tasks t JOIN workspaces w ON w.id = t.workspace_id AND w.parent_id = ${orgId}::uuid AND w.deleted_at IS NULL
    WHERE t.item_type = 'paper' AND t.deleted_at IS NULL AND t.type_fields->'authors' @> jsonb_build_array(jsonb_build_object('userId', ${userId}::text)) ORDER BY t.updated_at DESC LIMIT 20`)) : [];
  const trainings = self ? Array.from(await db.execute<{ title: string }>(sql`
    SELECT d.filename AS title FROM lab_trainings t JOIN workspace_documents d ON d.id = t.doc_id WHERE t.user_id = ${userId}::uuid AND d.workspace_id = ${orgId}::uuid LIMIT 20`)) : [];
  const names = r?.committee_ids.length ? new Map(Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT id, coalesce(full_name, username, 'Someone') AS name FROM profiles WHERE id = ANY(${`{${r.committee_ids.join(",")}}`}::uuid[])`)).map((x) => [x.id, x.name])) : new Map<string, string>();
  const people = sup ? Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.completed_at IS NULL AND m.user_id <> ${userId}::uuid ORDER BY 2 LIMIT 300`)) : [];
  return { success: true as const, self, sup, committee, milestone: { key, name: m.name, dueOn: m.due_on }, person: { id: userId, name: person.name ?? "Someone" },
    review: r ? { state: r.state, report: r.report, feedback: r.feedback, nextSteps: r.next_steps, committee: r.committee_ids.map((id) => ({ id, name: names.get(id) ?? "Someone" })),
      comments: r.committee_comments.map((c) => ({ ...c, by: names.get(c.by) ?? "A committee member" })) } : null,
    pulled: { outputs: outputs.map((o) => `${o.title} (${o.stage})`), trainings: trainings.map((t) => t.title.replace(/\.md$/i, "")) }, people };
}

const reportSchema = z.object(Object.fromEntries(REPORT_KEYS.map((k) => [k, z.string().trim().max(6000)])) as Record<(typeof REPORT_KEYS)[number], z.ZodString>).strict();

/** The person writes (and saves) their Progress report, then hands it in to their supervisor. */
export async function saveProgressReportAction(orgId: string, key: string, input: unknown, handIn: boolean): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = reportSchema.safeParse(input);
  if (!ctx || ctx.blocked || typeof key !== "string" || !key.startsWith("annual-review") || !parsed.success || typeof handIn !== "boolean") return DENIED;
  const [m] = Array.from(await db.execute<{ name: string }>(sql`SELECT name FROM lab_milestones WHERE org_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid AND key = ${key} AND state <> 'done'`));
  if (!m) return DENIED;
  if (handIn && !parsed.data.did) return { success: false, error: "Say what you did this year before handing it in." };
  const out = await db.transaction(async (tx) => {
    await tx.execute(sql`INSERT INTO lab_reviews (org_id, user_id, milestone_key) VALUES (${orgId}::uuid, ${ctx.userId}::uuid, ${key}) ON CONFLICT DO NOTHING`);
    const [r] = Array.from(await tx.execute<{ state: ReviewState }>(sql`SELECT state FROM lab_reviews WHERE org_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid AND milestone_key = ${key} FOR UPDATE`));
    if (r?.state !== "writing") return false;
    await tx.execute(sql`UPDATE lab_reviews SET report = ${JSON.stringify(parsed.data)}::jsonb, updated_at = now(), ${handIn ? sql`state = 'with_supervisor', handed_in_at = now()` : sql`state = 'writing'`}
      WHERE org_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid AND milestone_key = ${key}`);
    if (handIn) await tx.execute(sql`UPDATE lab_milestones SET state = 'handed_in', handed_in_at = now() WHERE org_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid AND key = ${key} AND state = 'upcoming'`);
    return true;
  });
  if (!out) return { success: false, error: "It’s with your supervisor now." };
  if (handIn) {
    const person = await personOf(ctx, orgId, ctx.userId);
    if (person) await tell(ctx, orgId, [person.supervisor, ...(person.co ? [person.co] : [])], `${person.name ?? "Someone"} handed in their Progress report (${m.name})`, `lab-review-in:${orgId}:${ctx.userId}:${key}`);
  }
  return { success: true };
}

const decideSchema = z.object({ feedback: z.string().trim().max(10000), committeeIds: z.array(z.string().uuid()).max(5), nextSteps: z.string().trim().max(4000) }).strict();

/**
 * The supervisor's step: feedback, then either send it to a committee (up to 5 people in the lab, Viewers included) or
 * agree the next steps. With a committee, the supervisor agrees once they've commented (or without waiting).
 */
export async function decideReviewAction(orgId: string, userId: string, key: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = decideSchema.safeParse(input);
  if (!ctx || ctx.blocked || !isLooseUuid(userId) || typeof key !== "string" || !parsed.success) return DENIED;
  const person = await personOf(ctx, orgId, userId);
  if (!person || !supervises(ctx, person) || userId === ctx.userId) return DENIED;
  const d = parsed.data;
  const toCommittee = d.committeeIds.length > 0;
  if (!d.feedback) return { success: false, error: "Write your feedback first." };
  if (!toCommittee && !d.nextSteps) return { success: false, error: "Agree the next steps to close the review." };
  if (toCommittee) {
    const ok = Array.from(await db.execute<{ id: string }>(sql`
      SELECT user_id AS id FROM workspace_members WHERE workspace_id = ${orgId}::uuid AND completed_at IS NULL AND user_id = ANY(${`{${d.committeeIds.join(",")}}`}::uuid[]) AND user_id <> ${userId}::uuid`));
    if (ok.length !== new Set(d.committeeIds).size) return { success: false, error: "Committee members are people in the lab (Viewers too), not the student." };
  }
  const done = await db.transaction(async (tx) => {
    // Security review: the row lock is taken inside this transaction.
    const r = await reviewOf(orgId, userId, key, true, tx);
    if (!r || (r.state !== "with_supervisor" && r.state !== "with_committee")) return false;
    if (toCommittee && r.state === "with_supervisor") {
      await tx.execute(sql`UPDATE lab_reviews SET feedback = ${d.feedback}, committee_ids = ${`{${[...new Set(d.committeeIds)].join(",")}}`}::uuid[], state = 'with_committee', updated_at = now() WHERE id = ${r.id}::uuid`);
      return "committee";
    }
    if (!d.nextSteps) return false;
    await tx.execute(sql`UPDATE lab_reviews SET feedback = ${d.feedback}, next_steps = ${d.nextSteps}, state = 'agreed', agreed_at = now(), updated_at = now() WHERE id = ${r.id}::uuid`);
    await tx.execute(sql`UPDATE lab_milestones SET state = 'done', done_at = now(), done_by = ${ctx.userId}::uuid WHERE org_id = ${orgId}::uuid AND user_id = ${userId}::uuid AND key = ${key}`);
    return "agreed";
  });
  if (!done) return { success: false, error: "This review isn’t waiting for you." };
  if (done === "committee") await tell(ctx, orgId, d.committeeIds, `${person.name ?? "A student"}'s annual review is ready for your comments`, `lab-review-committee:${orgId}:${userId}:${key}`);
  else await tell(ctx, orgId, [userId], "Your annual review is agreed: see the next steps", `lab-review-agreed:${orgId}:${userId}:${key}`);
  return { success: true };
}

/** A Viewer on the committee: the report, feedback and comments, while it's with the committee — nothing else. */
async function readAsCommittee(orgId: string, userId: string, key: string) {
  const me = await labMember(orgId);
  const r = me ? await reviewOf(orgId, userId, key) : null;
  if (!me || !r || r.state !== "with_committee" || !r.committee_ids.includes(me.userId)) return DENIED;
  const [m] = Array.from(await db.execute<{ name: string; due_on: string; person: string }>(sql`
    SELECT x.name, x.due_on::text, coalesce(p.full_name, p.username, 'Someone') AS person FROM lab_milestones x JOIN profiles p ON p.id = x.user_id
    WHERE x.org_id = ${orgId}::uuid AND x.user_id = ${userId}::uuid AND x.key = ${key}`));
  if (!m) return DENIED;
  return { success: true as const, self: false, sup: false, committee: true, milestone: { key, name: m.name, dueOn: m.due_on }, person: { id: userId, name: m.person },
    review: { state: r.state, report: r.report, feedback: r.feedback, nextSteps: r.next_steps, committee: [], comments: r.committee_comments.map((c) => ({ ...c, by: c.by === me.userId ? "You" : "A committee member" })) },
    pulled: { outputs: [] as string[], trainings: [] as string[] }, people: [] as Array<{ id: string; name: string }> };
}

/** A committee member comments while the review is with the committee (Viewers included). */
export async function commentReviewAction(orgId: string, userId: string, key: string, text: unknown): Promise<{ success: true } | Failure> {
  const ctx = await labMember(orgId);
  if (!ctx || ctx.blocked || !isLooseUuid(userId) || typeof key !== "string" || typeof text !== "string" || !text.trim() || text.length > 4000) return DENIED;
  const ok = await db.transaction(async (tx) => {
    const r = await reviewOf(orgId, userId, key, true, tx);
    if (!r || r.state !== "with_committee" || !r.committee_ids.includes(ctx.userId)) return false;
    const comments = [...r.committee_comments, { by: ctx.userId, text: text.trim(), at: new Date().toISOString() }].slice(-30);
    const done = Array.from(await tx.execute(sql`UPDATE lab_reviews SET committee_comments = ${JSON.stringify(comments)}::jsonb, updated_at = now()
      WHERE id = ${r.id}::uuid AND state = 'with_committee' AND ${ctx.userId}::uuid = ANY(committee_ids) RETURNING id`));
    return done.length > 0;
  });
  return ok ? { success: true } : DENIED;
}

const planSchema = z.object({ year: z.number().int().min(2000).max(2100), goals: z.array(z.string().trim().min(1).max(300)).max(3), careerAims: z.string().trim().max(2000), aboutMe: z.string().trim().max(4000) }).strict();

/** The development plan (call 7): the person writes it; they and their supervisors read it. */
export async function readPlanAction(orgId: string, userId: string | null, year: number) {
  const ctx = await lab(orgId);
  const who = userId ?? ctx?.userId ?? "";
  if (!ctx || !isLooseUuid(who) || !Number.isInteger(year)) return DENIED;
  if (who !== ctx.userId) {
    const person = await personOf(ctx, orgId, who);
    if (!person || !supervises(ctx, person)) return DENIED;
  }
  const [p] = Array.from(await db.execute<{ goals: string[]; career_aims: string; about_me: string }>(sql`
    SELECT goals, career_aims, about_me FROM lab_plans WHERE org_id = ${orgId}::uuid AND user_id = ${who}::uuid AND year = ${year}`));
  return { success: true as const, mine: who === ctx.userId, plan: p ? { goals: p.goals, careerAims: p.career_aims, aboutMe: p.about_me } : null };
}

export async function savePlanAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = planSchema.safeParse(input);
  if (!ctx || ctx.blocked) return DENIED;
  if (!parsed.success) return { success: false, error: "A plan has up to 3 goals for the year." };
  const p = parsed.data;
  await db.execute(sql`INSERT INTO lab_plans (org_id, user_id, year, goals, career_aims, about_me) VALUES (${orgId}::uuid, ${ctx.userId}::uuid, ${p.year}, ${JSON.stringify(p.goals)}::jsonb, ${p.careerAims}, ${p.aboutMe})
    ON CONFLICT (org_id, user_id, year) DO UPDATE SET goals = EXCLUDED.goals, career_aims = EXCLUDED.career_aims, about_me = EXCLUDED.about_me, updated_at = now()`);
  return { success: true };
}

/**
 * Who a concern can go to (call 8): your supervisor, co-supervisor, the PI, and the owner of the institution the lab
 * belongs to — never the person it's about. Without an institution, a concern about the PI goes to a supervisor only.
 */
async function concernReceivers(ctx: Ctx, orgId: string) {
  const person = await personOf(ctx, orgId, ctx.userId);
  const [inst] = Array.from(await db.execute<{ owner: string | null; title: string | null }>(sql`
    SELECT i.owner_id AS owner, i.title FROM workspaces w JOIN workspaces i ON i.id = w.institution_id AND i.deleted_at IS NULL WHERE w.id = ${orgId}::uuid`));
  const ids = [...new Set([person?.supervisor, person?.co, ctx.owner, inst?.owner].filter((x): x is string => Boolean(x) && x !== ctx.userId))];
  const names = ids.length ? new Map(Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT id, coalesce(full_name, username, 'Someone') AS name FROM profiles WHERE id = ANY(${`{${ids.join(",")}}`}::uuid[])`)).map((r) => [r.id, r.name])) : new Map<string, string>();
  const role = (id: string) => [id === person?.supervisor ? "supervisor" : null, id === person?.co ? "co-supervisor" : null, id === ctx.owner ? "PI" : null,
    id === inst?.owner ? `${inst?.title ?? "the institution"}'s contact` : null].filter(Boolean).join(", ");
  return ids.map((id) => ({ id, name: names.get(id) ?? "Someone", role: role(id) }));
}

/** The concern box (members): who it can go to, what I sent, and what was sent to me (only to me). */
export async function readConcernsAction(orgId: string) {
  const ctx = await lab(orgId);
  if (!ctx) return DENIED;
  const received = Array.from(await db.execute<{ id: string; body: string; at: string; from: string | null; about: string | null; read: boolean }>(sql`
    SELECT c.id, c.body, c.created_at::text AS at, (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = c.from_id) AS from,
      (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = c.about_id) AS about, c.read_at IS NOT NULL AS read
    FROM lab_concerns c WHERE c.org_id = ${orgId}::uuid AND c.to_id = ${ctx.userId}::uuid ORDER BY c.created_at DESC LIMIT 50`));
  const sent = Array.from(await db.execute<{ id: string; at: string; to: string | null; read: boolean }>(sql`
    SELECT c.id, c.created_at::text AS at, (SELECT coalesce(p.full_name, p.username) FROM profiles p WHERE p.id = c.to_id) AS to, c.read_at IS NOT NULL AS read
    FROM lab_concerns c WHERE c.org_id = ${orgId}::uuid AND c.from_id = ${ctx.userId}::uuid ORDER BY c.created_at DESC LIMIT 20`));
  const lab_people = Array.from(await db.execute<{ id: string; name: string }>(sql`
    SELECT p.id, coalesce(p.full_name, p.username, 'Member') AS name FROM workspace_members m JOIN profiles p ON p.id = m.user_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.completed_at IS NULL AND m.user_id <> ${ctx.userId}::uuid ORDER BY 2 LIMIT 300`));
  return { success: true as const, receivers: await concernReceivers(ctx, orgId), received, sent, people: lab_people };
}

const concernSchema = z.object({ to: z.string().uuid(), about: z.string().uuid().nullable(), body: z.string().trim().min(1).max(4000) }).strict();

/** Raise a concern: private to its receiver (Important notice), never to the person it's about. */
export async function raiseConcernAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  const parsed = concernSchema.safeParse(input);
  // Deliberately no write-block refusal: a concern is a safety channel and stays open while a lab is restricted.
  if (!ctx) return DENIED;
  if (!parsed.success) return { success: false, error: "Say what worries you and who should hear it." };
  const c = parsed.data;
  if (c.about && c.about === c.to) return { success: false, error: "A concern never goes to the person it’s about. Pick someone else." };
  const receivers = await concernReceivers(ctx, orgId);
  if (!receivers.some((r) => r.id === c.to)) return DENIED;
  await db.execute(sql`INSERT INTO lab_concerns (org_id, from_id, to_id, about_id, body) VALUES (${orgId}::uuid, ${ctx.userId}::uuid, ${c.to}::uuid, ${c.about}::uuid, ${c.body})`);
  await tell(ctx, orgId, [c.to], "Someone in the lab raised a concern with you", `lab-concern:${orgId}:${ctx.userId}:${Date.now()}`, true);
  return { success: true };
}

export async function markConcernReadAction(orgId: string, id: string): Promise<{ success: true } | Failure> {
  const ctx = await lab(orgId);
  if (!ctx || !isLooseUuid(id)) return DENIED;
  const [r] = Array.from(await db.execute<{ id: string }>(sql`UPDATE lab_concerns SET read_at = coalesce(read_at, now()) WHERE id = ${id}::uuid AND org_id = ${orgId}::uuid AND to_id = ${ctx.userId}::uuid RETURNING id`));
  return r ? { success: true } : DENIED;
}

/**
 * The PI's counts (call 9): supervision gaps over 4 weeks, milestones in the next 60 days, overdue reviews — numbers on the
 * card; each list opens on click with names and dates, never a ranking.
 */
export async function readLabCountsAction(orgId: string, open?: "gaps" | "milestones" | "reviews") {
  const ctx = await lab(orgId);
  if (!ctx?.pi) return DENIED;
  const gaps = Array.from(await db.execute<{ name: string; last: string | null }>(sql`
    SELECT coalesce(p.full_name, p.username, 'Someone') AS name, (SELECT max(met_on)::text FROM lab_supervision_notes n WHERE n.org_id = lp.org_id AND n.student_id = lp.user_id) AS last
    FROM lab_progress lp JOIN profiles p ON p.id = lp.user_id JOIN workspace_members m ON m.workspace_id = lp.org_id AND m.user_id = lp.user_id AND m.completed_at IS NULL
    WHERE lp.org_id = ${orgId}::uuid AND coalesce((SELECT max(met_on) FROM lab_supervision_notes n WHERE n.org_id = lp.org_id AND n.student_id = lp.user_id), lp.start_date) < current_date - 28
    ORDER BY 2 NULLS FIRST LIMIT 200`));
  const milestones = Array.from(await db.execute<{ name: string; milestone: string; due: string }>(sql`
    SELECT coalesce(p.full_name, p.username, 'Someone') AS name, x.name AS milestone, x.due_on::text AS due FROM lab_milestones x JOIN profiles p ON p.id = x.user_id
      JOIN workspace_members m ON m.workspace_id = x.org_id AND m.user_id = x.user_id AND m.completed_at IS NULL
    WHERE x.org_id = ${orgId}::uuid AND x.state <> 'done' AND x.due_on BETWEEN current_date AND current_date + 60 ORDER BY x.due_on LIMIT 200`));
  const reviews = Array.from(await db.execute<{ name: string; milestone: string; due: string }>(sql`
    SELECT coalesce(p.full_name, p.username, 'Someone') AS name, x.name AS milestone, x.due_on::text AS due FROM lab_milestones x JOIN profiles p ON p.id = x.user_id
      JOIN workspace_members m ON m.workspace_id = x.org_id AND m.user_id = x.user_id AND m.completed_at IS NULL
    WHERE x.org_id = ${orgId}::uuid AND x.key LIKE 'annual-review%' AND x.state <> 'done' AND x.due_on < current_date ORDER BY x.due_on LIMIT 200`));
  return { success: true as const, counts: { gaps: gaps.length, milestones: milestones.length, reviews: reviews.length },
    list: open === "gaps" ? gaps.map((g) => ({ name: g.name, line: g.last ? `last supervision ${g.last}` : "no supervision yet" }))
      : open === "milestones" ? milestones.map((m) => ({ name: m.name, line: `${m.milestone} · ${m.due}` }))
        : open === "reviews" ? reviews.map((r) => ({ name: r.name, line: `${r.milestone} · was due ${r.due}` })) : null };
}
