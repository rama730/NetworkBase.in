import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { routeErrorResponse } from "@/app/api/v1/_error";
import { denyOutsideTokenWorkspace, getRequestId, jsonError, jsonSuccess, requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { readHandInAction } from "@/app/actions/assignments";
import { db } from "@/lib/db";
import { tasks, workspaceNodes, workspaces } from "@/lib/db/schema";
import { AI_POLICY_WORDS, effectiveAiPolicy } from "@/lib/organizations/assignment-rules";
import { readOrgWork } from "@/lib/organizations/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * One copy (`nb assignment view`, `nb review view`, report A8.4–A8.5): instructions, due and late rule, AI policy,
 * my state, what was handed in. The same checks as the app's hand-in panel decide who may see it.
 */
export async function GET(request: Request, context: { params: Promise<{ copyId: string }> }) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const parsed = z.string().uuid().safeParse((await context.params).copyId);
    if (!parsed.success) return jsonError("Invalid assignment", 400, "BAD_REQUEST");
    const copyId = parsed.data;
    const outside = await denyOutsideTokenWorkspace(auth, { taskId: copyId });
    if (outside) return outside;
    const result = await readHandInAction(copyId);
    if (!result.success) return jsonError(result.error, 404, "NOT_FOUND");
    const [row] = await db.select({ number: tasks.taskNumber, description: tasks.description, masterTitle: tasks.title, settings: tasks.assignmentSettings, orgSettings: workspaces.orgSettings, orgType: workspaces.orgType })
      .from(tasks).innerJoin(workspaces, eq(workspaces.id, tasks.projectId))
      .where(and(eq(tasks.id, result.handIn.masterId), isNull(tasks.deletedAt))).limit(1);
    const [copy] = await db.select({ number: tasks.taskNumber, team: tasks.teamName }).from(tasks).where(eq(tasks.id, copyId)).limit(1);
    const aiPolicy = effectiveAiPolicy(row?.settings, readOrgWork(row?.orgSettings, row?.orgType).aiPolicy);
    // Paths, so `nb assignment pull` and `nb review pull` can download each file (report A8.4–A8.5).
    const h = result.handIn;
    const ids = [...new Set([...h.files, ...h.materials, ...(h.latest?.files ?? [])].map((f) => f.nodeId))];
    const paths = new Map(ids.length ? (await db.select({ id: workspaceNodes.id, path: workspaceNodes.path }).from(workspaceNodes).where(inArray(workspaceNodes.id, ids))).map((n) => [n.id, n.path]) : []);
    const withPath = <F extends { nodeId: string }>(list: F[]) => list.map((f) => ({ ...f, path: paths.get(f.nodeId) ?? null }));
    return jsonSuccess({
      id: copyId, number: copy?.number ?? null, title: row?.masterTitle ?? "", instructions: row?.description ?? "",
      instructionsUpdatedAt: row?.settings?.instructionsUpdatedAt ?? null, team: copy?.team ?? null,
      aiPolicy, aiPolicyWords: AI_POLICY_WORDS[aiPolicy], aiNote: row?.settings?.aiNote ?? null,
      ...h,
      files: withPath(h.files),
      materials: withPath(h.materials),
      latest: h.latest ? { ...h.latest, files: withPath(h.latest.files) } : null,
    });
  } catch (error) {
    return routeErrorResponse(error, { requestId: getRequestId(request), scope: "api/v1/assignments/view", fallback: "Couldn’t load the assignment" });
  }
}
