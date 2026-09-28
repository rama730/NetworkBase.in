import type { getActiveExtensionSessions } from "@/app/actions/extension-sessions";
import { readFilesTabSummaryAction } from "@/app/actions/files-tab";
import type { getHeaderGitHubSyncStatus } from "@/app/actions/github-sync";
import type { detectInstalledLaptopIdesAction } from "@/app/actions/laptop-ides";
import { createPartBatcher } from "@/lib/part-batcher";

const readPart = createPartBatcher<Record<string, unknown>>(readFilesTabSummaryAction);

export function readHeaderGitHubSyncStatus(projectId: string) {
    return readPart(`gitSyncStatus:${projectId}`) as ReturnType<typeof getHeaderGitHubSyncStatus>;
}

export function readInstalledLaptopIdes(platform: "darwin" | "win32" | "linux" | "unknown") {
    return readPart(`installedIdes:${platform}`) as ReturnType<typeof detectInstalledLaptopIdesAction>;
}

export function readActiveExtensionSessions() {
    return readPart("extensionSessions") as ReturnType<typeof getActiveExtensionSessions>;
}
