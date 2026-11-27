import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { workspaces } from "@/lib/db/schema";
import { partOn } from "@/lib/organizations/kits";
import { meetingSettings } from "@/lib/workflows/meetings";

/** Report 38.11 S8 (A4.16): this workspace's meeting types, default length and reminder minutes. */
export async function readMeetingSettings(projectId: string) {
    const [ws] = await db.select({ settings: workspaces.workflowSettings, category: workspaces.category, level: workspaces.orgLevel, orgType: workspaces.orgType, orgSettings: workspaces.orgSettings }).from(workspaces).where(eq(workspaces.id, projectId)).limit(1);
    // B3.5a: a school (an institution) gets the school meeting types; B7.2c: a club gets the Handover meeting;
    // B8.5: an Other organization with Board meetings on gets the Board meeting (the nonprofit types).
    const board = ws?.orgType === "other" && partOn(ws.orgSettings, "boardMeetings");
    // B8.7: an Other organization with Meetings and minutes on (the Association kit) gets the club's meeting types.
    const club = ws?.orgType === "club" || (ws?.orgType === "other" && partOn(ws.orgSettings, "clubMeetings"));
    return meetingSettings((ws?.settings as Record<string, unknown> | null)?.meetings, ws?.level === "institution" ? "school" : club ? "club" : board ? "nonprofit" : ws?.category);
}
