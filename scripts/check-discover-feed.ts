/**
 * Runs the Discover feed queries against a disposable database with the real SQL: privacy (masked
 * owners, members-only links, private/deleted members, blocks), cursors (no repeats or gaps on any
 * sort), the skills filter, and the People rail's request. Redis and sign-in are stubbed out.
 *   DATABASE_URL_FRESH=$(npm run -s db:disposable) npm run check:discover
 */
import { randomUUID } from "node:crypto";
import Module from "node:module";

import dotenv from "dotenv";

import { requireDisposableDatabaseUrl } from "./lib/disposable-db";

dotenv.config({ path: ".env.local" });
const disposableUrl = requireDisposableDatabaseUrl("check:discover");
process.env.DATABASE_URL = disposableUrl;

type Loader = (request: string, parent: unknown, isMain: boolean) => unknown;
const moduleWithLoad = Module as unknown as { _load: Loader };
const originalLoad = moduleWithLoad._load;
let currentUser: { id: string; user_metadata: Record<string, unknown> } | null = null;
moduleWithLoad._load = function load(request, parent, isMain) {
  if (request === "server-only") return {};
  if (request.endsWith("supabase/auth-user")) return { getAuthUser: async () => currentUser };
  if (request === "next/server") return { after: () => undefined };
  if (request.endsWith("lib/redis")) {
    return {
      redis: null,
      getRedisClient: () => null,
      getCacheEnvelope: async () => null,
      cacheStaleableData: async () => undefined,
      isCacheStale: () => true,
      getCachedData: async () => null,
      cacheData: async () => undefined,
    };
  }
  return originalLoad.call(this, request, parent, isMain);
};

const failures: string[] = [];
let passed = 0;
async function check(label: string, run: () => Promise<boolean>) {
  try {
    if (await run()) passed += 1;
    else failures.push(label);
  } catch (error) {
    failures.push(`${label} (threw: ${(error as Error).message})`);
  }
}

async function main() {
  const postgres = (await import("postgres")).default;
  const sql = postgres(disposableUrl!, { max: 4, prepare: false, onnotice: () => undefined });
  const feed = await import("@/lib/projects/public-feed-service");
  const { decodePublicProjectsCursor } = await import("@/lib/projects/public-feed");
  const data = await import("@/lib/data/discover");
  const connectionsActions = await import("@/app/actions/connections");
  const { DISCOVER_RAIL_FILTERS } = await import("@/lib/discover/query");

  const [viewer, owner, privateOwner, deletedOwner, blockedOwner, privateMember, publicMember, blocker] =
    [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
  const profileRows = [
    [viewer, "Vera Viewer", "public"],
    [owner, "Olga Owner", "public"],
    [privateOwner, "Petra Private", "private"],
    [deletedOwner, "Dan Deleted", "public"],
    [blockedOwner, "Bert Blocked", "public"],
    [privateMember, "Mia Private", "private"],
    [publicMember, "Quinn Public", "public"],
    // Blocks the viewer (the other direction from blockedOwner).
    [blocker, "Bea Blocker", "public"],
  ] as const;
  // Every seeded project shares one tag in its title, so checks can ignore other rows in the database.
  const run = randomUUID().slice(0, 8);
  const ids = {
    open: randomUUID(), privateOwned: randomUUID(), deletedOwned: randomUUID(), blockedOwned: randomUUID(),
    draft: randomUUID(), cLang: randomUUID(), javascript: randomUUID(),
    blockerOwned: randomUUID(), privateProject: randomUUID(),
  };
  // Twelve projects inside one millisecond: a millisecond cursor would skip or repeat some of them.
  const sameMillisecond = Array.from({ length: 12 }, () => randomUUID());
  const seeded = new Set<string>([...Object.values(ids), ...sameMillisecond]);
  const skillIds = { c: randomUUID(), javascript: randomUUID(), java: randomUUID() };

  try {
    for (const [id, name, visibility] of profileRows) {
      await sql`INSERT INTO auth.users (id, email) VALUES (${id}, ${`${id}@example.test`})`;
      await sql`INSERT INTO profiles (id, email, username, full_name, visibility, onboarding_status)
        VALUES (${id}, ${`${id}@example.test`}, ${`u${id.replace(/-/g, "").slice(0, 12)}`}, ${name}, ${visibility}, 'completed')`;
    }
    await sql`UPDATE profiles SET deleted_at = now() WHERE id = ${deletedOwner}`;
    await sql`INSERT INTO connections (requester_id, addressee_id, status, blocked_by, blocked_at) VALUES (${viewer}, ${blockedOwner}, 'blocked', ${viewer}, now())`;
    await sql`INSERT INTO connections (requester_id, addressee_id, status, blocked_by, blocked_at) VALUES (${blocker}, ${viewer}, 'blocked', ${blocker}, now())`;

    const links = JSON.stringify([
      { id: "pub", platform: "website", url: "https://public.example.test", audience: "public" },
      { id: "mem", platform: "website", url: "https://members.example.test", audience: "members" },
    ]);
    const project = (id: string, ownerId: string, title: string, extra: { status?: string; createdAt?: string; views?: number; visibility?: string } = {}) => sql`
      INSERT INTO projects (id, owner_id, title, status, visibility, external_links, view_count, created_at, updated_at)
      VALUES (${id}, ${ownerId}, ${`${run} ${title}`}, ${extra.status ?? "active"}, ${extra.visibility ?? "public"}, ${links}::jsonb,
              ${extra.views ?? 0}, ${extra.createdAt ?? new Date().toISOString()}::timestamptz, now())`;
    await project(ids.open, owner, "Open", { views: 50 });
    await project(ids.privateOwned, privateOwner, "Private owner", { views: 40 });
    await project(ids.deletedOwned, deletedOwner, "Deleted owner", { views: 30 });
    await project(ids.blockedOwned, blockedOwner, "Blocked owner", { views: 20 });
    await project(ids.draft, owner, "Draft", { status: "draft" });
    await project(ids.cLang, owner, "C project", { views: 10 });
    await project(ids.javascript, owner, "JavaScript project", { views: 10 });
    await project(ids.blockerOwned, blocker, "Blocker owner", { views: 15 });
    await project(ids.privateProject, owner, "Private project", { views: 60, visibility: "private" });
    await sql`UPDATE projects SET cover_image = 'https://cdn.example.test/open.png' WHERE id = ${ids.open}`;
    for (const [index, id] of sameMillisecond.entries()) {
      // .123000 to .123011: one millisecond, twelve microseconds. Equal view counts tie the score sorts too.
      await project(id, owner, `Tie ${index}`, { createdAt: `2020-01-01T00:00:00.${String(123000 + index).padStart(6, "0")}Z`, views: 5 });
    }
    await sql`INSERT INTO project_members (project_id, user_id, role) VALUES
      (${ids.open}, ${owner}, 'owner'), (${ids.open}, ${privateMember}, 'member'), (${ids.open}, ${publicMember}, 'member')`;
    await sql`INSERT INTO skills (id, name, slug, canonical_key) VALUES
      (${skillIds.c}, ${`C${run}`}, ${`c-${run}`}, ${`lang.c${run}`}),
      (${skillIds.javascript}, ${`JavaScript${run}`}, ${`javascript-${run}`}, ${`lang.javascript${run}`}),
      (${skillIds.java}, ${`Java${run}`}, ${`java-${run}`}, ${`lang.java${run}`})`;
    await sql`INSERT INTO project_skills (project_id, skill_id) VALUES (${ids.cLang}, ${skillIds.c}), (${ids.javascript}, ${skillIds.javascript})`;
    // Four seats, one filled: the card counts three open, and the team size comes from SQL, not a member list.
    await sql`INSERT INTO project_open_roles (project_id, role, count, filled) VALUES (${ids.open}, 'Designer', 4, 1), (${ids.open}, 'Writer', 2, 2)`;

    // ---- Shared (public) feed: one payload for everyone, shaped for a signed-out viewer.
    const fullPublic = await feed.queryAndCachePublicProjectsFeed(100, null);
    const mine = (items: Array<{ id: string }>) => items.filter((item) => seeded.has(item.id));
    const byId = new Map(fullPublic.projects.map((item) => [item.id, item]));

    await check("public feed masks a private owner on the server", async () => {
      const item = byId.get(ids.privateOwned);
      return Boolean(item) && item!.profiles.username === null && item!.profiles.full_name === null && item!.profiles.avatar_url === null;
    });
    await check("public feed keeps a public owner's name", async () => byId.get(ids.open)?.profiles.full_name === "Olga Owner");
    await check("public feed never sends members-only links", async () => {
      const urls = JSON.stringify(byId.get(ids.open)?.external_links ?? []);
      return urls.includes("public.example.test") && !urls.includes("members.example.test");
    });
    await check("public feed lists only public collaborators", async () => {
      const members = byId.get(ids.open)?.collaborators.map((member) => member.user_id) ?? [];
      return members.includes(publicMember) && !members.includes(privateMember);
    });
    await check("public feed drops deleted accounts' projects and drafts", async () => !byId.has(ids.deletedOwned) && !byId.has(ids.draft));
    await check("a viewer never gets a project of someone they blocked", async () => {
      const visible = await feed.forViewer(fullPublic.projects, viewer);
      return !visible.some((item) => item.id === ids.blockedOwned) && visible.some((item) => item.id === ids.open);
    });

    await check("public feed pages: no repeats, no gaps inside one millisecond", async () => {
      const seen: string[] = [];
      let cursor = null as ReturnType<typeof decodePublicProjectsCursor>;
      for (let page = 0; page < 200; page += 1) {
        const result = await feed.queryAndCachePublicProjectsFeed(3, cursor);
        seen.push(...result.projects.map((item) => item.id));
        if (!result.nextCursor) break;
        cursor = decodePublicProjectsCursor(result.nextCursor);
      }
      const expected = mine(fullPublic.projects).map((item) => item.id);
      const got = seen.filter((id) => seeded.has(id));
      return new Set(seen).size === seen.length && JSON.stringify(got) === JSON.stringify(expected);
    });
    await check("a forged public cursor is refused", async () =>
      decodePublicProjectsCursor(Buffer.from(JSON.stringify({ createdAt: "x", id: "1" })).toString("base64url")) === null);

    // ---- Filtered and ranked feeds (server action path).
    const base = { status: "all", type: "all", tech: [] as string[], sort: "newest", search: undefined as string | undefined };
    const everything = async (filters: typeof base, view: "all" | "trending" | "recommendations", viewerId: string | null) => {
      const result = await data.getDiscoverProjects(filters, undefined, 60, { view, viewerId });
      return result.projects;
    };
    const paged = async (filters: typeof base, view: "all" | "trending" | "recommendations", viewerId: string | null) => {
      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 200; page += 1) {
        const result = await data.getDiscoverProjects(filters, cursor, 4, { view, viewerId });
        seen.push(...result.projects.map((item) => item.id));
        if (!result.nextCursor) break;
        cursor = result.nextCursor;
      }
      return seen;
    };

    for (const sort of ["newest", "oldest", "most_viewed", "most_followed"]) {
      await check(`"${sort}" pages: no repeats, no gaps`, async () => {
        const filters = { ...base, sort };
        const all = (await everything(filters, "all", viewer)).map((item) => item.id).filter((id) => seeded.has(id));
        const seen = await paged(filters, "all", viewer);
        return all.length > 0 && new Set(seen).size === seen.length && JSON.stringify(seen.filter((id) => seeded.has(id))) === JSON.stringify(all);
      });
    }
    for (const view of ["trending", "recommendations"] as const) {
      await check(`${view} loads page 2 and beyond without a cursor error`, async () => {
        const seen = await paged(base, view, viewer);
        return new Set(seen).size === seen.length && sameMillisecond.every((id) => seen.includes(id));
      });
    }

    await check("filtered feed hides blocked and deleted owners", async () => {
      const visible = new Set((await everything(base, "all", viewer)).map((item) => item.id));
      return visible.has(ids.open) && !visible.has(ids.blockedOwned) && !visible.has(ids.deletedOwned);
    });
    await check("filtered feed masks a private owner and hides private collaborators", async () => {
      const items = await everything(base, "all", viewer);
      const masked = items.find((item) => item.id === ids.privateOwned)?.owner;
      const members = items.find((item) => item.id === ids.open)?.collaborators?.map((member) => member.userId) ?? [];
      return Boolean(masked?.isMasked) && members.includes(publicMember) && !members.includes(privateMember);
    });
    await check("the skills filter matches a skill, not a substring (Java isn't JavaScript)", async () => {
      const java = (await everything({ ...base, tech: [`Java${run}`] }, "all", viewer)).map((item) => item.id);
      const js = (await everything({ ...base, tech: [`JavaScript${run}`] }, "all", viewer)).map((item) => item.id);
      return !java.includes(ids.javascript) && js.includes(ids.javascript);
    });
    await check("the skills filter keeps one-letter skills (C)", async () =>
      (await everything({ ...base, tech: [`C${run}`] }, "all", viewer)).some((item) => item.id === ids.cLang));
    // ---- People rail: the exact request the page and the rail send.
    await check("the People rail request is accepted and lists only open profiles", async () => {
      currentUser = { id: viewer, user_metadata: {} };
      const result = await connectionsActions.getConnectionsFeed({ tab: "discover", limit: 3, includeMeta: false, filters: DISCOVER_RAIL_FILTERS });
      currentUser = null;
      if (!result.success) return false;
      const ids = result.items.map((item) => item.id);
      // Private and blocked people never fill a slot; the deleted account is gone.
      return !ids.includes(privateOwner) && !ids.includes(privateMember) && !ids.includes(blockedOwner) && !ids.includes(deletedOwner);
    });

    // ---- Round 2.
    await check("cards get open seats and visible team size as counts, not every role", async () => {
      const shared = byId.get(ids.open);
      const filtered = (await everything(base, "all", viewer)).find((project) => project.id === ids.open);
      // Team size counts only members a stranger may see (the private one is not counted), in both feeds.
      return shared?.open_seats === 3 && shared?.team_size === 2 && shared?.open_roles.length === 0
        && filtered?.openRolesCount === 3 && filtered?.collaboratorsCount === 2 && (filtered?.openRoles?.length ?? 0) === 0;
    });
    await check("public feed hides a masked creator's id (no linking their projects)", async () => {
      const item = (await feed.forViewer(fullPublic.projects, null)).find((project) => project.id === ids.privateOwned);
      return Boolean(item) && item!.owner_id === "" && item!.profiles.id === "";
    });
    await check("filtered feed hides a masked creator's id", async () => {
      const item = (await everything(base, "all", viewer)).find((project) => project.id === ids.privateOwned);
      return Boolean(item) && item!.ownerId === "" && item!.owner?.id === "";
    });
    await check("someone who blocked the viewer is hidden in both feeds", async () => {
      const shared = await feed.forViewer(fullPublic.projects, viewer);
      const filtered = (await everything(base, "all", viewer)).map((project) => project.id);
      return !shared.some((project) => project.id === ids.blockerOwned) && !filtered.includes(ids.blockerOwned)
        && fullPublic.projects.some((project) => project.id === ids.blockerOwned);
    });
    await check("a private project is in neither feed", async () =>
      !byId.has(ids.privateProject) && !(await everything(base, "all", viewer)).some((project) => project.id === ids.privateProject));
    await check("the search preview keeps a project's stage and cover", async () => {
      const result = await data.getDiscoverProjects({ ...base, search: `${run} Open` }, undefined, 8, { view: "all", viewerId: viewer, surface: "preview" });
      const item = result.projects.find((project) => project.id === ids.open);
      return item?.status === "active" && item.coverImage === "https://cdn.example.test/open.png";
    });
    await check("a ranked cursor from the far future is a cursor error", async () => {
      const first = await data.getDiscoverProjects(base, undefined, 4, { view: "trending", viewerId: viewer });
      const parts = (first.nextCursor ?? "").split("|");
      if (parts.length < 3) return false;
      parts[1] = "1e20";
      try {
        await data.getDiscoverProjects(base, parts.join("|"), 4, { view: "trending", viewerId: viewer });
        return false;
      } catch (error) {
        return error instanceof data.InvalidDiscoverCursorError;
      }
    });
    await check("a ranked list keeps going when the project at its cursor left the feed", async () => {
      const first = await data.getDiscoverProjects(base, undefined, 4, { view: "trending", viewerId: viewer });
      const lastId = first.projects.at(-1)?.id;
      if (!first.nextCursor || !lastId || !seeded.has(lastId)) return false;
      await sql`UPDATE projects SET visibility = 'private' WHERE id = ${lastId}`;
      try {
        const next = await data.getDiscoverProjects(base, first.nextCursor, 4, { view: "trending", viewerId: viewer });
        return next.projects.length > 0 && !next.projects.some((project) => first.projects.some((seen) => seen.id === project.id));
      } finally {
        await sql`UPDATE projects SET visibility = 'public' WHERE id = ${lastId}`;
      }
    });
    await check("the feed's newest, most viewed and most followed sorts read the 0195 indexes", async () => {
      // One connection (a transaction), so the planner setting applies to the EXPLAINs.
      const plans = await sql.begin(async (transaction) => {
        // postgres.js types drop the tagged-template call on TransactionSql; it is callable at runtime.
        const tx = transaction as unknown as typeof sql;
        // A tiny table makes any plan cheap; forbidding scans-plus-sort proves the index can serve the order itself.
        await tx`SET LOCAL enable_seqscan = off`;
        await tx`SET LOCAL enable_bitmapscan = off`;
        await tx`SET LOCAL enable_sort = off`;
        return [
          await tx`EXPLAIN SELECT id FROM projects WHERE deleted_at IS NULL AND visibility IN ('public', 'unlisted') AND status <> 'draft' ORDER BY created_at DESC, id DESC LIMIT 25`,
          await tx`EXPLAIN SELECT id FROM projects WHERE deleted_at IS NULL AND visibility IN ('public', 'unlisted') AND status <> 'draft' ORDER BY view_count DESC, created_at DESC, id DESC LIMIT 25`,
          await tx`EXPLAIN SELECT id FROM projects WHERE deleted_at IS NULL AND visibility IN ('public', 'unlisted') AND status <> 'draft' ORDER BY followers_count DESC, created_at DESC, id DESC LIMIT 25`,
        ];
      });
      const text = plans.map((rows) => rows.map((row) => Object.values(row)[0]).join("\n"));
      return text[0]!.includes("projects_discover_newest_idx") && text[1]!.includes("projects_discover_most_viewed_idx") && text[2]!.includes("projects_discover_most_followed_idx");
    });

    await check("a garbage cursor is a cursor error, not page 1", async () => {
      try {
        await data.getDiscoverProjects(base, "t:abc|not-a-date|1", 4, { view: "all", viewerId: viewer });
        return false;
      } catch (error) {
        return error instanceof data.InvalidDiscoverCursorError;
      }
    });
  } finally {
    await sql`DELETE FROM project_skills WHERE project_id IN ${sql([...seeded])}`;
    await sql`DELETE FROM skills WHERE id IN ${sql(Object.values(skillIds))}`;
    await sql`DELETE FROM project_open_roles WHERE project_id IN ${sql([...seeded])}`;
    await sql`DELETE FROM project_members WHERE project_id IN ${sql([...seeded])}`;
    await sql`DELETE FROM projects WHERE id IN ${sql([...seeded])}`;
    await sql`DELETE FROM connections WHERE requester_id IN ${sql([viewer, blocker])}`;
    await sql`DELETE FROM profiles WHERE id IN ${sql(profileRows.map(([id]) => id))}`;
    await sql.end();
  }

  console.log(`check:discover ${passed} passed, ${failures.length} failed`);
  for (const failure of failures) console.log(`  ✗ ${failure}`);
  process.exit(failures.length ? 1 : 0);
}

void main();
