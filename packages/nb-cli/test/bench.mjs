// Before/after numbers for each phase (report §40). Runs against the local fake API,
// so the numbers measure client overhead, not network time.
import fs from "node:fs";
import path from "node:path";
import { startFakeServer, putFile, WORKSPACE_ID } from "./helpers/fake-server.mjs";
import { cliMs, medianMs, unpackedBytes } from "./helpers/measure.mjs";
import { runCli, tempDir } from "./helpers/run-cli.mjs";

const RUNS = Number(process.env.BENCH_RUNS ?? 10);
const api = await startFakeServer();

/** A folder linked to the fake workspace, with `count` files of 1 KB (content varies per run). @param {number} count @param {number} run */
async function linkedFolderWithFiles(count, run) {
  const cwd = await tempDir("nb-bench-");
  fs.mkdirSync(path.join(cwd, ".networkbase"));
  fs.writeFileSync(path.join(cwd, ".networkbase", "config.json"), JSON.stringify({ projectId: WORKSPACE_ID, title: "Design Lab", slug: "design-lab", apiUrl: api.url }));
  const names = [];
  for (let i = 0; i < count; i++) {
    const name = `f${i}.txt`;
    fs.writeFileSync(path.join(cwd, name), `run ${run} file ${i} `.padEnd(1024, "x"));
    names.push(name);
  }
  return { cwd, names };
}

const pushMs = (/** @type {number} */ count) =>
  medianMs(RUNS, async (run) => {
    const { cwd, names } = await linkedFolderWithFiles(count, run);
    return () => runCli(["push", ...names, "--draft", "--json"], { api: api.url, cwd });
  });

for (let i = 0; i < 1000; i++) putFile(api.state, `/docs/file-${i}.md`, Buffer.from(`# File ${i}\n`.padEnd(2048, "y")));
const pull1000Ms = await medianMs(Math.min(RUNS, 5), async () => {
  const cwd = await tempDir("nb-bench-pull-");
  fs.mkdirSync(path.join(cwd, ".networkbase"));
  fs.writeFileSync(path.join(cwd, ".networkbase", "config.json"), JSON.stringify({ projectId: WORKSPACE_ID, title: "Design Lab", slug: "design-lab", apiUrl: api.url }));
  return async () => {
    const r = await runCli(["pull", "--json"], { api: api.url, cwd, timeoutMs: 120_000 });
    if (r.code !== 0) throw new Error(`pull failed: ${r.stderr || r.stdout}`);
  };
});

const result = {
  cliVersion: JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8")).version,
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  runs: RUNS,
  unpackedBytes: unpackedBytes(),
  versionMs: await cliMs(["--version"], api.url, RUNS),
  helpMs: await cliMs(["help"], api.url, RUNS),
  push1Ms: await pushMs(1),
  push50Ms: await pushMs(50),
  pull1000Ms,
};
await api.close();
console.log(JSON.stringify(result, null, 2));
