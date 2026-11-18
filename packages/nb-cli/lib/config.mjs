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
import { readSecret, removeSecret, secureStore, storeSecret } from "./keychain.mjs";

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
  renameRetry(tmp, file);
}

/**
 * fs.renameSync that waits out Windows' brief locks (antivirus, indexer, an open preview: EBUSY/EPERM/EACCES),
 * up to ~1.5 s (A12.16). Elsewhere it's a plain rename.
 * @param {string} from @param {string} to
 */
export function renameRetry(from, to) {
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      const code = /** @type {NodeJS.ErrnoException} */ (error).code;
      if (process.platform !== "win32" || attempt >= 5 || !["EBUSY", "EPERM", "EACCES"].includes(String(code))) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100 * (attempt + 1));
    }
  }
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
 * @typedef {{ origin: string, token: string, user?: { id: string, username?: string | null, email?: string | null } | null, savedAt?: string, expiresAt?: string, source?: "file" | "env", storage?: "keychain" | "secret-service" | "dpapi" | "file", sealed?: string }} Profile
 */

/** Settings: flag > environment > project > user > default. @param {{ profile?: string }} [flags] @param {NodeJS.ProcessEnv} [env] @param {any} [project] */
export function resolveProfileName(flags = {}, env = process.env, project = null) {
  return /** @type {string} */ (flags.profile || env.NB_PROFILE || /** @type {any} */ (project)?.profile || "default");
}

/** The keychain entry's name: one per profile and server. @param {string} name @param {string} origin */
const account = (name, origin) => `${name}@${new URL(origin).host}`;

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
  if (saved && saved.origin === origin) {
    const token = saved.storage && saved.storage !== "file" ? readSecret(saved.storage, account(name, origin), saved.sealed) : saved.token;
    return { name, origin, token: token ?? null, profile: { ...saved, token: token ?? "", source: "file" } };
  }
  return { name, origin, token: null, profile: null };
}

/** Every saved sign-in's name, so nb uninstall can take each one out of the OS keychain too. @param {NodeJS.ProcessEnv} [env] */
export const profileNames = (env = process.env) => Object.keys(readCredentialFile(env).profiles ?? {});

/** @param {string} name @param {Profile | null} profile @param {NodeJS.ProcessEnv} [env] */
export function saveProfile(name, profile, env = process.env) {
  const file = path.join(globalDir(env), "credentials.json");
  const data = readCredentialFile(env);
  data.profiles = data.profiles ?? {};
  const old = data.profiles[name];
  if (old?.storage && old.storage !== "file") removeSecret(old.storage, account(name, old.origin));
  if (profile) {
    // The OS keychain when there is one (report A3.4); the file only holds which store and the user.
    const store = secureStore(env);
    let kept = /** @type {Profile} */ ({ ...profile, storage: "file" });
    if (store) {
      try {
        const extra = storeSecret(store, account(name, profile.origin), profile.token);
        kept = { ...profile, token: "", storage: store, ...extra };
      } catch {
        kept = { ...profile, storage: "file" };
      }
    }
    data.profiles[name] = { ...kept, savedAt: new Date().toISOString() };
  } else delete data.profiles[name];
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
 * @typedef {{ workspaceId: string, slug?: string | null, title?: string | null, remoteRoot: string, startedTask?: { id: string, number?: number | null, title?: string | null } | null, profile?: string | null, linkedAt?: string, branch?: { id: string, name: string } | null, gitBranch?: string | null, only?: string[], knownBranches?: Record<string, string> }} ProjectConfig
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
    /** Folders this copy keeps in sync (C3 `nb sync --only`); none = everything. */
    only: Array.isArray(raw.only) ? raw.only.filter((/** @type {unknown} */ x) => typeof x === "string") : [],
    /** The NetworkBase branch this folder is on (report H6); none = main. Stored by id, the name is for display. */
    branch: raw.branch && typeof raw.branch.id === "string" ? { id: raw.branch.id, name: String(raw.branch.name ?? "") } : null,
    /** The git branch nb last followed, so it only acts when git's changes (H6). */
    gitBranch: typeof raw.gitBranch === "string" ? raw.gitBranch : null,
    /** Branches this folder has been on, id → name, so switching back works offline (H23 journey 9). */
    knownBranches: raw.knownBranches && typeof raw.knownBranches === "object"
      ? Object.fromEntries(Object.entries(raw.knownBranches).filter(([id, n]) => /^[0-9a-f-]{36}$/i.test(id) && typeof n === "string")) : {},
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
