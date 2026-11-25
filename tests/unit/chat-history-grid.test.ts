import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import postcss from "postcss";
import { MessageHistory } from "@/components/messages/MessageHistory";
import { MessageBody } from "@/components/messages/MessageBody";
import { ConversationSkeleton, ThreadSkeleton } from "@/components/messages/ConversationSkeleton";
import { gridPhase, gridStrength, observeHistoryGrid } from "@/lib/messaging/history-grid";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("grid strength follows the actual lane width, including threshold boundaries and fractional widths", () => {
  for (const [width, strength] of [[320, .76], [400, .76], [480, .76], [480.25, .88], [600, .88], [680, .88], [680.25, 1], [1280, 1]]) {
    assert.equal(gridStrength(width!), strength, `${width}px history`);
  }
});

test("grid phase aligns different header heights and pane offsets, including fractional positions", () => {
  assert.equal(gridPhase(100, 100), "0px");
  assert.equal(gridPhase(100, 164), "8px");
  assert.equal(gridPhase(100, 196), "0px");
  assert.equal(gridPhase(10.5, 50.75), "7.75px");
  for (const [origin, edge] of [[101, 165], [101, 197], [10.5, 50.75], [-50, 44]]) {
    const phase = parseFloat(gridPhase(origin!, edge!));
    assert.ok(phase >= 0 && phase < 24);
    assert.equal((edge! + phase - origin!) % 24, 0);
  }
});

test("layout observations batch updates, align shell borders and clean up queued work", () => {
  const saved = new Map(["window", "ResizeObserver"].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const frames = new Map<number, FrameRequestCallback>();
  const listeners = new Map<string, () => void>();
  const observed: unknown[] = [];
  let resize: () => void = () => undefined;
  let disconnected = false;
  let next = 0;
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    requestAnimationFrame: (callback: FrameRequestCallback) => { frames.set(++next, callback); return next; },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    addEventListener: (event: string, callback: () => void) => listeners.set(event, callback),
    removeEventListener: (event: string) => listeners.delete(event),
  } });
  Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: class {
    constructor(callback: () => void) { resize = callback; }
    observe(node: unknown) { observed.push(node); }
    disconnect() { disconnected = true; }
  } });
  try {
    const styles = new Map<string, string>();
    const origin = { clientLeft: 1, clientTop: 1, getBoundingClientRect: () => ({ left: 100, top: 50 }) };
    let top = 147;
    let width = 800;
    const history = {
      closest: () => origin,
      getBoundingClientRect: () => ({ left: 457, top, width }),
      style: { setProperty: (key: string, value: string) => styles.set(key, value) },
    } as unknown as HTMLElement;
    const cleanup = observeHistoryGrid(history);
    assert.equal(styles.get("--message-grid-x"), "4px");
    assert.equal(styles.get("--message-grid-y"), "0px");
    assert.equal(styles.get("--message-grid-width"), "1");
    assert.deepEqual(observed, [origin, history]);
    assert.deepEqual([...listeners.keys()], ["resize"], "no per-scroll or message listeners");
    top = 155;
    width = 400;
    resize(); resize(); listeners.get("resize")!();
    assert.equal(frames.size, 1, "one geometry read per layout frame");
    const [id, callback] = [...frames.entries()][0]!;
    frames.delete(id); callback(0);
    assert.equal(styles.get("--message-grid-y"), "16px");
    assert.equal(styles.get("--message-grid-width"), "0.76", "narrow desktop lane gets the same quiet treatment as a floating window");
    width = 600;
    resize();
    const [mediumId, mediumCallback] = [...frames.entries()][0]!;
    frames.delete(mediumId); mediumCallback(0);
    assert.equal(styles.get("--message-grid-width"), "0.88");
    resize();
    cleanup();
    assert.ok(disconnected);
    assert.equal(listeners.size, 0);
    assert.equal(frames.size, 0);
    Object.defineProperty(globalThis, "ResizeObserver", { configurable: true, value: undefined });
    observeHistoryGrid(history)(); // Plain fallback still works without ResizeObserver.
  } finally {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else Reflect.deleteProperty(globalThis, key);
    }
  }
});

test("history keeps the existing log and children, without another scroller or focus stop", () => {
  const html = renderToStaticMarkup(createElement(MessageHistory, {
    variant: "thread", role: "log", "aria-live": "off", "aria-label": "Thread replies",
    className: "custom-history",
  }, createElement("button", null, "Reply")));
  assert.match(html, /role="log"/);
  assert.match(html, /aria-live="off"/);
  assert.match(html, /aria-label="Thread replies"/);
  assert.match(html, /data-message-history="thread"/);
  assert.match(html, /custom-history/);
  assert.equal((html.match(/<div/g) ?? []).length, 1);
  assert.doesNotMatch(html, /tabindex|overflow|img|aria-hidden/);
  assert.match(html, /<button>Reply<\/button>/);
  const loading = renderToStaticMarkup(createElement(ConversationSkeleton));
  assert.equal((loading.match(/data-message-history=/g) ?? []).length, 1);
  assert.match(loading, /role="status"/);
  assert.match(loading, /Loading messages/);
  assert.ok(loading.indexOf("nb-message-composer") > loading.indexOf("data-message-history"));
});

test("production CSS uses the approved original asset and preserves accessibility fallbacks", () => {
  const css = postcss.parse(read("src/app/globals.css"));
  const declarations = (selector: string) => {
    const values: Record<string, string> = {};
    css.walkRules(selector, rule => { rule.walkDecls(decl => { values[decl.prop] = decl.value; }); });
    return values;
  };
  const grid = declarations(".nb-message-history::before");
  assert.equal(grid["mask-size"], "24px 24px");
  assert.equal(grid["-webkit-mask-size"], "24px 24px");
  assert.equal(grid["pointer-events"], "none");
  assert.equal(grid["z-index"], "-1");
  assert.match(grid["mask-image"]!, /message-grid.svg/);
  assert.equal(declarations(".nb-message-history")["isolation"], "isolate");
  assert.equal(declarations(".nb-message-history")["--message-grid-opacity"], ".10");
  assert.equal(declarations(".dark .nb-message-history")["--message-grid-opacity"], ".065");
  assert.equal(declarations('.nb-message-history[data-message-history="thread"]')["--message-grid-thread"], ".72");
  assert.equal(declarations(".nb-message-history")["--message-grid-width"], "1");
  assert.match(grid.opacity!, /var\(--message-grid-width\)/);
  assert.doesNotMatch(read("src/app/globals.css"), /message-grid-compact/);
  const fallbacks: string[] = [];
  css.walkAtRules(rule => {
    if (rule.name === "media" || rule.name === "supports") {
      rule.walkRules(".nb-message-history::before", gridRule => {
        gridRule.walkDecls("display", decl => { if (decl.value === "none") fallbacks.push(rule.params); });
      });
    }
  });
  assert.ok(fallbacks.some(value => value.includes("forced-colors")));
  assert.ok(fallbacks.includes("print"));
  assert.ok(fallbacks.some(value => value.startsWith("not ((mask-image")));
  assert.equal(read("public/patterns/message-grid.svg").trim(), '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24"><path d="M24 0H0V24" fill="none" stroke="white" stroke-width=".7"/></svg>');
  const historyCss = read("src/app/globals.css").split("/* Original drafting grid:")[1]!.split(".nb-chat-swipe {")[0]!;
  assert.doesNotMatch(historyCss, /animation|transition|overflow|background-attachment|primary|96px|sketch/);
});

test("first-open thread loading has one quiet thread canvas and a solid composer, without another header", () => {
  const html = renderToStaticMarkup(createElement(ThreadSkeleton));
  assert.equal((html.match(/data-message-history=/g) ?? []).length, 1);
  assert.match(html, /data-message-history="thread"/);
  assert.match(html, /role="status"/);
  assert.match(html, /Loading replies/);
  assert.doesNotMatch(html, /<header|role="tablist"|Loading messages/);
  assert.match(html, /nb-message-composer[^\"]*bg-card/);
  assert.match(read("src/components/messages/ChatDrawer.tsx"), /const ThreadPane = dynamic\([^\n]+loading: \(\) => <ThreadSkeleton \/>/);
});

test("dense message content keeps full paragraphs, mentions, lists and code readable on the shared history", () => {
  const userId = "11111111-1111-4111-8111-111111111111";
  const channelId = "22222222-2222-4222-8222-222222222222";
  const filename = "Project_Atlas_Review_Keyboard_Accessibility_And_Workspace_Handoff_2026.pdf";
  const longParagraph = "Review the file version, preserve the draft, and return to the conversation with its task context. ".repeat(12);
  const bodies = [
    `${longParagraph}\n\nPlease check <@${userId}> in <#${channelId}>.`,
    `Use \`review_state = ready\` and keep the full filename: \`${filename}\`.\n\n- Compare the file versions\n- Keep the thread context\n- Preserve the unsent draft`,
    "```text\nfirst review note\nsecond review note\n```\n\nFinal note stays visible.",
  ];
  for (const variant of ["conversation", "thread"] as const) {
    const html = renderToStaticMarkup(createElement(MessageHistory, { variant }, bodies.map((body, key) => createElement(MessageBody, {
      key, body, nameOf: id => id === userId ? "Maya Rao" : undefined,
      channelNameOf: id => id === channelId ? "design-review" : undefined, meId: null,
    }))));
    assert.equal((html.match(/data-message-history=/g) ?? []).length, 1);
    assert.match(html, /Maya Rao/);
    assert.match(html, /#design-review/);
    assert.match(html, /bg-accent/);
    assert.match(html, /<code[^>]*bg-muted/);
    assert.match(html, /<ul[^>]*list-disc/);
    assert.match(html, /<pre/);
    assert.match(html, /\[overflow-wrap:anywhere\]/);
    assert.ok(html.includes(filename));
    assert.ok(html.includes(longParagraph.trim()));
    assert.match(html, /Final note stays visible/);
    assert.doesNotMatch(html, /line-clamp|text-ellipsis|truncate/);
  }
});

test("fractional layout coordinates keep the original phase at representative zoom-scale measurements", () => {
  // Geometry checks only: these do not emulate browser painting or physical display sharpness.
  for (const scale of [1, 1.25, 1.5, 2]) {
    const origin = 101 / scale;
    const edge = 457 / scale;
    const phase = parseFloat(gridPhase(origin, edge));
    const remainder = (edge + phase - origin) % 24;
    assert.ok(Math.abs(remainder) < 1e-9 || Math.abs(remainder - 24) < 1e-9);
    assert.equal(gridStrength(600 / scale), scale === 1 ? .88 : .76);
  }
});

test("body and metadata retain AA contrast over the strongest grid stroke and hovered rows", () => {
  const css = postcss.parse(read("src/app/globals.css"));
  const colors: Record<string, Record<string, string>> = { light: {}, dark: {} };
  css.walkRules(rule => {
    if (rule.selector !== ":root" && rule.selector !== ".dark") return;
    const theme = colors[rule.selector === ":root" ? "light" : "dark"]!;
    rule.walkDecls(decl => { if (/^#[0-9a-f]{6}$/i.test(decl.value)) theme[decl.prop] = decl.value; });
  });
  const rgb = (hex: string) => [1, 3, 5].map(start => parseInt(hex.slice(start, start + 2), 16) / 255);
  const mix = (a: number[], b: number[], alpha: number) => a.map((channel, i) => channel * alpha + b[i]! * (1 - alpha));
  const luminance = (color: number[]) => color.map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((sum, channel, i) => sum + channel * [.2126, .7152, .0722][i]!, 0);
  const contrast = (a: number[], b: number[]) => {
    const first = luminance(a), second = luminance(b);
    return (Math.max(first, second) + .05) / (Math.min(first, second) + .05);
  };
  for (const [mode, theme] of Object.entries(colors)) {
    const muted = rgb(theme["--muted"]!);
    const metadata = rgb(theme["--muted-foreground"]!);
    const canvas = mix(rgb(theme[mode === "dark" ? "--card" : "--background"]!), muted, .72);
    for (const width of [320, 480, 600, 680, 800]) {
      for (const thread of [1, .72]) {
        const stroke = mix(metadata, canvas, (mode === "dark" ? .065 : .10) * gridStrength(width) * thread);
        for (const background of [canvas, stroke, mix(muted, stroke, .55)]) {
          for (const foreground of [rgb(theme["--foreground"]!), metadata]) {
            assert.ok(contrast(foreground, background) >= 4.5, `${mode} ${width}px thread=${thread} body/metadata must meet AA over the canvas, stroke and hover`);
          }
        }
      }
    }
  }
});

test("both virtualized histories keep their scroll, drop, draft and live-region contracts", () => {
  for (const file of ["Timeline", "ThreadPane"]) {
    const source = read(`src/components/messages/${file}.tsx`);
    assert.equal((source.match(/<MessageHistory\b/g) ?? []).length, 1);
    assert.match(source, /className="app-scroll app-scroll-y h-full"/);
    assert.match(source, /computeItemKey=/);
    assert.match(source, /aria-live="off"/);
    assert.match(source, /className="nbm-newline" role="separator"/);
  }
  const row = read("src/components/messages/MessageRow.tsx");
  assert.match(row, /highlighted \? "bg-accent" : mentioned \? "bg-muted" : "nb-message-row-soft"/);
  assert.match(read("src/components/messages/Composer.tsx"), /nb-message-composer relative border-t border-border bg-card/);
  assert.doesNotMatch(read("src/components/messages/MessageHistory.tsx"), /localStorage|fetch\(|setInterval|overflow|tabIndex/);
  assert.doesNotMatch(read("src/lib/messaging/history-grid.ts"), /localStorage|wallpaper|preference|fetch\(/);
});
