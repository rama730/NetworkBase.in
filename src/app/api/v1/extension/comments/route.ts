import { validateCsrf } from "@/lib/security/csrf";
import { randomUUID } from "crypto";
import { and, eq, asc, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import {
  projectNodeEvents,
  projectNodes,
  fileVersions,
  profiles,
} from "@/lib/db/schema";
import {
  requireAuthenticatedUser,
  jsonSuccess,
  jsonError,
  getRequestId,
} from "@/app/api/v1/_shared";
import { routeErrorResponse } from "@/app/api/v1/_error";
import {
  assertProjectFileReadAccess,
  assertFileNodeVisible,
  assertProjectWriteAccessTx,
  recordNodeEvent,
} from "@/lib/files/internal-helpers";
import { consumeRateLimit } from "@/lib/security/rate-limit";
export const runtime = "nodejs";
const anchor = z
  .object({
    version: z.number().int().positive(),
    hash: z.string().regex(/^[a-f0-9]{64}$/i),
    startLine: z.number().int().min(0).max(1000000),
    endLine: z.number().int().min(0).max(1000000),
  })
  .refine((a) => a.endLine >= a.startLine);
const schema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("create"),
    projectId: z.string().uuid(),
    nodeId: z.string().uuid(),
    text: z.string().trim().min(1).max(4000),
    anchor,
  }),
  z.object({
    kind: z.literal("reply"),
    projectId: z.string().uuid(),
    nodeId: z.string().uuid(),
    threadId: z.string().uuid(),
    text: z.string().trim().min(1).max(4000),
  }),
  z.object({
    kind: z.literal("resolve"),
    projectId: z.string().uuid(),
    nodeId: z.string().uuid(),
    threadId: z.string().uuid(),
    expectedSequence: z.number().int().nonnegative(),
    resolved: z.boolean(),
  }),
  z.object({
    kind: z.literal("relocate"),
    projectId: z.string().uuid(),
    nodeId: z.string().uuid(),
    threadId: z.string().uuid(),
    expectedSequence: z.number().int().nonnegative(),
    anchor,
  }),
]);
async function readable(projectId: string, nodeId: string, userId: string) {
  const access = await assertProjectFileReadAccess(projectId, userId);
  const node = await db.query.projectNodes.findFirst({
    where: and(
      eq(projectNodes.id, nodeId),
      eq(projectNodes.projectId, projectId),
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
    if (!auth.user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");
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
    const { access } = await readable(projectId, nodeId, auth.user.id);
    const rows = await db
      .select({
        id: projectNodeEvents.id,
        sequence: projectNodeEvents.sequenceNumber,
        actorId: projectNodeEvents.actorId,
        metadata: projectNodeEvents.metadata,
        createdAt: projectNodeEvents.createdAt,
        name: profiles.fullName,
      })
      .from(projectNodeEvents)
      .leftJoin(profiles, eq(profiles.id, projectNodeEvents.actorId))
      .where(
        and(
          eq(projectNodeEvents.projectId, projectId),
          eq(projectNodeEvents.nodeId, nodeId),
          eq(projectNodeEvents.type, "extension_review_comment"),
          threadId
            ? sql`${projectNodeEvents.metadata}->>'threadId' = ${threadId}`
            : undefined,
          after ? sql`${projectNodeEvents.sequenceNumber}>${after}` : undefined,
        ),
      )
      .orderBy(asc(projectNodeEvents.sequenceNumber))
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
      fallback: "Could not load comments",
    });
  }
}
export async function POST(request: Request) {
  const csrf = validateCsrf(request);
  if (csrf) return csrf;
  try {
    const auth = await requireAuthenticatedUser();
    if (auth.response) return auth.response;
    if (!auth.user) return jsonError("Not authenticated", 401, "UNAUTHORIZED");
    const userId = auth.user.id;
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success)
      return jsonError("Invalid comment", 400, "BAD_REQUEST");
    const input = parsed.data;
    if (
      !(await consumeRateLimit(`extension-comments:${userId}`, 30, 60)).allowed
    )
      return jsonError("Rate limit exceeded", 429, "RATE_LIMITED");
    await readable(input.projectId, input.nodeId, userId);
    const event = await db.transaction(async (tx) => {
      const authority = await assertProjectWriteAccessTx(
        tx,
        input.projectId,
        userId,
      );
      const node = await tx.query.projectNodes.findFirst({
        where: and(
          eq(projectNodes.id, input.nodeId),
          eq(projectNodes.projectId, input.projectId),
        ),
      });
      if (!node || node.deletedAt) throw new Error("File not found");
      const threadId = input.kind === "create" ? randomUUID() : input.threadId;
      let latestSequence = 0;
      if (input.kind !== "create") {
        const events = await tx
          .select()
          .from(projectNodeEvents)
          .where(
            and(
              eq(projectNodeEvents.projectId, input.projectId),
              eq(projectNodeEvents.nodeId, input.nodeId),
              eq(projectNodeEvents.type, "extension_review_comment"),
              sql`${projectNodeEvents.metadata}->>'threadId' = ${threadId}`,
            ),
          )
          .orderBy(asc(projectNodeEvents.sequenceNumber));
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
