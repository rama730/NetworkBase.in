import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

let viewerId = "";
moduleStubs.set("@/lib/server/viewer-context", { getViewerProfileContext: async () => ({ userId: viewerId }) });

let actions: typeof import("../../src/app/actions/task-comment");
before(async () => {
  actions = await loadAppModule(() => import("../../src/app/actions/task-comment"));
});
after(async () => { await sql.end(); await closeAppDb(); });

// PERF-002: replies and totals for the whole page come from one ranked query.
test("discussion page returns the newest 20 replies per thread, exact reply totals and viewer likes", async () => {
  const userId = await sql.begin((tx) => createUser(tx));
  viewerId = userId;
  try {
    const projectId = await sql.begin((tx) => createProject(tx, userId));
    const [task] = await sql`INSERT INTO tasks (project_id, title) VALUES (${projectId}, 't') RETURNING id`;
    const taskId = task!.id as string;
    const parent = async (minute: number) => {
      const [row] = await sql`INSERT INTO task_comments (task_id, user_id, content, created_at) VALUES (${taskId}, ${userId}, ${`p${minute}`}, ${new Date(Date.UTC(2026, 0, 1, 0, minute))}) RETURNING id`;
      return row!.id as string;
    };
    const busy = await parent(3);
    const quiet = await parent(2);
    const empty = await parent(1);
    for (let i = 1; i <= 25; i += 1) {
      await sql`INSERT INTO task_comments (task_id, user_id, content, parent_comment_id, created_at) VALUES (${taskId}, ${userId}, ${`b${i}`}, ${busy}, ${new Date(Date.UTC(2026, 0, 2, 0, i))})`;
    }
    for (let i = 1; i <= 2; i += 1) {
      await sql`INSERT INTO task_comments (task_id, user_id, content, parent_comment_id, created_at) VALUES (${taskId}, ${userId}, ${`q${i}`}, ${quiet}, ${new Date(Date.UTC(2026, 0, 2, 1, i))})`;
    }
    await sql`INSERT INTO task_comment_likes (comment_id, user_id) VALUES (${quiet}, ${userId})`;
    const other = await sql.begin((tx) => createUser(tx));
    await sql`INSERT INTO task_comment_likes (comment_id, user_id) VALUES (${quiet}, ${other}), (${empty}, ${other})`;

    const result = await actions.readTaskDiscussionAction(projectId, taskId);
    assert.equal(result.success, true, "error" in result ? String(result.error) : "");
    const byId = new Map(result.data.comments.map((c) => [c.id, c]));
    assert.deepEqual(result.data.comments.map((c) => c.id), [busy, quiet, empty]);

    const busyThread = byId.get(busy)!;
    assert.equal(busyThread.replyCount, 25);
    assert.equal(busyThread.repliesHaveMore, true);
    assert.deepEqual(busyThread.replies.map((r) => r.content), Array.from({ length: 20 }, (_, i) => `b${i + 6}`));
    const quietThread = byId.get(quiet)!;
    assert.equal(quietThread.replyCount, 2);
    assert.equal(quietThread.repliesHaveMore, false);
    assert.deepEqual(quietThread.replies.map((r) => r.content), ["q1", "q2"]);
    assert.deepEqual([quietThread.likeCount, quietThread.likedByViewer], [2, true]);
    assert.deepEqual([byId.get(empty)!.replyCount, byId.get(empty)!.likeCount, byId.get(empty)!.likedByViewer], [0, 1, false]);
    assert.equal(result.data.totalCount, 30);
  } finally {
    await sql`DELETE FROM task_comments WHERE user_id = ${userId}`;
    await sql`DELETE FROM projects WHERE owner_id = ${userId}`;
  }
});
