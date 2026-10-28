'use server';

import { revalidatePath } from 'next/cache';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { z } from 'zod';

import { db } from '@/lib/db';
import { chatChannelMembers, chatChannels, projects } from '@/lib/db/schema';
import { getProjectAccessById } from '@/lib/data/project-access';
import { orgChatSettings } from '@/lib/organizations/chat-rules';
import { getViewerAuthContext } from '@/lib/server/viewer-context';

// Org Messages (report §25): the org's chat settings and Browse projects for org admins.

type Failure = { success: false; error: string };
const DENIED: Failure = { success: false, error: "You don't have permission to do this." };

async function orgAdmin(orgId: string, mode: 'read' | 'write' = 'write') {
    const { userId } = await getViewerAuthContext();
    if (!userId) return null;
    const access = await getProjectAccessById(orgId, userId);
    if (mode === 'write' && access.writeBlocked) return null;
    return access.project?.kind === 'organization' && (access.isOwner || access.memberRole === 'admin') ? { userId, slug: access.project.slug ?? null } : null;
}

const settingsSchema = z.object({ generalAdminsOnly: z.boolean().optional(), membersCreateChannels: z.boolean().optional() }).strict();

/** Settings → Updates & messages (report §25.4): who posts in #general, whether members create org channels. */
export async function updateOrgChatSettingsAction(orgId: string, patch: z.input<typeof settingsSchema>): Promise<{ success: true } | Failure> {
    const admin = await orgAdmin(orgId);
    if (!admin) return DENIED;
    const parsed = settingsSchema.safeParse(patch);
    if (!parsed.success) return { success: false, error: 'Check the chat settings.' };
    await db.update(projects).set({
        orgSettings: sql`${projects.orgSettings} || ${JSON.stringify(parsed.data)}::jsonb`,
        updatedAt: new Date(),
    }).where(eq(projects.id, orgId));
    revalidatePath(`/org/${admin.slug ?? orgId}`);
    return { success: true };
}

export async function readOrgChatSettingsAction(orgId: string) {
    if (!(await orgAdmin(orgId, 'read'))) return null;
    const [org] = await db.select({ settings: projects.orgSettings, type: projects.orgType }).from(projects).where(eq(projects.id, orgId)).limit(1);
    return org ? orgChatSettings(org.settings, org.type) : null;
}

export type BrowseProjectRow = { projectId: string; title: string; channelId: string | null; channelName: string | null; joined: boolean };

/** Browse projects (report §25.1, §25.3): every child project's default channel, for org admins to open. */
export async function browseOrgProjectChannelsAction(orgId: string): Promise<{ success: true; rows: BrowseProjectRow[] } | Failure> {
    const admin = await orgAdmin(orgId, 'read');
    if (!admin) return DENIED;
    const rows = await db.select({
        projectId: projects.id, title: projects.title, channelId: chatChannels.id, channelName: chatChannels.name,
        joined: sql<boolean>`EXISTS (SELECT 1 FROM ${chatChannelMembers} m WHERE m.channel_id = ${chatChannels.id} AND m.user_id = ${admin.userId})`,
    }).from(projects)
        .leftJoin(chatChannels, and(eq(chatChannels.projectId, projects.id), eq(chatChannels.isDefault, true)))
        .where(and(eq(projects.parentId, orgId), isNull(projects.deletedAt)))
        .orderBy(asc(projects.title));
    return { success: true, rows: rows.map((r) => ({ ...r, joined: Boolean(r.joined) })) };
}
