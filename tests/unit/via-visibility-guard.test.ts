import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { test } from "node:test";

// Report Part B, risk: a forgotten read path leaking "with Claude Code". Every file that reads via / agent_name
// (columns, raw SQL or an event's payload) must decide through src/lib/agents/via-visibility, unless listed here.
const ALLOWED: Record<string, string> = {
  "src/lib/agents/via-visibility.ts": "the rule itself",
  "src/lib/organizations/ai-labels.ts": "hand-in file labels and the roster's AI used column stay as they are (Part B item 3)",
  "src/lib/server/request-via.ts": "writes the record",
  "src/lib/agents/access-settings.ts": "agent sign-in names (extension_device_sessions), not labels on work",
  "src/lib/extension/device-codes.ts": "agent sign-in names (device codes), not labels on work",
};
const READS = [
  /\b(taskSubtasks|taskComments|fileVersions|tasks)\.(via|agentName)\b/,
  /\b[a-z_]+\.agent_name\b/,
  /\b[a-z_]+\.via\s*(=|IN\b)/,
  /\b(payload|metadata|meta|row|value)\??\.(via|agentName)\b/,
  /->>'(via|agentName)'/,
  // Whole rows carry the labels too (found in M4: task-detail sent subtasks with select()).
  /\.select\(\)\s*\.from\((taskSubtasks|taskComments|fileVersions)\)/,
  // A db.query read without `columns:` returns every column, labels included.
  /db\.query\.(taskSubtasks|taskComments|fileVersions)\.find(First|Many)\(\{(?:(?!columns:)[^;])*\}\)/,
];

function* files(dir: string): Generator<string> {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* files(full);
    else if (/\.(ts|tsx)$/.test(entry.name)) yield full;
  }
}

test("every read of an agent label goes through visibleVia", () => {
  const offenders: string[] = [];
  for (const file of files("src")) {
    const rel = file.split(path.sep).join("/");
    if (ALLOWED[rel] || rel.includes("/db/schema/")) continue;
    const text = fs.readFileSync(file, "utf8");
    if (READS.some((re) => re.test(text)) && !/@\/lib\/agents\/via-(scope|visibility)/.test(text)) offenders.push(rel);
  }
  assert.deepEqual(offenders, []);
});

test("the guard still sees the read paths it protects", () => {
  for (const rel of ["src/app/actions/files/versions.ts", "src/lib/domain/task-comments.ts", "src/app/actions/subtask.ts", "src/app/api/v1/events/route.ts"]) {
    const text = fs.readFileSync(rel, "utf8");
    assert.ok(READS.some((re) => re.test(text)), `${rel} reads labels`);
    assert.match(text, /@\/lib\/agents\/via-scope/, rel);
  }
});
