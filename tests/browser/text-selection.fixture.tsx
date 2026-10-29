import React from "react";
import { createRoot } from "react-dom/client";
import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { EditorContent, useEditor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { TextViewer, type TextViewerMode } from "@/components/workspaces/v2/files-tab/file/TextViewer";
import type { WorkspaceNode } from "@/lib/db/schema";

const node = {
  id: "selection-fixture",
  name: "selection.txt",
  currentVersion: 1,
  updatedAt: new Date("2026-10-09T00:00:00Z"),
} as WorkspaceNode;

function Fixture() {
  const [mode, setMode] = React.useState<TextViewerMode>("view");
  const editor = useEditor({
    extensions: [StarterKit],
    content: "<p>Rich text with <strong>nested formatting</strong>.</p>",
  });

  React.useEffect(() => {
    Object.assign(window, {
      selectionFixture: {
        appearance(theme: string, accent = "default", density = "default") {
          document.documentElement.classList.toggle("dark", theme === "dark");
          document.documentElement.dataset.accent = accent;
          document.documentElement.dataset.density = density;
          window.dispatchEvent(new Event("fixture-theme"));
        },
        mode: setMode,
        darkTheme() {
          const content = document.querySelector(".cm-content");
          return content && EditorView.findFromDOM(content as HTMLElement)?.state.facet(EditorView.darkTheme);
        },
        ranges() {
          const content = document.querySelector(".cm-content");
          return content && EditorView.findFromDOM(content as HTMLElement)?.state.selection.ranges.length;
        },
        select(ranges: number[][]) {
          window.getSelection()?.removeAllRanges();
          const content = document.querySelector(".cm-content");
          const view = content && EditorView.findFromDOM(content as HTMLElement);
          if (!view) throw new Error("Files editor is not mounted");
          view.dispatch({
            selection: EditorSelection.create(ranges.map(([from, to]) => EditorSelection.range(from!, to!))),
          });
          view.focus();
        },
      },
    });
  }, []);

  return (
    <main style={{ padding: 24, display: "grid", gap: 16 }}>
      <h1 data-testid="heading" className="nb-page-title">Discover</h1>
      <p data-testid="paragraph" className="text-muted-foreground">
        Projects looking for <strong data-testid="nested">people with your skills.</strong>
      </p>
      <a data-testid="link" href="#heading">Explore people</a>
      <Input aria-label="Shared input" defaultValue="Selectable input text" />
      <textarea aria-label="Textarea" defaultValue="Selectable textarea text" />
      <Button data-testid="primary">New project</Button>
      <div data-testid="rich-text"><EditorContent editor={editor} /></div>
      <div data-testid="files" style={{ height: 180 }}>
        <TextViewer projectId="isolated-selection-fixture" node={node} mode={mode} canEdit />
      </div>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<Fixture />);
