'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';
import { chatChannelMembers, chatChannels, workspaces } from '@/lib/db/schema';
import { getWorkspaceAccessById } from '@/lib/data/workspace-access';
import { orgChatSettings } from '@/lib/organizations/chat-rules';
import { publishChannel } from '@/lib/messaging/publish';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

// Org Messages (report §25): the org's chat settings and Browse projects for org admins.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don’t have permission to do this." };

async function orgAdmin(orgId: string, mode: 'read' | 'write' = 'write') {
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const access = await getWorkspaceAccessById(orgId, userId);
    if (mode === 'write' && access.writeBlocked) return null;
    return access.project?.kind === 'organization' && (access.isOwner || access.memberRole === 'admin') ? { userId, slug: access.project.slug ?? null } : null;
}

const settingsSchema = z.object({ generalAdminsOnly: z.boolean().optional(), membersCreateChannels: z.boolean().optional(), generalNotify: z.enum(['all', 'mentions']).optional() }).strict();

/** Settings → Updates & messages (report §25.4): who posts in #general, whether members create org channels. */
export async function updateOrgChatSettingsAction(orgId: string, patch: z.input<typeof settingsSchema>): Promise<{ success: true } | Failure> {
    const admin = await orgAdmin(orgId);
    if (!admin) return DENIED;
    const parsed = settingsSchema.safeParse(patch);
    if (!parsed.success) return { success: false, error: 'Check the chat settings.' };
    await db.update(workspaces).set({
        orgSettings: sql`${workspaces.orgSettings} || ${JSON.stringify(parsed.data)}::jsonb`,
        updatedAt: new Date(),
    }).where(eq(workspaces.id, orgId));
    // Who may post in #general changed: open #general screens swap their composer now, not on a failed post.
    if (parsed.data.generalAdminsOnly !== undefined) {
        const [general] = await db.select({ id: chatChannels.id }).from(chatChannels)
            .where(and(eq(chatChannels.projectId, orgId), eq(chatChannels.isDefault, true))).limit(1);
        if (general) publishChannel(general.id, "channel.updated", { channel_id: general.id });
    }
    revalidatePath(`/org/${admin.slug ?? orgId}`);
    return { success: true };
}

export async function readOrgChatSettingsAction(orgId: string) {
    if (!(await orgAdmin(orgId, 'read'))) return null;
    const [org] = await db.select({ settings: workspaces.orgSettings, type: workspaces.orgType }).from(workspaces).where(eq(workspaces.id, orgId)).limit(1);
    return org ? orgChatSettings(org.settings, org.type) : null;
}

export type BrowseWorkspaceRow = { projectId: string; title: string; channelId: string | null; channelName: string | null; joined: boolean };

/** Browse projects (report §25.1, §25.3): every child project's default channel, for org admins to open. */
export async function browseOrgWorkspaceChannelsAction(orgId: string): Promise<{ success: true; rows: BrowseWorkspaceRow[] } | Failure> {
    const admin = await orgAdmin(orgId, 'read');
    if (!admin) return DENIED;
    const rows = await db.select({
        projectId: workspaces.id, title: workspaces.title, channelId: chatChannels.id, channelName: chatChannels.name,
        joined: sql<boolean>`EXISTS (SELECT 1 FROM ${chatChannelMembers} m WHERE m.channel_id = ${chatChannels.id} AND m.user_id = ${admin.userId})`,
    }).from(workspaces)
        .leftJoin(chatChannels, and(eq(chatChannels.projectId, workspaces.id), eq(chatChannels.isDefault, true)))
        .where(and(eq(workspaces.parentId, orgId), isNull(workspaces.deletedAt)))
        .orderBy(asc(workspaces.title));
    return { success: true, rows: rows.map((r) => ({ ...r, joined: Boolean(r.joined) })) };
}
