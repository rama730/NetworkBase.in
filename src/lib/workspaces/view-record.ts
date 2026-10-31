import { createHmac } from "node:crypto";

import { isShareCrawler } from "@/lib/sharing/presentation";

export type WorkspaceViewOutcome = "counted" | "repeat" | "bot" | "ip_limit" | "no_access" | "team" | "staff" | "unavailable" | "write_failed";

export type WorkspaceViewDeps = {
  secret: string;
  resolveViewer: () => Promise<{ id: string; isStaff: boolean } | null>;
  readAccess: (workspaceId: string, userId: string | null) => Promise<{ canRead: boolean; isTeam: boolean }>;
  allowIp: (ipKey: string) => Promise<boolean>;
  /** True when this viewer has not counted in the window. Throws when the store is unavailable. */
  claimSlot: (key: string) => Promise<boolean>;
  releaseSlot: (key: string) => Promise<void>;
  /** False when the workspace is gone. */
  increment: (workspaceId: string, signedIn: boolean) => Promise<boolean>;
};

const NON_BROWSER = /(?<!cu)bot[/;)\s-]|crawler|spider|headless|lighthouse|pagespeed|gtmetrix|puppeteer|playwright|phantomjs|curl\/|wget\/|python-|axios\/|node-fetch|go-http-client|okhttp|java\//i;

/** Anything that isn't plainly a person's browser. A missing user agent is not a browser. */
export function isBotUserAgent(userAgent: string | null): boolean {
  return !userAgent?.trim() || isShareCrawler(userAgent) || NON_BROWSER.test(userAgent);
}

const keyed = (secret: string, value: string) => createHmac("sha256", secret).update(value).digest("base64url");

/** A signed-in person is one viewer on every device. Anonymous keys are hashes: no raw IP reaches Redis. */
export function viewerSlotKey(workspaceId: string, userId: string | null, ip: string | null, userAgent: string | null, secret: string): string {
  const viewer = userId ? `u:${userId}` : `a:${keyed(secret, `${ip ?? "unknown"}|${userAgent ?? ""}`)}`;
  return `workspace-view:${workspaceId}:${viewer}`;
}

export function ipLimitKey(ip: string | null, secret: string): string {
  return `workspace-view-ip:${keyed(secret, ip ?? "unknown")}`;
}

/** The rules for one view, cheapest check first. Every failure drops the view; nothing here can break a page. */
export async function recordWorkspaceView(input: { workspaceId: string; ip: string | null; userAgent: string | null }, deps: WorkspaceViewDeps): Promise<WorkspaceViewOutcome> {
  const { workspaceId, ip, userAgent } = input;
  if (isBotUserAgent(userAgent)) return "bot";

  let slot: string | null = null;
  try {
    if (!(await deps.allowIp(ipLimitKey(ip, deps.secret)))) return "ip_limit";
    const viewer = await deps.resolveViewer();
    const access = await deps.readAccess(workspaceId, viewer?.id ?? null);
    if (!access.canRead) return "no_access";
    if (access.isTeam) return "team";
    if (viewer?.isStaff) return "staff";
    const key = viewerSlotKey(workspaceId, viewer?.id ?? null, ip, userAgent, deps.secret);
    if (!(await deps.claimSlot(key))) return "repeat";
    slot = key;
    if (await deps.increment(workspaceId, Boolean(viewer))) return "counted";
  } catch {
    if (!slot) return "unavailable";
    await deps.releaseSlot(slot).catch(() => undefined);
    return "write_failed";
  }
  await deps.releaseSlot(slot).catch(() => undefined);
  return "no_access";
}
