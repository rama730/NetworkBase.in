# Sign-in Pages Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the approved sign-in prototype (artifact 99MRvJU75MFy8J2XLCi5BL, version 5) into every account page, without deploying.

**Architecture:** The app's own form stays. AuthShell gains a logo top bar, a decoding mono eyebrow with an optional step counter, an optional pixel status mark, CSS-first load and direction-aware step changes. The ink panel becomes one client component (`AuthPanel`) driven by a shared panel table. The table holds the path line (typed), the pixel word with an outcome override (OK/NO/OLD/HALT), the serif headline, an optional terminal mirror and the `$ nb login` chip. It lazy-loads `src/lib/grid-trail.ts` only at 1024px and up. The pixel spinner and pixel message icons come from one icon module.

**Tech Stack:** Next.js 16.4 App Router, React, Tailwind v4 plus globals.css, node:test unit tests, `next/og` for the join share image.

**Spec:** the prototype (artifact above; its source is in the session scratchpad at auth/signin.src.html) and the memory note project_auth_marketing_style_prototype.

## Global Constraints
- The form follows the app's design specification: existing Input, Button, AuthField, PasswordField, Lucide on controls (eye, copy, external link). Google and GitHub keep their real logos.
- Pixel only for: the spinner, the icons inside messages, status marks, the "who is asking" rows and the "what you approve" ticks. Sizes are 12, 14 (spinner) or 24px only.
- Avatars are square (rounded-md).
- The panel is hidden below 1024px, and the engine is never downloaded there.
- Reduced motion shows final states (no decode, typing, rise or spin).
- Clipboard goes through `copyText` from `@/lib/clipboard`.
- Stage named files only. Branch `signin-redesign` in its own worktree. No push and no deploy until the user says "deploy".

## Review Focus
- Pasting a code while focus is on the email field must not hijack the paste: only paste on a non-input target fills the code.
- A terminal code typed with spaces or lower case (`abcd efgh`) becomes `ABCD-EFGH` and the server still accepts it.
- Switching screens fast (code sent, then back) must not leave the panel path half-typed or the word stuck.
- The resend countdown must announce once at the start and once at the end, never every second.
- A join code whose organization has no image still gets a square pixel mark; one with an image keeps its image.

---

### Task 1: Pixel icons, spinner and code helpers
**Files:** Create `src/lib/pixel-icons.ts`, `src/components/auth/pixel.tsx`, `src/lib/auth/code-format.ts`. Modify `src/app/(site)/page.tsx` (ICONS reuse bitmaps). Test: `tests/unit/auth-pixel-and-codes.test.ts`.
**Produces:**
- `PIXEL_ICONS: Record<PixelIconName, readonly string[]>` (6×6). Names: search, people, blocks, lock, shield, download, check, cross, clock, alert, info, terminal, laptop, pin, arrow, person, bot.
- `PixelIcon({ name, size: 12 | 24, className? })`
- `PixelSpinner()` (14px)
- `formatGroupedCode(raw, { lower?: boolean }): string` (8 chars, dash after 4)
- `formatCountdown(seconds): string` (`m:ss`)
- [ ] Test: every bitmap is 6 rows of 6 `#`/`.` characters. `formatGroupedCode('abcd efgh') === 'ABCD-EFGH'`. `formatGroupedCode('ab12-cd34xyz', { lower: true }) === 'ab12-cd34'`. `formatGroupedCode('ab') === 'AB'`. `formatCountdown(60) === '1:00'`. `formatCountdown(5) === '0:05'`.
- [ ] Implement, then run `node --test` on the file.

### Task 2: Shared panels and the engine replay
**Files:** Create `src/components/auth/auth-panels.ts`. Modify `src/lib/grid-trail.ts` (add `replay()`). Test: the same unit file.
**Produces:** `AUTH_PANELS` with keys signin, code, mfa, signup, verify, recovery, reset, device, editor, join, legal, legalSignup, error. Each entry is `{ eyebrow, title, route, word, script, chip? }`. Also `PanelOutcome = { word: 'OK'|'NO'|'OLD'|'HALT'; title: string }`.
- [ ] Test: every panel word and outcome word draws with `glyph5` (no blank glyph) and `wordWidth(word) <= 24`.

### Task 3: AuthShell and AuthPanel
**Files:** Create `src/components/auth/AuthPanel.tsx`. Modify `src/components/auth/AuthShell.tsx` and `src/app/globals.css` (auth section).
**AuthShell new props:**
- `panel: AuthPanelContent | null`
- `step?: readonly [number, number]`
- `mark?: 'check' | 'cross' | 'clock' | 'alert' | 'shield'`
- `outcome?: PanelOutcome`
- `panelRoute?: string`
- `panelExtra?: ReactNode`

**Other changes:**
- AuthAlert icons become PixelIcon.
- SubmitButton and OAuthButtons use PixelSpinner.
- CodeInput accepts paste anywhere.
- EmailCodeForm countdown reads "Send a new code in m:ss" in mono and announces twice.
- New `PasswordRules({ result })`.
- New `SignedInAs({ email, name?, avatarUrl?, onSwitch })` with a square avatar.

**Check:** browser on a scratch dev server at :3100. Sign-in, sign-up, forgot, join and device (signed out) at 1440 and 375, light and dark.

### Task 4: Every page
**Files:** LoginForm, SignupForm, verify-email, forgot-password, reset-password, device (page + client), authorize client, join pages, legal/accept, (auth)/error.

**Steps:**
- signup 1/2 → 2/2
- recovery 1/3 → 2/3 → 3/3
- device 1/2 → 2/2
- join 1/2 → 2/2
- mfa and code 2/2

**Marks and outcomes:**
- Result screens: check / OK.
- Denied: cross / NO.
- Expired and invalid links: clock / OLD.
- Unverified editor callback: alert / HALT.
- Approve screens: shield.

The device panel shows the terminal mirror with the user code.

### Task 5: Share images
**Files:** `public/og/login-card.png`, `public/og/signup-card.png` (rendered from the panel design), login and signup metadata, and `src/app/api/og/join/[code]/route.tsx` (ImageResponse, `enforceRouteLimit`, org title only). The join metadata points at it.

### Task 6: Verify and commit
- Unit suite, `tsc` (6 GB heap), lint on touched files, clean worktree build.
- Speed before and after on `/login` (JS bytes, LCP).
- ponytail-review, then review.
- Commit on `signin-redesign`. No push.
