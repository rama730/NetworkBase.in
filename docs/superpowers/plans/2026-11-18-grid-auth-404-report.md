# Grid, sign-in pages and 404: locked decisions

Date: 18 Nov 2026. Status: designed and approved in the prototype; nothing built in the app yet.
Prototype: https://claude.ai/artifact/KXmgYA14cAFvCiQ7t2qFnm (Grid Trail v4, version 12).
Build only on the word "implement".

This report records every decision from the grid, sign-in and 404 design rounds, in the order they were made, and what was tried and dropped along the way, so the build follows the final state and not an earlier one.

## 1. The grid ground

| Decision | Locked value |
|---|---|
| Cell size | **16px** everywhere (was 24px). 10px and 8px were tried and dropped. |
| Lines | Hero grids 11% ink on light, 8% white on dark and on the ink panel 9%. Subtle grids 6% light, 5% dark. |
| Whole cells | Each grid is trimmed to whole cells and centered, with a closing line on the right and bottom. No half-cells at edges. |
| Edge fade | Lines fade toward each edge (radial mask, 85% × 90%, solid to 55%). |
| Spotlight | **Removed.** The orange lines that lit up near the cursor were dropped by the user. |
| Layers | Lines on a `::before` layer sized to whole cells, under one `<canvas>` per grid, under content. |
| Sharpness | Pixel edges snap to device pixels; canvas DPR capped at 2. |

## 2. The cursor trail (pixel style, modelled on githubuniverse.com)

Measured on githubuniverse.com (18 Nov 2026): a pool of 40 DOM blocks, cell = section width ÷ 94 columns, a block only where a mouse event lands (no filling between, so fast moves look broken), random life 100–400 ms, shrink-out 100 ms on `cubic-bezier(.3,.41,.04,1.01)`, six colours, black marks `- / ) . + = > < * & (` with 30% blank, skips links, buttons, fields and text.

| Decision | Locked value |
|---|---|
| Pixel shape | Fills the whole cell between the lines, sharp corners, no inset or rounding (v3's rounded dots dropped). |
| Spawn | Only where a pointer event lands ("Broken"). "Solid line" exists only as a comparison toggle. |
| Life | Random 100–400 ms (Subtle 80–260 ms), 100 ms pop in, 100 ms shrink out, same curve. |
| Pool | 40 on Hero grids, 14 on Subtle grids; oldest goes first. |
| Colours | **Random per pixel** from six: clay `#D14E24`, sand `#EDBF85`, blue `#2563C9`, light blue `#A7C3F0`, green `#2F6B4F`, mint `#99CEAD`. Paired-stroke and orange-only modes were tried and dropped. |
| Strength | Hero 100%, Subtle 45%. |
| Marks inside | A **session script** per grid (`data-trail-script="cmd|cmd"`): about 5 random marks first, then a command typed one character per pixel, then 3–5 random marks, then the next command. Random marks `+ - ~ > / @ # : * .`, 30% blank. Marks are 68% of the cell, JetBrains Mono 600, dark on light pixels and light on dark pixels. |
| Commands | **Only real `nb` CLI commands** (checked against `@networkbase/cli` 2.6.3) or plain words where no command fits. `nb signup`, `nb reset`, `nb verify`, `nb join` and `nb login --email` do not exist and must not appear. |
| Text gap | Pixels keep a one-cell gap from every line of text (measured from the real text lines with `Range.getClientRects`, not boxes), buttons, fields, labels and `[data-trail-ignore]`. |
| Click ripple | Hero grids only: rings of cells out to 7, 45 ms per ring, skipping text. |
| Intro trail | **Removed.** No grid draws a trail on its own. |
| Off | Reduced motion and touch screens: no trail. Off screen: the canvas stops drawing. |

## 3. The button ring (main buttons on Hero grids)

| Decision | Locked value |
|---|---|
| Snapping | Main buttons (`.row.cta .btn.primary`) are exactly 3 cells tall; width rounded up to whole cells; the row is nudged (under half a cell sideways, under one cell down) at layout time so the button's edges sit on grid lines. Never moves on hover. |
| Ring | Exactly one empty cell from the button on all four sides. |
| Colours and marks | Each ring pixel picks a random colour (never the same as its neighbour) and always carries a random mark (no blanks). |
| Spacing rule | A main button keeps space around it: `.row.cta` gap 2.5 cells, 3 cells above. |
| Safety | All or nothing: if any ring cell would touch other text or another control, no ring is drawn. |
| Leaving | The ring runs away cell by cell (4 ms apart). |

## 4. Sign-in pages

Ten screens use the panel (checked in `src/app/(site)/(auth)` and `src/components/auth`): sign in, sign-in code, two-step, sign up, verify email, forgot password, new password (`/reset-password`), terminal (`/device`), editor (`/authorize`), join. The join preview (`/join/[code]`) reuses the join panel; the auth error page has no panel.

| Decision | Locked value |
|---|---|
| Layout | Form left, ink panel right, equal columns in the prototype so the word fits (the app is 9fr/7fr today; decide at build). |
| Panel contents | **Only**: path line, pixel word, headline. Footer `NetworkBase / Build together`. |
| Path line | `networkbase / <route>` in JetBrains Mono with a blinking clay block cursor. |
| Pixel word | 4×5 pixel font (M N T W Y five wide, I three wide), a bit smaller than the first 5×7 version. Words: sign in **HEY** (was BACK), code **CODE**, two-step **SAFE**, sign up **INIT**, verify **MAIL**, forgot **KEYS**, new password **NEW**, terminal **TERM**, editor **SYNC**, join **JOIN**. Paper ink on the ink panel. |
| Orange dot | A 2×2 clay square is the word's full stop and is the only thing that plays on its own: it flies in cell by cell the first time the panel is seen. |
| Word reacts | Pixels within 2.3 cells of the pointer step one cell away (26 ms per step) and take a random colour, then step back. A click scatters the word and it walks home. Pixels never land on cells covered by text. |
| Headline | Exactly as production: Instrument Serif 38px, line height 1.12, max 20ch, the app's own panel titles. |
| Removed | The three numbered points, the checklist, "What's new", the progress track, facts, permissions list, the status line and the command box. |
| Terminal chip | **Sign in only**, bottom-right corner: `$ nb login` with a copy icon. Copy puts `npm i -g @networkbase/cli && nb login` on the clipboard; the icon turns into a check; if the clipboard is blocked the command is selected instead. |
| Form copy | Headings and descriptions match production word for word (LoginForm, SignupForm, forgot, reset, verify, device, authorize, join). Code fields use the spaced, centred mono style of the live join page. |

## 5. 404

| Decision | Locked value |
|---|---|
| One page | One component for `(site)/not-found.tsx` and `global-not-found.tsx`. |
| Back | **One** back control, top-left (the unified back button), next to the logo. The "Go back" button was removed. |
| Path line | `networkbase / <the address that wasn't found>`, shortened in the middle past 44 characters, full path on hover, blinking clay cursor. |
| Pixel 404 | 5×7 font, scale up to 2, centred, in pixel ink (`#374349` light, `#8E9AA1` dark). The cell where the first 4's bar crosses its stem starts empty and the orange piece flies into it; there is no separate full stop. Push and scatter as the sign-in word. |
| Headline | "This page isn't here." Instrument Serif 38px. One muted line: "Check the address, or head back to where you were." |
| Action | One main button, **Go to Discover**, snapped to the grid with the ring. |
| Removed | The `404 / Page unavailable` label. |
| Trail script | `cd ..`, `ls`, `cd ~/discover`. |
| Messages inline 404 | Same voice, smaller: Instrument Serif 28px headline on a Subtle grid, the app's line ("The link may be wrong, or what it pointed to was deleted.") and Back to Messages, with the chat list still beside it. |
| Later, optional | Error pages ("Something went wrong") in the same layout, word OOPS and Try again. |

## 6. Shared tokens

```
--nb-grid-cell: 16px
--nb-grid-line-hero: rgb(33 42 48 / 11%)   dark: rgb(255 255 255 / 8%)
--nb-grid-line-soft: rgb(33 42 48 / 6%)    dark: rgb(255 255 255 / 5%)
--nb-grid-pixel-ink: #374349               dark: #8E9AA1
--nb-grid-word-ink: rgba(250 248 244 / 94%) on the ink panel
colors: #D14E24 #EDBF85 #2563C9 #A7C3F0 #2F6B4F #99CEAD (random per pixel)
hero: pool 40 · life 100–400ms · pop 100ms · ripple · ring
subtle: pool 14 · life 80–260ms · 45% · no ripple or ring
word: 4×5 font (sign-in) or 5×7 (404) · push 2.3 cells · step 26ms
```

Built as one framework-free engine (`attachGridTrail(el, preset)`), switched on with `data-grid-trail` on `.nb-grid-ground`. No new packages.

## 7. Findings along the way

- The prototype's first command box showed commands that do not exist in the CLI; every command is now checked against the CLI source.
- Overlaps found and fixed: two back controls on the 404; the button ring drawn over nearby text and buttons; word pixels pushed or scattered under text; the word drifting off its slot when the panel grew mid-animation.
- Verified in the browser: all ten sign-in screens, the 404 in light, dark and at 375px, both rings. Not verified: a real click copying to the clipboard, and live behaviour on a real touch device.
