import test from "node:test";
import assert from "node:assert/strict";
import { Schema } from "@tiptap/pm/model";
import { EditorState, TextSelection, type Plugin } from "@tiptap/pm/state";
import { referenceLinkBackspaceExtension } from "@/lib/editor/reference-link-backspace";
const schema = new Schema({
  nodes: {
    doc: { content: "paragraph+" },
    paragraph: { content: "text*", group: "block" },
    text: { group: "inline" },
  },
  marks: { link: { attrs: { href: {} }, inclusive: false }, bold: {} },
});
function press(
  prefix: string,
  key: string,
  cursor: number,
  href = prefix + "person/123",
) {
  const extension = referenceLinkBackspaceExtension(prefix);
  const plugin = (
    extension.config.addProseMirrorPlugins as () => Plugin[]
  )()[0]!;
  const link = schema.marks.link!.create({ href });
  const doc = schema.node("doc", null, [
    schema.node("paragraph", null, [
      schema.text("Before "),
      schema.text("Ra", [link]),
      schema.text("m", [link, schema.marks.bold!.create()]),
      schema.text(" after"),
    ]),
  ]);
  let state = EditorState.create({
    doc,
    selection: TextSelection.create(doc, cursor),
    plugins: [plugin],
  });
  let scrolled = false;
  const view = {
    state,
    dispatch: (tr: any) => {
      scrolled = tr.scrolledIntoView;
      state = state.apply(tr);
    },
  };
  const handled = plugin.props.handleKeyDown!.call(
    plugin,
    view as any,
    { key } as KeyboardEvent,
  );
  return { handled, text: state.doc.textContent, scrolled };
}
test("Updates and contribution references delete as one unit across formatted text without scrolling ancestors", () => {
  for (const prefix of ["/__readme-ref/", "/__contribution-ref/"]) {
    for (const [key, position] of [
      ["Backspace", 11],
      ["Delete", 8],
      ["Backspace", 10],
    ] as const) {
      const result = press(prefix, key, position);
      assert.equal(result.handled, true);
      assert.equal(result.text, "Before  after");
      assert.equal(result.scrolled, false);
    }
  }
});
test("normal hyperlinks and text outside a reference retain native deletion behavior", () => {
  assert.equal(
    press("/__contribution-ref/", "Backspace", 11, "https://example.com")
      .handled,
    false,
  );
  assert.equal(press("/__contribution-ref/", "Backspace", 8).handled, false);
  assert.equal(press("/__contribution-ref/", "ArrowLeft", 11).handled, false);
});
