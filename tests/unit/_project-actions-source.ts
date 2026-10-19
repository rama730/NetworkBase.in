import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// The project server actions are thin wrappers (src/app/actions/project/index.ts) over server-only
// modules (src/lib/projects/server/*). Source-contract tests read both as one text, implementations first.
const SERVER_DIR = "src/lib/projects/server";

export function projectActionsSource(root = process.cwd()) {
  const modules = readdirSync(join(root, SERVER_DIR)).filter((name) => name.endsWith(".ts")).sort();
  return [...modules.map((name) => readFileSync(join(root, SERVER_DIR, name), "utf8")), readFileSync(join(root, "src/app/actions/project/index.ts"), "utf8")].join("\n");
}
