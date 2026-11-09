"use server";

import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { answerQuestion, answerSchema, muteAsker, openQuestionsFor, publicQuestion, QuestionError } from "@/lib/agents/questions";

/** Questions agents asked the signed-in person on this task (report §20.2). */
export async function listMyTaskQuestionsAction(taskId: string) {
  try {
    z.string().uuid().parse(taskId);
    const { user } = await requireAuthenticatedUser();
    if (!user) return { success: false as const, error: "Sign in to continue" };
    return { success: true as const, questions: await openQuestionsFor(user.id, { taskId }) };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t load questions" };
  }
}

export async function answerAgentQuestionAction(id: string, answers: unknown) {
  try {
    z.string().uuid().parse(id);
    const { user, tokenScopes } = await requireAuthenticatedUser();
    if (!user || tokenScopes) return { success: false as const, error: "Sign in to continue" };
    const parsed = answerSchema.parse({ answers });
    return { success: true as const, question: publicQuestion(await answerQuestion(user.id, id, parsed)) };
  } catch (error) {
    return { success: false as const, error: error instanceof QuestionError || error instanceof Error ? error.message : "Couldn’t save the answer" };
  }
}

export async function muteAgentQuestionAction(id: string) {
  try {
    z.string().uuid().parse(id);
    const { user, tokenScopes } = await requireAuthenticatedUser();
    if (!user || tokenScopes) return { success: false as const, error: "Sign in to continue" };
    await muteAsker(user.id, id);
    return { success: true as const };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t mute" };
  }
}
