"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { mentoringCtx, pairedSince } from "@/lib/organizations/mentoring-server";
import { MISTAKE_REASONS, stageCounts, TOPIC_STAGES, weakTopics, type MistakeReason, type TopicStage } from "@/lib/organizations/prep";
import { isLooseUuid } from "@/lib/validations/uuid";

/**
 * Report 31.4 C3 calls 8–9 (plan B2.4b): the class's Syllabus (staff list the topics; each learner sets their own
 * stage; staff see counts) and a learner's Mistakes (private; their mentor sees only what they share). AI agents may log
 * a mistake for the learner (call 11); nothing here sets marks.
 */
type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You can’t do that here." };

async function topics(orgId: string) {
  return Array.from(await db.execute<{ id: string; name: string }>(sql`SELECT id, name FROM prep_topics WHERE workspace_id = ${orgId}::uuid ORDER BY position, created_at`));
}

/** The Syllabus: learners get their own stages; staff get counts per stage. */
export async function readSyllabusAction(orgId: string) {
  const ctx = await mentoringCtx(orgId);
  if (!ctx || !(ctx.staff || ctx.learner)) return DENIED;
  const list = await topics(orgId);
  if (ctx.learner) {
    const mine = new Map(Array.from(await db.execute<{ topic_id: string; stage: TopicStage }>(sql`
      SELECT topic_id, stage FROM prep_topic_stages WHERE workspace_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid`)).map((r) => [r.topic_id, r.stage]));
    return { success: true as const, staff: false as const, topics: list.map((t) => ({ ...t, stage: mine.get(t.id) ?? ("not_started" as TopicStage) })) };
  }
  const rows = Array.from(await db.execute<{ topicId: string; stage: TopicStage }>(sql`SELECT topic_id AS "topicId", stage FROM prep_topic_stages WHERE workspace_id = ${orgId}::uuid`));
  const counts = stageCounts(rows, list.map((t) => t.id));
  return { success: true as const, staff: true as const, canEdit: ctx.staff, topics: list.map((t) => ({ ...t, counts: counts.get(t.id)! })) };
}

/** Staff set the topic list (one per line); topics keep their stages by name. */
export async function saveTopicsAction(orgId: string, names: string[]): Promise<{ success: true } | Failure> {
  const ctx = await mentoringCtx(orgId, true);
  if (!ctx?.staff) return DENIED;
  const clean = [...new Set((Array.isArray(names) ? names : []).map((n) => String(n).trim().slice(0, 120)).filter(Boolean))].slice(0, 200);
  await db.transaction(async (tx) => {
    const existing = Array.from(await tx.execute<{ id: string; name: string }>(sql`SELECT id, name FROM prep_topics WHERE workspace_id = ${orgId}::uuid`));
    for (const e of existing) if (!clean.includes(e.name)) await tx.execute(sql`DELETE FROM prep_topics WHERE id = ${e.id}::uuid`);
    for (const [i, name] of clean.entries()) {
      const e = existing.find((x) => x.name === name);
      if (e) await tx.execute(sql`UPDATE prep_topics SET position = ${i} WHERE id = ${e.id}::uuid`);
      else await tx.execute(sql`INSERT INTO prep_topics (workspace_id, name, position) VALUES (${orgId}::uuid, ${name}, ${i})`);
    }
  });
  return { success: true };
}

/** A learner sets their own stage on a topic. */
export async function setTopicStageAction(orgId: string, topicId: string, stage: TopicStage): Promise<{ success: true } | Failure> {
  const ctx = await mentoringCtx(orgId, true);
  if (!ctx?.learner || !isLooseUuid(topicId) || !(stage in TOPIC_STAGES)) return DENIED;
  const done = Array.from(await db.execute<{ ok: number }>(sql`
    INSERT INTO prep_topic_stages (topic_id, workspace_id, user_id, stage)
    SELECT id, workspace_id, ${ctx.userId}::uuid, ${stage} FROM prep_topics WHERE id = ${topicId}::uuid AND workspace_id = ${orgId}::uuid
    ON CONFLICT (topic_id, user_id) DO UPDATE SET stage = excluded.stage, updated_at = now() RETURNING 1 AS ok`));
  return done.length ? { success: true } : DENIED;
}

/** My mistakes (the learner), or a mentee's shared ones (their mentor). Weak topics come from the learner's own. */
export async function readMistakesAction(orgId: string, who: string | null) {
  const ctx = await mentoringCtx(orgId);
  if (!ctx) return DENIED;
  const learnerId = who ?? ctx.userId;
  if (!isLooseUuid(learnerId)) return DENIED;
  const own = learnerId === ctx.userId && ctx.learner;
  if (!own && !(await pairedSince(orgId, ctx.userId, learnerId))) return DENIED;
  const rows = Array.from(await db.execute<{ id: string; topic_id: string | null; topic: string | null; reason: MistakeReason; note: string | null; shared: boolean; at: string }>(sql`
    SELECT m.id, m.topic_id, t.name AS topic, m.reason, m.note, m.shared_at IS NOT NULL AS shared, m.created_at::text AS at
    FROM prep_mistakes m LEFT JOIN prep_topics t ON t.id = m.topic_id
    WHERE m.workspace_id = ${orgId}::uuid AND m.user_id = ${learnerId}::uuid ${own ? sql`` : sql`AND m.shared_at IS NOT NULL`} ORDER BY m.created_at DESC LIMIT 200`));
  const list = await topics(orgId);
  return { success: true as const, own, mistakes: rows.map((r) => ({ id: r.id, topic: r.topic, reason: r.reason, note: r.note, shared: r.shared, at: r.at })),
    weak: own ? weakTopics(rows.map((r) => ({ topicId: r.topic_id, at: r.at })), list) : [], topics: list };
}

const mistakeInput = z.object({ topicId: z.string().uuid().nullable().optional(), reason: z.enum(Object.keys(MISTAKE_REASONS) as [MistakeReason, ...MistakeReason[]]), note: z.string().trim().max(1000).optional() }).strict();

/** Log a mistake (the learner, or an agent for them, call 11). */
export async function logMistakeAction(orgId: string, input: unknown): Promise<{ success: true } | Failure> {
  const ctx = await mentoringCtx(orgId);
  if (!ctx?.learner) return DENIED;
  const parsed = mistakeInput.safeParse(input);
  if (!parsed.success) return { success: false, error: "Pick a reason." };
  const topicId = parsed.data.topicId ?? null;
  if (topicId && !(await topics(orgId)).some((t) => t.id === topicId)) return { success: false, error: "Pick one of the class’s topics." };
  await db.execute(sql`INSERT INTO prep_mistakes (workspace_id, user_id, topic_id, reason, note) VALUES (${orgId}::uuid, ${ctx.userId}::uuid, ${topicId}::uuid, ${parsed.data.reason}, ${parsed.data.note || null})`);
  return { success: true };
}

/** Share a mistake with your mentor (or stop sharing). */
export async function shareMistakeAction(orgId: string, mistakeId: string, share: boolean): Promise<{ success: true } | Failure> {
  const ctx = await mentoringCtx(orgId, true);
  if (!ctx?.learner || !isLooseUuid(mistakeId)) return DENIED;
  const done = Array.from(await db.execute<{ ok: number }>(sql`
    UPDATE prep_mistakes SET shared_at = ${share ? sql`now()` : sql`NULL`} WHERE id = ${mistakeId}::uuid AND workspace_id = ${orgId}::uuid AND user_id = ${ctx.userId}::uuid RETURNING 1 AS ok`));
  return done.length ? { success: true } : DENIED;
}
