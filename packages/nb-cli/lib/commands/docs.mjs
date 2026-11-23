// Docs (the README), workspaces, search and reading remote files (report §17.4, §18.2 "change the workspace README", §21 flow C).
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readUserConfig } from "../config.mjs";
import { CliError, EXIT, usage } from "../errors.mjs";
import { commentText, safe } from "../print/style.mjs";
import { unifiedDiff } from "../sync/diff.mjs";
import { fetchManifest } from "../sync/transfer.mjs";
import { confirm } from "../tui/ask.mjs";
import { formatWhen, resolveTask } from "./tasks.mjs";

/** @typedef {import("../context.mjs").Context} Context */

/** @param {Context} ctx @param {string} slug */
async function readDoc(ctx, slug) {
  const workspaceId = ctx.requireWorkspace();
  return /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/docs/${encodeURIComponent(slug)}`).catch((error) => {
    if (error instanceof CliError && error.status === 404) throw new CliError("DOC_NOT_FOUND", `No doc called ${slug} here`, { hint: "See nb doc list" });
    throw error;
  }));
}

/** @param {Context} ctx */
export async function list(ctx) {
  const workspaceId = ctx.requireWorkspace();
  const { docs } = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/docs`));
  ctx.out.result("nb.doc.list/1", { docs }, (d) => {
    if (!d.docs.length) return "No docs yet";
    // The slug column fits the longest slug, so a long one does not push its file name out of line.
    const width = Math.max(...d.docs.map((/** @type {any} */ doc) => safe(doc.slug).length)) + 2;
    return d.docs.map((/** @type {any} */ doc) => `  ${safe(doc.slug).padEnd(width)}${ctx.out.c.muted(safe(doc.filename ?? ""))}`);
  });
}

/** @param {Context} ctx */
export async function view(ctx) {
  const doc = await readDoc(ctx, ctx.positionals[0] ?? "readme");
  if (ctx.out.json) return ctx.out.result("nb.doc.view/1", doc, () => null);
  if (ctx.flags.raw || !process.stdout.isTTY) {
    ctx.out.raw(doc.content);
    if (!String(doc.content).endsWith("\n")) ctx.out.raw("\n");
    return;
  }
  ctx.out.result("nb.doc.view/1", doc, (d) => safe(d.content), { page: true });
}

/** The editor for doc edits: setting, then VISUAL / EDITOR, then a sensible default. @param {Context} ctx */
function editorCommand(ctx) {
  return ctx.env.NB_EDITOR || readUserConfig(ctx.env).editor || ctx.env.VISUAL || ctx.env.EDITOR || (process.platform === "win32" ? "notepad" : "vi");
}

/**
 * Edits a doc in your editor and saves it as a new version of its file, based on the version you opened:
 * a teammate's newer save is a conflict, not an overwrite (A1.8). Needs doc:write for tokens (D16).
 * @param {Context} ctx
 */
export async function edit(ctx) {
  const slug = ctx.positionals[0] ?? "readme";
  const doc = await readDoc(ctx, slug);
  if (!doc.canEdit) throw new CliError("FORBIDDEN", `You can read ${slug} but not edit it`, { hint: "Only the workspace owner and admins can edit it, unless its settings let members edit" });
  if (!ctx.out.interactive) throw new CliError("NEEDS_INPUT", "nb doc edit opens your editor, so it needs a terminal", { hint: `Agents: nb doc set ${slug} --file <path>` });
  // The file name comes from the server, so only plain characters reach the editor's command line.
  const name = path.posix.basename(doc.file?.path ?? doc.filename ?? "doc.md").replace(/[^A-Za-z0-9._-]/g, "_").replace(/^\.+/, "") || "doc.md";
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nb-doc-")), name);
  fs.writeFileSync(tmp, doc.content);
  const [cmd, ...args] = editorCommand(ctx).split(" ");
  // Windows editors are often .cmd files, which need the shell; the path is quoted for it.
  const win = process.platform === "win32";
  const run = spawnSync(/** @type {string} */ (cmd), [...args, win ? `"${tmp}"` : tmp], { stdio: "inherit", shell: win });
  if (run.status !== 0) throw new CliError("EDITOR_FAILED", `The editor exited with ${run.status ?? run.signal}`);
  const next = fs.readFileSync(tmp, "utf8");
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  return saveDoc(ctx, slug, doc, next);
}

/**
 * Replaces a doc's Markdown without an editor (scripts and agents): from --file, stdin (--file -), or the
 * MCP tool's content. Same diff preview, yes and conflict rules as nb doc edit.
 * @param {Context} ctx
 */
export async function set(ctx) {
  const slug = ctx.positionals[0] ?? "readme";
  const from = ctx.flags.file;
  const next = typeof ctx.flags.content === "string" ? ctx.flags.content : from === "-" ? fs.readFileSync(0, "utf8") : from ? fs.readFileSync(path.resolve(ctx.cwd, from), "utf8") : null;
  if (next === null) throw usage("nb doc set <slug> --file <path>, or --file - to read stdin");
  const doc = await readDoc(ctx, slug);
  if (!doc.canEdit) throw new CliError("FORBIDDEN", `You can read ${slug} but not edit it`, { hint: "Only the workspace owner and admins can edit it, unless its settings let members edit" });
  return saveDoc(ctx, slug, doc, next);
}

/** @param {Context} ctx @param {string} slug @param {any} doc @param {string} next */
async function saveDoc(ctx, slug, doc, next) {
  if (next === doc.content) {
    ctx.out.result("nb.doc.edit/1", { slug, changed: false }, () => "No changes");
    return EXIT.ok;
  }
  const diff = unifiedDiff(doc.content, next);
  const preview = diff?.lines.slice(0, 30).map((l) => `${l.kind === "@" ? "" : l.kind}${l.text}`).join("\n");
  // A doc with no file yet (a new workspace's starter README) gets one, named by the server, on its first save.
  const target = doc.file ?? { path: `/${String(doc.filename ?? "README.md").replace(/^\/+/, "")}`, nodeId: null, version: 0 };
  // The yes names the doc and its size (0.8 #13): "Change the README (+5 −2 lines)?".
  const name = slug === "readme" ? "the README" : slug;
  const added = diff?.lines.filter((l) => l.kind === "+").length ?? 0;
  const removed = diff?.lines.filter((l) => l.kind === "-").length ?? 0;
  const size = `(${[added ? `+${added}` : "", removed ? `−${removed}` : ""].filter(Boolean).join(" ") || "no"} lines)`;
  if (!(await confirm(ctx, { key: "save", heldByServer: true, question: doc.file ? `Change ${name} ${size}?` : `Add ${name} as ${target.path} ${size}?`, ...(preview ? { preview } : {}), yesLabel: "Save", defaultYes: true }))) return EXIT.cancelled;
  const bytes = Buffer.from(next, "utf8");
  const content = { contentHash: crypto.createHash("sha256").update(bytes).digest("hex"), size: bytes.length, mimeType: "text/markdown", contentBase64: bytes.toString("base64") };
  const res = /** @type {any} */ (await ctx.api.post("/api/v1/files/place", {
    projectId: ctx.requireWorkspace(),
    ...(ctx.flags.message ? { message: ctx.flags.message } : {}),
    ...(doc.file ? { files: [{ path: target.path, versionOf: target.nodeId, baseVersion: target.version, ...content }] } : { linkDoc: slug, files: [{ path: target.path, ...content }] }),
  }).catch((error) => {
    if (error instanceof CliError && error.code === "VERSION_CONFLICT") throw new CliError("VERSION_CONFLICT", `Someone saved ${target.path} while you were editing`, { hint: "Read the doc again and redo your change on their version", details: error.details });
    throw error;
  }));
  const saved = res.files[0];
  ctx.out.result("nb.doc.edit/1", { slug, changed: true, path: saved.path, version: saved.version }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Saved ${safe(d.path)} as v${d.version}`);
}

/** @param {Context} ctx */
export async function workspaceList(ctx) {
  const { workspaces } = /** @type {any} */ (await ctx.api.get("/api/v1/extension/workspaces"));
  const linked = ctx.project?.workspaceId;
  ctx.out.result("nb.workspace.list/1", { workspaces: workspaces.map((/** @type {any} */ w) => ({ id: w.id, slug: w.slug, title: w.title, role: w.role ?? null })) }, (d) =>
    d.workspaces.length ? ctx.out.table([{ title: "", value: (w) => (w.id === linked ? ctx.out.c.brand(ctx.out.sym.brand) : " ") }, { title: "Workspace", value: (w) => safe(w.title), flex: true }, { title: "Slug", value: (w) => safe(w.slug) }, { title: "Role", value: (w) => w.role ?? "" }], d.workspaces) : "No workspaces yet");
}

/** @param {Context} ctx */
export async function search(ctx) {
  const q = ctx.positionals.join(" ").trim();
  if (!q) throw usage('nb search "<text>" [--in tasks,files,comments,docs,people]');
  // Beyond files (C2): tasks, comments, docs and people from the workspace search, files from the file search.
  const kinds = String(ctx.flags.in ?? "files,tasks,comments,docs,people").split(",").map((k) => k.trim()).filter(Boolean);
  const bad = kinds.find((k) => !["files", "tasks", "comments", "docs", "people"].includes(k));
  if (bad) throw usage(`--in ${bad}: use tasks, files, comments, docs or people`);
  const others = kinds.filter((k) => k !== "files");
  const workspaceId = ctx.requireWorkspace();
  const [files, rest] = await Promise.all([
    kinds.includes("files") ? ctx.api.get("/api/v1/extension/search", { query: { projectId: workspaceId, q, kind: "file" } }).then((/** @type {any} */ r) => r.files) : [],
    others.length && q.length >= 2 ? ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/search`, { query: { q, in: others.join(",") } }) : {},
  ]);
  const r = /** @type {any} */ (rest);
  const data = {
    query: q,
    files: /** @type {any[]} */ (files).map((f) => ({ path: f.path, version: f.currentVersion })),
    tasks: r.tasks ?? [], comments: r.comments ?? [], docs: r.docs ?? [], people: r.people ?? [],
  };
  const { c } = ctx.out;
  ctx.out.result("nb.search/1", data, (d) => {
    const section = (/** @type {string} */ title, /** @type {any[]} */ items, /** @type {(x: any) => string} */ line) => (items.length ? [c.bold(title), ...items.map((x) => `  ${line(x)}`), ""] : []);
    const lines = [
      ...section("Tasks", d.tasks, (t) => `#${t.number} ${safe(t.title)} ${c.muted(t.status)}`),
      ...section("Files", d.files, (f) => `${safe(f.path)} ${c.muted(`v${f.version}`)}`),
      ...section("Comments", d.comments, (m) => `#${m.number} ${m.by ? `@${safe(m.by)}` : "someone"}: ${commentText(m.text).replace(/\s+/g, " ").slice(0, 100)}`),
      ...section("Docs", d.docs, (x) => `${safe(x.title)} ${c.muted(`nb doc view ${x.slug}`)}`),
      ...section("People", d.people, (p) => `@${safe(p.username ?? "")} ${safe(p.name ?? "")} ${c.muted(p.role)}`),
    ];
    return lines.length ? lines.slice(0, -1) : `Nothing matches "${safe(q)}"`;
  });
}

// ───────────────────────────────── file list / view

/** @param {Context} ctx */
export async function fileList(ctx) {
  const workspaceId = ctx.requireWorkspace();
  if (ctx.flags.starred) return myFiles(ctx, "starred");
  if (ctx.flags.task) {
    const task = await resolveTask(ctx, String(ctx.flags.task));
    const files = /** @type {any[]} */ (task.files ?? []).map((f) => ({ path: f.path ?? f.name, as: f.role === "deliverable" ? "final" : f.role === "working" ? "draft" : f.role ?? "draft", version: f.currentVersion ?? null, size: f.size ?? null }));
    return ctx.out.result("nb.file.list/1", { task: { id: task.id, number: task.taskNumber }, files }, (d) => (d.files.length ? ctx.out.table([{ title: "Path", value: (f) => safe(f.path), flex: true, path: true }, { title: "Role", value: (f) => f.as }, { title: "Version", value: (f) => (f.version ? `v${f.version}` : ""), align: "right" }], d.files) : "No files on this task"));
  }
  const { files } = await fetchManifest(ctx.api, workspaceId);
  const folder = ctx.positionals[0] ? `/${ctx.positionals[0].replace(/^\/+|\/+$/g, "")}/` : "/";
  const list = [...files.values()].filter((f) => f.path.startsWith(folder)).sort((a, b) => a.path.localeCompare(b.path));
  ctx.out.result("nb.file.list/1", { files: list.map((f) => ({ path: f.path, version: f.version, size: f.size })) }, (d) =>
    d.files.length ? ctx.out.table([{ title: "Path", value: (f) => safe(f.path), flex: true, path: true }, { title: "Version", value: (f) => `v${f.version}`, align: "right" }, { title: "Size", value: (f) => formatBytes(f.size), align: "right" }], d.files) : "No files");
}

/** Your starred files, or the ones you changed lately (C3, 0087). @param {Context} ctx @param {"starred" | "recent"} kind */
async function myFiles(ctx, kind) {
  const { files } = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/files/mine`, { query: { kind } }));
  ctx.out.result(`nb.file.${kind}/1`, { files: files.map((/** @type {any} */ f) => ({ path: f.path, version: f.currentVersion, size: f.size, at: f.at })) }, (d) =>
    d.files.length
      ? ctx.out.table([{ title: "Path", value: (f) => safe(f.path), flex: true, path: true }, { title: kind === "recent" ? "Changed" : "Version", value: (f) => (kind === "recent" ? formatWhen(f.at) : f.version ? `v${f.version}` : ""), align: "right" }], d.files)
      : kind === "starred" ? "No starred files · nb file star <path>" : "No files you changed in the last 30 days");
}
/** @param {Context} ctx */
export const fileRecent = (ctx) => myFiles(ctx, "recent");

/** @param {Context} ctx */
export async function fileStar(ctx) {
  const p = ctx.positionals[0];
  if (!p) throw usage("nb file star <path> [--off]");
  const { nodeOf } = await import("./browse.mjs");
  const node = await nodeOf(ctx, p);
  const on = !ctx.flags.off;
  await ctx.api.put(`/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/files/${node.nodeId ?? node.id}/star`, { starred: on });
  ctx.out.result("nb.file.star/1", { path: node.path ?? p, starred: on }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} ${on ? "Starred" : "Unstarred"} ${safe(d.path)}${on ? " · the Files tab shows it too" : ""}`);
}

/** @param {number} bytes */
export const formatBytes = (bytes) => (bytes < 1024 ? `${bytes} B` : bytes < 1024 * 1024 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`);

/** Prints a file; raw bytes when piped, control characters made visible on a terminal (A3.11). @param {Context} ctx */
export async function fileView(ctx) {
  const workspaceId = ctx.requireWorkspace();
  const p = ctx.positionals[0];
  if (!p) throw usage("nb file view <path>");
  const remotePath = p.startsWith("/") ? p : `/${p}`;
  const response = await ctx.api.download("/api/v1/extension/file", { projectId: workspaceId, path: remotePath, transfer: "raw" }).catch(async () => null);
  /** @type {Buffer} */
  let bytes;
  if (response) bytes = Buffer.from(await response.arrayBuffer());
  else {
    const inline = /** @type {any} */ (await ctx.api.get("/api/v1/extension/file", { query: { projectId: workspaceId, path: remotePath, transfer: "inline" } }));
    bytes = Buffer.from(inline.content ?? "", inline.encoding === "base64" ? "base64" : "utf8");
  }
  if (ctx.out.json) return ctx.out.result("nb.file.view/1", { path: remotePath, size: bytes.length, contentBase64: bytes.toString("base64") }, () => null);
  if (process.stdout.isTTY) {
    ctx.out.raw(bytes.toString("utf8").replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, (ch) => (ch < " " ? `^${String.fromCharCode(ch.charCodeAt(0) + 64)}` : `\\x${ch.charCodeAt(0).toString(16)}`)));
  } else ctx.out.raw(bytes);
}

/** Members matching a name (the server returns at most 10). @param {Context} ctx */
export async function memberList(ctx) {
  const workspaceId = ctx.requireWorkspace();
  const q = ctx.positionals.join(" ");
  const { members } = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/members`, { query: q ? { q } : {} }));
  ctx.out.result("nb.member.list/1", { query: q || null, members: members.map((/** @type {any} */ m) => ({ username: m.username, name: m.fullName, role: m.role })) }, (d) =>
    d.members.length
      ? [...ctx.out.table([{ title: "Member", value: (m) => (m.username ? `@${safe(m.username)}` : ""), flex: true }, { title: "Name", value: (m) => safe(m.name ?? "") }, { title: "Role", value: (m) => m.role }], d.members), ...(d.members.length >= 10 ? [ctx.out.c.muted("  First 10 shown: add a name to narrow it")] : [])]
      : `No members match "${safe(q)}"`);
}

// ───────────────────────────────── members (report C4, M4b): owner and admins change them; your own sign-in only

/** @param {Context} ctx @param {"POST" | "PATCH" | "DELETE"} method @param {Record<string, unknown>} body */
const members = (ctx, method, body) => ctx.api.request(method, `/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/members`, { body });

/** `nb member invite @sam --role "Frontend developer"`: workspace invitations are for one of its open roles. @param {Context} ctx */
export async function memberInvite(ctx) {
  const who = ctx.positionals[0];
  if (!who || !ctx.flags.role) throw usage('nb member invite @username --role "<open role>"', "The open roles are on the workspace's Members page");
  const res = /** @type {any} */ (await members(ctx, "POST", { username: who.replace(/^@/, ""), role: String(ctx.flags.role), ...(ctx.flags.message ? { note: String(ctx.flags.message) } : {}) }));
  ctx.out.result("nb.member.invite/1", res, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Invited ${safe(d.invited)} as ${safe(d.role)}; they accept in NetworkBase`);
}

/** `nb member role @sam admin` @param {Context} ctx */
export async function memberRole(ctx) {
  const [who, role] = ctx.positionals;
  if (!who || !["admin", "member", "viewer"].includes(String(role))) throw usage("nb member role @username admin|member|viewer");
  await members(ctx, "PATCH", { username: who.replace(/^@/, ""), role });
  ctx.out.result("nb.member.role/1", { username: who.replace(/^@/, ""), role }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} @${safe(d.username)} is now ${d.role}`);
}

/** `nb member remove @sam`: their open tasks become unassigned (asks first). @param {Context} ctx */
export async function memberRemove(ctx) {
  const who = ctx.positionals[0];
  if (!who) throw usage("nb member remove @username");
  const { confirm } = await import("../tui/ask.mjs");
  if (!(await confirm(ctx, { key: "remove", question: `Remove ${who.startsWith("@") ? who : `@${who}`} from this workspace? Their open tasks become unassigned.`, yesLabel: "Remove", defaultYes: false }))) return EXIT.cancelled;
  const { withStepUp } = await import("./admin.mjs");
  await withStepUp(ctx, () => members(ctx, "DELETE", { username: who.replace(/^@/, "") }));
  ctx.out.result("nb.member.remove/1", { username: who.replace(/^@/, "") }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Removed @${safe(d.username)}`);
}

// ───────────────────────────────── your part here (member settings Parts 1–3): your own sign-in only

/** @param {Context} ctx */
const mePath = (ctx, tail = "") => `/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}/me${tail}`;
const month = (/** @type {string} */ iso) => new Date(iso).toLocaleDateString("en", { month: "short", year: "numeric" });
const day = (/** @type {string} */ iso) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

/** What to do with your open tasks: --keep, --unassign or --give-tasks-to @user. @param {Context} ctx @param {"keep" | "unassign"} fallback */
function taskChoice(ctx, fallback) {
  const give = ctx.flags["give-tasks-to"];
  const picked = [ctx.flags.keep && "keep", ctx.flags.unassign && "unassign", give && "give"].filter(Boolean);
  if (picked.length > 1) throw usage("Choose one: --keep, --unassign or --give-tasks-to @username");
  return give ? { tasks: "give", giveTo: String(give).replace(/^@/, "") } : { tasks: picked[0] ?? fallback };
}

/** The wrap-up check before completing or leaving, in lines. @param {Context} ctx @param {any} w @param {{ tasks: string, giveTo?: string }} choice */
function wrapUpLines(ctx, w, choice) {
  const n = w.openTasks.count;
  const work = w.openWork;
  const open = work.changeSets.length + work.branches.length + work.mergeRequests.length + work.docDrafts.length;
  return [
    n ? `${n} open ${n === 1 ? "task" : "tasks"}: ${choice.tasks === "keep" ? "stay assigned to you" : choice.tasks === "unassign" ? "become unassigned" : `go to @${safe(choice.giveTo ?? "")}`}` : "No open tasks",
    ...(w.reviews.count ? [`${w.reviews.count} ${w.reviews.count === 1 ? "review" : "reviews"} waiting on you go to the owner`] : []),
    ...(open ? [`${open} open ${open === 1 ? "item" : "items"} (change sets, branches, merge requests, drafts) stay as they are`] : []),
    ctx.out.c.muted(w.stays),
  ];
}

/** `nb workspace me`: your part here, and your settings. @param {Context} ctx */
export async function workspaceMe(ctx) {
  const part = /** @type {any} */ (await ctx.api.get(mePath(ctx)));
  ctx.out.result("nb.workspace.me/1", part, (d) => [
    `${ctx.out.c.bold(safe(d.workspace.title ?? ""))} · ${d.role}${d.joinedAt ? ` since ${month(d.joinedAt)}` : ""}`,
    d.status === "completed" && d.completion
      ? `Completed · ${day(d.completion.at)}${d.completion.note ? ` · "${safe(d.completion.note)}"` : ""}${d.completion.byOwner && d.completion.by ? ` · marked by ${safe(d.completion.by.name)}` : ""}${d.completion.confirmedBy ? ` · confirmed by ${safe(d.completion.confirmedBy.name)}` : ""}`
      : "Active",
    ctx.out.c.muted(d.canDo),
    ...(d.periods.length ? [`Earlier: ${d.periods.map((/** @type {any} */ x) => `${month(x.startedAt)} – ${month(x.endedAt)} ${x.endReason}`).join(", ")}`] : []),
    `Notifications: ${d.settings.notifications.mode === "inherit" ? "as the workspace sends them" : "your own choice"}${d.settings.muteUntil ? ` · muted ${d.settings.muteUntil === "forever" ? "until you turn them back on" : `until ${day(d.settings.muteUntil)}`}` : ""}`,
    `Your agents here: ${d.settings.agentsBlocked ? "kept out" : "allowed"}`,
    ...(d.canComplete ? [ctx.out.c.muted("nb workspace complete to complete your part")] : d.canReopen ? [ctx.out.c.muted("nb workspace reopen to reopen it")] : []),
  ].join("\n"));
}

/** `nb workspace complete [-m note] [--keep | --unassign | --give-tasks-to @user]`: you stay a member, read-only. @param {Context} ctx */
export async function workspaceComplete(ctx) {
  const choice = taskChoice(ctx, "keep");
  const note = ctx.flags.message ? String(ctx.flags.message) : null;
  if (note && note.length > 280) throw usage("A closing note is up to 280 characters");
  const w = /** @type {any} */ (await ctx.api.get(mePath(ctx, "/wrap-up")));
  if (!(await confirm(ctx, { key: "complete", question: `Complete your part in ${w.workspace.title}? You stay a member, read-only, and can reopen it any time.`, preview: wrapUpLines(ctx, w, choice).join("\n"), yesLabel: "Complete my part", defaultYes: false }))) return EXIT.cancelled;
  const res = /** @type {any} */ (await ctx.api.post(mePath(ctx, "/complete"), { ...choice, ...(note ? { note } : {}) }));
  ctx.out.result("nb.workspace.complete/1", res, (d) => `${ctx.out.c.success(ctx.out.sym.done)} ${d.already ? "Your part was already completed" : "Your part is completed"} · nb workspace reopen to reopen it${d.undoToken ? " · nb undo to undo" : ""}`);
}

/** `nb workspace reopen`: your role and write access come back; a new period starts on your profile. @param {Context} ctx */
export async function workspaceReopen(ctx) {
  const res = /** @type {any} */ (await ctx.api.post(mePath(ctx, "/reopen"), {}));
  ctx.out.result("nb.workspace.reopen/1", res, () => `${ctx.out.c.success(ctx.out.sym.done)} Your part is open again`);
}

/** `nb workspace leave [--unassign | --give-tasks-to @user]`: the wrap-up check, then leave (asks first); the owner can't leave. @param {Context} ctx */
export async function workspaceLeave(ctx) {
  if (ctx.flags.keep) throw usage("Leaving can't keep tasks: --unassign (the default) or --give-tasks-to @username");
  const choice = taskChoice(ctx, "unassign");
  // A server from before member settings has no wrap-up check: ask the plain question then.
  const w = /** @type {any} */ (await ctx.api.get(mePath(ctx, "/wrap-up")).catch(() => null));
  const question = `Leave ${w?.workspace?.title ?? "this workspace"}? ${w ? "" : "Your open tasks become unassigned, and "}You'll need a new invitation to come back.`.replace("and You'll", "and you'll");
  if (!(await confirm(ctx, { key: "leave", question, ...(w ? { preview: wrapUpLines(ctx, w, choice).join("\n") } : {}), yesLabel: "Leave", defaultYes: false }))) return EXIT.cancelled;
  const res = /** @type {any} */ (await members(ctx, "DELETE", { leave: true, ...choice }));
  ctx.out.result("nb.workspace.leave/1", { left: true, undoToken: res?.undoToken ?? null }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} You left the workspace${d.undoToken ? " · nb undo to undo" : ""}${ctx.root ? " · nb unlink to unlink this folder" : ""}`);
}

/**
 * `nb edit <file>` (C10): in a linked folder, opens your copy (pulled first if it isn't here) and pushes a new version
 * when the editor closes, with push's conflict rules; elsewhere, edits a downloaded copy and saves it as a new
 * version based on the one you opened.
 * @param {Context} ctx
 */
export async function fileEdit(ctx) {
  const p = ctx.positionals[0];
  if (!p) throw usage("nb edit <file> [-m note]");
  if (!ctx.out.interactive && !ctx.env.NB_EDITOR) throw new CliError("NEEDS_INPUT", "nb edit opens your editor, so it needs a terminal", { hint: "Change the file, then nb push <file>" });
  const [cmd, ...args] = editorCommand(ctx).split(" ");
  const win = process.platform === "win32";
  const openEditor = (/** @type {string} */ file) => {
    const run = spawnSync(/** @type {string} */ (cmd), [...args, win ? `"${file}"` : file], { stdio: "inherit", shell: win });
    if (run.status !== 0) throw new CliError("EDITOR_FAILED", `The editor exited with ${run.status ?? run.signal}`);
  };
  const message = ctx.flags.message ? String(ctx.flags.message) : `Edited with nb edit`;
  if (ctx.root) {
    const rel = path.relative(ctx.root, path.resolve(ctx.cwd, p));
    if (rel.startsWith("..") || path.isAbsolute(rel)) throw usage(`${p} is outside the linked folder ${ctx.root}`);
    const abs = path.join(ctx.root, rel);
    const files = await import("./files.mjs");
    if (!fs.existsSync(abs)) await files.pull(/** @type {Context} */ ({ ...ctx, cwd: ctx.root, positionals: [rel] }), { quietResult: true });
    if (!fs.existsSync(abs)) throw new CliError("NOT_FOUND", `No file ${rel} here or in the workspace`, { hint: "nb file list" });
    const before = fs.readFileSync(abs);
    openEditor(abs);
    if (fs.readFileSync(abs).equals(before)) return ctx.out.result("nb.edit/1", { path: rel, changed: false }, () => "No changes, nothing pushed");
    return files.push(/** @type {Context} */ ({ ...ctx, cwd: ctx.root, positionals: [rel], flags: { ...ctx.flags, message } }));
  }
  // Not in a linked folder: a temporary copy, saved back as a new version based on the one opened.
  const remotePath = p.startsWith("/") ? p : `/${p}`;
  const projectId = ctx.requireWorkspace();
  const meta = /** @type {any} */ (await ctx.api.get("/api/v1/extension/file", { query: { projectId, path: remotePath, transfer: "metadata" } }));
  const res = await ctx.api.download("/api/v1/extension/file", { projectId, path: remotePath, transfer: "raw" });
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nb-edit-")), path.posix.basename(remotePath).replace(/[^A-Za-z0-9._-]/g, "_") || "file");
  const before = Buffer.from(await res.arrayBuffer());
  fs.writeFileSync(tmp, before);
  try {
    openEditor(tmp);
    const after = fs.readFileSync(tmp);
    if (after.equals(before)) return ctx.out.result("nb.edit/1", { path: remotePath, changed: false }, () => "No changes, nothing saved");
    const { mimeFor } = await import("../sync/transfer.mjs");
    const placed = /** @type {any} */ (await ctx.api.post("/api/v1/files/place", { projectId, message, files: [{ path: remotePath, contentHash: crypto.createHash("sha256").update(after).digest("hex"), size: after.length, mimeType: mimeFor(remotePath), contentBase64: after.toString("base64"), baseVersion: meta.currentVersion }] }));
    const f = placed.files?.[0];
    ctx.out.result("nb.edit/1", { path: remotePath, changed: true, version: f?.version ?? null }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Saved ${safe(d.path)}${d.version ? ` as v${d.version}` : ""}`);
  } finally {
    fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  }
}

/** A doc's live list (report 38.3 W13): `nb doc rows <slug> --list <key>`. @param {Context} ctx */
export async function rows(ctx) {
  const workspaceId = ctx.requireWorkspace();
  const slug = ctx.positionals[0];
  if (!slug || !ctx.flags.list) throw usage("nb doc rows <slug> --list <key>");
  const res = /** @type {any} */ (await ctx.api.get(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/docs/${encodeURIComponent(slug)}/rows?key=${encodeURIComponent(String(ctx.flags.list))}`));
  ctx.out.result("nb.doc.rows/1", { slug, list: String(ctx.flags.list), rows: res.rows, hidden: res.hidden }, (d) => {
    if (!d.rows.length) return d.hidden ? `${d.hidden} items you can't see` : "No items yet";
    return d.rows.map((/** @type {any} */ r) => `  ${r.status === "done" ? "[x]" : "[ ]"} ${ctx.out.c.muted(`#${r.number ?? "?"}`)} ${safe(r.title)}${r.assignee ? ctx.out.c.muted(`  ${safe(r.assignee.name ?? "")}`) : ""}${r.dueDate ? ctx.out.c.muted(`  due ${String(r.dueDate).slice(0, 10)}`) : ""}`);
  });
}

/** `nb doc rows add <slug> --list <key> "<title>"`: a task in the list, To do, in the Backlog. @param {Context} ctx */
export async function rowsAdd(ctx) {
  const workspaceId = ctx.requireWorkspace();
  const [slug, ...words] = ctx.positionals;
  const title = words.join(" ").trim();
  if (!slug || !title || !ctx.flags.list) throw usage('nb doc rows add <slug> --list <key> "<title>" [--to @user] [--due YYYY-MM-DD]');
  const due = ctx.flags.due ? new Date(`${String(ctx.flags.due)}T00:00:00Z`) : null;
  if (due && Number.isNaN(due.getTime())) throw usage("--due takes a date: YYYY-MM-DD");
  const res = /** @type {any} */ (await ctx.api.post(`/api/v1/workspaces/${encodeURIComponent(workspaceId)}/docs/${encodeURIComponent(slug)}/rows`, {
    key: String(ctx.flags.list), title, ...(ctx.flags.to ? { assignee: String(ctx.flags.to) } : {}), ...(due ? { due: due.toISOString() } : {}),
  }));
  ctx.out.result("nb.doc.rows.add/1", { slug, id: res.id, number: res.number, title }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Added #${d.number ?? "?"} ${safe(d.title)} to ${safe(d.slug)}`);
}
