import "server-only";

import { touchesFinalsOrDocs, type Actor } from "@/lib/domain/change-sets";
import { resolveSecurityStepUp } from "@/lib/security/step-up";
import { resolveStepUpCapabilities } from "@/lib/security/step-up-capabilities";
import type { SecurityStepUpMethod } from "@/lib/security/step-up-methods";
import { createClient } from "@/lib/supabase/server";

/**
 * Applying final files or a doc from a browser session needs a recent "Verify it's you" (report G12), whether through
 * the app's action or the API. Tokens (CLI, agents) are held by their scopes and the agent gate instead.
 * Returns what to verify with, or null when nothing is needed.
 */
export async function changeSetStepUp(actor: Actor, changeSetId: string): Promise<{ methods: SecurityStepUpMethod[]; factorId?: string } | null> {
  if (actor.tokenScopes || !actor.user) return null;
  if (!(await touchesFinalsOrDocs(actor, changeSetId))) return null;
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user || user.id !== actor.user.id) return null;
  const { availableMethods, primaryTotpFactorId } = await resolveStepUpCapabilities({ supabase: supabase as never, user: user as never });
  if (!availableMethods.length || (await resolveSecurityStepUp(user.id)).ok) return null;
  return { methods: availableMethods, factorId: primaryTotpFactorId };
}
