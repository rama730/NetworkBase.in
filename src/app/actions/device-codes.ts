"use server";

import { z } from "zod";

import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { queueSecurityEmail } from "@/lib/email/security-queue";
import { AGENT_EXPIRY_DAYS, decideDeviceCode, findPendingDeviceCode } from "@/lib/extension/device-codes";
import { recordSecurityEventFromHeaders } from "@/lib/security/audit-from-headers";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { resolveSecurityStepUp } from "@/lib/security/step-up";
import { resolveStepUpCapabilities } from "@/lib/security/step-up-capabilities";
import { AGENT_EXTRA_SCOPES } from "@/lib/security/token-access";
import { createClient } from "@/lib/supabase/server";

const decisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("deny") }),
  z.object({ decision: z.literal("approve"), type: z.literal("device") }),
  z.object({
    decision: z.literal("approve"),
    type: z.literal("agent"),
    workspaceId: z.string().uuid(),
    expiryDays: z.union([z.literal(AGENT_EXPIRY_DAYS[0]), z.literal(AGENT_EXPIRY_DAYS[1]), z.literal(AGENT_EXPIRY_DAYS[2])]),
    extraScopes: z.array(z.enum(AGENT_EXTRA_SCOPES as [string, ...string[]])).max(3),
  }),
]);

type DecideResult = { success: true; decision: "approve" | "deny" } | { success: false; error: string; stepUpRequired?: true };

/**
 * The person's answer at /device (report A3.2). Approving makes a credential that signs in as them, so it needs the
 * same recent verification as making a token in Settings; an agent can only be tied to a workspace they can change.
 */
export async function decideDeviceCodeAction(code: string, input: unknown): Promise<DecideResult> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false, error: "Sign in to continue" };
  if (!(await consumeRateLimit(`device:decide:${user.id}`, 20, 600)).allowed) return { success: false, error: "Too many attempts. Try again in a few minutes." };
  const parsed = decisionSchema.safeParse(input);
  if (!parsed.success) return { success: false, error: "Choose how this sign-in may be used" };
  const pending = await findPendingDeviceCode(code);
  if (!pending) return { success: false, error: "This code has expired or was already used. Start again from your terminal." };

  const decision = parsed.data;
  if (decision.decision === "approve") {
    const { availableMethods } = await resolveStepUpCapabilities({ supabase: supabase as never, user });
    if (availableMethods.length > 0 && !(await resolveSecurityStepUp(user.id)).ok) {
      return { success: false, error: "Verify it's you before approving", stepUpRequired: true };
    }
    if (decision.type === "agent") {
      const access = await getWorkspaceAccessById(decision.workspaceId, user.id);
      if (!access.canWrite) return { success: false, error: "Choose a workspace you can change" };
    }
  }

  const ok = await decideDeviceCode(user.id, code, decision as Parameters<typeof decideDeviceCode>[2]);
  if (!ok) return { success: false, error: "This code has expired or was already used. Start again from your terminal." };
  if (decision.decision === "approve") {
    const label = decision.type === "agent" ? `${pending.agentName ?? "Agent"} on ${pending.deviceName}` : pending.deviceName;
    await recordSecurityEventFromHeaders({ userId: user.id, eventType: "editor_token_created", metadata: { label: label.slice(0, 120), method: "device_code", tokenType: decision.type } });
    await queueSecurityEmail(user.id, "security_token_created", { detail: label });
  }
  return { success: true, decision: decision.decision };
}
