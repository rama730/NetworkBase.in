// The single-file nb (report C7): one program with Node inside, for people without Node. Bundles the CLI with
// esbuild (a build tool here, never a dependency of the package), then injects it into a copy of this Node with
// Node's single executable application support. Runs in the release workflow (publish-cli.yml), from packages/nb-cli:
//   node scripts/single-file.mjs            → build/nb (build/nb.exe on Windows), then checks it runs
//   node scripts/single-file.mjs --bundle   → only build/nb.cjs (checked with plain node)
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const ESBUILD = "esbuild@0.24.2";
const POSTJECT = "postject@1.0.0-alpha.6";
const FUSE = "NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2";
const version = JSON.parse(fs.readFileSync("package.json", "utf8")).version;
const win = process.platform === "win32";
const out = path.resolve("build");
const env = { ...process.env, NB_NO_UPDATE_CHECK: "1" };
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(out);
const npx = (/** @type {string[]} */ args) => execFileSync(win ? "npx.cmd" : "npx", ["--yes", ...args], { stdio: "inherit", shell: win });

// bin/nb.mjs awaits at its top level, which a CommonJS bundle can't: the same code, inside an async function.
const entry = path.resolve("bin", ".single-file-entry.mjs");
const body = fs.readFileSync("bin/nb.mjs", "utf8").replace(/^#!.*\n/, "");
fs.writeFileSync(entry, `globalThis.__NB_SINGLE_FILE__ = true;\nglobalThis.__NB_VERSION__ = ${JSON.stringify(version)};\n(async () => {\n${body}\n})();\n`);
const bundle = path.join(out, "nb.cjs");
try {
  npx([ESBUILD, entry, "--bundle", "--platform=node", "--format=cjs", "--target=node22", `--outfile=${bundle}`, "--log-level=warning"]);
} finally {
  fs.rmSync(entry, { force: true });
}

/** It runs, says its version and lists its commands. @param {string} file @param {string[]} pre */
function check(file, pre = []) {
  const said = execFileSync(file, [...pre, "--version"], { encoding: "utf8", env }).trim();
  if (!said.includes(version)) throw new Error(`${path.basename(file)} --version said "${said}", expected ${version}`);
  const help = execFileSync(file, [...pre, "help"], { encoding: "utf8", env });
  if (!help.includes("learn")) throw new Error(`${path.basename(file)} help didn't list the commands`);
}

if (process.argv.includes("--bundle")) {
  // The bundle alone thinks it's the single file, so it starts itself as `node nb.cjs` here, not as `nb`.
  check(process.execPath, [bundle]);
  console.log(`${bundle}: nb ${version}, ${(fs.statSync(bundle).size / 1024).toFixed(0)} KB`);
} else {
  const config = path.join(out, "sea-config.json");
  fs.writeFileSync(config, JSON.stringify({ main: bundle, output: path.join(out, "nb.blob"), disableExperimentalSEAWarning: true, useCodeCache: false, useSnapshot: false }));
  execFileSync(process.execPath, ["--experimental-sea-config", config], { stdio: "inherit" });
  const exe = path.join(out, win ? "nb.exe" : "nb");
  fs.copyFileSync(process.execPath, exe);
  fs.chmodSync(exe, 0o755);
  if (process.platform === "darwin") execFileSync("codesign", ["--remove-signature", exe]);
  npx([POSTJECT, exe, "NODE_SEA_BLOB", path.join(out, "nb.blob"), "--sentinel-fuse", FUSE, ...(process.platform === "darwin" ? ["--macho-segment-name", "NODE_SEA"] : [])]);
  // macOS runs only signed programs: an ad-hoc signature (a Developer ID one needs the user's Apple account).
  if (process.platform === "darwin") execFileSync("codesign", ["--sign", "-", exe]);
  check(exe);
  console.log(`${exe}: nb ${version}, ${(fs.statSync(exe).size / 1048576).toFixed(0)} MB`);
}
