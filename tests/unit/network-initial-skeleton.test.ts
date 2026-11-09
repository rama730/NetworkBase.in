import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// Unified back B11: coming back to Network with its people already loaded shows them at once.
test("Network shows its skeleton only when nothing is in memory", () => {
  const src = fs.readFileSync("src/components/network/NetworkClient.tsx", "utf8");
  assert.match(src, /\(isAuthed \|\| activeTab === "suggested"\) &&\s*!queryClient\.getQueriesData\(\{ queryKey: queryKeys\.connections\.root\(\) \}\)/);
});
