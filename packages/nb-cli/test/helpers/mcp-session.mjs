// Talks to `nb mcp` over stdio the way an MCP client does: one JSON-RPC message per line.
import { spawn } from "node:child_process";
import { CLI_PATH, cleanEnv, tempDir } from "./run-cli.mjs";

/**
 * @param {string} api
 * @param {{ token?: string | null, env?: Record<string, string> }} [options]
 */
export async function mcpSession(api, { token = "nb_pat_test", env = {} } = {}) {
  const home = await tempDir("nb-mcp-home-");
  const cwd = await tempDir("nb-mcp-cwd-");
  /** @type {Record<string, string>} */
  const fullEnv = { ...cleanEnv(home), NETWORKBASE_API_URL: api, ...env };
  if (token) fullEnv.NETWORKBASE_TOKEN = token;
  const child = spawn(process.execPath, [CLI_PATH, "mcp"], { cwd, env: fullEnv, stdio: ["pipe", "pipe", "pipe"] });

  /** Every stdout line, raw, so tests can check that nothing but JSON-RPC was written. @type {string[]} */
  const lines = [];
  /** @type {Array<(msg: any) => void>} */
  const waiters = [];
  /** @type {any[]} */
  const queue = [];
  let buffer = "";
  child.stdout.on("data", (d) => {
    buffer += d;
    let i;
    while ((i = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, i);
      buffer = buffer.slice(i + 1);
      if (!line.trim()) continue;
      lines.push(line);
      let msg;
      try { msg = JSON.parse(line); } catch { msg = { __invalid: line }; }
      const w = waiters.shift();
      if (w) w(msg); else queue.push(msg);
    }
  });

  return {
    lines,
    /** @param {object} msg */
    send(msg) { child.stdin.write(JSON.stringify({ jsonrpc: "2.0", ...msg }) + "\n"); },
    /** Next parsed stdout message (or `{ __invalid }` for a non-JSON line). @param {number} [timeoutMs] @returns {Promise<any>} */
    next(timeoutMs = 10_000) {
      if (queue.length) return Promise.resolve(queue.shift());
      return new Promise((resolve, reject) => {
        const t = setTimeout(() => reject(new Error("MCP server sent nothing")), timeoutMs);
        waiters.push((m) => { clearTimeout(t); resolve(m); });
      });
    },
    /** Wait for the reply with this id, collecting anything printed before it. @param {number | string} id */
    async reply(id) {
      for (;;) {
        const m = await this.next();
        if (m && m.id === id) return m;
      }
    },
    close() { child.stdin.end(); child.kill(); },
  };
}

/** True when a stdout line is a valid JSON-RPC 2.0 message. @param {string} line */
export function isJsonRpcLine(line) {
  try {
    const m = JSON.parse(line);
    return m && m.jsonrpc === "2.0" && ("id" in m || "method" in m);
  } catch {
    return false;
  }
}
