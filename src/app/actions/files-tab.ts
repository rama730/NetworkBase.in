"use server";

import { getActiveExtensionSessions } from "@/app/actions/extension-sessions";
import { getHeaderGitHubSyncStatus } from "@/app/actions/github-sync";
import { detectInstalledLaptopIdesAction } from "@/app/actions/laptop-ides";

const PLATFORMS = new Set(["darwin", "win32", "linux", "unknown"] as const);
type Platform = "darwin" | "win32" | "linux" | "unknown";

async function readPart(part: string): Promise<unknown> {
  if (part === "extensionSessions") return getActiveExtensionSessions();
  const [kind, arg = ""] = part.split(":");
  if (kind === "gitSyncStatus") return getHeaderGitHubSyncStatus(arg);
  if (kind === "installedIdes" && PLATFORMS.has(arg as Platform)) return detectInstalledLaptopIdesAction(arg as Platform);
  return null;
}

export async function readFilesTabSummaryAction(parts: string[]): Promise<Record<string, unknown>> {
  const unique = Array.from(new Set(parts)).slice(0, 10);
  const results = await Promise.all(unique.map(async (part) => [part, await readPart(part)] as const));
  return Object.fromEntries(results);
}
