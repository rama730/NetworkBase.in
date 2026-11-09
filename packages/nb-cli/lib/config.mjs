// Where the CLI keeps things, and which setting wins (report A1.1, A1.2, A3.5, A3.8, A3.16, A4.3).
//   ~/.networkbase/credentials.json  tokens per profile, each bound to the server that issued it (0600)
//   ~/.networkbase/config.json       user settings
//   <root>/.networkbase/config.json  the folder's link: workspace id, slug, started task (never a server URL)
//   <root>/.networkbase/state.json   what was last synced (the base for three-way decisions)
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { CliError } from "./errors.mjs";

export const DEFAULT_ORIGIN = "https://networkbase.in";
export const DIR_NAME = ".networkbase";

export const globalDir = (env = process.env) => path.join(env.NB_HOME || os.homedir(), DIR_NAME);

/** Write a file so readers see the old or the new content, never half (A1.9). @param {string} file @param {string | Uint8Array} data @param {number} [mode] */
export function writeAtomic(file, data, mode = 0o600) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const tmp = `${file}.nbtmp-${crypto.randomBytes(4).toString("hex")}`;
  const fd = fs.openSync(tmp, "w", mode);
  try {
    fs.writeSync(fd, typeof data === "string" ? Buffer.from(data) : data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, file);
}

/** @param {string} file @returns {any} */
export function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (error) {
    if (/** @type {NodeJS.ErrnoException} */ (error).code === "ENOENT") return null;
    throw new CliError("CORRUPT_STATE", `${file} can't be read`, { hint: "Run nb doctor --repair", cause: error });
  }
}

/** @param {string} origin */
export function normalizeOrigin(origin) {
  let url;
  try {
    url = new URL(origin);
  } catch {
    throw new CliError("USAGE", `${origin} isn't a web address`);
  }
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
    throw new CliError("USAGE", `${origin} must use https (http only for localhost)`);
  }
  return url.origin;
}

/**
 * @typedef {{ origin: string, token: string, user?: { id: string, username?: string | null, email?: string | null } | null, savedAt?: string, source?: "file" | "env" }} Profile
 */

/** Settings: flag > environment > project > user > default. @param {{ profile?: string }} [flags] @param {NodeJS.ProcessEnv} [env] @param {any} [project] */
export function resolveProfileName(flags = {}, env = process.env, project = null) {
  return /** @type {string} */ (flags.profile || env.NB_PROFILE || /** @type {any} */ (project)?.profile || "default");
}

/** @param {NodeJS.ProcessEnv} env */
function readCredentialFile(env) {
  const raw = readJson(path.join(globalDir(env), "credentials.json"));
  if (!raw) return { profiles: {} };
  // 1.x stored one token with its server; it becomes the default profile, bound to that server.
  if (!raw.profiles && typeof raw.token === "string") {
    return { profiles: { default: { origin: normalizeOrigin(raw.apiUrl || DEFAULT_ORIGIN), token: raw.token, user: raw.user ?? null, savedAt: raw.savedAt } } };
  }
  return raw;
}

/**
 * The token to use, and the only server it may be sent to (report A3.8, finding 28).
 * @param {{ flags?: Record<string, any>, env?: NodeJS.ProcessEnv, project?: any }} [ctx]
 * @returns {{ name: string, origin: string, token: string | null, profile: Profile | null }}
 */
export function currentProfile(ctx = {}) {
  const env = ctx.env ?? process.env;
  const flags = ctx.flags ?? {};
  const name = resolveProfileName(flags, env, ctx.project);
  const wanted = flags["api-url"] || env.NB_API_URL || env.NETWORKBASE_API_URL;
  const envToken = env.NB_TOKEN || env.NETWORKBASE_TOKEN;
  if (envToken) {
    const origin = normalizeOrigin(wanted || DEFAULT_ORIGIN);
    return { name, origin, token: envToken, profile: { origin, token: envToken, source: "env" } };
  }
  const saved = readCredentialFile(env).profiles?.[name] ?? null;
  const origin = normalizeOrigin(wanted || saved?.origin || DEFAULT_ORIGIN);
  // A token is only ever sent to the server that issued it.
  if (saved && saved.origin === origin) return { name, origin, token: saved.token, profile: { ...saved, source: "file" } };
  return { name, origin, token: null, profile: null };
}

/** @param {string} name @param {Profile | null} profile @param {NodeJS.ProcessEnv} [env] */
export function saveProfile(name, profile, env = process.env) {
  const file = path.join(globalDir(env), "credentials.json");
  const data = readCredentialFile(env);
  data.profiles = data.profiles ?? {};
  if (profile) data.profiles[name] = { ...profile, savedAt: new Date().toISOString() };
  else delete data.profiles[name];
  writeAtomic(file, `${JSON.stringify(data, null, 2)}\n`, 0o600);
}

/** All saved profiles (for `nb whoami --all`). @param {NodeJS.ProcessEnv} [env] */
export const listProfiles = (env = process.env) => /** @type {Record<string, Profile>} */ (readCredentialFile(env).profiles ?? {});

/** User settings in ~/.networkbase/config.json. @param {NodeJS.ProcessEnv} [env] */
export const readUserConfig = (env = process.env) => readJson(path.join(globalDir(env), "config.json")) ?? {};
/** @param {Record<string, unknown>} config @param {NodeJS.ProcessEnv} [env] */
export const writeUserConfig = (config, env = process.env) => writeAtomic(path.join(globalDir(env), "config.json"), `${JSON.stringify(config, null, 2)}\n`);

/**
 * The linked folder above `cwd`, like git (A1.1 item 2). Stops at the filesystem root.
 * @param {string} cwd
 * @returns {string | null}
 */
export function findRoot(cwd) {
  let dir = path.resolve(cwd);
  for (;;) {
    if (fs.existsSync(path.join(dir, DIR_NAME, "config.json"))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * @typedef {{ workspaceId: string, slug?: string | null, title?: string | null, remoteRoot: string, startedTask?: { id: string, number?: number | null, title?: string | null } | null, profile?: string | null, linkedAt?: string }} ProjectConfig
 */

/**
 * The folder's link. 1.x configs (`projectId`, `apiUrl`) are read; their server URL is ignored, because a
 * file inside a project must never decide where your token goes (A3.8).
 * @param {string} root
 * @param {(message: string) => void} [warn]
 * @returns {ProjectConfig | null}
 */
export function readProjectConfig(root, warn) {
  const raw = readJson(path.join(root, DIR_NAME, "config.json"));
  if (!raw) return null;
  if (raw.apiUrl && warn) warn(`Ignoring the server address in ${path.join(root, DIR_NAME, "config.json")}: a project file can't choose where your token is sent. Use --api-url or nb login.`);
  return {
    workspaceId: raw.workspaceId ?? raw.projectId,
    slug: raw.slug ?? null,
    title: raw.title ?? null,
    remoteRoot: raw.remoteRoot ?? "/",
    startedTask: raw.startedTask ?? null,
    profile: raw.profile ?? null,
    linkedAt: raw.linkedAt,
  };
}

/** @param {string} root @param {ProjectConfig} config */
export function writeProjectConfig(root, config) {
  const dir = path.join(root, DIR_NAME);
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  // Never commit the link, tokens or sync state to the user's git repo (A1.2, finding 62).
  if (!fs.existsSync(path.join(dir, ".gitignore"))) writeAtomic(path.join(dir, ".gitignore"), "*\n", 0o600);
  writeAtomic(path.join(dir, "config.json"), `${JSON.stringify(config, null, 2)}\n`);
}
