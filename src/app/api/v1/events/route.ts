import { and, asc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { fileVersions, profiles, userNotifications, workspaceNodes } from "@/lib/db/schema";
import { getWorkspaceAccessById } from "@/lib/data/workspace-access";
import { consumeRateLimit } from "@/lib/security/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HOLD_MS = 25_000;
const STEP_MS = 1_500;

/**
 * Long-poll for what changed since `since` (report A11.2): new inbox items for you, and new file versions in a
 * workspace (`nb watch` pulls them, A1.13 item 5). Answers as soon as something exists, else after 25 s with nothing;
 * the next call passes back `cursor`. No websockets: one plain request at a time per token.
 */
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const userId = auth.user.id;
    const url = new URL(request.url);
    const sinceRaw = url.searchParams.get("since");
    const since = sinceRaw && !Number.isNaN(Date.parse(sinceRaw)) ? new Date(sinceRaw) : new Date();
    const workspace = url.searchParams.get("workspace");
    if (workspace && !z.string().uuid().safeParse(workspace).success) return jsonError("Invalid workspace", 400, "BAD_REQUEST");
    if (workspace) {
      const outside = await denyOutsideTokenWorkspace(auth, { projectId: workspace });
      if (outside) return outside;
      if (!(await getWorkspaceAccessById(workspace, userId)).canRead) return jsonError("Workspace not found", 404, "NOT_FOUND");
    }
    // One waiting request per person at a time is plenty; a loop that calls in a hurry is slowed down.
    if (!(await consumeRateLimit(`api:v1:events:${userId}`, 30, 60)).allowed) return jsonError("Too many waits at once", 429, "RATE_LIMITED");
    // The inbox is the person's whole tray, so tokens limited to some workspaces (and all agents) don't stream it.
    const withInbox = url.searchParams.get("inbox") !== "0" && !auth.tokenWorkspaceId && auth.tokenKind !== "agent";

    const deadline = Date.now() + HOLD_MS;
    for (;;) {
      const [notifications, files] = await Promise.all([
        withInbox
          ? db.select({ id: userNotifications.id, kind: userNotifications.kind, title: userNotifications.title, body: userNotifications.body, href: userNotifications.href, importance: userNotifications.importance, at: userNotifications.activityAt })
              .from(userNotifications)
              .where(and(eq(userNotifications.userId, userId), gt(userNotifications.activityAt, since), isNull(userNotifications.dismissedAt), isNull(userNotifications.readAt)))
              .orderBy(asc(userNotifications.activityAt)).limit(50)
          : Promise.resolve([]),
        workspace
          ? db.select({ path: workspaceNodes.path, nodeId: workspaceNodes.id, version: fileVersions.version, hash: fileVersions.contentHash, at: fileVersions.uploadedAt, by: profiles.username, byId: fileVersions.uploadedBy, via: fileVersions.via, agentName: fileVersions.agentName })
              .from(fileVersions)
              .innerJoin(workspaceNodes, and(eq(workspaceNodes.id, fileVersions.nodeId), eq(workspaceNodes.projectId, workspace), isNull(workspaceNodes.deletedAt)))
              .leftJoin(profiles, eq(profiles.id, fileVersions.uploadedBy))
              .where(gt(fileVersions.uploadedAt, since))
              .orderBy(asc(fileVersions.uploadedAt)).limit(200)
          : Promise.resolve([]),
      ]);
      if (notifications.length || files.length || Date.now() + STEP_MS > deadline || request.signal.aborted) {
        const latest = [since, ...notifications.map((n) => n.at), ...files.map((f) => f.at)].reduce((a, b) => (b > a ? b : a));
        return jsonSuccess({
          cursor: latest.toISOString(),
          notifications: notifications.map((n) => ({ ...n, at: n.at.toISOString() })),
          files: files.map(({ byId, ...f }) => ({ ...f, at: f.at.toISOString(), mine: byId === userId })),
        }, undefined, { headers: { "Cache-Control": "private, no-store" } });
      }
      await new Promise((r) => setTimeout(r, STEP_MS));
    }
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/events", fallback: "Couldn’t wait for changes" });
  }
}
