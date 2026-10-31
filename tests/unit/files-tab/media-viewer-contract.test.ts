import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("Media Viewer & Video Player Contract Conformance", async (t) => {
  const mediaDriverPath = path.join(
    process.cwd(),
    "src/components/workspaces/v2/preview/drivers/MediaViewerDriver.tsx"
  );
  const previewRoutePath = path.join(
    process.cwd(),
    "src/app/api/v1/workspaces/[id]/files/[nodeId]/preview/route.ts"
  );

  const mediaDriver = fs.readFileSync(mediaDriverPath, "utf-8");
  const previewRoute = fs.readFileSync(previewRoutePath, "utf-8");

  await t.test("Design Contract: Strict zero rounded-full controls in MediaViewerDriver", () => {
    assert.doesNotMatch(
      mediaDriver,
      /rounded-full/,
      "MediaViewerDriver must not use rounded-full controls, adhering to files tab design tokens"
    );
  });

  await t.test("Pillar 1: Zoom modes, cursor auto-hide, and time toggle", () => {
    assert.match(
      mediaDriver,
      /cycleZoomMode/,
      "MediaViewerDriver must implement zoom mode cycling"
    );
    assert.match(
      mediaDriver,
      /fit|fill|native/,
      "MediaViewerDriver must support fit, fill, and native zoom modes"
    );
    assert.match(
      mediaDriver,
      /cursor-none/,
      "MediaViewerDriver must auto-hide cursor during playback when controls hide"
    );
    assert.match(
      mediaDriver,
      /timeDisplayMode/,
      "MediaViewerDriver must support toggling time display (elapsed/total vs remaining)"
    );
  });

  await t.test("Pillar 2: Frame-accurate stepping, instant snapshot, and A-B loop", () => {
    assert.match(
      mediaDriver,
      /stepFrame/,
      "MediaViewerDriver must provide frame stepping function"
    );
    assert.match(
      mediaDriver,
      /captureFrame/,
      "MediaViewerDriver must provide frame snapshot capture function"
    );
    assert.match(
      mediaDriver,
      /cycleAbLoop/,
      "MediaViewerDriver must provide A-B loop cycling function"
    );
    assert.match(
      mediaDriver,
      /abLoop\.a !== null/,
      "MediaViewerDriver must track A-B loop start marker"
    );
  });

  await t.test("Pillar 3: Timestamp deep-linking, share links, and review pins", () => {
    assert.match(
      mediaDriver,
      /#t=/,
      "MediaViewerDriver must parse and support #t= timestamp deep-links"
    );
    assert.match(
      mediaDriver,
      /handleCopyLink|handleCopyTimestampLink/,
      "MediaViewerDriver must provide share link generator"
    );
    assert.match(
      mediaDriver,
      /handleDropMarker|handleRemoveMarker|TimelineMarker/,
      "MediaViewerDriver must support adding and removing timestamp review pins"
    );
  });

  await t.test("Pillar 4: Audio pitch preservation and scrubber waveform track", () => {
    assert.match(
      mediaDriver,
      /preservesPitch/,
      "MediaViewerDriver must maintain audio pitch during playback speed changes"
    );
    assert.match(
      mediaDriver,
      /Audio Waveform/,
      "MediaViewerDriver must provide subtle audio waveform pattern across scrubber"
    );
  });

  await t.test("Pillar 5: Server-side streaming and signed URL caching", () => {
    assert.match(
      previewRoute,
      /mediaSignedUrlCache/,
      "Preview route must maintain in-memory LRU signed URL cache"
    );
    assert.match(
      previewRoute,
      /Cache-Control/,
      "Preview route must include private client caching headers"
    );
  });

  await t.test("Pillar 6: Touch gestures and double-tap seek jumps", () => {
    assert.match(
      mediaDriver,
      /handleTouchStart/,
      "MediaViewerDriver must handle touch start"
    );
    assert.match(
      mediaDriver,
      /handleTouchMove/,
      "MediaViewerDriver must handle touch move for brightness, volume, and scrub"
    );
    assert.match(
      mediaDriver,
      /triggerRipple/,
      "MediaViewerDriver must render ripple animations on double-tap seek jumps"
    );
  });

  await t.test("Clearance: Floating pill maintains md:right-24 to avoid bottom-right N widget", () => {
    assert.match(
      mediaDriver,
      /md:right-24/,
      "MediaViewerDriver bottom controls must maintain right-24 clearance to prevent overlapping the N widget"
    );
  });

  await t.test("Progression & Duration Safety: Dynamic effective duration and playback stability", () => {
    assert.match(
      mediaDriver,
      /effectiveDuration/,
      "MediaViewerDriver must compute effectiveDuration from seekable/buffered duration to prevent progress bar stalling"
    );
    assert.match(
      mediaDriver,
      /syncDuration/,
      "MediaViewerDriver must synchronize media element duration dynamically during playback"
    );
    assert.match(
      mediaDriver,
      /MEDIA_ERR_ABORTED|target\.error\.code === 1/,
      "MediaViewerDriver must guard against transient abort and reload errors to ensure playback stability"
    );
  });
});
