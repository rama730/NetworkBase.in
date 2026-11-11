"use server";

import { z } from "zod";

import { decideAgentAccessRequest } from "@/lib/agents/access-requests";
import { AGENT_PRESETS } from "@/lib/agents/access";
import { changeAgentAccess, renewAgentAccess } from "@/lib/agents/access-settings";
import { recordSecurityEventFromHeaders } from "@/lib/security/audit-from-headers";
import { resolveSecurityStepUp } from "@/lib/security/step-up";
import { resolveStepUpCapabilities } from "@/lib/security/step-up-capabilities";
import { AGENT_EXTRA_SCOPES } from "@/lib/security/token-access";
import { createClient } from "@/lib/supabase/server";

type Result<T = object> = ({ success: true } & T) | { success: false; error: string; stepUpRequired?: true };

/** The browser's signed-in person; with `fresh`, also a recent "Verify it's you" when the account has a way to check. */
async function person(fresh: boolean): Promise<{ id: string } | { success: false; error: string; stepUpRequired?: true }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to continue" };
  if (fresh) {
    const { availableMethods } = await resolveStepUpCapabilities({ supabase: supabase as never, user: user as never });
    if (availableMethods.length > 0 && !(await resolveSecurityStepUp(user.id)).ok) return { success: false, error: "Verify it's you first", stepUpRequired: true };
  }
  return { id: user.id };
}

const fail = (error: unknown, fallback: string) => ({ success: false as const, error: error instanceof z.ZodError ? fallback : error instanceof Error ? error.message : fallback });

/**
 * The person's answer to an agent asking for more (report A5, A10 "The answer"). "Always" widens a credential, so it
 * needs the same fresh check as Change access; "once" and "no" don't.
 */
export async function decideAgentAccessRequestAction(id: string, answer: "once" | "always" | "no"): Promise<Result<{ scope: string; answer: string }>> {
  try {
    z.string().uuid().parse(id);
    const parsed = z.enum(["once", "always", "no"]).parse(answer);
    const who = await person(parsed === "always");
    if (!("id" in who)) return who;
    const decided = await decideAgentAccessRequest(who.id, id, parsed);
    if (parsed === "always") await recordSecurityEventFromHeaders({ userId: who.id, eventType: "agent_access_changed", metadata: { added: decided.scope } });
    return { success: true, scope: decided.scope, answer: decided.answer };
  } catch (error) {
    return fail(error, "Couldn’t save the answer");
  }
}

const choiceSchema = z.object({
  access: z.enum(AGENT_PRESETS),
  workspace: z.union([z.literal("all"), z.string().uuid()]),
  expiryDays: z.union([z.literal(7), z.literal(30), z.literal(90)]).optional(),
  extraScopes: z.array(z.enum(AGENT_EXTRA_SCOPES as unknown as [string, ...string[]])).max(3).optional(),
}).strict();

/** Settings → the agent → Change access (report A4, A5 "Changing access in place", A10). */
export async function changeAgentAccessAction(sessionId: string, input: unknown): Promise<Result<{ sentence: string }>> {
  try {
    z.string().uuid().parse(sessionId);
    const choice = choiceSchema.parse(input);
    const who = await person(true);
    if (!("id" in who)) return who;
    const changed = await changeAgentAccess(who.id, sessionId, choice as Parameters<typeof changeAgentAccess>[2]);
    await recordSecurityEventFromHeaders({ userId: who.id, eventType: "agent_access_changed", metadata: { label: changed.label.slice(0, 120), access: choice.access, workspace: choice.workspace === "all" ? "all" : "one" } });
    return { success: true, sentence: changed.sentence };
  } catch (error) {
    return fail(error, "Choose how this agent may work");
  }
}

/** Settings → the agent → Renew, or the renewal notice (report A5 "Renewal notice"). */
export async function renewAgentAccessAction(sessionId: string, expiryDays: number): Promise<Result<{ sentence: string }>> {
  try {
    z.string().uuid().parse(sessionId);
    const days = z.union([z.literal(7), z.literal(30), z.literal(90)]).parse(expiryDays);
    const who = await person(true);
    if (!("id" in who)) return who;
    const renewed = await renewAgentAccess(who.id, sessionId, days);
    await recordSecurityEventFromHeaders({ userId: who.id, eventType: "agent_access_changed", metadata: { label: renewed.label.slice(0, 120), renewedDays: days } });
    return { success: true, sentence: renewed.sentence };
  } catch (error) {
    return fail(error, "Choose 7, 30 or 90 days");
  }
}
