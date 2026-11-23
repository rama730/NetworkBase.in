"use server";

import { sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { MEETING_LENGTHS, MEETING_TYPES, REMINDER_MINUTES } from "@/lib/workflows/meetings";
import { canChangeWorkflows } from "@/lib/workflows/rules";

const schema = z.object({
    types: z.array(z.enum(MEETING_TYPES.map((t) => t.id) as [string, ...string[]])).max(MEETING_TYPES.length),
    lengthMinutes: z.number().refine((n) => (MEETING_LENGTHS as readonly number[]).includes(n), "Pick a length"),
    reminderMinutes: z.number().refine((n) => (REMINDER_MINUTES as readonly number[]).includes(n), "Pick a reminder"),
});

/** Report 38.11 S8 and call 5 (A4.16): owners and admins choose the meeting types shown, the default length and the reminder. */
export async function readMeetingSettingsAction(projectId: string) {
    const auth = await requireAuthenticatedUser();
    if (!auth.user) return { success: false as const, error: "Sign in to continue" };
    const access = await getWorkspaceAccessById(projectId, auth.user.id);
    if (!access.project || !(access.isOwner || access.isMember)) return { success: false as const, error: "Not found" };
    const { readMeetingSettings } = await import("@/lib/workflows/meeting-settings-server");
    return { success: true as const, settings: await readMeetingSettings(projectId), canManage: canChangeWorkflows(access) };
}

export async function setMeetingSettingsAction(projectId: string, input: unknown) {
    try {
        const auth = await requireAuthenticatedUser();
        if (!auth.user) return { success: false as const, error: "Sign in to continue" };
        const parsed = schema.safeParse(input);
        if (!parsed.success) return { success: false as const, error: parsed.error.issues[0]?.message ?? "Check the settings." };
        const access = await getWorkspaceAccessById(projectId, auth.user.id);
        if (!access.project || access.project.kind !== "workspace" || !canChangeWorkflows(access)) return { success: false as const, error: "Only owners and admins change meeting settings." };
        const meetings = { types: [...new Set([...parsed.data.types, "blank"])], lengthMinutes: parsed.data.lengthMinutes, reminderMinutes: parsed.data.reminderMinutes };
        await db.execute(sql`UPDATE workspaces SET workflow_settings = coalesce(workflow_settings, '{}'::jsonb) || jsonb_build_object('meetings', ${JSON.stringify(meetings)}::jsonb) WHERE id = ${projectId}::uuid`);
        return { success: true as const };
    } catch (error) {
        logger.error("meetings.settings_failed", { projectId, error: error instanceof Error ? error.message : String(error) });
        return { success: false as const, error: "Couldn’t save the meeting settings." };
    }
}
