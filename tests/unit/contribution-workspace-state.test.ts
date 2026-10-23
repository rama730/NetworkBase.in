import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { build } from "esbuild";
import { randomUUID } from "node:crypto";
import { blankContributionStory } from "@/lib/profile/contribution-story";

type Element = {
  type?: string | { name?: string };
  props?: Record<string, any>;
};
function nodes(element: any): Element[] {
  if (!element) return [];
  if (Array.isArray(element)) return element.flatMap(nodes);
  if (typeof element !== "object") return [];
  return [element, ...nodes(element.props?.children)];
}
function text(element: any): string {
  if (Array.isArray(element)) return element.map(text).join("");
  if (typeof element === "string" || typeof element === "number")
    return String(element);
  return element?.props?.children ? text(element.props.children) : "";
}
async function workspace(
  options: { image?: boolean; footerContainer?: HTMLElement } = {},
) {
  const id = randomUUID(),
    position = randomUUID(),
    story = {
      ...blankContributionStory("Ponytail"),
      summary: "Published story.",
      start: "2026-03",
      current: true,
      visible: true,
      images: options.image
        ? [
            {
              id: randomUUID(),
              assetId: randomUUID(),
              caption: "",
              alt: "Published image description",
              positionId: null,
              projectFileId: null,
              permission: true,
            },
          ]
        : [],
      positions: [
        {
          id: position,
          recordedStageId: null,
          title: "Technical Lead",
          start: "2026-03",
          end: "",
          current: true,
          description: "Led the interface.",
          hidden: false,
        },
      ],
    };
  const record = {
    id,
    projectId: randomUUID(),
    version: 1,
    title: "Member",
    projectTitle: "Ponytail",
    projectHref: "/projects/pony",
    projectUrl: null,
    repoUrl: null,
    description: "Published story.",
    startDate: "2026-03-01",
    endDate: null,
    currentlyActive: true,
    skills: [],
    source: "membership",
    verified: true,
    visibility: "public",
    presentation: story,
    draftStory: story,
    roleStages: [],
    projectVisibility: "public",
  };
  const slots: any[] = [],
    effects: Array<() => void> = [],
    commands: any[] = [],
    journal = new Map(),
    navigations: string[] = [],
    focused: Array<{ id: string; options: unknown }> = [],
    scrolls: unknown[] = [];
  let index = 0,
    dirty = false,
    tree: Element;
  const state = {
    records: [record],
    commands,
    journal,
    navigations,
    useState(initial: any) {
      const slot = index++;
      if (!(slot in slots))
        slots[slot] = typeof initial === "function" ? initial() : initial;
      return [
        slots[slot],
        (update: any) => {
          slots[slot] =
            typeof update === "function" ? update(slots[slot]) : update;
          dirty = true;
        },
      ];
    },
    useRef(initial: any) {
      const slot = index++;
      if (!(slot in slots)) slots[slot] = { current: initial };
      return slots[slot];
    },
    useEffect(fn: () => any, deps: any[] = []) {
      const slot = index++,
        before = slots[slot];
      if (
        !before ||
        deps.length !== before.deps.length ||
        deps.some((v, i) => v !== before.deps[i])
      ) {
        effects.push(() => {
          before?.cleanup?.();
          slots[slot] = { deps, cleanup: fn() };
        });
      }
    },
  };
  const key = "__contributionWorkspaceTest";
  (globalThis as any)[key] = state;
  const mocks: Record<string, string> = {
    react: `const h=()=>globalThis.${key};export const useState=i=>h().useState(i),useRef=i=>h().useRef(i),useEffect=(f,d)=>h().useEffect(f,d),useCallback=f=>f;`,
    "next/navigation": `export const useSearchParams=()=>new URLSearchParams('contribution=${id}');export const useRouter=()=>({push:url=>globalThis.${key}.navigations.push(url)});`,
    "idb-keyval": `export const createStore=()=>null;export const get=async k=>globalThis.${key}.journal.get(k);export const set=async(k,v)=>globalThis.${key}.journal.set(k,v);export const del=async k=>globalThis.${key}.journal.delete(k);`,
    "@/app/actions/contribution-stories": `export const saveContributionStoryAction=async command=>{const h=globalThis.${key};h.commands.push(command);return {success:true,id:command.id,version:command.expectedVersion+1,document:command.document,featured:false,published:command.operation==='publish',removed:false};};export const createContributionStoryAction=async()=>({success:false,error:'not used'});export const searchContributionReferencesAction=async()=>[];export const createContributionImageUploadAction=async()=>({});export const finalizeContributionImageAction=async()=>({});export const importContributionProjectImageAction=async()=>({});export const listContributionLinkProjectsAction=async()=>[];`,
    "@/lib/profile/browser-profile": `export const loadProfileContributionWindow=async()=>({contributions:globalThis.${key}.records,total:1,hasMore:false});`,
    "@/components/ui/button": `export function Button(){return null;}`,
    "@/components/settings/ui/SettingsSwitch": `export function SettingsSwitch(){return null;}`,
    "@/components/ui/dialog": `export function Dialog(){return null;}export function DialogContent(){return null;}export function DialogTitle(){return null;}export function DialogDescription(){return null;}`,
    "@/components/skills/SkillPicker": `export function SkillPicker(){return null;}`,
    "@/components/profile/ContributionStoryView": `export function ContributionStoryView(){return null;}export function ContributionIdentityLinks(){return null;}`,
    "./ContributionSummaryEditor": `export function ContributionSummaryEditor(){return null;}`,
  };
  const result = await build({
    entryPoints: ["src/components/profile/edit/ContributionWorkspace.tsx"],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    packages: "external",
    plugins: [
      {
        name: "code-only-editor-harness",
        setup(b) {
          b.onResolve({ filter: /.*/ }, (a) =>
            a.path in mocks
              ? { path: a.path, namespace: "fixture" }
              : undefined,
          );
          b.onLoad({ filter: /.*/, namespace: "fixture" }, (a) => ({
            contents: mocks[a.path],
            loader: "js",
          }));
        },
      },
    ],
  });
  const compiledModule = {
    exports: {} as { ContributionWorkspace: (props: any) => Element },
  };
  new Function("require", "module", "exports", result.outputFiles![0]!.text)(
    createRequire(import.meta.url),
    compiledModule,
    compiledModule.exports,
  );
  const original = {
    window: (globalThis as any).window,
    document: (globalThis as any).document,
    BroadcastChannel: globalThis.BroadcastChannel,
    requestAnimationFrame: globalThis.requestAnimationFrame,
  };
  (globalThis as any).window = {
    location: {
      href: `http://localhost/my-profile/edit?section=experience&contribution=${id}`,
    },
    history: { state: null, replaceState() {} },
    addEventListener() {},
    removeEventListener() {},
    matchMedia: () => ({ matches: true }),
  };
  (globalThis as any).document = {
    getElementById: (id: string) => ({
      focus(options: unknown) {
        focused.push({ id, options });
      },
      getBoundingClientRect: () => ({ top: 320 }),
      closest: () => ({
        scrollTop: 60,
        getBoundingClientRect: () => ({ top: 80 }),
        scrollTo: (options: unknown) => scrolls.push(options),
      }),
      scrollIntoView() {
        throw new Error("Must not scroll shell ancestors");
      },
    }),
  };
  (globalThis as any).BroadcastChannel = class {
    postMessage() {}
    close() {}
  };
  (globalThis as any).requestAnimationFrame = (fn: () => void) => {
    fn();
    return 0;
  };
  const props = {
    items: [{ contribution: record }],
    profileId: randomUUID(),
    footerContainer: options.footerContainer,
  };
  async function render() {
    for (let attempts = 0; attempts < 25; attempts++) {
      index = 0;
      dirty = false;
      tree = compiledModule.exports.ContributionWorkspace(props);
      const pending = effects.splice(0);
      for (const effect of pending) effect();
      await Promise.resolve();
      await Promise.resolve();
      if (!dirty) break;
    }
    return tree!;
  }
  await render();
  const all = () => nodes(tree);
  const button = (label: string) => {
    const node = all().find(
      (n) =>
        n.props?.["aria-label"] === label ||
        (n.type &&
          typeof n.type === "object" &&
          n.type.name === "Button" &&
          text(n) === label) ||
        (typeof n.type === "function" &&
          (n.type as any).name === "Button" &&
          text(n) === label),
    );
    assert.ok(node, `Button missing: ${label}`);
    return node;
  };
  return {
    id,
    position,
    story,
    record,
    commands,
    all,
    journal,
    navigations,
    focused,
    scrolls,
    button,
    render,
    summary: () =>
      all().find((n) => (n.type as any)?.name === "ContributionSummaryEditor")!,
    close() {
      for (const slot of slots) slot?.cleanup?.();
      Object.assign(globalThis, original);
      delete (globalThis as any)[key];
    },
  };
}

test("code-only editor callbacks keep unknown end dates explicit and preserve private/public separation", async () => {
  const h = await workspace();
  try {
    h.button("Edit position Technical Lead").props!.onClick();
    await h.render();
    const current = h
      .all()
      .find(
        (n) =>
          n.type === "label" &&
          text(n).includes("I currently hold this position"),
      )!;
    const checkbox = nodes(current).find((n) => n.type === "input")!;
    checkbox.props!.onChange({ target: { checked: false } });
    await h.render();
    assert.ok(h.all().some((n) => n.type === "p" && text(n) === "Mar 2026"));
    assert.ok(!h.all().some((n) => text(n).includes("End date not added")));
    h.summary().props!.onChange("New private summary.");
    await h.render();
    await h.button("Save draft").props!.onClick();
    await h.render();
    assert.equal(h.commands.at(-1).operation, "draft");
    assert.equal(h.commands.at(-1).document.summary, "New private summary.");
    assert.equal(h.record.presentation.summary, "Published story.");
  } finally {
    h.close();
  }
});
test("code-only publication validation blocks invalid positions before any server command", async () => {
  const h = await workspace();
  try {
    h.button("Add position").props!.onClick();
    await h.render();
    await h.button("Publish updates").props!.onClick();
    await h.render();
    assert.equal(h.commands.length, 0);
    assert.ok(
      h
        .all()
        .some(
          (n) =>
            n.props?.role === "alert" &&
            text(n).includes("Name each visible position"),
        ),
    );
  } finally {
    h.close();
  }
});
test("project and position current checkboxes stay consistent in the editor and saved document", async () => {
  const h = await workspace();
  try {
    const check = (label: string) => {
      const parent = h
        .all()
        .find((n) => n.type === "label" && text(n).includes(label));
      assert.ok(parent, `Checkbox missing: ${label}`);
      return nodes(parent).find((n) => n.type === "input")!;
    };
    check("I currently contribute to this project").props!.onChange({
      target: { checked: false },
    });
    await h.render();
    h.button("Edit position Technical Lead").props!.onClick();
    await h.render();
    assert.equal(check("I currently hold this position").props!.checked, false);
    await h.button("Save draft").props!.onClick();
    await h.render();
    const saved = h.commands.at(-1).document;
    assert.equal(saved.current, false);
    assert.equal(saved.positions[0].current, false);
    assert.equal(saved.positions[0].end, "");
    check("I currently hold this position").props!.onChange({
      target: { checked: true },
    });
    await h.render();
    assert.equal(
      check("I currently contribute to this project").props!.checked,
      true,
    );
    await h.button("Save draft").props!.onClick();
    await h.render();
    assert.equal(h.commands.at(-1).document.current, true);
    assert.equal(h.commands.at(-1).document.positions[0].current, true);
    assert.equal(h.record.presentation.current, true);
  } finally {
    h.close();
  }
});

test("publish is offered only for unpublished edits, remains after Save draft and disappears after publication", async () => {
  const h = await workspace();
  try {
    const hasPublish = () => h.all().some((n) => text(n) === "Publish updates");
    assert.equal(hasPublish(), false);
    h.summary().props!.onChange("An unpublished update.");
    await h.render();
    assert.equal(hasPublish(), true);
    await h.button("Save draft").props!.onClick();
    await h.render();
    assert.equal(hasPublish(), true);
    await h.button("Publish updates").props!.onClick();
    await h.render();
    assert.equal(h.commands.at(-1).operation, "publish");
    assert.equal(hasPublish(), false);
  } finally {
    h.close();
  }
});
test("missing image descriptions show a field error and focus only the editor pane; correction clears the error", async () => {
  const h = await workspace({ image: true });
  try {
    const fieldId = `story-image-description-${h.story.images[0]!.id}`;
    const description = () => h.all().find((n) => n.props?.id === fieldId)!;
    description().props!.onChange({ target: { value: "" } });
    await h.render();
    await h.button("Publish updates").props!.onClick();
    await h.render();
    assert.equal(h.commands.length, 0);
    assert.equal(description().props!["aria-invalid"], true);
    assert.match(
      description().props!["aria-describedby"],
      /story-image-description-error-/,
    );
    assert.ok(
      h
        .all()
        .some(
          (n) =>
            n.props?.label === "Image description" &&
            n.props?.error?.includes("short description"),
        ),
    );
    assert.equal(h.focused.at(-1)?.id, fieldId);
    assert.deepEqual(h.focused.at(-1)?.options, { preventScroll: true });
    assert.deepEqual(h.scrolls.at(-1), { top: 280, behavior: "auto" });
    description().props!.onChange({
      target: { value: "The review workspace navigation." },
    });
    await h.render();
    assert.equal(description().props!["aria-invalid"], undefined);
    await h.button("Publish updates").props!.onClick();
    await h.render();
    assert.equal(
      h.commands.at(-1).document.images[0].alt,
      "The review workspace navigation.",
    );
  } finally {
    h.close();
  }
});
test("Cancel preserves the private recovery journal and returns to the profile", async () => {
  const h = await workspace();
  try {
    h.summary().props!.onChange("Keep this draft for later.");
    await h.render();
    await h.button("Cancel").props!.onClick();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(h.navigations, ["/my-profile"]);
    assert.ok(
      [...h.journal.values()].some(
        (entry) => entry.document.summary === "Keep this draft for later.",
      ),
    );
    assert.equal(h.commands.length, 0);
    assert.equal(h.record.presentation.summary, "Published story.");
  } finally {
    h.close();
  }
});
test("the footer portals into the editor sibling and file selection restores focus without scrolling", async () => {
  const host = { nodeType: 1 } as HTMLElement;
  const portalHarness = await workspace({ footerContainer: host });
  try {
    const portal = portalHarness
      .all()
      .find((n: any) => n.$$typeof === Symbol.for("react.portal")) as any;
    assert.ok(portal);
    assert.equal(portal.containerInfo, host);
    assert.equal(portal.children.type, "footer");
    assert.equal(portal.children.props["data-contribution-actions"], true);
    assert.doesNotMatch(
      portal.children.props.className,
      /nb-story-footer|sticky|fixed|-(?:bottom|mb)-/,
    );
    assert.match(portal.children.props.className, /flex.*shrink-0.*px-4.*py-3/);
    assert.match(portal.children.props.className, /safe-area-inset-bottom/);
  } finally {
    portalHarness.close();
  }
  const h = await workspace();
  try {
    const file = h
      .all()
      .find((n) => n.type === "input" && n.props?.type === "file")!;
    assert.equal(file.props!.className, "hidden");
    assert.equal(file.props!.tabIndex, -1);
    const focusOptions: unknown[] = [];
    h.button("Choose images").props!.onClick({
      currentTarget: {
        focus: (options: unknown) => focusOptions.push(options),
      },
    });
    file.props!.onChange({ target: { files: [], value: "" } });
    await h.render();
    assert.deepEqual(focusOptions, [{ preventScroll: true }]);
  } finally {
    h.close();
  }
});
