// login, logout, whoami (report A3.1, A3.9, A3.14, A3.16).
import crypto from "node:crypto";
import http from "node:http";
import os from "node:os";

import { createApi } from "../api.mjs";
import { listProfiles, saveProfile } from "../config.mjs";
import { CliError, usage } from "../errors.mjs";
import { storageWords } from "../keychain.mjs";
import { safe } from "../print/style.mjs";
import { openInBrowser } from "./misc.mjs";

/** @typedef {import("../context.mjs").Context} Context */

const TOKEN_SHAPE = /^nb_(dev|pat|agt)_[A-Za-z0-9_-]{16,}$/;
const LOGIN_TIMEOUT_MS = 5 * 60 * 1000;

/** @param {Context} ctx @param {string} token */
async function whoIs(ctx, token) {
  const api = createApi({ origin: ctx.profile.origin, token, version: ctx.version });
  return /** @type {any} */ (await api.get("/api/v1/me"));
}

/** Saves a token under a profile after checking it works. @param {Context} ctx @param {string} profileName @param {string} token */
export async function saveToken(ctx, profileName, token) {
  const me = await whoIs(ctx, token);
  saveProfile(profileName, { origin: ctx.profile.origin, token, user: { id: me.user.id, username: me.user.username, email: me.user.email } }, ctx.env);
  return me;
}

/** The access line (report A4): "Claude Code connected · all workspaces · asks before big changes · until 11 Dec". @param {any} access */
export function accessLine(access) {
  const where = access.allWorkspaces ? "all workspaces" : `only ${access.workspaceTitle ?? "one workspace"}`;
  const what = { full: "asks before big changes", small: "small changes only", read: "read only", custom: "custom access" }[/** @type {string} */ (access.preset)] ?? access.preset;
  const until = new Date(access.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return `${access.agentName} connected · ${where} · ${what} · until ${until}`;
}

/** What to show once an agent is approved: the access line and something to try. @param {Context} ctx @param {any} access */
export function connectedLines(ctx, access) {
  return [`${ctx.out.c.success(ctx.out.sym.done)} ${safe(accessLine(access))}`, ctx.out.c.muted(`  Try it: open ${safe(access.agentName)} and ask "what should I do today?"`)];
}

/** @param {Context} ctx @param {string} token @param {string} method */
async function finish(ctx, token, method) {
  const me = await whoIs(ctx, token);
  saveProfile(ctx.profile.name, { origin: ctx.profile.origin, token, user: { id: me.user.id, username: me.user.username, email: me.user.email } }, ctx.env);
  ctx.out.result("nb.login/1", { method, origin: ctx.profile.origin, profile: ctx.profile.name, user: me.user, scopes: me.credential.scopes, access: me.access ?? null }, (d) =>
    d.access ? connectedLines(ctx, d.access) : `${ctx.out.c.success(ctx.out.sym.done)} Signed in as ${safe(d.user.username ? `@${d.user.username}` : d.user.email ?? d.user.id)} on ${new URL(d.origin).host}${d.profile !== "default" ? ` (profile ${d.profile})` : ""}`);
}

/** Over SSH, or on Linux without a display, a browser can't open here, so the code flow is used (A3.1). @param {NodeJS.ProcessEnv} env */
const noBrowserHere = (env) => Boolean(env.SSH_CONNECTION || env.SSH_TTY || (process.platform === "linux" && !env.DISPLAY && !env.WAYLAND_DISPLAY));
const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * What the sign-in asks for (report A5): --access full|small|read, --workspace <slug|id>, --all-workspaces. The
 * approval page pre-fills it; the person can change it. A workspace that can't be looked up before signing in is
 * left for the page, never an error (a signed-out login must not stop on --workspace).
 * @param {Context} ctx
 */
async function signInWishes(ctx) {
  const access = ctx.flags.access;
  if (access !== undefined && !["full", "small", "read"].includes(String(access))) throw usage("--access takes full, small or read");
  /** @type {string | null} */
  let workspace = null;
  const given = typeof ctx.flags.workspace === "string" ? ctx.flags.workspace.trim() : "";
  if (ctx.flags["all-workspaces"]) workspace = "all";
  else if (given && UUID_SHAPE.test(given)) workspace = given;
  else if (given) {
    const p = ctx.project;
    if (p?.workspaceId && [p.slug, p.title].some((v) => v && v.toLowerCase() === given.toLowerCase())) workspace = p.workspaceId;
    else if (ctx.profile.token) workspace = await ctx.resolveWorkspace().then(() => (UUID_SHAPE.test(String(ctx.flags.workspace)) ? String(ctx.flags.workspace) : null), () => null);
    if (!workspace) ctx.out.note(ctx.out.c.muted(`Choose ${safe(given)} on the approval page.`));
  }
  return { ...(access ? { requestedAccess: String(access) } : {}), ...(workspace ? { requestedWorkspace: workspace } : {}) };
}

/**
 * Sign-in with a code (report A3.1, A4): the server gives a code; the browser opens at the approval page by itself
 * where it can, a QR code covers a phone, and this terminal polls until the person answers (10 minutes at most).
 * @param {Context} ctx
 * @returns {Promise<string>}
 */
export async function deviceLogin(ctx, agentName = /** @type {string | null} */ (null)) {
  const api = createApi({ origin: ctx.profile.origin, token: null, version: ctx.version });
  const agent = agentName ?? (typeof ctx.flags.agent === "string" ? ctx.flags.agent.trim() : "");
  const start = /** @type {any} */ (await api.post("/api/v1/device/code", {
    clientName: "NetworkBase CLI",
    deviceName: os.hostname().slice(0, 120) || "terminal",
    clientVersion: ctx.version,
    platform: `${process.platform} ${process.arch}`,
    type: agent ? "agent" : "device",
    ...(agent ? { agentName: agent, ...(await signInWishes(ctx)) } : {}),
  }, { auth: false }));
  const { c } = ctx.out;
  const tty = Boolean(ctx.out.stderr.isTTY) && !ctx.out.json;
  ctx.out.note("");
  ctx.out.note(`  ${c.bold(String(start.userCode).split("").join(" "))}`);
  ctx.out.note("");
  // A QR code of the link for a phone, when it fits and the terminal can draw it (never in --json or --plain).
  if (tty && !ctx.out.plain) {
    const { qrLines } = await import("../print/qr.mjs");
    const lines = qrLines(start.verificationUriComplete);
    if ((lines[0]?.length ?? 0) + 4 <= ctx.out.columns()) for (const line of lines) ctx.out.note(`  ${line}`);
  }
  ctx.out.note(`Open ${c.bold(start.verificationUri)} and enter ${c.bold(start.userCode)}`);
  ctx.out.note(c.muted(`  or go straight to ${start.verificationUriComplete}`));
  const opened = tty && !noBrowserHere(ctx.env) && !ctx.env.NB_NO_BROWSER ? await openInBrowser(start.verificationUriComplete) : false;
  if (opened) ctx.out.note(c.muted("Opened your browser. Approve only if it shows the same code."));
  let interval = Number(start.interval ?? 5);
  const until = Date.now() + Number(start.expiresIn ?? 600) * 1000;
  const waiting = () => {
    const left = Math.max(0, Math.round((until - Date.now()) / 1000));
    return `Waiting for you to approve in the browser… ${start.userCode} (expires ${String(Math.floor(left / 60)).padStart(2, "0")}:${String(left % 60).padStart(2, "0")})`;
  };
  // On a terminal the countdown updates in place; elsewhere it's printed once.
  const ticker = tty ? setInterval(() => ctx.out.stderr.write(`\r\x1b[2K${c.muted(waiting())}`), 1000) : null;
  if (tty) ctx.out.stderr.write(c.muted(waiting()));
  else ctx.out.note(c.muted(`${waiting()}; Ctrl+C to cancel`));
  try {
    while (Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, interval * 1000));
      const res = /** @type {any} */ (await api.post("/api/v1/device/token", { deviceCode: start.deviceCode }, { auth: false }).catch((/** @type {unknown} */ error) => {
        if (error instanceof CliError && error.status === 403) throw new CliError("CANCELLED", "Sign-in was denied in the browser");
        if (error instanceof CliError && error.status === 410) throw new CliError("TIMEOUT", "The sign-in code expired before it was approved", { hint: "Run nb login --device again" });
        throw error;
      }));
      if (res.status === "approved") return String(res.token);
      if (res.status === "slow_down") interval += 5;
    }
  } finally {
    if (ticker) {
      clearInterval(ticker);
      ctx.out.stderr.write("\r\x1b[2K");
    }
  }
  throw new CliError("TIMEOUT", "The sign-in code expired before it was approved", { hint: "Run nb login --device again" });
}

/** @param {NodeJS.ReadStream} stream */
async function readAll(stream) {
  const chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8").trim();
}

/** @param {Context} ctx */
export async function login(ctx) {
  if (ctx.env.NB_TOKEN || ctx.env.NETWORKBASE_TOKEN) {
    throw usage("A token is set in the environment (NETWORKBASE_TOKEN), so nb already uses it", "Unset it to sign in with the browser");
  }
  if (ctx.flags["with-token"]) {
    if (process.stdin.isTTY) throw usage("Pipe the token in: echo $TOKEN | nb login --with-token", "Tokens on the command line end up in shell history");
    const token = await readAll(process.stdin);
    if (!TOKEN_SHAPE.test(token)) throw usage("That doesn't look like a NetworkBase token (nb_pat_…, nb_dev_…)");
    return finish(ctx, token, "token");
  }
  if (ctx.flags.device || ctx.flags.agent || noBrowserHere(ctx.env)) {
    const token = await deviceLogin(ctx);
    return finish(ctx, token, "device");
  }
  if (!process.stdin.isTTY && !ctx.env.NB_FORCE_BROWSER_LOGIN) {
    throw new CliError("NEEDS_INPUT", "Browser sign-in needs a terminal", { hint: "Use nb login --device to sign in with a code; in CI: echo $TOKEN | nb login --with-token, or set NETWORKBASE_TOKEN" });
  }
  const token = await browserLogin(ctx);
  return finish(ctx, token, "browser");
}

/**
 * Loopback sign-in with PKCE (report A3.1, A3.14): a one-time listener on 127.0.0.1, an exact-origin CORS
 * check, an escaped page, and a code that only works with this terminal's verifier.
 * @param {Context} ctx
 * @returns {Promise<string>}
 */
function browserLogin(ctx) {
  const origin = ctx.profile.origin;
  const state = crypto.randomBytes(24).toString("hex");
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");

  return new Promise((resolve, reject) => {
    let settled = false;
    /** @type {NodeJS.Timeout} */
    let timer;
    const server = http.createServer(async (req, res) => {
      const requestOrigin = req.headers.origin ?? "";
      /** @type {Record<string, string>} */
      const cors = requestOrigin === origin ? { "access-control-allow-origin": origin, "access-control-allow-methods": "GET", vary: "origin" } : {};
      if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
      const url = new URL(req.url ?? "/", "http://127.0.0.1");
      if (req.method !== "GET" || url.pathname !== "/auth-callback") { res.writeHead(404, cors); res.end(); return; }
      const wantsJson = (req.headers.accept ?? "").includes("application/json") || req.headers["sec-fetch-mode"] === "cors";
      const reply = (/** @type {number} */ status, /** @type {string} */ title, /** @type {string} */ text) => {
        if (wantsJson) { res.writeHead(status, { ...cors, "content-type": "application/json" }); res.end(JSON.stringify({ ok: status === 200, message: text })); return; }
        res.writeHead(status, { ...cors, "content-type": "text/html; charset=utf-8", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'" });
        res.end(page(title, text));
      };
      if (settled) return reply(410, "Already used", "This sign-in link was already used. Start again from your terminal.");
      if (url.searchParams.get("error")) {
        reply(400, "Sign-in cancelled", "You can close this window and try again from your terminal.");
        return done(new CliError("CANCELLED", "Sign-in was cancelled in the browser"));
      }
      const code = url.searchParams.get("code");
      if (!code || url.searchParams.get("state") !== state) return reply(400, "Not this sign-in", "This window doesn't match the sign-in your terminal started.");
      try {
        const api = createApi({ origin, token: null, version: ctx.version });
        const exchanged = /** @type {any} */ (await api.post("/api/v1/extension/auth-code", { code, state, codeVerifier: verifier }, { auth: false }));
        reply(200, "Signed in", "Your terminal is signed in. You can close this window.");
        done(null, exchanged.token);
      } catch (error) {
        reply(400, "Sign-in failed", "Start again from your terminal.");
        done(error);
      }
    });

    /** @param {unknown} error @param {string} [token] */
    function done(error, token) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      server.close();
      if (error) reject(error);
      else resolve(/** @type {string} */ (token));
    }

    server.listen(0, "127.0.0.1", async () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      const authorize = new URL("/authorize", origin);
      authorize.searchParams.set("callback", `http://127.0.0.1:${port}/auth-callback`);
      authorize.searchParams.set("state", state);
      authorize.searchParams.set("code_challenge", challenge);
      authorize.searchParams.set("code_challenge_method", "S256");
      const opened = await openInBrowser(authorize.toString());
      ctx.out.note(`${opened ? "Opened your browser to sign in" : "Open this link to sign in"} on ${new URL(origin).host}:`);
      ctx.out.note(`  ${authorize.toString()}`);
      ctx.out.note(ctx.out.c.muted("Waiting for you to approve… (Ctrl+C to cancel)"));
      timer = setTimeout(() => done(new CliError("TIMEOUT", "Sign-in wasn't approved within 5 minutes", { hint: "Run nb login again" })), LOGIN_TIMEOUT_MS);
    });
  });
}

const ESCAPE = /** @type {Record<string, string>} */ ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" });
/** @param {string} s */
const esc = (s) => s.replace(/[&<>"']/g, (ch) => ESCAPE[ch] ?? ch);
/** One small page, every value escaped (finding 35). @param {string} title @param {string} text */
const page = (title, text) =>
  `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${esc(title)} · NetworkBase</title>` +
  `<body style="font:15px system-ui;margin:0;display:grid;place-items:center;min-height:100vh;background:Canvas;color:CanvasText">` +
  `<main style="max-width:420px;padding:24px;text-align:center"><h1 style="font-size:18px">${esc(title)}</h1><p>${esc(text)}</p></main>`;

/** @param {Context} ctx */
export async function logout(ctx) {
  if (ctx.flags.all) {
    // Signing out everywhere revokes every device and agent; that needs the browser's fresh check (report A3.9).
    const url = `${ctx.profile.origin}/settings?tab=integrations`;
    const opened = await openInBrowser(url);
    return ctx.out.result("nb.logout.all/1", { url, opened }, (d) => [`${d.opened ? "Opened" : "Open"} ${d.url}`, ctx.out.c.muted("  Choose \"Sign out all devices\" there; it asks you to confirm it's you. Or revoke one with nb token revoke <id>.")]);
  }
  if (!ctx.profile.token) throw new CliError("NOT_SIGNED_IN", `You're not signed in to ${new URL(ctx.profile.origin).host}`);
  if (ctx.profile.profile?.source === "env") throw usage("The token comes from NETWORKBASE_TOKEN; unset it to sign out");
  let revoked = true;
  /** @type {string | null} */
  let reason = null;
  try {
    await ctx.api.post("/api/v1/extension/session", {});
  } catch (error) {
    revoked = false;
    reason = error instanceof Error ? error.message : String(error);
  }
  saveProfile(ctx.profile.name, null, ctx.env);
  // Honest about what happened (finding 42): local sign-out always works; server revocation may not.
  ctx.out.result("nb.logout/1", { revoked, signedOutLocally: true, reason }, (d) =>
    d.revoked ? `${ctx.out.c.success(ctx.out.sym.done)} Signed out and revoked this device's token` : [`${ctx.out.c.warning(ctx.out.sym.warn)} Signed out here, but the server didn't revoke the token: ${safe(d.reason)}`, ctx.out.c.muted("  Revoke it in Settings → Integrations → Signed-in devices")]);
}

/** @param {Context} ctx */
export async function whoami(ctx) {
  if (ctx.flags.all) return whoamiAll(ctx);
  const me = /** @type {any} */ (await ctx.api.get("/api/v1/me"));
  const data = { origin: ctx.profile.origin, profile: ctx.profile.name, tokenSource: ctx.profile.profile?.source ?? null, storage: ctx.profile.profile?.storage ?? "file", ...me };
  ctx.out.result("nb.whoami/1", data, (d) => [
    `${ctx.out.c.brand(ctx.out.sym.brand)} ${safe(d.user.username ? `@${d.user.username}` : d.user.email ?? d.user.id)}${d.user.fullName ? ` · ${safe(d.user.fullName)}` : ""}`,
    `  server   ${new URL(d.origin).host}${d.profile !== "default" ? ` (profile ${d.profile})` : ""}`,
    `  token    ${d.credential.type ? `${d.credential.type === "agent" ? "agent" : d.credential.type === "pat" ? "personal access" : "device"} · ` : ""}${d.tokenSource === "env" ? "from NETWORKBASE_TOKEN" : `kept in ${storageWords(d.storage)}`} · ${d.access ? (d.access.allWorkspaces ? "all your workspaces" : `only ${safe(d.access.workspaceTitle ?? "one workspace")}`) : d.credential.workspaceId ? "one workspace only" : d.credential.type === "device" ? "all your workspaces" : `${d.credential.scopes.length} permissions`}`,
    // An agent's access in the approval page's words (report A4, A10 "nb whoami and Settings show the same sentence").
    ...(d.access ? [`  access   ${safe(d.access.sentence)}`] : []),
    // Your own sign-in in a sentence too (report C16 #7).
    ...(!d.access && d.credential.type === "device" ? [`  access   Your own sign-in: does what you can, in all your workspaces${d.credential.expiresAt ? `, until ${new Date(d.credential.expiresAt).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}` : ""}.`] : []),
    `  files    up to ${Math.round(d.limits.largestFileBytes / 1024 / 1024)} MB each`,
    ...(ctx.flags.verbose ? [`  can      ${d.credential.scopes.join(", ")}`] : []),
  ]);
}

/** Every saved profile with who it is and where (`nb whoami --all`, report A3.5). @param {Context} ctx */
export async function whoamiAll(ctx) {
  const profiles = Object.entries(listProfiles(ctx.env));
  const rows = [];
  for (const [name, p] of profiles) {
    const { currentProfile } = await import("../config.mjs");
    const prof = currentProfile({ flags: { profile: name, "api-url": p.origin }, env: { ...ctx.env, NB_TOKEN: "", NETWORKBASE_TOKEN: "" } });
    let user = p.user?.username ?? p.user?.email ?? null;
    let ok = false;
    if (prof.token) {
      try {
        const me = /** @type {any} */ (await createApi({ origin: p.origin, token: prof.token, version: ctx.version }).get("/api/v1/me"));
        user = me.user.username ?? me.user.email ?? user;
        ok = true;
      } catch {
        ok = false;
      }
    }
    rows.push({ profile: name, server: new URL(p.origin).host, user, signedIn: ok, storage: p.storage ?? "file", current: name === ctx.profile.name });
  }
  ctx.out.result("nb.whoami.all/1", { profiles: rows }, (d) =>
    d.profiles.length
      ? ctx.out.table([
          { title: "", value: (r) => (r.current ? ctx.out.c.brand(ctx.out.sym.brand) : " ") },
          { title: "Profile", value: (r) => safe(r.profile) },
          { title: "Server", value: (r) => r.server, flex: true },
          { title: "User", value: (r) => (r.user ? safe(r.user) : "—") },
          { title: "Status", value: (r) => (r.signedIn ? ctx.out.c.success("signed in") : ctx.out.c.warning("sign in again")) },
        ], d.profiles)
      : "No saved sign-ins. Run nb login");
}

/** Your signed-in devices, agents and personal tokens (`nb token list`, report A3.9). @param {Context} ctx */
export async function tokenList(ctx) {
  const { tokens } = /** @type {any} */ (await ctx.api.get("/api/v1/tokens"));
  ctx.out.result("nb.token.list/1", { tokens }, (d) =>
    d.tokens.length
      ? ctx.out.table([
          { title: "", value: (t) => (t.current ? ctx.out.c.brand(ctx.out.sym.brand) : " ") },
          { title: "Id", value: (t) => String(t.id).slice(0, 8) },
          { title: "Type", value: (t) => t.type },
          { title: "Name", value: (t) => safe(t.type === "agent" && t.agentName ? `${t.agentName} on ${t.name}` : t.name), flex: true },
          { title: "Workspace", value: (t) => (t.workspace ? safe(t.workspace) : "all"), optional: true },
          { title: "Last used", value: (t) => (t.lastUsedAt ? String(t.lastUsedAt).slice(0, 10) : "—"), optional: true },
        ], d.tokens)
      : "No signed-in devices or tokens");
}

/** @param {Context} ctx */
export async function tokenRevoke(ctx) {
  const id = ctx.positionals[0];
  if (!id) throw usage("nb token revoke <id>  (ids from nb token list)");
  const { tokens } = /** @type {any} */ (await ctx.api.get("/api/v1/tokens"));
  const hit = tokens.filter((/** @type {any} */ t) => String(t.id).startsWith(id));
  if (hit.length !== 1) throw new CliError("NOT_FOUND", hit.length ? `${id} matches ${hit.length} tokens; give more of the id` : `No token ${id}`, { hint: "nb token list" });
  const t = hit[0];
  const { confirm } = await import("../tui/ask.mjs");
  if (!(await confirm(ctx, { key: "revoke", question: `Revoke ${t.type === "agent" ? `${t.agentName ?? "the agent"} on ${t.name}` : t.name}${t.current ? " (this one: you'll be signed out here)" : ""}?`, yesLabel: "Revoke", defaultYes: false }))) return 130;
  await ctx.api.post(`/api/v1/tokens/${t.id}/revoke`, {});
  if (t.current) saveProfile(ctx.profile.name, null, ctx.env);
  ctx.out.result("nb.token.revoke/1", { id: t.id, type: t.type }, () => `${ctx.out.c.success(ctx.out.sym.done)} Revoked`);
}
