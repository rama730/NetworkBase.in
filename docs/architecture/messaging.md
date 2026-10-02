# Messaging (Slack-style chat)

Source of truth for decisions and numbers: `docs/plans/messaging-slack-rebuild-report.md` (section 7). Load results: `docs/plans/chat-phase-0.md`.

## Model

- **The project is the workspace.** Every project has a default public `#general` (`is_default`). Project members can create public or private channels (cap 200 per project, 500 members per channel).
- **DMs** are `kind = 'dm'` channels with a unique `dm_key`; a self-DM has one member. **Group chats** are unnamed private channels (up to 9 people). **Application threads** are private channels with `application_id` (applicant plus project owner and admins), opened by the application card.
- Message identity is `(channel_id, channel_seq)`. The sequence is allocated under the channel row lock inside `app_private.chat_send_message`, so it is gap-free and ordered (ceiling ≈300 sends/s per channel, L-17).
- Unread is `last_top_seq > last_read_seq` per member; thread replies do not raise channel unread. Mentions count per member and reset on read.

## Tables (0180)

`chat_channels`, `chat_channel_members`, `chat_messages` (hash ×32), `chat_attachments` (hash ×32, → `storage_assets`), `chat_reactions` (hash ×32), `chat_message_cards`, `chat_mentions`, `chat_thread_follows`, `chat_pins`, `chat_reports`. RLS is SELECT-only via `app_private.chat_is_member`; every write goes through `app_private.chat_*` SECURITY DEFINER functions called by server actions with the service role.

## Server

- Actions: `src/app/actions/chat/{channels,members,messages,read,activity}.ts`. Each starts with `requireChatUser()` (enforced by `check:authz-contract`).
- Attachments: `api/v1/chat/attachments/presign` (signed upload + verification through the `storage_assets` lifecycle) and `api/v1/chat/attachments/[assetId]` (member check, then a 300 s signed URL).
- Integrations: `src/lib/messaging/integrations.ts` keeps project membership, application threads and invite cards in step (`chat_sync_project_members`, `chat_ensure_application_channel`, invite card in the inviter↔candidate DM).
- Cards (`application`, `task`, `invite`) hydrate live from their source tables; status triggers broadcast `card.changed`.

## Realtime

- Private Broadcast topics only: `chat:channel:<id>` (messages, edits, reactions, pins, typing ≤50 members, card and member changes) and `chat:user:<id>` (hints, `read.moved`, `membership.changed`). Authorization is in the `application_topic_read/send` policies.
- Server publishes after commit via the REST batch endpoint (`src/lib/realtime/server-broadcast.ts`). Delivery is best-effort (L-1): clients refetch on reconnect, and a 90 s ± 30 s bootstrap delta poll covers background unread (L-2).
- `NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED` must be on; with it off chat runs on the poll alone.

## Client

- `ChatShellProvider` (bootstrap, poll, user topic, badge) wraps the app; the sidebar badge and launcher read it.
- `/messages*` swaps the global sidebar for a 64px rail + 248px sidebar; below 1024px it is a single pane (list ↔ conversation, thread/details as full-screen routes); at 1024px+ thread and details are a 320px drawer on the same routes.
- The floating launcher (`ChatLauncher`/`ChatWindow`) shows at 768px+ outside `/messages` and `/projects/new`.

## Jobs

`chat-mentions-retention` (daily, 90 days, batched) and `chat-integrity-audit` (hourly sample, log only). Account deletion anonymizes authored messages in batches and deletes the user's DMs (`src/lib/messaging/account.ts`). The account export contains only the user's own messages and channel names.

## Checks

`npm run check:chat:db` (functions, RLS, Realtime auth, ordering, caps, 10.3 removal proof) and `npm run check:chat:actions` against a disposable database; `scripts/chat-load/run.sh` for the 1M-user load profile.
