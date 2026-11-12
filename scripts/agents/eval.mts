// The agent evaluation (report A7.12, D22): runs every request in tests/agents/requests.yaml through an agent's
// headless mode with the NetworkBase MCP server, and scores the tool calls. Before a release that changes tool
// names or descriptions: pass rate must stay at 90 % or more and not fall below the last release (baseline);
// fix failures in descriptions, not prompts.
//
//   npx tsx scripts/agents/eval.mts --agent claude|codex|gemini|copilot [--only id1,id2] [--persona student]
//       [--folder <linked folder>] [--out results.json] [--baseline tests/agents/baseline.json]
//
// Needs: a linked folder (`nb init`, then `nb agent setup <agent> --token mine`, as a person would) on a server with
// the seed data (scripts/agents/seed-eval.ts), the agent CLI signed in, and `nb` 2.x reachable as
// `npx @networkbase/cli@2` or NB_CLI=<path to packages/nb-cli/bin/nb.mjs>.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { parse } from "yaml";

/** An expect entry is a tool, or a list of tools any one of which is right ("the brief or the file list"). */
type Request = { id: string; say: string; persona?: string; expect?: Array<string | string[]>; forbid?: string[]; note?: string };
type Call = { name: string; held: boolean };
const args = new Map(process.argv.slice(2).flatMap((a, i, all) => (a.startsWith("--") ? [[a.slice(2), all[i + 1] ?? ""]] : [])));
const agent = args.get("agent") ?? "claude";
const only = args.get("only")?.split(",");
const persona = args.get("persona");
const folder = path.resolve(args.get("folder") ?? process.cwd());
const requests = (parse(fs.readFileSync("tests/agents/requests.yaml", "utf8")) as Request[])
  .filter((r) => (!only || only.includes(r.id)) && (!persona || (r.persona ?? "normal") === persona));
const cli = process.env.NB_CLI ? ["node", process.env.NB_CLI] : ["npx", "-y", "@networkbase/cli@2"];
const strip = (name: string) => name.replace(/^mcp__networkbase__/, "").replace(/^networkbase[.:/]/, "").replace(/^networkbase-/, "");

/**
 * Tool calls from an agent's JSON-lines output. Claude Code and Codex have known shapes; for the others any object
 * naming a networkbase_ tool counts, and a later line saying needs_confirmation marks the call as held.
 */
export function toolCalls(output: string) {
  const calls: Call[] = [];
  for (const line of output.split("\n")) {
    if (!line.trim().startsWith("{")) continue;
    let msg: any;
    try { msg = JSON.parse(line); } catch { continue; }
    let known = false;
    for (const part of msg?.message?.content ?? msg?.item?.content ?? []) {
      const name = part?.name ?? part?.tool ?? "";
      // networkbase_run { tool } counts as the tool it ran.
      if (part?.type === "tool_use" && name.includes("networkbase_")) { calls.push({ name: strip(name).endsWith("networkbase_run") && part.input?.tool ? String(part.input.tool) : strip(name), held: false }); known = true; }
      if (part?.type === "tool_result" && /needs_confirmation/.test(JSON.stringify(part.content ?? "")) && calls.length) { calls.at(-1)!.held = true; known = true; }
    }
    if (msg?.type === "item.completed" && msg.item?.type === "mcp_tool_call") { calls.push({ name: msg.item.tool === "networkbase_run" && msg.item.arguments?.tool ? String(msg.item.arguments.tool) : String(msg.item.tool), held: /needs_confirmation/.test(JSON.stringify(msg.item.result ?? "")) }); known = true; }
    if (known) continue;
    // Gemini CLI, GitHub Copilot and others: the first networkbase_ tool name in a line that starts a call.
    const text = JSON.stringify(msg);
    const named = /"(?:name|toolName|tool|tool_name)":"((?:mcp__networkbase__|networkbase[.:/-])?networkbase_[a-z_]+)"/.exec(text);
    if (named && !/"(?:type|kind|event)":"[^"]*(?:result|response|output|completed)"/.test(text)) calls.push({ name: strip(named[1]!), held: false });
    else if (/needs_confirmation/.test(text) && calls.length) calls.at(-1)!.held = true;
  }
  return calls;
}

/** Input + output tokens, where the agent reports them (Claude Code's result line). */
function tokensOf(output: string) {
  for (const line of output.split("\n").reverse()) {
    if (!line.includes('"usage"')) continue;
    try {
      const u = JSON.parse(line)?.usage;
      if (u) return (u.input_tokens ?? 0) + (u.output_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
    } catch { /* not this line */ }
  }
  return null;
}

/** Each expect entry (or one of its alternatives) appears, in order; other calls may come between. */
export function expectsInOrder(expect: Array<string | string[]>, names: string[]) {
  let at = 0;
  return expect.every((want) => {
    const options = Array.isArray(want) ? want : [want];
    const hits = options.map((t) => names.indexOf(t, at)).filter((i) => i >= 0);
    if (!hits.length) return false;
    at = Math.min(...hits) + 1;
    return true;
  });
}

/** The local files the requests talk about ("push this code", "report.pdf"), so pushes have something to push. */
function prepareFolder(dir: string) {
  const files: Record<string, string> = { "src/app.ts": "export const app = () => 'hello';\n", "report.pdf": "%PDF-1.4 quarterly report\n", "screenshots/home.png": "png", "screenshots/login.png": "png", "notes.md": "# Notes\n\nLocal changes to sync.\n" };
  for (const [rel, body] of Object.entries(files)) {
    const file = path.join(dir, rel);
    if (fs.existsSync(file)) continue;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, body);
  }
}

const mcpServer = { command: cli[0], args: [...cli.slice(1), "mcp"] };
function run(say: string) {
  const opts = { cwd: folder, encoding: "utf8" as const, timeout: 300_000, maxBuffer: 64 * 1024 * 1024 };
  if (agent === "claude") {
    const config = path.join(os.tmpdir(), "nb-eval-mcp.json");
    fs.writeFileSync(config, JSON.stringify({ mcpServers: { networkbase: mcpServer } }));
    return execFileSync("claude", ["-p", say, "--output-format", "stream-json", "--verbose", "--mcp-config", config, "--allowedTools", "mcp__networkbase__*", "--max-turns", "8",
      // The person's own hooks, plugins and MCP servers would change the answers: project settings only.
      "--setting-sources", "project,local", "--strict-mcp-config"], opts);
  }
  if (agent === "codex") return execFileSync("codex", ["exec", "--json", "-c", `mcp_servers.networkbase.command="${mcpServer.command}"`, "-c", `mcp_servers.networkbase.args=${JSON.stringify(mcpServer.args)}`, say], opts);
  // Gemini CLI reads the folder's .gemini/settings.json (nb agent setup gemini --token mine).
  if (agent === "gemini") return execFileSync("gemini", ["-p", say, "--output-format", "stream-json", "--yolo"], opts);
  if (agent === "copilot") {
    return execFileSync("copilot", ["-p", say, "--output-format", "json", "--allow-all-tools", "--additional-mcp-config", JSON.stringify({ mcpServers: { networkbase: { type: "local", ...mcpServer, tools: ["*"] } } })], opts);
  }
  throw new Error(`No runner for ${agent}: claude, codex, gemini or copilot`);
}

type Row = { id: string; persona: string; ok: boolean; calls: string[]; forbidden: string[]; error: string; ms: number; tokens: number | null };
const rows: Row[] = [];
if (import.meta.url === `file://${process.argv[1]}`) {
  if (fs.existsSync(path.join(folder, ".networkbase"))) prepareFolder(folder);
  for (const r of requests) {
    let calls: Call[] = [];
    let error = "";
    // A run that ends in an error (often the turn limit) still made tool calls: score what it printed.
    let out = "";
    const started = Date.now();
    try { out = run(r.say); calls = toolCalls(out); } catch (e) {
      out = (e as { stdout?: string }).stdout ?? "";
      calls = toolCalls(out);
      if (!calls.length) error = e instanceof Error ? e.message.split("\n")[0]! : String(e);
    }
    // EVAL_LOG_DIR keeps each request's transcript, to see why one failed.
    if (process.env.EVAL_LOG_DIR) fs.writeFileSync(path.join(process.env.EVAL_LOG_DIR, `${r.id}.jsonl`), out);
    const names = calls.map((c) => c.name);
    let at = 0;
    const inOrder = expectsInOrder(r.expect ?? [], names);
    const forbidden = calls.filter((c) => (r.forbid ?? []).includes(c.name) && !c.held).map((c) => c.name);
    const ok = !error && inOrder && forbidden.length === 0;
    rows.push({ id: r.id, persona: r.persona ?? "normal", ok, calls: names, forbidden, error, ms: Date.now() - started, tokens: tokensOf(out) });
    console.log(`${ok ? "pass" : "FAIL"}  ${r.id.padEnd(16)} ${names.join(" → ") || "(no tools)"}${forbidden.length ? `  forbidden: ${forbidden.join(", ")}` : ""}${error ? `  error: ${error}` : ""}`);
  }
  const passed = rows.filter((r) => r.ok).length;
  const rate = Math.round((passed / Math.max(1, rows.length)) * 100);
  const byPersona = Object.fromEntries([...new Set(rows.map((r) => r.persona))].map((p) => { const of = rows.filter((r) => r.persona === p); return [p, `${of.filter((r) => r.ok).length}/${of.length}`]; }));
  const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null);
  const summary = { agent, date: new Date().toISOString(), passed, total: rows.length, rate, byPersona, avgCalls: avg(rows.map((r) => r.calls.length)), avgMs: avg(rows.map((r) => r.ms)), avgTokens: avg(rows.flatMap((r) => (r.tokens === null ? [] : [r.tokens]))) };
  console.log(`\n${agent}: ${passed}/${rows.length} (${rate} %) · ${Object.entries(byPersona).map(([p, s]) => `${p} ${s}`).join(", ")} · ${summary.avgCalls} calls, ${summary.avgMs} ms${summary.avgTokens ? `, ${summary.avgTokens} tokens` : ""} per request`);
  if (args.get("out")) fs.writeFileSync(args.get("out")!, `${JSON.stringify({ summary, rows }, null, 2)}\n`);
  // A drop below the last release's score blocks the release (D22).
  const baselineFile = args.get("baseline");
  const baseline = baselineFile && fs.existsSync(baselineFile) ? (JSON.parse(fs.readFileSync(baselineFile, "utf8")) as Record<string, { rate: number }>)[agent] : undefined;
  if (baseline && rate < baseline.rate) console.log(`Regression: ${rate} % is below the last release's ${baseline.rate} %`);
  process.exit(rate >= 90 && (!baseline || rate >= baseline.rate) ? 0 : 1);
}
