# Sign-in, sign-up and password pages — findings

Date: 2026-11-09. Status: report only, waiting for "implement".
Pages: `/login` (with the two-step code screen), `/signup` (with the "Check your email" code step), `/forgot-password`,
`/reset-password`, `/verify-email`, `/legal/accept`, and the return step `/auth/callback`.
Read in code and checked in the browser at desktop and phone size.

## Already good (keep)

Show password, caps-lock warning, email typo suggestion ("Did you mean gmail.com?"), temporary-inbox block, leaked
password check, strength meter, one code box that phone autofill fills, resend cooldowns, a reset page that never
says whether an account exists, two-step sign-in, Cloudflare on every way in, drafts kept on refresh (name and email).

## A. Broken or dead-end paths — fix first

| # | Finding | Why it matters | Proposal |
|---|---|---|---|
| 1 | **Wrong error text on every failed return.** A failed GitHub sign-in, an expired reset link or a sign-up link all land on `/login?error=auth-code-error`, which says "Google sign-in could not be completed… If you are developing locally, open the app on the same origin". | Wrong provider, plus developer text shown to real people. | The callback sends a reason (`github`, `reset-link`, `link-other-device`, `expired`) and the sign-in page shows plain text for each, with the next step ("Ask for a new link"). |
| 2 | **A reset link opened on another device fails.** The link only works in the browser that asked for it. Asking on a laptop and opening the email on a phone is the most common case. | People think reset is broken and give up or write to support. | Put a 6-digit code in the reset email, and after "Send" show a code box (like sign-up). The code works on any device. The link stays for same-browser use. |
| 3 | **Lost authenticator = locked out.** Recovery codes exist (Settings uses them), but the sign-in code screen only offers "Contact support". | The whole point of recovery codes is this moment. | "Use a recovery code instead" on the code screen. The server checks the code and removes the lost authenticator, then signs the person in, asks them to set two-step up again and sends a security email. |
| 4 | **"Confirm your email first" is a dead end at sign-in.** No resend, no code box. | Someone who closed the tab after sign-up has no way forward on this page. | Show the code box and "Send a new code" right under the message. |
| 5 | **Refreshing "Check your email" loses the step.** It falls back to the empty form, and sending again says the email is already used. | Happens on phones (app switch to read the email, page reloads). | Remember the step in the tab. If the email belongs to an unconfirmed account, go straight to the code step. |
| 6 | **"This email has already been used"** gives no way forward. | The person is stuck on the sign-up page. | The message carries "Sign in instead" and "Reset password" links, with the email carried over. |

## B. Friction

| # | Finding | Proposal |
|---|---|---|
| 7 | The Cloudflare box is now the first thing on both pages (from today's change). | Use Cloudflare's "only when needed" mode: the box stays hidden and shows only when Cloudflare wants a click. |
| 8 | Sign-up asks for four fields plus a checkbox; "Confirm password" repeats what show-password and the strength meter already cover. | Drop "Confirm password". On a phone the button then sits on the first screen. |
| 9 | Sign-up shows "@handle · Available/Taken" under Full name. Setup asks for the handle again anyway. | Move the handle check to setup only; sign-up stays about getting in. |
| 10 | No hint of how someone signed in last time. Someone who joined with Google and types a password gets "email and password don't match". | Remember the last way in on this browser and mark that button "Last used". When the email form fails and the last way was Google or GitHub, say "You last signed in with Google". Nothing is revealed to anyone else. |
| 11 | Password is the only email way in. | Add "Email me a sign-in code". Supabase supports it, and its Cloudflare setting already covers it. |
| 12 | After a password reset, every device is signed out without saying so, and the sign-in page starts empty. | Say "You were signed out on your other devices" and fill in the email on the sign-in page. |
| 13 | On a phone the cookie banner covers half of the sign-up form and the Google/GitHub buttons. | A one-line cookie bar on sign-in pages on phones, with the full choices behind "Choose". |
| 14 | After Google or GitHub sign-up, a separate agreement page appears before setup. | Option: a line under the buttons ("By continuing you agree to the Terms and Privacy Notice") recorded with the current versions, which removes a page. This needs your decision (see D1). |
| 15 | `/verify-email` (signed in, not yet confirmed) only has a link and "I've confirmed", while sign-up uses a code. | Same code box and resend there. |
| 16 | Wrong password several times: the same message each time. | After 3 tries, show "Email me a code instead" and "Reset password" as buttons. |

## C. Security and trust

| # | Finding | Proposal |
|---|---|---|
| 17 | No email when a new device signs in, although device details, login history and other security emails exist. | "New sign-in to your account" email for a device not seen before, with "This wasn't me" → sign out everywhere and reset. |
| 18 | The two-step code is asked on every sign-in. | Optional "Trust this browser for 30 days" on the code screen; trusted browsers listed in Settings → Security and removable. |
| 19 | No passkeys (fingerprint or face sign-in). | Later: check what Supabase supports first, then offer it in Settings and as a sign-in button. |

## D. Polish

| # | Finding | Proposal |
|---|---|---|
| 20 | "Check your email" screens (sign-up, reset, verify) say what to do but leave the person to find their mail app. | "Open Gmail" / "Open Outlook" buttons when the email is at those services, and the code box's paste button on phones. |

## Decisions for you

- **D1 (item 14):** keep the separate agreement page after Google/GitHub sign-up, or use the line under the buttons. My suggestion: the line under the buttons, still recorded with versions.
  **Changed 2026-11-09:** the line under the buttons was removed at the user's request (the terms are in the footer links). New Google/GitHub accounts accept on the agreement page again; existing accounts never see it. "Forgot password?" moved beside the Password label so Sign in and "Email me a sign-in code instead" fit on one screen.
- **D2 (item 18):** offer "Trust this browser for 30 days", or keep asking every time. My suggestion: offer it.
- **D3 (item 19):** passkeys now or later. My suggestion: later, after A and B.

## Suggested order

1. A (1–6): broken paths, smallest changes, biggest effect.
2. B (7–16) and D (20).
3. C (17–19).
