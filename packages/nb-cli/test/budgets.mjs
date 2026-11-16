// Size and startup budgets (report A13.8). Reports always; `--enforce` fails when over.
// Size: report A13.8 aimed for 150 KB; 2.0 with its MCP server and the full §17.4 command set was held to 320 KB,
// unminified (phase 3 notes). Phases 5–6 (assignments, review, inbox, live pull, git extras) took it to 344 KiB
// (103 KB packed), so the ceiling was 400 KiB. M4a (2.1.0: home screen, filters, bulk, queue, file use, inbox reply,
// the error catalog's next steps) took it to 421 KiB, so the ceiling was 480 KiB. M4b (2.1.2: labels, watch, star,
// reminders, file trash/restore/copy/lock, members, updates, search, help topics, nb edit/commit/uninstall,
// completions with real names) took it to 501 KiB (148 KB packed), so the ceiling was 560 KiB. M4c (agents: packs,
// briefing, notes, presence) took it to 550 KiB and M4d's messages, nb learn and nb start to 568 KiB (166 KB packed),
// so the ceiling is 640 KiB for M4d's nb ui; M5 checks it again.
// Startup stays within budget because command modules load only when used.
import { putFile, startFakeServer } from "./helpers/fake-server.mjs";
import { cliMs, medianMs, unpackedBytes } from "./helpers/measure.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

// statusMs (C6): nb status in a linked folder of 50 files, the everyday command, against the local fake server.
const BUDGET = { unpackedBytes: 640 * 1024, versionMs: 120, helpMs: 200, statusMs: 400 };

const api = await startFakeServer();
const cwd = await tempDir("nb-budget-");
const home = await tempDir("nb-budget-home-");
for (let i = 0; i < 50; i++) putFile(api.state, `/docs/f${i}.md`, Buffer.from(`file ${i}`));
await runCli(["init", "design-lab"], { api: api.url, cwd, home });
await runCli(["pull"], { api: api.url, cwd, home });
const result = {
  unpackedBytes: unpackedBytes(),
  versionMs: await cliMs(["--version"], api.url),
  helpMs: await cliMs(["help"], api.url),
  statusMs: await medianMs(10, async () => () => runCli(["status"], { api: api.url, cwd, home })),
};
await api.close();

const over = Object.entries(BUDGET).filter(([k, limit]) => result[/** @type {keyof typeof result} */ (k)] > limit);
console.log(JSON.stringify({ ...result, budget: BUDGET, over: over.map(([k]) => k) }, null, 2));
if (process.argv.includes("--enforce") && over.length) process.exit(1);
