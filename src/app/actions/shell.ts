"use server";

import { bootstrap as readChatSummary } from "@/app/actions/chat/read";
import { readNetworkPendingCountsAction } from "@/app/actions/connections";
import { getUnreadCount } from "@/app/actions/messaging";
import { readNotificationPreferencesAction, readNotificationUnreadCountAction } from "@/app/actions/notifications";
import { getWorkspaceSummaryAction } from "@/app/actions/workspace";

const SHELL_READERS = {
    workspaceSummary: getWorkspaceSummaryAction,
    notificationUnreadCount: readNotificationUnreadCountAction,
    notificationPreferences: readNotificationPreferencesAction,
    messageUnreadCount: getUnreadCount,
    chatSummary: () => readChatSummary(),
    networkPendingCounts: readNetworkPendingCountsAction,
};

export type ShellPart = keyof typeof SHELL_READERS;
export type ShellSummary = { [P in ShellPart]: Awaited<ReturnType<(typeof SHELL_READERS)[P]>> };

export async function readShellSummaryAction(parts: ShellPart[]): Promise<Partial<ShellSummary>> {
    const unique = Array.from(new Set(parts)).filter((part) => part in SHELL_READERS);
    const results = await Promise.all(unique.map(async (part) => [part, await SHELL_READERS[part]()] as const));
    return Object.fromEntries(results) as Partial<ShellSummary>;
}
