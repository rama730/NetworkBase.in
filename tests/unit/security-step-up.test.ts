import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NextResponse } from "next/server";
import { __testOnly, issueSecurityStepUpCookie } from "@/lib/security/step-up";

describe("security step-up cookie helpers", () => {
  it("signs and verifies a valid step-up token", () => {
    process.env.SECURITY_STEPUP_SECRET = "step-up-secret";
    const token = __testOnly.buildSecurityStepUpValue({
      userId: "user-1",
      method: "totp",
      verifiedAt: Math.floor(Date.now() / 1000),
      exp: Math.floor(Date.now() / 1000) + 300,
    });

    const parsed = __testOnly.parseSecurityStepUpValue(token);
    assert.equal(parsed?.userId, "user-1");
    assert.equal(parsed?.method, "totp");
  });

  it("rejects expired tokens", () => {
    process.env.SECURITY_STEPUP_SECRET = "step-up-secret";
    const token = __testOnly.buildSecurityStepUpValue({
      userId: "user-1",
      method: "recovery_code",
      verifiedAt: Math.floor(Date.now() / 1000) - 400,
      exp: Math.floor(Date.now() / 1000) - 60,
    });

    assert.equal(__testOnly.parseSecurityStepUpValue(token), null);
  });

  // AUTH-005: sensitive server actions run on page paths, so the proof cookie must be sent there too.
  it("sends the proof cookie on every path, httpOnly and same-site strict", () => {
    process.env.SECURITY_STEPUP_SECRET = "step-up-secret";
    const response = NextResponse.json({});
    issueSecurityStepUpCookie(response, "user-1", "totp");
    const cookie = response.cookies.getAll().find((entry) => entry.name.includes("step"));
    assert.equal(cookie?.path, "/");
    assert.equal(cookie?.httpOnly, true);
    assert.equal(cookie?.sameSite, "strict");
  });
});
