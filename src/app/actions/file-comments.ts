"use server";

import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";

import { requireAuthenticatedUser } from "@/app/api/v1/_shared";
import { db } from "@/lib/db";
import { fileComments, profiles, workspaceNodes } from "@/lib/db/schema";
import { accessAllows, canReadWorkspaceTab, getWorkspaceAccessById, writeBlockedMessage } from "@/lib/data/workspace-access";
import { logger } from "@/lib/logger";
import { anchorSchema, anchorValid, mediaKindOf } from "@/lib/workflows/file-comments";

/**
 * Report 38.16 O1 W3–W5 (plan A7.2): comments on a file's version, pinned to a spot or a moment. Members and viewers
 * read them; members comment (never public, even where Files is). A comment stays on the version it was made on.
 */
const uuid = z.string().uuid();
const fail = (error: unknown, fallback: string) => ({ success: false as const, error: error instanceof Error && error.message.length < 200 ? error.message : fallback });

async function insiderFile(projectId: string, nodeId: string) {
  const { user } = await requireAuthenticatedUser();
  if (!user) throw new Error("Sign in to continue");
  if (!uuid.safeParse(projectId).success || !uuid.safeParse(nodeId).success) throw new Error("Not found");
  const access = await getWorkspaceAccessById(projectId, user.id);
  // Members who may see Files themselves (security review): with "See Files" off a member reads Files as a visitor,
  // and visitors never see comments.
  if (!access.project || access.project.kind !== "workspace" || !(access.isOwner || (access.isMember && accessAllows(access, "files.see"))) || !canReadWorkspaceTab(access, "files")) throw new Error("Comments are for workspace members.");
  const [node] = await db.select({ id: workspaceNodes.id, name: workspaceNodes.name, mimeType: workspaceNodes.mimeType, version: workspaceNodes.currentVersion, createdBy: workspaceNodes.createdBy, taskId: workspaceNodes.taskId })
    .from(workspaceNodes).where(and(eq(workspaceNodes.id, nodeId), eq(workspaceNodes.projectId, projectId), eq(workspaceNodes.type, "file"), isNull(workspaceNodes.deletedAt))).limit(1);
  // A task's files stay with the task (as in Assets).
  if (!node || node.taskId) throw new Error("File not found");
  // A read-only workspace (suspended or ended organization, a completed member) takes no comment changes.
  return { user, access, node, canComment: (access.isOwner || access.memberRole !== "viewer") && !access.writeBlocked };
}

/** Every comment on the file, all versions (the viewer filters by version), with authors' names. */
export async function readFileCommentsAction(projectId: string, nodeId: string) {
  try {
    const { user, access, node, canComment } = await insiderFile(projectId, nodeId);
    const rows = await db.select({ id: fileComments.id, version: fileComments.version, anchor: fileComments.anchor, parentId: fileComments.parentId, content: fileComments.content,
      authorId: fileComments.authorId, authorName: sql<string>`coalesce(${profiles.fullName}, ${profiles.username}, 'Someone')`, resolvedAt: fileComments.resolvedAt, createdAt: fileComments.createdAt })
      .from(fileComments).leftJoin(profiles, eq(profiles.id, fileComments.authorId))
      .where(and(eq(fileComments.nodeId, nodeId), isNull(fileComments.deletedAt))).orderBy(asc(fileComments.createdAt)).limit(500);
    return { success: true as const, version: node.version, kind: mediaKindOf(node.mimeType), canComment, canResolve: access.canWrite, me: user.id,
      comments: rows.map((r) => ({ ...r, resolvedAt: r.resolvedAt?.toISOString() ?? null, createdAt: r.createdAt.toISOString() })) };
  } catch (error) {
    return fail(error, "Couldn’t load the comments.");
  }
}

const addInput = z.object({ projectId: uuid, nodeId: uuid, version: z.number().int().min(1), anchor: anchorSchema.nullable().optional(), content: z.string().trim().min(1).max(4000), parentId: uuid.optional(), duration: z.number().min(0).optional() });

/** W3/W4: Pin a comment (a spot), Comment at 0:42 (a moment), or a plain comment or reply. */
export async function addFileCommentAction(input: z.infer<typeof addInput>) {
  try {
    const data = addInput.parse(input);
    const { user, node, canComment } = await insiderFile(data.projectId, data.nodeId);
    if (!canComment) throw new Error("Viewers can read comments but not add them.");
    if (data.version > node.version) throw new Error("That version doesn’t exist yet.");
    if (!anchorValid(data.anchor ?? null, mediaKindOf(node.mimeType), data.duration ?? null)) throw new Error("A spot goes on an image and a moment on video or audio.");
    let version = data.version, anchor = data.anchor ?? null;
    if (data.parentId) {
      const [parent] = await db.select({ version: fileComments.version, parentId: fileComments.parentId }).from(fileComments)
        .where(and(eq(fileComments.id, data.parentId), eq(fileComments.nodeId, data.nodeId), isNull(fileComments.deletedAt))).limit(1);
      if (!parent || parent.parentId) throw new Error("Reply to a comment on this file.");
      version = parent.version; anchor = null;
    }
    const [row] = await db.insert(fileComments).values({ projectId: data.projectId, nodeId: data.nodeId, version, anchor, parentId: data.parentId ?? null, content: data.content, authorId: user.id }).returning({ id: fileComments.id });
    // A comment on a file you uploaded (Normal), unless it's yours.
    if (node.createdBy && node.createdBy !== user.id) {
      const { createNotification } = await import("@/lib/notifications/service");
      await createNotification({ recipientUserId: node.createdBy, actorUserId: user.id, kind: "project_file_activity", category: "projects", importance: "more",
        title: `New comment on ${node.name}`, href: `/workspaces/${encodeURIComponent(data.projectId)}?tab=files&filesView=assets&asset=${encodeURIComponent(data.nodeId)}`,
        entityRefs: { projectId: data.projectId, fileId: data.nodeId }, dedupeKey: `file-comment:${row!.id}` }).catch(() => undefined);
    }
    return { success: true as const, id: row!.id };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false as const, error: "Write the comment (up to 4,000 characters)." };
    logger.warn("file_comment.add_failed", { error: error instanceof Error ? error.message : String(error) });
    return fail(error, "Couldn’t add the comment.");
  }
}

const changeInput = z.object({ projectId: uuid, nodeId: uuid, commentId: uuid, action: z.enum(["resolve", "reopen", "delete"]) });

/** Resolve or reopen (the author or anyone who can change files); delete (the author). */
export async function changeFileCommentAction(input: z.infer<typeof changeInput>) {
  try {
    const data = changeInput.parse(input);
    const { user, access } = await insiderFile(data.projectId, data.nodeId);
    if (access.writeBlocked) throw new Error(writeBlockedMessage(access.writeBlocked));
    const [c] = await db.select({ authorId: fileComments.authorId }).from(fileComments)
      .where(and(eq(fileComments.id, data.commentId), eq(fileComments.nodeId, data.nodeId), isNull(fileComments.deletedAt))).limit(1);
    if (!c) throw new Error("Comment not found");
    const mine = c.authorId === user.id;
    if (data.action === "delete" ? !mine : !(mine || access.canWrite)) throw new Error(data.action === "delete" ? "Only its author deletes a comment." : "Only its author or people who can change files resolve it.");
    await db.update(fileComments).set(data.action === "delete" ? { deletedAt: new Date() } : { resolvedAt: data.action === "resolve" ? new Date() : null }).where(eq(fileComments.id, data.commentId));
    return { success: true as const };
  } catch (error) {
    return fail(error, "Couldn’t change the comment.");
  }
}
