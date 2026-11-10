# Sign-in "Welcome back" animation: concept report

Status: **built on local main on 2026-11-09, not pushed.** Section 12 lists what was built, what differs from this plan, and the measured numbers.
Date: 2026-11-09. Everything below was discussed and approved in this session, including the 9 behaviour improvements (section 5) and the 24 animation enhancements (section 6: items 1 to 13, then 14 to 24 from the second round). Two animated comparisons (onboarding today, sign-in full, sign-in light, and the report version against the new ideas in light and dark) were shown in the session; they are visual aids, not code in the repo.

---

## 1. The concept in one paragraph

When a person who already has an account signs out and later signs in again, the same welcome animation that closes onboarding plays once sign-in is complete. Their photo steps forward, two short lines appear, then the photo travels to its exact slot in the top bar while the app fades in underneath. Only the words change.

**Onboarding is not touched.** Its animation, wording, timing, tests and behaviour stay exactly as they are today. The sign-in version is a second, separate way to start the same overlay.

---

## 2. Agreed wording

| | Onboarding (unchanged) | Sign-in (new) |
|---|---|---|
| Line 1 | Your presence is activated | **Welcome back** |
| Line 2 | Welcome to NetworkBase, Ada Lovelace! | **Good to see you again, Ada** |

Rules for the new lines:
- Line 2 uses the **first name only**.
- **No exclamation mark.** The terminology check counts strings ending in "!", so avoiding it keeps the baseline clean and matches the quieter tone of a return.
- If the profile has not loaded yet, line 2 falls back to "Good to see you again" with no name, and the photo shows initials.

---

## 3. What already exists and gets reused

The onboarding flight (committed as 393264591) is already built from the real app parts: the real `UserAvatar` (rounded-square tile), the real four-ring `PresenceBadge`, the app's tokens and fonts.

- `src/lib/onboarding/welcome-flight.ts`: pure planning logic (timings, centre and landing boxes, phone sizes).
- `src/components/onboarding/WelcomeFlight.tsx`: a small store plus `WelcomeFlightHost`, mounted once in the root document (`src/app/root-document.tsx`), so it survives navigation between the onboarding, auth and main route groups.
- `src/components/onboarding/WelcomeFlightOverlay.tsx`: the full-screen overlay that runs the steps.
- `TopNav.tsx` carries `data-welcome-slot` (desktop avatar) and `data-welcome-slot-mobile` (menu button), which is where the photo lands.
- `globals.css` holds the hold and reveal rules for the page underneath, including reduced-motion rules.
- Skip (click, Esc or Enter), a 14-second watchdog that falls back to a normal page load, and a screen-reader live region already exist.

The sign-in version calls into this through a separate entry point with different copy and different step choices. It does not edit the onboarding call path.

---

## 4. How it works

### 4.1 When it plays
- Only after a **deliberate sign-in**. A marker is set when sign-in starts and consumed once on arrival, so a page refresh, a new tab, a token refresh or the back button never replays it.
- The same applies whichever way the person signs in:
  - **Password:** `LoginForm` ends with `router.replace(...)`, an in-app move.
  - **Two-step code (authenticator) and email code:** these end with `window.location.replace(...)`, a full page load.
  - **Google and GitHub:** these end through `/auth/callback`, a full page redirect.
- Because some endings reload the page, the marker has to survive a full load (short-lived, consumed once).

### 4.2 The sequence
1. Sign-in completes; the marker is consumed.
2. The photo **fades in at the centre**, since the sign-in page has no photo to step forward from.
3. Presence step (public and connections-only profiles): "Welcome back", with the real badge settling.
4. Second line: "Good to see you again, Ada".
5. The photo flies to the exact avatar slot (desktop) or tucks into the menu button (phone) while the app reveals.
6. Overlay removed, focus placed on the main content.

### 4.3 Private profiles
The presence step is skipped for people whose visibility is private (as in onboarding). The top bar still shows their own quiet badge on arrival, so the landing carries it.

### 4.4 Reduced motion
Fade-swap instead of a flight, as in onboarding.

---

## 5. Improvements (all approved)

### Recommended (included in the build)
1. **A shorter replay.** The first sign-in of the day on a device plays the full animation. Later ones play a light version of about 1.3 to 1.5 seconds: "Welcome back" and the photo flying to the top bar (motion details in section 6).
2. **A setting to turn it off.** Settings, Appearance: "Show the welcome animation when I sign in". People who dislike it should not have to press Esc every time.
3. **No tooltip.** Skip "You're active now". It teaches something new in onboarding; returning people already know.
4. **Deep links get the light version.** If someone signs in to reach a specific page (an invite, a workspace or project link), the full animation would delay what they came for. They get the short version.
5. **Focus after the animation.** When the overlay closes, focus moves to the main content so keyboard and screen-reader users are not left on a control that no longer exists.
6. **Only the tab that signed in plays it.** Other tabs of the same account will see the sign-in event but must not each start an animation.
7. **Play once, never on refresh.** The marker is consumed when the animation starts, so a refresh or back press mid-animation cannot replay it.
8. **Record skipped and completed.** Counting skips shows whether it is annoying. Event names are separate from onboarding's.
9. **Tests for both kinds of sign-in ending.** An in-app move (password) and a full page load (two-step code, Google, GitHub) must both land the photo on the avatar.

### Possible later (not in this build)
- **A "new device" note on line 2**, for example "Signed in from a new device. Not you?". Useful for security, but it needs a sign-in history that does not exist yet.

### Advised against
- **A time-of-day greeting** ("Good morning"). It needs the person's time zone and gets awkward across cultures.
- **A personal summary on the screen** ("3 things need you"). It risks showing private information on a screen someone else might see, and it slows the quick path into the app.

---

## 6. Animation design (24 enhancements, all approved)

All of these apply to the sign-in entry only. Onboarding keeps its current timings and motion: the sign-in entry passes in its own settings, and the shared defaults are not edited.

### 6.1 The three versions side by side

| | Onboarding today (unchanged) | Sign-in, full | Sign-in, light |
|---|---|---|---|
| When | After the last onboarding step | First sign-in of the day on a device, no deep link | Later sign-ins that day, or a deep link |
| Photo starts | From the finish screen avatar | Rises from the sign-in form (password), or fades in at the centre (after a page reload) | Same two starts, but moves on at once |
| Stop at the centre | Yes | Yes, shorter | None; one continuous move |
| Step forward / rise | 850 ms | about 650 ms (form) or 500 ms (fade) | none |
| Presence line | "Your presence is activated", hold 1700 ms | "Welcome back", hold about 1100 ms | "Welcome back" fades in beside the photo while it moves (about 150 to 900 ms) |
| Second line | "Welcome to NetworkBase, Ada Lovelace!", hold 800 ms | "Good to see you again, Ada", hold about 600 ms | none |
| Badge | Gray loader, then settles into Active now, with halo | Short loader, then settles into the saved state | Already at rest in the saved state |
| Flight to the top bar | 1000 ms | 1000 ms | about 1300 ms, includes the whole move |
| Landing pop | Full | Smaller | None |
| Tooltip "You're active now" | Yes, 2400 ms | No | No |
| Page clickable | After the animation | After the animation | From about 0.5 s |
| Total to landing | about 4.4 s | about 3.2 to 3.4 s | about 1.3 to 1.5 s |

The numbers for the two sign-in columns are proposals from the visual; they are final-tuned at build time and checked against the frame-drop measurement (6.2, item 11).

The second-round items (14 to 24, section 6.3) layer on top of this table without changing its timings: the check at the button, the ring wave, the photo-ready step, the rising app and the name-last reveal are all inside the totals shown, and the button check adds at most about 0.2 s before the photo leaves.

### 6.2 The first 13 enhancements

**Changes you see**
1. **Start from the sign-in form, not from nothing.** After a password sign-in the form card softens and shrinks away while the photo rises from where the card was. After a full page load (two-step code, Google, GitHub) there is nothing to continue from, so it falls back to a fade-in at the centre.
2. **Show the real status on the badge.** Onboarding always settles into Active now. A returning person may have set another state, so the ring hue settles into their saved state (Active now green, Active today blue, Active this week amber, offline gray). The animation then matches the badge they land on in the top bar.
3. **No stop at the centre in the light version.** One continuous curve; "Welcome back" fades in beside the photo while it moves. The photo never stops.
4. **The app is usable before the animation ends (light version).** The scrim and the click-blocking layer go away as soon as the photo leaves the centre, around 0.5 seconds. The photo finishes landing on top of a working page.
5. **A tighter full version.** Holds are trimmed for people who have seen it before: presence step 1.7 s to about 1.1 s, welcome line 0.8 s to about 0.6 s. Full version about 3.2 to 3.4 s against about 4.4 s.
6. **A smaller landing pop.** Quieter in the full version, none in the light version.

**Smoothness and robustness**
7. **No flash on full page loads.** After two-step, Google and GitHub sign-in the whole page reloads, and without care the sign-in page or the app would paint before the overlay mounts. The hold state is set before the first paint, from the same short-lived sign-in marker. The existing 14-second watchdog still releases the hold if anything goes wrong.
8. **Don't land on an empty page.** The reveal waits, up to a cap of about 1.5 seconds, until the destination has its first real content, so the photo doesn't arrive onto a skeleton screen. If the cap is hit it reveals anyway.
9. **Phone keyboard.** After a password sign-in the keyboard is often still open. Close it when the flight starts and measure the screen after it settles; otherwise the centre point and the landing point jump mid-animation. The same applies to mobile Safari's collapsing toolbar: the centre and landing positions are read from the current screen at flight start.
10. **Long names and right-to-left.** "Good to see you again, Ada" must wrap or shorten cleanly for a long first name and never run off the screen. Right-to-left languages mirror correctly; the landing point is read from the real avatar slot, so it follows the layout.
11. **Measure frame drops, not just time.** The photo animates position and size, which is cheap for one small element, but it runs while the destination page loads. Test on a throttled CPU before and after, with the project's benchmark step. Switch to a transform-based version only if real frames are dropped; it has a cost (corner rounding and initials scale awkwardly), so it is not free.
12. **Reduced motion.** Keep the fade-swap, shortened to about 0.8 seconds for sign-in, with the two lines still readable.

**Later, approved but sequenced after the sign-in animation is seen live**
13. **A matching sign-out animation.** The photo shrinks out of the top bar as the app closes. It adds a second animation to build, test and maintain, so it is built after the sign-in version has been seen live. Rules for it when built: the sign-out itself is never delayed or blocked by the animation (the session ends immediately and the animation is cosmetic over the navigation); it is skippable; it respects reduced motion and the same on/off setting. Its wording, if any, is to be agreed before it is built.

### 6.3 Second round: 11 more enhancements (14 to 24, all approved)

Same rule as before: sign-in entry only, onboarding is not touched.

**Seen in the animation**
14. **Cause and effect at sign-in.** The moment sign-in is accepted, the Sign in button turns into a check (about 0.2 s), and the photo leaves that button instead of appearing from nowhere. Applies to the password path, where the form is on screen; after a page reload there is no button, so it uses the centre fade.
15. **Rings wake in a wave, not a spinner.** A returning person's status is already known, so no loader is shown. The four rings colour in from the inside out into the saved state (the same inner-to-outer order the real badge uses when it changes), with a small pop and, for Active now, the halo. The loader (gray arcs turning) is used only if the status really has not loaded yet.
16. **The photo is ready before it flies.** The profile picture is loaded and decoded while the credentials are being checked, so it is in place before the flight. Without this, the initials show first and the photo pops in halfway through. If the photo is genuinely late, a 200 ms crossfade is used and never a pop-in mid-flight.
17. **The app arrives instead of just appearing.** The header and main content rise about 8 px as they fade in, on the existing stagger (sidebar, then header, then main). Off for reduced motion.
18. **The name arrives last.** In the full version only, "Good to see you again" fades in word by word (about 60 ms apart) and "Ada" lands last. Small and easy to drop if it feels like too much.
19. **Dark theme and accent colours checked.** The flight, the scrim, the ring colours and the tile tone are verified in dark mode and in each accent colour. The ring and tile colours come from the existing tokens, so they follow the theme; this item is a check plus fixes for anything that does not.
20. **The landing slot is followed if it moves.** The landing point is re-read during the flight, so a window resize, a sidebar collapse or a layout shift mid-flight still lands exactly on the avatar. The old behaviour would land beside the slot and then jump.

**Behind the scenes**
21. **Full or light depends on how long you were away.** Today's rule is the first sign-in of the day on a device. Better: use the account's last-active time, so it also works across devices and after cleared browser storage. Needs a last-active value that already exists; if it does not, the per-device rule stays.
22. **Nothing runs unseen.** If the tab is hidden when sign-in completes, or becomes hidden mid-flight, jump to the landed state instead of running with nobody watching or replaying when the person returns.
23. **Hide the wait.** When credentials are accepted, start loading the destination page and its first data, so the load overlaps the form shrink. If the page is slow, the photo stays in place with the rings still turning, never a frozen pause (up to the cap in item 8). The "Click or press Esc to skip" hint shows only in the full version, after about 1.2 seconds, and never in the light version.
24. **One spoken line for screen readers.** Announce a single "Welcome back, Ada" once; do not read both visual lines, and do not announce the ring states.

### 6.4 Things that stay out of the animation
- **Sound.** Unexpected in a work tool and one more thing to mute.
- **Confetti or any celebratory effect.** A return should feel calm, not like an achievement.

---

## 7. Risks and how each is handled

| Risk | Handling |
|---|---|
| Soft vs hard sign-in endings (password is an in-app move; codes and OAuth reload the page) | Marker survives a full load; both endings are tested |
| Profile not loaded when the animation starts | Fall back to initials and no name on line 2 |
| Destination has no top bar (some pages, deep links) | Fade out instead of flying; deep links use the light version anyway |
| Slow network or slow destination page | Existing slot wait, bail-out and 14-second watchdog; falls back to a normal page load |
| Changing shared overlay code could disturb onboarding | Separate entry point; existing onboarding tests (unit, contract, browser) run as the guard |
| Replaying on refresh, new tab or token refresh | Marker is short-lived and consumed once; only the signing-in tab plays |
| Several tabs signed into the same account | Only the tab that signed in plays it |
| Switching accounts | The marker is tied to the signing-in session, so the new person gets their own animation, not the previous person's |
| Terminology baseline | New lines contain no "!" so the exclamation rule is not triggered |
| Sign-in page or app flashes before the overlay on full page loads | Hold state set before first paint (6.2, item 7) |
| Photo lands on a skeleton screen | Reveal waits for first content, capped at about 1.5 s (item 8) |
| Phone keyboard or collapsing toolbar shifts the screen mid-flight | Close the keyboard, read the screen at flight start (item 9) |
| Animation drops frames while the destination page loads | Measure on a throttled CPU before and after; change technique only if frames drop (item 11) |
| Long first names or right-to-left layouts break the second line | Wrap or shorten; landing read from the real avatar slot (item 10) |
| Sign-out animation delays or blocks signing out | The session ends first; the animation is cosmetic and skippable (item 13) |
| The photo pops in over the initials mid-flight | Photo loaded and decoded while credentials are checked; 200 ms crossfade only if genuinely late (item 16) |
| The avatar slot moves during the flight (resize, sidebar collapse) | Landing target re-read during the flight (item 20) |
| No last-active value exists to base full vs light on | Keep the per-device, per-day rule (item 21) |
| Tab hidden when sign-in completes, or hidden mid-flight | Jump to the landed state (item 22) |
| Early page loading competes with the animation for the main thread | Covered by the throttled-CPU frame-drop measurement (item 11) |
| Name-last reveal or button check feels like too much | Both are small and independent; either can be dropped without touching the rest (items 14, 18) |

---

## 8. Open decisions for the build

These do not block approval but need a default when building:
1. **Where the "light version" memory lives.** Proposed: a per-device, per-day record in browser storage, wrapped in try/catch because storage can be blocked. Worst case the full version replays.
2. **Where the on/off setting is stored.** Proposed: with the other Appearance preferences so it follows the account across devices. To confirm against how Appearance syncs today.
3. **Where the skipped/completed events are written.** Onboarding events go to the onboarding events table. Sign-in events either reuse it with new event types or get their own place. If the server action changes, an impact-review record under `standards/impact-reviews/` is required.
4. **How "deep link" is detected.** Proposed: any redirect target other than the default landing page.
5. **How the hold survives to first paint (item 7).** Either the short-lived marker is a cookie the server can read, or an early inline script reads browser storage. To choose at build time; the cookie option avoids inline script.
6. **What counts as "first content" (item 8).** Proposed: a ready marker set by the destination's first real content, with the 1.5 s cap as the fallback.
7. **Reduced motion wording (item 12).** About 0.8 s fits one line comfortably and two lines tightly. Proposed: both lines, each shown briefly; confirm after seeing it.
8. **Sign-out animation wording (item 13).** None agreed yet. Decide before it is built.
9. **Is there a last-active value to use (item 21)?** To confirm against the code at build time. If not, the per-device rule stays and item 21 is skipped.
10. **How the destination is warmed early (item 23).** Proposed: prefetch the landing route and its first data when credentials are accepted. To confirm what the sign-in code already prefetches.
11. **Which accent colours to check (item 19).** Proposed: every accent offered in Settings, Appearance, in light and dark.

---

## 9. Test plan

- **Unit:** the plan for full vs light timings; wording; first-name extraction; marker consumed once.
- **Contract:** the sign-in entry point exists, onboarding wording and call path are unchanged, no "!" in the new copy.
- **Browser (reusing the existing harness):**
  - in-app sign-in ending lands the photo on the avatar slot;
  - full-page-load ending does the same;
  - private profile has no presence step;
  - light version on the second sign-in of the day;
  - setting off means no animation;
  - deep link means the light version;
  - skip by click and Esc;
  - reduced motion;
  - phone width;
  - screen reader announcement;
  - focus lands on the main content afterwards;
  - refresh mid-animation does not replay;
  - photo rises from the form after a password sign-in, fades in at the centre after a page reload (items 1, 7);
  - badge hue follows the saved state: Active now, today, this week (item 2);
  - light version has no centre stop and the page accepts a click before the animation ends (items 3, 4);
  - no tooltip and a smaller pop in the full version (items 5, 6);
  - no frame of the sign-in page or the app shows before the overlay after a full page load (item 7);
  - the reveal waits for first content, and reveals anyway at the cap (item 8);
  - phone width with the keyboard open: centre and landing are correct (item 9);
  - a very long first name wraps and stays on screen; right-to-left lands on the real avatar slot (item 10);
  - frame-drop measurement on a throttled CPU, before and after (item 11);
  - reduced motion at about 0.8 s (item 12).
- **Second-round items (14 to 24):**
  - the button turns to a check and the photo leaves it after a password sign-in; the centre fade is used after a reload (item 14);
  - the rings colour in a wave with no loader when the status is known; the loader appears only when it is not (item 15);
  - the photo is in place before the flight; a late photo crossfades and never pops (item 16);
  - the header and main rise and fade in; no rise under reduced motion (item 17);
  - the name appears last in the full version (item 18);
  - the flight, scrim, rings and tile checked in dark mode and in each accent colour (item 19);
  - the slot moves mid-flight and the photo still lands exactly on it (item 20);
  - full vs light follows last-active time when available (item 21);
  - a hidden tab jumps to the landed state (item 22);
  - a slow destination keeps the rings turning, and the skip hint appears only in the full version after about 1.2 s (item 23);
  - screen readers hear one "Welcome back, Ada" and no ring states (item 24).
- **Sign-out animation (item 13), when built:** sign-out completes even if the animation is skipped or fails; reduced motion; same setting.
- **Guard:** the full existing onboarding welcome-flight specs must still pass unchanged.

---

## 10. What is out of scope

- Any change to onboarding's animation, words, timing or flow.
- Any push, deployment or database change. Everything would be committed locally on `main` only.
- A new-device note, a time-of-day greeting and an on-screen summary (see section 5).
- Sound and celebratory effects (see 6.3).
- The sign-out animation (item 13) is approved but built after the sign-in version has been seen live, not in the first build.

---

## 11. Next step

Say **"implement"** and the build starts from this report. Until then nothing is changed in the code.

---

## 12. What was built (2026-11-09)

### Files
- `src/lib/auth/signin-flight.ts`: the plan (marker, full or light, wording, timings, curtain script). Pure and unit tested.
- `src/components/auth/SignInFlight.tsx`: the host in the root document, the arrival check, and the profile read.
- `src/components/auth/SignInFlightOverlay.tsx`: the animation.
- `src/app/actions/signin-flight.ts`: the three events, in `onboarding_events` under `signin_flight_*`.
- Wiring: `root-document.tsx` (host and head script), `LoginForm.tsx` (marker, check, flight start), `AuthShell.tsx` (Google and GitHub marker), `GoogleOneTap.tsx`, `globals.css` (curtain and rise).
- Setting: `appearance.ts`, `theme-provider.tsx`, `AppearanceSettings.tsx` (Settings, Appearance, "Welcome animation").
- Onboarding's flight files are not changed; a contract test pins that.

### Built as planned
Section 5 (all nine) and items 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14, 16, 17, 18, 19, 20, 22, 23 and 24.

### Where it differs from this plan
- **Item 2 (saved state on the badge).** The top-bar badge is passed `live`, so for a person who has just signed in it always reads Active now. The flight therefore shows Active now plus the person's own status emoji (read the same way the top bar reads it). The blue and amber states cannot occur for yourself.
- **Item 15 (ring wave).** Built with the real badge: it starts gray and becomes Active now, which plays the badge's own inner-to-outer change (about 1.4 s, then the halo). That runs across both lines, so the holds stay at 1.1 s and 0.6 s. The gray turning loader appears only when the next page is slow (item 23).
- **Item 17 (rise).** The header and main both rise 8 px. The landing place is read as if the header's rise had already finished, so the photo aims at the final place.
- **Item 21 (last-active time).** Not built. The rule stays per device and per day. Cross-device needs the account's last-active time read before the app's own heartbeat overwrites it; there is a `ponytail:` note where it would go.
- **Item 13 (sign-out animation).** Not built, as agreed: it comes after the sign-in version has been seen live.
- **The setting across devices.** The switch is read from this device's copy before anything loads (so the curtain stays down), and from the account while the picture loads, so a device that has never seen the setting still respects it.
- **Photo wait.** The button check lasts until the picture and name are loaded (up to 2.5 s, then the plain move), not a fixed 0.2 s. Typical: about 0.3 s.

### Open decisions, as resolved
- Marker (5): this tab's session storage, plus an inline script in the head. No cookie.
- First content (6): the next page has a main area with no placeholder (`.nb-skeleton`) left in it.
- Reduced motion (7): both lines, about 0.9 s.
- Early load (10): the next page is prefetched the moment the sign-in is accepted; the flight hands over to it after the form has shrunk.
- Accents (11): all six, light and dark, tested.

### Measured (Chromium, this machine)
- Full version: about 3.4 s of movement from the photo's first frame to landing, about 3.9 s with the check and the photo load.
- Light version: 1.3 s of movement; about 1.8 to 2.1 s from the sign-in button, because the next page has to arrive first (the test router adds 0.3 s).
- Frame drops at 4 times slower than this machine: 254 frames, 95th percentile 18 ms, worst 117 ms, one frame over 100 ms. No change of technique was needed (item 11).

### Tests
- `tests/unit/signin-flight.test.ts` (15) and `tests/unit/signin-flight-contract.test.ts` (10).
- `tests/browser/signin-flight.spec.ts` (29), on the real sign-in form, the real overlay and the real app shell; the same fixture pattern as onboarding's.
- Onboarding's `welcome-flight.spec.ts` (10) is the guard. Its fixture had been failing because the app shell now needs a tooltip provider; the fixture was fixed, the flight was not touched.

### Fix after first live use (2026-11-09)
Reported: after signing in, Discover showed first and the animation covered it afterwards. Causes found:
- **The curtain depended on the stylesheet.** The rule that covers the page lived in `globals.css`; the running dev server was serving a stale stylesheet without it, so nothing covered Discover while the flight loaded. My browser test only checked the sidebar's opacity and never saw it. The curtain now carries its own style with the head script (and the test checks that a fixed, opaque layer really covers the page).
- **A late animation was possible.** If the page was already showing when the flight started (any fallback, or a curtain that had lifted), the flight played over it. Now a flight over an arrival page starts only if the page was covered from its first paint; otherwise the marker is dropped and there is no animation. The sign-in form's fallback to the plain move also clears the marker and logs why (`auth.signin_flight.plain_move`).
- **Sign-out wiped the "played today" record**, so every sign-in was the full version. It is now kept across sign-out.
- The curtain's self-lift is 20 s (was 9 s), so a cold development start cannot lift it before the page can.
- The CSS (rise, reduced motion) still lives in `globals.css`; a dev server that is not picking up stylesheet changes needs a restart.

### Timing, after the second live check (2026-11-10)
Reported: too fast, the words and the photo. Measured on Chromium: in the full version line 2 stayed on screen only about 0.4 s, and in the light version the photo moved off at once (1.5 s up in all, the greeting about 1 s). Lengthened to what a person can read:
- **Full:** about 5 s of motion (photo rises 0.75 s, line 1 held 1.5 s, line 2 held 1.6 s, flight 1.1 s). Measured: line 1 on screen 1.46 s, line 2 1.44 s.
- **Light:** about 2.6 s (the photo and "Welcome back" rest in place 0.9 s, then a 1.7 s move). Measured: photo on screen 2.4 s, greeting 1.5 s. This replaces "one continuous move, no stop" from items 3 and 5: a short rest at the start was needed for the greeting to be seen.
- The photo fades in over 0.4 to 0.6 s (was 0.25 to 0.5 s), line 1 fades in over 0.4 s, and each word of line 2 over 0.35 s.
The timings table in section 6.1 above is superseded by these numbers.

### Pace, after the third live check (2026-11-10)
Reported: now too slow; it should match onboarding. The full version now uses onboarding's exact timings (photo 0.85 s, line 1 held 1.7 s, line 2 held 0.8 s, flight 1.0 s, about 4.4 s) and line 2 fades in whole, like onboarding's welcome line. The word-by-word reveal (enhancement 18) is removed: it cannot fit that pace. The light version keeps its short rest (0.7 s) and moves at onboarding's flight speed (1.0 s), about 1.7 s in all. The two earlier timing notes above are superseded.

### Social login and the light version (2026-11-10)
Reported: after Google or GitHub the screen stayed blank and Discover came with no animation; on a password sign-in (light version) the photo sat at the button while the greeting was centred.
- **Social login:** the flight read who you are from the browser's own session. After a Google or GitHub return the sign-in is completed on the server and the browser has no session yet (AuthProvider copies it later), so it found nobody, skipped, and lifted the cover. Now it reads the cookie-based `/api/v1/me` (which also returns the profile visibility), so every way in works. A skip logs why (`auth.signin_flight.no_identity`, `auth.signin_flight.arrival_skipped`). Evidence: the 6:23 PM Google sign-in left no flight event; the password ones did.
- **Light version:** now rises to the middle with the greeting directly under it (same layout as the full version), the greeting leaves as the app comes in, then one move to the avatar. About 2.6 s (rise 0.6, greeting 1.0, move 1.0). The timer-based reveal that left the greeting over the app is gone.
- Tests: arrival with no browser session; both layouts; the greeting never shown over the revealed app.

