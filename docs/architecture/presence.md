# Presence and status

Two layers on one badge, drawn as four concentric rings on an avatar's bottom-right corner (`PresenceBadge`):

- **Availability** (automatic): four full rings in one hue per state: Active now (green), Active today (blue), Active this week (amber), Offline (grey), thinner as activity drops (100%, 88%, 74%, 60%; `ringWeight`).
  - A change plays one cycle (about 1.7 s): each ring shrinks back to its short and long arcs, turns once (clockwise up in activity, counter-clockwise down) while the hue fades, then grows back to a full ring. The wave runs inner to outer going up and outer to inner going down (`ringOrder`), the badge pops as the rings land, and becoming Active now ends with one halo.
  - No cycle on the first render or before the data has loaded. At most three badges on screen run the cycle at once (`motionBudget`, `IntersectionObserver`); any other badge only fades its hue and weight. Under reduced motion only the fades play.
  - While Active now, a badge of 20px or more ripples (a soft dip passing outward) when its presence data refreshes (every 90 s). It uses the same budget.
  - In dark mode the chip, track and hues use the `.dark` tokens.
  - Active now: an engaged tab sends `POST /api/v1/presence/heartbeat` every 60 s; the route sets Redis `presence:live:<id>` (TTL 150 s). `profiles.last_active_at` is still written at most once per 5 minutes. Without Redis, activity in the last 5 minutes counts as now. Chat's realtime presence also marks people live at once.
  - Today / this week / offline come from `last_active_at`, in the viewer's time zone.
- **Status** (Slack style, 0186): any emoji + text (≤ 80), shown beside the name, and its emoji is also drawn inside the rings: they pull outward to open the centre and the emoji pops in (`showStatusEmoji`, badges of 20px or more; `statusBadgeSize` grows a smaller badge on avatars of 32px or more to 20px). Under 20px the emoji stays in the tooltip and screen-reader label. A status with an end time drains the outer ring (`statusTimerFraction` from `profiles.status_set_at`, read as `setAt`, updated every 30 s by one shared timer); a status that pauses notifications draws the outer ring dotted, and a dotted ring still drains through an SVG mask. Suggestions (📅 In a meeting, 🚌 Commuting, 🤒 Out sick, 🌴 Vacationing, 🏡 Working remotely) are just prefills. Clears at `status_expires_at` (≤ 90 days). A status that pauses notifications sets `notification_preferences.pausedUntil`, which both push paths already honour; mentions of such a person show a heads-up.
- **Projects**: activity from `projects.updated_at`; owners and admins set any emoji + text (`projects.status_emoji`, `status_text`), with suggestions 🏃 Sprinting, 🚀 Launching, 🙋 Hiring, ⏸️ On hold, 🏖️ Team on break.

## Privacy (server-side, `presencePrivacy` in `src/lib/presence/model.ts`)

- Profile status and privacy columns (0184) are not granted to browsers; read only through `src/app/actions/presence.ts`.
- Hiding activity (`show_activity = false`) clears `last_active_at` and the live key and stops recording; it is mutual (a hidden viewer sees everyone Offline).
- Status audience: everyone, network (connections and project teammates), or team (project teammates). Blocked pairs see nothing.

## Client

- `usePersonPresence` / `useProjectPresence` (`components/presence/usePresence.ts`) batch ids in one server call per tick, cache 60 s, refresh every 90 s while mounted.
- `PresenceBadge` (rings, change cycle, status emoji, timer and ripple), `PersonPresenceBadge`, `PresenceAvatar`, `ProjectPresenceBadge`, `StatusInline` (emoji + text), `EmojiChoice` (common picks or any typed/pasted emoji), `PersonHoverCard`, `StatusPicker` (one global dialog: avatar menu, mobile menu, profile, `/status`), `ProjectStatusControl` (project header).
- Colors are `--presence-*` tokens in `globals.css` (light and dark). Badge sizes are set per place: TopNav 16, profile header 30, project detail avatar 30, project card avatar 18, project title dot 14, people card and hover card 20, search and discover 16, members list and DM header 14, messages list 11, details pane 26; with a status emoji the badge grows to 20 on avatars of 32px or more.
