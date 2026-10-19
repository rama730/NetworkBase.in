import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const tabs = ["account", "security", "privacy", "notifications", "appearance", "integrations", "privacy-policies"];

/** Run the actual layout effects against loading/content geometry. No browser. */
function fixture(tab: string | null = null) {
  let active = tab || "account";
  let ref = 0;
  let scrollTop = 0;
  const sections = new Map<string, { top: number; height: number; getBoundingClientRect: () => { top: number; bottom: number; height: number }; scrollIntoView: () => void }>();
  const effects: Array<() => void | (() => void)> = [];
  const cleanups: Array<() => void> = [];
  const events = new Map<string, () => void>();
  const frames = new Map<number, () => void>();
  let frameId = 0;
  const root = {
    contains: (node: unknown) => Array.from(sections.values()).includes(node as never),
    getBoundingClientRect: () => ({ top: 0, height: 600 }),
    addEventListener: (event: string, fn: () => void) => events.set(event, fn),
    removeEventListener: (event: string) => events.delete(event),
  };
  const cjs = { exports: {} as { default: (props: { children: null }) => unknown } };
  const source = ts.transpileModule(readFileSync("src/components/settings/SettingsLayout.tsx", "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(source, {
    module: cjs, exports: cjs.exports,
    document: { getElementById: (id: string) => sections.get(id) || null },
    window: {
      location: { hash: "" },
      requestAnimationFrame: (fn: () => void) => { frames.set(++frameId, fn); return frameId; },
      cancelAnimationFrame: (id: number) => frames.delete(id),
      matchMedia: () => ({ matches: true }),
      addEventListener: () => {}, removeEventListener: () => {},
    },
    require: (name: string) => {
      if (name === "react") return {
        useState: (initial: string) => [initial, (value: string) => { active = value; }],
        useRef: (initial: unknown) => ({ current: ref++ === 0 ? root : initial }),
        useEffect: (fn: () => void | (() => void)) => effects.push(fn),
        useCallback: (fn: unknown) => fn,
      };
      if (name === "react/jsx-runtime") return { jsx: () => null, jsxs: () => null };
      if (name === "next/link") return { default: () => null };
      if (name === "next/navigation") return { useSearchParams: () => new URLSearchParams(tab ? { tab } : {}), useRouter: () => ({ replace: () => {} }) };
      if (name === "lucide-react") return {};
      if (name === "@/constants/routes") return { settingsTabHref: (value: string) => `/settings?tab=${value}` };
      if (name === "@/constants/settings") return { SETTINGS_SECTION_META: Object.fromEntries(tabs.map((value) => [value, { title: value, description: value }])) };
      throw new Error(`Unexpected dependency ${name}`);
    },
  });
  cjs.exports.default({ children: null });
  for (const effect of effects) { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); }
  return {
    get active() { return active; },
    get scrollTop() { return scrollTop; },
    flushFrame: () => { for (const [id, fn] of Array.from(frames)) { frames.delete(id); fn(); } },
    mountDocument: () => {
      for (const [index, value] of tabs.entries()) {
        const section = {
          top: index * 800 + 24, height: 700,
          getBoundingClientRect: () => ({ top: section.top - scrollTop, bottom: section.top + section.height - scrollTop, height: section.height }),
          scrollIntoView: () => { scrollTop = section.top - 24; },
        };
        sections.set(`settings-${value}`, section);
      }
    },
    scrollTo: (value: string) => { scrollTop = tabs.indexOf(value) * 800; events.get("scroll")?.(); },
    cleanup: () => cleanups.forEach((fn) => fn()),
  };
}

test("Settings keeps Account selected while the route fallback has no section targets", () => {
  const f = fixture();
  f.flushFrame();
  assert.equal(f.active, "account");
  f.mountDocument();
  assert.equal(f.active, "account");
  f.cleanup();
});

test("a direct Settings link selects and scrolls to its available section", () => {
  const f = fixture("integrations");
  f.mountDocument();
  f.flushFrame();
  assert.equal(f.active, "integrations");
  assert.equal(f.scrollTop, tabs.indexOf("integrations") * 800);
  f.cleanup();
});

test("manual scrolling still tracks real sections after loading completes", () => {
  const f = fixture();
  f.mountDocument();
  f.scrollTo("security");
  assert.equal(f.active, "security");
  f.scrollTo("privacy-policies");
  assert.equal(f.active, "privacy-policies");
  f.scrollTo("account");
  assert.equal(f.active, "account");
  f.cleanup();
});
