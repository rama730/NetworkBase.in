# Send in NetworkBase — corrected scope

The user's correction supersedes the earlier Messages redesign proposal. Only the destination selection inside the sharing dialog changes. Messages keeps its preceding page, sidebar, list, project selection, keyboard order, routes and floating-window design. Existing unrelated metadata, attachment, security and profile-sharing edits in this shared working tree are preserved.

## Restoration

The picker additions to ChatSections, HomePane, ListScreen, MessagesChrome, MessagesIndex, MessagesSidebar, both navigation stores, useSelectedProject, channel-view and messaging types were removed. These files match their preceding tracked versions. Picker additions to already-modified ConversationView, MessagesViews, ChatWindow, ChatShellProvider and chat readers were reversed selectively so existing work remains intact. There are no sharing destination imports inside Messages components, chat actions or messaging helpers.

## Sharing behavior

Send in NetworkBase starts with joined projects. Selecting a project opens only its joined channels; selecting a channel identifies the send target. Direct messages has its own person list. Existing groups and application conversations remain reachable through More, with application context separate from ordinary project channels. The shared dialog supports profile, project and application links without changing Messages navigation.

Search and return-scroll memory belong to the dialog. Switching scope clears the target and retains the note. Destination footer labels include project/channel or person identity. No destination is preselected, no channel is joined, and no direct message is created by browsing.

Member-only server pages remove the former global 30-row cutoff. Keyset pagination retains PostgreSQL timestamp microseconds; a 107-DM database fixture verifies complete, duplicate-free traversal. Account/session-scoped queries withhold destinations while offline, failing or revalidating. Expected-actor checks and live destination capability checks precede new sends, while the existing SQL send function remains authoritative. Existing receipt recovery prevents duplicate sends after a lost acknowledgment.

## Validation

- 34 unit checks passed, including the untouched legacy Messages grouping/sidebar/navigation checks and sharing scope classification.
- 24 database checks passed across sharing, destination and existing messaging metadata suites on a disposable PostgreSQL instance. The new destination suite has five checks covering root project membership/pagination, same-name channel isolation, all 107 DMs, blocked/archived targets and membership/session changes.
- 42 Chromium/WebKit checks passed for the existing profile flow and sharing dialog, including project/channel and DM isolation, retained notes, offline/revoked destinations, receipt retry, account changes and 320px layouts.
- TypeScript, scoped ESLint, query-key, canonical-logic, API-envelope and strict impact-review checks passed. The isolated production build succeeded; temporary generated configuration entries were removed afterward.

No live messages, membership changes or database migrations were used. The application build runs in a separate `.next-share-picker-check` directory so the active development build remains intact.
