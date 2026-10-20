# Presence ring badge: implementation plan

Status: version 1 implemented (commits c861bfb1 and 220e51f0). Iterations 2 and 3 (2026-10-20) implemented on local main, see "Verification of iterations 2 and 3" at the end of this file. Build only when told "implement", on local main.

## Iteration 2 (2026-10-20): full rings, shrink-spin-grow, five improvements

Supersedes version 1 where they differ: the arcs no longer rest as short and long arcs on gray tracks. All designs were approved from mocks.

**Rest state.** Each of the four rings is a full circle in the state hue (green now, blue today, amber week, gray offline), same radii and widths. The gray track stays in the DOM underneath and shows only during a change.

**On a change (one cycle, about 1.7 s).** Per ring, in a 1.44 s window:
1. Shrink (0 to 16% of the window): the full ring pulls back to its signature arcs (ring 1 `212°+251°`; ring 2 `149°+130°`, `44.5°+85°`; ring 3 `3°+142°`; ring 4 `210.5°+71°`, `109.5°+69°`), revealing the gray track.
2. Spin (12% to 80%, 0.98 s): the ring turns one full turn, clockwise when activity rises, counter-clockwise when it drops, easing in-out; the arc color fades to the new hue over the same 0.98 s.
3. Grow (84% to 100%): the arcs extend back into full rings in the new hue.
4. Becoming Active now ends with the single green halo, starting at about 1.65 s.
No cycle on first render or before data has loaded (as version 1). Reduced motion: color fade only (no shrink, spin, grow, pop, ripple or halo).

**The five approved improvements.**
1. Wave follows activity: ring stagger is 0.09 s per ring, inner to outer when activity rises, outer to inner when it drops (`--order` = `i` or `3 - i` on each ring).
2. Settle pop: the badge scales 1 to 1.16 to 1 over 0.22 s as the rings land (starts at about 1.5 s).
3. Weight by state: ring and track stroke width x now 1, today 0.88, week 0.74, offline 0.6 (`--presence-weight` per availability, transitioned with the color), a cue that does not rely on color.
4. Heartbeat ripple: while a badge of 20px or larger shows Active now, each time its presence data refreshes (`usePersonPresence` refetches every 90 s and on live changes) the rings dip to 45% opacity in a wave from inner to outer (1.1 s, 0.14 s stagger). Not for badges under 20px, not for the badge's first load, not under reduced motion.
5. Animation budget: at most 3 badges run a full cycle at once, and only badges on screen (IntersectionObserver). Any other badge that changes does the color and weight fade only, no shrink, spin, grow, pop or halo.

### Iteration 2 files

| File | Change |
|---|---|
| `src/lib/presence/model.ts` | `advanceBadgeSpin(state, availability, animate, full = true)`: when `full` is false the change is recorded but `angle`, `cycle` and `halo` do not move. Add `cycle` to `BadgeSpin` (increments on each full change). Add `ringOrder(index, direction)` (`index` up, `3 - index` down) and `ringWeight(availability)` (1, 0.88, 0.74, 0.6). |
| `src/lib/presence/motion-budget.ts` (new) | `createMotionBudget(max, schedule = setTimeout)` returning `{ take(): boolean }`; a slot frees 1.8 s after `take()` returns true. Module singleton `motionBudget = createMotionBudget(3)`. |
| `src/components/presence/PresenceBadge.tsx` | Arcs rest at `360 0`; arc circles and ring `<g>` take inline custom props `--arc-len`, `--arc-gap`, `--order`. `useRef` plus IntersectionObserver for `visible`. An effect on `availability` change decides `full` = armed and visible and `motionBudget.take()`, then calls `advanceBadgeSpin`. `cycle` is the `key` that restarts the arc and pop animations. New optional prop `pulseKey?: number`: when it changes while availability is `now`, size is 20 or more and the badge is visible, a ripple class plays once. |
| `src/components/presence/usePresence.ts` | `PersonPresenceView` gains `updatedAt: number` (`query.dataUpdatedAt`), passed by `PersonPresenceBadge` as `pulseKey`. |
| `src/components/presence/PersonPresence.tsx` | Pass `pulseKey={presence.updatedAt}` (not for projects). |
| `src/app/globals.css` | Rest: `.nb-presence-arc { stroke-dasharray:360 0; }`. Cycle: `.nb-presence-badge[data-cycle] .nb-presence-arc { animation: nb-presence-arc-cycle 1.44s ease-in-out both; animation-delay: calc(var(--order) * .09s); }` with keyframes `nb-presence-arc-cycle` (0% `360 0`, 16% and 84% `var(--arc-len) var(--arc-gap)`, 100% `360 0`). Ring transform transition 0.98s with delay `calc(.17s + var(--order) * .09s)`; arc stroke color transition 0.98s with the same delay. `--presence-weight` per `data-availability`, applied as `stroke-width: calc(var(--w) * var(--presence-weight))` with a 0.98s transition. Pop keyframes `nb-presence-pop`; ripple keyframes `nb-presence-ripple` per ring; halo delay 1.65s. Reduced-motion block removes all of it except the color and weight transitions. |
| `docs/architecture/presence.md` | Rewrite the availability paragraph for full rings, the shrink-spin-grow cycle, the five behaviors, the 3-badge budget. |
| Tests | `tests/unit/presence-model.test.ts`: `ringOrder`, `ringWeight`, `advanceBadgeSpin` with `full = false` and the `cycle` counter. New `tests/unit/presence-motion-budget.test.ts`: 3 takes succeed, the 4th fails until a slot frees (fake scheduler). `tests/unit/presence-ring-badge-contract.test.ts`: rest `360 0`, keyframes names, `--order` delays, weight tokens, reduced-motion rule, `pulseKey` only for `now` at 20px or more, `IntersectionObserver` used. |

### Iteration 2 steps

1. Tests first (the table above), watch them fail.
2. `model.ts` and `motion-budget.ts`.
3. `PresenceBadge.tsx`, `usePresence.ts`, `PersonPresence.tsx`.
4. `globals.css`.
5. Docs.
6. Verify: `npm run typecheck`, `npm run lint`, `npm run test:unit`; in the browser (a temporary harness page, deleted afterwards) check rest is four full rings in each hue, a change shrinks, spins, grows and lands on full rings, wave direction flips for a drop, weight differs per state, the ripple plays for Active now at 20px and up, a list of six badges changing at once runs only three full cycles, no cycle on load, reduced motion shows only the fade, dark mode.

### Iteration 2 risks

- At 11 to 14px the shrink-spin-grow is hard to see; it is mostly the color fade and the full rings. Judge on screen.
- IntersectionObserver per badge: lists of hundreds of badges each hold one observer. If that shows in profiling, share one observer across badges.
- The ripple rides on data refresh (every 90 s), not a literal 60 s heartbeat, because other people's heartbeats are not pushed to this tab.
- Sizes from version 1 are unchanged. The docked status chip from version 1 is replaced in iteration 3.

## Iteration 3 (2026-10-20): status emoji inside the rings

Replaces the docked status chip of version 1 (design A, chip beside the rings). Approved from a mock; all three options (A, B, C) are included.

**Core.**
- When a person has a status (for example 📅 In a meeting, 👥 In community) and the badge is 20px or larger, the four rings pull outward to open the centre and the status emoji sits inside them. Ring radii go from `135/240/330/413` to `237/303/366/428`, same widths, so the hole is about 50% of the badge diameter. Emoji size is 0.40 x badge size.
- Setting a status: the rings move outward over 0.7 s while the emoji pops in (back-ease scale 0 to 1). Clearing or expiry: the reverse. Changing from one status to another: the new emoji pops in (0.36 s).
- Under 20px nothing changes: rings only; the status stays in the tooltip and screen-reader label (`label` from `usePresence.ts`, already status first, then availability).
- The rings' shrink-spin-grow cycle (iteration 2) turns around the emoji; the emoji stays upright because it sits outside the rotating ring groups.
- Same data path as the chip: `usePersonPresence().status.emoji` (and the project status emoji), audience and expiry already applied server-side.

**Option A: grow to 20px when a status is set.** If a status shows and the avatar is 32px or larger, the badge becomes `max(base, 20)`, with a 0.4 s size transition; corner offsets stay as each call site sets them. Effective sizes with a status: TopNav 16 to 20, members list and DM header 14 to 20, people card 20, search and discover 16 to 20, hover card 20, project card 18 to 20, profile header 30, project detail 30. Messages-list rows (20px avatars) stay 11 with no emoji.

**Option B: timer ring.** For a status with an end time, the outermost ring drains: its arc starts at 12 o'clock and shortens clockwise from full to empty as `expiresAt` approaches (remaining / total), over the gray track. Needs the status start time: the column `profiles.status_set_at` already exists and is written; add it to the `getPresence` SELECT and as `setAt: string | null` on `PersonStatus` (same privacy gate as the rest of the status, no migration). A statuses without an end time keeps a full ring. Updated by one shared 30 s tick (`useNow`) mounted only while such a badge is visible, with a 0.6 s dasharray transition.

**Option C: dotted outer ring when notifications are paused.** A status with `pausesNotifications` (for example Out sick, Vacationing) draws the outermost ring as dots (`stroke-dasharray: 0.1 11.9`, round caps). A paused status that also has an end time shows the dotted ring clipped by an SVG `<mask>` whose white arc is the remaining fraction (mask id from `useId`), so the timer still drains.

### Iteration 3 files

| File | Change |
|---|---|
| `src/lib/presence/model.ts` | `PersonStatus` gains `setAt: string \| null`. Replace `STATUS_CHIP_MIN_SIZE` and `showStatusChip` with `STATUS_EMOJI_MIN_SIZE = 20` and `showStatusEmoji(emoji, size)`. Add `statusBadgeSize(base, avatarSize, hasEmoji)` (option A) and `statusTimerFraction(setAt, expiresAt, now)` clamped to 0..1, `null` when either is missing or the span is not positive (option B). |
| `src/app/actions/presence.ts` | `getPresence` selects `p.status_set_at`, adds it to `PresenceRow`, and maps `setAt`. Project statuses are unchanged (no timer ring for projects). |
| `src/components/presence/usePresence.ts` | `PersonPresenceView` exposes `statusTimer: { setAt, expiresAt } \| null`. Add `useNow(intervalMs)`. |
| `src/components/presence/PresenceBadge.tsx` | Remove the chip. New optional props `statusSize?: number`, `statusTimer?`, `statusPaused?`. Badge size = `statusBadgeSize`-style `max(size, statusSize)` when the emoji shows. `data-status`, `data-paused` and `--timer` on `.nb-presence-badge`; a keyed `<span class="nb-presence-emoji">` centred inside; mask for paused plus timed. |
| `src/components/presence/PersonPresence.tsx` | `PersonPresenceBadge` passes `statusEmoji`, `statusTimer`, `statusPaused` from `presence.status`; `PresenceAvatar` passes `statusSize={size >= 32 ? 20 : undefined}`. `ProjectPresenceBadge` passes the emoji (no timer, no paused). |
| `src/components/network/PersonPresenceDot.tsx`, `src/components/layout/header/TopNav.tsx`, `src/components/projects/ProjectAvatar.tsx` | Pass `statusSize={20}` (project detail and profile header are already 30). |
| `src/app/globals.css` | Remove `.nb-presence-chip` and the pair gap. Add `r` custom props per ring and `.nb-presence-badge[data-status]` radii with a 0.7 s `r` transition; emoji centring, pop keyframes, size transition 0.4 s; `data-paused` dotted outer ring; `--timer` arc for the outer ring with a 0.6 s dasharray transition; reduced motion: no pop, no radius or size transition (they snap), no timer transition. |
| `docs/architecture/presence.md` | Replace the docked-chip sentence with the inside-the-rings behavior, the 20px minimum, options A, B, C, and `setAt`. |
| Tests | `presence-model.test.ts`: `showStatusEmoji` at 19 and 20, `statusBadgeSize`, `statusTimerFraction` (no end time, expired, half, bad input). `presence-ring-badge-contract.test.ts`: remove chip assertions; assert the inside-the-rings radii, `data-status`, emoji span, mask for paused plus timed, `statusSize` passed at the call sites. Any fixture that builds a `PersonStatus` gets `setAt` (typecheck lists them). |

### Iteration 3 steps

1. Tests first, watch them fail.
2. `model.ts`, then `presence.ts` and `usePresence.ts`.
3. `PresenceBadge.tsx`, `PersonPresence.tsx`, the three call-site files.
4. `globals.css`.
5. Docs.
6. Verify: `npm run typecheck`, `npm run lint`, `npm run test:unit`. In the browser (temporary harness page, deleted afterwards): set and clear each status (📅 🚌 🤒 🌴 🏡 and a typed 👥); the emoji is inside at 20px and larger and absent at 11 to 14px; badges grow to 20 where the avatar is 32px or larger; the timer ring drains with a timed status; the dotted ring shows for Out sick and Vacationing (and drains when timed); availability changes spin around the emoji; dark mode; reduced motion. Check a status set for the network or team from a viewer outside that audience: no emoji and no timer.

### Iteration 3 risks

- Animating the SVG `r` property with CSS works in Chromium and Firefox; if a target browser ignores it the rings snap to the new radii (no transition). Acceptable; the emoji pop and size transition still play.
- With a status, the badge is bigger (20px) on small avatars (TopNav, members, DM header), so it covers more of the picture than the 14 to 16px badges. Judge on screen; if too heavy, raise the avatar threshold for option A.
- The mask for paused plus timed needs a unique id per badge; a list of many such badges adds many masks. Only badges with a paused and timed status render one.
- Emoji render differently per OS and may look slightly off-centre; judge on screen and nudge with a per-emoji-free `translateY` if needed.
- Project statuses have no `setAt` in this plan, so projects get the emoji but no timer ring.

## What changes (version 1, partly superseded above)

The corner "Node" badge (one rounded square, `PresenceBadge.tsx`) becomes a four-ring SVG badge.

- Four concentric rings in every state. Each ring is a light empty track plus a longer round-capped arc. Ring radii 135/240/330/413, widths 34/30/28/28 (viewBox `205 270 880 880`, centre 645,710). Arcs: ring 1 `212°+251°`; ring 2 `149°+130°`, `44.5°+85°`; ring 3 `3°+142°`; ring 4 `210.5°+71°`, `109.5°+69°`.
- Only the hue differs by state: now green, today blue (new), week amber, offline gray.
- The chip stays a rounded square (`border-radius: 32%`, as today). App avatars are rounded squares (3 to 5px), so a circular chip would not fit.
- Placement is unchanged: the badge stays on the avatar's bottom-right corner with the 2px cut ring, existing offsets kept (about -2 to -6px). It is not moved beside the name or outside the picture.
- Size is set per place (approved mock). Larger where the avatar can carry it, smaller only in the two list rows where the badge covered the picture.

  | Place | Avatar | Badge now | Badge new |
  |---|---|---|---|
  | TopNav | 32 | 12 | 16 |
  | Profile header | 72 | 22 | 30 (raised from 24 after review) |
  | Project detail avatar | 80 | 18 | 30 (corner offset 0.2 x badge) |
  | Project card avatar | 44 | 14 | 18 (corner offset 0.2 x badge) |
  | People card, search, discover (`PersonPresenceDot`) | 48 / 40 | 16 / 14 | 20 / 16 |
  | Hover card | 48 | 16 | 20 |
  | Messages list (DM row) | 20 | 10 | 11 |
  | Members list, DM header | 34 | 14 | 14 |
  | Details pane about | 72 | 26 | 26 (unchanged) |
  | Conversation member dot, project badges in chat | n/a | 8 / 10 | unchanged |
- Dark mode: chip `--card` (#141A1E), darker track, lighter hues.
- Status emoji (design A, docked chip): when a person has a status (for example 📅 In a meeting, 👥 In community), a chip with the status emoji sits docked on the left of the ring badge. The pair stays at the avatar's bottom-right corner.
  - Chip: same size as the badge, rounded square (`32%`), same chip color and 2px cut ring, 2px gap to the rings, emoji at 0.62 x badge size. The pair keeps the badge's corner offset and grows leftward over the avatar's bottom edge.
  - Shown only where the badge is 14px or larger: TopNav, profile header, people card, search, hover card, members list, DM header. Not in the messages list (11), conversation member dot (8) or chat project badges (10); there the emoji stays in the tooltip and the screen-reader label as today.
  - The emoji comes from the existing `usePersonPresence().status.emoji` (and `ProjectStatus.emoji` for projects), so audience rules (everyone, network, team, blocked) and expiry are already applied server-side. No new endpoint or column.
  - A status change does not spin the rings; only an availability change does. The chip appears and disappears without animation.
  - The `aria-label`/`title` already read "status, then availability" (`label` in `usePresence.ts`); unchanged.
- State change: the four rings spin one full turn (1.1s, 0.08s stagger inner to outer), arcs fade to the new hue. Up in activity spins clockwise, down counter-clockwise. Becoming "now" ends with one green halo. No spin on first render or first data load. Reduced motion: color fade only.

Out of scope (rejected): arc length by state, 2-ring small badge, continuous rotation, avatar notch, hover label, square project chip.

## Files

| File | Change |
|---|---|
| `src/components/presence/PresenceBadge.tsx` | Client component. Inline SVG, stable `<g>` per ring, ref of cumulative angles, halo span, `animate` prop (default true). No min-size clamp: every site keeps its own size. Keep `role/aria-label/title/data-testid/data-availability`. |
| `src/lib/presence/model.ts` | Add pure `spinDelta(prev, next)`: +360 up, -360 down, 0 same (rank offline < week < today < now). Add `showStatusChip(emoji, size)`: true when the emoji is set and `size >= 14` (constant `STATUS_CHIP_MIN_SIZE = 14`). |
| `src/components/presence/PresenceBadge.tsx` (status) | New optional prop `statusEmoji?: string \| null`. When `showStatusChip` is true, render the emoji chip before the rings inside one absolutely positioned pair wrapper. The wrapper takes over the corner offset that callers pass through `className`/`style`, so call sites do not change. |
| `src/components/presence/PersonPresence.tsx` | `PersonPresenceBadge` passes `animate={presence.loaded}` and `statusEmoji={presence.status?.emoji}`. `ProjectPresenceBadge` passes the project's status emoji the same way. `badgeSizeFor`: avatar 24 or less to 11 (was 10), up to 40 to 14, up to 64 to 20 (was 16), larger 26. This gives DM row 11, members and DM header 14, hover card 20, details pane 26. |
| `src/components/network/PersonPresenceDot.tsx` | Sizes 16 to 20 (card), 14 to 16 (compact). |
| `src/components/layout/header/TopNav.tsx` | Badge 12 to 16. |
| `src/components/profile/v2/ProfileHeader.tsx` | Badge 22 to 24. |
| `src/components/messages/ConversationView.tsx` (613) | 8px member dot: size unchanged. Check legibility on screen. |
| `src/components/messages/ChatSections.tsx` (431, 448) | Project badges 10: size unchanged. Check on screen. |
| `src/app/globals.css` (933 block) | Replace Node rules: `--presence-now/today/week/off`, `--presence-chip`, `--presence-track` (light + `.dark`), ring and arc transitions, stagger delays, halo keyframes, reduced-motion rule. Keep `.nb-person-presence-dot`. |
| `docs/architecture/presence.md` | Reword the Node-badge description (line 3). |

## Steps

1. **Tests first.**
   - `tests/unit`: `spinDelta` cases (up, down, same, skipping states).
   - Update `project-avatar-integration-contract.test.ts` lines 97 to 120 (old cutout and `inset` assertions) to the new CSS and component.
   - `showStatusChip` cases: no emoji, emoji at 11, 13, 14, 24.
   - Add assertions: four rings per badge, the status chip renders only through `showStatusChip`, per-state hue tokens, `.dark` overrides, transition and stagger rules, `prefers-reduced-motion`, `animate` is false until loaded.
   - Update `topnav-profile-dropdown-contract.test.ts` line 20 (`size={12}` to `16`).
2. **`model.ts`:** `spinDelta`.
3. **`PresenceBadge.tsx`:** render SVG, apply `rotate(angle)` per ring from the ref. While `animate` is false, store the baseline and do not spin. After a change set the halo only when the new state is "now".
4. **`globals.css`:** tokens and rules as above.
5. **Call sites:** the size changes in the table.
6. **Docs.** Rewrite `docs/architecture/presence.md`: the "Node" badge becomes the ring badge, and "status ... never on the badge" becomes "status emoji is docked beside the rings where the badge is 14px or larger". Remove the planned-changes block added on 2026-10-19.
7. **Verify.**
   - `npm run test:unit`, `npm run typecheck`, `npm run lint`.
   - In the browser, light and dark: TopNav, profile header, People card, messages list, members list, project avatar.
   - Set each suggestion status (📅 🚌 🤒 🌴 🏡) and a typed one (👥 In community) in the status picker. Confirm the chip appears at 14px and larger, is absent in the messages list, and disappears when the status clears or expires. Check a status limited to network or team from a viewer outside the audience: no chip.
   - Trigger real changes: offline to now, now to today, week to offline. Confirm rings land where they started, no spin on load, halo once, reduced motion off.
   - Check the 11px badge on the 20px DM-row avatar and the 14px badge on 34px member avatars: they must not hide the initials.

## Risks

- Badges at 8 to 14px put four rings at image thickness into very little space and may read as a colored dot. Judge on screen; if illegible, ask before changing the design (a two-ring version for tiny sizes was previewed and not chosen).
- `animate` relies on `usePersonPresence().loaded`. Project badges have no loaded flag and animate on any change after mount.
- The chip widens the badge to about 2x. On a 34px members avatar the pair is about 30px wide, so it covers most of the avatar's bottom edge. Judge on screen; if too heavy, raise `STATUS_CHIP_MIN_SIZE` so members and DM header show no chip.
- Emoji render differently per OS; the chip uses the system emoji font, no image assets.
- Many badges changing at once (list refresh) each run one 1.1s transition. No continuous animation.

## Ledger

- `ponytail:` sizes live in `badgeSizeFor` plus the literal sizes at four call sites. Merge into one table if a fifth place needs its own size.

## Verification (2026-10-19)

- `npm run typecheck` and eslint on the changed files: clean. `npm run test:unit`: all pass except `the current extension uses single-flight activation sessions...`, which also fails without these changes.
- Browser (temporary harness page using the real `PresenceBadge` and `globals.css`, since removed): offline to now turns all four rings to `rotate(360deg)`, arcs go green and the halo appears; now to today returns to `rotate(0deg)` with blue arcs; with `animate` false a change does not spin; the status chip appears at badge sizes 14 and up (widths 30 to 50px) and not at 11; dark mode shows the dark chip and lighter hues.
- Not verified: real app pages (needs a login), reduced-motion in a browser (covered by a CSS contract test only), and `tests/browser/profile.spec.ts`, whose Playwright setup fails in this environment before running.

## Verification of iterations 2 and 3 (2026-10-20)

Deviations from the plan, made while building:
- `statusBadgeSize(size, statusSize, emoji)` takes the badge size to grow to (the call sites pass `statusSize` = 20 for avatars of 32px or more) instead of an avatar size.
- The change cycle restarts through alternating keyframe copies (`data-cycle` a/b) instead of a remounted element, so the rings keep turning smoothly and the hue fade works. `BadgeSpin` also carries `from` and `dir`.
- The heartbeat ripple uses the same 3-badge animation budget as the change cycle.
- The emoji exit is a 0.3 s shrink (kept on screen by `useLingering`); swapping one emoji for another pops the new one in without the old one shrinking first.
- `statusSize` is also passed on `ProjectPresenceBadge`; projects get the emoji but no timer ring.

Checked in the browser (temporary harness page using the real `PresenceBadge` and the new CSS, since removed): full rings at rest with weight 0.6 offline; offline to week to now to week turns the rings 360, 720 and back with alternating `a`/`b` animations; the wave order flips to 3,2,1,0 going down; the halo appears on now; with `animate` false a change does not cycle; six badges changing at once run three cycles; the ripple plays for Active now at 20px and up (three at a time) and not offline; the emoji sits inside the rings at 20px and up (TopNav and members grow to 20) and not on the 11px DM row; the outer ring drains to a third for a 20 of 60 minutes status; Out sick draws the dotted ring with a mask; clearing shrinks the emoji and closes the rings; dark mode.
Not verified: real app pages (needs a login), reduced motion in a browser (contract test only), the Playwright profile spec (setup fails here), Safari (CSS `r` transition may snap).
Environment note: the running dev server kept serving the old `globals.css`; the new CSS was loaded into the page by hand for the check. Restart `next dev` to see it in the app.
