"use server";

import { and, desc, eq, isNull, or } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { extensionDeviceSessions, undoOperations, workspaces } from "@/lib/db/schema";
import { findUndo } from "@/lib/agents/policy";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import {
    MemberJourneyError, completePart, decideCompletion, getMyPart, leaveWorkspace, previewWrapUp, reopenPart, requestRole,
    undoMemberJourney, updateMySettings, type MemberUndo, type MySettingsPatch,
} from "@/lib/workspaces/member-journey";

/**
 * The app's side of member settings (report §7): thin wrappers over `member-journey.ts`, so the app and the API share
 * every rule. Your own sign-in only; a token never reaches these.
 */
type Result<T> = { success: true; data: T } | { success: false; error: string; code?: string };

async function me() {
    const { user, tokenScopes } = await requireAuthenticatedUser();
    if (!user) throw new MemberJourneyError("Sign in to continue", "FORBIDDEN");
    if (tokenScopes) throw new MemberJourneyError("Do this in the app with your own sign-in", "FORBIDDEN");
    return user;
}

async function run<T>(fn: () => Promise<T>, fallback: string): Promise<Result<T>> {
    try {
        return { success: true, data: await fn() };
    } catch (error) {
        if (error instanceof MemberJourneyError) return { success: false, error: error.message, code: error.code };
        if (error instanceof Error && /MEMBER_COMPLETED/.test(error.message)) return { success: false, error: "That person has completed their part here", code: "MEMBER_COMPLETED" };
        if (error instanceof z.ZodError) return { success: false, error: "Check the form and try again", code: "BAD_REQUEST" };
        console.error(fallback, error);
        return { success: false, error: fallback };
    }
}

const uuid = z.string().uuid();
const taskChoice = z.enum(["keep", "give", "unassign"]);
const completeSchema = z.object({ note: z.string().trim().max(280).nullish(), tasks: taskChoice.optional(), giveTo: uuid.nullish(), reviewsTo: uuid.nullish() });

export async function getMyPartAction(projectId: string) {
    return run(async () => getMyPart(uuid.parse(projectId), (await me()).id), "Couldn’t load your part");
}

export async function previewWrapUpAction(projectId: string) {
    return run(async () => previewWrapUp(uuid.parse(projectId), (await me()).id), "Couldn’t check what’s still open");
}

export async function completeMyPartAction(projectId: string, input: z.infer<typeof completeSchema>) {
    return run(async () => {
        const user = await me();
        const data = completeSchema.parse(input);
        return await completePart(user.id, uuid.parse(projectId), user.id, data);
    }, "Couldn’t complete your part");
}

export async function reopenMyPartAction(projectId: string) {
    return run(async () => {
        const user = await me();
        return await reopenPart(user.id, uuid.parse(projectId));
    }, "Couldn’t reopen your part");
}

export async function leaveWorkspaceAction(projectId: string, input: Omit<z.infer<typeof completeSchema>, "note">) {
    return run(async () => {
        const user = await me();
        return await leaveWorkspace(user.id, uuid.parse(projectId), completeSchema.omit({ note: true }).parse(input));
    }, "Couldn’t leave the workspace");
}

/** The owner (or an admin, for members and viewers) completes someone's part. The domain module checks who may. */
export async function completeMemberPartAction(projectId: string, userId: string, input: { note?: string | null; tasks?: "keep" | "give" | "unassign"; giveTo?: string | null }) {
    return run(async () => {
        const actor = await me();
        return await completePart(actor.id, uuid.parse(projectId), uuid.parse(userId), completeSchema.parse(input));
    }, "Couldn’t complete their part");
}

export async function decideCompletionAction(projectId: string, userId: string, decision: "confirm" | "not_yet", note?: string | null) {
    return run(async () => {
        const actor = await me();
        return await decideCompletion(actor.id, uuid.parse(projectId), uuid.parse(userId), z.enum(["confirm", "not_yet"]).parse(decision), z.string().trim().max(500).nullish().parse(note));
    }, "Couldn’t save your answer");
}

export async function requestRoleAction(projectId: string, role: "admin" | "member" | "viewer", note?: string | null) {
    return run(async () => requestRole((await me()).id, uuid.parse(projectId), z.enum(["admin", "member", "viewer"]).parse(role), z.string().trim().max(500).nullish().parse(note)), "Couldn’t send your request");
}

const settingsSchema = z.object({
    notifications: z.object({ mode: z.enum(["inherit", "custom"]), rules: z.record(z.string(), z.boolean()).optional() }).optional(),
    muteUntil: z.union([z.literal("forever"), z.string().datetime(), z.null()]).optional(),
    hideAgentLabel: z.boolean().optional(),
    agentsBlocked: z.boolean().optional(),
    viewPrefs: z.object({ defaultTab: z.string().max(20).nullish(), density: z.enum(["compact", "comfortable"]).nullish() }).optional(),
    showOnProfile: z.boolean().optional(),
});

export async function updateMySettingsAction(projectId: string, patch: MySettingsPatch) {
    return run(async () => {
        const user = await me();
        return await updateMySettings(user.id, uuid.parse(projectId), settingsSchema.parse(patch) as MySettingsPatch);
    }, "Couldn’t save your settings");
}

/** The 10-second Undo in the toast; the same inverse `nb undo` runs (report §3, §4). Only your own, only in time. */
export async function undoMemberJourneyAction(undoId: string) {
    return run(async () => {
        const user = await me();
        const row = await findUndo(uuid.parse(undoId), user.id);
        if (!row) throw new MemberJourneyError("Too late to undo this", "CONFLICT");
        const inverse = row.inverse as unknown as MemberUndo;
        if (inverse.kind !== "member.complete" && inverse.kind !== "member.leave") throw new MemberJourneyError("Nothing to undo here", "BAD_REQUEST");
        // Claimed first, like the API's undo, so two clicks can't both run; given back if the undo is refused.
        const claimed = await db.update(undoOperations).set({ usedAt: new Date() }).where(and(eq(undoOperations.id, row.id), isNull(undoOperations.usedAt))).returning({ id: undoOperations.id });
        if (!claimed.length) throw new MemberJourneyError("Already undone", "CONFLICT");
        try {
            await undoMemberJourney(inverse, user.id);
        } catch (error) {
            await db.update(undoOperations).set({ usedAt: null }).where(eq(undoOperations.id, row.id));
            throw error;
        }
        return { undone: true, workspaceId: row.workspaceId };
    }, "Couldn’t undo");
}

/**
 * Your agents and devices here (Part 1): agent sign-ins that can reach this workspace (one-workspace or "all my
 * workspaces"), and your CLI and editor sign-ins with when they were last used.
 */
export async function readMyAgentsAndDevicesAction(projectId: string) {
    return run(async () => {
        const user = await me();
        const id = uuid.parse(projectId);
        const access = await getWorkspaceAccessById(id, user.id);
        if (!access.canRead) throw new MemberJourneyError("Workspace not found", "NOT_FOUND");
        const rows = await db.select({
            id: extensionDeviceSessions.id, type: extensionDeviceSessions.tokenType, agentName: extensionDeviceSessions.agentName, deviceName: extensionDeviceSessions.deviceName,
            workspaceId: extensionDeviceSessions.workspaceId, allWorkspaces: extensionDeviceSessions.allWorkspaces, scopes: extensionDeviceSessions.scopes,
            lastSeenAt: extensionDeviceSessions.lastSeenAt, expiresAt: extensionDeviceSessions.expiresAt, editorName: extensionDeviceSessions.editorName,
        }).from(extensionDeviceSessions)
            .where(and(eq(extensionDeviceSessions.userId, user.id), isNull(extensionDeviceSessions.revokedAt),
                or(eq(extensionDeviceSessions.tokenType, "device"), eq(extensionDeviceSessions.workspaceId, id), eq(extensionDeviceSessions.allWorkspaces, true))))
            .orderBy(desc(extensionDeviceSessions.lastSeenAt)).limit(40);
        const [ws] = await db.select({ pausedAt: workspaces.agentsPausedAt }).from(workspaces).where(eq(workspaces.id, id)).limit(1);
        const live = rows.filter((r) => r.expiresAt.getTime() > Date.now());
        const scopes = (r: (typeof rows)[number]) => (Array.isArray(r.scopes) ? (r.scopes as string[]) : []);
        const sentence = (r: (typeof rows)[number]) => {
            const s = scopes(r);
            const writes = s.some((x) => /write|push|tasks|files/.test(x) && !/read/.test(x));
            return `${writes ? "Can read and make changes" : "Can read"} ${r.allWorkspaces ? "in all your workspaces" : "in this workspace only"}`;
        };
        return {
            agentsPaused: Boolean(ws?.pausedAt),
            agents: live.filter((r) => r.type === "agent").map((r) => ({ id: r.id, name: r.agentName ?? r.deviceName, sentence: sentence(r), allWorkspaces: r.allWorkspaces, lastSeenAt: r.lastSeenAt.toISOString() })),
            devices: live.filter((r) => r.type === "device").map((r) => ({ id: r.id, name: r.editorName ? `${r.editorName} · ${r.deviceName}` : r.deviceName, lastSeenAt: r.lastSeenAt.toISOString() })),
        };
    }, "Couldn’t load your agents and devices");
}
