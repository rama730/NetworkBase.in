import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { meetingSettings } from "@/lib/workflows/meetings";

/** Report 38.11 S8 (A4.16): this workspace's meeting types, default length and reminder minutes. */
export async function readMeetingSettings(projectId: string) {
    const [ws] = await db.select({ settings: workspaces.workflowSettings, category: workspaces.category }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
    return meetingSettings((ws?.settings as Record<string, unknown> | null)?.meetings, ws?.category);
}
