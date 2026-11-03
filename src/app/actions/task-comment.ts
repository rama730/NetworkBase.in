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
import {
  TASK_COMMENT_MAX_MENTIONS,
  taskCommentContentSchema,
} from "@/lib/validations/task";

const DISCUSSION_PAGE_SIZE = 20;
const DISCUSSION_REPLY_PREVIEW_SIZE = 20;

type DiscussionRow = {
  id: string;
  taskId: string;
  userId: string;
  parentCommentId: string | null;
  content: string;
  createdAt: Date | string;
  updatedAt: Date | string;
  deletedAt: Date | string | null;
  deletedBy: string | null;
  authorId: string | null;
  authorFullName: string | null;
  authorUsername: string | null;
  authorAvatarUrl: string | null;
};

function normalizeTaskDiscussionAuthor(row: DiscussionRow): TaskDiscussionAuthor | null {
  if (!row.authorId) return null;
  return {
    id: row.authorId,
    fullName: row.authorFullName,
    username: row.authorUsername,
    avatarUrl: row.authorAvatarUrl,
  };
}

function normalizeTaskDiscussionEntry(params: {
  row: DiscussionRow;
  likeCounts: Map<string, number>;
  likedIds: Set<string>;
}): TaskDiscussionBaseEntry {
  return {
    id: params.row.id,
    taskId: params.row.taskId,
    userId: params.row.userId,
    parentCommentId: params.row.parentCommentId,
    content: params.row.content,
    createdAt: toIsoString(params.row.createdAt) ?? new Date().toISOString(),
    updatedAt: toIsoString(params.row.updatedAt) ?? new Date().toISOString(),
    deletedAt: toIsoString(params.row.deletedAt),
    deletedBy: params.row.deletedBy,
    author: normalizeTaskDiscussionAuthor(params.row),
    likeCount: params.likeCounts.get(params.row.id) ?? 0,
    likedByViewer: params.likedIds.has(params.row.id),
  };
}

// PURE OPTIMIZATION (Item 9): Single flat join verifies task access, project existence, and user role.
/** An admin or the owner of the organization an assignment copy belongs to (problem 36). */
const orgReviewerSql = (userId: string) => sql<boolean>`EXISTS (
  SELECT 1 FROM tasks nb_m JOIN workspaces nb_o ON nb_o.id = nb_m.workspace_id
  WHERE nb_m.id = ${tasks.assignmentId} AND (nb_o.owner_id = ${userId}::uuid
    OR EXISTS (SELECT 1 FROM workspace_members nb_om WHERE nb_om.workspace_id = nb_o.id AND nb_om.user_id = ${userId}::uuid AND nb_om.role = 'admin')))`;

async function assertTaskAccess(params: {
  taskId: string;
  projectId: string;
  userId: string;
  mode: "read" | "write";
}) {
  const rows = await db
    .select({
      id: tasks.id,
      projectId: tasks.projectId,
      ownerId: workspaces.ownerId,
      slug: workspaces.slug,
      title: workspaces.title,
      deletedAt: workspaces.deletedAt,
      role: workspaceMembers.role,
      // Decision 37: comments follow the task's own visibility, so a private copy's conversation stays private.
      visible: orgTaskVisibleToSql(sql`${tasks.id}`, params.userId),
      orgReviewer: orgReviewerSql(params.userId),
    })
    .from(tasks)
    .innerJoin(workspaces, eq(tasks.projectId, workspaces.id))
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.projectId, workspaces.id),
        eq(workspaceMembers.userId, params.userId),
      ),
    )
    .where(and(eq(tasks.id, params.taskId), isNull(tasks.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error("Task not found");
  }
  if (row.projectId !== params.projectId) {
    throw new Error("Task does not belong to this workspace");
  }
  if (row.deletedAt) {
    throw new Error("Workspace not found");
  }

  const isOwner = row.ownerId === params.userId;
  // Report §42.14 problem 36: the organization's admins review group work in workspaces they aren't on.
  if (!isOwner && !row.orgReviewer) {
    if (!row.role || !row.visible) {
      throw new Error("You don’t have access to this");
    }
    if (params.mode === "write" && row.role.toLowerCase() === "viewer") {
      throw new Error("You do not have permission to perform this workspace action");
    }
  }

  return {
    id: row.id,
    projectId: row.projectId,
    ownerId: row.ownerId,
    slug: row.slug,
    title: row.title,
  };
}

// PURE OPTIMIZATION (Item 9): Single flat join verifies comment, task, project, and permissions in 1 query.
async function assertCommentAccess(params: {
  commentId: string;
  projectId: string;
  userId: string;
  mode: "read" | "write";
}) {
  const rows = await db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      projectId: tasks.projectId,
      userId: taskComments.userId,
      parentCommentId: taskComments.parentCommentId,
      deletedAt: taskComments.deletedAt,
      ownerId: workspaces.ownerId,
      projectDeletedAt: workspaces.deletedAt,
      role: workspaceMembers.role,
      visible: orgTaskVisibleToSql(sql`${tasks.id}`, params.userId),
      orgReviewer: orgReviewerSql(params.userId),
    })
    .from(taskComments)
    .innerJoin(tasks, eq(taskComments.taskId, tasks.id))
    .innerJoin(workspaces, eq(tasks.projectId, workspaces.id))
    .leftJoin(
      workspaceMembers,
      and(
        eq(workspaceMembers.projectId, workspaces.id),
        eq(workspaceMembers.userId, params.userId),
      ),
    )
    // COR-026: comments on a deleted task are frozen with it.
    .where(and(eq(taskComments.id, params.commentId), isNull(tasks.deletedAt)))
    .limit(1);

  const row = rows[0];
  if (!row) {
    throw new Error("Comment not found");
  }
  if (row.projectId !== params.projectId) {
    throw new Error("Comment does not belong to this workspace");
  }
  if (row.projectDeletedAt) {
    throw new Error("Workspace not found");
  }

  const isOwner = row.ownerId === params.userId;
  // Report §42.14 problem 36: the organization's admins review group work in workspaces they aren't on.
  if (!isOwner && !row.orgReviewer) {
    if (!row.role || !row.visible) {
      throw new Error("You don’t have access to this");
    }
    if (params.mode === "write" && row.role.toLowerCase() === "viewer") {
      throw new Error("You do not have permission to perform this workspace action");
    }
  }

  return row;
}

async function readDiscussionRows(params: {
  taskId: string;
  cursor?: TaskDiscussionCursor | null;
  limit?: number;
}) {
  const pageSize = Math.max(1, Math.min(100, params.limit ?? DISCUSSION_PAGE_SIZE));
  const cursorDate = params.cursor?.beforeCreatedAt ? new Date(params.cursor.beforeCreatedAt) : null;
  const hasCursor = Boolean(cursorDate && !Number.isNaN(cursorDate.getTime()) && params.cursor?.beforeId);

  const whereClause = and(
    eq(taskComments.taskId, params.taskId),
    isNull(taskComments.parentCommentId),
    hasCursor
      ? or(
          lt(taskComments.createdAt, cursorDate as Date),
          and(eq(taskComments.createdAt, cursorDate as Date), lt(taskComments.id, params.cursor!.beforeId)),
        )
      : undefined,
  );

  const topLevelRows = await db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      userId: taskComments.userId,
      parentCommentId: taskComments.parentCommentId,
      content: taskComments.content,
      createdAt: taskComments.createdAt,
      updatedAt: taskComments.updatedAt,
      deletedAt: taskComments.deletedAt,
      deletedBy: taskComments.deletedBy,
      authorId: profiles.id,
      authorFullName: profiles.fullName,
      authorUsername: profiles.username,
      authorAvatarUrl: profiles.avatarUrl,
    })
    .from(taskComments)
    .leftJoin(profiles, eq(taskComments.userId, profiles.id))
    .where(whereClause)
    .orderBy(desc(taskComments.createdAt), desc(taskComments.id))
    .limit(pageSize + 1);

  const hasMore = topLevelRows.length > pageSize;
  const limitedTopLevelRows = hasMore ? topLevelRows.slice(0, pageSize) : topLevelRows;
  const oldestLoaded = limitedTopLevelRows[limitedTopLevelRows.length - 1] ?? null;
  // Parents are newest-first everywhere; replies remain chronological in their thread.
  const orderedTopLevelRows = limitedTopLevelRows as DiscussionRow[];
  const parentIds = orderedTopLevelRows.map((row) => row.id);

  // One ranked query for every parent: the newest DISCUSSION_REPLY_PREVIEW_SIZE replies per thread
  // plus each thread's total, instead of a count query and a reply query per parent.
  const ranked = db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      userId: taskComments.userId,
      parentCommentId: taskComments.parentCommentId,
      content: taskComments.content,
      createdAt: taskComments.createdAt,
      updatedAt: taskComments.updatedAt,
      deletedAt: taskComments.deletedAt,
      deletedBy: taskComments.deletedBy,
      rank: sql<number>`row_number() over (partition by ${taskComments.parentCommentId} order by ${taskComments.createdAt} desc, ${taskComments.id} desc)`.as("rank"),
      replyTotal: sql<number>`(count(*) over (partition by ${taskComments.parentCommentId}))::int`.as("reply_total"),
    })
    .from(taskComments)
    .where(and(
      eq(taskComments.taskId, params.taskId),
      inArray(taskComments.parentCommentId, parentIds),
    ))
    .as("ranked");
  const rankedReplies = parentIds.length > 0
    ? await db
        .select({
          id: ranked.id,
          taskId: ranked.taskId,
          userId: ranked.userId,
          parentCommentId: ranked.parentCommentId,
          content: ranked.content,
          createdAt: ranked.createdAt,
          updatedAt: ranked.updatedAt,
          deletedAt: ranked.deletedAt,
          deletedBy: ranked.deletedBy,
          replyTotal: ranked.replyTotal,
          authorId: profiles.id,
          authorFullName: profiles.fullName,
          authorUsername: profiles.username,
          authorAvatarUrl: profiles.avatarUrl,
        })
        .from(ranked)
        .leftJoin(profiles, eq(ranked.userId, profiles.id))
        .where(lte(ranked.rank, DISCUSSION_REPLY_PREVIEW_SIZE))
        .orderBy(ranked.parentCommentId, ranked.createdAt, ranked.id)
    : [];
  const replyCounts = new Map<string, number>();
  for (const row of rankedReplies) {
    if (row.parentCommentId) replyCounts.set(row.parentCommentId, Number(row.replyTotal));
  }
  const replyRows = rankedReplies as DiscussionRow[];

  const allCommentIds = [...parentIds, ...replyRows.map((row) => row.id)];
  const likeCounts = new Map<string, number>();
  const nextCursor = hasMore && oldestLoaded
    ? {
        beforeCreatedAt: toIsoString(oldestLoaded.createdAt) ?? new Date().toISOString(),
        beforeId: oldestLoaded.id,
      }
    : null;

  return {
    orderedTopLevelRows,
    replyRows: replyRows as DiscussionRow[],
    replyCounts,
    allCommentIds,
    likeCounts,
    nextCursor,
  };
}

async function readDiscussionLikeMaps(commentIds: string[], viewerId: string) {
  const likeCounts = new Map<string, number>();
  const likedIds = new Set<string>();

  if (commentIds.length === 0) {
    return { likeCounts, likedIds };
  }

  const likeRows = await db
    .select({
      commentId: taskCommentLikes.commentId,
      likeCount: sql<number>`count(*)::int`,
      likedByViewer: sql<boolean>`bool_or(${taskCommentLikes.userId} = ${viewerId})`,
    })
    .from(taskCommentLikes)
    .where(inArray(taskCommentLikes.commentId, commentIds))
    .groupBy(taskCommentLikes.commentId);

  for (const row of likeRows) {
    likeCounts.set(row.commentId, Number(row.likeCount ?? 0));
    if (row.likedByViewer) likedIds.add(row.commentId);
  }

  return { likeCounts, likedIds };
}

async function readDiscussionCount(taskId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(taskComments)
    .where(eq(taskComments.taskId, taskId));

  return Number(row?.count ?? 0);
}

async function readTaskDiscussionInternal(params: {
  projectId: string;
  taskId: string;
  viewerId: string;
  cursor?: TaskDiscussionCursor | null;
  limit?: number;
}): Promise<TaskDiscussionThreadPage> {
  await assertTaskAccess({
    taskId: params.taskId,
    projectId: params.projectId,
    userId: params.viewerId,
    mode: "read",
  });

  const { orderedTopLevelRows, replyRows, replyCounts, allCommentIds, nextCursor } = await readDiscussionRows({
    taskId: params.taskId,
    cursor: params.cursor,
    limit: params.limit,
  });
  const { likeCounts, likedIds } = await readDiscussionLikeMaps(allCommentIds, params.viewerId);
  const totalCount = await readDiscussionCount(params.taskId);

  const repliesByParentId = new Map<string, TaskDiscussionBaseEntry[]>();
  for (const row of replyRows) {
    const reply = normalizeTaskDiscussionEntry({ row, likeCounts, likedIds });
    const parentId = row.parentCommentId;
    if (!parentId) continue;
    const existing = repliesByParentId.get(parentId) ?? [];
    existing.push(reply);
    repliesByParentId.set(parentId, existing);
  }

  return {
    comments: orderedTopLevelRows.map((row) => ({
      ...normalizeTaskDiscussionEntry({ row, likeCounts, likedIds }),
      replies: repliesByParentId.get(row.id) ?? [],
      replyCount: replyCounts.get(row.id) ?? 0,
      repliesHaveMore: (replyCounts.get(row.id) ?? 0) > (repliesByParentId.get(row.id)?.length ?? 0),
    })),
    nextCursor,
    totalCount,
  };
}

async function readTaskDiscussionCommentInternal(params: {
  projectId: string;
  taskId: string;
  commentId: string;
  viewerId: string;
}) {
  await assertTaskAccess({
    taskId: params.taskId,
    projectId: params.projectId,
    userId: params.viewerId,
    mode: "read",
  });

  const [row] = await db
    .select({
      id: taskComments.id,
      taskId: taskComments.taskId,
      userId: taskComments.userId,
      parentCommentId: taskComments.parentCommentId,
      content: taskComments.content,
      createdAt: taskComments.createdAt,
      updatedAt: taskComments.updatedAt,
      deletedAt: taskComments.deletedAt,
      deletedBy: taskComments.deletedBy,
      authorId: profiles.id,
      authorFullName: profiles.fullName,
      authorUsername: profiles.username,
      authorAvatarUrl: profiles.avatarUrl,
    })
    .from(taskComments)
    .leftJoin(profiles, eq(taskComments.userId, profiles.id))
    .where(
      and(
        eq(taskComments.id, params.commentId),
        eq(taskComments.taskId, params.taskId),
      ),
    )
    .limit(1);

  if (!row) {
    return null;
  }

  const { likeCounts, likedIds } = await readDiscussionLikeMaps([row.id], params.viewerId);
  return normalizeTaskDiscussionEntry({
    row: row as DiscussionRow,
    likeCounts,
    likedIds,
  });
}

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
export async function readClassQuestionsAction(copyId: string) {
  try {
    const viewer = await getViewerProfileContext();
    if (!viewer.userId) return { success: false as const, error: "Sign in to continue" };
    const [row] = await db.execute<{ master_id: string; org_id: string; role: string | null; owner_id: string; closed: boolean }>(sql`
      SELECT m.id AS master_id, m.workspace_id AS org_id, om.role, o.owner_id, (m.assignment_settings->>'closedAt') IS NOT NULL AS closed
      FROM tasks c JOIN tasks m ON m.id = c.assignment_id AND m.deleted_at IS NULL JOIN workspaces o ON o.id = m.workspace_id
      LEFT JOIN workspace_members om ON om.workspace_id = o.id AND om.user_id = ${viewer.userId}
      WHERE c.id = ${copyId} AND c.deleted_at IS NULL`);
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
  try {
    const viewer = await getViewerProfileContext();
    if (!viewer.userId) {
      return { success: false as const, error: "Sign in to continue" };
    }
    const actorUserId = viewer.userId;

    const { allowed } = await consumeRateLimit(`task-comment:${viewer.userId}`, 60, 60);
    if (!allowed) {
      return { success: false as const, error: "Too many attempts. Try again in a minute." };
    }

    const parsedContent = taskCommentContentSchema.safeParse(content);
    if (!parsedContent.success) {
      return {
        success: false as const,
        error: parsedContent.error.issues[0]?.message || "Invalid comment",
      };
    }
    const trimmedContent = parsedContent.data;

    const taskAccess = await assertTaskAccess({
      taskId,
      projectId,
      userId: viewer.userId,
      mode: "write",
    });

    let parentCommentAuthorId: string | null = null;
    if (parentCommentId) {
      const parent = await assertCommentAccess({
        commentId: parentCommentId,
        projectId,
        userId: actorUserId,
        mode: "read",
      });
      if (parent.taskId !== taskId) {
        return { success: false as const, error: "Reply must belong to the same task" };
      }
      if (parent.parentCommentId) {
        return { success: false as const, error: "Replies can only target top-level comments" };
      }
      if (parent.deletedAt) {
        return { success: false as const, error: "Cannot reply to a deleted comment" };
      }
      parentCommentAuthorId = parent.userId;
    }

    // Mentions are stored inline as `@{userId|DisplayName}` tokens. We parse
    // the content before the insert so we can (a) validate that each mentioned
    // id actually belongs to this project (prevents a crafted payload from
    // pinging strangers), and (b) persist the `comment_mentions` projection
    // used by the inbox + notification fan-out.
    const parsedMentions = parseMentions(trimmedContent);
    const candidateMentionIds = parsedMentions.mentionIds;
    if (candidateMentionIds.length > TASK_COMMENT_MAX_MENTIONS) {
      return {
        success: false as const,
        error: `A comment can mention at most ${TASK_COMMENT_MAX_MENTIONS} people`,
      };
    }
    let validatedMentionIds: string[] = [];

    // `@Frontend developers` (report §14.4): a unit's id in a mention token reaches everyone in that unit.
    const mentionedUnits = candidateMentionIds.length > 0
      ? await db.select({ id: workspaceOpenRoles.id }).from(workspaceOpenRoles)
          .where(and(eq(workspaceOpenRoles.projectId, projectId), inArray(workspaceOpenRoles.id, candidateMentionIds)))
      : [];
    const unitIds = new Set(mentionedUnits.map((unit) => unit.id));
    const unitPeople = unitIds.size > 0
      ? await db.select({ userId: workspaceMembers.userId }).from(workspaceMembers)
          .where(and(eq(workspaceMembers.projectId, projectId), inArray(workspaceMembers.unitId, [...unitIds])))
      : [];
    const personIds = [...new Set([...candidateMentionIds.filter((id) => !unitIds.has(id)), ...unitPeople.map((row) => row.userId)])];

    // PURE OPTIMIZATION (Item 9): Omit redundant project select since taskAccess already provided ownerId/slug/title.
    if (personIds.length > 0) {
      const memberRows = await db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(
          and(
            eq(workspaceMembers.projectId, projectId),
            inArray(workspaceMembers.userId, personIds),
            // Only people who can see this task (decision 37): a classmate can't be pulled into a private copy.
            orgTaskVisibleToSql(sql`${taskId}::uuid`, sql`${workspaceMembers.userId}`),
          ),
        );

      const allowed = new Set<string>(memberRows.map((row) => row.userId));
      if (taskAccess.ownerId) allowed.add(taskAccess.ownerId);

      validatedMentionIds = personIds.filter((id) => allowed.has(id));
    }

    const createdAt = new Date();

    const inserted = await db.transaction(async (tx) => {
      if (parentCommentId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${parentCommentId}, 0))`);
        const [lockedParent] = await tx
          .select({
            taskId: taskComments.taskId,
            parentCommentId: taskComments.parentCommentId,
            deletedAt: taskComments.deletedAt,
          })
          .from(taskComments)
          .where(eq(taskComments.id, parentCommentId))
          .limit(1);
        if (!lockedParent || lockedParent.taskId !== taskId || lockedParent.parentCommentId || lockedParent.deletedAt) {
          throw new Error("Reply target is no longer available");
        }
      }

      const commentValues: typeof taskComments.$inferInsert = {
        taskId,
        userId: actorUserId,
        content: trimmedContent,
        createdAt,
        updatedAt: createdAt,
      };
      if (parentCommentId) commentValues.parentCommentId = parentCommentId;

      const [createdComment] = await tx
        .insert(taskComments)
        .values(commentValues)
        .returning({ id: taskComments.id });

      if (!createdComment?.id) return null;

      if (validatedMentionIds.length > 0) {
        await tx
          .insert(commentMentions)
          .values(
            validatedMentionIds.map((mentionedUserId) => ({
              commentId: createdComment.id,
              mentionedUserId,
              createdAt,
            })),
          )
          .onConflictDoNothing({
            target: [commentMentions.commentId, commentMentions.mentionedUserId],
          });
      }

      return createdComment;
    });

    if (!inserted?.id) {
      return { success: false as const, error: "Couldn’t create comment" };
    }

    if (validatedMentionIds.length > 0) {
      // Fire-and-forget: a failed notification enqueue must not roll back the
      // comment. The helper itself is structured to never throw, but the
      // await is still wrapped so future implementations (HTTP-backed queue,
      // etc.) inherit the same invariant.
      try {
        await enqueueTaskCommentMentionNotifications({
          recipientUserIds: validatedMentionIds,
          authorUserId: viewer.userId,
          authorDisplayName: viewer.profile?.fullName ?? viewer.profile?.username ?? null,
          authorAvatarUrl: viewer.profile?.avatarUrl ?? null,
          projectId,
          projectSlug: taskAccess.slug ?? null,
          projectLabel: taskAccess.title ?? null,
          taskId,
          commentId: inserted.id,
          parentCommentId: parentCommentId ?? null,
          preview: parsedMentions.plainText,
          createdAt,
        });
      } catch (notifyError) {
        logger.warn("tasks.comment_mention_notification_failed", {
          module: "notifications",
          projectId,
          taskId,
          actorUserId: viewer.userId,
          error: notifyError instanceof Error ? notifyError.message : String(notifyError),
        });
      }
    }

    if (
      parentCommentId &&
      parentCommentAuthorId &&
      parentCommentAuthorId !== viewer.userId &&
      !validatedMentionIds.includes(parentCommentAuthorId)
    ) {
      try {
        const actorName = viewer.profile?.fullName ?? viewer.profile?.username ?? null;
        await enqueueWorkspaceNotificationEvent({
          projectId,
          actorUserId: viewer.userId,
          actorName,
          actorAvatarUrl: viewer.profile?.avatarUrl ?? null,
          eventKey: "tasks.replies",
          affectedMemberId: parentCommentAuthorId,
          title: `${actorName || "Someone"} replied to your task comment`,
          body: parsedMentions.plainText,
          href: `/workspaces/${encodeURIComponent(taskAccess.slug || projectId)}?tab=tasks&drawerType=task&drawerId=${encodeURIComponent(taskId)}&panelTab=comments&commentId=${encodeURIComponent(inserted.id)}`,
          entityRefs: {
            projectId,
            projectSlug: taskAccess.slug ?? null,
            taskId,
            commentId: inserted.id,
            parentCommentId,
            createdAt: createdAt.toISOString(),
          },
          preview: {
            actorName,
            actorAvatarUrl: viewer.profile?.avatarUrl ?? null,
            contextLabel: taskAccess.title ?? "Task discussion",
            contextKind: "task",
          },
          sourceEventId: inserted.id,
        });
      } catch (notifyError) {
        logger.warn("tasks.comment_reply_notification_failed", {
          module: "notifications",
          taskId,
          projectId,
          actorUserId: viewer.userId,
          error: notifyError instanceof Error ? notifyError.message : String(notifyError),
        });
      }
    }

    const comment = await readTaskDiscussionCommentInternal({
      projectId,
      taskId,
      commentId: inserted.id,
      viewerId: viewer.userId,
    });

    return {
      success: true as const,
      data: {
        comment,
        mentionIds: validatedMentionIds,
      },
    };
  } catch (error: any) {
    console.error("Failed to create task discussion comment:", error);
    return { success: false as const, error: error?.message || "Couldn’t create comment" };
  }
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

    const { allowed } = await consumeRateLimit(`task-comment:${viewer.userId}`, 60, 60);
    if (!allowed) {
      return { success: false as const, error: "Too many attempts. Try again in a minute." };
    }

    const comment = await assertCommentAccess({
      commentId,
      projectId,
      userId: viewer.userId,
      mode: "write",
    });
    if (comment.userId !== viewer.userId) {
      return { success: false as const, error: "You can only delete your own comments" };
    }

    const lockId = comment.parentCommentId ?? commentId;
    const mode = await db.transaction(async (tx): Promise<TaskDiscussionDeleteMode> => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockId}, 0))`);
      const [current] = await tx
        .select({ parentCommentId: taskComments.parentCommentId })
        .from(taskComments)
        .where(eq(taskComments.id, commentId))
        .limit(1);
      if (!current) throw new Error("Comment not found");

      if (current.parentCommentId) {
        await tx.delete(taskComments).where(eq(taskComments.id, commentId));
        return "hard_delete";
      }

      const [replyRow] = await tx
        .select({ id: taskComments.id })
        .from(taskComments)
        .where(eq(taskComments.parentCommentId, commentId))
        .limit(1);
      if (!replyRow) {
        await tx.delete(taskComments).where(eq(taskComments.id, commentId));
        return "hard_delete";
      }

      await tx
        .update(taskComments)
        .set({
          deletedAt: new Date(),
          deletedBy: viewer.userId,
          updatedAt: new Date(),
        })
        .where(eq(taskComments.id, commentId));
      return "tombstone";
    });

    const entry = mode === "tombstone"
      ? await readTaskDiscussionCommentInternal({
          projectId,
          taskId: comment.taskId,
          commentId,
          viewerId: viewer.userId,
        })
      : null;

    return {
      success: true as const,
      data: {
        mode,
        commentId,
        parentCommentId: comment.parentCommentId,
        entry,
      },
    };
  } catch (error: any) {
    console.error("Failed to delete task discussion comment:", error);
    return { success: false as const, error: error?.message || "Couldn’t delete comment" };
  }
}
