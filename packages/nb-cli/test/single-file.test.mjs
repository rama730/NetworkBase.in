import { it } from "node:test";
import assert from "node:assert/strict";
import { homebrewFormula, scoopManifest } from "../scripts/packages.mjs";
import { self } from "../lib/self.mjs";

// Report C7 (M4d): installers point at the release's files with their checksums; nb starts itself the right way.
const sums = { "nb-macos-arm64": "a".repeat(64), "nb-linux-x64": "b".repeat(64), "nb-windows-x64.exe": "c".repeat(64) };

it("the Homebrew formula downloads the release's file for the platform and checks its sha256", () => {
  const rb = homebrewFormula("2.1.6", "owner/homebrew-networkbase", sums);
  assert.match(rb, /url "https:\/\/github\.com\/owner\/homebrew-networkbase\/releases\/download\/v2\.1\.6\/nb-macos-arm64"\n\s+sha256 "a{64}"/);
  assert.match(rb, /nb-linux-x64"\n\s+sha256 "b{64}"/);
  assert.match(rb, /shell_output\("#\{bin\}\/nb --version"\)/);
  assert.throws(() => homebrewFormula("2.1.6", "o/r", { "nb-linux-x64": "x" }), /No checksum for nb-macos-arm64/);
});

it("the Scoop manifest installs nb.exe with its hash", () => {
  const m = JSON.parse(scoopManifest("2.1.6", "owner/homebrew-networkbase", sums));
  assert.equal(m.version, "2.1.6");
  assert.equal(m.architecture["64bit"].hash, "c".repeat(64));
  assert.match(m.architecture["64bit"].url, /\/v2\.1\.6\/nb-windows-x64\.exe#\/nb\.exe$/);
  assert.equal(m.bin, "nb.exe");
});

it("from npm, nb starts itself as node with its script", () => {
  const [cmd, args] = self(["status"]);
  assert.equal(cmd, process.execPath);
  assert.deepEqual(args, [process.argv[1], "status"]);
});
