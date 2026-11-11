"use server";

import { agentWorkspaceProblem } from "@/lib/agents/access-settings";
import { queueSecurityEmail } from "@/lib/email/security-queue";
import { deviceDecisionSchema } from "@/lib/extension/device-decision";
import { decideDeviceCode, findPendingDeviceCode } from "@/lib/extension/device-codes";
import { redirectAfterDecision } from "@/lib/extension/oauth";
import { recordSecurityEventFromHeaders } from "@/lib/security/audit-from-headers";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { resolveSecurityStepUp } from "@/lib/security/step-up";
import { resolveStepUpCapabilities } from "@/lib/security/step-up-capabilities";
import { createClient } from "@/lib/supabase/server";

type DecideResult = { success: true; decision: "approve" | "deny"; redirectTo?: string } | { success: false; error: string; stepUpRequired?: true; expired?: true };

/**
 * The person's answer at /device (report A3.2). Approving makes a credential that signs in as them, so it needs the
 * same recent verification as making a token in Settings; an agent can only be tied to a workspace they can change.
 */
export async function decideDeviceCodeAction(code: string, input: unknown): Promise<DecideResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to continue" };
  if (!(await consumeRateLimit(`device:decide:${user.id}`, 20, 600)).allowed) return { success: false, error: "Too many attempts. Try again in a few minutes." };
  const parsed = deviceDecisionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Choose how this sign-in may be used" };
  const pending = await findPendingDeviceCode(code, user.id);
  if (!pending) return { success: false, error: "This code has expired or was already used. Start again from your terminal.", expired: true };

  const decision = parsed.data;
  if (decision.decision === "approve") {
    const { availableMethods } = await resolveStepUpCapabilities({ supabase: supabase as never, user });
    if (availableMethods.length > 0 && !(await resolveSecurityStepUp(user.id)).ok) {
      return { success: false, error: "Verify it's you before approving", stepUpRequired: true };
    }
    if (decision.type === "agent") {
      const problem = await agentWorkspaceProblem(user.id, decision.access, decision.workspace);
      if (problem) return { success: false, error: problem };
    }
  }

  // The hosted MCP server takes only agent tokens, so an editor's OAuth request can't become a full terminal sign-in.
  if (pending.viaOAuth && decision.decision === "approve" && decision.type !== "agent") return { success: false, error: "An editor connects as an AI agent. Choose An AI agent." };
  const ok = await decideDeviceCode(user.id, code, decision as Parameters<typeof decideDeviceCode>[2]);
  if (!ok) return { success: false, error: "This code has expired or was already used. Start again from your terminal.", expired: true };
  if (decision.decision === "approve") {
    const label = decision.type === "agent" ? `${pending.agentName ?? "Agent"} on ${pending.deviceName}` : pending.deviceName;
    await recordSecurityEventFromHeaders({ userId: user.id, eventType: "editor_token_created", metadata: { label: label.slice(0, 120), method: "device_code", tokenType: decision.type } });
    await queueSecurityEmail(user.id, "security_token_created", { detail: label });
  }
  const redirectTo = pending.viaOAuth ? await redirectAfterDecision(code) : null;
  return { success: true, decision: decision.decision, ...(redirectTo ? { redirectTo } : {}) };
}
