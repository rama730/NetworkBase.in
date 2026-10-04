import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  avatarVariantSizeForDisplay,
  publicAvatarVariantUrl,
} from "../../src/lib/profile/avatar-variants";

describe("public avatar variants", () => {
  it("selects a bounded source for the rendered size", () => {
    assert.equal(avatarVariantSizeForDisplay(24), 64);
    assert.equal(avatarVariantSizeForDisplay(48), 128);
    assert.equal(avatarVariantSizeForDisplay(96), 400);
    assert.equal(avatarVariantSizeForDisplay(), 128);
  });

  it("converts public avatar objects to immutable transform URLs", () => {
    const transformed = new URL(publicAvatarVariantUrl(
      "https://example.supabase.co/storage/v1/object/public/avatars/user/avatar.jpg?download=0",
      128,
    ));

    assert.equal(transformed.pathname, "/storage/v1/render/image/public/avatars/user/avatar.jpg");
    assert.equal(transformed.searchParams.get("width"), "128");
    assert.equal(transformed.searchParams.get("height"), "128");
    assert.equal(transformed.searchParams.get("resize"), "cover");
    assert.equal(transformed.searchParams.get("quality"), "80");
    assert.equal(transformed.searchParams.get("download"), "0");
  });

  it("updates an existing rendered avatar without stacking transforms", () => {
    const transformed = new URL(publicAvatarVariantUrl(
      "https://example.supabase.co/storage/v1/render/image/public/avatars/user/avatar.jpg?width=400&height=400",
      64,
    ));

    assert.equal(transformed.pathname, "/storage/v1/render/image/public/avatars/user/avatar.jpg");
    assert.equal(transformed.searchParams.get("width"), "64");
    assert.equal(transformed.searchParams.get("height"), "64");
  });

  it("does not rewrite external, private or local preview URLs", () => {
    const values = [
      "https://images.example.com/avatar.jpg",
      "https://example.supabase.co/storage/v1/object/sign/avatars/user/avatar.jpg?token=secret",
      "blob:https://app.example.com/preview-id",
      "data:image/png;base64,AAAA",
      "/api/v1/profiles/avatar",
    ];
    for (const value of values) assert.equal(publicAvatarVariantUrl(value, 64), value);
  });
});
