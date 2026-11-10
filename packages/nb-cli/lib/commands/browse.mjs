// workspace view, activity, sprint list|view, update post, file history|move|rename|delete|attach|detach
// (report §17.4, A2.5, A8.7, D25).
import { CliError, EXIT, usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { confirm } from "../tui/ask.mjs";
import { formatDate, resolveTask, taskRef } from "./tasks.mjs";

/** @typedef {import("../context.mjs").Context} Context */

/** @param {Context} ctx */
export async function workspaceView(ctx) {
  const w = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}`));
  const { c } = ctx.out;
  ctx.out.result("nb.workspace.view/1", w, (d) => [
    `${c.brand(ctx.out.sym.brand)} ${c.bold(safe(d.title ?? ""))} ${c.muted(safe(d.slug ?? ""))}${d.organization ? c.muted(` · in ${safe(d.organization.title)}`) : ""}`,
    ...(d.description ? [`  ${safe(d.description)}`] : []),
    `  you      ${d.role}${d.canWrite ? "" : " (read only)"}`,
    `  tasks    ${d.openTasks} open`,
    `  files    ${d.files}`,
    ...(d.currentSprint ? [`  ${d.words.main.toLowerCase().padEnd(8)} ${safe(d.currentSprint.name)} · ends ${formatDate(d.currentSprint.endDate)}`] : []),
    `  agents   ${d.agents.paused ? c.warning("paused") : { ask_important: "ask for important changes", ask_all: "ask for everything", trust_drafts_docs: "trusted with drafts and docs" }[/** @type {string} */ (d.agents.policy)] ?? d.agents.policy}`,
  ]);
}

/** "1d", "3h", "30m" or a date → ISO. @param {string} since */
function sinceIso(since) {
  const m = /^(\d+)([mhdw])$/.exec(since);
  if (m) return new Date(Date.now() - Number(m[1]) * { m: 60_000, h: 3_600_000, d: 86_400_000, w: 604_800_000 }[/** @type {"m"} */ (m[2])]).toISOString();
  if (!Number.isNaN(Date.parse(since))) return new Date(since).toISOString();
  throw usage("--since takes 30m, 3h, 1d, 2w or a date");
}

/** @param {Context} ctx */
export async function activity(ctx) {
  const taskId = ctx.flags.task ? (await resolveTask(ctx, String(ctx.flags.task))).id : undefined;
  const res = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/activity`, { query: { ...(ctx.flags.since ? { since: sinceIso(String(ctx.flags.since)) } : {}), ...(taskId ? { task: taskId } : {}), limit: ctx.flags.limit ?? 30 } }));
  const { c } = ctx.out;
  ctx.out.result("nb.activity/1", res, (d) =>
    d.items.length
      ? d.items.map((/** @type {any} */ i) => `  ${c.muted(i.at.slice(5, 16).replace("T", " "))}  ${i.by ? `@${safe(i.by)}` : "someone"}${i.via ? c.muted(` via ${i.via === "agent" ? safe(i.agentName ?? "an agent") : "CLI"}`) : ""}  ${i.type.replace(/_/g, " ")}  ${i.kind === "task" ? `#${i.task.number} ${safe(i.task.title)}` : safe(i.path ?? "")}${i.detail ? c.muted(` ${safe(i.detail)}`) : ""}`)
      : "Nothing happened in that time");
}

/** @param {Context} ctx */
export async function sprintList(ctx) {
  const res = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/sprints`));
  ctx.out.result("nb.sprint.list/1", res, (d) =>
    d.sprints.length
      ? [...ctx.out.table([
          { title: d.words.main, value: (s) => safe(s.name), flex: true },
          { title: "Status", value: (s) => s.status },
          { title: "Ends", value: (s) => formatDate(s.endDate) },
          { title: "Open", value: (s) => String(s.open), align: "right" },
          { title: "Done", value: (s) => String(s.done), align: "right", optional: true },
        ], d.sprints), ctx.out.c.muted(`  ${d.unplanned} open task${d.unplanned === 1 ? "" : "s"} not in any ${d.words.main.toLowerCase()}`)]
      : `No ${d.words.main.toLowerCase()}s yet`);
}

/** @param {Context} ctx */
export async function sprintView(ctx) {
  const name = ctx.positionals.join(" ").trim().toLowerCase();
  if (!name) throw usage("nb sprint view <name or number>");
  const base = `/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/sprints`;
  const { sprints, words } = /** @type {any} */ (await ctx.api.get(base));
  const hit = sprints.find((/** @type {any} */ s) => String(s.number) === name || String(s.name).toLowerCase() === name) ?? sprints.find((/** @type {any} */ s) => String(s.name).toLowerCase().includes(name));
  if (!hit) throw new CliError("NOT_FOUND", `No ${words.main.toLowerCase()} called ${name}`, { hint: "nb sprint list" });
  const res = /** @type {any} */ (await ctx.api.get(base, { query: { sprint: hit.id } }));
  ctx.out.result("nb.sprint.view/1", { sprint: hit, tasks: res.tasks }, (d) => [
    `${ctx.out.c.bold(safe(d.sprint.name))} ${ctx.out.c.muted(`${d.sprint.status} · ${formatDate(d.sprint.startDate)} → ${formatDate(d.sprint.endDate)}`)}`,
    ...(d.sprint.goal ? [`  ${safe(d.sprint.goal)}`] : []),
    ...d.tasks.map((/** @type {any} */ t) => `  #${t.number} ${safe(t.title)} ${ctx.out.c.muted(t.status.replace("_", " "))}`),
  ]);
}

/** @param {Context} ctx */
export async function updatePost(ctx) {
  const content = String(ctx.flags.message ?? ctx.positionals.join(" ")).trim();
  if (!content) throw usage('nb update post -m "What happened this week"');
  if (!(await confirm(ctx, { key: "post", heldByServer: true, question: "Post this update? Everyone in the workspace sees it.", preview: content, yesLabel: "Post", defaultYes: true }))) return EXIT.cancelled;
  await ctx.api.post(`/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/updates`, { content });
  ctx.out.result("nb.update.post/1", { posted: true }, () => `${ctx.out.c.success(ctx.out.sym.done)} Posted the update`);
}

/** @param {string} p */
const remote = (p) => `/${p.replace(/^\/+/, "")}`;

/** @param {Context} ctx @param {string} p */
async function nodeOf(ctx, p) {
  return /** @type {any} */ (await ctx.api.get("/api/v1/extension/file", { query: { projectId: ctx.requireWorkspace(), path: remote(p), transfer: "metadata" } }).catch((error) => {
    if (error instanceof CliError && error.status === 404) throw new CliError("NOT_FOUND", `No file ${remote(p)} in this workspace`);
    throw error;
  }));
}

/** @param {Context} ctx */
export async function fileHistory(ctx) {
  const p = ctx.positionals[0];
  if (!p) throw usage("nb file history <path>");
  const node = await nodeOf(ctx, p);
  const res = /** @type {any} */ (await ctx.api.get("/api/v1/extension/file-history", { query: { projectId: ctx.requireWorkspace(), nodeId: node.nodeId ?? node.id } }));
  ctx.out.result("nb.file.history/1", { path: remote(p), versions: res.versions }, (d) =>
    d.versions.map((/** @type {any} */ v) => `  v${v.version}  ${ctx.out.c.muted(String(v.uploadedAt).slice(0, 16).replace("T", " "))}  ${v.uploadedByUsername ? `@${safe(v.uploadedByUsername)}` : safe(v.uploadedByName ?? "someone")}${v.via ? ctx.out.c.muted(` via ${v.via === "agent" ? safe(v.agentName ?? "an agent") : "CLI"}`) : ""}${v.comment ? `  ${safe(v.comment)}` : ""}`));
}

/** @param {Context} ctx @param {"move" | "rename" | "trash"} kind */
async function fileOperation(ctx, kind) {
  const [p, target] = ctx.positionals;
  if (!p || (kind !== "trash" && !target)) throw usage(kind === "move" ? "nb file move <path> <folder>" : kind === "rename" ? "nb file rename <path> <new name>" : "nb file delete <path>");
  const node = await nodeOf(ctx, p);
  const question = kind === "trash" ? `Move ${remote(p)} to the workspace Trash?` : kind === "move" ? `Move ${remote(p)} to ${remote(String(target))}?` : `Rename ${remote(p)} to ${target}?`;
  if (!(await confirm(ctx, { key: kind, heldByServer: true, question, yesLabel: kind === "trash" ? "Move to Trash" : "Yes", defaultYes: kind !== "trash" }))) return EXIT.cancelled;
  let parentId = null;
  if (kind === "move" && remote(String(target)) !== "/") parentId = (await nodeOf(ctx, String(target).replace(/\/+$/, ""))).nodeId ?? null;
  await ctx.api.post("/api/v1/extension/file-operation", {
    kind, projectId: ctx.requireWorkspace(), nodeId: node.nodeId ?? node.id, expectedUpdatedAt: new Date(node.updatedAt).toISOString(),
    ...(kind === "move" ? { parentId } : kind === "rename" ? { name: String(target) } : {}),
  });
  ctx.out.result(`nb.file.${kind}/1`, { path: remote(p) }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} ${kind === "trash" ? "Moved to Trash" : kind === "move" ? "Moved" : "Renamed"} ${safe(d.path)}`);
}
/** @param {Context} ctx */
export const fileMove = (ctx) => fileOperation(ctx, "move");
/** @param {Context} ctx */
export const fileRename = (ctx) => fileOperation(ctx, "rename");
/** @param {Context} ctx */
export const fileDelete = (ctx) => fileOperation(ctx, "trash");

/** @param {Context} ctx @param {boolean} detach */
async function attach(ctx, detach) {
  const p = ctx.positionals[0];
  if (!p) throw usage(detach ? "nb file detach <path> --task 4" : "nb file attach <path> --task 4 [--as reference|draft|final]");
  const as = ctx.flags.as ?? "draft";
  if (!["reference", "draft", "final"].includes(as)) throw usage("--as must be reference, draft or final");
  const task = await resolveTask(ctx, taskRef(ctx, undefined));
  await ctx.api.post(`/api/v1/tasks/${task.id}/files`, { projectId: ctx.requireWorkspace(), path: remote(p), as, ...(detach ? { detach: true } : {}) });
  ctx.out.result(detach ? "nb.file.detach/1" : "nb.file.attach/1", { path: remote(p), number: task.taskNumber, as }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} ${detach ? `Took ${safe(d.path)} off #${d.number}` : `Attached ${safe(d.path)} to #${d.number} as ${d.as}`}`);
}
/** @param {Context} ctx */
export const fileAttach = (ctx) => attach(ctx, false);
/** @param {Context} ctx */
export const fileDetach = (ctx) => attach(ctx, true);
