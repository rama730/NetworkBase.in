// Runs the CLI inside a pseudo-terminal using the system `script` command, so
// interactive prompts and TTY-only output can be tested without dependencies.
import { spawn } from "node:child_process";
import { CLI_PATH, cleanEnv, tempDir } from "./run-cli.mjs";

export const TTY_SUPPORTED = process.platform === "darwin" || process.platform === "linux";

/** @param {string} s */
const shellQuote = (s) => `'${s.replace(/'/g, `'\\''`)}'`;

/** Strip ANSI sequences and terminal line endings so output can be compared as text. @param {string} s */
export const plainText = (s) =>
  s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "")
    .replace(/\^D\x08\x08/g, "");

/**
 * @param {string[]} args
 * @param {{ api: string, keys?: string[], cols?: number, rows?: number, token?: string | null, env?: Record<string, string>, timeoutMs?: number }} options
 * @returns {Promise<{ code: number | null, output: string }>}
 */
export async function runTty(args, { api, keys = [], cols = 80, rows = 24, token = "nb_pat_test", env = {}, timeoutMs = 15_000 }) {
  if (!TTY_SUPPORTED) throw new Error("runTty needs macOS or Linux");
  const home = await tempDir("nb-tty-home-");
  const cwd = await tempDir("nb-tty-cwd-");
  /** @type {Record<string, string>} */
  const fullEnv = { ...cleanEnv(home), NETWORKBASE_API_URL: api, TERM: "xterm-256color", ...env };
  if (token) fullEnv.NETWORKBASE_TOKEN = token;

  const inner = `stty cols ${cols} rows ${rows} 2>/dev/null; exec ${shellQuote(process.execPath)} ${[CLI_PATH, ...args].map(shellQuote).join(" ")}`;
  // macOS `script` rejects Node's socket stdin (tcgetattr EOPNOTSUPP) but accepts a real pipe, so input goes through `cat`.
  const command = process.platform === "darwin"
    ? `cat | script -q /dev/null sh -c ${shellQuote(inner)}`
    : `script -qec ${shellQuote(`sh -c ${shellQuote(inner)}`)} /dev/null`;

  return new Promise((resolve, reject) => {
    const child = spawn("sh", ["-c", command], { cwd, env: fullEnv, stdio: ["pipe", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => { output += d; });
    child.stderr.on("data", (d) => { output += d; });
    const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error(`tty nb ${args.join(" ")} timed out\n${plainText(output)}`)); }, timeoutMs);
    child.on("error", reject);
    child.on("close", (code) => { clearTimeout(timer); resolve({ code, output: plainText(output) }); });
    // Keys are typed with a short gap so raw-mode readers see them as separate presses.
    let delay = 300;
    for (const key of keys) { setTimeout(() => child.stdin.write(key), delay); delay += 150; }
    setTimeout(() => child.stdin.end(), delay + 200);
  });
}
