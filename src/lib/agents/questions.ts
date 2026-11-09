/**
 * Agents asking people (report §20.1, §20.4, §26.4). By default a question goes to the person whose token the agent
 * uses; it may go to a task's assignee or reviewer (the workspace owner) only with the `ask:others` permission, on
 * a task in its workspace, at most 10 a day. At most 3 open questions per token; each expires after 24 hours. The
 * question and its answer are kept in the task's activity.
 */
import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { agentQuestionMutes, agentQuestions, profiles, taskActivityEvents, tasks, workspaces } from "@/lib/db/schema";
import { enqueueNotificationFanout } from "@/lib/notifications/fanout";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { requestVia } from "@/lib/server/request-via";

export const QUESTION_TTL_MS = 24 * 60 * 60_000;
const MAX_OPEN = 3;
const OTHERS_PER_DAY = 10;

/** `nb.question/1` (report §20.1). */
export const questionSchema = z.object({
  key: z.string().trim().min(1).max(40).regex(/^[a-z0-9_-]+$/i),
  header: z.string().trim().min(1).max(12),
  question: z.string().trim().min(1).max(400),
  multiSelect: z.boolean().optional(),
  allowOther: z.boolean().optional(),
  options: z.array(z.object({ value: z.string().trim().min(1).max(60), label: z.string().trim().min(1).max(80), description: z.string().trim().max(200).optional(), recommended: z.boolean().optional() })).min(2).max(4),
  preview: z.object({ kind: z.enum(["text", "diff", "code"]), text: z.string().max(8000) }).optional(),
});
export const askSchema = z.object({
  projectId: z.string().uuid(),
  taskId: z.string().uuid().optional(),
  to: z.enum(["me", "assignee", "reviewer"]).default("me"),
  context: z.string().trim().max(120).optional(),
  questions: z.array(questionSchema).min(1).max(4),
});
export const answerSchema = z.object({
  answers: z.record(z.string(), z.union([z.string().max(500), z.array(z.string().max(60)).max(4)])),
});

export class QuestionError extends Error {
  constructor(message: string, readonly status: number, readonly code: "BAD_REQUEST" | "FORBIDDEN" | "RATE_LIMITED" | "NOT_FOUND" | "CONFLICT" | "SCOPE_MISSING") {
    super(message);
  }
}

type Asker = { user: { id: string }; extensionSessionId: string | null; tokenScopes: Set<string> | null };

export async function askQuestion(asker: Asker, input: z.infer<typeof askSchema>) {
  const via = await requestVia();
  const task = input.taskId
    ? (await db.select({ id: tasks.id, projectId: tasks.projectId, assigneeId: tasks.assigneeId, title: tasks.title, taskNumber: tasks.taskNumber, sprintId: tasks.sprintId }).from(tasks).where(eq(tasks.id, input.taskId)).limit(1))[0]
    : undefined;
  if (input.taskId && (!task || task.projectId !== input.projectId)) throw new QuestionError("Task not found in this workspace", 404, "NOT_FOUND");
  if (input.to !== "me" && !task) throw new QuestionError("Questions to an assignee or reviewer need a task", 400, "BAD_REQUEST");
  if (input.to !== "me" && asker.tokenScopes && !asker.tokenScopes.has("ask:others")) throw new QuestionError("This token may only ask the person it belongs to (it needs the ask:others permission)", 403, "SCOPE_MISSING");
  let toUserId = asker.user.id;
  if (input.to === "assignee") {
    if (!task?.assigneeId) throw new QuestionError("The task has no assignee to ask", 400, "BAD_REQUEST");
    toUserId = task.assigneeId;
  } else if (input.to === "reviewer") {
    const [ws] = await db.select({ ownerId: workspaces.ownerId }).from(workspaces).where(eq(workspaces.id, input.projectId)).limit(1);
    if (!ws) throw new QuestionError("Workspace not found", 404, "NOT_FOUND");
    toUserId = ws.ownerId;
  }
  if (toUserId !== asker.user.id) {
    if (!(await consumeRateLimit(`agent-questions:others:${asker.extensionSessionId ?? asker.user.id}`, OTHERS_PER_DAY, 86_400)).allowed) throw new QuestionError(`At most ${OTHERS_PER_DAY} questions a day to other people`, 429, "RATE_LIMITED");
    if (task && via?.sessionId) {
      const [muted] = await db.select({ userId: agentQuestionMutes.userId }).from(agentQuestionMutes).where(and(eq(agentQuestionMutes.userId, toUserId), eq(agentQuestionMutes.sessionId, via.sessionId), eq(agentQuestionMutes.taskId, task.id))).limit(1);
      if (muted) throw new QuestionError("That person muted this agent's questions on this task", 403, "FORBIDDEN");
    }
  }
  const sessionId = via?.sessionId ?? (asker.extensionSessionId && /^[0-9a-f-]{36}$/i.test(asker.extensionSessionId) ? asker.extensionSessionId : null);
  if (sessionId) {
    const [open] = await db.select({ n: count() }).from(agentQuestions).where(and(eq(agentQuestions.askerSessionId, sessionId), eq(agentQuestions.status, "open"), gt(agentQuestions.expiresAt, new Date())));
    if ((open?.n ?? 0) >= MAX_OPEN) throw new QuestionError(`At most ${MAX_OPEN} open questions at a time; wait for answers first`, 429, "RATE_LIMITED");
  }

  const [asked] = await db.transaction(async (tx) => {
    const rows = await tx.insert(agentQuestions).values({
      workspaceId: input.projectId, taskId: task?.id ?? null, askerUserId: asker.user.id, askerSessionId: sessionId, agentName: via?.agentName ?? null,
      toRole: input.to, toUserId, context: input.context ?? null, questions: input.questions, expiresAt: new Date(Date.now() + QUESTION_TTL_MS),
    }).returning();
    if (task) {
      await tx.insert(taskActivityEvents).values({
        taskId: task.id, projectId: input.projectId, sprintId: task.sprintId, actorId: asker.user.id, eventType: "agent_question",
        payload: { version: 1, questionId: rows[0]!.id, to: input.to, toUserId, agentName: via?.agentName ?? null, via: via?.via ?? null, questions: input.questions, taskTitle: task.title, taskNumber: task.taskNumber },
      });
    }
    return rows;
  });

  const [owner] = await db.select({ name: profiles.fullName, username: profiles.username }).from(profiles).where(eq(profiles.id, asker.user.id)).limit(1);
  const from = `${via?.agentName ?? "Your CLI"}${toUserId !== asker.user.id ? `, on behalf of ${owner?.name ?? owner?.username ?? "a teammate"},` : ""}`;
  await enqueueNotificationFanout({
    source: "agent-question",
    writes: [{
      operation: "create",
      input: {
        // To the person themself: the agent is asking, not them, so no actor (self-notifications are dropped).
        recipientUserId: toUserId, actorUserId: toUserId === asker.user.id ? null : asker.user.id, kind: "agent_question", category: "tasks", importance: "important",
        title: `${from} asks: ${input.questions[0]!.question}`.slice(0, 200), body: input.questions.length > 1 ? `${input.questions.length} questions` : null,
        href: task ? `/workspaces/${input.projectId}?tab=tasks&task=${task.id}&question=${asked!.id}` : `/workspaces/${input.projectId}?question=${asked!.id}`,
        entityRefs: { projectId: input.projectId, ...(task ? { taskId: task.id } : {}) },
        dedupeKey: `agent-question:${asked!.id}`,
      },
    }],
  });
  return asked!;
}

export function publicQuestion(q: typeof agentQuestions.$inferSelect) {
  const expired = q.status === "open" && q.expiresAt <= new Date();
  return {
    schema: "nb.question/1", id: q.id, workspaceId: q.workspaceId, taskId: q.taskId, to: q.toRole, agentName: q.agentName, context: q.context,
    questions: q.questions, status: expired ? "expired" : q.status, answer: q.answer, answeredAt: q.answeredAt?.toISOString() ?? null, expiresAt: q.expiresAt.toISOString(),
  };
}

export async function readQuestion(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [q] = await db.select().from(agentQuestions).where(eq(agentQuestions.id, id)).limit(1);
  return q ?? null;
}

/** Waits up to `waitMs` for an answer (long-poll), checking every second. */
export async function waitForAnswer(id: string, waitMs: number) {
  const until = Date.now() + Math.min(Math.max(waitMs, 0), 25_000);
  for (;;) {
    const q = await readQuestion(id);
    if (!q || q.status !== "open" || q.expiresAt <= new Date() || Date.now() >= until) return q;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export async function answerQuestion(userId: string, id: string, input: z.infer<typeof answerSchema>) {
  const q = await readQuestion(id);
  if (!q || q.toUserId !== userId) throw new QuestionError("Question not found", 404, "NOT_FOUND");
  if (q.status !== "open" || q.expiresAt <= new Date()) throw new QuestionError("This question was already answered or has expired", 409, "CONFLICT");
  const keys = new Set((q.questions as Array<{ key: string }>).map((x) => x.key));
  for (const key of Object.keys(input.answers)) if (!keys.has(key)) throw new QuestionError(`No question ${key}`, 400, "BAD_REQUEST");
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx.update(agentQuestions).set({ status: "answered", answer: input.answers, answeredBy: userId, answeredAt: new Date() })
      .where(and(eq(agentQuestions.id, id), eq(agentQuestions.status, "open"))).returning();
    if (!rows.length) throw new QuestionError("This question was already answered", 409, "CONFLICT");
    if (q.taskId) {
      const [task] = await tx.select({ sprintId: tasks.sprintId }).from(tasks).where(eq(tasks.id, q.taskId)).limit(1);
      await tx.insert(taskActivityEvents).values({ taskId: q.taskId, projectId: q.workspaceId, sprintId: task?.sprintId ?? null, actorId: userId, eventType: "agent_question_answered", payload: { version: 1, questionId: id, answers: input.answers, agentName: q.agentName } });
    }
    return rows;
  });
  return updated!;
}

export async function muteAsker(userId: string, id: string) {
  const q = await readQuestion(id);
  if (!q || q.toUserId !== userId) throw new QuestionError("Question not found", 404, "NOT_FOUND");
  if (!q.askerSessionId || !q.taskId) throw new QuestionError("Only an agent's questions on a task can be muted", 400, "BAD_REQUEST");
  await db.insert(agentQuestionMutes).values({ userId, sessionId: q.askerSessionId, taskId: q.taskId }).onConflictDoNothing();
  await db.update(agentQuestions).set({ status: "cancelled" }).where(and(eq(agentQuestions.id, id), eq(agentQuestions.status, "open")));
}

/** Open questions for this person, newest first (the app's question card, `nb ask list`). */
export async function openQuestionsFor(userId: string, filter: { taskId?: string } = {}) {
  const rows = await db.select().from(agentQuestions)
    .where(and(eq(agentQuestions.toUserId, userId), eq(agentQuestions.status, "open"), gt(agentQuestions.expiresAt, new Date()), filter.taskId ? eq(agentQuestions.taskId, filter.taskId) : sql`true`))
    .orderBy(desc(agentQuestions.createdAt)).limit(20);
  return rows.map(publicQuestion);
}
