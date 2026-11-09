import { validateCsrf } from "@/lib/security/csrf";
import { randomUUID } from "crypto";
import { and, eq, asc, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  workspaceNodeEvents,
  workspaceNodes,
  fileVersions,
  profiles,
  tasks,
} from "@/lib/db/schema";
import { createTaskCommentAs } from "@/lib/domain/task-comments";
import {requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
  getRequestId,
  idempotentWrite, denyOutsideTokenWorkspace
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import {
  assertWorkspaceFileReadAccess,
  assertFileNodeVisible,
  assertWorkspaceWriteAccessTx,
  recordNodeEvent,
} from "@/lib/files/internal-helpers";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { fileCommentSchema, taskCommentSchema } from "@/lib/api/v1-schemas";
import { agentGate, recordUndo } from "@/lib/agents/policy";
export const runtime = "nodejs";
async function readable(projectId: string, nodeId: string, userId: string) {
  const access = await assertWorkspaceFileReadAccess(projectId, userId);
  const node = await db.query.workspaceNodes.findFirst({
    where: and(
      eq(workspaceNodes.id, nodeId),
      eq(workspaceNodes.projectId, projectId),
    ),
  });
  if (!node) throw new Error("File not found");
  await assertFileNodeVisible(access, node);
  return { access, node };
}
export async function GET(request: Request) {
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const parsed = z
      .object({
        projectId: z.string().uuid(),
        nodeId: z.string().uuid(),
        threadId: z.string().uuid().optional(),
        after: z.coerce.number().int().nonnegative().optional(),
      })
      .safeParse(Object.fromEntries(new URL(request.url).searchParams));
    if (!parsed.success)
      return jsonError("Invalid comment query", 400, "BAD_REQUEST");
    const { projectId, nodeId, threadId, after } = parsed.data;
    const outsideRead = await denyOutsideTokenWorkspace(auth, { projectId });
    if (outsideRead) return outsideRead;
    const { access } = await readable(projectId, nodeId, auth.user.id);
    const rows = await db
      .select({
        id: workspaceNodeEvents.id,
        sequence: workspaceNodeEvents.sequenceNumber,
        actorId: workspaceNodeEvents.actorId,
        metadata: workspaceNodeEvents.metadata,
        createdAt: workspaceNodeEvents.createdAt,
        name: profiles.fullName,
      })
      .from(workspaceNodeEvents)
      .leftJoin(profiles, eq(profiles.id, workspaceNodeEvents.actorId))
      .where(
        and(
          eq(workspaceNodeEvents.projectId, projectId),
          eq(workspaceNodeEvents.nodeId, nodeId),
          eq(workspaceNodeEvents.type, "extension_review_comment"),
          threadId
            ? sql`${workspaceNodeEvents.metadata}->>'threadId' = ${threadId}`
            : undefined,
          after ? sql`${workspaceNodeEvents.sequenceNumber}>${after}` : undefined,
        ),
      )
      .orderBy(asc(workspaceNodeEvents.sequenceNumber))
      .limit(201);
    return jsonSuccess({
      events: rows.slice(0, 200),
      nextCursor: rows.length > 200 ? rows[199]!.sequence : null,
      canWrite: access.canWrite,
      isOwner: access.isOwner,
      currentUserId: auth.user.id,
    });
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/extension/comments",
      fallback: "Couldn’t load comments",
    });
  }
}
async function postTaskComment(
  auth: Parameters<typeof agentGate>[0] & { user: { id: string } },
  request: Request,
  input: z.infer<typeof taskCommentSchema>,
) {
  const user = auth.user;
  const projectId =
    input.projectId ??
    (await db.query.tasks.findFirst({ where: and(eq(tasks.id, input.taskId), isNull(tasks.deletedAt)), columns: { projectId: true } }))?.projectId;
  if (!projectId) return jsonError("Task not found", 404, "NOT_FOUND");
  const held = await agentGate(auth, request, input, { workspaceId: projectId, kinds: ["small"], summary: "Comment on the task" });
  if (held) return held;
  // Name and avatar come from the profile row, never from session metadata the person can edit.
  const [profile] = await db
    .select({ fullName: profiles.fullName, username: profiles.username, avatarUrl: profiles.avatarUrl })
    .from(profiles)
    .where(eq(profiles.id, user.id))
    .limit(1);
  const result = await createTaskCommentAs(
    { userId: user.id, profile: profile ?? null },
    input.taskId,
    projectId,
    input.text,
    input.replyTo ?? null,
  );
  if (result.success) {
    const commentId = (result.data as { comment?: { id?: string }; id?: string }).comment?.id ?? (result.data as { id?: string }).id;
    const undoToken = commentId
      ? await recordUndo(auth, { workspaceId: projectId, operation: "comment.add", summary: "Commented on the task", inverse: { kind: "comment.delete", commentId, taskId: input.taskId, projectId } })
      : null;
    return jsonSuccess({ ...result.data, undoToken });
  }
  return jsonError(result.error, result.error === "Task not found" ? 404 : 400, result.error === "Task not found" ? "NOT_FOUND" : "BAD_REQUEST");
}

async function handlePost(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Sign in to continue", 401, "UNAUTHORIZED");
    const userId = auth.user.id;
    const body = await request.json().catch(() => null);
    const taskComment = taskCommentSchema.safeParse(body);
    if (taskComment.success) {
      const outside = await denyOutsideTokenWorkspace(auth, { projectId: taskComment.data.projectId, taskId: taskComment.data.taskId });
      return outside ?? (await postTaskComment({ ...auth, user: auth.user }, request, taskComment.data));
    }
    const parsed = fileCommentSchema.safeParse(body);
    if (!parsed.success)
      return jsonError("Invalid comment", 400, "BAD_REQUEST");
    const input = parsed.data;
    if (
      !(await consumeRateLimit(`extension-comments:${userId}`, 30, 60)).allowed
    )
      return jsonError("Too many attempts. Try again in a minute.", 429, "RATE_LIMITED");
    const outside = await denyOutsideTokenWorkspace(auth, { projectId: input.projectId });
    if (outside) return outside;
    await readable(input.projectId, input.nodeId, userId);
    const event = await db.transaction(async (tx) => {
      const authority = await assertWorkspaceWriteAccessTx(
        tx,
        input.projectId,
        userId,
      );
      const node = await tx.query.workspaceNodes.findFirst({
        where: and(
          eq(workspaceNodes.id, input.nodeId),
          eq(workspaceNodes.projectId, input.projectId),
        ),
      });
      if (!node || node.deletedAt) throw new Error("File not found");
      const threadId = input.kind === "create" ? randomUUID() : input.threadId;
      let latestSequence = 0;
      if (input.kind !== "create") {
        const events = await tx
          .select()
          .from(workspaceNodeEvents)
          .where(
            and(
              eq(workspaceNodeEvents.projectId, input.projectId),
              eq(workspaceNodeEvents.nodeId, input.nodeId),
              eq(workspaceNodeEvents.type, "extension_review_comment"),
              sql`${workspaceNodeEvents.metadata}->>'threadId' = ${threadId}`,
            ),
          )
          .orderBy(asc(workspaceNodeEvents.sequenceNumber));
        const first = events[0];
        if (!first) throw new Error("Comment thread not found");
        latestSequence = events.at(-1)!.sequenceNumber;
        if (
          (input.kind === "resolve" || input.kind === "relocate") &&
          first.actorId !== userId &&
          !authority.isOwner
        )
          throw new Error(
            "Only the comment’s author or the workspace owner can change it",
          );
        if (
          "expectedSequence" in input &&
          input.expectedSequence !== latestSequence
        )
          throw new Error(
            "Thread changed elsewhere. Reload it before retrying.",
          );
      }
      if ("anchor" in input) {
        const version = await tx.query.fileVersions.findFirst({
          where: and(
            eq(fileVersions.nodeId, input.nodeId),
            eq(fileVersions.version, input.anchor.version),
          ),
        });
        if (!version || version.contentHash !== input.anchor.hash)
          throw new Error(
            "Anchor version changed. Reload and inspect the historical contents.",
          );
        if (
          input.kind === "relocate" &&
          node.currentVersion !== input.anchor.version
        )
          throw new Error("Relocation requires the current file version.");
      }
      return recordNodeEvent(
        input.projectId,
        userId,
        input.nodeId,
        "extension_review_comment",
        {
          threadId,
          kind: input.kind,
          ...("text" in input ? { text: input.text } : {}),
          ...("anchor" in input ? { anchor: input.anchor } : {}),
          ...("resolved" in input ? { resolved: input.resolved } : {}),
          previousSequence: latestSequence,
        },
        tx,
      );
    });
    return jsonSuccess({ event });
  } catch (error) {
    return routeErrorResponse(error, {
      requestId: getRequestId(request),
      scope: "api/v1/extension/comments",
      fallback: "Comment update failed",
    });
  }
}

/** Retries with the same Idempotency-Key and body write once (report A2.4, F72). */
export async function POST(request: Request) {
  return idempotentWrite(request, "extension.comments", handlePost);
}
