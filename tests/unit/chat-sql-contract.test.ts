import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sqlText = readFileSync("drizzle/0014_messaging.sql", "utf8");

const definers = [...sqlText.matchAll(/CREATE FUNCTION (app_private\.chat_\w+)\(([\s\S]*?)\) RETURNS[\s\S]*?\n\s*AS \$/g)];

test("chat functions live in app_private as SECURITY DEFINER with an empty search_path", () => {
  assert.ok(definers.length >= 25, `expected the chat function set, found ${definers.length}`);
  assert.doesNotMatch(sqlText, /CREATE FUNCTION public\.chat_/);
  for (const match of definers) {
    const [block, name] = match;
    assert.match(block, /SET search_path TO ''/, `${name} must pin search_path`);
  }
  const definerCount = definers.filter(([block]) => /SECURITY DEFINER/.test(block)).length;
  assert.ok(definerCount >= 25, `expected the SECURITY DEFINER set, found ${definerCount}`);
});

test("no chat function is granted to anon or PUBLIC", () => {
  assert.doesNotMatch(sqlText, /GRANT [^;]*ON FUNCTION app_private\.chat_\w+\([^)]*\) TO (anon|PUBLIC)/);
  assert.match(sqlText, /REVOKE ALL ON FUNCTION app_private\.chat_send_message\([^)]*\) FROM PUBLIC;/);
  assert.match(sqlText, /GRANT ALL ON FUNCTION app_private\.chat_send_message\([^)]*\) TO service_role;/);
  assert.doesNotMatch(sqlText, /GRANT [^;]*ON FUNCTION app_private\.chat_send_message\([^)]*\) TO authenticated/);
  const authenticatedGrants = [...sqlText.matchAll(/GRANT ALL ON FUNCTION (app_private\.\w+)\([^)]*\) TO authenticated/g)].map((m) => m[1]);
  const revoked = readFileSync("drizzle/0032_revoke_unused_helpers_task_files_rules.sql", "utf8");
  const stillGranted = authenticatedGrants.filter((name) => !revoked.includes(`${name}(`));
  assert.deepEqual(stillGranted.sort(), ["app_private.chat_can_signal", "app_private.chat_is_member", "app_private.chat_is_workspace_member"], "only what read rules call");
});

test("browser roles never write chat tables; no write policies exist", () => {
  assert.doesNotMatch(sqlText, /CREATE POLICY \w+ ON public\.chat_\w+ FOR (INSERT|UPDATE|DELETE)/);
  const allPolicies = [...sqlText.matchAll(/CREATE POLICY (\w+) ON public\.chat_\w+ TO (\w+)/g)];
  for (const [line, , role] of allPolicies) assert.equal(role, "nb_app", line);
  const selectPolicies = [...sqlText.matchAll(/CREATE POLICY (chat_\w+) ON public\.chat_\w+ FOR SELECT TO authenticated/g)];
  assert.equal(selectPolicies.length, 14);
  assert.doesNotMatch(sqlText, /GRANT [^;]*\b(SELECT|INSERT|UPDATE|DELETE|ALL)\b[^;]* ON TABLE public\.chat_\w+ TO anon/);
  assert.doesNotMatch(sqlText, /GRANT [^;]*\b(INSERT|UPDATE|DELETE|ALL)\b[^;]* ON TABLE public\.chat_\w+ TO authenticated/);
});

test("messages, attachments and reactions are hash-partitioned 32 ways with locked-down partitions", () => {
  for (const table of ["chat_messages", "chat_attachments", "chat_reactions"]) {
    assert.match(sqlText, new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\)\\nPARTITION BY HASH \\(channel_id\\);`));
    for (let remainder = 0; remainder < 32; remainder += 1) {
      const part = `${table}_p${String(remainder).padStart(2, "0")}`;
      assert.match(sqlText, new RegExp(`ATTACH PARTITION public\\.${part} FOR VALUES WITH \\(modulus 32, remainder ${remainder}\\)`));
      assert.match(sqlText, new RegExp(`ALTER TABLE public\\.${part} ENABLE ROW LEVEL SECURITY`));
    }
  }
  assert.doesNotMatch(sqlText, /GRANT [^;]*\b(SELECT|INSERT|UPDATE|DELETE|ALL)\b[^;]* ON TABLE public\.chat_\w+_p\d\d TO (anon|authenticated)/);
});

test("hot rows stay HOT: fillfactor set and hot columns never indexed", () => {
  assert.match(sqlText, /WITH \(fillfactor='70'\);/);
  assert.match(sqlText, /WITH \(fillfactor='80'\);/);
  const indexLines = sqlText.split("\n").filter((line) => /CREATE (UNIQUE )?INDEX/.test(line) && /ON public\.chat_channels /.test(line));
  assert.ok(indexLines.length > 0);
  for (const line of indexLines) {
    assert.doesNotMatch(line, /last_seq|last_top_seq|last_message_at|last_preview|member_count/, line);
  }
});

test("the send path is one function that locks the channel row", () => {
  assert.match(sqlText, /CREATE FUNCTION app_private\.chat_send_message\(/);
  assert.match(sqlText, /FOR UPDATE;/, "the channel row lock allocates channel_seq");
});

test("realtime policies keep every topic branch", () => {
  for (const policy of ["application_topic_read", "application_topic_send"]) {
    const start = sqlText.indexOf(`CREATE POLICY ${policy}`);
    assert.ok(start > 0, `${policy} must exist`);
    const body = sqlText.slice(start, sqlText.indexOf("ELSE false", start));
    for (const topic of ["presence:user", "presence:task", "project-stats", "chat:channel"]) {
      assert.ok(body.includes(`^${topic}:`), `${policy} keeps ${topic}`);
    }
    assert.equal(body.includes("^presence:conversation:"), false, `${policy} dropped the conversation topic`);
    assert.equal(body.includes("^chat:user:"), policy === "application_topic_read", `${policy} chat:user rule`);
  }
});

test("capacity limits are present", () => {
  assert.match(sqlText, />= 200 THEN/);
  assert.match(sqlText, /member_count > 100 THEN/);
});
