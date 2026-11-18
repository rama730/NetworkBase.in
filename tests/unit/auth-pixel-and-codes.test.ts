import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PIXEL_ICONS } from "@/lib/pixel-icons";
import { formatCountdown, formatGroupedCode } from "@/lib/auth/code-format";
import { AUTH_OUTCOME_WORDS, AUTH_PANELS } from "@/components/auth/auth-panels";
import { glyph5, wordWidth } from "@/lib/grid-trail";

describe("pixel icons", () => {
    it("are 6x6 bitmaps of # and .", () => {
        for (const [name, map] of Object.entries(PIXEL_ICONS)) {
            assert.equal(map.length, 6, `${name} has 6 rows`);
            for (const row of map) assert.match(row, /^[#.]{6}$/, `${name} row "${row}"`);
            assert.ok(map.some((row) => row.includes("#")), `${name} draws something`);
        }
    });
});

describe("codes", () => {
    it("groups terminal codes as XXXX-XXXX whatever was typed or pasted", () => {
        assert.equal(formatGroupedCode("abcd efgh"), "ABCD-EFGH");
        assert.equal(formatGroupedCode("ABCD-EFGH"), "ABCD-EFGH");
        assert.equal(formatGroupedCode("ab"), "AB");
        assert.equal(formatGroupedCode("abcde"), "ABCD-E");
        assert.equal(formatGroupedCode("abcdefghijk"), "ABCD-EFGH");
    });

    it("counts down as m:ss", () => {
        assert.equal(formatCountdown(60), "1:00");
        assert.equal(formatCountdown(5), "0:05");
        assert.equal(formatCountdown(0), "0:00");
    });
});

describe("auth panels", () => {
    it("draw every pixel word with the 4x5 font and fit the panel", () => {
        const words = [...Object.values(AUTH_PANELS).map((panel) => panel.word), ...AUTH_OUTCOME_WORDS];
        for (const word of words) {
            for (const ch of word) assert.ok(glyph5(ch).some((row) => row.includes("#")), `${word}: ${ch} has a glyph`);
            assert.ok(wordWidth(word) <= 24, `${word} fits`);
        }
    });
});
