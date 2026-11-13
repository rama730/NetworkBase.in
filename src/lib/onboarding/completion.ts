import "server-only";

import type { User } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { isEmailVerified } from "@/lib/auth/email-verification";
import { syncOnboardingClaims } from "@/lib/onboarding/claims";
import { hasOnboardingClaims, isCompletedOnboardingStatus } from "@/lib/onboarding/state";

const COMPLETED_USERS_MAX = 1_000;
const completedUsers = new Set<string>();

function rememberCompleted(userId: string) {
  if (completedUsers.has(userId)) return;
  if (completedUsers.size >= COMPLETED_USERS_MAX) {
    const oldest = completedUsers.values().next().value;
    if (oldest !== undefined) completedUsers.delete(oldest);
  }
  completedUsers.add(userId);
}

/**
 * The database is the record of completion; the token claim is only a fast path for middleware. When the two
 * disagree (a claim write failed, or the account finished before claims existed) write the claim once so the
 * next token refresh carries it. AUTH-010: only for a recorded completion and a verified email.
 */
// ponytail: tried once per process; the claim lands on the next token refresh, so middleware may add one hop until then.
function healClaim(user: User) {
  if (hasOnboardingClaims(user) || !isEmailVerified(user as unknown as Record<string, unknown>)) return;
  void syncOnboardingClaims({ userId: user.id, appMetadata: user.app_metadata }).catch((error) =>
    console.error("Onboarding claim self-heal failed:", error),
  );
}

export async function hasCompletedOnboarding(user: User) {
  if (completedUsers.has(user.id)) return true;
  if (hasOnboardingClaims(user)) {
    rememberCompleted(user.id);
    return true;
  }

  const [profile] = await db
    .select({ onboardingStatus: profiles.onboardingStatus })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  const completed = isCompletedOnboardingStatus(profile?.onboardingStatus);
  if (completed) {
    rememberCompleted(user.id);
    healClaim(user);
  }
  return completed;
}
