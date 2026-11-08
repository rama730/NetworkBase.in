# Cloudflare check for Google and GitHub sign-in — findings

Date: 2026-11-09. Status: report only, waiting for "implement".

## What exists today

| Way in | Where | Cloudflare check? |
|---|---|---|
| Email + password sign-up | `SignupForm.tsx` → `/api/v1/auth/signup` (server checks the token with Cloudflare) | Yes |
| Email + password sign-in | `LoginForm.tsx` → Supabase with `captchaToken` | Yes |
| Google button, GitHub button | `OAuthButtons` in `AuthShell.tsx` → `signInWithOAuth` → `/auth/callback` | **No** |
| Google One Tap | `GoogleOneTap.tsx` → `signInWithIdToken` straight from the browser to Supabase | **No** |

Google and GitHub sign-in are already built and live. What is missing is the Cloudflare check on them.

## Checked on production (2026-11-09)

Each probe was a harmless request to the live Supabase project (`iutauehhgdymtpzrnzcy`) without a Cloudflare token.
None of them created anything.

| Path | Result | Meaning |
|---|---|---|
| Email sign-in (`grant_type=password`) | `captcha_failed: no captcha_token found` | Supabase's captcha setting is **on**. Email sign-in and sign-up are blocked without the check, even when someone calls Supabase directly. |
| One Tap (`grant_type=id_token`) | `Bad ID token` (no captcha error) | **Not checked.** Supabase skips the captcha for this path. |
| GitHub/Google button (`/authorize`) | 302 straight to GitHub | **Not checked.** |

So the email side is already fully covered. The gap is exactly the three social paths below.

## Is it possible?

Yes. Supabase's own captcha setting does not cover the Google/GitHub buttons (that call has no captcha option), so the
check is done in our own server code instead.

## How

1. **One check for the whole page.** The Cloudflare box moves from under the email form to above the three ways
   in, and Google, GitHub, One Tap and the email form all use the same check. On most visits it passes on its own with
   no click.
2. **Google and GitHub buttons.** A click sends the check's token to a new server step. The server asks Cloudflare,
   and if the token passes, sets a short-lived (10 minutes), private, signed cookie tied to the request id that already
   travels in the return address (`rid`). The browser then goes to Google or GitHub. Back at `/auth/callback`, the
   server finishes the sign-in only if that cookie matches. Without it, the person lands back on the sign-in page with
   "Complete the security check, then try again."
3. **One Tap.** The Google credential no longer goes from the browser straight to Supabase. The browser sends it, with
   the nonce and the check's token, to a new server route. The server checks with Cloudflare, signs in with Supabase
   and returns the session, the same way the email sign-up route does today. The One Tap prompt only appears after
   the check has passed.
4. **Closing the back door.** Someone could skip our pages and start Google sign-in directly against Supabase. So a
   **new** account made through Google or GitHub is marked "checked" on the server only when step 2 or 3 passed. The
   agreement step (`/legal/accept?context=oauth_signup`), where the account becomes a real profile, refuses accounts
   without the mark. Existing accounts are not affected.
5. **Left as they are:** someone already signed in connecting GitHub for file import (they passed a check when they
   signed in); a refreshed session; if Cloudflare itself is down, the check lets people through, as the email form does
   today.
6. **Tests:** unit tests for the cookie (signed, expires, tied to `rid`); a DB/route test for the callback refusing
   without it; a One Tap route test; browser tests for the buttons waiting for the check.

## What is not possible

1. **Cloudflare can't check the Google or GitHub account itself.** It only checks that a real person in a real
   browser is on our page. Google and GitHub check the account, the password and their own robot checks.
2. **Cloudflare can't run on Google's or GitHub's own sign-in pages.** It runs on ours, before we send the person
   there.
3. **Supabase's built-in captcha setting can't cover the Google/GitHub buttons**, which is why the check lives in our
   code (steps 2–4).
4. **An empty login row can still appear.** Someone going directly to Supabase can still leave an account row in
   Supabase's login table. Supabase makes that row before we see anything. With step 4 it never becomes a profile and
   never gets into the app. Stopping the row itself isn't possible from our side.
