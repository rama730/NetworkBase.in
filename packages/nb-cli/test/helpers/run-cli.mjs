// Runs the CLI as a separate process with an isolated HOME, so tests never read or
// write the developer's real ~/.networkbase and never reach the network.
import { spawn } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const PACKAGE_DIR = path.resolve(here, "../..");
export const CLI_PATH = path.join(PACKAGE_DIR, "bin", "nb.mjs");
export const CLI_PACKAGE = JSON.parse(fs.readFileSync(path.join(PACKAGE_DIR, "package.json"), "utf8"));

/** @param {string} prefix */
export const tempDir = (prefix) => fsp.mkdtemp(path.join(os.tmpdir(), prefix));

/**
 * Only what a process needs to start; nothing from the developer's environment
 * (their NETWORKBASE_TOKEN, NB_* settings) leaks in.
 * @param {string} home
 */
export function cleanEnv(home) {
  /** @type {Record<string, string>} */
  const env = { HOME: home, USERPROFILE: home, NO_COLOR: "1", NB_NO_UPDATE_CHECK: "1" };
  for (const key of ["PATH", "SYSTEMROOT", "TMPDIR", "TEMP", "TMP", "LANG"]) {
    const value = process.env[key];
    if (value) env[key] = value;
  }
  return env;
}

/**
 * @param {string[]} args
 * @param {{ api: string, token?: string | null, cwd?: string, home?: string, env?: Record<string, string>, input?: string, timeoutMs?: number }} options
 * @returns {Promise<{ code: number | null, stdout: string, stderr: string, home: string, cwd: string }>}
 */
export async function runCli(args, { api, token = "nb_pat_test", cwd, home, env = {}, input, timeoutMs = 15_000 }) {
  const runHome = home ?? (await tempDir("nb-home-"));
  const runCwd = cwd ?? (await tempDir("nb-cwd-"));
  /** @type {Record<string, string>} */
  const fullEnv = { ...cleanEnv(runHome), NETWORKBASE_API_URL: api, ...env };
  if (token) fullEnv.NETWORKBASE_TOKEN = token;

  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [CLI_PATH, ...args], { cwd: runCwd, env: fullEnv, stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d; });
    child.stderr.on("data", (d) => { stderr += d; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`nb ${args.join(" ")} timed out after ${timeoutMs} ms\n${stderr}`)); }, timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr, home: runHome, cwd: runCwd }); });
    child.stdin.end(input ?? "");
  });
}
