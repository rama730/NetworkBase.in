import { inngest } from "../client";
import {
  resolveGithubWorkspaceImportQueueAgeMs,
  runGithubWorkspaceImport,
} from "@/lib/github/workspace-import-runner";

export const projectImport = inngest.createFunction(
  { id: "project-import", concurrency: 5, retries: 0 },
  { event: "project/import" },
  async ({ event, step }) => {
    const { projectId, importSource, userId, resolutions } = event.data as any;

    await step.run("clone-and-process", async () =>
      runGithubWorkspaceImport({
        projectId,
        importSource,
        userId,
        importEventId: event.id || null,
        queueAgeMs: resolveGithubWorkspaceImportQueueAgeMs(event),
        resolutions,
      }),
    );
  },
);
