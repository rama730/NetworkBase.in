import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { blankContributionStory } from "@/lib/profile/contribution-story";
import {
  contributionPreviewLayout,
  contributionPreviewText,
  restoreContributionPreviewPosition,
} from "@/lib/profile/contribution-preview";

test("preview measures wrapped content, keeps a separate image glimpse, and leaves short stories complete", () => {
  const short = contributionPreviewLayout({
    summaryHeight: 48,
    lineHeight: 24,
    detailsHeight: 32,
    hasMedia: false,
  });
  assert.equal(short.summaryClipped, false);
  assert.equal(short.detailsClipped, false);
  const long = contributionPreviewLayout({
    summaryHeight: 480,
    lineHeight: 24,
    detailsHeight: 300,
    hasMedia: true,
  });
  assert.equal(long.summaryLimit, 72);
  assert.equal(long.summaryClipped, true);
  assert.equal(long.detailsLimit, 88);
  assert.equal(long.detailsClipped, true);
  const skills = contributionPreviewLayout({
    summaryHeight: 0,
    lineHeight: 24,
    detailsHeight: 64,
    hasMedia: false,
  });
  assert.equal(skills.detailsLimit, 192);
  assert.equal(skills.detailsClipped, false);
  assert.equal(
    contributionPreviewLayout({
      summaryHeight: 0,
      lineHeight: 24,
      detailsHeight: 240,
      hasMedia: false,
    }).detailsClipped,
    true,
  );
});

test("assistive preview includes only fully readable rendered text, including formatted text nodes", () => {
  const original = globalThis.NodeFilter;
  (globalThis as any).NodeFilter = { SHOW_TEXT: 4 };
  try {
    const nodes = [
      { textContent: "I built ", start: 0 },
      {
        textContent:
          "a reliable workspace with teammates and more hidden details",
        start: 8,
      },
    ];
    let node: any,
      end = 0,
      index = 0;
    const element = {
      getBoundingClientRect: () => ({ top: 100 }),
      ownerDocument: {
        createTreeWalker: () => ({ nextNode: () => nodes[index++] ?? null }),
        createRange: () => ({
          selectNodeContents: (next: any) => {
            node = next;
            end = next.textContent.length;
          },
          setStart: (next: any) => {
            node = next;
          },
          setEnd: (_: any, offset: number) => {
            end = offset;
          },
          getBoundingClientRect: () => ({
            bottom: 100 + Math.ceil((node.start + end) / 20) * 24,
          }),
        }),
      },
    } as unknown as HTMLElement;
    const text = contributionPreviewText(element, 48);
    assert.equal(text, "I built a reliable workspace with");
    assert.doesNotMatch(text, /hidden details/);
    assert.equal(contributionPreviewText(null, 48), "");
    assert.equal(contributionPreviewText(element, 0), "");
  } finally {
    (globalThis as any).NodeFilter = original;
  }
});

test("collapse restores the contribution in its route scroller, respects reduced motion, and preserves focus without ancestor scrolling", () => {
  const original = globalThis.window;
  const scrolls: unknown[] = [],
    focuses: unknown[] = [];
  let top = -300,
    reduced = false;
  (globalThis as any).window = { matchMedia: () => ({ matches: reduced }) };
  const root = {
    scrollTop: 1000,
    getBoundingClientRect: () => ({ top: 80, bottom: 700 }),
    scrollTo: (options: unknown) => scrolls.push(options),
  };
  const anchor = {
    closest: () => root,
    getBoundingClientRect: () => ({ top }),
    focus: (options: unknown) => focuses.push(options),
  } as unknown as HTMLElement;
  const button = {
    focus: (options: unknown) => focuses.push(options),
  } as unknown as HTMLButtonElement;
  try {
    restoreContributionPreviewPosition(anchor, button);
    assert.deepEqual(scrolls[0], { top: 604, behavior: "smooth" });
    reduced = true;
    restoreContributionPreviewPosition(anchor, button);
    assert.deepEqual(scrolls[1], { top: 604, behavior: "auto" });
    top = 100;
    restoreContributionPreviewPosition(anchor, button);
    restoreContributionPreviewPosition(anchor, null);
    assert.equal(scrolls.length, 2);
    assert.deepEqual(focuses, Array(4).fill({ preventScroll: true }));
  } finally {
    (globalThis as any).window = original;
  }
});

function nodes(element: any): any[] {
  if (!element) return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (typeof element !== "object") return [];
  return [element, ...nodes(element.props?.children)];
}
function text(element: any): string {
  if (Array.isArray(element)) return element.map(text).join("");
  if (typeof element === "string") return element;
  return element?.props?.children ? text(element.props.children) : "";
}

/** Runs the real React component and effects with supplied DOM measurements; no browser. */
async function view({
  summaryHeight = 48,
  detailsHeight = 0,
  media = false,
  skills = false,
  summary = "My responsibility was to build the workspace.",
  expandedByDefault = false,
} = {}) {
  const slots: any[] = [],
    effects: Array<() => void> = [],
    observers = new Set<() => void>();
  let index = 0,
    dirty = false,
    tree: any;
  const dimensions = { summaryHeight, detailsHeight, width: 640 };
  const key = "__contributionPreviewTest";
  (globalThis as any)[key] = {
    excerpt: "Readable preview",
    useState(initial: any) {
      const at = index++;
      if (!(at in slots))
        slots[at] = typeof initial === "function" ? initial() : initial;
      return [
        slots[at],
        (next: any) => {
          const value = typeof next === "function" ? next(slots[at]) : next;
          if (value !== slots[at]) {
            slots[at] = value;
            dirty = true;
          }
        },
      ];
    },
    useRef(initial: any) {
      const at = index++;
      if (!(at in slots)) slots[at] = { current: initial };
      return slots[at];
    },
    useEffect(fn: () => any, deps: any[]) {
      const at = index++,
        old = slots[at];
      if (!old || deps.some((d, n) => d !== old.deps[n]))
        effects.push(() => {
          old?.cleanup?.();
          slots[at] = { deps, cleanup: fn() };
        });
    },
  };
  const mocks: Record<string, string> = {
    react: `const h=()=>globalThis.${key};export const useState=i=>h().useState(i),useRef=i=>h().useRef(i),useEffect=(f,d)=>h().useEffect(f,d),useLayoutEffect=useEffect;export default {};`,
    "@/components/ui/dialog":
      "export function Dialog(){};export function DialogContent(){};export function DialogTitle(){};",
    "@/components/ui/button": "export function Button(){};",
    "@/components/skills/SkillChip": "export function SkillChip(){};",
    "@/lib/profile/contribution-preview": `export {contributionPreviewLayout,restoreContributionPreviewPosition} from '${process.cwd()}/src/lib/profile/contribution-preview.ts';export const contributionPreviewText=()=>globalThis.${key}.excerpt;`,
  };
  const result = await build({
    entryPoints: ["src/components/profile/ContributionStoryView.tsx"],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    packages: "external",
    plugins: [
      {
        name: "measured-preview",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) =>
            a.path in mocks
              ? { path: a.path, namespace: "fixture" }
              : undefined,
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
            contents: mocks[a.path],
            loader: "js",
            resolveDir: process.cwd(),
          }));
        },
      },
    ],
  });
  const compiled = {
    exports: {} as { ContributionStoryView: (props: any) => any },
  };
  new Function("require", "module", "exports", result.outputFiles![0]!.text)(
    createRequire(import.meta.url),
    compiled,
    compiled.exports,
  );
  const original = {
    window: globalThis.window,
    document: globalThis.document,
    ResizeObserver: globalThis.ResizeObserver,
    getComputedStyle: globalThis.getComputedStyle,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  (globalThis as any).window = {
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: true }),
  };
  (globalThis as any).document = {};
  (globalThis as any).getComputedStyle = () => ({ lineHeight: "24px" });
  (globalThis as any).ResizeObserver = class {
    constructor(private callback: () => void) {
      observers.add(callback);
    }
    observe() {}
    disconnect() {
      observers.delete(this.callback);
    }
  };
  (globalThis as any).requestAnimationFrame = (fn: () => void) => {
    fn();
    return 0;
  };
  const story = {
    ...blankContributionStory("Work"),
    summary,
    skills: skills ? ["React"] : [],
    images: media
      ? [
          {
            id: "image",
            assetId: "asset",
            caption: "Work example",
            alt: "Visible image description",
            positionId: null,
            projectFileId: null,
            permission: true,
          },
        ]
      : [],
  };
  const props = {
    contribution: { id: "work", projectTitle: "Work", presentation: story },
    expandedByDefault,
    refs: [] as any[],
    story: undefined as typeof story | undefined,
  };
  const dom = (height: () => number) => ({
    get scrollHeight() {
      return height();
    },
    querySelector: () => null,
  });
  async function render() {
    for (let tries = 0; tries < 12; tries++) {
      index = 0;
      dirty = false;
      tree = compiled.exports.ContributionStoryView(props);
      tree.props.ref.current = {
        getBoundingClientRect: () => ({ width: dimensions.width, top: 100 }),
        closest: () => null,
        focus() {},
        addEventListener() {},
        removeEventListener() {},
      };
      const blocks = nodes(tree).filter((n) =>
        n.props?.className?.includes("nb-story-preview-block"),
      );
      for (const block of blocks) {
        const inner = block.props.children;
        inner.props.ref.current = dom(() =>
          nodes(inner).some((n) => n.type?.name === "ContributionMarkdown")
            ? dimensions.summaryHeight
            : dimensions.detailsHeight,
        );
      }
      const button = nodes(tree).find(
        (n) =>
          (n.type === "button" && text(n).includes("contribution")) ||
          (n.type === "button" && text(n).includes("Show less")),
      );
      if (button) button.props.ref.current = { focus() {} };
      for (const effect of effects.splice(0)) effect();
      await Promise.resolve();
      if (!dirty) return tree;
    }
    throw new Error("Preview measurements did not settle");
  }
  return {
    render,
    dimensions,
    props,
    setExcerpt(value: string) {
      (globalThis as any)[key].excerpt = value;
    },
    resize: () => {
      for (const measure of [...observers]) measure();
    },
    cleanup() {
      for (const slot of slots) slot?.cleanup?.();
      Object.assign(globalThis, original);
      delete (globalThis as any)[key];
    },
  };
}

test("long summary fades alongside media, expands all content, and collapses back through one accessible control", async () => {
  const h = await view({ summaryHeight: 240, detailsHeight: 300, media: true });
  try {
    let tree = await h.render();
    const blocks = () =>
      nodes(tree).filter((n) =>
        n.props?.className?.includes("nb-story-preview-block"),
      );
    const button = () =>
      nodes(tree).find((n) => n.type === "button" && n.props["aria-controls"]);
    assert.equal(blocks().length, 2);
    assert.ok(
      blocks().every(
        (n) =>
          n.props["data-clipped"] && n.props.inert && n.props["aria-hidden"],
      ),
    );
    assert.equal(blocks()[0].props.style.maxHeight, 72);
    assert.equal(blocks()[1].props.style.maxHeight, 88);
    assert.equal(button().props["aria-expanded"], false);
    assert.equal(
      nodes(tree).filter((n) => n.props?.className === "sr-only").length,
      2,
    );
    button().props.onClick();
    tree = await h.render();
    assert.equal(button().props["aria-expanded"], true);
    assert.ok(
      blocks().every(
        (n) =>
          !n.props.inert &&
          !n.props["aria-hidden"] &&
          n.props.style.maxHeight === undefined,
      ),
    );
    assert.ok(nodes(tree).some((n) => n.type === "figcaption"));
    button().props.onClick();
    tree = await h.render();
    assert.equal(button().props["aria-expanded"], false);
    assert.ok(blocks().every((n) => n.props["data-clipped"]));
  } finally {
    h.cleanup();
  }
});

test("actual overflow responds to wrapping changes; short summaries and skills do not offer an empty expansion", async () => {
  const h = await view({ skills: true, detailsHeight: 32 });
  try {
    let tree = await h.render();
    const button = () =>
      nodes(tree).find((n) => n.type === "button" && n.props["aria-controls"]);
    assert.equal(button(), undefined);
    assert.ok(
      nodes(tree)
        .filter((n) => n.props?.className?.includes("nb-story-preview-block"))
        .every((n) => !n.props.inert),
    );
    h.dimensions.summaryHeight = 144;
    h.resize();
    tree = await h.render();
    assert.equal(text(button()), "Read contribution");
    assert.equal(
      nodes(tree).filter((n) => n.props?.["data-clipped"]).length,
      1,
    );
    h.dimensions.summaryHeight = 48;
    h.resize();
    tree = await h.render();
    assert.equal(button(), undefined);
  } finally {
    h.cleanup();
  }
});

test("media-only, skills-only, and empty stories use their content rather than reserving summary space", async () => {
  for (const options of [
    { media: true, summary: "", summaryHeight: 0, detailsHeight: 220 },
    { skills: true, summary: "", summaryHeight: 0, detailsHeight: 32 },
    { summary: "", summaryHeight: 0, detailsHeight: 0 },
  ]) {
    const h = await view(options);
    try {
      const tree = await h.render();
      const blocks = nodes(tree).filter((n) =>
        n.props?.className?.includes("nb-story-preview-block"),
      );
      assert.equal(blocks.length, options.media || options.skills ? 1 : 0);
      assert.equal(
        Boolean(
          nodes(tree).find(
            (n) => n.type === "button" && n.props["aria-controls"],
          ),
        ),
        Boolean(options.media),
      );
      if (blocks.length) assert.doesNotMatch(blocks[0].props.className, /mt-3/);
    } finally {
      h.cleanup();
    }
  }
});

test("an expanded story retains Show less after a wider layout makes all its content fit", async () => {
  const h = await view({ summaryHeight: 144 });
  try {
    let tree = await h.render();
    const button = () =>
      nodes(tree).find((n) => n.type === "button" && n.props["aria-controls"]);
    button().props.onClick();
    tree = await h.render();
    h.dimensions.summaryHeight = 48;
    h.resize();
    tree = await h.render();
    assert.equal(text(button()), "Show less");
    button().props.onClick();
    tree = await h.render();
    assert.equal(button(), undefined);
    assert.ok(
      nodes(tree)
        .filter((n) => n.props?.className?.includes("nb-story-preview-block"))
        .every((n) => !n.props.inert),
    );
  } finally {
    h.cleanup();
  }
});

test("unmeasurable stories stay fully readable and acquire previews only when layout becomes available", async () => {
  const h = await view({ summaryHeight: 144 });
  h.dimensions.width = 0;
  try {
    let tree = await h.render();
    const blocks = () =>
      nodes(tree).filter((n) =>
        n.props?.className?.includes("nb-story-preview-block"),
      );
    assert.ok(
      blocks().every(
        (n) => n.props.style.maxHeight === undefined && !n.props.inert,
      ),
    );
    assert.ok(
      !nodes(tree).some((n) => n.type === "button" && n.props["aria-controls"]),
    );
    h.dimensions.width = 640;
    h.resize();
    tree = await h.render();
    assert.ok(blocks().some((n) => n.props["data-clipped"]));
    assert.ok(
      nodes(tree).some((n) => n.type === "button" && n.props["aria-controls"]),
    );
  } finally {
    h.cleanup();
  }
});

test("accessible excerpt refreshes when mention labels change without changing the block height", async () => {
  const h = await view({ summaryHeight: 144 });
  try {
    await h.render();
    h.setExcerpt("Updated teammate name");
    h.props.refs = [
      {
        kind: "person",
        id: "person",
        label: "Updated teammate name",
        available: true,
        href: "/u/person",
      },
    ];
    const tree = await h.render();
    assert.ok(
      nodes(tree).some(
        (n) =>
          n.props?.className === "sr-only" &&
          text(n) === "Updated teammate name…",
      ),
    );
  } finally {
    h.cleanup();
  }
});

test("changing effective preview images closes a stale image viewer even when the saved presentation is unchanged", async () => {
  const h = await view({ media: true, detailsHeight: 220 });
  try {
    let tree = await h.render();
    nodes(tree)
      .find((n) => n.type === "button" && n.props["aria-controls"])
      .props.onClick();
    tree = await h.render();
    nodes(tree)
      .find(
        (n) =>
          n.type === "button" &&
          n.props["aria-label"]?.startsWith("Open image"),
      )
      .props.onClick();
    tree = await h.render();
    assert.ok(
      nodes(tree).some((n) => n.type?.name === "Dialog" && n.props.open),
    );
    h.props.story = { ...h.props.contribution.presentation, images: [] };
    tree = await h.render();
    assert.ok(
      nodes(tree).some((n) => n.type?.name === "Dialog" && !n.props.open),
    );
  } finally {
    h.cleanup();
  }
});
