import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
import { test } from "node:test";

import { buildEmail } from "@/lib/email/contracts";

// Welcome and Task assigned share renderEmailShell (report §26.5). These snapshots were taken from the
// templates before the shell was pulled out, with developer HTML comments removed; refresh with UPDATE_EMAIL_SNAPSHOTS=1.
process.env.APP_URL = "https://networkbase.in";
const cases = {
  welcome: () => buildEmail({ kind: "welcome", email: "ada@example.com", name: "Ada <Lovelace>", username: "ada", headline: "Engineer & writer", skills: ["TypeScript", "Postgres", "Design"], userId: "u-1" }),
  task: () => buildEmail({
    kind: "task_assignment", email: "ada@example.com", name: "Ada", taskTitle: "Ship <it>", projectTitle: "Compiler & Lab",
    taskId: "t-1", projectSlug: "compiler-lab", taskNumber: 42, priority: "high", status: "in_progress",
    taskDescription: "Line one\nline two", assigneeName: "Ada", assigneeUsername: "ada", assigneeHeadline: "Engineer", assigneeId: "u-1",
    assignerName: "Ravi", assignerUsername: "ravi", connectedDesktopIde: { name: "Cursor", scheme: "cursor" },
    subtasks: [{ id: "s1", title: "Read", completed: true, files: [{ name: "notes.pdf", size: 2048, url: "https://x/notes.pdf" }] }, { id: "s2", title: "Write", completed: false }],
    files: [{ name: "starter.zip", size: 240000, url: "https://x/starter.zip" }, { name: "plain.txt" }],
  }),
  taskMinimal: () => buildEmail({ kind: "task_assignment", email: "ada@example.com", name: "Ada", taskId: "t-2", projectSlug: "p" }),
};

for (const [name, build] of Object.entries(cases)) {
  test(`${name} email renders exactly as before the shared shell`, () => {
    const file = new URL(`../fixtures/email/${name}.json`, import.meta.url);
    const email = build();
    if (process.env.UPDATE_EMAIL_SNAPSHOTS === "1") {
      const html = email.html.replace(/^[ \t]*<!-- (?!\[)[^\n]*-->\n/gm, "");
      writeFileSync(file, `${JSON.stringify({ ...email, html }, null, 2)}\n`);
    }
    assert.deepEqual(email, JSON.parse(readFileSync(file, "utf8")));
  });
}
