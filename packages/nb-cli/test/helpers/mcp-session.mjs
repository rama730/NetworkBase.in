// Talks to `nb mcp` over stdio like Claude Code would: one JSON-RPC message per line. Keeps every stdout line so
// tests can check nothing but JSON-RPC ever appears there (finding 5).
import { spawn } from "node:child_process";
import { CLI_PATH, cleanEnv, tempDir } from "./run-cli.mjs";

/** @param {{ api: string, cwd?: string, home?: string, token?: string }} options */
export async function startMcp({ api, cwd, home, token = "nb_pat_test" }) {
  const env = { ...cleanEnv(home ?? (await tempDir("nb-mcp-home-"))), NETWORKBASE_API_URL: api, NETWORKBASE_TOKEN: token };
  const child = spawn(process.execPath, [CLI_PATH, "mcp"], { cwd: cwd ?? (await tempDir("nb-mcp-cwd-")), env, stdio: ["pipe", "pipe", "pipe"] });
  /** @type {string[]} */
  const lines = [];
  let stderr = "";
  /** @type {Map<number, (msg: any) => void>} */
  const waiting = new Map();
  let buffer = "";
  child.stdout.on("data", (d) => {
    buffer += d;
    let nl;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl);
      buffer = buffer.slice(nl + 1);
      lines.push(line);
      try { const msg = JSON.parse(line); waiting.get(msg.id)?.(msg); waiting.delete(msg.id); } catch { /* checked by tests via lines */ }
    }
  });
  child.stderr.on("data", (d) => { stderr += d; });
  let nextId = 1;
  return {
    lines,
    get stderr() { return stderr; },
    /** @param {string} method @param {any} [params] @returns {Promise<any>} */
    request(method, params) {
      const id = nextId++;
      child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, ...(params ? { params } : {}) })}\n`);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(`${method} timed out\n${stderr}`)), 15_000);
        waiting.set(id, (msg) => { clearTimeout(timer); resolve(msg); });
      });
    },
    /** @param {string} method @param {any} [params] */
    notify(method, params) { child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method, ...(params ? { params } : {}) })}\n`); },
    /** @param {string} raw */
    raw(raw) { child.stdin.write(`${raw}\n`); },
    /** @param {string} name @param {any} [args] */
    async call(name, args = {}) { return (await this.request("tools/call", { name, arguments: args })).result; },
    close() { child.stdin.end(); return new Promise((resolve) => child.on("close", resolve)); },
  };
}
