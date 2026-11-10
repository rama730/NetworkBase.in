import { z } from "zod";

import { AGENT_EXTRA_SCOPES } from "@/lib/security/token-access";

export const AGENT_EXPIRY_DAYS = [7, 30, 90] as const;

/**
 * The answer on /device. Deny, or approve as a terminal or as an agent. Approve is split by `type`: zod 4 refuses
 * two "approve" options in one union keyed by `decision`, which failed every approval in production (2026-11-10).
 */
export const deviceDecisionSchema = z.union([
  z.object({ decision: z.literal("deny") }),
  z.discriminatedUnion("type", [
    z.object({ decision: z.literal("approve"), type: z.literal("device") }),
    z.object({
      decision: z.literal("approve"),
      type: z.literal("agent"),
      workspaceId: z.string().uuid(),
      expiryDays: z.union([z.literal(AGENT_EXPIRY_DAYS[0]), z.literal(AGENT_EXPIRY_DAYS[1]), z.literal(AGENT_EXPIRY_DAYS[2])]),
      extraScopes: z.array(z.enum(AGENT_EXTRA_SCOPES as [string, ...string[]])).max(3),
    }),
  ]),
]);
