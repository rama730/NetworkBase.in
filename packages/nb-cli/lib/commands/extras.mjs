// Phase 6 extras (report findings 146, 148, 149): git branches and commit trailers, saved task filters, and many
// tasks from one Markdown file. git runs with execFile (no shell); nothing here installs hooks (D6).
import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { readUserConfig, writeUserConfig } from "../config.mjs";
import { CliError, EXIT, usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { confirm } from "../tui/ask.mjs";

/** @typedef {import("../context.mjs").Context} Context */

/** @param {string} cwd @param {string[]} args @returns {Promise<string>} */
export const git = (cwd, args) => new Promise((resolve, reject) => execFile("git", args, { cwd, windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (error, stdout, stderr) => (error ? reject(new CliError("GIT_FAILED", `git ${args[0]}: ${String(stderr || error.message).trim()}`)) : resolve(String(stdout)))));

/** `nb/4-fix-login` (finding 146). @param {number | string} number @param {string} title */
export const branchName = (number, title) => `nb/${number}-${String(title).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "task"}`;

/** Switches to the task's branch, creating it the first time. @param {string} cwd @param {string} name */
export async function switchToBranch(cwd, name) {
  const exists = await git(cwd, ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`]).then(() => true, () => false);
  await git(cwd, exists ? ["switch", name] : ["switch", "-c", name]);
  return exists ? "switched" : "created";
}

/** `NetworkBase-Task: 4` in a commit message (finding 146). @param {string} message */
export const taskTrailer = (message) => /^NetworkBase-Task:\s*#?(\d+)\s*$/im.exec(message)?.[1] ?? null;

/**
 * `nb push --from-git`: the files the last commit changed, its subject as the message, and its NetworkBase-Task
 * trailer as the task. Returns paths relative to `cwd`. @param {string} cwd
 */
export async function filesFromLastCommit(cwd) {
  // This folder's place in the repository, from git itself ("" at the top, else "sub/dir/"). Comparing absolute
  // paths broke on Windows, where git prints C:/Users/runneradmin/… and Node C:\Users\RUNNER~1\….
  const prefix = (await git(cwd, ["rev-parse", "--show-prefix"])).trim();
  const names = (await git(cwd, ["diff-tree", "--no-commit-id", "--name-only", "--diff-filter=ACMR", "-r", "HEAD"])).split("\n").filter(Boolean);
  const message = await git(cwd, ["log", "-1", "--format=%B"]);
  return {
    paths: names.filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length))
      // git never lists ".." or absolute names; checked anyway so nothing outside this folder is ever pushed.
      .filter((n) => n && !n.startsWith("/") && !n.split("/").includes(".."))
      .map((n) => n.split("/").join(path.sep)).filter((p) => fs.existsSync(path.join(cwd, p))),
    subject: message.split("\n")[0]?.trim() ?? "",
    task: taskTrailer(message),
  };
}

// ───────────────────────────────── saved filters (finding 148)

const FILTER_KEYS = ["mine", "all", "status", "limit", "due", "to", "sprint", "priority", "sort", "label", "starred"];

/** `--save <name>` stores the list flags; `@name` brings them back. @param {Context} ctx */
export function applySavedFilter(ctx) {
  const at = ctx.positionals.find((p) => p.startsWith("@"));
  const config = readUserConfig(ctx.env);
  /** @type {Record<string, Record<string, unknown>>} */
  const filters = config.filters ?? {};
  if (at) {
    const saved = filters[at.slice(1)];
    if (!saved) throw usage(`No saved filter ${at}`, Object.keys(filters).length ? `Saved: ${Object.keys(filters).map((f) => `@${f}`).join(", ")}` : "Save one: nb task list --status todo --save todo");
    for (const [k, v] of Object.entries(saved)) if (ctx.flags[k] === undefined) ctx.flags[k] = v;
  }
  if (ctx.flags.save) {
    const name = String(ctx.flags.save).replace(/^@/, "");
    if (!/^[\w-]{1,40}$/.test(name)) throw usage("A filter name is letters, numbers, - and _");
    writeUserConfig({ ...config, filters: { ...filters, [name]: Object.fromEntries(FILTER_KEYS.filter((k) => ctx.flags[k] !== undefined).map((k) => [k, ctx.flags[k]])) } }, ctx.env);
    ctx.out.note(ctx.out.c.muted(`Saved as @${name}: nb task list @${name}`));
  }
}

// ───────────────────────────────── tasks from Markdown (finding 149)

/**
 * One task per `#`/`##` heading; the text under it is the description and `- [ ]` lines are its subtasks.
 * @param {string} text @returns {Array<{ title: string, description: string, subtasks: string[] }>}
 */
export function parseTasksMarkdown(text) {
  /** @type {Array<{ title: string, description: string[], subtasks: string[] }>} */
  const tasks = [];
  for (const line of text.replace(/\r\n/g, "\n").split("\n")) {
    const heading = /^#{1,3}\s+(.+?)\s*#*$/.exec(line);
    if (heading) { tasks.push({ title: String(heading[1]).trim(), description: [], subtasks: [] }); continue; }
    const current = tasks.at(-1);
    if (!current) continue;
    const box = /^\s*[-*]\s+\[[ xX]\]\s+(.+)$/.exec(line);
    if (box) current.subtasks.push(String(box[1]).trim());
    else current.description.push(line);
  }
  return tasks.filter((t) => t.title).map((t) => ({ title: t.title.slice(0, 200), description: t.description.join("\n").trim(), subtasks: t.subtasks }));
}

/** `nb task create --from tasks.md`: one preview, one yes, then each task (finding 149). @param {Context} ctx @param {string} file */
export async function createFromMarkdown(ctx, file) {
  const abs = path.resolve(ctx.cwd, file);
  if (!fs.existsSync(abs)) throw usage(`No file ${file}`);
  const tasks = parseTasksMarkdown(fs.readFileSync(abs, "utf8"));
  if (!tasks.length) throw usage(`${file} has no headings`, "Write one task per heading (# Title), with - [ ] lines for subtasks");
  if (tasks.length > 50) throw usage(`${file} has ${tasks.length} tasks; 50 at a time`);
  const preview = tasks.map((t) => `${t.title}${t.subtasks.length ? ` (${t.subtasks.length} subtasks)` : ""}`).join("\n");
  if (!(await confirm(ctx, { key: "create", question: `Create ${tasks.length} task${tasks.length === 1 ? "" : "s"}?`, preview, yesLabel: "Create", defaultYes: true }))) return EXIT.cancelled;
  const projectId = ctx.requireWorkspace();
  /** @type {Array<{ number: number, title: string }>} */
  const made = [];
  for (const t of tasks) {
    const res = /** @type {any} */ (await ctx.api.post("/api/v1/extension/create-task", { projectId, title: t.title, ...(t.description ? { description: t.description.slice(0, 10000) } : {}) }));
    const task = res.task ?? res;
    for (const sub of t.subtasks) await ctx.api.post("/api/v1/extension/task-subtask", { projectId, taskId: task.id, title: sub.slice(0, 200) });
    made.push({ number: task.taskNumber, title: task.title ?? t.title });
  }
  ctx.out.result("nb.task.create.many/1", { tasks: made }, (d) => [`${ctx.out.c.success(ctx.out.sym.done)} Created ${d.tasks.length} tasks`, ...d.tasks.map((t) => `  #${t.number} ${safe(t.title)}`)]);
  return EXIT.ok;
}
