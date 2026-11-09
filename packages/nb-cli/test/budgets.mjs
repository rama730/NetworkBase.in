// Size and startup budgets (report A13.8). Reports always; `--enforce` fails when over.
// Size: report A13.8 aimed for 150 KB; 2.0 with its MCP server and the full §17.4 command set was held to 320 KB,
// unminified (phase 3 notes). Phases 5–6 (assignments, review, inbox, live pull, git extras) took it to 344 KiB
// (103 KB packed), so the ceiling is 400 KiB. Startup stays within budget because command modules load only when used.
import { startFakeServer } from "./helpers/fake-server.mjs";
import { cliMs, unpackedBytes } from "./helpers/measure.mjs";

const BUDGET = { unpackedBytes: 400 * 1024, versionMs: 120, helpMs: 200 };

const api = await startFakeServer();
const result = {
  unpackedBytes: unpackedBytes(),
  versionMs: await cliMs(["--version"], api.url),
  helpMs: await cliMs(["help"], api.url),
};
await api.close();

const over = Object.entries(BUDGET).filter(([k, limit]) => result[/** @type {keyof typeof result} */ (k)] > limit);
console.log(JSON.stringify({ ...result, budget: BUDGET, over: over.map(([k]) => k) }, null, 2));
if (process.argv.includes("--enforce") && over.length) process.exit(1);
