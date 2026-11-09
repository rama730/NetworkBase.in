// Size and startup budgets (report A13.8). Reports always; `--enforce` fails when over.
// Phase 0 records 1.x numbers; enforcement starts with CLI 2.0 (Phase 2).
import { startFakeServer } from "./helpers/fake-server.mjs";
import { cliMs, unpackedBytes } from "./helpers/measure.mjs";

const BUDGET = { unpackedBytes: 150 * 1024, versionMs: 120, helpMs: 200 };

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
