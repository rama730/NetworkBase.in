"use server";

import { and, desc, eq, gt } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { agentQuestions, undoOperations, workspaces } from "@/lib/db/schema";
import { createClient } from "@/lib/supabase/server";

export type AgentActivity = {
  changes: Array<{ id: string; summary: string; workspace: string | null; at: string; undoable: boolean }>;
  questions: Array<{ id: string; context: string | null; status: string; at: string }>;
};

/**
 * What one of your agent sign-ins did lately (CLI report A11.7): its changes of the last 7 days, each with Undo while
 * that's still possible (24 h), and the questions it asked. Only your own sessions.
 */
export async function readAgentActivityAction(sessionId: string): Promise<{ success: true; activity: AgentActivity } | { success: false; error: string }> {
  if (!z.string().uuid().safeParse(sessionId).success) return { success: false, error: "Invalid agent" };
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to continue" };
  const week = new Date(Date.now() - 7 * 86_400_000);
  const now = new Date();
  const [changes, questions] = await Promise.all([
    db.select({ id: undoOperations.id, summary: undoOperations.summary, workspace: workspaces.title, at: undoOperations.createdAt, expiresAt: undoOperations.expiresAt, usedAt: undoOperations.usedAt })
      .from(undoOperations).leftJoin(workspaces, eq(workspaces.id, undoOperations.workspaceId))
      .where(and(eq(undoOperations.userId, user.id), eq(undoOperations.sessionId, sessionId), gt(undoOperations.createdAt, week)))
      .orderBy(desc(undoOperations.createdAt)).limit(50),
    db.select({ id: agentQuestions.id, context: agentQuestions.context, status: agentQuestions.status, at: agentQuestions.createdAt })
      .from(agentQuestions)
      .where(and(eq(agentQuestions.askerUserId, user.id), eq(agentQuestions.askerSessionId, sessionId), gt(agentQuestions.createdAt, week)))
      .orderBy(desc(agentQuestions.createdAt)).limit(20),
  ]);
  return {
    success: true,
    activity: {
      changes: changes.map((c) => ({ id: c.id, summary: c.summary, workspace: c.workspace, at: c.at.toISOString(), undoable: !c.usedAt && c.expiresAt > now })),
      questions: questions.map((q) => ({ id: q.id, context: q.context, status: q.status, at: q.at.toISOString() })),
    },
  };
}
