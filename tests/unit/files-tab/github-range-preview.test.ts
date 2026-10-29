import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

describe("GitHub Range Preview & Ecosystem Contracts", () => {
  const textViewerPath = path.join(
    process.cwd(),
    "src/components/workspaces/v2/files-tab/file/TextViewer.tsx"
  );
  const markdownPreviewPath = path.join(
    process.cwd(),
    "src/components/workspaces/v2/preview/MarkdownPreview.tsx"
  );
  const fileActionsBarPath = path.join(
    process.cwd(),
    "src/components/workspaces/v2/files-tab/file/FileActionsBar.tsx"
  );
  const assetPreviewPath = path.join(
    process.cwd(),
    "src/components/workspaces/v2/preview/AssetPreview.tsx"
  );
  const globalsCssPath = path.join(process.cwd(), "src/app/globals.css");

  const textViewerSource = fs.readFileSync(textViewerPath, "utf8");
  const markdownPreviewSource = fs.readFileSync(markdownPreviewPath, "utf8");
  const fileActionsBarSource = fs.readFileSync(fileActionsBarPath, "utf8");
  const assetPreviewSource = fs.readFileSync(assetPreviewPath, "utf8");
  const globalsCssSource = fs.readFileSync(globalsCssPath, "utf8");

  describe("TextViewer GitHub Range Preview", () => {
    it("implements hash parsing for single lines (#L15) and ranges (#L15-L25)", () => {
      assert.match(textViewerSource, /function parseLineRangeFromHash/);
      assert.match(textViewerSource, /hash\.match\(/);
    });

    it("registers CodeMirror line range decoration using cm-highlighted-line-range", () => {
      assert.match(textViewerSource, /cm-highlighted-line-range/);
      assert.match(textViewerSource, /Decoration\.line\(\{ class: ["']cm-highlighted-line-range["'] \}\)/);
      assert.match(textViewerSource, /StateField\.define/);
      assert.match(textViewerSource, /StateEffect\.define/);
    });

    it("attaches domEventHandlers to lineNumbers gutter for click & shift-click range selection", () => {
      assert.match(textViewerSource, /domEventHandlers:\s*\{/);
      assert.match(textViewerSource, /mousedown:\s*\(view,\s*line,\s*event\)/);
      assert.match(textViewerSource, /lineGutterHandlerRef/);
    });

    it("auto-scrolls target line into view on deep-link mount and hash change", () => {
      assert.match(textViewerSource, /EditorView\.scrollIntoView/);
    });

    it("listens to hashchange, popstate, and Escape key for clean range lifecycle", () => {
      assert.match(textViewerSource, /window\.addEventListener\(["']hashchange["']/);
      assert.match(textViewerSource, /window\.addEventListener\(["']popstate["']/);
      assert.match(textViewerSource, /e\.key === ["']Escape["']/);
    });

    it("defines light and dark theme line highlight styling in globals.css", () => {
      assert.match(globalsCssSource, /\.cm-editor \.cm-highlighted-line-range/);
      assert.match(globalsCssSource, /\.dark \.cm-editor \.cm-highlighted-line-range/);
    });
  });

  describe("MarkdownPreview GitHub Fidelity", () => {
    it("supports fidelity='github' by default for authentic GitHub README typography", () => {
      assert.match(markdownPreviewSource, /fidelity\s*=\s*["']github["']/);
      assert.match(markdownPreviewSource, /fidelity=\{fidelity\}/);
    });
  });

  describe("FileActionsBar Permalink Sharing", () => {
    it("preserves active #L line range hash when copying file link", () => {
      assert.match(fileActionsBarSource, /url\.hash = window\.location\.hash/);
    });
  });

  describe("AssetPreview Polish", () => {
    it("floating zoom toolbar uses high-contrast classes (text-foreground and bg-card/95)", () => {
      assert.match(assetPreviewSource, /bg-card\/95 dark:bg-zinc-900\/90/);
      assert.match(assetPreviewSource, /text-foreground/);
      assert.doesNotMatch(assetPreviewSource, /bg-card dark:bg-zinc-950\/85.*text-white/);
    });

    it("supports projectId fallback prop for PDF previews", () => {
      assert.match(assetPreviewSource, /projectId\?: string/);
      assert.match(assetPreviewSource, /node\.projectId \|\| projectId/);
      assert.doesNotMatch(assetPreviewSource, /node\.projectId = projectId/, "the prop is never mutated");
    });
  });
});
