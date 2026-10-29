import { inngest } from "../client";
import { db } from "@/lib/db";
import { workspaceUpdateComments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const cleanupWorkspaceUpdate = inngest.createFunction(
    { id: "project-update-cleanup", name: "Cleanup Pinned Media and Comments for Deleted Updates" },
    [{ event: "workspace/updates.cleanup" }, { event: "project/updates.cleanup" }] /* old name drains for one release */,
    async ({ event, step }) => {
        const { updateId } = event.data;

        // 1. Soft-delete all associated comments in the background
        await step.run("soft-delete-comments", async () => {
            await db.update(workspaceUpdateComments)
                .set({ deletedAt: new Date() })
                .where(eq(workspaceUpdateComments.updateId, updateId));
        });
    }
);
