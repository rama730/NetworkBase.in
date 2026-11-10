import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __testOnly } from "@/lib/security/password-auth";

describe("password auth helpers", () => {
  // Supabase's CAPTCHA protection refuses a password sign-in without a token, so every "verify it's you" by password
  // failed with a 500 (found 2026-11-10). The dialog's Turnstile token goes to Supabase, which checks it itself.
  it("sends the security check's token with the password", async () => {
    let sent: unknown = null;
    const result = await __testOnly.verifyPasswordCredentialWithVerifier(
      { auth: { async signInWithPassword(credentials) { sent = credentials; return {}; }, async signOut() {} } },
      "user@example.com",
      "right-password",
      "turnstile-token",
    );
    assert.deepEqual(result, { ok: true });
    assert.deepEqual(sent, { email: "user@example.com", password: "right-password", options: { captchaToken: "turnstile-token" } });
  });

  it("a refused or missing security check is its own answer, not a server error", async () => {
    const result = await __testOnly.verifyPasswordCredentialWithVerifier(
      { auth: { async signInWithPassword() { return { error: { message: "captcha protection: request disallowed (no captcha_token found)", code: "captcha_failed", status: 400 } }; }, async signOut() {} } },
      "user@example.com",
      "right-password",
    );
    assert.equal(result.ok, false);
    assert.equal(result.reason, "captcha_failed");
    assert.equal(result.message, "Finish the security check, then try again.");
  });

  it("returns an invalid-password result without signing out when credentials are invalid", async () => {
    let signOutCalls = 0;

    const result = await __testOnly.verifyPasswordCredentialWithVerifier(
      {
        auth: {
          async signInWithPassword() {
            return {
              error: {
                message: "Invalid login credentials",
                code: "invalid_credentials",
                status: 400,
              },
            };
          },
          async signOut() {
            signOutCalls += 1;
          },
        },
      },
      "user@example.com",
      "bad-password",
    );

    assert.deepEqual(result, {
      ok: false,
      reason: "invalid_credentials",
      message: "Invalid login credentials",
    });
    assert.equal(signOutCalls, 0);
  });

  it("uses a generic fallback message for non-credential verification failures", async () => {
    const result = await __testOnly.verifyPasswordCredentialWithVerifier(
      {
        auth: {
          async signInWithPassword() {
            return {
              error: {
                code: "unexpected_failure",
                status: 500,
              },
            };
          },
          async signOut() {},
        },
      },
      "user@example.com",
      "correct-password",
    );

    assert.deepEqual(result, {
      ok: false,
      reason: "verification_failed",
      message: "Couldn’t verify password",
    });
  });

  it("surfaces email confirmation errors distinctly from invalid credentials", async () => {
    const result = await __testOnly.verifyPasswordCredentialWithVerifier(
      {
        auth: {
          async signInWithPassword() {
            return {
              error: {
                message: "Email not confirmed",
                code: "email_not_confirmed",
                status: 400,
              },
            };
          },
          async signOut() {},
        },
      },
      "user@example.com",
      "correct-password",
    );

    assert.deepEqual(result, {
      ok: false,
      reason: "email_not_confirmed",
      message: "Email not confirmed",
    });
  });

  it("preserves backend error messages for non-credential verification failures", async () => {
    const result = await __testOnly.verifyPasswordCredentialWithVerifier(
      {
        auth: {
          async signInWithPassword() {
            return {
              error: {
                message: "Auth service temporarily unavailable",
                code: "service_unavailable",
                status: 503,
              },
            };
          },
          async signOut() {},
        },
      },
      "user@example.com",
      "correct-password",
    );

    assert.deepEqual(result, {
      ok: false,
      reason: "verification_failed",
      message: "Auth service temporarily unavailable",
    });
  });

  // AUTH-001: the throwaway verifier session must not revoke the user's other devices.
  it("signs out the temporary verifier session after a successful password check", async () => {
    let signOutCalls = 0;
    let signOutScope: string | undefined;

    const result = await __testOnly.verifyPasswordCredentialWithVerifier(
      {
        auth: {
          async signInWithPassword() {
            return { error: null };
          },
          async signOut(options?: { scope?: string }) {
            signOutCalls += 1;
            signOutScope = options?.scope;
          },
        },
      },
      "user@example.com",
      "correct-password",
    );

    assert.deepEqual(result, { ok: true });
    assert.equal(signOutCalls, 1);
    assert.equal(signOutScope, "local");
  });

  it("keeps verification successful even when temporary-session cleanup fails", async () => {
    const result = await __testOnly.verifyPasswordCredentialWithVerifier(
      {
        auth: {
          async signInWithPassword() {
            return { error: null };
          },
          async signOut() {
            throw new Error("cleanup failed");
          },
        },
      },
      "user@example.com",
      "correct-password",
    );

    assert.deepEqual(result, { ok: true });
  });
});
