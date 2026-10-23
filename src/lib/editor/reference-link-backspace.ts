import { Extension } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";

export function referenceLinkBackspaceExtension(prefix: string) {
  return Extension.create({
    name: "referenceLinkBackspace",

    addProseMirrorPlugins() {
      return [
        new Plugin({
          key: new PluginKey("referenceLinkBackspace"),
          props: {
            handleKeyDown(view, event) {
              if (event.key !== "Backspace" && event.key !== "Delete") {
                return false;
              }

              const { state, dispatch } = view;
              const { selection } = state;
              if (!selection.empty) {
                return false;
              }

              const pos = selection.from;
              const isBackspace = event.key === "Backspace";
              const referenceRanges: Array<{
                from: number;
                to: number;
                href: string;
              }> = [];

              state.doc.descendants((node, nodePos) => {
                if (!node.isText) return true;
                const linkMark = node.marks.find(
                  (mark) => mark.type.name === "link",
                );
                const href = linkMark?.attrs.href;
                if (typeof href !== "string" || !href.startsWith(prefix)) {
                  return true;
                }

                referenceRanges.push({
                  from: nodePos,
                  to: nodePos + node.nodeSize,
                  href,
                });
                return true;
              });

              const targetIndex = referenceRanges.findIndex((range) =>
                isBackspace
                  ? pos > range.from && pos <= range.to
                  : pos >= range.from && pos < range.to,
              );
              if (targetIndex === -1) return false;

              const target = referenceRanges[targetIndex];
              if (!target) return false;
              let from = target.from;
              let to = target.to;

              for (let index = targetIndex - 1; index >= 0; index -= 1) {
                const range = referenceRanges[index];
                if (!range || range.href !== target.href || range.to !== from)
                  break;
                from = range.from;
              }

              for (
                let index = targetIndex + 1;
                index < referenceRanges.length;
                index += 1
              ) {
                const range = referenceRanges[index];
                if (!range || range.href !== target.href || range.from !== to)
                  break;
                to = range.to;
              }

              if (from >= to) return false;
              dispatch(state.tr.delete(from, to));
              return true;
            },
          },
        }),
      ];
    },
  });
}
