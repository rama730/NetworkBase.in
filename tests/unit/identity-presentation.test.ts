import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildIdentityPresentation,
  normalizeIdentityFields,
} from "@/lib/ui/identity";

describe("identity presentation", () => {
  it("normalizes camelCase and snake_case identity fields", () => {
    assert.deepEqual(
      normalizeIdentityFields({
        full_name: "  Ch Rama  ",
        username: "chrama",
        avatar_url: " https://cdn.example.com/avatar.png ",
      }),
      {
        id: null,
        fullName: "Ch Rama",
        username: "chrama",
        avatarUrl: "https://cdn.example.com/avatar.png",
      },
    );
  });

  it("builds a deterministic fallback presentation when no avatar exists", () => {
    const result = buildIdentityPresentation(
      {
        fullName: "Ch Rama",
        username: "chrama",
      },
      { fallbackDisplayName: "Builder" },
    );

    assert.equal(result.displayName, "Ch Rama");
    assert.equal(result.usernameLabel, "@chrama");
    assert.equal(result.initials, "CR");
    assert.equal(result.gradientClass, "nb-avatar-fallback");
  });

  it("uses the configured fallback display name when identity is empty", () => {
    const result = buildIdentityPresentation(null, { fallbackDisplayName: "Collaborator" });
    assert.equal(result.displayName, "Collaborator");
    assert.equal(result.alt, "Collaborator");
    assert.equal(result.initials, "CO");
  });

  it("preserves explicit fallback initials for shared avatar stacks", () => {
    const result = buildIdentityPresentation(null, {
      fallbackDisplayName: "Collaborator",
      fallbackInitials: "CR",
    });
    assert.equal(result.initials, "CR");
  });
});
