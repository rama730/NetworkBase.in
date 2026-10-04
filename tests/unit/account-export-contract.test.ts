import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

import { toAccountExportMessage } from "@/lib/account/export-contract";

// Report 5.E: the export holds the account holder's own messages plus channel
// names, and nothing another person wrote.

test("export rows carry the author's own body, channel name and time", () => {
  const row = toAccountExportMessage({
    channelId: "c1",
    channelName: "general",
    channelKind: "public",
    seq: 7,
    body: "my message",
    createdAt: new Date("2026-09-30T00:00:00.000Z"),
    editedAt: null,
    deletedAt: null,
  });
  assert.deepEqual(row, {
    channel: "#general",
    channelId: "c1",
    seq: 7,
    body: "my message",
    createdAt: "2026-09-30T00:00:00.000Z",
    editedAt: null,
  });
});

test("DMs export without naming the other person; deleted messages export empty", () => {
  const row = toAccountExportMessage({
    channelId: "d1", channelName: null, channelKind: "dm", seq: 1, body: "", createdAt: new Date(0), editedAt: null, deletedAt: new Date(0),
  });
  assert.equal(row.channel, "Direct message");
  assert.equal(row.body, null);
});

test("the export stream reads only messages the user authored", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "src/lib/account/export-stream.ts"), "utf8");
  assert.match(source, /chat_messages[\s\S]*author_id = \$\{userId\}/);
  assert.doesNotMatch(source, /chat_channel_members|conversation/);
});
