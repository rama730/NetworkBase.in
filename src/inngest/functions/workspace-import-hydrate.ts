import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { hydrateWorkspace, setHydrationStatus } from "@/lib/github/import-hydration";

import { inngest } from "../client";

/**
 * Phase 2 of a GitHub import: the listed files get their content from the repository archive, in resumable batches
 * (src/lib/github/import-hydration.ts). Sending this event again for a workspace resumes it: only files still
 * without content are fetched.
 */
export const projectImportHydrate = inngest.createFunction(
  {
    id: "project-import-hydrate",
    concurrency: [{ limit: 2 }, { key: "event.data.projectId", limit: 1 }],
    retries: 3,
    // A batch that kept failing (the archive can't be read, say): the status says so instead of a silent "ready" (COR-008).
    onFailure: async ({ event, error }) => {
      const projectId = event.data.event.data.projectId as string;
      await setHydrationStatus(projectId, { status: "failed", error: error?.message ?? "Repository files could not be downloaded", finishedAt: new Date().toISOString() });
      const project = await db.query.workspaces.findFirst({ where: eq(workspaces.id, projectId), columns: { importSource: true } });
      const source = (project?.importSource ?? {}) as { metadata?: Record<string, unknown> };
      await db.update(workspaces).set({
        syncStatus: "failed",
        importSource: { ...source, metadata: { ...source.metadata, lastError: error?.message ?? "Repository files could not be downloaded" } } as never,
        updatedAt: new Date(),
      }).where(eq(workspaces.id, projectId));
    },
  },
  [{ event: "workspace/import.hydrate" }, { event: "project/import.hydrate" }] /* old name drains for one release */,
  async ({ event, step }) => {
    const { projectId, importSource, userId } = event.data;
    // The exact commit that was imported, never whatever the branch points to now (COR-007).
    const ref = (event.data.commitSha as string | undefined) || importSource?.branch || "main";
    return hydrateWorkspace({
      projectId,
      userId,
      eventId: event.id || projectId,
      ref,
      step: (name, fn) => step.run(name, fn) as never,
      sleep: (name, duration) => step.sleep(name, duration),
    });
  },
);
