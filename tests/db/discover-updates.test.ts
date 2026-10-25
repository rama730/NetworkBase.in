import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, moduleStubs, sql } from "./_helpers";

// Real database. Pins which project updates the Discover feed may show, and to whom: the same people who
// could open the update on the project page, never more.
moduleStubs.set("next/cache", { revalidatePath: () => undefined, revalidateTag: () => undefined, unstable_cache: (fn: unknown) => fn });

let feed: typeof import("@/lib/data/discover-updates");
const created: string[] = [];

before(async () => {
  (process.env as Record<string, string>).NODE_ENV = "test";
  feed = await loadAppModule(() => import("@/lib/data/discover-updates"));
});
afterEach(async () => {
  if (created.length) {
    await sql`DELETE FROM public.connections WHERE requester_id IN ${sql(created)} OR addressee_id IN ${sql(created)}`;
    await sql`DELETE FROM auth.users WHERE id IN ${sql(created)}`;
  }
  created.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

async function person(options: { visibility?: string; deleted?: boolean } = {}) {
  const id = await sql.begin((tx) => createUser(tx, { visibility: options.visibility }));
  if (options.deleted) await sql`UPDATE public.profiles SET deleted_at = now() WHERE id = ${id}`;
  created.push(id);
  return id;
}
const project = (owner: string, options: Parameters<typeof createProject>[2] = {}) => sql.begin((tx) => createProject(tx, owner, options));
async function post(projectId: string, authorId: string, content: string, extra: { visibility?: string; deleted?: boolean; at?: string; media?: unknown; metadata?: unknown } = {}) {
  const [row] = await sql`
    INSERT INTO public.project_updates (project_id, author_id, content, visibility, deleted_at, created_at, media, metadata)
    VALUES (${projectId}, ${authorId}, ${content}, ${extra.visibility ?? "public"}, ${extra.deleted ? new Date() : null},
            ${extra.at ? new Date(extra.at) : new Date()}, ${sql.json((extra.media ?? []) as never)}, ${sql.json((extra.metadata ?? {}) as never)})
    RETURNING id`;
  return row!.id as string;
}
const texts = async (viewerId: string | null, options: Record<string, unknown> = {}) =>
  (await feed.getDiscoverUpdatesPage({ viewerId, limit: 20, ...options })).updates.map((update) => update.content).sort();

test("only updates a stranger could open on the project page appear", async () => {
  const owner = await person();
  const stranger = await person();
  const open = await project(owner);
  await post(open, owner, "visible");
  await post(open, owner, "members only", { visibility: "members" });
  await post(open, owner, "deleted", { deleted: true });
  await post(await project(owner, { visibility: "private" }), owner, "private project");
  await post(await project(owner, { status: "draft" }), owner, "draft project");
  await post(await project(owner, { publicTabVisibility: { updates: false } }), owner, "hidden tab");
  await post(await project(owner, { visibility: "unlisted" }), owner, "unlisted project (cards show these too)");
  await post(await project(await person({ deleted: true })), owner, "deleted owner");

  assert.deepEqual(await texts(stranger), ["unlisted project (cards show these too)", "visible"]);
  assert.deepEqual(await texts(null), ["unlisted project (cards show these too)", "visible"]);
});

test("a project's own members still see its updates when the Updates tab is hidden from the public", async () => {
  const owner = await person();
  const member = await person();
  const outsider = await person();
  const hidden = await project(owner, { publicTabVisibility: { updates: false } });
  await sql.begin((tx) => addMember(tx, hidden, member));
  await post(hidden, owner, "team news");

  assert.deepEqual(await texts(outsider), []);
  assert.deepEqual(await texts(member), ["team news"]);
  assert.deepEqual(await texts(owner), ["team news"]);
});

test("a block hides the other person's updates, whichever way it points", async () => {
  const owner = await person();
  const viewer = await person();
  const blockedByViewer = await person();
  const blocksViewer = await person();
  // One project each: a page shows one update per project.
  await post(await project(owner), owner, "from owner");
  await post(await project(blockedByViewer), blockedByViewer, "from someone I blocked");
  await post(await project(blocksViewer), blocksViewer, "from someone who blocked me");
  await sql`INSERT INTO public.connections (requester_id, addressee_id, status, blocked_by, blocked_at) VALUES (${viewer}, ${blockedByViewer}, 'blocked', ${viewer}, now())`;
  await sql`INSERT INTO public.connections (requester_id, addressee_id, status, blocked_by, blocked_at) VALUES (${blocksViewer}, ${viewer}, 'blocked', ${blocksViewer}, now())`;

  assert.deepEqual(await texts(viewer), ["from owner"]);
  assert.deepEqual(await texts(null), ["from owner", "from someone I blocked", "from someone who blocked me"]);
});

test("a private author is masked: no name, photo, handle or role", async () => {
  const owner = await person();
  const hiddenAuthor = await person({ visibility: "private" });
  const open = await project(owner);
  await sql.begin((tx) => addMember(tx, open, hiddenAuthor));
  const id = await post(open, hiddenAuthor, "quiet news");

  const [update] = (await feed.getDiscoverUpdatesPage({ viewerId: await person(), limit: 5 })).updates;
  assert.equal(update!.id, id);
  assert.equal(update!.author?.masked, true);
  assert.equal(update!.author?.fullName, null);
  assert.equal(update!.author?.username, null);
  assert.equal(update!.author?.avatarUrl, null);
  assert.equal(update!.author?.roleLabel, null);

  const own = (await feed.getDiscoverUpdatesPage({ viewerId: hiddenAuthor, limit: 5 })).updates[0]!;
  assert.equal(own.author?.masked, false, "you can always see yourself");
});

test("the single read applies the same rules as the list", async () => {
  const owner = await person();
  const member = await person();
  const stranger = await person();
  const open = await project(owner);
  const priv = await project(owner, { visibility: "private" });
  const hiddenTab = await project(owner, { publicTabVisibility: { updates: false } });
  await sql.begin((tx) => addMember(tx, hiddenTab, member));
  const openId = await post(open, owner, "open");
  const privId = await post(priv, owner, "private");
  const hiddenId = await post(hiddenTab, owner, "hidden tab");
  const membersOnly = await post(open, owner, "members only", { visibility: "members" });

  assert.equal((await feed.getDiscoverUpdate(openId, null))?.content, "open");
  assert.equal(await feed.getDiscoverUpdate(privId, null), null, "a private project's update is not readable by id");
  assert.equal(await feed.getDiscoverUpdate(privId, stranger), null);
  assert.equal(await feed.getDiscoverUpdate(hiddenId, stranger), null);
  assert.equal((await feed.getDiscoverUpdate(hiddenId, member))?.content, "hidden tab");
  assert.equal(await feed.getDiscoverUpdate(membersOnly, stranger), null);
  assert.equal(await feed.getDiscoverUpdate(randomUUID(), null), null);
});

test("internal storage keys, raw metadata and linked work never reach the browser", async () => {
  const owner = await person();
  const open = await project(owner);
  await post(open, owner, "with image", {
    media: [{ type: "image", bucket: "project-updates-media", storageKey: `projects/${open}/update-media/a.png`, assetId: "asset-1", mimeType: "image/png", altText: "Chart", width: 800, height: 400 }],
    metadata: { authorRoleSnapshot: { displayRoleLabel: "Secret title" }, internal: "x" },
  });

  const [update] = (await feed.getDiscoverUpdatesPage({ viewerId: null, limit: 5 })).updates;
  const wire = JSON.stringify(update);
  for (const secret of ["\"bucket\"", "\"storageKey\"", "\"assetId\"", "asset-1", "authorRoleSnapshot", "internal", "entityRefs", "Secret title"]) {
    assert.ok(!wire.includes(secret), `${secret} must not be sent`);
  }
  assert.match(update!.media[0]!.url ?? "", /^\/api\/v1\/projects\/.+\/update-media\?/, "media goes through the authorized route");
  assert.equal(update!.media[0]!.altText, "Chart");
});

test("status, type and search filters follow the project cards", async () => {
  const owner = await person();
  const active = await project(owner, { status: "active" });
  const done = await project(owner, { status: "completed" });
  await post(active, owner, "alpha in progress");
  await post(done, owner, "beta shipped");

  const base = { status: "all", type: "all", tech: [], sort: "newest" } as const;
  assert.deepEqual(await texts(null, { filters: { ...base, status: "completed" } }), ["beta shipped"]);
  assert.deepEqual(await texts(null, { filters: { ...base, status: "active" } }), ["alpha in progress"]);
  assert.deepEqual(await texts(null, { filters: { ...base, search: "shipped" } }), ["beta shipped"], "search finds text that only an update contains");
  assert.deepEqual(await texts(null, { filters: { ...base, search: "%" } }), [], "a percent sign is a character, not a wildcard");
});

test("Following shows only followed projects, and nothing for a signed-out viewer", async () => {
  const owner = await person();
  const viewer = await person();
  const followed = await project(owner);
  const other = await project(owner);
  await post(followed, owner, "from followed");
  await post(other, owner, "from other");
  await sql`INSERT INTO public.project_follows (project_id, user_id) VALUES (${followed}, ${viewer})`;

  assert.deepEqual(await texts(viewer, { view: "following" }), ["from followed"]);
  assert.deepEqual(await texts(null, { view: "following" }), []);
});

test("pages follow a cursor without repeats, and one project fills one slot per page", async () => {
  // Five different teams, plus one busy team: authors differ so only the per-project rule is in play.
  const authors = await Promise.all([1, 2, 3, 4, 5, 6].map(() => person()));
  const projects = await Promise.all(authors.map((author) => project(author)));
  const base = Date.parse("2026-01-01T00:00:00Z");
  for (const [index, projectId] of projects.slice(0, 5).entries()) {
    await post(projectId, authors[index]!, `p${index}`, { at: new Date(base - index * 60_000).toISOString() });
  }
  const noisyOwner = authors[5]!;
  await post(projects[5]!, noisyOwner, "noisy newest", { at: new Date(base + 60_000).toISOString() });
  await post(projects[5]!, noisyOwner, "noisy older", { at: new Date(base + 30_000).toISOString() });

  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 6; page += 1) {
    const result: Awaited<ReturnType<typeof feed.getDiscoverUpdatesPage>> = await feed.getDiscoverUpdatesPage({ viewerId: null, limit: 3, cursor });
    seen.push(...result.updates.map((update) => update.content));
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  assert.equal(new Set(seen).size, seen.length, "no update twice");
  assert.deepEqual(seen.filter((text) => text.startsWith("p")), ["p0", "p1", "p2", "p3", "p4"], `newest first, nothing skipped (got ${JSON.stringify(seen)})`);
  assert.ok(seen.includes("noisy newest"));
  assert.ok(!seen.includes("noisy older"), "the same project does not take a second slot in one page");
});

test("one author takes at most two slots in a page", async () => {
  const author = await person();
  const projects = await Promise.all([1, 2, 3, 4].map(() => project(author)));
  for (const [index, projectId] of projects.entries()) await post(projectId, author, `a${index}`, { at: new Date(Date.parse("2026-01-01T00:00:00Z") - index * 1000).toISOString() });
  assert.deepEqual(await texts(null, { limit: 12 }), ["a0", "a1"]);
});

test("likedByViewer is the viewer's, and a bad cursor is refused", async () => {
  const owner = await person();
  const viewer = await person();
  const other = await person();
  const open = await project(owner);
  const id = await post(open, owner, "likeable");
  await sql`INSERT INTO public.project_update_likes (update_id, user_id) VALUES (${id}, ${viewer})`;

  assert.equal((await feed.getDiscoverUpdatesPage({ viewerId: viewer, limit: 5 })).updates[0]!.likedByViewer, true);
  assert.equal((await feed.getDiscoverUpdatesPage({ viewerId: other, limit: 5 })).updates[0]!.likedByViewer, false);
  assert.equal((await feed.getDiscoverUpdatesPage({ viewerId: null, limit: 5 })).updates[0]!.likedByViewer, false);
  await assert.rejects(feed.getDiscoverUpdatesPage({ viewerId: null, limit: 5, cursor: "not-a-cursor" }), /cursor/i);
});

test("an owner is labelled Lead, a co-leader Co-leader, and a plain member gets no label", async () => {
  const owner = await person();
  const admin = await person();
  const member = await person();
  const [teamProject, adminProject, memberProject] = await Promise.all([project(owner), project(await person()), project(await person())]);
  await sql.begin(async (tx) => { await addMember(tx, adminProject, admin, "admin"); await addMember(tx, memberProject, member); });
  await post(teamProject, owner, "owner post");
  await post(adminProject, admin, "admin post");
  await post(memberProject, member, "member post");
  const byText = Object.fromEntries((await feed.getDiscoverUpdatesPage({ viewerId: null, limit: 12 })).updates.map((update) => [update.content, update.author?.roleLabel]));
  assert.equal(byText["owner post"], "Lead");
  assert.equal(byText["admin post"], "Co-leader");
  assert.equal(byText["member post"], null);
});
