import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { TRAIL, isLightHex, pixelScale, ringCells, wordWidth } from "@/lib/grid-trail";
import { parseReleaseNotes } from "@/lib/site/release-notes";

describe("grid trail", () => {
    it("measures 4x5 words with their full stop", () => {
        // H(4) E(4) Y(5), a gap after each, then the 2-column dot
        assert.equal(wordWidth("HEY"), 4 + 1 + 4 + 1 + 5 + 1 + 2);
        assert.equal(wordWidth("NETWORKBASE"), 60);
    });

    it("rings a button one empty cell away on every side, each cell once", () => {
        const ring = ringCells(10, 10, 9, 3);
        const keys = new Set(ring.map(([i, j]) => `${i},${j}`));
        assert.equal(keys.size, ring.length);
        assert.equal(ring.length, 2 * (9 + 4) + 2 * (3 + 4) - 4);
        for (const [i, j] of ring) {
            const onEdge = i === 8 || i === 10 + 9 + 1 || j === 8 || j === 10 + 3 + 1;
            assert.ok(onEdge, `cell ${i},${j} is on the ring`);
        }
        assert.deepEqual(ring[0], [8, 8]);
    });

    it("pops in, holds, shrinks out, then is gone", () => {
        assert.equal(pixelScale(100, 200, 50), 0);
        assert.ok(pixelScale(0, 200, TRAIL.popMs / 2) > 0 && pixelScale(0, 200, TRAIL.popMs / 2) < 1);
        assert.equal(pixelScale(0, 200, TRAIL.popMs + 100), 1);
        assert.ok(pixelScale(0, 200, TRAIL.popMs + 250) < 1);
        assert.equal(pixelScale(0, 200, TRAIL.popMs * 2 + 200), -1);
        assert.equal(pixelScale(0, Infinity, 1e9), 1);
    });

    it("picks a readable mark colour for each of the six colours", () => {
        assert.deepEqual(TRAIL.colors.map(isLightHex), [false, true, false, true, false, true]);
    });
});

describe("release notes", () => {
    const changelog = [
        "# Changelog",
        "",
        "## 2.6.3 (2026-11-18)",
        "",
        "### Added",
        "- `nb branch switch` works offline for a branch this folder already had (main or one it switched to before); it rebuilds the files.",
        "",
        "## 2.6.2 (2026-11-18)",
        "",
        "Fixes from the walkthrough.",
        "",
        "### Fixed",
        "- Switching branch (or following `git checkout -b`) in a folder that pulled only some files no longer downloads the rest; it took 103 s.",
        "",
        "## 2.6.1 (2026-11-18)",
        "### Added",
        "- `nb merge-request list --review-requested --all`: \"My reviews\", every open merge request waiting on your review across your workspaces and everything else that is far too long to show.",
    ].join("\n");

    it("keeps one short line per release, newest first", () => {
        const notes = parseReleaseNotes(changelog);
        assert.deepEqual(notes.map((n) => n.version), ["2.6.3", "2.6.2", "2.6.1"]);
        assert.equal(notes[0].text, "nb branch switch works offline for a branch this folder already had");
        assert.equal(notes[1].text, "Switching branch in a folder that pulled only some files no longer downloads the rest");
        assert.ok(notes[2].text.length <= 96 && notes[2].text.endsWith("…"));
    });

    it("stops at the limit", () => {
        assert.equal(parseReleaseNotes(changelog, 2).length, 2);
    });
});
