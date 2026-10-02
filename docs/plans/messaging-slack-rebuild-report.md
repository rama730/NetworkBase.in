# Messaging rebuild: Slack-style, 1M+ users — Concept and audit report

Status: **concept only. No code, no migration, no deletion has been done.**
Date: 2026-10-01 · Branch: `main` · Method: Ponytail (full)
Revision 4 (2026-10-01): Slack-style layout decisions D1-D15 merged (section 7.10 rewritten; 7.1, 7.2, 7.3, 7.5, 7.6, 7.9, 7.11-7.13, ledger, phases, risks updated). Earlier revisions merged design-spec, mobile, and launcher decisions (A, B, C). Ready for your approval; nothing is implemented.
Prototype: superseded by the macro layouts in sections 7.10, 7.12, and 7.13 (section 4).

## Contents

| # | Section | Read it for |
|---|---|---|
| 0 | What this report is | scope and how to read the numbers |
| 1 | What we are doing | goal, scale target, non-goals |
| 2 | How we are doing it | the Ponytail method and workflow |
| 3 | What we are completely changing | one-page old versus new |
| 4 | Prototype | status of the visual prototype |
| 5 | Re-audit | every object, file, job, test, and store that touches messaging, with its fate |
| 6 | Ponytail cut list | what we refuse to build |
| 7 | Target architecture | 7.1 channels, 7.2 tables, 7.3 SQL, 7.4 to 7.9 behaviour, **7.10 Slack-style layout**, 7.11 design conformance, 7.12 mobile, 7.13 floating launcher |
| 8 | Behaviour at 1M users | load, limits, cost, hot spots, failure modes |
| 9 | Debt ledger | every deliberate shortcut with its upgrade trigger |
| 10 | Migration and cutover | the single migration and the proof of removal |
| 11 | Phases and gates | what ships in which order and what must pass |
| 12 | Risks | |
| 13 | Decisions | what is settled and what is still open |
| 14 | Appendix | tests list and numbers to re-verify |

## At a glance

- **What:** replace messaging with a Slack-style messenger built from zero: delete 16 old tables and everything attached to them, create 10 `chat_*` tables plus `project_invites`.
- **Model:** a project is the workspace. Channels are public (joinable by project members), private, or direct messages. Direct messages are platform-wide.
- **Layout:** on `/messages` a project rail (64px) and a sectioned sidebar (248px) replace the global sidebar slot; the timeline, a 320px thread and details drawer, and a Slack-style composer fill the rest (7.10).
- **Design:** the NetworkBase spec binds (paper, ink, clay tokens; Instrument Sans; 44px touch targets); rail and sidebar use the spec's inverse surfaces (7.11).
- **Mobile:** below 1024px one screen at a time with Back; a project switcher sheet; long-press action sheets (7.12).
- **Floating button:** kept; it opens a compact window with the same list and conversation screens (7.13).
- **Scale:** per-channel sequence numbers, hash-partitioned tables, one SQL function per send, Broadcast fan-out to open viewers only, a 90-second poll for background unread. Realtime limits are configuration: the Supabase plan is upgraded as traffic grows (8.3).
- **Cost of choices:** every shortcut is in the ledger (section 9) with its ceiling and the trigger to revisit it.

---

## 0. What this report is

A single source of truth for rebuilding NetworkBase messaging from zero, written to be approved before any work starts. It contains:

1. The goal, scale target, and non-goals (sections 1, 8).
2. The method, tied to `CLAUDE.md`'s skill workflow (section 2).
3. A one-page summary of what changes (section 3).
4. A **complete re-audit** of every object, file, job, script, test, and browser-side store that touches messaging today, with its fate (section 5).
5. A Ponytail cut list: what we refuse to build, and why (section 6).
6. The target architecture in full (section 7), and its behaviour at 1M users with numbers, limits, and costs (section 8).
7. A debt ledger of every deliberate shortcut with its ceiling and upgrade trigger (section 9).
8. The migration, phases with pass/fail gates, risks, and the decisions still needed (sections 10 to 13).

Numbers marked **[assumption]** are planning inputs, not measurements. Every one of them becomes a measured gate in Phase 0 (section 11). Numbers marked **[verified]** come from Supabase's published Realtime limits and pricing (checked 2026-10-01) or from this repository.

---

## 1. What we are doing

**Goal.** Replace the whole messaging system with a channel-first, Slack-style messenger: channels, DMs, threads, reactions, mentions, pins, unread tracking, live cards for applications, tasks, and project invites. Delete the old tables, SQL functions, triggers, policies, realtime subscriptions, notification emitters, hooks, stores, components, jobs, tests, and docs. Build the new system from scratch, with no compatibility layer and no data migration (pre-production; all old messages are dropped).

**Scale target.** Designed for **1,000,000 registered users, 200,000 daily active, ~100,000 users / 130,000 browser tabs connected at peak**, with headroom to 3M registered before any redesign.

**What stays and gets re-linked** (source of truth is unchanged): `profiles` (incl. `message_privacy`), `connections` (incl. `status = 'blocked'`), `projects`, `project_members`, `role_applications`, `application_events`, `tasks`, `storage_assets`, `push_subscriptions`, `user_notifications` (for non-chat kinds), the presence heartbeat, `/api/v1/link-preview`, `/api/v1/privacy`.

**Non-goals for v1** (each is ledgered in section 9 with a trigger): platform-wide public channels, organisations above projects, calls/huddles, canvases, a Files rail item, bots/apps/workflows, scheduled send, custom emoji, cross-channel full-text search, reaction notifications, email digest for missed messages (already deferred in project memory until the domain is live), retention policies, admin moderation UI.

---

## 2. How we are doing it (Ponytail)

### 2.1 The ladder, applied to every component

1. **Does it need to exist?** If not, cut it (section 6).
2. **Already in the codebase?** Reuse: `storage_assets` (upload lifecycle), `dispatchWebPush` (push), `link-preview` API, `rateLimit()`, presence heartbeat, `UserAvatar`, `react-virtuoso`, `react-markdown`, `zustand`, TanStack Query, Inngest.
3. **Stdlib / native?** Web Push `Topic` header (native coalescing), `Intl` for dates, `<dialog>`/native emoji input before a picker library.
4. **Database constraint or function before app code?** CHECK constraints for kinds and lengths, unique indexes for idempotency and DM uniqueness, one SQL function for the whole send path (1 round trip instead of 5), RLS for access.
5. **Installed dependency?** Yes for everything above. **No new dependency in v1.**
6. **Minimum code** otherwise.

### 2.2 Workflow (from `CLAUDE.md`)

| Step | Skill | Applied here |
|---|---|---|
| Cut | `ponytail-audit`, `ponytail-debt` | Section 5 (inventory) and 6 (cut list) are the audit; section 9 is the ledger |
| Plan | `superpowers:writing-plans` | One short plan per phase, written after approval of this report |
| Scope guard | `freeze` | Each phase locks edits to its folders |
| Build | `ponytail`, `superpowers:test-driven-development` | SQL functions are test-first against a real database |
| Debug | `investigate` | Only when a gate fails |
| Measure | `benchmark` | Before/after numbers every phase (section 11 gates). The `benchmark` skill measures page loads; DB and realtime load use `pgbench` scripts and a WebSocket soak, both listed as Phase 0 deliverables |
| Review | `ponytail-review`, then `review` | Cut complexity first, then correctness |
| Ship | `ship`, then `canary` | PR, deploy, watch section 11 production signals |
| Talk | `caveman` (lite), `caveman-commit` | Short status and commits |

### 2.3 Ground rules

- Every table leads its primary key with `channel_id`. One access rule, one partition key, one cursor.
- No trigger on the hot path. The send path is one SQL function.
- No Redis and no Inngest on the hot path (cost: section 8.4).
- Anything bounded by a constant has that constant in one place and a `ponytail:` comment naming the ceiling.

---

## 3. What we are completely changing (one page)

| Area | Today | New |
|---|---|---|
| Tables | 16 messaging tables | 10 `chat_*` tables + 1 outside (`project_invites`) |
| Conversation model | `conversations` (dm / group / project_group) + `dm_pairs` | `chat_channels` (public / private / dm) with a unique `dm_key`; the project is the workspace |
| Message identity | uuid, global ordering by `created_at` | `(channel_id, channel_seq)`, per-channel counter, hash-partitioned |
| Unread | per-participant counters + a preview copied onto every member row, rebuilt by a SQL reconciler | one cursor per member (`last_read_seq`); unread is `last_seq > last_read_seq`; the one list preview lives once on the channel row (`last_preview`) |
| Receipts | delivery + read receipt tables | none (Slack shows none) |
| Cards | `message_workflow_items` + `message_work_links` (copied state) | `chat_message_cards`: a live reference to `role_applications`, `tasks`, `project_invites` |
| Invites | exist **only** inside `message_workflow_items` | real `project_invites` table |
| Realtime | `postgres_changes` on tables + messaging channel in `RealtimeProvider` | private Broadcast: `chat:channel:<id>`, `chat:user:<id>`; publish from server via REST batch |
| Typing | `typing_indicators` table + cleanup RPC | Broadcast event, no table |
| Notifications | `message_burst`, `message_reaction`, `workflow_*` rows in `user_notifications` | no per-message rows; unread is derived; web push direct; Activity view reads `chat_mentions` |
| App entry | unread fetch + inbox summaries + persisted "startup-sync" attention + popup | one `chat_bootstrap` call, one provider, no summaries, no persisted attention |
| Uploads | `attachment_uploads` session table + retention job | reuse `storage_assets` lifecycle; `chat_attachments` points at it |
| Client state | localStorage `messages-v2-ui`, `messages-v2-outbox` | drafts and last-open channel only; old keys purged once |
| Routes | `/messages?conversationId=&messageId=` | `/messages/[channelId]?m=<seq>`, thread and details sub-routes, project landing and Browse channels, DMs, Activity, Threads, New message (7.10) |
| Layout | list with tabs plus a floating popup | Slack-style shell: project rail, sectioned sidebar, conversation view, thread and details drawer (7.10) |
| Switching context | none (one inbox) | project switcher in the rail; instant, in memory (7.10) |
| Floating popup | `ChatPopupV2` | rebuilt as `ChatLauncher` (floating button) + `ChatWindow` on the new system (7.13) |
| Code | ≈24,000 lines, 87 files reference messaging | target ≈6,000 lines (estimate, verified at Phase 5) |

---

## 4. Prototype

The earlier interactive prototype (three views with the previous tab-based list) is superseded by the macro layouts in sections 7.10, 7.12, and 7.13, as requested. It is not regenerated; if you want a new one after approval, say so.

---

## 5. Re-audit: everything that touches messaging, and its fate

Legend: **DROP** = deleted, nothing replaces it · **REPLACE** = deleted, new object listed · **KEEP** = unchanged · **REWIRE** = stays, internals change.

### 5.A Database

**Tables**

| Current (Drizzle export → SQL) | Fate | New |
|---|---|---|
| `conversations` | REPLACE | `chat_channels` |
| `conversationParticipants` → `conversation_participants` (also holds `last_message_*`, `unread_count`) | REPLACE | `chat_channel_members` (no per-member previews; `mention_count` and `archived_at` only) |
| `dmPairs` → `dm_pairs` (SQL-only, not in Drizzle schema) | DROP | `chat_channels.dm_key` unique |
| `messages` | REPLACE | `chat_messages` |
| `messageAttachments` | REPLACE | `chat_attachments` (→ `storage_assets`) |
| `messageReactions` | REPLACE | `chat_reactions` |
| `messagePins` | REPLACE | `chat_pins` |
| `messageReports` | REPLACE | `chat_reports` |
| `messageWorkflowItems`, `messageWorkLinks` | REPLACE (2 → 1) | `chat_message_cards` + `project_invites` |
| `messageEditLogs` | DROP | `edited_at` only |
| `messageHiddenForUsers` | DROP | Slack has no per-user hide |
| `messageReadReceipts`, `messageDeliveryReceipts` | DROP | `last_read_seq` |
| `typing_indicators` (SQL-only) | DROP | Broadcast |
| `attachmentUploads` → `attachment_uploads` | DROP | `storage_assets` states (pending → verified → expired) |
| — | NEW | `chat_mentions`, `chat_thread_follows` |

**Columns, indexes, relations**

- `projects.conversation_id` + index `projects_conversation_idx`: DROP (link goes `chat_channels.project_id`).
- `role_applications.conversation_id`: DROP (link goes `chat_channels.application_id`).
- Drizzle `relations()` blocks: `conversationsRelations`, `dmPairsRelations`, `messagesRelations`, plus `projects.conversation` and `roleApplications.conversation` relations: DROP.
- Migrations `0004`, `0007`, `0022`, `0023`, `0078`, `0122`, `0129`, `0178` created or altered these objects; they stay in history. The new migration drops everything they created.

**SQL functions (10) and triggers (5)**

| Current | Fate | New |
|---|---|---|
| `app_private.nb_is_conversation_participant`, `public.nb_is_conversation_participant` (+ two `GRANT EXECUTE` in `0078`, `0122`) | REPLACE | `app_private.chat_is_member(channel, user)` |
| `get_or_create_dm_conversation` | REPLACE | `chat_get_or_create_dm(a, b)` |
| `app_private.nb_validate_dm_conversation` + `_trigger` | DROP | unique `dm_key` + CHECK |
| `app_private.nb_reconcile_conversation_participants` | DROP | no per-member previews to reconcile |
| `app_private.nb_validate_message_work_link_target` + trigger `message_work_links_validate_target` | DROP | CHECK + FK on `chat_message_cards` |
| `public.handle_message_insert_consistency` + trigger `trg_messages_after_insert_consistency` (defined twice: `0122`, later) | REPLACE | `chat_send_message(...)` (function, not trigger) |
| `update_conversation_timestamp` + trigger `trigger_update_conversation_timestamp` | DROP | folded into `chat_send_message` |
| `update_typing_timestamp` + trigger `typing_updated_at`, `cleanup_old_typing_indicators` | DROP | none |
| trigger `user_notifications_cascade_conversation` | DROP | none (no per-message notification rows) |
| — | NEW | `chat_can_dm`, `chat_mark_read`, `chat_bootstrap`, `chat_sync_project_members`, `chat_add_members`, and 3 card-change triggers |

**RLS policies (≈17) and storage policies**

DROP: `conversations_member_select`, `conversation_participants_member_select`, `dm_pairs_member_select`, `messages_member_select`, `message_attachments_member_select`, `message_delivery_receipts_member_select`, `message_edit_logs_member_select`, `message_hidden_owner_select`, `message_pins_member_select`, `message_reactions_member_select`, `message_read_receipts_member_select`, `message_reports_owner_select`, `message_work_links_member_select`, `message_workflow_items_member_select`, a `"Conversation…"` policy, `chat_attachments_owner_insert`, `chat_attachments_owner_delete`.
NEW: one `…_select` policy per `chat_*` table via `chat_is_member`; `realtime.messages` policies `chat_topic_read`, `chat_topic_send`; storage policies on bucket `chat-attachments` (bucket name kept; path prefix is `<channel_id>/…`).

**Realtime publication.** `typing_indicators`, `conversation_participants` (and others) were added to `supabase_realtime` in `0007`, `0022`. They leave with the tables. New design adds **nothing** to the publication.

**Data.**
- `user_notifications`: delete all rows with kind in (`message_burst`, `message_reaction`, `workflow_assigned`, `workflow_resolved`) **and** every row whose `entity_refs` has `conversationId` (old hrefs would 404).
- `notification_deliveries` rows of those notifications: delete.
- Bucket `chat-attachments`: empty it; matching `storage_assets` rows with `purpose` = chat attachment: delete.
- Before the drop: `pg_dump` of the 16 tables to a file (one command, cheap insurance even though loss is accepted).

### 5.B Storage

- Bucket `chat-attachments`: keep name, new policies (above), new key layout `<channel_id>/<asset_id>/<filename>`.
- `storage_assets` (from `0178`): **reused**. `message_attachments.asset_id` already pointed at it; `chat_attachments.asset_id` does the same. `attachment_uploads` disappears because `storage_assets` already owns pending/verified/expired state, verification leases, and deletion.
- `src/lib/storage/asset-deletion.ts` references `attachmentUploads`: REWIRE.
- API `api/v1/messages/attachments/presign` and `.../[attachmentId]`: REPLACE with `api/v1/chat/attachments/…` (same two jobs).
- Project storage accounting at `src/app/actions/project/index.ts` (~line 5997) joins `message_attachments → messages → projects.conversation_id`: REWIRE to `chat_attachments → chat_channels.project_id`.
- `src/inngest/functions/account-cleanup.ts` (~line 94) has the same join: REWIRE.

### 5.C Realtime

| Current | Fate |
|---|---|
| `RealtimeProvider.tsx`: messaging channel, `messagingStatus`, `isMessagingConnected`, `subscribeMessagingNotifications`, and the `bothConnected` logic that includes messaging | REWIRE: remove messaging; keep the notification channel |
| `lib/realtime/subscriptions.ts`: `subscribeMessagingNotifications`, `MessagingNotificationEvent`, resource types `conversation`, `message_work_links` | REWIRE: delete those; keep `task`, `project_*`, `workspace`, `profile` |
| `useMessagesV2Realtime.ts` (1,135 lines), `useTypingChannel.ts`, `useConversationTypingIndex.ts`, `useChatTypingState.ts`, `lib/messages/realtime-sender.ts`, `lib/messages/unread-realtime.ts` | DROP |
| `lib/chat/typing-state.ts`, `typing-display.ts` | DROP (rewritten, smaller) |
| Presence `presence:<room>:<id>` client | KEEP (shared with non-chat features) |
| `components/chat/ChatProvider.tsx` | REWIRE: it is **presence heartbeat**, not chat. Move to `components/providers/PresenceProvider.tsx`, delete from `components/chat/` |
| `NEXT_PUBLIC_REALTIME_AUTHORIZATION_ENABLED` + `0160` policies | KEEP and extend; **must be on** wherever chat runs |

### 5.D Notifications

- `user_notifications` table and the 26 non-chat kinds: KEEP.
- `lib/notifications/types.ts`: drop kinds `message_burst`, `message_reaction`, `workflow_assigned`, `workflow_resolved`; drop mute scope `conversation`; drop preference categories `messages` (keep `mentions` only if task comments still use it).
- `lib/notifications/emitters.ts`: delete `emitMessageBurst*`, `emitMessageReaction*`.
- `lib/notifications/service.ts` (~lines 435, 474): SQL against `conversation_participants` to dismiss `message_burst` rows: DROP.
- `lib/notifications/presentation.ts` (~lines 133, 263–353): `conversationId` deep links and mute-scope matching: REWIRE/DROP.
- `UserNotificationEntityRefs` (schema ~lines 71–103) `conversationId`: DROP.
- Push: `lib/notifications/web-push.ts` (`dispatchWebPush`, `push_subscriptions`, VAPID, dead-subscription cleanup): **KEEP and reuse**; add a `Topic` header variant for chat.
- `public/sw.js`: no change (it follows `href`).
- Settings: `NotificationsSettings.tsx` messages toggle: REWIRE to the per-channel `notify` model.

### 5.E Server code

| Path | Size / count | Fate |
|---|---|---|
| `src/app/actions/messaging/{index,v2,collaboration,features,linked-work}.ts` | ≈7,400 lines, 38 exports | DROP. New: `src/app/actions/chat/*` (≈20 small functions, section 7.6) |
| `src/app/api/v1/messages/attachments/{presign,[attachmentId]}/route.ts` | 2 routes | REPLACE (`api/v1/chat/attachments/*`) |
| `src/lib/messages/*` (27 files: `attachment-access`, `attachment-storage-path`, `attention`, `code-snippets`, `conversation-display`, `date-buckets`, `delivery-state`, `image-compression`, `linked-work(-server)`, `media-metadata`, `notification-sound`, `observability`, `preview(-authority/-refresh)`, `reactions`, `realtime-sender`, `reply-preview`, `safe-links`, `structured`, `thread-items`, `thread-read-scope`, `unread-realtime`, `utils`, `v2-cache`, `v2-refresh`) | ≈3,550 lines | DROP. Salvage candidates if schema-free (decision 8): `safe-links`, `image-compression`, `media-metadata`, `code-snippets`, `date-buckets`, `notification-sound` |
| `src/lib/chat/*` (`application-events`, `banner-lifecycle`, `composer-workflow`, `typing-display`, `typing-state`) | ≈275 lines | DROP |
| `src/app/actions/shell.ts` part `messageUnreadCount` | | REPLACE with `chatSummary` |
| `src/lib/shell-batch.ts` | | REWIRE (part name) |
| `src/lib/logger.ts` messaging references | | REWIRE |
| `src/lib/account/hard-delete.ts` (deletes conversations via `dmPairs`/`projects.conversationId`) | | REWIRE (section 7.9) |
| `src/lib/account/export-stream.ts` (streams every message in every conversation the user joined; no sender filter) | | REWIRE: export **own authored messages + channel names only** (the current query appears to export other people's message content; verify and treat as a privacy defect) |

### 5.F Client code

| Path | Fate |
|---|---|
| `src/components/chat/v2/*` (33 files: `MessagesWorkspaceV2`, `MessageThreadV2`, `MessageBubbleV2`, `MessageComposerV2`, `ConversationListV2`, `ConversationHeaderV2`, `NewMessageModalV2`, `ChatPopupV2`, `ApplicationSystemCardV2`, `ApplicationsListV2`, `StructuredMessageCardV2`, `ProjectGroupsListV2`, …) | DROP. Salvage candidates if schema-free: `MentionDropdown`, `ReactionQuickBar`, `ReactionPillRow`, `ScrollToBottomFab`, `LinkPreviewCard`, `resolved-video-player`, `MessagesSurfaceSkeletons`, `EmptyConversation`, `ReportMessageDialog`, `message-attachments`, `message-rendering` |
| `components/chat/TypingIndicator.tsx` | DROP (rewritten) |
| `components/chat/v2/ChatPopupV2.tsx` | REPLACE: new `ChatLauncher` + `ChatWindow` (7.13); its idle prewarm of the old workspace and the old popup store go away |
| `components/providers/MessageAttentionProvider.tsx`, `hooks/useMessageAttentionState.ts` | DROP → `ChatShellProvider` |
| `components/providers/MainRuntimeProviders.tsx` (mounts `MessageAttentionProvider`, `ChatPopupV2`, `LazyChatProvider`) | REWIRE (mounts `ChatShellProvider`, the floating launcher, `PresenceProvider`) |
| `components/layout/AppSidebar.tsx` (`useMessageAttention`, unread dot) | REWIRE: hidden on `/messages*`, where the rail and sidebar fill its slot (7.10); `MainLayout.tsx` switches the layout |
| `hooks/useMessagesV2.ts` (951), `useMessagesV2Realtime.ts` (1,135), `useMessagesV2OutboxSync.ts`, `useMessageReceiptBuffer.ts`, `useMessageWorkLinks.ts`, `useDirectAttachmentUpload.ts` (chat-only caller is the composer; **also modified in your working tree**) | DROP / REWRITE |
| `stores/messagesV2UiStore.ts`, `stores/messagesV2OutboxStore.ts` | DROP |
| `lib/query-keys.ts` `messages.*` (`chat-v2` keys) | REPLACE with `queryKeys.chat` (the `check:query-key-contract` script enforces the registry) |
| `lib/privacy/client-invalidation.ts` (`queryKeys.messages.conversations()`) | REWIRE |
| `app/(site)/(main)/messages/{page,loading}.tsx` + `data-hardening-messages="v2"` attribute | REPLACE (new routes, section 7.10) |
| `proxy.ts` (`/messages` protected prefix), `app/robots.ts`, `constants/routes.ts` | KEEP prefix, REWIRE if route shape changes |
| `components/layout/header/global-search.ts` (context `messages`, `?search=messages`) | REWIRE (search is deferred, so the `messages` context is removed) |
| `components/settings/PrivacySettings.tsx`, onboarding `Step4Privacy.tsx`, `api/v1/privacy`, `ProfileHeader.tsx`, `ProfileV2Client.tsx`, `useConnections.ts`, `actions/connections.ts`, `actions/profile.ts`, `actions/onboarding.ts`, `lib/privacy/profile-views.ts` | KEEP; the "Message" button and DM start REWIRE to `chat_get_or_create_dm` |

### 5.G Cross-domain integrations (the ones that would silently break)

| Where | What it does today | Fate |
|---|---|---|
| `actions/workspace.ts` (~44–47), `actions/connections.ts` (~60–64) | count pending project invites from `message_workflow_items` | REWIRE to `project_invites` |
| `actions/applications/internal.ts` (~248–327, 581–597, 2929–3086) | creates DMs via `dmPairs`, stores `conversationId`, reads unread from `conversation_participants`, builds `/messages?conversationId=` links | REWIRE (application channel, `chat_channel_members.last_read_seq`, new links) |
| `actions/applications/types.ts`, `lib/chat/application-events.ts` | application system-message types | REWIRE into the application card |
| `lib/projects/collaborator-lifecycle.ts` (~191–242, 315) | creates the project conversation, syncs participants, reads invite workflow items | REWIRE to `chat_sync_project_members`, `project_invites` |
| `actions/project/index.ts`, `actions/project/guidance.ts` (`href: "/messages"`, `/messages?conversationId`) | project chat creation, links | REWIRE |
| `components/network/InvitationsClient.tsx`, `components/workspace/WorkspaceRequestsTab.tsx`, `components/projects/dashboard/ProjectDashboardClient.tsx`, `components/projects/v2/tasks/TaskDetailTabs/DetailsTab.tsx` | invite and application UIs, task-to-message link | REWIRE |
| `lib/account/hard-delete.ts`, `inngest/functions/account-cleanup.ts`, `components/settings/AccountDeletionWizard.tsx` | delete conversations / chat storage | REWIRE |
| Web push tray and bell | message rows | see 5.D |

### 5.H Background jobs

| Job | Fate |
|---|---|
| `inngest/functions/message-attachment-retention.ts` (cron every 2h, drains `attachment_uploads`) | DROP: `storage_assets` already expires and deletes pending assets |
| `inngest/functions/message-data-integrity-audit.ts` (raw SQL over `conversation_participants`, `messages`, `dm_pairs`) | REPLACE: `chat-integrity-audit` (checks `chat_channels.last_seq = max(channel_seq)` on a sample, orphan cards, member-cap violations) |
| `inngest/functions/notification-fanout.ts`, `notification-push-delivery.ts` | KEEP (non-chat kinds) |
| new: `chat-mentions-retention` (delete `chat_mentions` older than 90 days, batched) | NEW |
| new: `chat-account-anonymize` (batched `author_id = NULL` before profile deletion) | NEW |
| `inngest/registry.ts` | REWIRE |

### 5.I Scripts, tests, docs, config

- Scripts to delete or rewrite: `check-messages-database.ts` (→ `check-chat-database.ts`), `check-rls-contract.ts`, `check-authz-contract.ts`, `check-db-catalog-drift.ts`, `check-db-remigration-replay.ts`, `patch_rls.js`, `seed-e2e-fixtures.ts`, `cleanup-e2e-fixtures.ts`, `check-global-search-contract.ts`, and `check-query-key-contract.ts` (registry change).
- Unit tests that reference messaging (47 files in `tests/unit`, 5 in `tests/e2e`): delete the ones that test removed code; rewrite the ones that test kept features. Full list: section 14.
- E2E: `messaging-smoke`, `messaging-unread-rebound`, `messages-tabs-matrix` → replaced; `application-flow-smoke`, `mobile`, `workspace-matrix`, `global-search-contexts` → updated.
- Docs: `docs/plans/messages-1m-optimization-implementation-plan.md` and the messaging parts of `docs/archive/*`, `docs/design/*`, `docs/audits/ponytail-supabase-rendering-audit-2026-07-11.md`: mark **superseded** at the top, link to this report. New permanent doc: `docs/architecture/messaging.md` (written in Phase 6 from section 7).
- Migration tooling: `drizzle/meta/_journal.json` is already modified in your working tree; next migration number is `0179`; `check:db:migration-journal`, `check:db:migration-sources`, `check:db:remigration-replay`, `check:db-catalog-drift` must pass with hand-written partition SQL (Drizzle cannot express `PARTITION BY HASH`).

### 5.J Browser-side state on existing users' devices

| Key / cache | Fate |
|---|---|
| localStorage `messages-v2-ui` (attention) | purge once |
| localStorage `messages-v2-outbox` (unsent messages; would replay against a dead API) | purge once |
| TanStack keys `chat-v2`, `["chat","conversations"]`, `["chat","targetUser"]` | gone with `query-keys.ts` change |
| `utils/cache-manager.ts` `localStorage.clear()` | KEEP |

The one-time purge ships in the root layout for one release, then is deleted (ledger item L-14).

### 5.K Existing `ponytail:` markers in the messaging domain (from `ponytail-debt`)

16 markers in messaging files (3 more in `lib/realtime/task-resource.ts` and `project-files-channel.ts` are not messaging and stay; `lib/db/index.ts:50` is outside the domain but shapes the design, so it is listed). Disposition:

| Marker (file) | Ceiling it named | Fate |
|---|---|---|
| `ChatProvider.tsx:14` presence heartbeat 10 min | 1,000,000 users | **carried** to `PresenceProvider` |
| `useTypingChannel.ts:36` typing throttle 3.5 s | 50 active users/room | **carried** (becomes L-7) |
| `MessageThreadV2.tsx:164` receipt batching 1 s | 1000 ms | dies (no receipts) |
| `MessageThreadV2.tsx:402`, `MessageBubbleV2.tsx:223` virtuoso index / scroll capture | local index map | re-evaluated in the new list, not copied |
| `structured.ts:479` media caption rule | static descriptor | dies |
| `v2-cache.ts:88` out-of-order reaction summaries | latest timestamp | dies (reactions are rows) |
| `useMessageWorkLinks.ts:32` deferred work links | 30 s stale | dies (cards hydrate with the page) |
| `actions/messaging/index.ts:1851, 3315` read-watermark no-op; insert trigger owns ordering | row already read; attachments > 0 | dies |
| `useMessagesV2Realtime.ts:645, 976` participant watermarks as receipt fallback | watermark timestamp | dies |
| `useMessagesV2.ts:235` inbox previews | cached pages | dies (previews return as `chat_channels.last_preview`) |
| `MessageAttentionProvider.tsx:49, 79, 148` query-key memo, identity reset, cache patch | static key | dies |
| `lib/db/index.ts:50` parameterised queries pay a Describe round trip | transaction pooler 6543 | **relevant** (drives the one-function send path, section 8.6) |

Checked with grep: every one of the 16 names an upgrade trigger. 16 markers, 0 without a trigger.

### 5.L Re-audit result: "is anything still linked?"

After the plan in this section is executed, three checks must all return zero (section 10.3): a catalog query, an identifier grep, and the rebuilt drift/RLS/authz scripts. The areas most easily missed, and now covered above, are: invites living only in workflow rows; the upload-session table; `message_privacy` and blocks enforcement; `notifications/service.ts` raw SQL; project storage accounting; account export and deletion; `RealtimeProvider`'s messaging channel; browser-persisted stores; and the presence provider disguised as `ChatProvider`.

---

## 6. Ponytail cut list (what we will not build)

| Cut | Why (ladder rung) | Ledger |
|---|---|---|
| `group_dm` kind | a private channel without a name is the same thing (1) | none |
| `application` kind | a private channel with `application_id` set (1) | none |
| Slugs, channel handles | URLs use ids; nobody asked (1) | L-9 |
| Per-message notification rows | unread is derived; rows are the cost centre (1, 4) | none |
| Reaction notifications | not needed for Slack parity at entry level (1) | L-10 |
| Delivery/read receipts, edit history, hide-for-me | Slack has none of them (1) | none |
| `chat_upload_sessions` | `storage_assets` already is one (2) | none |
| Live presence dots | heartbeat "active recently" is enough for DMs (2) | L-8 |
| Global public channels | spam, browse, `@channel` fan-out at 1M (1) | L-5 |
| Full-text search index | write amplification on the hottest table; build later with a measured target (1) | L-4 |
| Tick topics per channel for background unread | 100 channel/connection limit and cost (8.3) | L-2 |
| Redis on the send path | 700 commands/s of billed requests for a limit an in-memory bucket does (8.4) | L-3 |
| Persisted outbox | failed sends stay visible with Retry until reload (1) | none |
| Inngest event per message | billed per event; push goes direct (8.4) | L-11 |
| New emoji-picker dependency | quick bar + OS picker (5) | L-12 |
| Launcher keyboard shortcut, draggable or resizable window, auto-open on incoming message | the button and the badge cover the need (1) | L-26 |
| Slack features outside v1: Huddles, Canvas, Agents and apps, a Files rail item, the "Set up your space" card, audio and video clips, scheduled send, Saved items, custom status text, underline formatting | calls, bots, and workflows are non-goals; the rest has no v1 owner (1) | L-27, L-31 |
| Custom markdown parser | `react-markdown` is installed (5) | none |

---

## 7. Target architecture

### 7.1 Channel model (the project is the workspace)

| `kind` | Scope | Who can see and join | Rules |
|---|---|---|---|
| `public` | one project (`project_id` set) | any member of that project can browse and join | named, unique per project. Exactly one per project is the **default** (`is_default`, `#general`): every member joins it automatically and it cannot be left or archived |
| `private` | usually one project; `project_id` null for group chats | invited members only | a named channel, or an unnamed group chat (name null). Application threads are private channels with `application_id` set (unique) |
| `dm` | platform-wide, no project | the two users (one user for the self-DM "You") | found by `dm_key = least(a,b) || ':' || greatest(a,b)`, unique; `chat_can_dm` applies |

Rules:
- A project is the workspace: its channels exist only for its members. Joining a project adds the user to the default channel only; every other channel is joined by choice (public) or invitation (private). Leaving or being removed from the project removes the user from all of its channels at once.
- Names: lowercase letters, digits, and hyphens, 1 to 80 characters (CHECK), unique per project, case-insensitive, public and private together.
- Any project member can create public or private channels (D6). The creator and project admins can rename, edit the topic, and archive, except the default channel.
- Direct messages belong to no project and appear under Home and in every project sidebar.

Roles: `owner` (the channel creator; the project owner for the default channel), `admin` (project admins), `member`. Authors edit and delete their own messages; channel owners and admins delete anyone's and pin.

Constants (one place, `ponytail:` commented): `MAX_MEMBERS = 500` per channel, `MAX_CHANNELS_PER_USER = 500`, `MAX_CHANNELS_PER_PROJECT = 200`, `MAX_BODY = 4000`, `MAX_DESCRIPTION = 250`, `TYPING_MAX_MEMBERS = 50`.

### 7.2 Tables

Hash-partitioned by `channel_id` into **32** partitions: `chat_messages`, `chat_attachments`, `chat_reactions`. The count is fixed at creation (changing it means a rebuild), which is why it is decided now: this is the one place we spend effort ahead of need, because retrofitting partitioning onto billions of rows is not realistic.

**`chat_channels`**

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `kind` | text | CHECK in (`public`,`private`,`dm`) |
| `name` | text null | required for `public`; optional for `private` (null means a group chat); CHECK `^[a-z0-9-]{1,80}$` when set |
| `topic` | text null | |
| `description` | text null | at most 250 characters; shown in Browse channels and the channel intro |
| `is_default` | bool not null default false | partial unique `(project_id) WHERE is_default`; the project's `#general` |
| `project_id` | uuid null | FK `projects` ON DELETE CASCADE; null only for DMs and group chats; unique `(project_id, lower(name)) WHERE name IS NOT NULL` |
| `application_id` | uuid null | FK `role_applications` ON DELETE CASCADE; unique |
| `dm_key` | text null | unique; CHECK required when `kind='dm'` |
| `created_by` | uuid null | |
| `last_seq` | bigint not null default 0 | hot column, **not indexed** |
| `last_message_at` | timestamptz null | hot column, **not indexed** |
| `member_count` | int not null default 0 | hot-ish, not indexed |
| `last_preview` | text null | at most 120 characters, written by `chat_send_message`; hot column, **not indexed** (design spec: list rows show a preview) |
| `last_author_id` | uuid null | for the "You:" / name prefix in the preview; hot column, **not indexed** |
| `archived_at` | timestamptz null | |
| `created_at` | timestamptz | |

`fillfactor = 70` so per-message updates stay HOT (no index rewrite). Extra index for Browse channels: `(project_id, kind) WHERE archived_at IS NULL AND project_id IS NOT NULL`; the result is bounded by 200 channels per project.

**`chat_channel_members`** — PK `(channel_id, user_id)`; secondary index `(user_id, channel_id)` for bootstrap; `role`, `last_read_seq bigint default 0`, `mention_count int default 0`, `notify` (`all`/`mentions`/`mute`, default `all`), `starred bool`, `archived_at timestamptz null`, `joined_at`. `fillfactor = 80`. No `INCLUDE` columns (they would break HOT updates on `last_read_seq`).

**`chat_messages`** (partitioned) — PK `(channel_id, channel_seq)`.
Columns: `author_id uuid null` (FK `profiles` ON DELETE SET NULL), `kind` (`user`/`system`), `body text` (≤4000), `thread_root_seq bigint null`, `reply_count int default 0`, `last_reply_seq bigint null`, `last_reply_at timestamptz null`, `client_message_id text null` (1–160 chars), `edited_at`, `deleted_at`, `created_at`.
Indexes: unique `(channel_id, author_id, client_message_id) WHERE client_message_id IS NOT NULL`; `(channel_id, thread_root_seq, channel_seq) WHERE thread_root_seq IS NOT NULL`; `(author_id, channel_id, channel_seq)` for account export and deletion jobs.
Timeline paging uses the PK with `thread_root_seq IS NULL` as a filter (ceiling: channels where most messages are thread replies).

**`chat_message_cards`** — PK `(channel_id, message_seq)`; `kind` (`application`/`task`/`invite`); `ref_id uuid`; `snapshot jsonb` (fallback if the source row is deleted or hidden); index `(kind, ref_id)`.

**`chat_attachments`** (partitioned) — PK `(channel_id, message_seq, idx)`; `asset_id uuid` FK `storage_assets`; `mime`, `size`, `width`, `height`.

**`chat_reactions`** (partitioned) — PK `(channel_id, message_seq, user_id, emoji)`; `created_at`.

**`chat_mentions`** — PK `(user_id, channel_id, message_seq)`; `kind` (`user`/`channel`/`here`/`thread_reply`); `created_at`; index `(user_id, created_at desc)`. This table is the **Activity** feed.

**`chat_thread_follows`** — PK `(user_id, channel_id, root_seq)`; `last_read_seq`.

**`chat_pins`** — PK `(channel_id, message_seq)`; `pinned_by`, `pinned_at`.

**`chat_reports`** — `id uuid PK`, `(channel_id, message_seq)`, `reporter_id`, `reason`, `status` default `open`, `created_at`; index `(status, created_at)`.

**Outside chat: `project_invites`** — `id`, `project_id`, `role_id null`, `inviter_id`, `invitee_id`, `status` (`pending`/`accepted`/`declined`/`canceled`/`expired`), `message`, `expires_at`, `decided_at`, `created_at`; unique `(project_id, invitee_id) WHERE status='pending'`; index `(invitee_id, status)`.

All `chat_*` FKs to messages are composite `(channel_id, message_seq) → chat_messages(channel_id, channel_seq)`, `ON DELETE CASCADE`.

### 7.3 SQL functions, triggers, policies

| Object | Purpose |
|---|---|
| `app_private.chat_is_member(channel, user)` | STABLE, SECURITY DEFINER; one PK lookup. Used by RLS, by Realtime policies, and inside every write function |
| `app_private.chat_can_dm(a, b)` | `profiles.message_privacy` (`everyone`/`connections`) plus `connections.status='blocked'` in either direction; a user can always message themselves (the self-DM) |
| `chat_get_or_create_dm(a, b)` | `INSERT … ON CONFLICT (dm_key) DO NOTHING`, then select; calls `chat_can_dm` |
| `chat_send_message(channel, author, body, client_id, thread_root_seq, mention_ids uuid[], attachments jsonb, card jsonb)` | **One round trip.** Checks membership and archive state; `UPDATE chat_channels SET last_seq = last_seq + 1, last_message_at = now() RETURNING last_seq` (the row lock serialises per channel and gives a gap-free, commit-ordered `channel_seq`); inserts message, attachments, card; bumps thread root (`reply_count`, `last_reply_seq`, `last_reply_at`) and upserts the author's `chat_thread_follows`; inserts `chat_mentions`; increments `mention_count` for mentioned members; for `@channel`/`@here` rejects if `member_count > 100` (ledger L-13). Sets `chat_channels.last_preview` / `last_author_id`; clears `archived_at` for the other DM member and for mentioned members (a new DM or mention un-archives); idempotent on `client_message_id` |
| `chat_mark_read(channel, user, seq)` | `UPDATE … SET last_read_seq = $seq, mention_count = 0 WHERE … AND last_read_seq < $seq` (no-op when not newer, so no dead tuples) |
| `chat_edit_message(channel, seq, user, body)` / `chat_delete_message(channel, seq, user)` | author or channel admin only; set `edited_at` / `deleted_at`; when `channel_seq = last_seq` also refresh `last_preview` (delete shows "Message deleted"; L-21) |
| `chat_bootstrap(user, since timestamptz null)` | section 7.5 |
| `chat_sync_project_members(project)` | on project creation: create the default channel; on join: add the user to the default channel; on leave or removal: delete the user's membership in every channel of that project, public and private, in one statement |
| `chat_add_members(channel, users uuid[])` | enforces `MAX_MEMBERS`, `MAX_CHANNELS_PER_USER`, `chat_can_dm` for new DMs |
| `chat_create_channel(project, user, name, description, is_private)` | the creator must be a project member; enforces the name rule, per-project uniqueness, and `MAX_CHANNELS_PER_PROJECT`; creates the channel, adds the creator as owner, posts a system message |
| `chat_join_channel(channel, user)` / `chat_leave_channel(channel, user)` | join only for `public` channels of a project the user belongs to; leave refused for the default channel; both post a system message and respect `MAX_MEMBERS` |
| Triggers (3, column-restricted): `tasks AFTER UPDATE OF status, assignee_id, title, priority, due_date`; `role_applications AFTER UPDATE OF status`; `project_invites AFTER UPDATE OF status` | look up `chat_message_cards` by `(kind, ref_id)` and `realtime.send` a `card.changed` to each channel topic (typically 1–3) |
| RLS | every `chat_*` table: SELECT policy `chat_is_member(channel_id, (select auth.uid()))`; **no** INSERT/UPDATE/DELETE policy for `authenticated` (writes go through the functions via the server role). `chat_channels` additionally allows SELECT of a project's public channels to that project's members, for Browse channels; their messages stay member-only |
| `realtime.messages` | `chat_topic_read`: `chat:channel:<id>` → `chat_is_member`; `chat:user:<id>` → equals `auth.uid()`. `chat_topic_send`: broadcast on `chat:channel:<id>` only for members (typing) |

Runtime role grants follow `check:db:runtime-role`; `GRANT EXECUTE` is explicit per function.

### 7.4 Write path

1. Client: optimistic row with `client_message_id`; in-memory token bucket (per instance) rejects abuse early.
2. Server action `sendMessage`: validates input, calls `chat_send_message` (one statement, one round trip).
3. Returns `{channel_seq, created_at}`; client reconciles.
4. **After the response** (Next.js `after()`): (a) one batched Realtime REST call publishes `message.new` to `chat:channel:<id>` and a small `hint` to `chat:user:<id>` for DM recipients and mentioned users; (b) push to DM recipients and mentioned users via the existing `web-push.ts` with a `Topic` header.
5. Publishing is **best-effort**: a crash between commit and publish loses only the live event; recovery is the catch-up fetch (7.5). Ledger L-1.

### 7.5 Read path and app entry

- **Timeline:** cursor page `WHERE channel_id = $1 AND channel_seq < $2 AND thread_root_seq IS NULL ORDER BY channel_seq DESC LIMIT 50`; virtualised with `react-virtuoso`.
- **Thread:** `WHERE channel_id = $1 AND thread_root_seq = $2 ORDER BY channel_seq`.
- **Card hydration:** batch per page: one query each for `role_applications`, `tasks`, `project_invites`, joined with the viewer's access check; restricted placeholder if not allowed.
- **Entry:** one shell part `chatSummary` = `chat_bootstrap(user)` returning joined channels (`id`, `kind`, `project_id`, `is_default`, `name` or the other user's profile for DMs, `last_seq`, `last_read_seq`, `mention_count`, `notify`, `starred`, `last_message_at`, `last_preview`, `last_author_id`, `archived_at`; DMs capped to the 100 most recent), the badge total (mentions + unread DMs), and pending invites/applications counts from their real tables. Replaces the old unread fetch, inbox summaries, and "startup-sync".
- **Project switching (D4):** the bootstrap holds every joined channel with its `project_id`, so selecting a project in the rail filters in memory with no request, and per-project badges are summed client-side. The last-open channel per project is remembered in localStorage (`chat-last:<projectId>`).
- **Unread flags for channels not open:** a **bootstrap poll**: `chat_bootstrap(user, since)` every 90 s ± 30 s jitter while the tab is visible, on focus, and on reconnect. It returns only channels whose `last_message_at > since` (no index needed: it filters the user's ≤500 memberships). DMs and mentions arrive instantly through the user-topic hint. Ledger L-2.
- **Multi-tab and devices:** `read.moved` events on the user topic keep cursors in sync.
- **Reconnect catch-up:** for the open channel `GET after=<last seen channel_seq>`; then bootstrap.
- **Browser storage:** drafts per channel and last-open channel only.

### 7.6 Server functions (replaces 38 exports)

`createChannel`, `updateChannel`, `archiveChannel`, `joinChannel`, `leaveChannel`, `browseChannels`, `addMembers`, `removeMember`, `getOrCreateDm`, `sendMessage`, `editMessage`, `deleteMessage`, `listMessages`, `listThread`, `react`, `pin`, `markRead`, `setMemberState` (notify, star, archive), `bootstrap`, `presignUpload`, `reportMessage`, `hydrateCards`. Pausing notifications reuses the existing notification-preferences action (`pausedUntil`). Each is one file (one query, or one SQL function call).

### 7.7 Realtime

- Topics: `chat:channel:<id>` (open channel only) and `chat:user:<id>` (always). Private Broadcast, authorised by `realtime.messages` policies.
- Channel events: `message.new`, `message.edit`, `message.delete`, `reaction.add`, `reaction.remove`, `typing` (client-sent; only when `member_count <= 50`; throttled 3.5 s), `card.changed`, `member.changed`, `pin.changed`.
- User events: `hint` (`channel_id`, `seq`, `mention?`), `invite`, `read.moved`.
- Publishing: server → Realtime REST `POST /realtime/v1/api/broadcast` with an array of messages (one HTTP call per sent message); DB triggers publish only `card.changed`.
- Channels per connection: notifications + presence + up to 4 existing resource channels + 2 chat = well under the **100** limit [verified].
- Reconnect storms: `supabase-js` backoff plus our jitter; limit is 2,500 joins/s [verified], so 130k reconnecting tabs would take ≥52 s without jitter and is spread by it.

### 7.8 Notifications

- **Bell tray (`user_notifications`)**: unchanged, non-chat only. `chat_invite` is the only new chat kind (rare, real row), because an invite is an actionable object.
- **Chat unread**: badge on the Messages icon = mentions + unread DMs; unread channels bold; an **Activity** view lists `chat_mentions` (mentions, thread replies) newest first.
- **Per-channel `notify`**: `all` / `mentions` / `mute`, stored on the member row; replaces the `conversation` mute scope. Existing quiet hours and push preferences are reused.
- **Push**: DM recipients, mentioned users, invites. Sent directly (no Inngest, no notification row) through `web-push.ts`; `Topic: <channel_id>` so the push service keeps only the latest pending push per channel; in-memory 30 s per (user, channel) suppression per instance.
- **Deep link**: `/messages/<channelId>?m=<seq>`.

### 7.9 Privacy, lifecycle, abuse

- **Who can DM:** `chat_can_dm` inside `chat_get_or_create_dm` and inside `chat_send_message` for DMs: `message_privacy` + blocks. A block after the DM exists disables the composer (server enforced).
- **Account deletion:** (1) Inngest `chat-account-anonymize` sets `author_id = NULL` in batches by the author index, (2) DM channels with the user are deleted, (3) private group channels keep the messages shown as "Deleted user", (4) project channels go with the project (`ON DELETE CASCADE`), (5) attachments go through `storage_assets` deletion.
- **Account export:** own authored messages (via the author index) + channel names. Not other people's content.
- **Project membership:** `collaborator-lifecycle.ts` calls `chat_sync_project_members` on project creation, join, leave, removal, and role change (default channel on join; every project channel removed at once on leave or removal). A private project's channels are visible only to its members, as always.
- **Rate limits:** sends and reactions: in-memory bucket per instance. DM start, invites, reports, presign: Redis `rateLimit()` (low volume, abuse-prone).
- **Moderation:** `chat_reports` only; no admin UI in v1 (L-15).
- **Retention:** `chat_mentions` 90 days; messages indefinitely (L-16).

### 7.10 Slack-style layout, routes, and UI (decisions D1–D15 accepted)

We take Slack's structure and behaviour (project switcher rail, sectioned sidebar, one conversation view for channels and DMs, thread drawer) and express it in our own tokens and wording. We do not copy Slack's branding, colours, or assets. **The project is the workspace.**

**Placement in the app shell (D2).** On `/messages*` the 248px global sidebar slot is replaced by a **64px rail plus a 248px sidebar** (312px). The 56px topbar stays. The NB mark at the top of the rail opens the global navigation drawer (Discover, Network, Messages, My profile, Workspaces, Settings). At 1280px the timeline gets 968px; at 1024px it gets 712px. The 320px thread and details drawer overlays the timeline; it is never a fourth pane.

**Colour (D1).** Rail and sidebar use the spec's inverse tokens: background `--surface-inverse` (ink-900), text `--text-inverse-muted`, selected row `--surface-inverse-raised` with `--text-inverse`, unread rows `--text-inverse` at weight 600, counts as a clay pill (`--surface-accent` with `--on-accent`), selected project tile with a paper ring. The timeline is white and paper. In dark mode the inverse chrome stays dark.

**Macro layout: project view (desktop, 1024px and wider)**

```
┌ topbar 56 ───────────────────────────────────────────────────────────────────────────┐
│ [NB]                  [ Search Payments ............................... ]          ? │
├────┬──────────────────┬──────────────────────────────────────────────────────────────┤
│Home│ Payments  v  ⚙ ✎ │ ☆ # general  Topic text…          (avatars) 8  [bell v]  [⋯] │
│    │ [Find a convers.]│ Messages | Pins                                              │
│[P1]│ Threads          ├──────────────────────────────────────────────────────────────┤
│[P2]│ Activity         │ Everyone's all here in #general                              │
│[P3]│ ─────────        │ Description…   [Set a topic] [Invite teammates] [Create task]│
│    │ v Channels       │ ───────────── Tuesday, Sep 29 ─────────────                  │
│    │  # general       │ [av] Priya  8:31   Who can pick up the refund flow?          │
│    │  # design    [2] │      3 replies · last reply 2h ago                           │
│    │  🔒 backend      │ [av] NB     8:40   [ Application card ]  [ Task card ]       │
│    │  + Browse chans  │ ─────────────── New ───────────────                          │
│    │ v Applications 1 │ [av] Marcus 9:02   joined #design (system line)              │
│    │ v Direct msgs    │ ┌ composer ────────────────────────────────────────────────┐ │
│    │  ● Priya     [1] │ │ B I S link 1. • quote code code-block   (shown by Aa)    │ │
│    │  ○ You           │ │ Message #general                                         │ │
│    │  + Invite people │ │ [+] [Aa] [:)] [@] [/]                          [Send]    │ │
│ [+]│                  │ └──────────────────────────────────────────────────────────┘ │
│ (☾)│                  │   Priya is typing…                                           │
│(me)│                  │                                                              │
└────┴──────────────────┴──────────────────────────────────────────────────────────────┘
        rail 64         sidebar 248                       timeline (flexible)
        thread and details open as a 320px drawer over the right side of the timeline
```

**The rail (64px)**

| Item | Behaviour |
|---|---|
| NB mark (top) | opens the global navigation drawer |
| Home | DMs, Activity, Threads, Starred, and your applications, across projects. Badge = unread DMs plus mentions in DMs |
| Project tiles (scrolling list) | one 40px squared tile (5px radius) per project you belong to, with initials or the cover thumbnail; the selected tile has a paper ring; the tooltip shows the name. Badge = mentions plus unread in that project's channels. Order: most recent activity first (L-30). **Selecting a tile switches the whole sidebar to that project instantly** (D4) |
| "+" (bottom) | menu: New message, Create channel (in the current project), New project |
| Moon | pauses notifications through the existing `pausedUntil`: 30 minutes, 1 hour, until tomorrow, or resume. While paused the moon is filled; badges still count, push and sound are suppressed (D12) |
| Avatar with presence dot | menu: Active or Away (derived from the 10-minute heartbeat), View profile, Settings. Custom status text is cut |

**The sidebar (248px; rows 32px on desktop, 44px on touch)**

| Part | Behaviour |
|---|---|
| Header, 56px | project name with a chevron (menu: Switch project, Invite people, Project settings, Show unreads only, Mark all read), a gear (Messaging preferences), a compose icon (New message) |
| "Find a conversation" box | opens the quick switcher (below) |
| Fixed rows | **Threads** and **Activity**, each with a count |
| **Starred** | shown only when something is starred |
| **Channels** (collapsible; "+" on hover) | `#` or lock icon and name; unread rows are bold; mention count as a clay pill; muted rows are dimmed; then a **Browse channels** row |
| **Applications** | shown to project reviewers, with a pending count; applicants see "My applications" under Home |
| **Direct messages** (collapsible) | the most recent 8 with a presence dot, a "Show more" row, your self-DM "You", and (for project owners and admins) an **Invite people** row that opens the project invite flow. The full list with previews is `/messages/dms` (L-30) |
| Collapse state | stored in localStorage per section (`chat-ui-v1`) |

**Home view.** Same sidebar, with Threads, Activity, Starred, all Direct messages, and My applications instead of a project's channels. The main pane is the last conversation.

**Channel view (and every other conversation)**

| Part | Behaviour |
|---|---|
| Header, 56px | star; `#` or lock plus name (17px, weight 600) with the topic as one truncated line; members button (three avatars and the count, opens the drawer on Members); bell menu (All messages, Mentions only, Mute); more menu (Copy link, Edit topic and description, Add people, Mark all read, Leave channel, Archive channel). The search icon is hidden until message search exists (L-28; the spec's restraint rule forbids disabled controls) |
| Tabs | **Messages** and **Pins**. A Files tab is v1.1 (L-27). Canvas is cut |
| Intro block (at the start of history) | channel name at 24px, description, who created it and when, and up to three actions: Set a topic, Invite teammates (opens the project invite flow), Create a task |
| Timeline | sticky day label (12px mono with rules); messages grouped by author within 5 minutes with the time on hover; system lines (joined, left, topic changed, renamed) as one muted 13px line; a "New" divider (clay label and line); "N replies" line with up to three replier avatars and "last reply 2h ago", opening the drawer; reactions; scroll-to-latest button with an unread count |
| Message hover toolbar | three quick reactions, Reply in thread, Pin, and a more menu (Copy link, Mark unread, Edit, Delete, Report). Save for later is cut |
| Typing line | below the composer, only in channels of 50 members or fewer |

**Composer (D9)**
- A plain textarea (no editor dependency). **Aa** toggles a formatting toolbar: bold, italic, strikethrough, link, ordered list, bullet list, quote, code, code block. Each button inserts markdown around the selection; the stored body is plain text with markdown, rendered by `react-markdown`. Underline is not offered because markdown has none. The Aa state persists in localStorage.
- Bottom row: **+** (Upload file, Create task), **Aa**, emoji (quick bar plus the OS emoji keyboard, L-12), **@** (mention picker), **/** (slash commands: only `/task` in v1), and **Send** (clay, the one primary action in the view). Enter sends, Shift+Enter adds a line, Up edits your last message. No audio or video clips and no scheduled send.
- Placeholder: "Message #name" or "Message Priya". Drafts per conversation. The thread composer is the same without a toolbar. "Also send to the channel" is not offered (L-31).

**Direct messages (D8)**

```
┌ header ─────────────────────────────────────────────────────────────┐
│ [av ●] Priya   Active recently            [View profile] [details] [⋯]│
├─────────────────────────────────────────────────────────────────────┤
│  (big avatar)  Priya                                                │
│  This conversation is just between you and Priya.   [View profile]  │
│  ─────────── Tuesday, Sep 29 ───────────                            │
│  the same message rows, threads, cards, reactions                   │
├─────────────────────────────────────────────────────────────────────┤
│ the same composer. If privacy or a block applies, a notice replaces it│
└─────────────────────────────────────────────────────────────────────┘
```
- Group chats are unnamed private channels; the header shows stacked avatars and the member names, and the drawer's Members tab has Add people. The self-DM is titled "You (notes to self)".
- **New message** (`/messages/new`): a "To:" field of person chips (people allowed by `chat_can_dm`, from the existing eligible-people search, rate limited) and the composer. The DM is created on the first send. One recipient opens or creates the DM; more than one creates a group chat. If a conversation with the same people exists, it opens.
- "Close conversation" in the more menu archives the DM for you (`archived_at`); a new message or mention brings it back.

**Browse channels and Create channel (D5, D6)**

```
┌ Browse channels in Payments ──────────── [ Filter … ]   [Create channel] ┐
│ # general   Everyone's here ........................ 8 members  [Joined]  │
│ # design    UI work ................................ 5 members  [Join]    │
│ (private channels are never listed; archived ones are hidden)             │
└───────────────────────────────────────────────────────────────────────────┘
```
The filter is client-side. Join runs `chat_join_channel` and posts a "joined" system line. Create channel is a 12px dialog: name (live validation of the name rule), description (optional, 250 characters), a "Make private" switch, and Create. The per-project cap is 200.

**Details drawer (320px).** Tabs: **About** (topic, description, creator and date, a "Default channel" label), **Members** (list with presence, Add people, Remove for admins), **Pins**, **Settings** (notifications: all, mentions, or mute; Star; Copy link; Leave; Archive). For a DM it shows the person's profile summary, Mute, and Close conversation.

**Quick switcher (D11).** Ctrl or Cmd+K, the "Find a conversation" box, and the topbar search while in Messages all open the same panel. It filters joined channels, DMs, and project members in memory, and adds person results through the existing people search once the query has 2 or more characters. Results are grouped (Channels, People); Enter opens one. It does not search message text (L-4).

**Applications and invites.** Application threads (private channels with the application card as their first message) appear under Applications for reviewers and under Home for the applicant. Invite cards arrive in a DM from the inviter and in Activity; accepting calls the existing invite action.

**Keyboard.** Ctrl or Cmd+K switcher; Enter send; Shift+Enter newline; Up edit last; `/task`; Esc closes a drawer, sheet, or switcher.

**Routes**

| Route | Shows |
|---|---|
| `/messages` | the last-open conversation, else Home |
| `/messages/[channelId]` | a channel or DM (project derived from the channel) |
| `/messages/[channelId]/thread/[seq]` | the thread (drawer on desktop, full screen on mobile) |
| `/messages/[channelId]/details` | the details drawer or screen |
| `/messages/p/[projectId]` | project landing: last-open channel in that project, else the default channel |
| `/messages/p/[projectId]/browse` | Browse channels |
| `/messages/home`, `/messages/dms` | Home; the full DM list with preview rows |
| `/messages/activity`, `/messages/threads` | Activity (from `chat_mentions`); threads you follow |
| `/messages/new` | New message |

Deep links use `?m=<seq>`.

**Message rendering.** Body stored as plain text with tokens `<@user-id>`, `<#channel-id>`, `<!here>`; rendered with `react-markdown` (links through `safe-links`); mention chips; link preview via `/api/v1/link-preview`; "(edited)" and a deleted placeholder.

**Cards.** Registry `kind → component` (application, task, invite), each with action buttons that call the **existing** domain actions (accept or decline an application, change task status, accept or decline an invite). A restricted placeholder shows when the viewer lacks access.

**Accessibility.** The timeline is `role="log"` with a live region for new messages; focus returns to the trigger when a drawer closes; every icon button has a label; the rail and sidebar are real navigation landmarks with section headings.

### 7.11 Design conformance (binding; decisions A1–A8 accepted)

The UI follows `docs/design/networkbase-application-design-specification.html` (sections 04, 05, 09, 27) and the mobile contract in `docs/audits/mobile-redesign-report-2026-09-29.md` (rules R1–R18, desktop freeze §4). Where this report and the spec disagree, the spec wins, except the additions and deviations listed at the end of this section.

**Tokens**

| Item | Rule |
|---|---|
| Families | Instrument Sans for UI and message body; JetBrains Mono for timestamps, counts, micro labels, and code; Instrument Serif is not used in chat |
| Type scale | message body 15px, author name 13px, time 12px mono, thread-header name 17px, micro labels 11px mono uppercase, code 13px (14px on touch) |
| Colour | clay, ink, paper, and status tokens only; no raw zinc, rose, blue, or amber classes (rule R17). Unread divider is a clay label plus a thin line; counts use `.nb-nav-count`; the own-message well is paper |
| Geometry | avatar 34px squared with 5px radius; control 5px; card 8px; panel and dialog 12px; badge 3px |
| Elevation and motion | `md` shadow for popovers; duration tokens become 0ms under reduced motion |
| Layers | sticky 10, chrome and launcher 20, popover and popup window 30, drawer 40, scrim 50, dialog 51, toast 60, tooltip 70 (A8; today's launcher uses `z-50`, which collides with the scrim) |

**Layout (D2).** The desktop and mobile layouts are specified in 7.10 (Slack-style shell) and 7.12. This section holds the tokens, message rows, enforcement, and spec amendments that apply to all of them.

**Rows and previews (A1, A5).** Sidebar rows are compact (32px on desktop, 44px on touch). Preview rows (64–72px: 34px squared avatar, title, a preview line from `chat_channels.last_preview` prefixed "You:" or the author's first name, mono timestamp, unread count) are used in the full DM list (`/messages/dms`), the Activity view, and the DM rows of the mobile and launcher list. DM and application rows show the unread count (`last_seq - last_read_seq`, L-25); channels show bold plus the mention count only. Per-user states live on `chat_channel_members`: `notify`, `starred`, `archived_at`; a new DM or mention un-archives.

**Messages (A4)**
- Author-led, left-aligned rows: name 13px/500, time 12px mono, body 15px; 8–12px between related messages, 20px between groups. Own messages use the spec's restrained paper well with ink text and 8px corners; author and edited/deleted markers stay explicit.
- Date separators: 12px mono date with thin rules. Unread divider: clay label plus line. The current day's label is sticky while scrolling (jump-to-date is deferred, L-29).
- Reactions: small neutral outlined chips with a mono count; selected state is a paper or clay outline. A quick bar of 6 plus the OS emoji keyboard (L-12).
- Actions: 16px icons in a hover or keyboard-focus rail on desktop; the same actions as a long-press sheet on touch (7.12). Reply, copy, edit, delete, pin, and report keep their permissions and confirmations.
- Reply preview: sunken compact block above the composer with author and a one- or two-line excerpt. Composer: white container with a top rule; 2 lines growing to 160px; attachment strip above; formatting toolbar (toggled by Aa), toolbar row, and Send below; drafts per channel (details in 7.10).
- Attachments, code and link previews, and application, task, and invite cards: as the spec's section 27 (typographic file chips, mono code well, thin white context cards).
- Errors: persistent notice at the thread and composer boundary, never replacing loaded history. A scroll-to-bottom button with an unread count; new messages never move a user who is reading older content.

**Enforcement (A6).** Extend `scripts/check-theme-contract.ts` to fail on raw palette classes (`zinc-`, `rose-`, `blue-`, `amber-`) under `src/components/chat/**` (the old launcher's `bg-rose-500` badge would fail today). `check:scroll-contract` already covers one-scroller-per-view.

**Visual regression (A7).** The mobile report's zero-pixel desktop freeze keeps applying to every route except `/messages` and the launcher. Those two are re-baselined once, at the end of Phase 4.

**Additions beyond the spec (spec sections 27 and 09 must be amended in Phase 4, before building):** the Slack-style shell on `/messages*` (a 64px rail plus a 248px sidebar replacing the 248px global sidebar slot, with inverse-surface chrome); the project switcher; the sectioned sidebar; Browse channels; the quick switcher; the thread and details drawer; the Activity and Threads views; the channel header with topic and member count; the channel intro block; system lines; the "N replies" line; and the formatting toolbar.

**Deliberate deviation:** inputs on touch devices use **17px** (the nearest scale step at or above 16px) instead of 15px, because iOS Safari zooms the page when a focused input is under 16px.

### 7.12 Mobile and tablet design (decisions B9–B15 and D14 accepted)

**Breakpoints (B9)**

| Width | Messages layout |
|---|---|
| below 1024px (phones and tablets) | single pane: list ↔ channel; thread and details are full-screen routes |
| 1024px and above | split: list + timeline; thread and details in the 320px drawer |

At 768–1023px only 712px remain after the 56px rail, so a 320px list plus a thread does not fit. This differs from the mobile report's "tablet untouched" for Messages only (L-22).

**Screens and routes (B10)**

| Screen | Route | Header (56px) | Body | Footer |
|---|---|---|---|---|
| List | `/messages` | project name with a switcher chevron (opens the project sheet), search (opens the quick switcher), New message | sections: Threads and Activity rows, Starred, Channels (44px rows), Applications, Direct messages (64px preview rows) | none |
| Channel | `/messages/[id]` | Back (44px), 34px avatar, name 17px, status 13px, details button | timeline | composer |
| Thread | `/messages/[id]/thread/[seq]` | Back, "Thread", channel name | root message and replies | composer |
| Details | `/messages/[id]/details` | Back, "Details" | members, pins, files, notification setting | none |
| Activity | `/messages/activity` | Back, "Activity" | mentions and thread replies | none |
| Threads | `/messages/threads` | Back, "Threads" | threads you follow | none |
| Browse channels | `/messages/p/[projectId]/browse` | Back, "Browse channels", Create | channel rows with Join | none |
| New message | `/messages/new` | Back, "New message" | "To:" chips | composer |

- Desktop renders thread and details as the 320px drawer **on the same routes**, so Back and deep links behave identically. `?m=<seq>` scrolls to and briefly highlights a message (no animation under reduced motion).
- **Back** restores the selected project, the sections' collapsed state, and the scroll offset (rule R7, spec section 27), from in-memory state (L-24).
- Shell: the 56px topbar with the global navigation drawer (rules R1, R2) wraps the List screen. Channel, Thread, and Details are full-screen (rule R6) with their own 56px header. No bottom tab bar. The floating launcher is not mounted below 768px.

**Project switcher on mobile (D14).** The chevron beside the project name opens a bottom sheet (12px top corners, 44px rows): Home, then one row per project with its unread badge, then New project. Choosing one changes the list in memory (7.5). The same sheet appears in the launcher window as a dropdown.

**Composer and keyboard (B11)**
- Sticky bottom composer; `padding-bottom: env(safe-area-inset-bottom)`; the page height uses `100dvh`; a `visualViewport` listener corrects browsers that do not resize the layout viewport. Bottom controls reserve their height plus the safe-area inset (spec section 09). `interactive-widget=resizes-content` is a progressive enhancement (L-23).
- 2 lines growing to 160px; 44px Send and attach targets; input font 17px (7.11).
- Attach opens a bottom sheet: Camera, Photos and videos, Files. These are native file inputs (`accept="image/*" capture`, `accept="image/*,video/*" multiple`, any file). Images are compressed on the device before upload (existing `image-compression.ts`: 1920px, 5 MB default) and the existing `ATTACHMENT_UPLOAD_MAX_FILE_BYTES` limit stays.

**Touch actions (B12)**
- Long-press (500 ms) or the 44px "more" button opens an action sheet with 44px rows: React, Reply in thread, Copy, Edit (own), Delete (own or admin), Pin (admin), Report. Nothing depends on hover (rule R4).
- List rows: DM rows swipe to reveal **Mute** and **Archive**, channel rows **Mute** and **Star**, recoloured to tokens (`--secondary`, `--status-warning-soft`); the same actions exist in each row's overflow button for non-swipe users.

**Pickers (B13).** Mentions, the reaction quick bar, and the attach menu are bottom sheets with 44px rows and 12px top corners, at the drawer layer (40). Task status on a card uses the native `<select>`. Application and invite card actions are full-width 44px buttons.

**Content on small screens.** Images keep a reserved aspect ratio (no layout shift); long words wrap (`overflow-wrap: anywhere`); code blocks scroll horizontally inside their own box, never the page; link previews are full width.

**Lifecycle and push (B14).** Phone browsers suspend background sockets, so on `visibilitychange` (visible), `pageshow`, and `online` the client runs the open-channel catch-up (`after=<last seen channel_seq>`) and then `chat_bootstrap`. The bootstrap poll is paused while hidden. Push notifications deep link to `/messages/<channelId>?m=<seq>`. Web Push works on Android and desktop; on iOS it works only for a site installed to the Home Screen. No PWA work is in scope.

**Verification (B15)**
- Extend `tests/e2e/mobile.spec.ts` with messages cases at **320px and 375px**: no element past `innerWidth`; no interactive element under 44px in the first two screens; Back visible and restoring scroll and selection; composer visible after shrinking the viewport to simulate a keyboard; 200% zoom; thread and details open as full-screen routes.
- One manual pass on one iPhone and one Android phone before Phase 6.
- Gate: INP p75 ≤ 200 ms (the Core Web Vitals "good" threshold) on timeline interactions.

### 7.13 Floating launcher (decisions C1–C10 accepted)

The small floating button stays and is how people reach messages away from the Messages page. It is rebuilt as two components, mounted once through `MainRuntimeProviders` with dynamic imports: `ChatLauncher` (the button) and `ChatWindow` (the window). They replace `ChatPopupV2`.

| Item | Rule |
|---|---|
| Click (C1) | toggles `ChatWindow`, which opens above the button. Header action "Open full page" goes to `/messages/[channelId]` (or `/messages` from the list) |
| Shown (C2) | at 768px and wider; hidden on `/messages*`, `/projects/new`, onboarding, and sign-in and other auth routes; never mounted below 768px (phones use the navigation drawer, then Messages) |
| Button (C3) | 56px round, bottom-right 24px, message icon; badge = mentions plus unread DMs, hidden at 0, capped at "99+"; spec tokens in the `.nb-nav-count` style (replaces the old `bg-rose-500` badge); `aria-label` includes the count; layer 20 |
| Window size (C4) | 400px wide and `min(640px, 100dvh − 5.5rem)` tall, also capped at `100vw − 1.5rem`; anchored above the button; 12px panel radius, `md` shadow; layer 30; not resizable or draggable (L-26) |
| Content (C5, D14) | 56px header: title or Back, "Open full page", minimize, close. The first screen is the **same list screen as mobile** (project switcher dropdown, search, sections), so mobile and the window share one component. Opening a chat pushes the conversation view with Back; a thread pushes another screen with Back. Members and channel details exist only on the full page. Same composer, rows, and previews as 7.10 and 7.11 |
| Other entry points (C6) | "Message" buttons (profiles, network, applications) and notification clicks call `openChatWindow(channelId)` when the current path is not `/messages*` and the viewport is 768px or wider. On `/messages` they navigate inside the page. Below 768px they go to the mobile route (7.12) |
| Incoming messages (C7) | the window never opens by itself. Only the badge changes, plus the existing sound and browser-push preferences. There is no toast preview |
| Minimize, close, focus (C8) | the button toggles the window; minimize and close both return to the button; close also clears the active chat but keeps drafts. Esc minimizes and focus returns to the button. The window is non-modal with no focus trap, and only one window exists (spec: no competing focus regions) |
| Persistence (C9) | open or minimized state and the active chat persist across page navigation in memory (a small `zustand` store, not persisted). After a reload the window starts closed. Drafts per channel and the last-open channel persist in localStorage |
| Shortcut (C10) | none in v1 (L-26) |

**Realtime and cost.** `ChatWindow` and `/messages` are never mounted together, so a tab still has exactly one open-channel topic plus the user topic (section 7.7). A minimized or closed window leaves the channel topic. The idle prewarm only imports the window's code; it fetches no channel data until the window is opened.

**Verification.** New `tests/e2e/chat-launcher.spec.ts`: absent at 767px and on `/messages` and `/projects/new`; present at 768px; click opens the window; Esc minimizes and returns focus to the button; badge shows the right count and caps at "99+"; "Open full page" navigates; a draft survives close and reopen; a "Message" button on a profile opens the window in that chat; no console errors. The palette rule (7.11) and `check:scroll-contract` also cover the window.

---

## 8. Behaviour at 1M users

### 8.1 Load model **[assumption]**

| Input | Value |
|---|---|
| Registered / DAU / peak concurrent users | 1,000,000 / 200,000 / 100,000 (≈130,000 tabs) |
| Messages per DAU per day | 30 → 6.0M/day, 69/s average, ≈700/s in the peak minute |
| Channels joined per user | 15 → 15M member rows; ≈8.5M channels (2.5M DMs plus ≈6M project channels at 20 per project) |
| Reactions / attachments per message | 0.3 / 0.05 |
| Online recipients per message (open viewers + DM hints + mentions) | ≈3 |

### 8.2 Derived load

| Quantity | Result |
|---|---|
| Sends at peak | ≈700/s, each one SQL function call (≈2–3 ms) → ≈2 cores |
| Bootstrap polls | 100,000 visible users ÷ 90 s ≈ 1,100/s × ≈2 ms ≈ 2–3 cores |
| Bootstrap payload | first load ≈ 12–20 KB (up to 100 DM rows with ≤120-character previews, plus channels); each poll returns only changed channels |
| `mark_read` writes | ≈1,400 open-viewer deliveries/s, debounced 3 s and only-if-newer → ≈500/s HOT updates |
| Rows per year | messages ≈2.2B (~635 GB incl. PK), reactions ≈0.66B (~46 GB), attachments ≈0.11B (~22 GB) → **≈700 GB/yr** at 32 partitions ≈ 22 GB per partition |
| DB CPU for chat at peak | ≈6–8 cores; plan for a compute tier with headroom, verified by the Phase 0 load test |
| Realtime events at peak | 700 × 3 + typing ≈ 2.4k/s |

### 8.3 Supabase Realtime limits **[verified 2026-10-01]**

| Limit | Pro (spend cap) | Pro (no cap) / Team | Enterprise | Our peak need |
|---|---|---|---|---|
| Concurrent connections | 500 | 10,000 | 10,000+ (configurable) | ≈130,000 |
| Messages per second | 500 | 2,500 | 2,500+ | ≈2.4k (too close to 2,500) |
| Channel joins per second | 500 | 2,500 | 2,500+ | spread by jitter |
| Channels per connection | 100 | 100 | 100+ | ≈8 |
| Broadcast payload | 3,000 KB | 3,000 KB | 3,000+ KB | <2 KB |

**Consequence:** the default Team limits (10,000 connections) are 13× too small. This design **requires** a custom Realtime configuration (connections ≥150,000, messages/s ≥10,000) agreed with Supabase when real traffic approaches the current plan's limits. The code is built for the 1M targets from day one; the plan (Pro, Team, or Enterprise) is upgraded later as traffic requires, so these limits are configuration, not code. All limits are configurable per project on request.

### 8.4 Cost **[assumption inputs, verified unit prices]**

| Item | Calculation | Monthly |
|---|---|---|
| Realtime messages | 6.0M × 30 × ≈3 + typing ≈ 600M; minus 5M quota; × $2.50/M | ≈ **$1,500** |
| Realtime peak connections | (130,000 − 500) ÷ 1,000 × $10 | ≈ **$1,300** |
| Upstash Redis if used per send | ≈700 commands/s ≈ 60M/day, billed per command | why we do not do it |
| Inngest event per message | ≈3M DM events/day | why push goes direct |

Planning figure for chat Realtime: **≈ $2.8k/month** at these assumptions (Enterprise pricing may differ). Section 8.6 shows the design decisions that keep it there.

### 8.5 Hot spots and their ceilings

| Hot spot | Mechanism | Ceiling | Upgrade |
|---|---|---|---|
| Per-channel send serialisation | row lock on `chat_channels` for the statement | ≈300 sends/s per channel | batched seq allocation, shard hot channels (L-17) |
| `@channel` fan-out | one UPDATE over members | `member_count ≤ 100` inline | async batches when larger (L-13) |
| Big channels | `MAX_MEMBERS = 500` enforced in DB | 500 | raise only with fan-out redesign |
| Hot row bloat | HOT updates, `fillfactor`, no index on hot columns (incl. `last_preview`; the row grows by ≈150 B per update, still HOT at `fillfactor = 70`) | autovacuum keeps up to ≈1k updates/s/table | per-partition tuning |
| Timeline paging | PK range scan + filter | threads > 90% of a channel's messages | partial index on top-level |
| Thundering herd after an outage | jittered reconnect | 2,500 joins/s | raise limit |
| Project channel background unread staleness | 90 s poll | latency ≤ 2 min | tick topics for top-N channels (L-2) |

### 8.6 Why the design is shaped this way at scale

- **One SQL function per send** because each application-side statement on the transaction pooler pays an extra Describe round trip (existing marker `lib/db/index.ts:50`); one call is 1–2 round trips instead of 5–7, and the pool is 10 connections per instance.
- **Composite natural key, no uuid per message**: saves 16 B + an index per row (~35 GB/yr) and makes every query partition-pruned.
- **No per-member previews, no per-message notification rows, no receipts**: removes three write amplifiers that scaled with recipients. The single list preview lives on the channel row we already update per message.
- **Publish by REST batch after commit**: zero DB write amplification, and no trigger on the hot path.
- **Project-scoped channels and member caps**: they bound every fan-out, which is what makes 1M users tractable at all.

### 8.7 Failure modes

| Failure | Effect | Recovery |
|---|---|---|
| Realtime down | live updates stop; sends still commit | catch-up fetch + poll on reconnect |
| Crash after commit, before publish | one missed live event | next poll/focus |
| Duplicate send (retry) | none | `client_message_id` unique |
| Gap in `channel_seq` | possible only if a transaction aborts after the increment (it rolls back with it) | none needed; no gaps |
| Push service slow | none for chat | `after()` and TTL |
| DB failover | sends fail with a visible Retry | client Retry |

---

## 9. Debt ledger (every deliberate shortcut)

Format: id · shortcut · **ceiling** · **upgrade trigger**.

| Id | Shortcut | Ceiling | Upgrade trigger |
|---|---|---|---|
| L-1 | Publish after commit is best-effort | a crash loses one live event | users report missing live messages, or loss rate > 0.1% in logs → outbox table + relay |
| L-2 | Background unread by 90 s poll, not live topics | ≤2 min staleness for project/private channels; ≈1.1k qps at 100k concurrent | poll load > 15% of DB CPU, or product wants live bold → tick topics for top-N channels |
| L-3 | In-memory rate limit on sends/reactions | limit × instance count | abuse seen → Redis `rateLimit()` for that action |
| L-4 | No message search | none | launch + 30 days, or first 10 user requests → Postgres FTS on a recent-window partition, or an external index |
| L-5 | No global public channels | none | community-channel request with a moderation owner |
| L-6 | ~~One project channel per project~~ promoted to v1 by decision D5 (many channels per project, cap 200) | 200 channels per project | projects hit the cap → raise it once the Browse query time is measured |
| L-7 | Typing only when `member_count ≤ 50`, 3.5 s throttle | 50 typers/room | larger channels need typing → server-side aggregation |
| L-8 | "Active recently" from the 10-minute heartbeat, no live presence | 10-minute resolution | sub-minute presence requirement |
| L-9 | No channel slugs | none | vanity URLs requested |
| L-10 | No reaction notifications | none | requested; add as Activity row, not tray row |
| L-11 | Push direct, per-instance 30 s suppression | duplicates across instances (coalesced by `Topic`) | push volume cost or complaints → shared suppression |
| L-12 | No emoji-picker dependency | 6 quick reactions + OS picker | reaction variety complaints |
| L-13 | `@channel`/`@here` only when `member_count ≤ 100` | 100 | larger channels → async batch |
| L-14 | One-release purge of old localStorage keys | one release | delete the purge code one release after launch |
| L-15 | No moderation UI | reports accumulate in `chat_reports` | > 50 open reports or a policy requirement |
| L-16 | No message retention | ≈700 GB/yr | storage budget or legal retention |
| L-17 | Per-channel `last_seq` row lock | ≈300 sends/s/channel | any channel sustaining > 100 sends/s |
| L-18 | Hash partitions fixed at 32 | ≈22 GB per partition at 1M users | partitions > 150 GB → rebuild with 128 |
| L-19 | Author index on `chat_messages` | +1 index write per send | if write latency p95 gate fails → drop and scan by partition in jobs |
| L-20 | Drizzle schema plain tables, partitions in hand-written SQL | `drizzle-kit generate` would not emit partitions | drizzle adds partition support |
| L-21 | Preview of the last message only; deleting it shows "Message deleted" until the next message | one stale line per channel | users notice → recompute from the previous message in `chat_delete_message` |
| L-22 | Tablets (768–1023px) use the single-pane mobile pattern for Messages (the mobile report left tablet untouched) | Messages only | tablet usage data shows wasted space → split pane at ≥900px |
| L-23 | Soft-keyboard handling by `dvh` + `visualViewport`; `interactive-widget=resizes-content` is a progressive enhancement | iOS ignores the viewport hint | any device where the composer is hidden → dedicated keyboard offset hook |
| L-24 | Back restores list selection and scroll from in-memory state | lost on reload | users report lost position after reload → `sessionStorage` |
| L-25 | DM unread count is `last_seq - last_read_seq`, so thread replies count | DMs with heavy threading | complaints → count top-level only via a second cursor |
| L-26 | Launcher window has a fixed size and position, no shortcut, no auto-open | none | power users ask for a shortcut or a movable window |
| L-27 | No channel Files tab (Messages and Pins only) | none | users ask to find shared files → list `chat_attachments` by channel (PK prefix scan) |
| L-28 | Message search icon hidden; the quick switcher finds channels and people only | none | same trigger as L-4 |
| L-29 | Sticky day label without jump-to-date | none | requested → seq-by-date lookup per channel |
| L-30 | Project tiles ordered by recent activity (no manual reorder, no overflow dialog); project sidebars show the 8 most recent DMs | long project lists | users with more than 12 projects complain → pin and reorder, search in the rail |
| L-31 | No "also send to the channel" on thread replies | none | requested |

---

## 10. Migration and cutover

### 10.1 Order (single migration `0179_chat_rebuild.sql`, hand-written)

1. Pre-step outside SQL: `pg_dump` of the 16 old tables (kept locally, not committed).
2. `DROP` in dependency order: triggers → policies → functions → tables (incl. `dm_pairs`, `typing_indicators`, `attachment_uploads`) → columns `projects.conversation_id`, `role_applications.conversation_id` and index `projects_conversation_idx`.
3. `DELETE` the old `user_notifications` rows and `notification_deliveries` (5.A).
4. `CREATE` `project_invites` and all `chat_*` tables (partitioned ones via a `DO` loop generating 32 partitions), indexes, CHECKs, constants.
5. `CREATE` functions, the 3 triggers, RLS, `realtime.messages` policies, storage policies.
6. `GRANT EXECUTE` to the runtime role.
7. Backfill: for every existing project, `chat_sync_project_members` creates its default channel `#general` and adds its members; every pending application gets its private channel and card.

Drizzle `schema/index.ts` is edited in the same change: old tables and relations removed, new tables added as plain definitions (L-20).

### 10.2 Code cutover

Old and new cannot run together (different tables). The switch is **one deploy** covering phases 1 to 4, on a branch; `main` keeps working until that branch is complete. Merge, deploy, run the section 10.3 checks, watch section 11 canary signals.

### 10.3 Proof that the old system is gone (all must be zero)

```sql
select 'table' k, tablename n from pg_tables
 where schemaname='public' and tablename ~ 'conversation|^message|^dm_pairs|typing_ind|attachment_uploads'
union all
select 'func', p.proname from pg_proc p join pg_namespace s on s.oid=p.pronamespace
 where s.nspname in ('public','app_private') and p.proname ~ 'conversation|^handle_message|typing'
union all
select 'col', table_name||'.'||column_name from information_schema.columns
 where table_schema='public' and column_name ~ 'conversation_id'
union all
select 'trigger', tgname from pg_trigger where not tgisinternal and tgname ~ 'conversation|messages_after_insert|typing'
union all
select 'policy', policyname from pg_policies where policyname ~ 'conversation|^message_|^messages_|dm_pairs'
union all
select 'pub', tablename from pg_publication_tables where pubname='supabase_realtime' and tablename ~ 'conversation|message|typing';
```

Plus: `git grep -nE "conversationId|conversation_id|conversations\b|messageWorkflow|messageWorkLinks|dmPairs|conversationParticipants|messages-v2|chat-v2|/messages\?conversationId|MessageAttention|ChatPopup|actions/messaging" -- src scripts tests` returns nothing; and `check:db-catalog-drift`, `check:db:migration-journal`, `check:db:remigration-replay`, the RLS and authz contract scripts, and `check:query-key-contract` pass.

---

## 11. Phases and gates

| Phase | Scope | Gate (must pass to continue) |
|---|---|---|
| **0 Prove** | the Realtime limit table (8.3) kept as an upgrade checklist; `pgbench` scripts for `chat_send_message`, `chat_bootstrap`, timeline page on a seeded DB of 50M messages / 5M members; WebSocket soak of 5,000 clients; confirm push helper reuse | reconnect jitter and the per-connection channel budget verified in the soak; send p95 ≤ 10 ms server-side at 700/s; bootstrap p95 ≤ 15 ms at 1.1k/s; timeline page p95 ≤ 20 ms; soak delivery p95 ≤ 500 ms |
| **1 Database** | migration `0179`, functions (including channel create, join, leave), RLS, policies, rebuilt scripts, `check-chat-database.ts` | 10.3 queries zero; function tests pass (TDD); RLS contract green |
| **2 Backend** | `actions/chat/*`, upload route, publish helper, card hydration, `project_invites` wiring, privacy/block enforcement | unit tests for each function; authz contract green; idempotency and ordering tests |
| **3 Realtime and entry** | `ChatShellProvider`, `chatSummary`, reconnect catch-up, presence move, `RealtimeProvider` surgery, storage purge | no messaging code left in `RealtimeProvider`; multi-tab cursor sync test |
| **4 UI** | layout per 7.11, timeline, composer, threads, unread, Activity, cards, mobile per 7.12; amend design spec section 27 with the new surfaces | e2e rewritten (send, thread, unread, card action); `mobile.spec.ts` messages cases green at 320 and 375px (0 overflow, 0 targets under 44px, Back restores scroll, composer visible with a simulated keyboard); `check:theme-contract` palette rule green; INP p75 ≤ 200 ms on timeline interaction; shell e2e green (project switch is instant, Browse, Create, Join, DM start, quick switcher; 7.10); launcher e2e green (7.13); desktop `/messages` re-baselined once |
| **5 Cutover** | delete old code, scripts, tests, docs; run 10.3 | zero hits; repo line count report |
| **6 Canary** | `canary` watch | send error rate < 0.1%; Realtime `too_many_*` errors = 0; p95 gates hold in production for 48 h |

Production signals watched in Phase 6: send p95 and error rate, bootstrap qps and p95, Realtime connections and messages/s against the granted limits, `tenant_events` and `too_many_*` log lines, push failure rate, Realtime message count versus the 8.4 estimate.

---

## 12. Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Realtime plan limits are below need at 1M users (8.3) | traffic is throttled or disconnected once the plan's limits are reached | the code targets 1M from day one; upgrade the plan or request higher limits before traffic reaches them; watch `tenant_events` and `too_many_*` in Phase 6 |
| Partition count is permanent (L-18) | rebuild if wrong | sized with 5x headroom; revisit at 150 GB/partition |
| Hash partitioning + hand-written SQL vs Drizzle tooling | drift checks fail | L-20; update `check-db-catalog-drift` in Phase 1 |
| Design spec has no threads, Activity, or channel header | UI invents patterns | amend spec section 27 in Phase 4 before building (7.11) |
| iOS and Android soft keyboards differ | composer hidden or page zoom on focus | 17px inputs on touch, `dvh` + `visualViewport`, real-device pass (7.12, L-23) |
| Spec rows need a preview and unread count; Slack does not | extra columns on the hottest row | one 120-character column on the channel row, measured in Phase 0 |
| The Slack-style shell replaces the global sidebar slot on `/messages*` | spec section 09 amendment; users lose the sidebar there | the NB mark opens the global navigation drawer; amend the spec in Phase 4 (7.11) |
| Many channels per project (D5) | more channels (≈8.5M), more moderation surface | per-project cap 200, name rules, members-only creation, reports table (L-15) |
| ~24k lines removed, 87 files touched | regressions in invites/applications/project flows | section 5.G list; e2e for each; branch-only until green |
| Uncommitted work in `main` (`schema/index.ts`, `_journal.json`, messaging/upload files, 60+ modified files) | merge collisions | commit or stash before Phase 1 |
| Poll load grows with concurrency | DB CPU | L-2 trigger; jitter; visibility gating |
| Best-effort publish | missed live event | L-1 catch-up |
| Account export defect in the old code (other users' content) | privacy | fixed in the rebuild (7.9) |

---

## 13. Decisions: settled and open

### Settled (merged into this report)

| # | Decision | Where |
|---|---|---|
| A1–A8 | Design spec binds: previews on the channel row, 320px drawer, spec message rows, per-member archive/mute/star, palette check, `/messages` re-baselined once, layer scale | 7.11 |
| B9–B15 | Mobile: single pane below 1024px, routes with Back restore, composer and keyboard rules, long-press sheets and swipe, bottom-sheet pickers, resume and catch-up, mobile e2e and a real-device pass | 7.12 |
| C1–C10 | Floating launcher: opens a compact window, hidden on `/messages*` and below 768px, badge, 400×640, one window, never auto-opens, Esc minimizes, in-memory state, no shortcut | 7.13 |
| D1–D15 | Slack-style layout: dark inverse rail and sidebar replacing the global sidebar slot on `/messages*`; sections instead of tabs; project switcher; many channels per project with Browse and Create; DM parity; Aa formatting toolbar; header and Messages/Pins tabs; quick switcher; moon pause and presence menu; the cut list; mobile and window adaptation; hover toolbar | 7.10, 7.12 |
| Scope | the project is the workspace; no platform-wide public channels | 7.1 |
| Invites | a real `project_invites` table, introduced now | 7.2 |
| Deleted users | group-channel messages remain as "Deleted user"; DMs are deleted | 7.9 |
| Badges | chat counts on the Messages icon only, not the bell | 7.8 |
| Unsent messages | in-memory retry only | 7.4 |
| Salvage | reuse schema-free presentational components instead of rewriting them (candidates in 5.F), each verified at Phase 4 under `freeze` | 5.F |
| Supabase plan | not needed now: the code is built for the 1M targets; the plan is upgraded (Pro, Team, or Enterprise) as traffic requires | 8.3 |

### Open (need your input)

1. **Search at launch.** Message search is deferred (L-4, L-28). Confirm that launching without it is acceptable, or say it is required and I will add a scoped design.
2. **Phase 0 load test.** Default: run it against a Supabase branch database, never production. Confirm.
3. **Approval to start.** After you approve this report, I write the Phase 0 plan (limit request, load-test scripts, migration outline) and nothing in the repo changes before that.


---

## 14. Appendix

### 14.1 Test files that reference messaging (47 unit + 5 e2e)

Unit: `account-export-contract`, `appearance-contract-script`, `application-inbox-navigation-contract`, `application-sidebar-contract`, `applications-collaboration`, `attachment-pipeline-optimization`, `composer-workflow`, `create-project-launch-settings`, `create-project-wizard-shell-layout`, `integrations-ide-extension-redesign`, `message-attention`, `message-global-attention-contract`, `message-media-egress-contract`, `message-outbox-scheduling-contract`, `message-preview-authority`, `message-reaction-activity-contract`, `message-rendering-optimization`, `message-thread-items`, `message-unread-realtime`, `messages-audit-implementation-contract`, `messages-v2-cache`, `messaging-collaboration-contract`, `messaging-ponytail-optimization`, `messaging-unread-contract`, `messaging-validation`, `network-notifications-provider`, `notification-actions-contract`, `notification-cache`, `notification-classifier`, `notification-preferences`, `notification-presentation`, `platform-resource-remediation`, `profile-action-state`, `profile-role-layout-contract`, `project-updates`, `realtime-sender`, `sql-supabase-runtime-remediation`, `task-panel-integration-contract`, `topnav-contract`, `typing-state`.
E2E: `application-flow-smoke`, `messages-tabs-matrix`, `messaging-smoke`, `messaging-unread-rebound`, `mobile`.
Rule: delete if it tests removed code; update if it tests a kept feature (notifications, applications, account export, topnav, profile, project updates, create-project).
New: messages cases in `tests/e2e/mobile.spec.ts` (7.12), launcher cases in a new `tests/e2e/chat-launcher.spec.ts` (7.13), shell cases in a new `tests/e2e/chat-shell.spec.ts` (project switch, Browse, Create, Join, DM start, quick switcher; 7.10), and a palette rule in `scripts/check-theme-contract.ts` (7.11).

### 14.2 Numbers to re-verify at Phase 0

Every **[assumption]** in 8.1: DAU ratio, messages per user, recipients per message, peak factor, tabs per user. Replace with production analytics or a survey of comparable products before sizing compute.
