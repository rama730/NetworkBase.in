import assert from "node:assert/strict";
import test from "node:test";
import { resolvePreviewType } from "@/components/projects/v2/utils/fileKind";
import type { ProjectNode } from "@/lib/db/schema";
import * as fflate from "fflate";

function mockNode(name: string, mimeType?: string, size = 1024): ProjectNode {
  return {
    id: "test-node-1",
    projectId: "proj-1",
    parentId: null,
    path: `/${name}`,
    type: "file",
    name,
    s3Key: `s3/${name}`,
    size,
    mimeType: mimeType ?? null,
    currentVersion: 1,
    metadata: {},
    gitHash: null,
    createdBy: null,
    deletedBy: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
  } as ProjectNode;
}

test("resolvePreviewType accurately classifies all multimedia and document formats", () => {
  // Images
  assert.equal(resolvePreviewType(mockNode("photo.png")), "image");
  assert.equal(resolvePreviewType(mockNode("logo.svg", "image/svg+xml")), "image");
  assert.equal(resolvePreviewType(mockNode("banner.webp")), "image");
  assert.equal(resolvePreviewType(mockNode("avatar.jpg")), "image");
  assert.equal(resolvePreviewType(mockNode("icon.ico")), "image");
  assert.equal(resolvePreviewType(mockNode("graphic.avif")), "image");

  // Video
  assert.equal(resolvePreviewType(mockNode("demo.mp4", "video/mp4")), "video");
  assert.equal(resolvePreviewType(mockNode("screen.mov")), "video");
  assert.equal(resolvePreviewType(mockNode("clip.webm")), "video");
  assert.equal(resolvePreviewType(mockNode("movie.mkv")), "video");
  assert.equal(resolvePreviewType(mockNode("recording.avi")), "video");

  // Audio
  assert.equal(resolvePreviewType(mockNode("track.mp3", "audio/mpeg")), "audio");
  assert.equal(resolvePreviewType(mockNode("podcast.m4a")), "audio");
  assert.equal(resolvePreviewType(mockNode("sound.wav")), "audio");
  assert.equal(resolvePreviewType(mockNode("music.flac")), "audio");

  // Documents
  assert.equal(resolvePreviewType(mockNode("contract.pdf", "application/pdf")), "pdf");
  assert.equal(resolvePreviewType(mockNode("specification.docx")), "docx");
  assert.equal(resolvePreviewType(mockNode("legacy-doc.doc", "application/msword")), "doc_legacy");
  assert.equal(resolvePreviewType(mockNode("formatted.rtf", "application/rtf")), "rtf");
  assert.equal(resolvePreviewType(mockNode("open-doc.odt")), "odt");

  // Presentations
  assert.equal(resolvePreviewType(mockNode("pitch-deck.pptx")), "presentation");
  assert.equal(resolvePreviewType(mockNode("legacy-slides.ppt")), "presentation");
  assert.equal(resolvePreviewType(mockNode("open-slides.odp")), "presentation");
  assert.equal(resolvePreviewType(mockNode("slideshow.ppsx")), "presentation");

  // Spreadsheets and Tabular data
  assert.equal(resolvePreviewType(mockNode("financials.xlsx")), "sheet");
  assert.equal(resolvePreviewType(mockNode("budget.xls")), "sheet");
  assert.equal(resolvePreviewType(mockNode("customers.csv")), "sheet");
  assert.equal(resolvePreviewType(mockNode("metrics.tsv")), "sheet");
  assert.equal(resolvePreviewType(mockNode("open-sheet.ods")), "sheet");

  // Archives
  assert.equal(resolvePreviewType(mockNode("release-bundle.zip")), "archive");

  // Markdown
  assert.equal(resolvePreviewType(mockNode("README.md")), "markdown");
  assert.equal(resolvePreviewType(mockNode("notes.markdown")), "markdown");

  // Code & text
  assert.equal(resolvePreviewType(mockNode("server.ts")), "text");
  assert.equal(resolvePreviewType(mockNode("app.py")), "text");
  assert.equal(resolvePreviewType(mockNode("main.rs")), "text");
  assert.equal(resolvePreviewType(mockNode("schema.sql")), "text");
  assert.equal(resolvePreviewType(mockNode("config.json")), "text");
  assert.equal(resolvePreviewType(mockNode("pipeline.yaml")), "text");
  assert.equal(resolvePreviewType(mockNode(".env.local")), "text");

  // Unknown Binaries
  assert.equal(resolvePreviewType(mockNode("program.wasm")), "binary");
  assert.equal(resolvePreviewType(mockNode("data.bin")), "binary");
});

test("fflate can unzip an in-memory zip archive with files and directories", () => {
  const zipData = fflate.zipSync({
    "src/index.ts": fflate.strToU8("console.log('hello');"),
    "assets/logo.png": new Uint8Array([137, 80, 78, 71]),
    "README.md": fflate.strToU8("# Project"),
  });

  const unzipped = fflate.unzipSync(zipData);
  assert.ok(unzipped["src/index.ts"]);
  assert.ok(unzipped["assets/logo.png"]);
  assert.ok(unzipped["README.md"]);

  const content = fflate.strFromU8(unzipped["src/index.ts"]!);
  assert.equal(content, "console.log('hello');");
});

test("hex dump generation produces standard formatted offsets and ASCII representation", () => {
  const bytes = new Uint8Array([0x7f, 0x45, 0x4c, 0x46, 0x02, 0x01, 0x01, 0x00]);
  let hex = "";
  let ascii = "";
  for (let j = 0; j < bytes.length; j++) {
    const b = bytes[j]!;
    hex += b.toString(16).padStart(2, "0") + " ";
    ascii += b >= 32 && b <= 126 ? String.fromCharCode(b) : ".";
  }

  assert.equal(hex.trim(), "7f 45 4c 46 02 01 01 00");
  assert.equal(ascii, ".ELF....");
});

test("handles non-binary text content named with .docx extension gracefully", () => {
  const rawText = "404 NOT FOUND";
  const buffer = new TextEncoder().encode(rawText);

  let unzipped: fflate.Unzipped | null = null;
  let isInvalidZip = false;
  try {
    unzipped = fflate.unzipSync(buffer);
  } catch {
    isInvalidZip = true;
  }

  assert.equal(isInvalidZip, true, "13-byte plain text string is not a valid zip archive");
  assert.equal(unzipped, null);

  const decoded = new TextDecoder().decode(buffer);
  assert.equal(decoded, "404 NOT FOUND");
  assert.ok(/^[\x20-\x7E\s\r\n\t]+$/.test(decoded));
});
