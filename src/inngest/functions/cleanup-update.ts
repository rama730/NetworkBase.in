import { inngest } from "../client";
import { db } from "@/lib/db";
import { projectUpdateComments } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

export const cleanupWorkspaceUpdate = inngest.createFunction(
    { id: "project-update-cleanup", name: "Cleanup Pinned Media and Comments for Deleted Updates" },
    { event: "project/updates.cleanup" },
    async ({ event, step }) => {
        const { updateId } = event.data;

        // 1. Soft-delete all associated comments in the background
        await step.run("soft-delete-comments", async () => {
            await db.update(projectUpdateComments)
                .set({ deletedAt: new Date() })
                .where(eq(projectUpdateComments.updateId, updateId));
        });
    }
);
