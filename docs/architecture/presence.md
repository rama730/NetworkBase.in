# Presence and status

Two layers on one "Node" badge (a rounded square from the NetworkBase mark):

- **Availability** (automatic): Active now (solid green), Active today (green with an inner square), Active this week (hollow amber), Offline (thin grey outline).
  - Active now: an engaged tab sends `POST /api/v1/presence/heartbeat` every 60 s; the route sets Redis `presence:live:<id>` (TTL 150 s). `profiles.last_active_at` is still written at most once per 5 minutes. Without Redis, activity in the last 5 minutes counts as now. Chat's realtime presence also marks people live at once.
  - Today / this week / offline come from `last_active_at`, in the viewer's time zone.
- **Status** (Slack style, 0186): any emoji + text (≤ 80), shown beside the name, never on the badge. Suggestions (📅 In a meeting, 🚌 Commuting, 🤒 Out sick, 🌴 Vacationing, 🏡 Working remotely) are just prefills. Clears at `status_expires_at` (≤ 90 days). A status that pauses notifications sets `notification_preferences.pausedUntil`, which both push paths already honour; mentions of such a person show a heads-up.
- **Projects**: activity from `projects.updated_at`; owners and admins set any emoji + text (`projects.status_emoji`, `status_text`), with suggestions 🏃 Sprinting, 🚀 Launching, 🙋 Hiring, ⏸️ On hold, 🏖️ Team on break.

## Privacy (server-side, `presencePrivacy` in `src/lib/presence/model.ts`)

- Profile status and privacy columns (0184) are not granted to browsers; read only through `src/app/actions/presence.ts`.
- Hiding activity (`show_activity = false`) clears `last_active_at` and the live key and stops recording; it is mutual (a hidden viewer sees everyone Offline).
- Status audience: everyone, network (connections and project teammates), or team (project teammates). Blocked pairs see nothing.

## Client

- `usePersonPresence` / `useProjectPresence` (`components/presence/usePresence.ts`) batch ids in one server call per tick, cache 60 s, refresh every 90 s while mounted.
- `PresenceBadge` (availability only), `PersonPresenceBadge`, `PresenceAvatar`, `ProjectPresenceBadge`, `StatusInline` (emoji + text), `EmojiChoice` (common picks or any typed/pasted emoji), `PersonHoverCard`, `StatusPicker` (one global dialog: avatar menu, mobile menu, profile, `/status`), `ProjectStatusControl` (project header).
- Colors are `--presence-*` tokens in `globals.css` (light and dark).
