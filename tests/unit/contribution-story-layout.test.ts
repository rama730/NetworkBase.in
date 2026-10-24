import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import postcss from "postcss";
import tailwind from "@tailwindcss/postcss";

test("compiled contribution utilities keep links before the date, show field errors and keep footer offsets safe", async () => {
  const result = await postcss([tailwind()]).process(
    readFileSync("src/app/globals.css", "utf8"),
    { from: "src/app/globals.css" },
  );
  assert.equal(result.warnings().length, 0);
  const declarations = (token: string) => {
    const selector = "." + token.replace(/[^a-zA-Z0-9_-]/g, "\\$&");
    const values: Record<string, string> = {};
    result.root.walkRules(selector, (rule) => {
      rule.walkDecls((decl) => {
        values[decl.prop] = decl.value;
      });
    });
    return values;
  };
  assert.equal(declarations("grid").display, "grid");
  assert.equal(
    declarations("grid-cols-[minmax(0,1fr)_auto]")["grid-template-columns"],
    "minmax(0,1fr) auto",
  );
  assert.equal(declarations("items-center")["align-items"], "center");
  assert.equal(declarations("flex-nowrap")["flex-wrap"], "nowrap");
  assert.equal(declarations("whitespace-nowrap")["white-space"], "nowrap");
  assert.equal(declarations("text-right")["text-align"], "right");
  assert.equal(declarations("justify-end")["justify-content"], "flex-end");
  assert.equal(declarations("truncate").overflow, "hidden");
  assert.equal(declarations("truncate")["text-overflow"], "ellipsis");
  assert.equal(declarations("overflow-clip").overflow, "clip");
  const footer = declarations("nb-story-footer");
  assert.equal(footer.position, undefined);
  assert.equal(footer.bottom, undefined);
  assert.equal(footer.margin, undefined);
  // This is an authored selector rather than a utility class.
  let invalidBorder = "";
  result.root.walkRules('.nb-story-input[aria-invalid="true"]', (rule) => {
    rule.walkDecls("border-color", (declaration) => {
      invalidBorder = declaration.value;
    });
  });
  assert.equal(invalidBorder, "var(--destructive)");
  let fade = "",
    fadeInset = "",
    reducedMotion = false;
  result.root.walkRules(
    ".nb-story-preview-block[data-clipped]::after",
    (rule) => {
      rule.walkDecls("background", (decl) => {
        fade = decl.value;
      });
      rule.walkDecls("inset", (decl) => {
        fadeInset = decl.value;
      });
    },
  );
  assert.match(fade, /linear-gradient\(transparent,\s*var\(--card\)\)/);
  assert.equal(fadeInset, "auto 0 0");
  result.root.walkAtRules("media", (rule) => {
    if (rule.params.includes("prefers-reduced-motion")) {
      rule.walkRules(".nb-story-reveal.is-expanded", (nested) => {
        nested.walkDecls("animation", (decl) => {
          if (decl.value === "none") reducedMotion = true;
        });
      });
    }
  });
  assert.ok(reducedMotion, "Expanded content respects reduced motion");
  assert.equal(declarations("nb-story-reveal")["max-height"], undefined);
  assert.equal(declarations("nb-story-reveal")["transition"], undefined);
  result.root.walkRules((rule) => {
    assert.doesNotMatch(
      rule.selector,
      /\.nb-story-(?:heading|identity|date|project-context|headline-role)(?:\s|$)/,
      "Custom rules must not override the header's utility layout at narrow widths",
    );
  });
});
