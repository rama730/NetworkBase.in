import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  isTrustedPublicReadmeImageHost,
  classifyReadmeImage,
  parseReadmeHtmlDimension,
  parseReadmeHtmlWidthPercent,
} from "@/lib/workspaces/doc-media";

describe("MarkdownPreview and Media Rendering Engine (Ponytail shrink: reuse)", () => {
  const previewFilePath = path.join(
    process.cwd(),
    "src/components/workspaces/v2/preview/MarkdownPreview.tsx"
  );
  const rendererFilePath = path.join(
    process.cwd(),
    "src/components/workspaces/doc/WorkspaceDocRenderer.tsx"
  );
  const previewSource = fs.readFileSync(previewFilePath, "utf8");
  const rendererSource = fs.readFileSync(rendererFilePath, "utf8");

  it("re手を reuses WorkspaceDocRenderer directly from doc tab (Ponytail shrink: principle)", () => {
    assert.match(
      previewSource,
      /import\("@\/components\/workspaces\/doc\/WorkspaceDocRenderer"\)/,
      "MarkdownPreview must reuse WorkspaceDocRenderer as-is instead of maintaining a parallel engine"
    );
    assert.match(
      previewSource,
      /<WorkspaceDocRenderer/,
      "MarkdownPreview renders WorkspaceDocRenderer component"
    );
  });

  it("WorkspaceDocRenderer imports rehype-raw, rehype-sanitize, and remark-gfm", () => {
    assert.match(rendererSource, /import\s+rehypeRaw\s+from\s+["']rehype-raw["']/);
    assert.match(rendererSource, /import\s+rehypeSanitize/);
    assert.match(rendererSource, /import\s+remarkGfm\s+from\s+["']remark-gfm["']/);
  });

  it("WorkspaceDocRenderer enables skipHtml={false} and provides README_HTML_SANITIZE_SCHEMA", () => {
    assert.match(rendererSource, /skipHtml=\{false\}/);
    assert.match(rendererSource, /README_HTML_SANITIZE_SCHEMA/);
    assert.match(rendererSource, /README_HTML_ALIGN_VALUES/);
  });

  it("recognizes trusted public readme hosts automatically", () => {
    assert.equal(isTrustedPublicReadmeImageHost("https://img.shields.io/badge/v-1.0.0-blue"), true);
    assert.equal(isTrustedPublicReadmeImageHost("https://shields.io/github/license/user/repo"), true);
    assert.equal(isTrustedPublicReadmeImageHost("https://api.star-history.com/svg?repos=user/repo&type=Date"), true);
    assert.equal(isTrustedPublicReadmeImageHost("https://star-history.com/user/repo.svg"), true);
    assert.equal(isTrustedPublicReadmeImageHost("https://raw.githubusercontent.com/user/repo/main/logo.png"), true);
    assert.equal(isTrustedPublicReadmeImageHost("https://avatars.githubusercontent.com/u/12345"), true);
    assert.equal(isTrustedPublicReadmeImageHost("https://em-content.zobj.net/source/apple/391/rock_1faa8.png"), true);
    // Untrusted random external host
    assert.equal(isTrustedPublicReadmeImageHost("https://untrusted-analytics-tracker.com/pixel.png"), false);
  });

  it("classifies image kinds accurately for responsive display", () => {
    const badge = classifyReadmeImage({
      src: "https://img.shields.io/github/stars/user/repo",
      alt: "GitHub Stars",
      title: null,
      width: null,
      height: null,
    });
    assert.equal(badge, "badge");

    const diagram = classifyReadmeImage({
      src: "https://api.star-history.com/svg?repos=user/repo&type=Date",
      alt: "Star History Chart",
      title: null,
      width: null,
      height: null,
    });
    assert.equal(diagram, "diagram");

    const logo = classifyReadmeImage({
      src: "https://example.com/logo.png",
      alt: "Logo",
      title: null,
      width: 180,
      height: 60,
    });
    assert.equal(logo, "logo");

    const icon = classifyReadmeImage({
      src: "https://example.com/fav.png",
      alt: "Favicon",
      title: null,
      width: 24,
      height: 24,
    });
    assert.equal(icon, "icon");
  });

  it("parses explicit HTML dimensions and percentages correctly", () => {
    assert.equal(parseReadmeHtmlDimension(300), 300);
    assert.equal(parseReadmeHtmlDimension("250px"), 250);
    assert.equal(parseReadmeHtmlDimension("invalid"), null);

    assert.equal(parseReadmeHtmlWidthPercent("50%"), 50);
    assert.equal(parseReadmeHtmlWidthPercent("100%"), 100);
    assert.equal(parseReadmeHtmlWidthPercent("150%"), null);
    assert.equal(parseReadmeHtmlWidthPercent("50px"), null);
  });

  it("supports HTML align attribute on headings, paragraphs, and div containers", () => {
    assert.match(rendererSource, /align === "center" && "text-center"/);
    assert.match(rendererSource, /align === "right" && "text-right"/);
  });

  it("ensures blocked image fallback is an inline phrasing element (<span role='button'>) to prevent hydration error", () => {
    assert.match(
      rendererSource,
      /<span[\s\S]+?role=\{canUnlock \? "button" : undefined\}[\s\S]+?className=\{cn\([\s\S]+?readmeHiddenMediaClass/
    );
  });
});
