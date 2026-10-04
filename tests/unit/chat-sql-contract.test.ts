import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sqlText = readFileSync("drizzle/0180_chat_rebuild_additive.sql", "utf8");

const definers = [...sqlText.matchAll(/CREATE OR REPLACE FUNCTION ([\w.]+)\(([\s\S]*?)\)\s*RETURNS[\s\S]*?AS \$\$/g)];

test("every chat function lives in app_private as SECURITY DEFINER with an empty search_path", () => {
  assert.ok(definers.length >= 25, `expected the chat function set, found ${definers.length}`);
  for (const match of definers) {
    const [block, name] = match;
    assert.match(name, /^app_private\.chat_/, `${name} must be in app_private`);
    assert.match(block, /SECURITY DEFINER/, `${name} must be SECURITY DEFINER`);
    assert.match(block, /SET search_path = ''/, `${name} must pin search_path`);
  }
});

test("chat functions are revoked from browser roles and granted to service_role", () => {
  assert.match(sqlText, /REVOKE ALL ON FUNCTION %s FROM PUBLIC/);
  assert.match(sqlText, /REVOKE ALL ON FUNCTION %s FROM anon, authenticated/);
  assert.match(sqlText, /GRANT EXECUTE ON FUNCTION %s TO service_role/);
  const authenticatedGrants = [...sqlText.matchAll(/GRANT EXECUTE ON FUNCTION (app_private\.\w+)\([^)]*\) TO authenticated/g)].map((m) => m[1]);
  assert.deepEqual(authenticatedGrants.sort(), ["app_private.chat_is_member", "app_private.chat_is_project_member"]);
});

test("browser roles only read chat tables; no write policies exist", () => {
  assert.doesNotMatch(sqlText, /CREATE POLICY \w+ ON public\.chat_\w+ FOR (INSERT|UPDATE|DELETE|ALL)/);
  const selectPolicies = [...sqlText.matchAll(/CREATE POLICY (chat_\w+) ON public\.chat_\w+ FOR SELECT TO authenticated/g)];
  assert.equal(selectPolicies.length, 10);
  assert.match(sqlText, /REVOKE ALL ON public\.chat_channels, [^;]+ FROM anon, authenticated;/);
  assert.match(sqlText, /GRANT SELECT ON public\.chat_channels, [^;]+ TO authenticated;/);
});

test("messages, attachments and reactions are hash-partitioned 32 ways with locked-down partitions", () => {
  for (const table of ["chat_messages", "chat_attachments", "chat_reactions"]) {
    assert.match(sqlText, new RegExp(`CREATE TABLE IF NOT EXISTS public\\.${table} \\([\\s\\S]*?\\) PARTITION BY HASH \\(channel_id\\);`));
  }
  assert.match(sqlText, /ARRAY\['chat_messages', 'chat_attachments', 'chat_reactions'\]/);
  assert.match(sqlText, /FOR i IN 0\.\.31 LOOP/);
  assert.match(sqlText, /MODULUS 32, REMAINDER %s/);
  assert.match(sqlText, /'ALTER TABLE public\.%I ENABLE ROW LEVEL SECURITY', part/);
  assert.match(sqlText, /'REVOKE ALL ON public\.%I FROM anon, authenticated', part/);
});

test("hot rows stay HOT: fillfactor set and hot columns never indexed", () => {
  assert.match(sqlText, /\) WITH \(fillfactor = 70\);/);
  assert.match(sqlText, /\) WITH \(fillfactor = 80\);/);
  const indexLines = sqlText.split("\n").filter((line) => /CREATE (UNIQUE )?INDEX/.test(line) && /chat_channels /.test(line));
  for (const line of indexLines) {
    assert.doesNotMatch(line, /last_seq|last_top_seq|last_message_at|last_preview|member_count/, line);
  }
});

test("the send path is one function with no trigger on chat tables", () => {
  assert.doesNotMatch(sqlText, /CREATE TRIGGER \w+\s+(BEFORE|AFTER)[\s\S]{0,80}ON public\.chat_/);
  assert.match(sqlText, /FUNCTION app_private\.chat_send_message\(/);
  assert.match(sqlText, /FOR UPDATE;/, "the channel row lock allocates channel_seq");
});

test("realtime policies keep every 0160 branch and add the chat topics", () => {
  for (const policy of ["application_topic_read", "application_topic_send"]) {
    const start = sqlText.indexOf(`CREATE POLICY ${policy}`);
    assert.ok(start > 0, `${policy} must be recreated`);
    const body = sqlText.slice(start, sqlText.indexOf("ELSE FALSE", start));
    for (const topic of ["presence:user", "presence:conversation", "presence:task", "project-stats", "chat:channel"]) {
      assert.ok(body.includes(`^${topic}:`), `${policy} keeps ${topic}`);
    }
    assert.equal(body.includes("^chat:user:"), policy === "application_topic_read", `${policy} chat:user rule`);
  }
});

test("constants and ledger markers are present", () => {
  for (const marker of ["(L-17)", "(L-18)", "(L-19)", "(L-21)", "(L-13)", "(L-2)", "(L-15)", "(L-6)", "(L-30)"]) {
    assert.ok(sqlText.includes(marker), `missing ponytail marker ${marker}`);
  }
  assert.match(sqlText, />= 200 THEN/);
  assert.match(sqlText, /> 500 THEN/);
  assert.match(sqlText, /member_count > 100 THEN/);
});
