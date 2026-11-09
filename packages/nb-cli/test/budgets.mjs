// Size and startup budgets (report A13.8). Reports always; `--enforce` fails when over.
// Size: report A13.8 aimed for 150 KB; 2.0 is held to no bigger than 1.0.4 (193,446 B) instead (phase 2 notes).
import { startFakeServer } from "./helpers/fake-server.mjs";
import { cliMs, unpackedBytes } from "./helpers/measure.mjs";

const BUDGET = { unpackedBytes: 193_446, versionMs: 120, helpMs: 200 };

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
