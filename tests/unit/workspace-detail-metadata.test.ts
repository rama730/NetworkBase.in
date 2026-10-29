import test from "node:test";
import assert from "node:assert/strict";

import {
  buildWorkspaceDetailMetadataInput,
  getWorkspaceTitleFromSlug,
} from "@/lib/workspaces/workspace-detail-metadata";

test("getWorkspaceTitleFromSlug normalizes slugs and hides UUIDs", () => {
  assert.equal(getWorkspaceTitleFromSlug("network-for-builders"), "network for builders");
  assert.equal(getWorkspaceTitleFromSlug("550e8400-e29b-41d4-a716-446655440000"), "Workspace");
  assert.equal(getWorkspaceTitleFromSlug("%E0%A4%A"), "%E0%A4%A");
});

test("buildWorkspaceDetailMetadataInput trims project title and descriptions", () => {
  assert.deepEqual(
    buildWorkspaceDetailMetadataInput("network-for-builders", {
      slug: "network-for-builders ",
      title: "Network for builders ",
      shortDescription: "  Learn and build together.  ",
      description: "Longer description",
    }),
    {
      title: "Network for builders | NetworkBase",
      description: "Learn and build together.",
      path: "/workspaces/network-for-builders",
      image: "/api/og/workspace/network-for-builders",
      imageAlt: "Network for builders workspace image",
      imageWidth: 1200,
      imageHeight: 630,
      twitterCard: "summary_large_image",
    },
  );
});

test("buildWorkspaceDetailMetadataInput uses large-card dimensions for uploaded workspace images", () => {
  assert.deepEqual(
    buildWorkspaceDetailMetadataInput("network-for-builders", {
      slug: "network-for-builders",
      title: "Network for builders",
      coverImage: "https://cdn.example.test/workspace.png",
      coverImageWidth: 900,
      coverImageHeight: 500,
    }),
    {
      title: "Network for builders | NetworkBase",
      description: "Explore Network for builders on NetworkBase.",
      path: "/workspaces/network-for-builders",
      image: "https://cdn.example.test/workspace.png",
      imageAlt: "Network for builders workspace image",
      imageWidth: 900,
      imageHeight: 500,
      twitterCard: "summary_large_image",
    },
  );
});
