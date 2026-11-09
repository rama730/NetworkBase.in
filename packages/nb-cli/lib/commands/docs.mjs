// Docs (the README), workspaces and search (report §17.4, §18.2 "change the workspace README", §21 flow C).
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { readUserConfig } from "../config.mjs";
import { CliError, EXIT, usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { unifiedDiff } from "../sync/diff.mjs";
import { confirm } from "../tui/ask.mjs";

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
  ctx.out.result("nb.doc.list/1", { docs }, (d) => (d.docs.length ? d.docs.map((/** @type {any} */ doc) => `  ${safe(doc.slug).padEnd(20)} ${ctx.out.c.muted(safe(doc.filename ?? ""))}`) : "No docs yet"));
}

/** @param {Context} ctx */
export async function view(ctx) {
  const doc = await readDoc(ctx, ctx.positionals[0] ?? "readme");
  if (ctx.out.json) return ctx.out.result("nb.doc.view/1", doc, () => null);
  ctx.out.raw(ctx.flags.raw || !process.stdout.isTTY ? doc.content : safe(doc.content));
  if (!String(doc.content).endsWith("\n")) ctx.out.raw("\n");
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
  if (!doc.file) throw new CliError("NOT_SUPPORTED", `${slug} isn't backed by a file, so it's edited in the app`, { hint: `nb open` });
  if (!doc.canEdit) throw new CliError("FORBIDDEN", `You can read ${slug} but not edit it`);
  if (!ctx.out.interactive) throw new CliError("NEEDS_INPUT", "nb doc edit opens your editor, so it needs a terminal", { hint: `Agents: change ${doc.file.path} and nb push it` });
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "nb-doc-")), path.basename(doc.file.path));
  fs.writeFileSync(tmp, doc.content);
  const [cmd, ...args] = editorCommand(ctx).split(" ");
  const run = spawnSync(/** @type {string} */ (cmd), [...args, tmp], { stdio: "inherit", shell: process.platform === "win32" });
  if (run.status !== 0) throw new CliError("EDITOR_FAILED", `The editor exited with ${run.status ?? run.signal}`);
  const next = fs.readFileSync(tmp, "utf8");
  fs.rmSync(path.dirname(tmp), { recursive: true, force: true });
  if (next === doc.content) {
    ctx.out.result("nb.doc.edit/1", { slug, changed: false }, () => "No changes");
    return EXIT.ok;
  }
  const preview = unifiedDiff(doc.content, next)?.lines.slice(0, 30).map((l) => `${l.kind === "@" ? "" : l.kind}${l.text}`).join("\n");
  if (!(await confirm(ctx, { key: "save", question: `Save ${doc.file.path} as v${doc.file.version + 1}?`, ...(preview ? { preview } : {}), yesLabel: "Save", defaultYes: true }))) return EXIT.cancelled;
  const bytes = Buffer.from(next, "utf8");
  const res = /** @type {any} */ (await ctx.api.post("/api/v1/files/place", {
    projectId: ctx.requireWorkspace(),
    ...(ctx.flags.message ? { message: ctx.flags.message } : {}),
    files: [{ path: doc.file.path, versionOf: doc.file.nodeId, baseVersion: doc.file.version, contentHash: crypto.createHash("sha256").update(bytes).digest("hex"), size: bytes.length, mimeType: "text/markdown", contentBase64: bytes.toString("base64") }],
  }).catch((error) => {
    if (error instanceof CliError && error.code === "VERSION_CONFLICT") throw new CliError("VERSION_CONFLICT", `Someone saved ${doc.file.path} while you were editing`, { hint: "Run nb doc edit again to start from their version", details: error.details });
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
  if (!q) throw usage('nb search "<text>"');
  const res = /** @type {any} */ (await ctx.api.get("/api/v1/extension/search", { query: { projectId: ctx.requireWorkspace(), q, kind: "file" } }));
  ctx.out.result("nb.search/1", { query: q, files: res.files.map((/** @type {any} */ f) => ({ path: f.path, version: f.currentVersion })) }, (/** @type {any} */ d) => (d.files.length ? d.files.map((/** @type {any} */ f) => `  ${safe(f.path)} ${ctx.out.c.muted(`v${f.version}`)}`) : `Nothing named like "${safe(q)}"`));
}
