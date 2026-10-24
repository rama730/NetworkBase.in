# Messaging (Slack-style chat)

Source of truth for decisions and numbers: `docs/plans/messaging-slack-rebuild-report.md` (section 7). Load results: `docs/plans/chat-phase-0.md`.

## Model

- **The project is the workspace.** Every project has a default public `#general` (`is_default`). Project members can create public or private channels (cap 200 per project, 500 members per channel).
- **DMs** are `kind = 'dm'` channels with a unique `dm_key`; a self-DM has one member. **Group chats** are unnamed private channels (up to 9 people). **Application threads** are private channels with `application_id` (applicant plus project owner and admins), opened by the application card.
- Message identity is `(channel_id, channel_seq)`. The sequence is allocated under the channel row lock inside `app_private.chat_send_message`, so it is gap-free and ordered (ceiling ≈300 sends/s per channel, L-17).
- Unread is `last_top_seq > last_read_seq` per member; thread replies do not raise channel unread. Mentions count per member and reset on read.

## Tables (0180, 0182 canvases, 0187 reorganization)

`chat_channels`, `chat_channel_members`, `chat_messages` (hash ×32), `chat_attachments` (hash ×32, → `storage_assets`), `chat_reactions` (hash ×32), `chat_message_cards`, `chat_mentions`, `chat_thread_follows`, `chat_pins`, `chat_reports`. RLS is SELECT-only via `app_private.chat_is_member`; every write goes through `app_private.chat_*` SECURITY DEFINER functions called by server actions with the service role.

0187 adds `chat_saved` (save for later + `remind_at`), `chat_channel_tabs` (shared Tasks and bookmark tabs), `chat_scheduled_messages`, `chat_channels.title` (group chat names), `chat_mentions.read_at` (Inbox read state) and a GIN full-text index on `chat_messages.body` (`'simple'` config). New tables are written by server actions with explicit membership checks and keep the SELECT-only RLS rule. Any member may pin (was admin-only in project channels). Inbox unread = a mention not marked read and not behind the read cursor (the channel's for top-level messages, the thread's for replies): `app_private.chat_inbox_unread`, returned in the bootstrap as `inbox_unread`.

## Server

- Actions: `src/app/actions/chat/{channels,members,messages,read,activity,later,search}.ts`. `later.ts` is Saved, reminders and scheduled messages; `search.ts` is message search (in:, from:, has:file, dates; newest 50). Sending lives in `src/lib/messaging/send.ts` (server-only), shared by the actions, sharing and the scheduled-send job. Each starts with `requireChatUser()` (enforced by `check:authz-contract`).
- Attachments: `api/v1/chat/attachments/presign` (signed upload + verification through the `storage_assets` lifecycle) and `api/v1/chat/attachments/[assetId]` (member check, then a 300 s signed URL).
- Integrations: `src/lib/messaging/integrations.ts` keeps project membership, application threads and invite cards in step (`chat_sync_project_members`, `chat_ensure_application_channel`, invite card in the inviter↔candidate DM).
- Cards (`application`, `task`, `invite`) hydrate live from their source tables; status triggers broadcast `card.changed`.

## Realtime

- Private Broadcast topics only: `chat:channel:<id>` (messages, edits, reactions, pins, card and member changes; members read, only the server sends), `chat:typing:<id>` (typing on/off with the thread root, ≤50 members; members read and send, 0183) and `chat:user:<id>` (hints, `read.moved`, `membership.changed`). Authorization is in the `application_topic_read/send` policies; Supabase checks them once at join, so a topic browsers can send on must carry nothing the app trusts.
- Typing (`useTyping`): names come from the member list, never the payload; signals only on key presses, throttled 3.5 s; a stop goes out when the draft empties, is sent or the composer closes; typers expire after 5 s. Shown just above the composer box (channel and thread), without moving it.
- Server publishes after commit via the REST batch endpoint (`src/lib/realtime/server-broadcast.ts`). Delivery is best-effort (L-1): clients refetch on reconnect, and a 90 s ± 30 s bootstrap delta poll covers background unread (L-2).
- `NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED` must be on; with it off chat runs on the poll alone.

## Client

- Message histories use the shared original drafting-grid canvas in `MessageHistory`; conversations, threads, loading states, and the floating window inherit it without adding a scroller. Grid strength follows each history's actual width while keeping 24px cells. See [message background design](../design/message-background.md) for theme, accessibility, placement, and verification details.
- `ChatShellProvider` (bootstrap, poll, user topic, badge) wraps the app; the sidebar badge and launcher read it.
- `/messages*` keeps the app navigation; a 260px chat sidebar sits beside it at 1024px+: the project switcher (a project, or All projects grouped by project), Search (⌘K), an Unreads filter, Inbox · Saved · Drafts & scheduled, Starred, Channels, Direct messages, My applications. Rows have a hover ⋯ (mark read, mute, star, copy link, close/leave). Collapsed sections follow the account (auth `user_metadata.chat_sections`).
- Routes: `/messages/inbox` (All · Mentions · Threads · Reactions), `/messages/saved`, `/messages/drafts`, `/messages/search`. Thread and Details are query params on the conversation (`?thread=<seq>&details=about|members`, `src/lib/messaging/routes.ts`), shown in one drawer (tabs when both are open); the old `/activity`, `/threads`, `/<id>/thread/<seq>` and `/<id>/details` URLs redirect in `next.config.ts`. Below 1024px the drawer is full screen with Back.
- Conversation tabs: Messages, Canvas (channels), Pins (once something is pinned), Files, then the shared Tasks/bookmark tabs. Closing the canvas tab hides it for you only; deleting it is in the canvas menu. Public channels can be previewed by project members before joining.
- The floating launcher (`ChatLauncher`/`ChatWindow`) shows at 768px+ outside `/messages` and `/projects/new`.
- **Composer and inline edit** use one Tiptap editor (`ChatEditor.tsx`): formatting applies in place with Slack's shortcuts (⌘B/I, ⌘⇧X/C/7/8/9/U, ⌘⌥⇧C), Enter sends, ⇧Enter is a new line. It outputs the same markdown the timeline renders; mentions are atoms that serialize to `<@id>`. The editors load lazily after the timeline.
- **Canvas** (0182 `chat_canvases`, one per channel, shared by members): markdown body, separate title, `asset_ids` for images. `saveCanvas` is last-writer-wins on `version` (`chat_canvas_conflict` reloads the latest) and broadcasts `canvas.changed`. The editor (`CanvasEditor.tsx`) has headings, checklists, images (drop/paste/upload, sizes S/M/Full), the ⋮⋮ block menu (Turn into, Move, Duplicate, Delete) and block drag. Export: Copy as Markdown and Download as PDF (print of the canvas alone). `?tab=canvas` opens it. The attachment route also lets members open images listed on their channel's canvas; the server keeps only assets the saver owns or that the canvas already had.

## Jobs

`chat-mentions-retention` (daily, 90 days, batched), `chat-integrity-audit` (hourly sample, log only) and `chat-due` (every minute: sends due scheduled messages and fires "Remind me" reminders as `chat_reminder` notifications; rows are claimed with SKIP LOCKED). The DM details' local time uses the viewer's time zone, stored by the presence heartbeat in Redis (`presence:tz:<id>`, 30 days; never for hidden activity). Account deletion anonymizes authored messages in batches and deletes the user's DMs (`src/lib/messaging/account.ts`). The account export contains only the user's own messages and channel names.

## Checks

`npm run check:chat:db` (functions, RLS, Realtime auth, ordering, caps, 10.3 removal proof) and `npm run check:chat:actions` against a disposable database; `scripts/chat-load/run.sh` for the 1M-user load profile.
