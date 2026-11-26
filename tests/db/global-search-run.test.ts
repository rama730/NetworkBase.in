import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, test } from "node:test";

import { addMember, closeAppDb, createProject, createUser, loadAppModule, sql } from "./_helpers";

// Global search mix §3–§6: one search, everything that matches, one rule for what is never shown.
let run: typeof import("../../src/lib/search/global/run");
before(async () => {
  run = await loadAppModule(() => import("../../src/lib/search/global/run"));
});
// Rows are committed (the app reads on its own connection), so each test's people and places are removed after it.
const created: string[] = [];
afterEach(async () => {
  if (!created.length) return;
  await sql`DELETE FROM chat_channels WHERE created_by IN ${sql(created)}`;
  await sql`DELETE FROM workspaces WHERE owner_id IN ${sql(created)}`;
  await sql`DELETE FROM connections WHERE requester_id IN ${sql(created)} OR addressee_id IN ${sql(created)}`;
  await sql`DELETE FROM auth.users WHERE id IN ${sql(created)}`;
  created.length = 0;
});
after(async () => { await sql.end(); await closeAppDb(); });

const letters = () => Array.from({ length: 7 }, () => "bcdfghjklmnpqrstvwxz"[Math.floor(Math.random() * 20)]).join("");
const done = (id: string, name: string, extra: Record<string, unknown> = {}) =>
  sql`UPDATE profiles SET ${sql({ onboarding_status: "completed", full_name: name, headline: "Frontend developer", location: "Chennai", ...extra })} WHERE id = ${id}`;
const named = async (id: string, title: string, values: Record<string, unknown> = {}) => {
  await sql`UPDATE workspaces SET ${sql({ title, description: `${title} for everyone`, ...values })} WHERE id = ${id}`;
};

async function world() {
  const t = `zq${letters()}`;
  const viewer = await createUser(sql);
  const owner = await createUser(sql);
  const person = await createUser(sql);
  const hidden = await createUser(sql);
  created.push(viewer, owner, person, hidden);
  await done(viewer, "Viewer Person");
  await done(owner, "Owner Person");
  await done(person, `${t} Rao`);
  await done(hidden, `${t} Hidden`, { search_visibility: "connections" });

  const org = await createProject(sql, owner);
  await named(org, `${t} Hyderabad`, { kind: "organization", org_type: "community" });
  const child = await createProject(sql, owner);
  await named(child, "Child space", { parent_id: org });
  const space = await createProject(sql, owner);
  await named(space, `${t} component kit`, { looking_for_collaborators: true, open_roles_count: 2 });
  const unlisted = await createProject(sql, owner, { visibility: "unlisted" });
  await named(unlisted, `${t} unlisted`);
  const closed = await createProject(sql, owner, { visibility: "private" });
  await named(closed, `${t} closed`);
  const mine = await createProject(sql, owner, { visibility: "private" });
  await named(mine, `${t} mine`);
  await addMember(sql, mine, viewer);
  await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${space}, ${owner}, ${`Shipped the ${t} picker today`})`;

  const [ours] = await sql`INSERT INTO chat_channels (kind, name, created_by) VALUES ('private', 'ours', ${owner}) RETURNING id`;
  await sql`INSERT INTO chat_channel_members (channel_id, user_id) VALUES (${ours!.id}, ${owner}), (${ours!.id}, ${viewer})`;
  await sql`INSERT INTO chat_messages (channel_id, channel_seq, author_id, body) VALUES (${ours!.id}, 1, ${owner}, ${`use ${t} here`})`;
  const [theirs] = await sql`INSERT INTO chat_channels (kind, name, created_by) VALUES ('private', 'theirs', ${owner}) RETURNING id`;
  await sql`INSERT INTO chat_channel_members (channel_id, user_id) VALUES (${theirs!.id}, ${owner})`;
  await sql`INSERT INTO chat_messages (channel_id, channel_seq, author_id, body) VALUES (${theirs!.id}, 1, ${owner}, ${`not for you ${t}`})`;
  return { t, viewer, owner, person, hidden, org, space, unlisted, closed, mine };
}

const titles = (hits: { title: string }[] | undefined) => (hits ?? []).map((hit) => hit.title).sort();

test("one search finds orgs, workspaces, posts, people and your messages — and nothing it shouldn't", async () => {
  const w = await world();
  const result = await run.runGlobalSearch({ viewerId: w.viewer, q: w.t, ctx: "discover", place: null, scope: null, perKind: 10 });
  assert.deepEqual(titles(result.groups.orgs), [`${w.t} Hyderabad`]);
  assert.deepEqual(titles(result.groups.workspaces), [`${w.t} component kit`, `${w.t} mine`]);
  assert.equal(result.groups.posts?.length, 1);
  assert.match(result.groups.posts![0]!.sub, /picker/);
  assert.deepEqual(titles(result.groups.people), [`${w.t} Rao`]);
  assert.equal(result.groups.messages?.length, 1);
  assert.equal(result.groups.messages![0]!.meta.channelName, "ours");
  assert.equal(result.counts.workspaces, 2);
  const kit = result.groups.workspaces!.find((hit) => hit.title.endsWith("kit"))!;
  assert.equal(kit.meta.openRoles, 2);
  assert.equal(kit.meta.openToCollaborate, true);
  assert.equal(kit.meta.isNew, true);
  assert.equal(result.fixedFrom, null);
});

test("perKind slices the rows, counts keep the whole match", async () => {
  const w = await world();
  const result = await run.runGlobalSearch({ viewerId: w.viewer, q: w.t, ctx: "discover", place: null, scope: null, perKind: 1 });
  assert.equal(result.groups.workspaces?.length, 1);
  assert.equal(result.counts.workspaces, 2);
});

test("@ searches people only", async () => {
  const w = await world();
  const result = await run.runGlobalSearch({ viewerId: w.viewer, q: w.t, ctx: "discover", place: null, scope: { kind: "people" }, perKind: 10 });
  assert.deepEqual(Object.keys(result.groups).filter((k) => result.groups[k as "people"]?.length), ["people"]);
});

test("a typo still finds it, and says what it searched", async () => {
  const w = await world();
  const typo = w.t.slice(0, -1) + (w.t.endsWith("q") ? "x" : "q");
  const result = await run.runGlobalSearch({ viewerId: w.viewer, q: `${typo} hyderabad`, ctx: "discover", place: null, scope: null, perKind: 10 });
  assert.equal(result.fixedFrom, `${typo} hyderabad`);
  assert.equal(result.q.toLowerCase(), `${w.t} hyderabad`);
  assert.deepEqual(titles(result.groups.orgs), [`${w.t} Hyderabad`]);
  const exact = await run.runGlobalSearch({ viewerId: w.viewer, q: `${typo} hyderabad`, ctx: "discover", place: null, scope: null, perKind: 10, exact: true });
  assert.equal(exact.fixedFrom, null);
});

test("a skill card counts people, workspaces and orgs", async () => {
  const w = await world();
  const skill = `Skill${letters()}`;
  const [row] = await sql`INSERT INTO skills (name, slug, canonical_key) VALUES (${skill}, ${skill.toLowerCase()}, ${skill.toLowerCase()}) RETURNING id`;
  await sql`INSERT INTO workspace_skills (workspace_id, skill_id) VALUES (${w.space}, ${row!.id}), (${w.org}, ${row!.id})`;
  await sql`UPDATE profiles SET skills = ${sql.json([skill])} WHERE id = ${w.person}`;
  const result = await run.runGlobalSearch({ viewerId: w.viewer, q: skill.toLowerCase(), ctx: "discover", place: null, scope: null, perKind: 10 });
  assert.deepEqual(result.skill, { name: skill, people: 1, workspaces: 1, orgs: 1 });
  assert.equal(result.groups.workspaces?.[0]?.why, `Skill · ${skill}`);
  await sql`DELETE FROM skills WHERE id = ${row!.id}`;
});

test("email lookup never reveals whether an account exists", async () => {
  const w = await world();
  const [hiddenRow] = await sql`SELECT email FROM profiles WHERE id = ${w.hidden}`;
  const hiddenEmail = hiddenRow!.email as string;
  const none = await run.runGlobalSearch({ viewerId: w.viewer, q: `nobody-${letters()}@example.org`, ctx: "discover", place: null, scope: null, perKind: 3 });
  const hidden = await run.runGlobalSearch({ viewerId: w.viewer, q: hiddenEmail, ctx: "discover", place: null, scope: null, perKind: 3 });
  assert.deepEqual(hidden.email, { kind: "invite", address: hiddenEmail });
  assert.equal(none.email?.kind, "invite");
  // Allowed: the person turned find-by-email on.
  const [personRow] = await sql`UPDATE profiles SET findable_by_email = true WHERE id = ${w.person} RETURNING email`;
  const found = await run.runGlobalSearch({ viewerId: w.viewer, q: personRow!.email as string, ctx: "discover", place: null, scope: null, perKind: 3 });
  assert.equal(found.email?.kind, "person");
});

test("suggestions finish the word from skills and org names", async () => {
  const w = await world();
  const result = await run.runGlobalSearch({ viewerId: w.viewer, q: w.t.slice(0, 5), ctx: "discover", place: null, scope: null, perKind: 3 });
  assert.ok(result.suggestions.includes(`${w.t} hyderabad`), JSON.stringify(result.suggestions));
  assert.ok(result.suggestions.length <= 3);
});

test("relationship lines: connection, shared workspace", async () => {
  const w = await world();
  await sql`INSERT INTO connections (requester_id, addressee_id, status) VALUES (${w.viewer}, ${w.person}, 'accepted')`;
  const result = await run.runGlobalSearch({ viewerId: w.viewer, q: w.t, ctx: "network", place: null, scope: null, perKind: 10 });
  const rao = result.groups.people!.find((hit) => hit.title.endsWith("Rao"))!;
  assert.equal(rao.meta.relKey, "conn");
  assert.equal(rao.meta.relation, "Your connection");
  assert.equal(rao.act, "Message");
  void randomUUID;
});

// Phase 1 review, Important 3: the exact name ranks first even when 25 better-followed rows also match.
test("an exact name outranks better-followed matches", async () => {
  const w = await world();
  for (let i = 0; i < 25; i += 1) {
    const id = await createProject(sql, w.owner);
    await sql`UPDATE workspaces SET title = ${`Other ${i}`}, description = ${`works with ${w.t}x tools`}, followers_count = 100 WHERE id = ${id}`;
  }
  const exact = await createProject(sql, w.owner);
  await sql`UPDATE workspaces SET title = ${`${w.t}x`}, followers_count = 0 WHERE id = ${exact}`;
  const result = await run.runGlobalSearch({ viewerId: w.viewer, q: `${w.t}x`, ctx: "discover", place: null, scope: null, perKind: 3 });
  assert.equal(result.groups.workspaces?.[0]?.title, `${w.t}x`);
  assert.equal(result.groups.workspaces?.[0]?.score, 0);
});

// Phase 1 review, Important 4: one letter doesn't run the heavy kinds.
test("one letter searches nothing heavy", async () => {
  const w = await world();
  const result = await run.runGlobalSearch({ viewerId: w.viewer, q: "z", ctx: "discover", place: null, scope: null, perKind: 3 });
  assert.deepEqual(Object.values(result.counts).filter(Boolean), []);
  assert.equal(result.skill, null);
});

// Phase 1 review, Important 2: an email address is never logged, and popular searches come only from people near you.
test("email searches are never logged; suggestions from searches come from people near you", async () => {
  const w = await world();
  const extras = await loadAppModule(() => import("../../src/lib/search/global/extras"));
  await extras.logSearch(w.viewer, "someone@example.org");
  assert.equal((await sql`SELECT count(*)::int AS n FROM search_query_log WHERE user_id = ${w.viewer}`)[0]!.n, 0);
  const phrase = `${w.t}wide`;
  const strangers = [await createUser(sql), await createUser(sql), await createUser(sql)];
  created.push(...strangers);
  for (const id of strangers) await extras.logSearch(id, phrase);
  assert.ok(!(await extras.suggestions(phrase.slice(0, 6), w.viewer)).includes(phrase));
  for (const id of strangers) await addMember(sql, w.mine, id);
  assert.ok((await extras.suggestions(phrase.slice(0, 6), w.viewer)).includes(phrase));
});

// Phase 1 review, minor 6 regraded: the skill card counts only people this viewer could find.
test("the skill card counts only people you could find", async () => {
  const w = await world();
  const skill = `Skill${letters()}`;
  const [row] = await sql`INSERT INTO skills (name, slug, canonical_key) VALUES (${skill}, ${skill.toLowerCase()}, ${skill.toLowerCase()}) RETURNING id`;
  await sql`UPDATE profiles SET skills = ${sql.json([skill])} WHERE id IN ${sql([w.person, w.hidden])}`;
  const result = await run.runGlobalSearch({ viewerId: w.viewer, q: skill, ctx: "discover", place: null, scope: null, perKind: 3 });
  assert.equal(result.skill?.people, 1);
  await sql`DELETE FROM skills WHERE id = ${row!.id}`;
});

// Phase 1 review, minor 7 regraded: a typo in one word of a long name is still corrected.
test("a typo in a long organization name is corrected", async () => {
  const w = await world();
  const org = await createProject(sql, w.owner);
  const word = `qz${letters()}`;
  await named(org, `${word} Hyderabad Developers Community`, { kind: "organization", org_type: "community" });
  const child = await createProject(sql, w.owner);
  await named(child, "Another child", { parent_id: org });
  const typo = word.slice(0, -1) + (word.endsWith("q") ? "x" : "q");
  const result = await run.runGlobalSearch({ viewerId: w.viewer, q: typo, ctx: "discover", place: null, scope: null, perKind: 3 });
  assert.equal(result.fixedFrom, typo);
  assert.equal(result.groups.orgs?.[0]?.title, `${word} Hyderabad Developers Community`);
});

// Live check 2026-11-27: ARRAY(...) columns arrive as "{a,b}" strings on production's connection; tags and mutual names
// must be lists (the preview pane crashed on tags.map). Arrays go through to_jsonb, which every connection parses.
test("tags and mutual names are lists, read through to_jsonb", async () => {
  const w = await world();
  const source = (await import("node:fs")).readFileSync("src/lib/search/global/kinds.ts", "utf8");
  assert.doesNotMatch(source, /(?<!to_jsonb\()ARRAY\(SELECT/);
  const result = await run.runGlobalSearch({ viewerId: w.viewer, q: w.t, ctx: "discover", place: null, scope: null, perKind: 10 });
  for (const hit of [...(result.groups.workspaces ?? []), ...(result.groups.people ?? [])]) assert.ok(Array.isArray(hit.tags), hit.title);
});

// Live check 2026-11-27: a post's embedded task or file reference showed as raw {% … %} text.
test("post previews are plain text, without embed codes", async () => {
  const w = await world();
  await sql`INSERT INTO workspace_updates (workspace_id, author_id, content) VALUES (${w.space}, ${w.owner}, ${`Linked {% ref.tasks id="9fbd" label="Task one" %} for ${w.t}x`})`;
  const result = await run.runGlobalSearch({ viewerId: w.viewer, q: `${w.t}x`, ctx: "discover", place: null, scope: null, perKind: 10 });
  const post = result.groups.posts!.find((hit) => hit.sub.includes(`${w.t}x`))!;
  assert.doesNotMatch(post.sub, /\{%|%\}/);
});
