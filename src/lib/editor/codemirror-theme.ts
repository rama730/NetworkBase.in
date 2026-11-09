/**
 * The code editor in the app's own colors (report A9.3): chrome and syntax come from the theme's CSS tokens, so light
 * and dark follow the app instead of One Dark's fixed palette.
 */
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags as t } from "@lezer/highlight";

const syntax = HighlightStyle.define([
  { tag: [t.keyword, t.modifier, t.operatorKeyword, t.controlKeyword], color: "var(--primary)" },
  { tag: [t.string, t.special(t.string), t.regexp, t.inserted], color: "var(--status-success)" },
  { tag: [t.number, t.bool, t.null, t.atom, t.changed], color: "var(--status-warning)" },
  { tag: [t.comment, t.lineComment, t.blockComment, t.meta], color: "var(--muted-foreground)", fontStyle: "italic" },
  { tag: [t.deleted, t.invalid], color: "var(--destructive)" },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.className, t.typeName], color: "var(--foreground)", fontWeight: "600" },
  { tag: [t.heading], fontWeight: "600" },
  { tag: [t.link, t.url], color: "var(--primary)", textDecoration: "underline" },
  { tag: [t.emphasis], fontStyle: "italic" },
  { tag: [t.strong], fontWeight: "600" },
]);

export function appEditorTheme(dark: boolean): Extension {
  return [
    EditorView.theme({
      "&": { backgroundColor: "var(--card)", color: "var(--foreground)" },
      ".cm-content": { caretColor: "var(--foreground)" },
      ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--foreground)" },
      "&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection": { backgroundColor: "color-mix(in srgb, var(--primary) 20%, transparent)" },
      ".cm-gutters": { backgroundColor: "var(--muted)", color: "var(--muted-foreground)", borderRight: "1px solid var(--border)" },
      ".cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--muted) 60%, transparent)" },
      ".cm-activeLineGutter": { backgroundColor: "var(--muted)", color: "var(--foreground)" },
      ".cm-searchMatch": { backgroundColor: "var(--status-warning-soft)", outline: "1px solid var(--status-warning)" },
      ".cm-panels": { backgroundColor: "var(--card)", color: "var(--foreground)", borderColor: "var(--border)" },
      ".cm-tooltip": { backgroundColor: "var(--popover, var(--card))", color: "var(--foreground)", border: "1px solid var(--border)" },
    }, { dark }),
    syntaxHighlighting(syntax),
  ];
}
