/**
 * Chat database contract (report sections 7.1-7.3, plan Phase 0/1).
 *
 * Runs against a disposable database only (local Postgres built by
 * npm run db:disposable, or any E2E/fresh URL). Never DATABASE_URL.
 *   DATABASE_URL_FRESH=$(npm run -s db:disposable) npm run check:chat:db
 */
import { randomUUID } from "node:crypto";

import dotenv from "dotenv";
import postgres from "postgres";

import { requireDisposableDatabaseUrl } from "./lib/disposable-db";

dotenv.config({ path: ".env.local" });

const disposableUrl = requireDisposableDatabaseUrl("check:chat:db");

// Rows are asserted at runtime by each check, so query results are loosely typed here.
type LooseSql = ((strings: TemplateStringsArray, ...values: unknown[]) => Promise<any[]>) & ReturnType<typeof postgres>;
const sql = postgres(disposableUrl, { max: 24, prepare: false, onnotice: () => undefined }) as unknown as LooseSql;
const failures: string[] = [];
let passed = 0;

async function check(label: string, run: () => Promise<boolean>) {
  try {
    if (await run()) {
      passed += 1;
      return;
    }
    failures.push(label);
  } catch (error) {
    failures.push(`${label} (threw: ${(error as Error).message})`);
  }
}

const DENIED = new Set(["42501", "22023", "23502", "23514", "23503", "23505"]);

async function denied(run: () => Promise<unknown>) {
  try {
    await run();
    return false;
  } catch (error) {
    return DENIED.has((error as { code?: string }).code ?? "");
  }
}

async function asUser<T>(userId: string, run: (tx: typeof sql) => Promise<T>, topic?: string) {
  return sql.begin(async (connection) => {
    const tx = connection as unknown as typeof sql;
    await tx.unsafe("SET LOCAL ROLE authenticated");
    await tx`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`;
    if (topic) await tx`SELECT set_config('realtime.topic', ${topic}, true)`;
    return run(tx);
  }) as Promise<T>;
}

const ROLLBACK = Symbol("rollback");

/**
 * Chat tables are not browser-readable (0199): the UI reads through the chat
 * RPCs and private broadcasts. The row policies stay as a second layer, so
 * these checks grant SELECT inside a transaction that is always rolled back.
 */
async function asPolicyReader<T>(tables: string[], userId: string, run: (tx: typeof sql) => Promise<T>) {
  let result: T | undefined;
  try {
    await sql.begin(async (connection) => {
      const tx = connection as unknown as typeof sql;
      await tx.unsafe(`GRANT SELECT ON ${tables.join(", ")} TO authenticated`);
      await tx.unsafe("SET LOCAL ROLE authenticated");
      await tx`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`;
      result = await run(tx);
      throw ROLLBACK;
    });
  } catch (error) {
    if (error !== ROLLBACK) throw error;
  }
  return result as T;
}

type SendResult = { channel_seq: number; deduped: boolean; notify?: string[] };

async function send(channel: string, author: string, body: string, options: {
  clientId?: string;
  threadRoot?: number;
  mentions?: string[];
  broadcast?: "channel" | "here";
  card?: Record<string, unknown>;
} = {}) {
  const [row] = await sql`
    SELECT app_private.chat_send_message(
      ${channel}::uuid, ${author}::uuid, ${body}, ${options.clientId ?? null},
      ${options.threadRoot ?? null}::bigint, ${options.mentions ?? []}::uuid[],
      ${options.broadcast ?? null}, '[]'::jsonb, ${options.card ? sql.json(options.card as never) : null}::jsonb
    ) AS result
  `;
  return row.result as SendResult;
}

async function memberRow(channel: string, user: string) {
  const [row] = await sql`
    SELECT last_read_seq::int, mention_count, archived_at, notify, starred
    FROM chat_channel_members WHERE channel_id = ${channel} AND user_id = ${user}
  `;
  return row;
}

async function main() {
  const [owner, member, stranger, blocked, open, admin] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()] as const;
  const users = [owner, member, stranger, blocked, open, admin];
  const projectId = randomUUID();
  const otherProject = randomUUID();
  const taskId = randomUUID();
  const applicationId = randomUUID();
  const invitationId = randomUUID();

  try {
    await sql`INSERT INTO auth.users (id, email) SELECT u, 'chat-' || u || '@example.test' FROM unnest(${users}::uuid[]) AS t(u)`;
    await sql`
      INSERT INTO profiles (id, email, username, full_name, message_privacy)
      SELECT u, 'chat-' || u || '@example.test', 'chat_' || left(replace(u::text, '-', ''), 12), 'User ' || left(u::text, 4), p
      FROM unnest(${users}::uuid[], ${["connections", "connections", "connections", "connections", "everyone", "connections"]}::text[]) AS t(u, p)
    `;
    await sql`
      INSERT INTO connections (requester_id, addressee_id, status) VALUES (${owner}, ${member}, 'accepted');
    `;
    await sql`
      INSERT INTO connections (requester_id, addressee_id, status, blocked_by, blocked_at)
      VALUES (${blocked}, ${owner}, 'blocked', ${blocked}, now())
    `;
    await sql`INSERT INTO projects (id, owner_id, title) VALUES (${projectId}, ${owner}, 'Chat test'), (${otherProject}, ${stranger}, 'Other')`;
    await sql`
      INSERT INTO project_members (project_id, user_id, role) VALUES
        (${projectId}, ${owner}, 'owner'), (${projectId}, ${member}, 'member'), (${projectId}, ${admin}, 'admin'),
        (${otherProject}, ${stranger}, 'owner')
    `;
    await sql`INSERT INTO tasks (id, project_id, title) VALUES (${taskId}, ${projectId}, 'Card task')`;
    await sql`INSERT INTO role_applications (id, project_id, applicant_id, creator_id, message) VALUES (${applicationId}, ${projectId}, ${open}, ${owner}, 'Hire me')`;
    await sql`
      INSERT INTO project_invitations (id, project_id, inviter_id, candidate_id, kind, role_title, project_title, expires_at)
      VALUES (${invitationId}, ${projectId}, ${owner}, ${open}, 'ordinary_role', 'Engineer', 'Chat test', now() + interval '14 days')
    `;

    // --- 7.1 project channels and sync
    const [{ general }] = await sql`SELECT app_private.chat_sync_project_members(${projectId}::uuid, NULL::uuid, 'ensure_default') AS general`;
    await check("default channel exists, public, named general", async () => {
      const [row] = await sql`SELECT kind, name, is_default, member_count FROM chat_channels WHERE id = ${general}`;
      return row?.kind === "public" && row.name === "general" && row.is_default === true && row.member_count === 3;
    });
    await check("ensure_default is idempotent", async () => {
      const [{ again }] = await sql`SELECT app_private.chat_sync_project_members(${projectId}::uuid, NULL::uuid, 'ensure_default') AS again`;
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM chat_channels WHERE project_id = ${projectId} AND is_default`;
      return again === general && n === 1;
    });

    const [{ design }] = await sql`SELECT app_private.chat_create_channel(${projectId}::uuid, ${member}::uuid, 'design', 'UI work', false) AS design`;
    const [{ secret }] = await sql`SELECT app_private.chat_create_channel(${projectId}::uuid, ${owner}::uuid, 'backend', NULL, true) AS secret`;
    await check("non-member of the project cannot create a channel", () =>
      denied(() => sql`SELECT app_private.chat_create_channel(${projectId}::uuid, ${stranger}::uuid, 'nope', NULL, false)`));
    await check("channel name rule enforced", () =>
      denied(() => sql`SELECT app_private.chat_create_channel(${projectId}::uuid, ${member}::uuid, 'Bad Name!', NULL, false)`));
    await check("channel name unique per project", () =>
      denied(() => sql`SELECT app_private.chat_create_channel(${projectId}::uuid, ${owner}::uuid, 'design', NULL, false)`));
    await check("project member joins a public channel", async () => {
      await sql`SELECT app_private.chat_join_channel(${design}::uuid, ${owner}::uuid)`;
      const [row] = await sql`SELECT member_count FROM chat_channels WHERE id = ${design}`;
      return row.member_count === 2;
    });
    await check("cannot join a private channel", () => denied(() => sql`SELECT app_private.chat_join_channel(${secret}::uuid, ${member}::uuid)`));
    await check("outsider cannot join a project's public channel", () => denied(() => sql`SELECT app_private.chat_join_channel(${design}::uuid, ${stranger}::uuid)`));
    await check("default channel cannot be left", () => denied(() => sql`SELECT app_private.chat_leave_channel(${general}::uuid, ${member}::uuid)`));
    await check("join and leave post system lines", async () => {
      const rows = await sql`SELECT kind FROM chat_messages WHERE channel_id = ${design} ORDER BY channel_seq`;
      return rows.length >= 2 && rows.every((row) => row.kind === "system");
    });

    // --- DMs and privacy
    await check("can_dm: connected users", async () => (await sql`SELECT app_private.chat_can_dm(${owner}::uuid, ${member}::uuid) AS ok`)[0].ok === true);
    await check("can_dm: privacy 'everyone' allows strangers", async () => (await sql`SELECT app_private.chat_can_dm(${stranger}::uuid, ${open}::uuid) AS ok`)[0].ok === true);
    await check("can_dm: privacy 'connections' blocks strangers", async () => (await sql`SELECT app_private.chat_can_dm(${open}::uuid, ${stranger}::uuid) AS ok`)[0].ok === false);
    await check("can_dm: blocked in either direction", async () => {
      const [a] = await sql`SELECT app_private.chat_can_dm(${owner}::uuid, ${blocked}::uuid) AS ok`;
      const [b] = await sql`SELECT app_private.chat_can_dm(${blocked}::uuid, ${owner}::uuid) AS ok`;
      return a.ok === false && b.ok === false;
    });
    const [{ dm }] = await sql`SELECT app_private.chat_get_or_create_dm(${owner}::uuid, ${member}::uuid) AS dm`;
    await check("DM is unique per pair, order independent", async () => {
      const [{ again }] = await sql`SELECT app_private.chat_get_or_create_dm(${member}::uuid, ${owner}::uuid) AS again`;
      return again === dm;
    });
    await check("self-DM has one member", async () => {
      const [{ self }] = await sql`SELECT app_private.chat_get_or_create_dm(${owner}::uuid, ${owner}::uuid) AS self`;
      const [row] = await sql`SELECT member_count, kind FROM chat_channels WHERE id = ${self}`;
      return row.member_count === 1 && row.kind === "dm";
    });
    await check("DM creation refused by privacy", () => denied(() => sql`SELECT app_private.chat_get_or_create_dm(${stranger}::uuid, ${owner}::uuid)`));
    await check("invite reason bypasses privacy but not blocks", async () => {
      const [{ id }] = await sql`SELECT app_private.chat_get_or_create_dm(${owner}::uuid, ${open}::uuid, 'invite') AS id`;
      const refused = await denied(() => sql`SELECT app_private.chat_get_or_create_dm(${owner}::uuid, ${blocked}::uuid, 'invite')`);
      return Boolean(id) && refused;
    });

    // --- send path
    await check("seq is gap-free under 20 concurrent sends", async () => {
      const results = await Promise.all(Array.from({ length: 20 }, (_, i) => send(dm, i % 2 ? owner : member, `burst ${i}`)));
      const seqs = results.map((r) => Number(r.channel_seq)).sort((a, b) => a - b);
      const [row] = await sql`SELECT last_seq::int FROM chat_channels WHERE id = ${dm}`;
      const first = seqs[0] ?? 0;
      return seqs.every((seq, i) => seq === first + i) && row.last_seq === seqs[seqs.length - 1];
    });
    await check("client_message_id is idempotent", async () => {
      const a = await send(dm, owner, "once", { clientId: "c-1" });
      const b = await send(dm, owner, "once", { clientId: "c-1" });
      return a.channel_seq === b.channel_seq && b.deduped === true;
    });
    await check("non-member cannot send", () => denied(() => send(dm, stranger, "intrude")));
    await check("empty message refused", () => denied(() => send(dm, owner, "   ")));
    await check("body over 4000 characters refused", () => denied(() => send(dm, owner, "x".repeat(4001))));
    await check("preview is set and capped at 120", async () => {
      await send(general, owner, "y".repeat(300));
      const [row] = await sql`SELECT char_length(last_preview) AS len, last_author_id FROM chat_channels WHERE id = ${general}`;
      return row.len === 120 && row.last_author_id === owner;
    });
    await check("author's own message is read", async () => {
      const result = await send(general, member, "read by me");
      return (await memberRow(general, member)).last_read_seq === Number(result.channel_seq);
    });
    await check("mention increments the mentioned member's count", async () => {
      await send(general, owner, "hi <@member>", { mentions: [member] });
      const row = await memberRow(general, member);
      const [m] = await sql`SELECT count(*)::int AS n FROM chat_mentions WHERE user_id = ${member} AND channel_id = ${general}`;
      return row.mention_count === 1 && m.n === 1;
    });
    await check("mentions of non-members are ignored", async () => {
      await send(general, owner, "hi stranger", { mentions: [stranger] });
      const [m] = await sql`SELECT count(*)::int AS n FROM chat_mentions WHERE user_id = ${stranger}`;
      return m.n === 0;
    });
    await check("@channel works in small channels", async () => {
      await send(general, owner, "all hands", { broadcast: "channel" });
      return (await memberRow(general, admin)).mention_count >= 1;
    });
    await check("@channel refused above 100 members", async () => {
      await sql`UPDATE chat_channels SET member_count = 101 WHERE id = ${design}`;
      const refused = await denied(() => send(design, member, "everyone!", { broadcast: "channel" }));
      await sql`UPDATE chat_channels SET member_count = 2 WHERE id = ${design}`;
      return refused;
    });
    await check("a new DM un-archives it for the recipient", async () => {
      await sql`SELECT app_private.chat_set_member_state(${dm}::uuid, ${member}::uuid, NULL, NULL, true)`;
      const archived = (await memberRow(dm, member)).archived_at !== null;
      await send(dm, owner, "ping");
      return archived && (await memberRow(dm, member)).archived_at === null;
    });
    await check("send returns who to notify: DM partner yes, muted no, channel members only when mentioned", async () => {
      const dmResult = await send(dm, owner, "notify me");
      await sql`SELECT app_private.chat_set_member_state(${dm}::uuid, ${member}::uuid, 'mute', NULL, NULL)`;
      const muted = await send(dm, owner, "quiet");
      await sql`SELECT app_private.chat_set_member_state(${dm}::uuid, ${member}::uuid, 'all', NULL, NULL)`;
      const plain = await send(general, owner, "no mention");
      const mentioned = await send(general, owner, "hey <@admin>", { mentions: [admin] });
      return JSON.stringify(dmResult.notify) === JSON.stringify([member])
        && (muted.notify ?? []).length === 0
        && (plain.notify ?? []).length === 0
        && JSON.stringify(mentioned.notify) === JSON.stringify([admin]);
    });
    await check("blocked user cannot send into an existing DM", async () => {
      const [{ id }] = await sql`SELECT app_private.chat_get_or_create_dm(${owner}::uuid, ${admin}::uuid, 'invite') AS id`;
      await sql`INSERT INTO connections (requester_id, addressee_id, status, blocked_by, blocked_at) VALUES (${admin}, ${owner}, 'blocked', ${admin}, now())`;
      return denied(() => send(id, owner, "still there?"));
    });
    await check("archived channel refuses sends", async () => {
      const [{ id }] = await sql`SELECT app_private.chat_create_channel(${projectId}::uuid, ${owner}::uuid, 'old-stuff', NULL, false) AS id`;
      await sql`SELECT app_private.chat_archive_channel(${id}::uuid, ${owner}::uuid)`;
      return denied(() => send(id, owner, "hello?"));
    });
    await check("default channel cannot be archived", () => denied(() => sql`SELECT app_private.chat_archive_channel(${general}::uuid, ${owner}::uuid)`));

    // --- threads
    const root = await send(general, owner, "thread root");
    await check("thread reply bumps root and notifies followers, not the channel preview", async () => {
      const [before] = await sql`SELECT last_preview, last_top_seq::int FROM chat_channels WHERE id = ${general}`;
      await send(general, member, "a reply", { threadRoot: Number(root.channel_seq) });
      const [rootRow] = await sql`SELECT reply_count, last_reply_seq FROM chat_messages WHERE channel_id = ${general} AND channel_seq = ${root.channel_seq}`;
      const [after] = await sql`SELECT last_preview, last_top_seq::int FROM chat_channels WHERE id = ${general}`;
      const [m] = await sql`SELECT count(*)::int AS n FROM chat_mentions WHERE user_id = ${owner} AND kind = 'thread_reply'`;
      return rootRow.reply_count === 1 && after.last_preview === before.last_preview && after.last_top_seq === before.last_top_seq && m.n === 1;
    });
    await check("reply to a reply is refused", async () => {
      const reply = await send(general, member, "second reply", { threadRoot: Number(root.channel_seq) });
      return denied(() => send(general, owner, "nested", { threadRoot: Number(reply.channel_seq) }));
    });

    // --- read cursor
    await check("mark_read is only-if-newer and clears mentions", async () => {
      const [{ last }] = await sql`SELECT last_seq::int AS last FROM chat_channels WHERE id = ${general}`;
      const [{ ok }] = await sql`SELECT app_private.chat_mark_read(${general}::uuid, ${member}::uuid, ${last}::bigint) AS ok`;
      const [{ stale }] = await sql`SELECT app_private.chat_mark_read(${general}::uuid, ${member}::uuid, 1::bigint) AS stale`;
      const row = await memberRow(general, member);
      return ok === true && stale === false && row.last_read_seq === last && row.mention_count === 0;
    });
    await check("mark_read cannot pass the channel's last seq", async () => {
      const [{ ok }] = await sql`SELECT app_private.chat_mark_read(${general}::uuid, ${member}::uuid, 999999::bigint) AS ok`;
      return ok === false;
    });

    // --- edit, delete, react, pin
    const mine = await send(design, member, "edit me");
    await check("author can edit", async () => {
      await sql`SELECT app_private.chat_edit_message(${design}::uuid, ${mine.channel_seq}::bigint, ${member}::uuid, 'edited')`;
      const [row] = await sql`SELECT body, edited_at FROM chat_messages WHERE channel_id = ${design} AND channel_seq = ${mine.channel_seq}`;
      const [channel] = await sql`SELECT last_preview FROM chat_channels WHERE id = ${design}`;
      return row.body === "edited" && row.edited_at !== null && channel.last_preview === "edited";
    });
    await check("others cannot edit", () => denied(() => sql`SELECT app_private.chat_edit_message(${design}::uuid, ${mine.channel_seq}::bigint, ${owner}::uuid, 'hacked')`));
    await check("channel admin can delete others' messages; body is wiped", async () => {
      await sql`SELECT app_private.chat_delete_message(${design}::uuid, ${mine.channel_seq}::bigint, ${owner}::uuid)`;
      const [row] = await sql`SELECT body, deleted_at FROM chat_messages WHERE channel_id = ${design} AND channel_seq = ${mine.channel_seq}`;
      const [channel] = await sql`SELECT last_preview FROM chat_channels WHERE id = ${design}`;
      return row.body === "" && row.deleted_at !== null && channel.last_preview === "Message deleted";
    });
    await check("plain member cannot delete others' messages", async () => {
      const other = await send(general, owner, "owner says");
      return denied(() => sql`SELECT app_private.chat_delete_message(${general}::uuid, ${other.channel_seq}::bigint, ${member}::uuid)`);
    });
    await check("react toggles one row per user and emoji", async () => {
      await sql`SELECT app_private.chat_react(${general}::uuid, ${root.channel_seq}::bigint, ${member}::uuid, '👍', true)`;
      await sql`SELECT app_private.chat_react(${general}::uuid, ${root.channel_seq}::bigint, ${member}::uuid, '👍', true)`;
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM chat_reactions WHERE channel_id = ${general} AND message_seq = ${root.channel_seq}`;
      await sql`SELECT app_private.chat_react(${general}::uuid, ${root.channel_seq}::bigint, ${member}::uuid, '👍', false)`;
      const [{ m }] = await sql`SELECT count(*)::int AS m FROM chat_reactions WHERE channel_id = ${general} AND message_seq = ${root.channel_seq}`;
      return n === 1 && m === 0;
    });
    await check("outsider cannot react", () => denied(() => sql`SELECT app_private.chat_react(${general}::uuid, ${root.channel_seq}::bigint, ${stranger}::uuid, '👍', true)`));
    await check("any member pins (0187); non-members are refused", async () => {
      const strangerRefused = await denied(() => sql`SELECT app_private.chat_pin(${general}::uuid, ${root.channel_seq}::bigint, ${stranger}::uuid, true)`);
      await sql`SELECT app_private.chat_pin(${general}::uuid, ${root.channel_seq}::bigint, ${member}::uuid, true)`;
      const dmMsg = await send(dm, member, "pin this");
      await sql`SELECT app_private.chat_pin(${dm}::uuid, ${dmMsg.channel_seq}::bigint, ${member}::uuid, true)`;
      const [{ n }] = await sql`SELECT count(*)::int AS n FROM chat_pins WHERE channel_id IN (${general}, ${dm})`;
      return strangerRefused && n === 2;
    });
    await check("report records once per reporter and message", async () => {
      await sql`SELECT app_private.chat_report(${general}::uuid, ${root.channel_seq}::bigint, ${member}::uuid, 'spam')`;
      return denied(() => sql`SELECT app_private.chat_report(${general}::uuid, ${root.channel_seq}::bigint, ${member}::uuid, 'spam')`);
    });

    // --- caps
    await check("member cap of 500 enforced on add", async () => {
      await sql`UPDATE chat_channels SET member_count = 500 WHERE id = ${secret}`;
      const refused = await denied(() => sql`SELECT app_private.chat_add_members(${secret}::uuid, ${owner}::uuid, ${[admin]}::uuid[])`);
      await sql`UPDATE chat_channels SET member_count = 1 WHERE id = ${secret}`;
      return refused;
    });
    await check("private channel add requires project membership", () =>
      denied(() => sql`SELECT app_private.chat_add_members(${secret}::uuid, ${owner}::uuid, ${[stranger]}::uuid[])`));
    await check("per-project channel cap of 200", async () => {
      await sql`
        INSERT INTO chat_channels (kind, name, project_id, created_by)
        SELECT 'public', 'filler-' || g, ${projectId}, ${owner} FROM generate_series(1, 200) g
      `;
      const refused = await denied(() => sql`SELECT app_private.chat_create_channel(${projectId}::uuid, ${owner}::uuid, 'one-too-many', NULL, false)`);
      await sql`DELETE FROM chat_channels WHERE project_id = ${projectId} AND name LIKE 'filler-%'`;
      return refused;
    });

    // --- group chats
    await check("group chat: unnamed private channel, members must be messageable", async () => {
      const [{ group }] = await sql`SELECT app_private.chat_create_group(${owner}::uuid, ${[member, open]}::uuid[]) AS group`;
      const [row] = await sql`SELECT kind, name, project_id, member_count FROM chat_channels WHERE id = ${group}`;
      const refused = await denied(() => sql`SELECT app_private.chat_create_group(${owner}::uuid, ${[blocked]}::uuid[])`);
      return row.kind === "private" && row.name === null && row.project_id === null && row.member_count === 3 && refused;
    });

    // --- applications and cards
    await check("application channel is private, idempotent, has the card", async () => {
      const [{ a }] = await sql`SELECT app_private.chat_ensure_application_channel(${applicationId}::uuid) AS a`;
      const [{ b }] = await sql`SELECT app_private.chat_ensure_application_channel(${applicationId}::uuid) AS b`;
      const members = await sql`SELECT user_id FROM chat_channel_members WHERE channel_id = ${a}`;
      const [card] = await sql`SELECT kind, ref_id FROM chat_message_cards WHERE channel_id = ${a}`;
      const ids = new Set(members.map((m) => m.user_id));
      return a === b && ids.has(open) && ids.has(owner) && ids.has(admin) && !ids.has(member) && card?.kind === "application" && card.ref_id === applicationId;
    });
    await check("card.changed fires on task, application and invitation status", async () => {
      await send(general, owner, "", { card: { kind: "task", ref_id: taskId } });
      const [{ inviteDm }] = await sql`SELECT app_private.chat_get_or_create_dm(${owner}::uuid, ${open}::uuid, 'invite') AS "inviteDm"`;
      await send(inviteDm, owner, "join us", { card: { kind: "invite", ref_id: invitationId } });
      await sql`DELETE FROM realtime.messages WHERE event = 'card.changed'`;
      await sql`UPDATE tasks SET status = 'done' WHERE id = ${taskId}`;
      await sql`UPDATE role_applications SET status = 'accepted' WHERE id = ${applicationId}`;
      await sql`UPDATE project_invitations SET status = 'accepted' WHERE id = ${invitationId}`;
      await sql`UPDATE tasks SET description = 'not a card field' WHERE id = ${taskId}`;
      const rows = await sql`SELECT payload->>'kind' AS kind, topic FROM realtime.messages WHERE event = 'card.changed'`;
      const kinds = rows.map((r) => r.kind).sort().join(",");
      return kinds === "application,invite,task" && rows.every((r) => String(r.topic).startsWith("chat:channel:"));
    });

    // --- membership sync on project leave
    await check("removing a project member removes every project channel membership", async () => {
      await sql`SELECT app_private.chat_sync_project_members(${projectId}::uuid, ${member}::uuid, 'remove')`;
      const [{ n }] = await sql`
        SELECT count(*)::int AS n FROM chat_channel_members m JOIN chat_channels c ON c.id = m.channel_id
        WHERE m.user_id = ${member} AND c.project_id = ${projectId}
      `;
      const [{ dmKept }] = await sql`SELECT count(*)::int AS "dmKept" FROM chat_channel_members WHERE user_id = ${member} AND channel_id = ${dm}`;
      return n === 0 && dmKept === 1;
    });
    await check("adding a project member joins only the default channel", async () => {
      await sql`SELECT app_private.chat_sync_project_members(${projectId}::uuid, ${member}::uuid, 'add')`;
      const rows = await sql`
        SELECT c.is_default FROM chat_channel_members m JOIN chat_channels c ON c.id = m.channel_id
        WHERE m.user_id = ${member} AND c.project_id = ${projectId}
      `;
      return rows.length === 1 && rows[0].is_default === true;
    });

    // --- bootstrap
    await check("bootstrap returns joined channels with DM profile and projects", async () => {
      const [{ data }] = await sql`SELECT app_private.chat_bootstrap(${owner}::uuid, NULL) AS data`;
      const channels = data.channels as Array<Record<string, unknown>>;
      const dmRow = channels.find((c) => c.id === dm);
      const projects = data.projects as Array<Record<string, unknown>>;
      return Boolean(dmRow?.dm_user) && channels.some((c) => c.id === general) && projects.some((p) => p.id === projectId) && typeof data.server_time === "string";
    });
    await check("bootstrap delta returns only channels changed since", async () => {
      const [{ data }] = await sql`SELECT app_private.chat_bootstrap(${owner}::uuid, now() + interval '1 minute') AS data`;
      return (data.channels as unknown[]).length === 0;
    });

    // --- RLS and grants
    await check("non-member sees no messages, members, or channel rows", async () => {
      const counts = await asPolicyReader(["chat_messages", "chat_channels", "chat_channel_members", "chat_canvases"], stranger, async (tx) => {
        const [m] = await tx`SELECT count(*)::int AS n FROM chat_messages WHERE channel_id = ${general}`;
        const [mem] = await tx`SELECT count(*)::int AS n FROM chat_channel_members WHERE channel_id = ${general}`;
        const [ch] = await tx`SELECT count(*)::int AS n FROM chat_channels WHERE id = ${secret}`;
        return m.n + mem.n + ch.n;
      });
      return counts === 0;
    });
    await check("member sees messages", async () => {
      const n = await asPolicyReader(["chat_messages", "chat_channels", "chat_channel_members", "chat_canvases"], owner, async (tx) => (await tx`SELECT count(*)::int AS n FROM chat_messages WHERE channel_id = ${general}`)[0].n);
      return n > 0;
    });
    await check("project member can see (browse) public channels without joining", async () => {
      const n = await asPolicyReader(["chat_messages", "chat_channels", "chat_channel_members", "chat_canvases"], admin, async (tx) => (await tx`SELECT count(*)::int AS n FROM chat_channels WHERE id = ${design}`)[0].n);
      return n === 1;
    });
    await check("direct partition access is denied", () =>
      denied(() => asUser(owner, (tx) => tx`SELECT count(*) FROM chat_messages_p00`)));
    await check("authenticated cannot write chat tables directly", () =>
      denied(() => asUser(owner, (tx) => tx`INSERT INTO chat_reactions (channel_id, message_seq, user_id, emoji) VALUES (${general}, 1, ${owner}, 'x')`)));
    await check("authenticated cannot call write functions", () =>
      denied(() => asUser(owner, (tx) => tx`SELECT app_private.chat_send_message(${general}::uuid, ${owner}::uuid, 'sneaky')`)));

    // --- Realtime topic authorization
    await check("channel topic: member reads, outsider does not", async () => {
      const topic = `chat:channel:${general}`;
      await sql`INSERT INTO realtime.messages (topic, extension, event, payload, private) VALUES (${topic}, 'broadcast', 'ping', '{}', true)`;
      const mine = await asUser(owner, async (tx) => (await tx`SELECT count(*)::int AS n FROM realtime.messages WHERE topic = ${topic}`)[0].n, topic);
      const theirs = await asUser(stranger, async (tx) => (await tx`SELECT count(*)::int AS n FROM realtime.messages WHERE topic = ${topic}`)[0].n, topic);
      return mine > 0 && theirs === 0;
    });
    await check("channel topic is server-only: even a member cannot send on it (0183)", () => {
      const topic = `chat:channel:${general}`;
      return denied(() => asUser(owner, (tx) => tx`INSERT INTO realtime.messages (topic, extension, event, payload, private) VALUES (${topic}, 'broadcast', 'message.edit', '{}', true)`, topic));
    });
    await check("typing topic: member sends and reads, outsider does neither", async () => {
      const topic = `chat:typing:${general}`;
      await asUser(owner, (tx) => tx`INSERT INTO realtime.messages (topic, extension, event, payload, private) VALUES (${topic}, 'broadcast', 'typing', '{}', true)`, topic);
      const reads = await asUser(member, async (tx) => (await tx`SELECT count(*)::int AS n FROM realtime.messages WHERE topic = ${topic}`)[0].n, topic);
      const outsiderReads = await asUser(stranger, async (tx) => (await tx`SELECT count(*)::int AS n FROM realtime.messages WHERE topic = ${topic}`)[0].n, topic);
      const outsiderSendRefused = await denied(() => asUser(stranger, (tx) => tx`INSERT INTO realtime.messages (topic, extension, event, payload, private) VALUES (${topic}, 'broadcast', 'typing', '{}', true)`, topic));
      return reads > 0 && outsiderReads === 0 && outsiderSendRefused;
    });
    await check("user topic: only the owner reads; nobody sends", async () => {
      const topic = `chat:user:${owner}`;
      await sql`INSERT INTO realtime.messages (topic, extension, event, payload, private) VALUES (${topic}, 'broadcast', 'hint', '{}', true)`;
      const mine = await asUser(owner, async (tx) => (await tx`SELECT count(*)::int AS n FROM realtime.messages WHERE topic = ${topic}`)[0].n, topic);
      const theirs = await asUser(member, async (tx) => (await tx`SELECT count(*)::int AS n FROM realtime.messages WHERE topic = ${topic}`)[0].n, topic);
      const sendRefused = await denied(() => asUser(owner, (tx) => tx`INSERT INTO realtime.messages (topic, extension, event, payload, private) VALUES (${topic}, 'broadcast', 'hint', '{}', true)`, topic));
      return mine > 0 && theirs === 0 && sendRefused;
    });
    // --- 0182 shared canvases
    const [ownAsset, foreignAsset] = [randomUUID(), randomUUID()];
    await sql`
      INSERT INTO storage_assets (id, owner_user_id, bucket, storage_key, purpose, state, declared_mime_type, declared_size, verified_mime_type, verified_size, verified_at, expires_at)
      VALUES (${ownAsset}, ${owner}, 'chat-attachments', ${`chat/${ownAsset}`}, 'chat_attachment:file', 'verified', 'image/png', 10, 'image/png', 10, now(), now() + interval '1 day'),
             (${foreignAsset}, ${stranger}, 'chat-attachments', ${`chat/${foreignAsset}`}, 'chat_attachment:file', 'verified', 'image/png', 10, 'image/png', 10, now(), now() + interval '1 day')
    `;
    const saveCanvas = (user: string, base: number, assets: string[] = []) =>
      sql`SELECT app_private.chat_save_canvas(${general}::uuid, ${user}::uuid, 'Plan', '# Hi', ${assets}::uuid[], ${base}) AS v`;
    await check("canvas: member saves, version starts at 1 and bumps", async () => {
      const [first] = await saveCanvas(owner, 0, [ownAsset, foreignAsset]);
      const [second] = await saveCanvas(member, 1);
      return first.v === 1 && second.v === 2;
    });
    await check("canvas: stale version is a conflict", () => denied(() => saveCanvas(owner, 1)));
    await check("canvas: non-member cannot save", () => denied(() => saveCanvas(stranger, 2)));
    await check("canvas: keeps only the saver's own assets or ones already in it", async () => {
      await saveCanvas(owner, 2, [ownAsset, foreignAsset]);
      const [row] = await sql`SELECT asset_ids FROM chat_canvases WHERE channel_id = ${general}`;
      await saveCanvas(member, 3, [ownAsset]);
      const [kept] = await sql`SELECT asset_ids FROM chat_canvases WHERE channel_id = ${general}`;
      return row.asset_ids.length === 1 && row.asset_ids[0] === ownAsset && kept.asset_ids[0] === ownAsset;
    });
    await check("canvas: members read it, outsiders do not", async () => {
      const mine = await asPolicyReader(["chat_messages", "chat_channels", "chat_channel_members", "chat_canvases"], member, async (tx) => (await tx`SELECT count(*)::int AS n FROM chat_canvases WHERE channel_id = ${general}`)[0].n);
      const theirs = await asPolicyReader(["chat_messages", "chat_channels", "chat_channel_members", "chat_canvases"], stranger, async (tx) => (await tx`SELECT count(*)::int AS n FROM chat_canvases WHERE channel_id = ${general}`)[0].n);
      return mine === 1 && theirs === 0;
    });
    await check("canvas: authenticated cannot write it directly", () =>
      denied(() => asUser(owner, (tx) => tx`UPDATE chat_canvases SET title = 'x' WHERE channel_id = ${general}`)));
    await check("canvas images open for channel members only (attachment route clause)", async () => {
      const canOpen = async (user: string) => (await sql`
        SELECT EXISTS (
          SELECT 1 FROM chat_canvases cv
          WHERE cv.asset_ids @> ARRAY[${ownAsset}::uuid] AND app_private.chat_is_member(cv.channel_id, ${user}::uuid)
        ) AS ok
      `)[0].ok;
      return (await canOpen(member)) === true && (await canOpen(stranger)) === false;
    });
    // Same rule as deleteCanvas(): members remove an empty canvas; content needs a channel admin.
    const removeCanvas = (user: string) => sql`
      DELETE FROM chat_canvases c WHERE c.channel_id = ${general}::uuid
        AND app_private.chat_is_member(c.channel_id, ${user}::uuid)
        AND ((c.title = '' AND c.body = '') OR app_private.chat_is_channel_admin(c.channel_id, ${user}::uuid))
      RETURNING c.channel_id`;
    await check("canvas delete: a member can't remove one with content; an admin can", async () => {
      const byMember = await removeCanvas(member);
      const byAdmin = await removeCanvas(owner);
      return byMember.length === 0 && byAdmin.length === 1;
    });
    await check("canvas delete: any member removes an empty canvas", async () => {
      await sql`SELECT app_private.chat_save_canvas(${general}::uuid, ${member}::uuid, '', '', '{}'::uuid[], 0)`;
      return (await removeCanvas(member)).length === 1;
    });
    await sql`DELETE FROM storage_assets WHERE id IN (${ownAsset}, ${foreignAsset})`;

    // Report 10.3: after 0181 nothing of the old system is left.
    await check("old messaging system is gone (report 10.3)", async () => {
      const rows = await sql`
        SELECT 'table' AS k, tablename AS n FROM pg_tables
         WHERE schemaname = 'public' AND tablename ~ 'conversation|^message|^dm_pairs|typing_ind|attachment_uploads'
        UNION ALL
        SELECT 'func', p.proname FROM pg_proc p JOIN pg_namespace s ON s.oid = p.pronamespace
         WHERE s.nspname IN ('public', 'app_private') AND p.proname ~ 'conversation|^handle_message|typing'
        UNION ALL
        SELECT 'col', table_name || '.' || column_name FROM information_schema.columns
         WHERE table_schema = 'public' AND (column_name ~ 'conversation_id' OR column_name = 'message_workflow_item_id')
        UNION ALL
        SELECT 'trigger', tgname FROM pg_trigger WHERE NOT tgisinternal AND tgname ~ 'conversation|messages_after_insert|typing'
        UNION ALL
        SELECT 'policy', policyname FROM pg_policies WHERE policyname ~ 'conversation|^message_|^messages_|dm_pairs'
        UNION ALL
        SELECT 'pub', tablename FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND tablename ~ 'conversation|message|typing'
        UNION ALL
        SELECT 'topic-policy', policyname FROM pg_policies
         WHERE schemaname = 'realtime' AND (qual ~ 'conversation' OR with_check ~ 'conversation')
      `;
      if (rows.length) console.error("    leftovers:", rows.map((r: { k: string; n: string }) => `${r.k}:${r.n}`).join(", "));
      return rows.length === 0;
    });
    await check("presence visibility follows shared DMs, not old conversations", async () => {
      const body = (await sql`SELECT prosrc FROM pg_proc WHERE proname = 'nb_can_observe_user_presence'`)[0]?.prosrc ?? "";
      return body.includes("chat_channel_members") && !body.includes("conversation_participants");
    });
  } finally {
    await sql`DELETE FROM chat_channels WHERE project_id IN (${projectId}, ${otherProject}) OR id IN (
      SELECT channel_id FROM chat_channel_members WHERE user_id = ANY(${users}::uuid[])
    )`.catch(() => undefined);
    await sql`DELETE FROM realtime.messages WHERE topic LIKE 'chat:%'`.catch(() => undefined);
    await sql`DELETE FROM project_invitations WHERE id = ${invitationId}`.catch(() => undefined);
    await sql`DELETE FROM role_applications WHERE id = ${applicationId}`.catch(() => undefined);
    await sql`DELETE FROM tasks WHERE id = ${taskId}`.catch(() => undefined);
    await sql`DELETE FROM projects WHERE id IN (${projectId}, ${otherProject})`.catch(() => undefined);
    await sql`DELETE FROM connections WHERE requester_id = ANY(${users}::uuid[]) OR addressee_id = ANY(${users}::uuid[])`.catch(() => undefined);
    await sql`DELETE FROM profiles WHERE id = ANY(${users}::uuid[])`.catch(() => undefined);
    await sql.end();
  }

  if (failures.length) {
    console.error(`✗ chat database: ${failures.length} failed, ${passed} passed`);
    for (const failure of failures) console.error(`  - ${failure}`);
    process.exit(1);
  }
  console.log(`✓ chat database: ${passed} checks passed`);
}

void main();
