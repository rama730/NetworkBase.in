"use server";

import { bootstrap as readChatSummary } from "@/app/actions/chat/read";
import { readNetworkPendingCountsAction } from "@/app/actions/connections";
import { readNotificationPreferencesAction, readNotificationUnreadCountAction } from "@/app/actions/notifications";
import { getMyWorkSummaryAction } from "@/app/actions/my-work";

const SHELL_READERS = {
    workspaceSummary: getMyWorkSummaryAction,
    notificationUnreadCount: readNotificationUnreadCountAction,
    notificationPreferences: readNotificationPreferencesAction,
    chatSummary: () => readChatSummary(),
    networkPendingCounts: readNetworkPendingCountsAction,
};

export type ShellPart = keyof typeof SHELL_READERS;
export type ShellSummary = { [P in ShellPart]: Awaited<ReturnType<(typeof SHELL_READERS)[P]>> };

export async function readShellSummaryAction(parts: ShellPart[]): Promise<Partial<ShellSummary>> {
    const unique = Array.from(new Set(parts)).filter((part) => part in SHELL_READERS);
    const settled = await Promise.allSettled(unique.map(async (part) => [part, await SHELL_READERS[part]()] as const));
    const entries = settled
        .filter((res): res is PromiseFulfilledResult<readonly [ShellPart, Awaited<ReturnType<(typeof SHELL_READERS)[ShellPart]>>]> => res.status === "fulfilled")
        .map((res) => res.value);
    return Object.fromEntries(entries) as Partial<ShellSummary>;
}
