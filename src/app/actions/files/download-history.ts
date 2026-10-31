"use server";

import { createClient } from "@/lib/supabase/server";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { readDownloadHistory } from "@/lib/files/download-history";
import { isUuid } from "@/lib/validations/uuid";

/** Owners and admins only: the same people who can open this workspace's settings. */
export async function readDownloadHistoryAction(input: {
  projectId: string;
  search?: string;
  personId?: string;
  cursor?: { createdAt: string; id: string } | null;
}) {
  if (!isUuid(input.projectId) || (input.personId && !isUuid(input.personId))) {
    return { success: false as const, error: "Couldn’t load download history" };
  }
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false as const, error: "Sign in to continue" };
  const access = await getWorkspaceAccessById(input.projectId, user.id);
  if (!access.project || !(access.isOwner || access.memberRole === "admin" || access.isInheritedAdmin)) {
    return { success: false as const, error: "You don’t have access to this" };
  }
  const page = await readDownloadHistory({
    workspaceId: input.projectId,
    search: input.search?.slice(0, 200),
    actorId: input.personId,
    cursor: input.cursor,
  });
  return { success: true as const, ...page };
}
