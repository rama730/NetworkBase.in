import assert from "node:assert/strict";
import { after, before, test } from "node:test";

import { closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql, stubNextAfter } from "./_helpers";

// Updates as posts (Part 2): who is told what about likes, comments and replies on a post.
stubNextAfter();
moduleStubs.set("@/lib/realtime/server-broadcast", { broadcast: async () => true });
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn, updateTag: () => undefined });
delete process.env.UPSTASH_REDIS_REST_URL;
delete process.env.UPSTASH_REDIS_REST_TOKEN;

let viewerId = "";
let updates: typeof import("../../src/app/actions/workspace/updates");
before(async () => {
  const viewerContext = await loadAppModule(() => import("../../src/lib/server/viewer-context"));
  const viewer = () => ({ supabase: null, snapshot: null, user: viewerId ? { id: viewerId } : null, userId: viewerId || null, emailVerified: true, profile: { fullName: viewerId.slice(0, 6), username: null, avatarUrl: null } });
  moduleStubs.set("@/lib/server/viewer-context", { ...viewerContext, getViewerAuthContext: async () => viewer(), getViewerProfileContext: async () => viewer() });
  updates = await loadAppModule(() => import("../../src/app/actions/workspace/updates"));
});
const made: string[] = [];
const people: string[] = [];
after(async () => {
  if (made.length) await sql`DELETE FROM workspaces WHERE id IN ${sql(made)}`;
  if (people.length) await sql`DELETE FROM profiles WHERE id IN ${sql(people)}`;
  await sql.end();
  await closeAppDb();
});

const settle = () => new Promise((resolve) => setTimeout(resolve, 250));
async function post() {
  const [owner, author, mate, viewerRole, fan, fan2] = await sql.begin(async (tx) => [await createUser(tx), await createUser(tx), await createUser(tx), await createUser(tx), await createUser(tx), await createUser(tx)]);
  people.push(owner!, author!, mate!, viewerRole!, fan!, fan2!);
  const ws = await sql.begin((tx) => createProject(tx, owner!, { visibility: "public", publicTabVisibility: { updates: true } }));
  made.push(ws);
  await sql`INSERT INTO workspace_members (workspace_id, user_id, role) VALUES (${ws}, ${author!}, 'member'), (${ws}, ${mate!}, 'member'), (${ws}, ${viewerRole!}, 'viewer') ON CONFLICT DO NOTHING`;
  const [row] = await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${ws}, ${author!}, 'our work') RETURNING id`;
  return { owner: owner!, author: author!, mate: mate!, viewerRole: viewerRole!, fan: fan!, fan2: fan2!, ws, id: row!.id as string };
}
const tray = (user: string) => sql`SELECT kind, importance, title, aggregate_count, read_at, dismissed_at, actor_user_id FROM user_notifications WHERE user_id = ${user} AND kind IN ('project_update_like', 'project_update_team', 'project_update_comment', 'project_update_reply', 'project_update_mention') ORDER BY created_at`;
async function like(user: string, ws: string, id: string) {
  viewerId = user;
  await updates.toggleWorkspaceUpdateLikeAction(ws, id);
  await settle();
}
async function comment(user: string, ws: string, id: string, parent?: string) {
  viewerId = user;
  const res = await updates.createWorkspaceUpdateCommentAction(ws, id, `nice one ${Math.random()}`, parent);
  assert.ok(res.success, JSON.stringify(res));
  await settle();
  return (res.data as { id: string }).id;
}

test("a like: the author by name and grouped, owner and team by count, viewers and the liker never (UP2, UP3, UP5)", async () => {
  const p = await post();
  await like(p.fan, p.ws, p.id);
  await like(p.fan2, p.ws, p.id);
  const [authorRow] = await tray(p.author);
  assert.equal((await tray(p.author)).length, 1, "one row for the post");
  assert.equal(authorRow!.kind, "project_update_like");
  assert.match(authorRow!.title, / and 1 other liked your update$/);
  assert.equal(authorRow!.aggregate_count, 2);
  assert.equal(authorRow!.importance, "more");
  for (const member of [p.owner, p.mate]) {
    const rows = await tray(member);
    assert.equal(rows.length, 1);
    assert.equal(rows[0]!.kind, "project_update_team");
    assert.match(rows[0]!.title, /got 2 likes$/);
    assert.equal(rows[0]!.actor_user_id, null);
    assert.equal(rows[0]!.importance, "more");
  }
  assert.equal((await tray(p.viewerRole)).length, 0);
  assert.equal((await tray(p.fan)).length, 0);
});

test("the count starts again after reading, an unlike comes out, and a like loop never nags (UP5)", async () => {
  const p = await post();
  await like(p.fan, p.ws, p.id);
  await like(p.fan2, p.ws, p.id);
  await like(p.fan2, p.ws, p.id);
  assert.equal((await tray(p.author))[0]!.aggregate_count, 1, "unlike comes out");
  await like(p.fan, p.ws, p.id);
  const [emptied] = await tray(p.author);
  assert.notEqual(emptied!.dismissed_at, null, "nothing left, the row goes");
  await like(p.fan, p.ws, p.id);
  assert.notEqual((await tray(p.author))[0]!.dismissed_at, null, "liking again doesn't bring it back");

  await sql`UPDATE user_notifications SET read_at = now(), dismissed_at = NULL WHERE user_id = ${p.owner}`;
  await settle();
  await like(p.viewerRole, p.ws, p.id);
  const ownerRows = await tray(p.owner);
  assert.equal(ownerRows.length, 1);
  assert.equal(ownerRows[0]!.read_at, null, "back to unread");
  assert.match(ownerRows[0]!.title, /got 1 like$/, "only what's new since it was read");
});

test("a comment: the author gets it with push, the team a grouped count; a delete takes it out (UP3, UP6)", async () => {
  const p = await post();
  const commentId = await comment(p.fan, p.ws, p.id);
  const [authorRow] = await tray(p.author);
  assert.equal(authorRow!.kind, "project_update_comment");
  assert.equal(authorRow!.importance, "important", "push and toast");
  assert.match(authorRow!.title, /commented on your update$/);
  assert.match((await tray(p.owner))[0]!.title, /got 1 comment$/);
  await like(p.fan2, p.ws, p.id);
  assert.match((await tray(p.mate))[0]!.title, /got 1 like and 1 comment$/);
  viewerId = p.fan;
  await updates.deleteWorkspaceUpdateCommentAction(p.ws, commentId);
  await settle();
  assert.notEqual((await tray(p.author)).find((r) => r.kind === "project_update_comment")!.dismissed_at, null);
  assert.match((await tray(p.mate))[0]!.title, /got 1 like$/);
});

test("one person, one notification: a reply is personal for whoever it answers, team activity for the author (UP4)", async () => {
  const p = await post();
  const parent = await comment(p.mate, p.ws, p.id);
  await sql`DELETE FROM user_notifications WHERE user_id IN (${p.owner}, ${p.author}, ${p.mate})`;
  await comment(p.fan, p.ws, p.id, parent);
  const mateRows = await tray(p.mate);
  assert.equal(mateRows.length, 1, "one row for the person answered");
  assert.equal(mateRows[0]!.kind, "project_update_reply");
  assert.match(mateRows[0]!.title, /replied to your comment$/);
  const authorRows = await tray(p.author);
  assert.equal(authorRows.length, 1);
  assert.equal(authorRows[0]!.kind, "project_update_team");
  assert.match(authorRows[0]!.title, /got 1 comment$/);
  assert.equal((await tray(p.owner))[0]!.kind, "project_update_team");
});

test("a reply to the author's own comment is just a reply", async () => {
  const p = await post();
  const parent = await comment(p.author, p.ws, p.id);
  await sql`DELETE FROM user_notifications WHERE user_id = ${p.author}`;
  await comment(p.fan, p.ws, p.id, parent);
  const rows = await tray(p.author);
  assert.equal(rows.length, 1);
  assert.match(rows[0]!.title, /replied to your comment$/);
});

test("blocks and mutes win, and a member's own switch is honoured (UP8)", async () => {
  const p = await post();
  await sql`INSERT INTO user_mutes (muter_id, muted_id) VALUES (${p.mate}, ${p.fan})`;
  await sql`UPDATE workspace_members SET role = 'member', notification_preferences = ${sql.json({ version: 1, mode: "custom", rules: { "updates.team_activity": false } })} WHERE workspace_id = ${p.ws} AND user_id = ${p.viewerRole}`;
  await like(p.fan, p.ws, p.id);
  assert.equal((await tray(p.mate)).length, 0, "muted");
  assert.equal((await tray(p.viewerRole)).length, 0, "switched off");
  assert.equal((await tray(p.author)).length, 1);
});

test("a post with a narrow audience tells admins only; your own like tells nobody", async () => {
  const p = await post();
  await like(p.author, p.ws, p.id);
  assert.equal((await tray(p.owner)).length, 0, "own like");
  await sql`UPDATE workspace_updates SET audience = ${sql.json({ roles: ["admin"] })} WHERE id = ${p.id}`;
  await like(p.fan, p.ws, p.id);
  assert.equal((await tray(p.mate)).length, 0);
});

// The "Liked by" line was removed from cards on purpose (825be9ee2); the preview is the two comments.
test("a card's preview: the two newest comments, leaving out private and muted people", async () => {
  const p = await post();
  const { readUpdatePreviews } = await loadAppModule(() => import("../../src/lib/workspaces/update-previews"));
  await sql`UPDATE profiles SET full_name = 'Fan One', visibility = 'public' WHERE id = ${p.fan}`;
  await sql`UPDATE profiles SET full_name = 'Fan Two', visibility = 'private' WHERE id = ${p.fan2}`;
  await like(p.fan, p.ws, p.id);
  await like(p.fan2, p.ws, p.id);
  await comment(p.fan, p.ws, p.id);
  await comment(p.fan2, p.ws, p.id);
  await comment(p.mate, p.ws, p.id);
  await sql`INSERT INTO user_mutes (muter_id, muted_id) VALUES (${p.owner}, ${p.mate})`;
  const [seen] = [(await readUpdatePreviews([p.id], p.owner)).get(p.id)!];
  assert.deepEqual(seen.comments.map((c: { authorName: string }) => c.authorName), ["Private member", "Fan One"]);
  assert.equal(seen.comments[0]!.authorUsername, null);
  const signedOut = (await readUpdatePreviews([p.id], null)).get(p.id)!;
  assert.equal(signedOut.comments.length, 2);
});

test("Trending posts rank by recent activity from different people, comments counting most (UP12)", async () => {
  const quiet = await post();
  const liked = await post();
  const talked = await post();
  await like(quiet.fan, quiet.ws, quiet.id);
  await like(liked.fan, liked.ws, liked.id);
  await like(liked.fan2, liked.ws, liked.id);
  await comment(talked.fan, talked.ws, talked.id);
  // Talk from one person counts once.
  await comment(talked.fan, talked.ws, talked.id);
  const { getDiscoverUpdatesPage } = await loadAppModule(() => import("../../src/lib/data/discover-updates"));
  const page = await getDiscoverUpdatesPage({ view: "trending", viewerId: quiet.fan2, limit: 12 });
  const order = page.updates.map((u: { id: string }) => u.id).filter((id: string) => [quiet.id, liked.id, talked.id].includes(id));
  assert.deepEqual(order, [talked.id, liked.id, quiet.id]);
});

test("likes on a comment: a live count, one grouped row for the commenter, no browser access, none across a block (UP10)", async () => {
  const p = await post();
  const parent = await comment(p.mate, p.ws, p.id);
  await sql`DELETE FROM user_notifications WHERE user_id = ${p.mate}`;
  viewerId = p.fan;
  const first = await updates.toggleWorkspaceUpdateCommentLikeAction(p.ws, parent);
  assert.ok(first.success && first.liked && first.likeCount === 1, JSON.stringify(first));
  await settle();
  viewerId = p.fan2;
  await updates.toggleWorkspaceUpdateCommentLikeAction(p.ws, parent);
  await settle();
  const rows = await tray(p.mate);
  assert.equal(rows.length, 1);
  assert.match(rows[0]!.title, / and 1 other liked your comment$/);
  assert.equal(rows[0]!.importance, "more");
  const live = await sql`SELECT payload FROM realtime.messages WHERE topic = ${`updates:post:${p.id}`} AND event = 'comment.likes' ORDER BY inserted_at DESC LIMIT 1`;
  assert.equal((live[0]!.payload as { likes: number }).likes, 2);

  viewerId = p.owner;
  const seen = await updates.readWorkspaceUpdateCommentsAction(p.ws, p.id);
  assert.equal(seen.data!.comments[0]!.likeCount, 2);
  assert.equal(seen.data!.comments[0]!.likedByViewer, false);
  const likers = await updates.readProjectUpdateLikersAction(p.ws, p.id, { commentId: parent });
  assert.ok(likers.success && likers.likers.length === 2);

  // Own like: no notification.
  viewerId = p.mate;
  await updates.toggleWorkspaceUpdateCommentLikeAction(p.ws, parent);
  await settle();
  assert.equal((await tray(p.mate)).length, 1);
  assert.match((await tray(p.mate))[0]!.title, / and 1 other liked your comment$/);

  // Unlike comes out; a like loop never nags.
  viewerId = p.fan;
  await updates.toggleWorkspaceUpdateCommentLikeAction(p.ws, parent);
  await settle();
  assert.match((await tray(p.mate))[0]!.title, /[^r] liked your comment$/);

  await sql`INSERT INTO user_blocks (blocker_id, blocked_id) VALUES (${p.mate}, ${p.viewerRole})`.catch(() => undefined);
  viewerId = p.viewerRole;
  const blocked = await updates.toggleWorkspaceUpdateCommentLikeAction(p.ws, parent);
  assert.equal(blocked.success, false, "refused across a block");

  const [grant] = await sql`SELECT has_table_privilege('authenticated', 'workspace_update_comment_likes', 'SELECT') AS can`;
  assert.equal(grant!.can, false);
});

test("a post can be muted, and its author or an admin can close replies; strangers can't (UP8, UP13)", async () => {
  const p = await post();
  await sql`UPDATE profiles SET notification_preferences = ${sql.json({ mutedScopes: [{ kind: "update", value: p.id, label: "muted", mutedAt: null }] })} WHERE id = ${p.author}`;
  await like(p.fan, p.ws, p.id);
  assert.equal((await tray(p.author)).length, 0, "muted post");
  assert.equal((await tray(p.owner)).length, 1, "only for the person who muted it");

  viewerId = p.fan;
  assert.equal((await updates.setWorkspaceUpdateReplyPolicyAction(p.ws, p.id, "closed")).success, false);
  viewerId = p.author;
  assert.equal((await updates.setWorkspaceUpdateReplyPolicyAction(p.ws, p.id, "closed")).success, true);
  viewerId = p.fan;
  const refused = await updates.createWorkspaceUpdateCommentAction(p.ws, p.id, "still here?");
  assert.equal(refused.success, false);
});

test("comment limits: verified email, repeats, links, new-account rate, and restricted accounts (UP13)", async () => {
  const p = await post();
  const say = async (user: string, text: string) => { viewerId = user; return updates.createWorkspaceUpdateCommentAction(p.ws, p.id, text); };
  assert.ok((await say(p.fan, "first")).success);
  const repeat = await say(p.fan, "first");
  assert.ok(!repeat.success && /already posted/.test(repeat.error));
  const links = await say(p.fan, "see https://a.example and https://b.example");
  assert.ok(!links.success && /links/.test(links.error), "a new account gets one link");

  assert.ok((await say(p.fan, "second")).success);
  assert.ok((await say(p.fan, "third")).success);
  const fast = await say(p.fan, "fourth");
  assert.ok(!fast.success && /Too many/.test(fast.error), "three a minute for a new account");

  await sql`UPDATE profiles SET created_at = now() - interval '30 days' WHERE id = ${p.fan2}`;
  assert.ok((await say(p.fan2, "one https://a.example https://b.example")).success, "older accounts get more room");

  await sql`INSERT INTO moderation_actions (subject_id, target_kind, target_id, action, rule, message, notified_at) VALUES (${p.mate}, 'account', ${p.mate}, 'suspension', 1, 'test', now())`;
  const suspended = await say(p.mate, "hello");
  assert.ok(!suspended.success && /can’t comment/.test(suspended.error));
  viewerId = p.mate;
  assert.equal((await updates.toggleWorkspaceUpdateLikeAction(p.ws, p.id)).success, false, "a suspended account's like doesn't count");
});

test("a mention tells the person with push, once, and a stranger can't ping someone unconnected (UP4, UP6)", async () => {
  const p = await post();
  const handle = async (id: string) => (await sql`SELECT username FROM profiles WHERE id = ${id}`)[0]!.username as string;
  const [mate, author, stranger] = [await handle(p.mate), await handle(p.author), await handle(p.fan2)];
  viewerId = p.fan;
  const res = await updates.createWorkspaceUpdateCommentAction(p.ws, p.id, `hey @${mate} and @${author}, also @${stranger} and mail me@${mate}`);
  assert.ok(res.success);
  await settle();
  const mateRows = await tray(p.mate);
  assert.equal(mateRows.length, 1, "personal, so no team row for this event");
  assert.equal(mateRows[0]!.kind, "project_update_mention");
  assert.equal(mateRows[0]!.importance, "important");
  assert.match(mateRows[0]!.title, /mentioned you in a comment$/);
  const authorRows = await tray(p.author);
  assert.equal(authorRows.length, 1, "mentioned rather than told about a comment");
  assert.equal(authorRows[0]!.kind, "project_update_mention");
  assert.equal((await tray(p.fan2)).length, 0, "not on the team, not in the thread, not connected");
  assert.equal((await tray(p.owner))[0]!.kind, "project_update_team");

  // Once they've joined the thread they can be mentioned.
  await comment(p.fan2, p.ws, p.id);
  viewerId = p.fan;
  assert.ok((await updates.createWorkspaceUpdateCommentAction(p.ws, p.id, `over to you @${stranger}`)).success);
  await settle();
  assert.equal((await tray(p.fan2)).filter((r) => r.kind === "project_update_mention").length, 1);

  // Suggestions follow the same rule.
  const found = await updates.searchUpdateMentionsAction(p.ws, p.id, mate.slice(0, 5));
  assert.deepEqual(found.map((person) => person.id), [p.mate]);

  // A deleted comment takes its mention back.
  viewerId = p.fan;
  await updates.deleteWorkspaceUpdateCommentAction(p.ws, (res.data as { id: string }).id);
  await settle();
  assert.notEqual((await tray(p.mate))[0]!.dismissed_at, null);
});

test("a members-only post can only mention people who can open it", async () => {
  const p = await post();
  await sql`UPDATE workspace_updates SET visibility = 'members' WHERE id = ${p.id}`;
  await sql`INSERT INTO connections (requester_id, addressee_id, status) VALUES (${p.mate}, ${p.fan}, 'accepted')`;
  const fanName = (await sql`SELECT username FROM profiles WHERE id = ${p.fan}`)[0]!.username as string;
  viewerId = p.mate;
  assert.ok((await updates.createWorkspaceUpdateCommentAction(p.ws, p.id, `@${fanName} look`)).success);
  await settle();
  assert.equal((await tray(p.fan)).length, 0, "connected, but outside the team");
});

test("a private liker is never named: not by the row, not through its actor, and the count still holds", async () => {
  const p = await post();
  await sql`UPDATE profiles SET full_name = 'Secret Person', visibility = 'private' WHERE id = ${p.fan}`;
  await like(p.fan, p.ws, p.id);
  let [row] = await tray(p.author);
  assert.equal(row!.title, "Someone liked your update");
  assert.equal(row!.actor_user_id, null);
  await sql`UPDATE profiles SET full_name = 'Open Person', visibility = 'public' WHERE id = ${p.fan2}`;
  await like(p.fan2, p.ws, p.id);
  [row] = await tray(p.author);
  assert.equal(row!.title, "Open Person and 1 other liked your update");
  // Connected people may see each other, so here the name is fine.
  await sql`INSERT INTO connections (requester_id, addressee_id, status) VALUES (${p.owner}, ${p.fan}, 'accepted')`;
  const parent = await comment(p.owner, p.ws, p.id);
  viewerId = p.fan;
  await updates.toggleWorkspaceUpdateCommentLikeAction(p.ws, parent);
  await settle();
  assert.equal((await tray(p.owner)).find((r) => /your comment$/.test(r.title))!.title, "Secret Person liked your comment");
  const mateComment = await comment(p.mate, p.ws, p.id);
  viewerId = p.fan;
  await updates.toggleWorkspaceUpdateCommentLikeAction(p.ws, mateComment);
  await settle();
  assert.equal((await tray(p.mate)).find((r) => /your comment$/.test(r.title))!.title, "Someone liked your comment");
});

test("the author's team row counts replies only; their likes row already covers likes", async () => {
  const p = await post();
  await like(p.fan, p.ws, p.id);
  const parent = await comment(p.mate, p.ws, p.id);
  await comment(p.fan2, p.ws, p.id, parent);
  assert.match((await tray(p.author)).find((r) => r.kind === "project_update_team")!.title, /got 1 comment$/);
  assert.match((await tray(p.owner)).find((r) => r.kind === "project_update_team")!.title, /got 1 like and 2 comments$/);
});

test("the same words: fine on another post, not twice on one, not across many", async () => {
  const [a, b, c, d] = [await post(), await post(), await post(), await post()];
  await sql`UPDATE profiles SET created_at = now() - interval '30 days' WHERE id = ${a.fan}`;
  viewerId = a.fan;
  const say = (p: typeof a) => updates.createWorkspaceUpdateCommentAction(p.ws, p.id, "Nice work!");
  assert.ok((await say(a)).success);
  const again = await say(a);
  assert.ok(!again.success && /already posted/.test(again.error));
  assert.ok((await say(b)).success, "another post");
  assert.ok((await say(c)).success, "a third");
  const flood = await say(d);
  assert.ok(!flood.success && /several updates/.test(flood.error));
});

test("a deleted or hidden post or comment takes its notifications with it", async () => {
  const p = await post();
  await like(p.fan, p.ws, p.id);
  viewerId = p.author;
  const removed = await updates.deleteWorkspaceUpdateAction(p.ws, p.id);
  assert.ok(removed.success, JSON.stringify(removed));
  await settle();
  assert.notEqual((await tray(p.owner))[0]!.dismissed_at, null);
  assert.notEqual((await tray(p.author))[0]!.dismissed_at, null);

  const q = await post();
  const hiddenComment = await comment(q.fan, q.ws, q.id);
  const { setContentHidden } = await loadAppModule(() => import("../../src/lib/trust/targets"));
  await setContentHidden("update_comment", hiddenComment, null, true);
  assert.notEqual((await tray(q.author))[0]!.dismissed_at, null, "its text no longer sits in the tray");
});

test("changing who can reply is announced, with ids only", async () => {
  const p = await post();
  viewerId = p.author;
  assert.ok((await updates.setWorkspaceUpdateReplyPolicyAction(p.ws, p.id, "closed")).success);
  const rows = await sql`SELECT payload FROM realtime.messages WHERE topic = ${`updates:post:${p.id}`} AND event = 'update.changed'`;
  assert.equal(rows.length, 1);
  assert.deepEqual(Object.keys(rows[0]!.payload as object).sort(), ["id", "seq"]);
});
