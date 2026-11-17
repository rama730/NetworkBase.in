// Workspace admin, security and data from the terminal (report Part F, M7): workspace create, settings and archive;
// the agent policy; docs add and remove; whoami --security; nb export; nb api. Risky actions ask "Verify it's you"
// in the browser (F5) and then continue.
import fs from "node:fs";
import path from "node:path";

import { CliError, EXIT, usage } from "../errors.mjs";
import { safe } from "../print/style.mjs";
import { ask, confirm } from "../tui/ask.mjs";
import { formatDate, formatWhen } from "./tasks.mjs";

/** @typedef {import("../context.mjs").Context} Context */

const ws = (/** @type {Context} */ ctx) => `/api/v1/workspaces/${encodeURIComponent(ctx.requireWorkspace())}`;

/**
 * Runs a risky call; when the server asks "Verify it's you" (STEP_UP_REQUIRED with a page), opens that page, waits for
 * the person, and tries once more. Without a terminal it stops with the page to open (F5).
 * @template T @param {Context} ctx @param {() => Promise<T>} call @returns {Promise<T>}
 */
export async function withStepUp(ctx, call) {
  try {
    return await call();
  } catch (error) {
    const url = error instanceof CliError && error.code === "STEP_UP_REQUIRED" ? /** @type {any} */ (error.details)?.url : null;
    if (!url) throw error;
    if (!ctx.out.interactive || ctx.out.json) throw new CliError("STEP_UP_REQUIRED", error.message, { hint: `Open ${url}, verify it's you, then run the command again (within 10 minutes)`, details: { url } });
    const { openInBrowser } = await import("./misc.mjs");
    const opened = await openInBrowser(url);
    ctx.out.note(`${opened ? "Opened" : "Open"} ${url}`);
    ctx.out.note(ctx.out.c.muted("  Verify it's you there; this terminal may then do it for 10 minutes."));
    const done = await ask(ctx, { key: "verified", header: "Verify", question: "Verified in the browser?", options: [{ value: "yes", label: "Done, continue", recommended: true }, { value: "no", label: "Cancel" }] });
    if (done !== "yes") throw new CliError("CANCELLED", "Nothing was changed");
    return call();
  }
}

/** `nb workspace create "<title>" [-m description] [--public]` (F3). @param {Context} ctx */
export async function workspaceCreate(ctx) {
  const title = ctx.positionals.join(" ").trim();
  if (title.length < 3) throw usage('nb workspace create "My project"', "A title is 3 to 100 characters");
  const res = /** @type {any} */ (await ctx.api.post("/api/v1/workspaces", { title, ...(ctx.flags.message ? { description: String(ctx.flags.message) } : {}), visibility: ctx.flags.public ? "public" : "private" }));
  ctx.out.result("nb.workspace.create/1", res, (d) => [
    `${ctx.out.c.success(ctx.out.sym.done)} Created ${safe(d.workspace.title)} (${ctx.flags.public ? "public" : "private"})`,
    ctx.out.c.muted(`  Next: nb init ${d.workspace.slug} in a folder, or nb workspace open -w ${d.workspace.slug}`),
  ]);
}

/** `nb workspace settings [--title t] [--description d]` (F3): shows them; with a flag, changes it. @param {Context} ctx */
export async function workspaceSettings(ctx) {
  const patch = { ...(ctx.flags.title ? { title: String(ctx.flags.title) } : {}), ...(ctx.flags.description !== undefined ? { description: String(ctx.flags.description) } : {}) };
  const res = /** @type {any} */ (Object.keys(patch).length ? await ctx.api.patch(`${ws(ctx)}/settings`, patch) : await ctx.api.get(`${ws(ctx)}/settings`));
  const POLICY = /** @type {Record<string, string>} */ ({ ask_all: "ask for everything", ask_important: "ask before important changes", trust_drafts_docs: "trust drafts and docs" });
  ctx.out.result("nb.workspace.settings/1", res, (d) => {
    const s = d.settings;
    return [
      `${ctx.out.c.bold(safe(s.title))} ${ctx.out.c.muted(`${s.slug} · ${s.visibility}${s.status ? ` · ${s.status}` : ""}`)}`,
      ...(s.description ? [`  ${safe(String(s.description)).replace(/\s+/g, " ").slice(0, 200)}`] : []),
      `  Agents      ${POLICY[s.agentPolicy] ?? s.agentPolicy}${s.agentsPaused ? " · paused" : ""}`,
      `  History     ${s.branchesEnabled ? "on (branches and merge requests)" : "off"}`,
      ...(s.protection ? [`  main        ${s.protection.requireMergeRequest ? `protected · ${s.protection.approvals} approval${s.protection.approvals === 1 ? "" : "s"}` : "takes direct changes"}${s.protection.agentsOnBranches ? " · agents on branches" : ""}`] : []),
      ...(d.canChange ? [ctx.out.c.muted("  Change: --title, --description; agents: nb agent policy; more in the app (nb workspace open)")] : []),
    ];
  });
}

/** `nb workspace archive` (F3, F5): the owner, after a yes and "Verify it's you". @param {Context} ctx */
export async function workspaceArchive(ctx) {
  if (!(await confirm(ctx, { key: "archive", question: "Archive this workspace? It becomes read-only for everyone; the owner can restore it in the app.", yesLabel: "Archive", defaultYes: false }))) return EXIT.cancelled;
  const res = await withStepUp(ctx, () => ctx.api.post(`${ws(ctx)}/archive`, {}));
  ctx.out.result("nb.workspace.archive/1", res, () => `${ctx.out.c.success(ctx.out.sym.done)} Archived`);
}

/** `nb agent policy [ask-all|important|trust-docs]` (F3): shows it; from the terminal, only stricter. @param {Context} ctx */
export async function agentPolicy(ctx) {
  const WORDS = /** @type {Record<string, string>} */ ({ "ask-all": "ask_all", important: "ask_important", "trust-docs": "trust_drafts_docs" });
  const want = ctx.positionals[0];
  if (!want) {
    const res = /** @type {any} */ (await ctx.api.get(`${ws(ctx)}/settings`));
    return ctx.out.result("nb.agent.policy/1", { policy: res.settings.agentPolicy, paused: res.settings.agentsPaused }, (d) => `Agents here: ${d.policy.replace(/_/g, " ")}${d.paused ? " (paused)" : ""}`);
  }
  if (!WORDS[want]) throw usage(`nb agent policy ${Object.keys(WORDS).join("|")}`, "ask-all: every change waits for a yes; important: small changes run; trust-docs: drafts and docs run too");
  const res = /** @type {any} */ (await ctx.api.post(`${ws(ctx)}/agents`, { policy: WORDS[want] }));
  ctx.out.result("nb.agent.policy/1", res, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Agents here: ${String(d.policy).replace(/_/g, " ")}`);
}

/** `nb doc add <file>` (F3): the file becomes a workspace doc where it is. @param {Context} ctx */
export async function docAdd(ctx) {
  const file = ctx.positionals[0];
  if (!file) throw usage("nb doc add <file>", "A path in the workspace, like docs/guide.md");
  const res = /** @type {any} */ (await ctx.api.post(`${ws(ctx)}/docs`, { path: file.replace(/\\/g, "/") }));
  ctx.out.result("nb.doc.add/1", res, () => `${ctx.out.c.success(ctx.out.sym.done)} ${safe(file)} is a workspace doc · nb doc list`);
}

/** `nb doc remove <slug>` (F3): unlinks it; the file stays. @param {Context} ctx */
export async function docRemove(ctx) {
  const slug = ctx.positionals[0];
  if (!slug) throw usage("nb doc remove <slug>", "nb doc list shows the slugs");
  if (!(await confirm(ctx, { key: "remove", heldByServer: true, question: `Remove the doc ${slug}? Its file stays in the workspace.`, yesLabel: "Remove", defaultYes: false }))) return EXIT.cancelled;
  const res = await ctx.api.delete(`${ws(ctx)}/docs/${encodeURIComponent(slug)}`);
  ctx.out.result("nb.doc.remove/1", res, () => `${ctx.out.c.success(ctx.out.sym.done)} Removed the doc ${safe(slug)}; its file stays`);
}

/** `nb whoami --security` (F5): sign-ins, two-factor, recent security events. @param {Context} ctx */
export async function securitySummary(ctx) {
  const res = /** @type {any} */ (await ctx.api.get("/api/v1/me/security"));
  ctx.out.result("nb.whoami.security/1", res, (d) => [
    `  Two-factor  ${d.twoFactor ? "on" : "off · turn it on in Settings → Security"}`,
    `  Sign-ins    ${d.signIns.length}`,
    ...d.signIns.slice(0, 10).map((/** @type {any} */ s) => `    ${safe(s.name)} ${ctx.out.c.muted(`${s.kind}${s.country ? ` · ${s.country}` : ""} · ${s.lastUsedAt ? formatWhen(s.lastUsedAt) : "not used yet"}`)}`),
    ...(d.events.length ? ["", "  Recent security events", ...d.events.map((/** @type {any} */ e) => `    ${formatDate(e.at)}  ${safe(e.label)}`)] : []),
  ]);
}

/**
 * `nb export [--branch x | --all-branches] [-o file.zip]` (F8): the workspace's files and a JSON of its tasks,
 * comments and docs, as one zip. Agents need a yes; people verify it's them (F5). @param {Context} ctx
 */
export async function exportWorkspace(ctx) {
  const out = path.resolve(ctx.cwd, String(ctx.flags.output ?? `${ctx.project?.slug ?? "workspace"}-export.zip`));
  if (fs.existsSync(out) && !ctx.flags.force) throw usage(`${out} already exists`, "Pass -o another.zip, or --force to replace it");
  const query = { ...(ctx.flags.branch ? { branch: String(ctx.flags.branch) } : {}), ...(ctx.flags["all-branches"] ? { allBranches: "1" } : {}) };
  const response = await withStepUp(ctx, () => ctx.api.download(`${ws(ctx)}/export`, query));
  const { pipeline } = await import("node:stream/promises");
  const { Readable } = await import("node:stream");
  const tmp = `${out}.part`;
  await pipeline(Readable.fromWeb(/** @type {any} */ (response.body)), fs.createWriteStream(tmp));
  fs.renameSync(tmp, out);
  const size = fs.statSync(out).size;
  ctx.out.result("nb.export/1", { path: out, bytes: size }, (d) => `${ctx.out.c.success(ctx.out.sym.done)} Saved ${d.path} (${(d.bytes / 1024 / 1024).toFixed(1)} MB): files, plus export.json with tasks, comments and docs`);
}

/**
 * `nb api <METHOD> <path> [--data json]` (F6): any /api/v1 route with your sign-in, through the same route list and
 * scopes, so nothing new is reachable. Writes ask first unless --yes. @param {Context} ctx
 */
export async function api(ctx) {
  const [rawMethod, rawPath] = ctx.positionals;
  const method = String(rawMethod ?? "").toUpperCase();
  if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(method) || !rawPath) throw usage("nb api <GET|POST|PUT|PATCH|DELETE> <path> [--data '{...}']", "Like: nb api GET /api/v1/me");
  const target = rawPath.startsWith("/api/v1/") ? rawPath : `/api/v1/${rawPath.replace(/^\/+/, "")}`;
  if (target.includes("..")) throw usage("The path can't contain ..");
  let body;
  if (ctx.flags.data !== undefined) {
    try { body = JSON.parse(String(ctx.flags.data)); } catch { throw usage("--data must be JSON", `Like: --data '{"title":"Fix login"}'`); }
  }
  if (method !== "GET" && !(await confirm(ctx, { key: "api", heldByServer: true, question: `${method} ${target}?`, preview: body === undefined ? undefined : JSON.stringify(body, null, 2).slice(0, 2000), yesLabel: "Send", defaultYes: false }))) return EXIT.cancelled;
  const [p, q] = target.split("?");
  const query = Object.fromEntries(new URLSearchParams(q ?? ""));
  const res = method === "GET" ? await ctx.api.get(/** @type {string} */ (p), { query })
    : method === "DELETE" ? await ctx.api.delete(/** @type {string} */ (p), { query })
    : await /** @type {any} */ (ctx.api)[method.toLowerCase()](p, body ?? {}, { query });
  ctx.out.result("nb.api/1", res, (d) => JSON.stringify(d, null, 2));
}
