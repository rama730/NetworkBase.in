"use server";

import { eq } from "drizzle-orm";

import { inngest } from "@/inngest/client";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { missingContent, setHydrationStatus } from "@/lib/github/import-hydration";
import { clearSealedGithubTokenFromImportSource } from "@/lib/github/repo-security";
import { logger } from "@/lib/logger";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { createClient } from "@/lib/supabase/server";

/**
 * Fetch now (report 2026-11-16): queues the workspace's GitHub import download again. It resumes, so only files still
 * without content are fetched, the whole workspace in one run. For people who can change the workspace; once per
 * workspace every 10 minutes.
 */
export async function requestImportDownloadAction(projectId: string) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { success: false as const, error: "Sign in to continue" };
  const access = await getWorkspaceAccessById(projectId, user.id);
  if (!access.project || !access.canWrite) return { success: false as const, error: "Only people who can change this workspace can start the download" };
  const [project] = await db.select({ importSource: workspaces.importSource, commitSha: workspaces.githubLastCommitSha }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
  const source = (project?.importSource ?? null) as { type?: string; repoUrl?: string; branch?: string } | null;
  if (source?.type !== "github" || !source.repoUrl) return { success: false as const, error: "This file didn't come from a GitHub import" };
  const remaining = await missingContent(projectId);
  if (remaining === 0) return { success: true as const, remaining: 0 };
  if (!(await consumeRateLimit(`import-download:${projectId}`, 1, 600)).allowed) return { success: true as const, remaining, alreadyQueued: true };
  try {
    await inngest.send({
      name: "workspace/import.hydrate",
      // Events never carry credentials; the worker resolves access itself (COR-006).
      data: { projectId, userId: user.id, commitSha: project?.commitSha ?? undefined, importSource: clearSealedGithubTokenFromImportSource(source) as never },
    });
    await setHydrationStatus(projectId, { status: "queued", queuedAt: new Date().toISOString(), remaining });
    return { success: true as const, remaining };
  } catch (error) {
    logger.error("import.download_queue_failed", { module: "files", projectId, error: error instanceof Error ? error.message : String(error) });
    return { success: false as const, error: "Couldn’t start the download. Try again in a minute." };
  }
}
