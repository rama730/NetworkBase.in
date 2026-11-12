// workspace view, activity, sprint list|view, update post, file history|move|rename|delete|attach|detach
// (report §17.4, A2.5, A8.7, D25).
import { CliError, EXIT, usage } from "../errors.mjs";
import { commentText, safe } from "../print/style.mjs";
import { confirm } from "../tui/ask.mjs";
import { formatDate, resolveTask, taskRef } from "./tasks.mjs";

/** @typedef {import("../context.mjs").Context} Context */

/** @param {Context} ctx */
export async function workspaceView(ctx) {
  // `nb workspace view deepscope-ai` names it directly, like -w (found live in M4a: the name was ignored).
  if (ctx.positionals[0]) {
    ctx.flags.workspace = ctx.positionals[0];
    await ctx.resolveWorkspace();
  }
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
export async function nodeOf(ctx, p) {
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
  const { c } = ctx.out;
  // Which version is active and what each was based on (C3), so "going back" reads plainly.
  ctx.out.result("nb.file.history/1", { path: remote(p), activeVersion: res.activeVersion ?? null, versions: res.versions }, (d) => [
    ...d.versions.map((/** @type {any} */ v) => `${v.version === d.activeVersion ? c.brand(ctx.out.sym.cursor) : " "} v${v.version}  ${c.muted(String(v.uploadedAt).slice(0, 16).replace("T", " "))}  ${v.uploadedByUsername ? `@${safe(v.uploadedByUsername)}` : safe(v.uploadedByName ?? "someone")}${v.via ? c.muted(` via ${v.via === "agent" ? safe(v.agentName ?? "an agent") : "CLI"}`) : ""}${v.basedOnVersion && v.basedOnVersion !== v.version - 1 ? c.muted(`  based on v${v.basedOnVersion}`) : ""}${v.version === d.activeVersion ? `  ${c.success("active")}` : ""}${v.comment ? `  ${safe(v.comment)}` : ""}`),
    ...(d.versions.length > 1 ? ["", c.muted(`  Go back: nb file use ${safe(d.path.slice(1))} v<n>`)] : []),
  ]);
}

/** `nb file use <file> v1` (C3): the app's "Use this version"; the next save is based on it. @param {Context} ctx */
export async function fileUse(ctx) {
  const [p, raw] = ctx.positionals;
  const version = Number(String(raw ?? "").replace(/^v/i, ""));
  if (!p || !Number.isInteger(version) || version < 1) throw usage("nb file use <path> v<n>", "See the versions: nb file history <path>");
  const node = await nodeOf(ctx, p);
  const res = /** @type {any} */ (await ctx.api.post("/api/v1/extension/file-history", { projectId: ctx.requireWorkspace(), nodeId: node.nodeId ?? node.id, version }));
  ctx.out.result("nb.file.use/1", { path: remote(p), activeVersion: res.activeVersion, previousVersion: res.previousVersion }, (d) => [
    d.previousVersion === d.activeVersion ? `v${d.activeVersion} of ${safe(d.path)} was already active` : `${ctx.out.c.success(ctx.out.sym.done)} v${d.activeVersion} of ${safe(d.path)} is active (was v${d.previousVersion}); the next save is based on it`,
    ctx.out.c.muted(`  nb pull gets it here · nb undo puts v${d.previousVersion} back`),
  ]);
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

// ───────────────────────────────── trash, restore, folders, copies, locks (report C3, M4b)

/** What's in the workspace Trash, with the days left before it's gone. @param {Context} ctx */
export async function fileTrash(ctx) {
  const { items } = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/files/trash`, { query: { q: ctx.positionals[0] } }));
  ctx.out.result("nb.file.trash/1", { items }, (d) => (d.items.length
    ? [...ctx.out.table([
        { title: "Path", value: (i) => safe(i.path), flex: true, path: true },
        { title: "Deleted", value: (i) => `${String(i.deletedAt).slice(0, 10)}${i.deletedBy ? ` by @${safe(i.deletedBy)}` : ""}`, optional: true },
        { title: "Days left", value: (i) => String(i.daysLeft), align: "right" },
      ], d.items), ctx.out.c.muted("  nb file restore <path> brings one back")]
    : "The Trash is empty"));
}

/** @param {Context} ctx */
export async function fileRestore(ctx) {
  const p = ctx.positionals[0];
  if (!p) throw usage("nb file restore <path>", "See what's there: nb file trash");
  const want = p.startsWith("/") ? p : `/${p}`;
  const { items } = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/files/trash`, { query: { q: want.split("/").pop() } }));
  const hit = items.find((/** @type {any} */ i) => i.path === want) ?? (items.length === 1 ? items[0] : null);
  if (!hit) throw new CliError("NOT_FOUND", `${want} isn't in the Trash`, { hint: "nb file trash" });
  await ctx.api.post("/api/v1/extension/file-operation", { kind: "restore", projectId: ctx.requireWorkspace(), nodeId: hit.nodeId });
  ctx.out.result("nb.file.restore/1", { path: hit.path }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Restored ${safe(d.path)} · nb pull gets it here`);
}

/** @param {Context} ctx */
export async function fileMkdir(ctx) {
  const p = ctx.positionals[0];
  if (!p) throw usage("nb file mkdir <folder>");
  const clean = remote(p.replace(/\/+$/, ""));
  const parentPath = clean.slice(0, clean.lastIndexOf("/")) || "/";
  const parentId = parentPath === "/" ? null : (await nodeOf(ctx, parentPath)).nodeId ?? null;
  const { folder } = /** @type {any} */ (await ctx.api.post("/api/v1/extension/file-operation", { kind: "mkdir", projectId: ctx.requireWorkspace(), parentId, name: clean.slice(clean.lastIndexOf("/") + 1) }));
  ctx.out.result("nb.file.mkdir/1", { path: folder.path }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Made ${safe(d.path)}/`);
}

/** A copy is a new file with the same content, placed like a push (every check applies). @param {Context} ctx */
export async function fileCopy(ctx) {
  const [from, to] = ctx.positionals;
  if (!from || !to) throw usage("nb file copy <file> <to>", "Like nb file copy report.md drafts/report-v2.md");
  const projectId = ctx.requireWorkspace();
  const source = remote(from);
  const target = to.endsWith("/") ? `${remote(to).replace(/\/+$/, "")}/${source.split("/").pop()}` : remote(to);
  const res = await ctx.api.download("/api/v1/extension/file", { projectId, path: source, transfer: "raw" });
  const bytes = Buffer.from(await res.arrayBuffer());
  const crypto = await import("node:crypto");
  const { mimeFor } = await import("../sync/transfer.mjs");
  const placed = /** @type {any} */ (await ctx.api.post("/api/v1/files/place", { projectId, onSameName: "keep-both", message: `Copy of ${source}`, files: [{ path: target, contentHash: crypto.createHash("sha256").update(bytes).digest("hex"), size: bytes.length, mimeType: mimeFor(target), contentBase64: bytes.toString("base64") }] }));
  const out = placed.files?.[0];
  ctx.out.result("nb.file.copy/1", { from: source, to: out?.path ?? target }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Copied ${safe(d.from)} to ${safe(d.to)}`);
}

/**
 * `nb file lock <file> [--for 30m]` (C3): the same lease as the app's editor, so teammates see you're editing. It
 * holds until Ctrl+C (or --for), renewing every minute, and lets go when it ends.
 * @param {Context} ctx
 */
export async function fileLock(ctx) {
  const p = ctx.positionals[0];
  if (!p) throw usage("nb file lock <path> [--for 30m]");
  const projectId = ctx.requireWorkspace();
  const node = await nodeOf(ctx, p);
  const nodeId = node.nodeId ?? node.id;
  const crypto = await import("node:crypto");
  const sessionId = crypto.randomUUID();
  const forText = ctx.flags.for ? String(ctx.flags.for) : null;
  const m = forText ? /^(\d+)\s*(s|m|h)$/.exec(forText) : null;
  if (forText && !m) throw usage("--for takes 30s, 10m or 2h");
  const holdMs = m ? Number(m[1]) * (m[2] === "h" ? 3_600_000 : m[2] === "m" ? 60_000 : 1000) : Infinity;
  const lease = /** @type {any} */ (await ctx.api.post(`/api/v1/files/${nodeId}/lock`, { projectId, sessionId, ttlSeconds: 120 }));
  const creds = () => ({ projectId, sessionId, leaseId: lease.leaseId ?? lease.id, fencingToken: lease.fencingToken });
  ctx.out.note(`${ctx.out.c.success(ctx.out.sym.done)} Locked ${safe(node.path ?? p)}: teammates see you're editing it${Number.isFinite(holdMs) ? ` for ${forText}` : " · Ctrl+C to let go"}`);
  const ends = Date.now() + holdMs;
  let stop = false;
  process.once("SIGINT", () => { stop = true; });
  while (!stop && Date.now() < ends) {
    await new Promise((r) => setTimeout(r, Math.min(1000, Math.max(0, ends - Date.now()))));
    if (!stop && Date.now() - (lease.renewedAt ?? lease.acquiredAt ?? 0) > 60_000) {
      const renewed = /** @type {any} */ (await ctx.api.post(`/api/v1/files/${nodeId}/lock-renew`, { ...creds(), ttlSeconds: 120 }).catch(() => null));
      lease.renewedAt = Date.now();
      if (renewed?.fencingToken) lease.fencingToken = renewed.fencingToken;
    }
  }
  await ctx.api.request("DELETE", `/api/v1/files/${nodeId}/lock`, { body: creds() }).catch(() => undefined);
  ctx.out.result("nb.file.lock/1", { path: node.path ?? p, released: true }, (d) => `Let go of ${safe(d.path)}`);
}

// ───────────────────────────────── updates (report C4, M4b)

/** The workspace's feed. @param {Context} ctx */
export async function updateList(ctx) {
  const data = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/updates`));
  const updates = (data.updates ?? []).map((/** @type {any} */ u, /** @type {number} */ i) => ({ n: i + 1, id: u.id, by: u.authorUsername ?? u.author?.username ?? u.authorName ?? u.author?.name ?? null, at: u.createdAt, text: String(u.content ?? u.body ?? ""), likes: u.likeCount ?? u.likes ?? 0, comments: u.commentCount ?? u.comments ?? 0, liked: Boolean(u.likedByViewer ?? u.liked) }));
  ctx.out.result("nb.update.list/1", { updates }, (d) => (d.updates.length
    ? d.updates.flatMap((/** @type {any} */ u) => [`${String(u.n).padStart(2)}  ${u.by ? `@${safe(u.by)}` : "someone"} ${ctx.out.c.muted(formatDate(u.at))}  ${ctx.out.c.muted(`♥ ${u.likes} · ${u.comments} comments`)}`, `    ${commentText(u.text).replace(/\s+/g, " ").slice(0, 160)}`])
      .concat(ctx.out.c.muted("  nb update like <n> · nb update comment <n> -m text · nb update view <n>"))
    : "No updates yet · nb update post -m \"…\""));
}

/** @param {Context} ctx */
async function updateByRef(ctx) {
  const ref = ctx.positionals[0];
  if (!ref) throw usage("Which update?", "The numbers are in nb update list");
  const data = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/updates`));
  const list = data.updates ?? [];
  const hit = /^\d+$/.test(ref) ? list[Number(ref) - 1] : list.find((/** @type {any} */ u) => String(u.id).startsWith(ref));
  if (!hit) throw new CliError("NOT_FOUND", `No update ${ref}`, { hint: "nb update list" });
  return hit;
}

/** One update and its comments. @param {Context} ctx */
export async function updateView(ctx) {
  const u = await updateByRef(ctx);
  const data = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/updates/${u.id}`));
  const comments = (data.comments ?? []).map((/** @type {any} */ c) => ({ by: c.authorUsername ?? c.author?.username ?? c.authorName ?? null, text: String(c.content ?? c.body ?? "") }));
  ctx.out.result("nb.update.view/1", { id: u.id, text: String(u.content ?? u.body ?? ""), comments }, (d) => [commentText(d.text), "", ...(d.comments.length ? d.comments.map((/** @type {any} */ c) => `  ${c.by ? `@${safe(c.by)}` : "someone"}: ${commentText(c.text)}`) : [ctx.out.c.muted("  No comments yet")])]);
}

/** Like (or unlike) an update. @param {Context} ctx */
export async function updateLike(ctx) {
  const u = await updateByRef(ctx);
  const res = /** @type {any} */ (await ctx.api.post(`/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/updates/${u.id}`, { kind: "like" }));
  const liked = res?.liked ?? res?.viewerHasLiked ?? !u.likedByViewer;
  ctx.out.result("nb.update.like/1", { id: u.id, liked: Boolean(liked) }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} ${d.liked ? "Liked" : "Unliked"} the update`);
}

/** Comment on an update (everyone in the workspace sees it). @param {Context} ctx */
export async function updateComment(ctx) {
  const u = await updateByRef(ctx);
  const text = String(ctx.flags.message ?? ctx.positionals.slice(1).join(" ")).trim();
  if (!text) throw usage('nb update comment <n> -m "text"');
  await ctx.api.post(`/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/updates/${u.id}`, { kind: "comment", text });
  ctx.out.result("nb.update.comment/1", { id: u.id }, () => `${ctx.out.c.success(ctx.out.sym.done)} Commented on the update`);
}
