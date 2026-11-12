"use server";

import {
  and,
  desc,
  eq,
  inArray,
  isNull,
  lt,
  lte,
  or,
  sql,
} from "drizzle-orm";

import { db } from "@/lib/db";
import { toIsoString } from "@/lib/utils/date";
import { orgTaskVisibleToSql } from "@/lib/organizations/assignments";
import {
  commentMentions,
  profiles,
  workspaceMembers,
  workspaceOpenRoles,
  workspaces,
  taskCommentLikes,
  taskComments,
  tasks,
} from "@/lib/db/schema";
import {
  createEmptyTaskDiscussionPage,
  type TaskDiscussionAuthor,
  type TaskDiscussionBaseEntry,
  type TaskDiscussionCursor,
  type TaskDiscussionDeleteMode,
  type TaskDiscussionThreadPage,
} from "@/lib/workspaces/task-discussion";
import { parseMentions } from "@/lib/workspaces/mention-tokens";
import { enqueueWorkspaceNotificationEvent } from "@/lib/notifications/workspace-events";
import { enqueueTaskCommentMentionNotifications } from "@/lib/notifications/task-comment-mention";
import { consumeRateLimit } from "@/lib/security/rate-limit";
import { getViewerProfileContext } from "@/lib/server/viewer-context";
import { logger } from "@/lib/logger";
import { notifyOrg, orgHref, orgLabel } from "@/lib/organizations/notify";
import {
  TASK_COMMENT_MAX_MENTIONS,
  taskCommentContentSchema,
} from "@/lib/validations/task";

import {
  assertTaskAccess,
  assertCommentAccess,
  readDiscussionRows,
  readDiscussionLikeMaps,
  readDiscussionCount,
  readTaskDiscussionInternal,
  readTaskDiscussionCommentInternal,
  normalizeTaskDiscussionAuthor,
  normalizeTaskDiscussionEntry,
  orgReviewerSql,
  DISCUSSION_PAGE_SIZE,
  DISCUSSION_REPLY_PREVIEW_SIZE,
  createTaskCommentAs,
  deleteTaskCommentAs,
} from "@/lib/domain/task-comments";

export async function readTaskDiscussionAction(
  projectId: string,
  taskId: string,
  cursor?: TaskDiscussionCursor | null,
) {
  try {
    const viewer = await getViewerProfileContext();
    if (!viewer.userId) {
      return { success: false as const, error: "Sign in to continue", data: createEmptyTaskDiscussionPage() };
    }

    const data = await readTaskDiscussionInternal({
      projectId,
      taskId,
      viewerId: viewer.userId,
      cursor,
    });

    return { success: true as const, data };
  } catch (error: any) {
    console.error("Failed to read task discussion:", error);
    return {
      success: false as const,
      error: error?.message || "Couldn’t load discussion",
      data: createEmptyTaskDiscussionPage(),
    };
  }
}

/**
 * Class questions (report §23.5, decision 16): a copy's people read and ask on the main assignment's thread, beside
 * their private conversation. Organization members only; a question shows Answered once an admin replies.
 */
/** Class questions from a student's copy, or from the main assignment for its admins, who answer them (23.5). */
export async function readClassQuestionsAction(copyId: string) {
  try {
    const viewer = await getViewerProfileContext();
    if (!viewer.userId) return { success: false as const, error: "Sign in to continue" };
    const [row] = await db.execute<{ master_id: string; org_id: string; role: string | null; owner_id: string; closed: boolean; is_master: boolean }>(sql`
      SELECT m.id AS master_id, m.workspace_id AS org_id, om.role, o.owner_id, (m.assignment_settings->>'closedAt') IS NOT NULL AS closed, c.id = m.id AS is_master
      FROM tasks c JOIN tasks m ON m.id = coalesce(c.assignment_id, c.id) AND m.kind = 'assignment' AND m.deleted_at IS NULL JOIN workspaces o ON o.id = m.workspace_id
      LEFT JOIN workspace_members om ON om.workspace_id = o.id AND om.user_id = ${viewer.userId}
      WHERE c.id = ${copyId} AND c.deleted_at IS NULL`);
    const isAdmin = Boolean(row && (row.owner_id === viewer.userId || row.role === "admin"));
    // The main assignment's own view is for its admins; members reach the thread from their copy.
    if (row?.is_master && !isAdmin) return { success: false as const, error: "Class questions are for the organization." };
    // People outside the organization get no Class questions tab (23.5).
    if (!row || (!row.role && row.owner_id !== viewer.userId)) return { success: false as const, error: "Class questions are for the organization." };
    const data = await readTaskDiscussionInternal({ projectId: row.org_id, taskId: row.master_id, viewerId: viewer.userId });
    const admins = new Set((await db.execute<{ id: string }>(sql`
      SELECT owner_id AS id FROM workspaces WHERE id = ${row.org_id} UNION SELECT user_id FROM workspace_members WHERE workspace_id = ${row.org_id} AND role = 'admin'`)).map((r) => r.id));
    return {
      success: true as const,
      masterId: row.master_id,
      orgId: row.org_id,
      // Viewers read but don't post; a closed assignment is read only (23.5).
      canPost: row.role !== "viewer" && !row.closed,
      isAdmin,
      questions: data.comments.map((c) => ({ ...c, answered: c.replies.some((r) => admins.has(r.userId)) })),
    };
  } catch (error) {
    return { success: false as const, error: error instanceof Error ? error.message : "Couldn’t load class questions" };
  }
}

export async function readTaskDiscussionCommentAction(
  projectId: string,
  taskId: string,
  commentId: string,
) {
  try {
    const viewer = await getViewerProfileContext();
    if (!viewer.userId) {
      return { success: false as const, error: "Sign in to continue", data: null };
    }

    const data = await readTaskDiscussionCommentInternal({
      projectId,
      taskId,
      commentId,
      viewerId: viewer.userId,
    });

    return { success: true as const, data };
  } catch (error: any) {
    console.error("Failed to read task discussion comment:", error);
    return {
      success: false as const,
      error: error?.message || "Couldn’t load comment",
      data: null,
    };
  }
}

export async function createTaskCommentAction(
  taskId: string,
  projectId: string,
  content: string,
  parentCommentId?: string | null,
) {
  const viewer = await getViewerProfileContext();
  if (!viewer.userId) {
    return { success: false as const, error: "Sign in to continue" };
  }
  return createTaskCommentAs({ userId: viewer.userId, profile: viewer.profile }, taskId, projectId, content, parentCommentId);
}

export async function toggleTaskCommentLikeAction(
  commentId: string,
  projectId: string,
) {
  try {
    const viewer = await getViewerProfileContext();
    if (!viewer.userId) {
      return { success: false as const, error: "Sign in to continue" };
    }
    const viewerUserId = viewer.userId;

    const { allowed } = await consumeRateLimit(`task-comment:${viewerUserId}`, 60, 60);
    if (!allowed) {
      return { success: false as const, error: "Too many attempts. Try again in a minute." };
    }

    const comment = await assertCommentAccess({
      commentId,
      projectId,
      userId: viewerUserId,
      mode: "write",
    });
    if (comment.deletedAt) {
      return { success: false as const, error: "Cannot like a deleted comment" };
    }

    const liked = await db.transaction(async (tx) => {
      // PURE OPTIMIZATION (Item 8): Single atomic CTE toggles like state and touches comment updated_at.
      const result = await tx.execute<{ liked: boolean }>(sql`
        WITH deleted AS (
          DELETE FROM task_comment_likes
          WHERE comment_id = ${commentId}::uuid AND user_id = ${viewerUserId}::uuid
          RETURNING id
        ),
        inserted AS (
          INSERT INTO task_comment_likes (comment_id, user_id, created_at)
          SELECT ${commentId}::uuid, ${viewerUserId}::uuid, now()
          WHERE NOT EXISTS (SELECT 1 FROM deleted)
          RETURNING id
        )
        SELECT EXISTS(SELECT 1 FROM inserted) AS liked
      `);
      return Array.from(result)[0]?.liked ?? false;
    });

    return { success: true as const, liked };
  } catch (error: any) {
    console.error("Failed to toggle task discussion like:", error);
    return { success: false as const, error: error?.message || "Couldn’t update like" };
  }
}

export async function deleteTaskCommentAction(
  commentId: string,
  projectId: string,
) {
  try {
    const viewer = await getViewerProfileContext();
    if (!viewer.userId) {
      return { success: false as const, error: "Sign in to continue" };
    }
    return await deleteTaskCommentAs(viewer.userId, commentId, projectId);
  } catch (error: any) {
    console.error("Failed to delete task discussion comment:", error);
    return { success: false as const, error: error?.message || "Couldn’t delete comment" };
  }
}

/**
 * Tell everyone (report §23.5, §30.4): an admin shares an answer with everyone on the assignment, each told on their
 * own copy: "New answer on Lab 1". Only an organization admin, and only for a reply on that assignment's questions.
 */
export async function shareClassAnswerAction(masterId: string, commentId: string): Promise<{ success: true; told: number } | { success: false; error: string }> {
  const viewer = await getViewerProfileContext();
  if (!viewer.userId) return { success: false, error: "Sign in to continue" };
  const [row] = await db.execute<{ title: string; org_id: string; admin: boolean; ok: boolean }>(sql`
    SELECT m.title, m.workspace_id AS org_id,
           (o.owner_id = ${viewer.userId} OR EXISTS (SELECT 1 FROM workspace_members a WHERE a.workspace_id = o.id AND a.user_id = ${viewer.userId} AND a.role = 'admin')) AS admin,
           EXISTS (SELECT 1 FROM task_comments c WHERE c.id = ${commentId}::uuid AND c.task_id = m.id AND c.deleted_at IS NULL) AS ok
    FROM tasks m JOIN workspaces o ON o.id = m.workspace_id AND o.kind = 'organization'
    WHERE m.id = ${masterId}::uuid AND m.kind = 'assignment' AND m.assignment_id IS NULL AND m.deleted_at IS NULL`);
  if (!row?.admin || !row.ok) return { success: false, error: "You don’t have access to this" };
  const org = await orgLabel(row.org_id);
  if (!org) return { success: false, error: "You don’t have access to this" };
  const copies = await db.execute<{ id: string; people: string[]; in_org: boolean; workspace_id: string }>(sql`
    SELECT c.id, c.workspace_id, bool_and(p.kind = 'organization') AS in_org, to_jsonb(array_remove(array_agg(DISTINCT coalesce(tm.user_id, c.assignee_id)), NULL)) AS people
    FROM tasks c JOIN workspaces p ON p.id = c.workspace_id LEFT JOIN task_team_members tm ON tm.task_id = c.id
    WHERE c.assignment_id = ${masterId}::uuid AND c.deleted_at IS NULL AND c.excused_at IS NULL GROUP BY c.id, c.workspace_id`);
  let told = 0;
  for (const copy of copies) {
    if (!copy.people.length) continue;
    told += copy.people.length;
    await notifyOrg({ orgId: org.id, eventKey: "assignments.answer_shared", actorId: viewer.userId, to: copy.people, title: `New answer on ${row.title}`,
      // Group work opens in its own workspace (decision 133).
      href: `${copy.in_org ? orgHref(org) : `/workspaces/${copy.workspace_id}`}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(copy.id)}&panelTab=comments`, sourceEventId: `answer:${commentId}:${copy.id}`, refs: { taskId: copy.id } });
  }
  return { success: true, told };
}
