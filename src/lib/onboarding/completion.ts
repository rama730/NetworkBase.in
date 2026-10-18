import "server-only";

import type { User } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { profiles } from "@/lib/db/schema";
import { hasOnboardingClaims, isCompletedOnboardingStatus } from "@/lib/onboarding/state";

const COMPLETED_USERS_MAX = 10_000;
const completedUsers = new Set<string>();

function rememberCompleted(userId: string) {
  if (completedUsers.size >= COMPLETED_USERS_MAX) completedUsers.clear();
  completedUsers.add(userId);
}

export async function hasCompletedOnboarding(user: User) {
  if (completedUsers.has(user.id) || hasOnboardingClaims(user)) return true;

  const [profile] = await db
    .select({ onboardingStatus: profiles.onboardingStatus, username: profiles.username })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  const completed = isCompletedOnboardingStatus(profile?.onboardingStatus, profile?.username);
  if (completed) rememberCompleted(user.id);
  return completed;
}
