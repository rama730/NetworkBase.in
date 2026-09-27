import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync("src/app/globals.css", "utf8");

function luminance(hex: string): number {
  const channels = hex.slice(1).match(/../g)!.map((part) => {
    const value = Number.parseInt(part, 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
}

function expectReadable(foreground: string, background: string, label: string) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  const ratio = (values[0]! + 0.05) / (values[1]! + 0.05);
  assert.ok(ratio >= 4.5, `${label}: ${ratio.toFixed(2)}:1 is below normal-text contrast`);
}

test("all saved accent choices keep action labels readable in both themes", () => {
  const palettes = [...css.matchAll(/:root\[data-accent="([^"]+)"\]\s*\{([^}]+)\}/g)];
  assert.equal(palettes.length, 6);
  for (const [, name, declarations] of palettes) {
    const light = declarations!.match(/--theme-action-solid-light:\s*(#[\da-f]{6})/i)![1]!;
    const dark = declarations!.match(/--theme-action-solid-dark:\s*(#[\da-f]{6})/i)![1]!;
    expectReadable("#FFFFFF", light, `${name} light action`);
    expectReadable("#141A1E", dark, `${name} dark action`);
  }
});

test("small neutral text and semantic status labels meet normal-text contrast", () => {
  const root = css.match(/:root\s*\{([^}]+)\}/)![1]!;
  const dark = css.match(/\.dark\s*\{([^}]+)\}/)![1]!;
  for (const [name, declarations] of [["light", root], ["dark", dark]]) {
    const color = (token: string) => declarations!.match(new RegExp(`--${token}:\\s*(#[\\da-f]{6})`, "i"))![1]!;
    expectReadable(color("muted-foreground"), color("background"), `${name} metadata`);
    expectReadable(color("muted-foreground"), color("card"), `${name} card metadata`);
    for (const status of ["success", "warning", "danger", "info"]) {
      expectReadable(color(`status-${status}`), color(`status-${status}-soft`), `${name} ${status}`);
    }
  }
});
