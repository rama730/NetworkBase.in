// login, logout, whoami (report A3.1 browser row, A3.9, A3.14, A3.16).
import crypto from "node:crypto";
import http from "node:http";

import { createApi } from "../api.mjs";
import { saveProfile } from "../config.mjs";
import { CliError, usage } from "../errors.mjs";
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

/** @param {Context} ctx @param {string} token @param {string} method */
async function finish(ctx, token, method) {
  const me = await whoIs(ctx, token);
  saveProfile(ctx.profile.name, { origin: ctx.profile.origin, token, user: { id: me.user.id, username: me.user.username, email: me.user.email } }, ctx.env);
  ctx.out.result("nb.login/1", { method, origin: ctx.profile.origin, profile: ctx.profile.name, user: me.user, scopes: me.credential.scopes }, (d) =>
    `${ctx.out.c.success(ctx.out.sym.done)} Signed in as ${safe(d.user.username ? `@${d.user.username}` : d.user.email ?? d.user.id)} on ${new URL(d.origin).host}${d.profile !== "default" ? ` (profile ${d.profile})` : ""}`);
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
  if (ctx.flags.device) {
    throw new CliError("NOT_SUPPORTED", "Signing in with a code from another device arrives with agent sign-in", { hint: "For now: make a token in Settings → Integrations and run nb login --with-token" });
  }
  if (!process.stdin.isTTY && !ctx.env.NB_FORCE_BROWSER_LOGIN) {
    throw new CliError("NEEDS_INPUT", "Browser sign-in needs a terminal", { hint: "In scripts and CI: echo $TOKEN | nb login --with-token, or set NETWORKBASE_TOKEN" });
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
  const me = /** @type {any} */ (await ctx.api.get("/api/v1/me"));
  const data = { origin: ctx.profile.origin, profile: ctx.profile.name, tokenSource: ctx.profile.profile?.source ?? null, ...me };
  ctx.out.result("nb.whoami/1", data, (d) => [
    `${ctx.out.c.brand(ctx.out.sym.brand)} ${safe(d.user.username ? `@${d.user.username}` : d.user.email ?? d.user.id)}${d.user.fullName ? ` · ${safe(d.user.fullName)}` : ""}`,
    `  server   ${new URL(d.origin).host}${d.profile !== "default" ? ` (profile ${d.profile})` : ""}`,
    `  token    ${d.tokenSource === "env" ? "from NETWORKBASE_TOKEN" : "saved in ~/.networkbase"} · ${d.credential.scopes.length} permissions`,
    `  files    up to ${Math.round(d.limits.largestFileBytes / 1024 / 1024)} MB each`,
    ...(ctx.flags.verbose ? [`  can      ${d.credential.scopes.join(", ")}`] : []),
  ]);
}
