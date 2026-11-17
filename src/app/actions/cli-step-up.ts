"use server";

import { and, eq, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import { extensionDeviceSessions } from "@/lib/db/schema";
import { CLI_STEP_UP_MINUTES } from "@/lib/security/cli-step-up";
import { personStepUp } from "@/lib/security/change-set-step-up";
import { getViewerAuthContext } from "@/lib/server/viewer-context";
import { recordSecurityEventFromHeaders } from "@/lib/security/audit-from-headers";

/**
 * /cli/verify (report F5): the person, signed in in the browser and recently verified (the step-up dialog when not),
 * lets one of their own terminal sign-ins do risky actions for 10 minutes. Never an agent's sign-in.
 */
export async function grantCliStepUpAction(sessionId: string): Promise<{ success: true; until: string } | { success: false; error: string; code?: string; stepUp?: { methods: string[]; factorId?: string } }> {
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) return { success: false, error: "That link isn't right; run the command again" };
  const { user, snapshot } = await getViewerAuthContext();
  if (!user || !snapshot) return { success: false, error: "Sign in in the browser first" };
  const stepUp = await personStepUp({ user: { id: user.id }, tokenScopes: null });
  if (stepUp) return { success: false, error: "Verify it's you first", code: "STEP_UP_REQUIRED", stepUp };
  const until = new Date(Date.now() + CLI_STEP_UP_MINUTES * 60_000);
  const [row] = await db.update(extensionDeviceSessions).set({ stepUpUntil: until })
    .where(and(eq(extensionDeviceSessions.id, sessionId), eq(extensionDeviceSessions.userId, user.id), eq(extensionDeviceSessions.tokenType, "device"), isNull(extensionDeviceSessions.revokedAt)))
    .returning({ id: extensionDeviceSessions.id, deviceName: extensionDeviceSessions.deviceName });
  if (!row) return { success: false, error: "That terminal sign-in isn't yours, or was signed out" };
  await recordSecurityEventFromHeaders({ userId: user.id, eventType: "cli_verified", metadata: { device: row.deviceName.slice(0, 120), minutes: CLI_STEP_UP_MINUTES } }).catch(() => undefined);
  return { success: true, until: until.toISOString() };
}
