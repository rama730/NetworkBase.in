# Presence ring badge: implementation plan

Status: implemented on local main (2026-10-19). Browser verification results are at the end of this file.

## What changes

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
