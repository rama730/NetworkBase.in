// The action's step (report F6): picks the task, then runs the published CLI. Exit codes are the CLI's.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

import { taskFromPullRequest } from "./task.mjs";

const env = process.env;
const event = env.GITHUB_EVENT_PATH && fs.existsSync(env.GITHUB_EVENT_PATH) ? JSON.parse(fs.readFileSync(env.GITHUB_EVENT_PATH, "utf8")) : {};
const task = env.NB_TASK || taskFromPullRequest(event.pull_request ?? null);
if (!task) {
  console.log("::notice::No NetworkBase task named (\"Closes #4\" in the pull request, or a branch nb/4-…); nothing to do.");
  process.exit(0);
}
if (env.NB_ACTION === "done" && event.pull_request && !event.pull_request.merged) {
  console.log(`::notice::The pull request wasn't merged; task #${task} stays as it is.`);
  process.exit(0);
}
const nb = (/** @type {string[]} */ args) => execFileSync("npx", ["-y", "@networkbase/cli@2", ...args, "--yes", "-w", env.NB_WORKSPACE ?? ""], { stdio: "inherit", env: { ...env, NB_API_URL: env.NB_SERVER || "https://networkbase.in" } });
if (env.NB_ACTION === "push") {
  const paths = String(env.NB_PATHS ?? "").split(/\s+/).filter(Boolean);
  if (!paths.length) { console.log("::error::push needs paths"); process.exit(2); }
  nb(["push", ...paths, "--task", String(task), "--as", env.NB_AS || "draft"]);
} else if (env.NB_ACTION === "done") {
  nb(["task", "done", String(task), "-m", `Merged ${event.pull_request?.html_url ?? "on GitHub"}`]);
} else {
  console.log("::error::action is push or done");
  process.exit(2);
}
if (env.GITHUB_OUTPUT) fs.appendFileSync(env.GITHUB_OUTPUT, `task=${task}\n`);
