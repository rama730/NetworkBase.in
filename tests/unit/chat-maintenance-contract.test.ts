import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const maintenance = readFileSync("src/lib/messaging/maintenance.ts", "utf8");
const jobs = readFileSync("src/inngest/functions/chat-maintenance.ts", "utf8");
const registry = readFileSync("src/inngest/registry.ts", "utf8");

test("chat drift is observed without an automatic repair loop", () => {
  const audit = maintenance.slice(maintenance.indexOf("export async function auditChatIntegrity"));
  assert.match(audit, /TABLESAMPLE/);
  assert.doesNotMatch(audit, /\bUPDATE\b|\bDELETE\b|\bINSERT\b/);
  assert.match(registry, /chatIntegrityAudit/);
});

test("mention retention deletes in bounded batches and is registered", () => {
  assert.match(maintenance, /CHAT_MENTION_RETENTION_DAYS = 90/);
  assert.match(maintenance, /LIMIT \$\{limit\}/);
  assert.match(jobs, /purgeOldChatMentions\(5_000\)/);
  assert.match(registry, /chatMentionsRetention/);
  assert.doesNotMatch(registry, /messageAttachmentRetention|messageDataIntegrityAudit/);
});
