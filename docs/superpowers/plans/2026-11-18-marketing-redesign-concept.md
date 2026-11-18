# Marketing page redesign: githubuniverse.com study and NetworkBase concept

Date: 18 Nov 2026. Status: concept and prototype; nothing built in the app.
Builds on the locked grid, sign-in and 404 decisions in `2026-11-18-grid-auth-404-report.md`.

## Part 1. How githubuniverse.com works (measured 18 Nov 2026)

### Structure
One long page, 4,718px at 1024px wide, max width 1600px:

1. Black announcement bar, mono text with an arrow ("Thanks for joining us! Catch up on recorded sessions ↗").
2. Sticky nav built as bordered cells: logo cell, Sessions, Speakers, Explore, Sponsors, FAQs, More, Sign in, and a solid green "Watch now ↗" cell at the far right.
3. Giant wordmark "UNIVERSE'26" across the full width.
4. Hero, split in two bordered columns: left a mono eyebrow (`october 28–29 ■`) and a huge kebab-case headline with a trailing slash (`thanks-for-joining-us/`); right a short paragraph and two full-width stacked buttons.
5. A full-width illustration band (tessellated mascot heads in many colours).
6. Repeating split sections, each with a decoding eyebrow and a kebab headline (`see-you-next-year/`, `Universe-on-the-road/`), photo on one side.
7. `2026-highlights/`: a playlist of filename-style rows (`opening_keynote.mp4`) beside a big player whose background takes the active item's colour, with Prev / Next.
8. `featured-speakers/`: a borderless grid of greyscale portraits; each has a mono name bar.
9. Footer: the giant wordmark again, copyright, links, social icons.
10. `play_super-mona/`: a pixel game on the grid ("GAME OVER" drawn in cells, score, Play again).

### Visual system
- Ground `#e9edec`, borders 1px `#d2d9d4`, text black, muted `#58635b`, accent green `#08872b` (`#5fed83` on dark).
- Type: Mona Sans (headlines 440 weight, 56px kebab headlines), Mona Sans Mono for eyebrows (16px, 500, uppercase, 2px tracking).
- Layout is a visible table: every section, cell and nav item is boxed by hairlines. Spacing token 1.5rem.
- Buttons: tall blocks, label at the bottom-left, ↗ at the right; primary solid, secondary 5% black with a grey border; 0.2s colour transitions; on hover a hard offset shadow, like a key being lifted.

### Motion
| Moment | What happens | Timing |
|---|---|---|
| Load: wordmark | Letters appear one at a time, each popping from scale 0.5; green bars sweep ahead like a typing cursor; the apostrophe forms from small squares; "26" lands last. | About 1.5s in total |
| Load: eyebrow | Mono text scrambles through random characters and resolves left to right (`acto1TO.` → `octobeR.IV` → `october 28–29`), green square cursor. | About 1s |
| Load: art band | The illustration band slides in from the bottom edge of the hero. | Follows the wordmark |
| Scroll: eyebrows | Each section's eyebrow decodes again when it scrolls into view (`_W/-` → `october 2027`). | On entry |
| Scroll: blocks | Players and cards slide up 120px and fade in. Library presets: fade, slide in each direction, scale in, fill, and reveal-in-up (clip-path). | 0.6s default, 0.7s extended, 0.3s fast; easing `cubic-bezier(.16,1,.3,1)` |
| Scroll: nav | The "Watch now" cell is hidden until you scroll past the hero, then fades in. Borders change colour over 0.4s. | 0.4s |
| Hover: speaker | The name bar fills with a colour and an expand icon fades in. | 0.2s |
| Hover: buttons | Background and border change; hard offset shadow appears. | 0.2s |
| Pointer | The pixel cursor trail (40 blocks, 100–400ms, random colours and marks). | Continuous |
| Reduced motion | All transitions and animations are turned off globally. | — |

### What to borrow, and what stays GitHub's
Borrow the techniques: an orchestrated load sequence, decoding eyebrows, the bordered-cell layout, tall arrow buttons, scroll reveals on one easing curve, a playlist with a colour-changing stage, a nav call to action that appears after the hero, pixel lettering, a reduced-motion switch.
Do not copy their identity: the kebab-case slash headlines, the "UNIVERSE'26" wordmark and its apostrophe, the mascot band, the green, Mona Sans, the game.

## Part 2. The NetworkBase concept

### Principles
1. **Built from our own parts.** The 16px grid, the pixel trail with real `nb` commands, the six colours, the serif headline, the mono path line with the clay cursor, the button ring, the pixel letters.
2. **One easing, three durations.** `cubic-bezier(.16,1,.3,1)` at 0.6s, 0.9s for large moves, 0.3s for hovers.
3. **The page is complete at rest.** Everything in the first screen plays once on load; below the fold reveals on scroll; reduced motion shows the final state.
4. **Real content only.** Copy from today's home page; example profiles are labelled as examples; CLI commands are real.

### Visual system
- Paper `#FAF8F4` ground with the 16px grid; hairline borders `#DBD5C8` box every section and cell, like a ledger.
- Ink `#141A1E` bands for contrast moments (announcement bar, terminal, process, footer).
- Instrument Sans for the giant wordmark and section titles (tight, -0.04em); Instrument Serif for editorial lines (the locked headline voice); JetBrains Mono uppercase for eyebrows and path lines.
- Buttons: tall bordered blocks with the label bottom-left and ↗ at the right (the GitHub technique) in clay and paper; main buttons snapped to the grid with the pixel ring.

### Page, top to bottom
1. **Announcement bar** (ink): `CLI 2.6.3 · switch to a branch you've used before, even offline ↗` (real release note).
2. **Nav** as bordered cells: logo, How it works, People, Workspace, Classes, Terminal; right: Sign in and a clay "Get started" cell that fades in once the hero buttons scroll away. Collapses to logo, Get started and a Menu button on phones.
3. **Hero wordmark** "NetworkBase" across the full width, typed letter by letter with a clay block cursor; when the last letter lands the cursor shrinks into the brand square.
4. **Hero split**: left the decoding eyebrow `A PLACE FOR PEOPLE WHO BUILD` and the serif headline "Find your people. Build something together."; right the paragraph and two tall buttons, Get started and See how it works.
5. **Pixel people band**: a full-width band of small pixel people in the six colours, drifting slowly; people near the pointer lift and pop; reduced motion freezes it.
6. **How it works**: three bordered cells (01 Discover, 02 Connect, 03 Build) with pixel icons, titles, the real copy and arrow links.
7. **People**: the real heading and list on the left; example profile cards on the right in bordered cells, labelled "Example profiles"; hover fills the name bar with a colour.
8. **Inside a workspace** (the centrepiece, after GitHub's playlist): a list of the eight modules on the left with a progress bar on the active one, auto-advancing every 5s, pausing on hover; on the right a stage whose colour follows the module and shows a small mock of it (tasks board, document, files, updates, messages, dashboard, roles, editor sync). Prev and Next.
9. **Classes and teams**: three bordered steps and Create an organization.
10. **Terminal** (ink): "Work from your terminal too." A session types itself line by line when it scrolls into view: install, `nb login`, `nb init`, `nb status`, `nb next`, with outputs marked as examples, and a copy button for the install line.
11. **Process** (ink grid): "Make room for your next idea." with the four real steps.
12. **Trust**: three bordered cells (visibility, two-step, your data).
13. **Final call**: serif "Your work says more when you build it together." with Get started and Sign in.
14. **Footer**: a giant pixel "NETWORKBASE" in grid cells that reacts to the pointer like the sign-in word, then links and legal.

### Load sequence (first screen)
| Time | Element | Motion |
|---|---|---|
| 0ms | Announcement bar, nav | Fade in, slide down 12px, 0.6s |
| 150ms | Wordmark | Letters pop in 55ms apart behind a clay cursor; the cursor becomes the brand square |
| 800ms | Eyebrow | Decodes over 0.9s |
| 950ms | Headline | Clip-path reveal upward, 0.9s |
| 1100ms | Paragraph, buttons | Fade and slide up, 80ms apart |
| 1250ms | Pixel band | Wipes in column by column from the left, then drifts |

### Scroll behaviour
Sections reveal once at 15% visibility (fade, 24px slide up, 0.6s, children 80ms apart); eyebrows decode on entry; the terminal types on entry; the nav call to action appears after the hero; the playlist only auto-advances while visible.

### Accessibility and performance
Real headings and text stay in the DOM; all pixel art is decorative and hidden from screen readers; every animation respects reduced motion; canvases pause off screen; no libraries.

### Open questions for the build
- Nav anchors: keep Classes and add Terminal, or keep today's four.
- The terminal outputs are examples; decide whether to show real sample output from the CLI.
- The pixel people band could later use real (opt-in) public profiles.

## Part 3. Round two (18 Nov 2026, approved by the user)

### Hero buttons, made ours
The first prototype copied githubuniverse.com's tall stacked arrow blocks. Replaced with our own: side-by-side buttons snapped to the 16px grid (3 cells tall, whole-cell width), the pixel ring with random colours and marks on "Get started", "See how it works" as an outline button, 3 cells of space around both, and a mono hint underneath, `$ nb login · prefer the terminal?`, linking to the terminal section.

### Eight additions
1. **Wordmark you can play with.** Letters within 240px of the pointer lean away (up to 9° and 7% up). A click makes the orange cursor grow back, hop to the start (FLIP, 0.52s arc) and retype the word. On load the cursor now travels with the letters.
2. **Release-notes ticker.** An ink strip between the workspace tour and Classes: six real CLI release notes (2.6.3, 2.6.2, 2.6.1, 2.6.0, 2.2, 2.1) with version chips, looping at 40px/s, paused on hover or focus; with reduced motion it is a still, scrollable row.
3. **Pixel people say hi.** Clicking a figure lifts it, holds the band still and shows a speech bubble with a real catalog skill ("Hi! I know Flutter.") and a link to find people with it. Closes after 4.5s or on the next click.
4. **Workspace tour, deeper.** Deep links (`#workspace-files` opens and scrolls to Files; choosing a tool updates the address), swipe left or right on the stage on touch screens, arrow keys, Home and End across the list and on the stage, one tab stop for the list.
5. **Section counter in the nav.** `04 / 08 · WORKSPACE` in mono, decoding as you move between the eight sections (Start, How it works, People, Workspace, Classes, Terminal, Get going, Join). Hidden on phones and where the nav links need the room.
6. **Phone call-to-action bar.** On phones a slim bar with Get started and Sign in slides up once the hero buttons scroll away, hides at the closing section and while the menu is open; the nav's Get started is hidden on phones so it never appears twice.
7. **Skip link and share image.** "Skip to content" appears on keyboard focus. A 1200×630 share image (ink, 16px grid, pixel NETWORKBASE with the orange full stop, the serif headline, a trail of marks, networkbase.in) opens from "Share image" in the footer; the build ships it as a static file in the Open Graph tags.
8. **Example open roles.** Three role rows under the example profiles, clearly labelled "Example open roles · in the app these come from public workspaces". Real data only when it exists and people opt in.
