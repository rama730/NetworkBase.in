import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const deletion = readFileSync("src/lib/storage/asset-deletion.ts", "utf8");

test("storage GC keeps assets posted in chat", () => {
  assert.match(deletion, /SELECT 1 FROM \$\{chatAttachments\}\s+WHERE \$\{chatAttachments\.assetId\} = \$\{storageAssets\.id\}/);
});

test("storage GC keeps a chat upload for an hour before it is sent", () => {
  assert.match(deletion, /\$\{storageAssets\.purpose\} = 'chat_attachment:file'\s+AND \$\{storageAssets\.createdAt\} > now\(\) - interval '1 hour'/);
});
