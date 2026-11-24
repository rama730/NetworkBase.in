import React from "react";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import { build } from "esbuild";
import { ComposerReferenceOptions } from "@/components/workspaces/updates/ComposerReferenceOptions";
import {
  incomingContributionSummary,
  outgoingContributionSummary,
} from "@/components/profile/edit/ContributionSummaryEditor";
import { referenceToken } from "@/lib/profile/contribution-story";

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
async function summary() {
  const slots: any[] = [],
    effects: Array<() => void> = [],
    operations: any[] = [],
    selected: any[] = [],
    searches: any[] = [];
  let index = 0,
    dirty = false,
    tree: any,
    config: any,
    before = "",
    markdown = "Worked with ";
  const person = {
    kind: "person" as const,
    id: randomUUID(),
    label: "Ram",
    href: "/u/ram",
    available: true,
  };
  const editor: any = {
    state: {
      selection: {
        from: 13,
        $head: { parentOffset: 13, parent: { textBetween: () => before } },
      },
    },
    storage: { markdown: { getMarkdown: () => markdown } },
    getText: () => markdown,
    isActive: () => false,
    can: () => ({ undo: () => false, redo: () => false }),
    commands: {
      setContent: (value: string) => {
        markdown = value;
      },
      deleteRange: (range: any) => {
        operations.push({ deleteRange: range });
        before = before.slice(0, -1);
        markdown = markdown.replace(/@$/, "");
        config.onUpdate({ editor });
      },
      focus: (...args: any[]) => operations.push({ focus: args }),
    },
    chain() {
      const chain = {
        focus: (...args: any[]) => {
          operations.push({ focus: args });
          return chain;
        },
        insertContent: (content: any) => {
          operations.push({ insertContent: content });
          markdown += `[${content[0].text}](${content[0].marks[0].attrs.href}) `;
          return chain;
        },
        run: () => {
          before = "";
          config.onUpdate({ editor });
        },
      };
      return chain;
    },
  };
  const props: any = {
    value: markdown,
    references: [],
    projectId: randomUUID(),
    fileCount: 0,
    onChange: (value: string) => {
      props.value = value;
      dirty = true;
    },
    searchReferences: async (kind: string, query: string) => {
      searches.push({ kind, query });
      return [person];
    },
    onReferenceSelected: (ref: any) => {
      selected.push(ref);
      props.references = [ref];
    },
  };
  const key = "__contributionSummaryTest";
  (globalThis as any)[key] = {
    editor,
    configure: (options: any) => {
      config = options;
    },
    useState(initial: any) {
      const n = index++;
      if (!(n in slots))
        slots[n] = typeof initial === "function" ? initial() : initial;
      return [
        slots[n],
        (value: any) => {
          slots[n] = typeof value === "function" ? value(slots[n]) : value;
          dirty = true;
        },
      ];
    },
    useRef(initial: any) {
      const n = index++;
      if (!(n in slots)) slots[n] = { current: initial };
      return slots[n];
    },
    useEffect(fn: () => any, deps: any[] = []) {
      const n = index++,
        old = slots[n];
      if (
        !old ||
        deps.length !== old.deps.length ||
        deps.some((d, i) => d !== old.deps[i])
      )
        effects.push(() => {
          old?.cleanup?.();
          slots[n] = { deps, cleanup: fn() };
        });
    },
  };
  const mocks: Record<string, string> = {
    react: `const h=()=>globalThis.${key};export const useState=i=>h().useState(i),useRef=i=>h().useRef(i),useEffect=(f,d)=>h().useEffect(f,d);`,
    "@tiptap/react": `export function EditorContent(){return null;}export const useEditor=o=>{const h=globalThis.${key};h.configure(o);return h.editor;};`,
    "@/components/ui/button": `export function Button(){return null;}`,
    "@/components/workspaces/updates/ComposerReferenceOptions": `export function ComposerReferenceOptions(){return null;}`,
  };
  const result = await build({
    entryPoints: ["src/components/profile/edit/ContributionSummaryEditor.tsx"],
    bundle: true,
    write: false,
    platform: "node",
    format: "cjs",
    jsx: "automatic",
    packages: "external",
    plugins: [
      {
        name: "summary-code-harness",
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
  const mod = { exports: {} as any };
  new Function("require", "module", "exports", result.outputFiles![0]!.text)(
    createRequire(import.meta.url),
    mod,
    mod.exports,
  );
  async function render() {
    for (let i = 0; i < 25; i++) {
      index = 0;
      dirty = false;
      tree = mod.exports.ContributionSummaryEditor(props);
      for (const fn of effects.splice(0)) fn();
      await Promise.resolve();
      await Promise.resolve();
      if (!dirty) break;
    }
  }
  await render();
  return {
    operations,
    selected,
    searches,
    person,
    props,
    editor,
    render,
    all: () => nodes(tree),
    picker: () =>
      nodes(tree).find((n) => n.type?.name === "ComposerReferenceOptions"),
    typeAt: () => {
      before = "Worked with @";
      markdown = "Worked with @";
      config.onUpdate({ editor });
    },
    close() {
      for (const slot of slots) slot?.cleanup?.();
      delete (globalThis as any)[key];
    },
  };
}

test("typing @ opens the Updates inline picker, searches, inserts at the cursor and closes without a modal", async () => {
  const h = await summary();
  try {
    h.typeAt();
    await h.render();
    assert.ok(h.picker());
    assert.ok(!h.all().some((n) => /Dialog/.test(n.type?.name ?? "")));
    assert.deepEqual(h.operations[0], { deleteRange: { from: 12, to: 13 } });
    h.picker().props.onQueryChange("ram");
    await h.render();
    await new Promise((resolve) => setTimeout(resolve, 210));
    await h.render();
    assert.deepEqual(h.searches, [{ kind: "person", query: "ram" }]);
    assert.equal(h.picker().props.options[0].id, h.person.id);
    h.picker().props.onSelect(h.person);
    await h.render();
    assert.equal(h.picker(), undefined);
    assert.deepEqual(h.selected, [h.person]);
    assert.match(h.props.value, /ref\.person/);
    assert.ok(h.props.value.includes(h.person.id));
    const inserted = h.operations.find((o) => o.insertContent).insertContent;
    assert.equal(inserted[0].text, "Ram");
    assert.deepEqual(inserted[1].marks, []);
    assert.deepEqual(h.operations.find((o) => o.focus).focus, [
      undefined,
      { scrollIntoView: false },
    ]);
    const mentionButton = h
      .all()
      .find(
        (n) => text(n) === "Mention" && typeof n.props?.onClick === "function",
      );
    mentionButton.props.onClick();
    await h.render();
    h.picker().props.onClose();
    await h.render();
    assert.equal(h.picker(), undefined);
  } finally {
    h.close();
  }
});
test("reference serialization retains identities and shared options use the same accessible native controls", () => {
  const id = randomUUID(),
    raw = referenceToken("person", id);
  const linked = incomingContributionSummary(raw, [
    { id, kind: "person", label: "Ram", href: "/u/ram", available: true },
  ]);
  assert.equal(outgoingContributionSummary(linked), raw);
  const complex = incomingContributionSummary(raw, [
    {
      id,
      kind: "person",
      label: "Jane [Designer] <UI>",
      href: "/u/jane",
      available: true,
    },
  ]);
  assert.equal(outgoingContributionSummary(complex), raw);
  assert.doesNotMatch(complex, /<UI>/);
  const html = renderToStaticMarkup(
    <ComposerReferenceOptions
      query="ram"
      onQueryChange={() => {}}
      placeholder="Find teammate"
      options={[{ id, kind: "person", label: "Ram" }]}
      loading={false}
      onSelect={() => {}}
    />,
  );
  assert.match(html, /aria-label="Find teammate"/);
  assert.match(html, /<button[^>]*type="button"/);
  assert.match(html, /lucide-user-round/);
  assert.match(html, /Ram/);
  for (const file of [
    "src/components/workspaces/updates/WorkspaceUpdateComposer.tsx",
    "src/components/profile/edit/ContributionSummaryEditor.tsx",
  ]) {
    assert.match(readFileSync(file, "utf8"), /ComposerReferenceOptions/);
  }
});
