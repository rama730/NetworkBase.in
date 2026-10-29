"use client";

import type { Profile } from "@/lib/db/schema";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import type { ProfileCollaborationContribution } from "@/lib/profile/collaboration";
import { normalizeProfile } from "@/lib/utils/normalize-profile";

export function normalizeProfileRecord(profile: Record<string, any> | null): Profile | null {
  if (!profile) return null;
  return normalizeProfile(profile) as unknown as Profile;
}

export function profileNeedsHydration(profile: Record<string, any> | null): boolean {
  if (!profile || typeof profile !== "object") return false;
  return profile.id === undefined || profile.username === undefined;
}

export async function loadBrowserProfile(userId: string): Promise<Profile | null> {
  const supabase = createSupabaseBrowserClient();
  const { data } = await supabase
    .from("profiles")
    .select("id, full_name, avatar_url, username, created_at, updated_at, deleted_at")
    .eq("id", userId)
    .single();
  return normalizeProfileRecord(data);
}

export type ProfileContributionPage = {
  contributions: ProfileCollaborationContribution[];
  total: number;
  hasMore: boolean;
};

export async function loadProfileContributionsPage(
  profileId: string,
  options: { limit?: number; offset?: number; stageLimit?: number } = {},
): Promise<ProfileContributionPage> {
  const limit = Math.min(Math.max(options.limit ?? 50, 1), 50);
  const offset = Math.max(options.offset ?? 0, 0);
  const stageLimit = Math.min(Math.max(options.stageLimit ?? 8, 1), 20);
  const response = await fetch(
    `/api/v1/profiles/${encodeURIComponent(profileId)}/contributions?limit=${limit}&offset=${offset}&stageLimit=${stageLimit}`,
    { credentials: "include", cache: "no-store", headers: { accept: "application/json" } },
  );
  const body = await response.json().catch(() => null) as {
    success?: boolean;
    message?: string;
    data?: Partial<ProfileContributionPage>;
  } | null;
  if (!response.ok || body?.success !== true) {
    throw new Error(body?.message || "Couldn’t load project contributions");
  }
  const contributions = body.data?.contributions ?? [];
  const total = Number(body.data?.total ?? contributions.length);
  return {
    contributions,
    total: Number.isFinite(total) ? total : contributions.length,
    hasMore: Boolean(body.data?.hasMore),
  };
}

/** Refreshes only the contribution window already opened by the editor. */
export async function loadProfileContributionWindow(profileId: string, desiredCount: number) {
  const target = Math.min(Math.max(desiredCount, 1), 500);
  const contributions: ProfileCollaborationContribution[] = [];
  let total = 0;
  let hasMore = false;
  for (let offset = 0; offset < target; offset += 50) {
    const page = await loadProfileContributionsPage(profileId, {
      limit: Math.min(50, target - offset),
      offset,
      stageLimit: 20,
    });
    contributions.push(...page.contributions);
    total = page.total;
    hasMore = page.hasMore;
    if (!page.hasMore || page.contributions.length === 0) break;
  }
  return { contributions, total, hasMore };
}
